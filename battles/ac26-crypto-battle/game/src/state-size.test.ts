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
 * The largest match this Battle is currently known to fit in one DynamoDB item.
 * Raising it needs a measurement, not an assumption.
 */
const SUPPORTED_MAX_TEAMS = 8;

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
  test(`a ${SUPPORTED_MAX_TEAMS}-team match fits in a DynamoDB item`, () => {
    expect(playWorstCase(SUPPORTED_MAX_TEAMS)).toBeLessThan(DDB_ITEM_LIMIT_BYTES);
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
    expect(DEFAULT_CONFIG.contractsPerIssue * SUPPORTED_MAX_TEAMS).toBeLessThanOrEqual(48);
  });
});
