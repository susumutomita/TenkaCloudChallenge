import { describe, expect, test } from "bun:test";
import { applyOp, DEFAULT_CONFIG, initialState, tick, validateOp } from "./reducer.ts";
import { buildLeakOp } from "./playtest.ts";

/**
 * [Issue #659] How big one match's persisted state gets, and where that stops
 * fitting.
 *
 * The whole match -- every team, every Order, the entire public record -- is
 * ONE row, keyed `tenant x event x problem x run` and rewritten on every op
 * (see the platform's `coordination-store`). On the DynamoDB backend a single
 * item is capped at 400 KB, and there is no partial write: the tick that
 * crosses the line fails, and the match stops mid-play with no obvious cause.
 *
 * `contractsPerIssue` is what makes this worth pinning. Before #659 a team got
 * one Order per issue; it now gets a batch, and since Orders are retained after
 * they resolve (scoring and the debrief both read them back), the row grows
 * with `teams x batch x issues`. That is a real, measured limit on how large a
 * match can be, so it is measured here rather than reasoned about -- the
 * numbers below come from running the real reducer over a full 90-minute match
 * with every team leaking everything it is allowed to leak, which is the
 * worst case for both the Order list and the public record.
 *
 * The Turso/libSQL backend has no comparable per-row cap, so this ceiling is
 * specifically the DynamoDB one.
 */

/** DynamoDB's maximum item size. */
const DDB_ITEM_LIMIT_BYTES = 400 * 1024;

/**
 * The largest match this Battle is currently known to fit in one DynamoDB item
 * WITH MARGIN. Raising it needs a measurement, not an assumption.
 *
 * [Issue #659] Lowered from 8 when the cipher ladder landed. Eight teams still
 * fit -- at about 90% of the cap, measured -- but "fits" and "is supported" are
 * not the same claim: there is no partial write, so the tick that crosses the
 * line stops the match dead, and a number that close leaves nothing for the
 * rungs still to be added. Six measures at roughly two thirds.
 *
 * Nothing enforces this. A larger event does not fail at setup; it fails
 * mid-match, which is why the number is written down here and in OPERATOR.md.
 */
const SUPPORTED_MAX_TEAMS = 6;

/** How much of the cap a supported match may use before it stops being supported. */
const REQUIRED_HEADROOM = 0.75;

function playWorstCase(teamCount: number): number {
  const teamIds = Array.from({ length: teamCount }, (_, i) => `team-${i}`);
  let state = initialState({ eventId: "state-size", teamIds, matchSecret: "s".repeat(64) });
  for (let atMs = 0; atMs <= DEFAULT_CONFIG.matchDurationMs; atMs += DEFAULT_CONFIG.contractIntervalMs) {
    state = tick(state, atMs);
    for (const teamId of teamIds) {
      const leakable = state.contracts.filter(
        (c) => c.teamId === teamId && c.status === "open" && c.allowedMethods.includes("leak"),
      );
      for (const contract of leakable) {
        const op = buildLeakOp(contract.id);
        if (validateOp(state, teamId, op).ok) state = applyOp(state, teamId, op);
      }
    }
  }
  return JSON.stringify(state).length;
}

describe("a full match's persisted state fits the backend that has to hold it", () => {
  test(`a ${SUPPORTED_MAX_TEAMS}-team match fits in a DynamoDB item, with room to spare`, () => {
    // Margin, not just fit. A match that lands at 97% of the cap passes a
    // bare "is it under the limit" check and is still one balance change away
    // from dying mid-play -- which is exactly what happened when the ladder
    // was added and this test said nothing.
    expect(playWorstCase(SUPPORTED_MAX_TEAMS)).toBeLessThan(
      DDB_ITEM_LIMIT_BYTES * REQUIRED_HEADROOM,
    );
  });

  test("the ceiling is real: one team past the supported maximum is measured, not assumed", () => {
    // Not a wish -- a record of where the line actually is. If a change makes
    // the state cheaper, this test fails and the supported maximum above should
    // be re-measured and raised deliberately, rather than drifting.
    expect(playWorstCase(SUPPORTED_MAX_TEAMS + 4)).toBeGreaterThan(DDB_ITEM_LIMIT_BYTES);
  });

  test("the batch size is what drives the growth, so it cannot be raised blind", () => {
    // Doubling the batch roughly doubles the Order list, which is the dominant
    // term. Pinned so that a future balance pass raising `contractsPerIssue`
    // sees the storage cost in the same breath as the game-design argument.
    const base = playWorstCase(2);
    expect(base).toBeLessThan(DDB_ITEM_LIMIT_BYTES);
    expect(DEFAULT_CONFIG.contractsPerIssue * SUPPORTED_MAX_TEAMS).toBeLessThanOrEqual(36);
  });
});
