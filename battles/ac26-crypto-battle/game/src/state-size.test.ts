import { describe, expect, test } from "bun:test";
import { applyOp, DEFAULT_CONFIG, initialState, tick, validateOp } from "./reducer.ts";
import { buildLeakOp } from "./playtest.ts";
import { HINT_LEVELS } from "./hints.ts";
import { TERMINAL_ORDER_RETENTION_BATCHES } from "./reducer.ts";

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
 * with every team buying every hint and then leaking everything it is allowed
 * to leak, which is the worst case for the Order list, the per-Order fields and
 * the public record at once.
 *
 * The Turso/libSQL backend has no comparable per-row cap, so this ceiling is
 * specifically the DynamoDB one.
 */

/**
 * The two ceilings this row has to live under, which are NOT the same number.
 *
 * DynamoDB caps a single item at 400 KB and has no partial write, so the tick
 * that crosses the line stops the match dead. Turso has no comparable per-row
 * cap — but the backend is a runtime choice (`CONTROL_DATA_BACKEND`), the row
 * is read AND rewritten on every participant action, and on Turso each of those
 * rides in an HTTP request body (`@libsql/client/http`). So size matters on
 * both backends; only one of them fails loudly.
 */
const DDB_ITEM_LIMIT_BYTES = 400 * 1024;

/**
 * The platform's maximum event size: `teams.max(99)`, from DynamoDB's 100-item
 * TransactWrite limit (one event row + 99 team rows). A Battle that cannot hold
 * a 99-team match cannot be run at the size the platform advertises.
 */
const PLATFORM_MAX_TEAMS = 99;

/**
 * How much of DynamoDB's cap a full 99-team match may use.
 *
 * Margin, not bare fit: a test that only fails at the cliff passes right up
 * until the match dies in play, which is exactly what happened when the cipher
 * ladder pushed an 8-team match to 97% and this file said nothing.
 */
const REQUIRED_HEADROOM = 0.75;

/**
 * What one match may occupy on the Turso backend.
 *
 * Turso has no per-row cap worth worrying about, but the row is read AND
 * rewritten on every participant action and each of those rides in an HTTP
 * request body (`@libsql/client/http`). This is a budget for that round trip,
 * not a hard limit — it exists so the row cannot quietly grow back.
 */
const TURSO_BUDGET_BYTES = 2 * 1024 * 1024;

/**
 * Memoised because `playFullMatch` is deterministic and slow: the worst case
 * now buys three hints on every Order before leaking it, which roughly triples
 * the ops, and the tests below ask for the same team counts repeatedly (8 for
 * the per-team figure, then the ceiling itself, then one team past it). Without
 * this the 99-team run alone is played twice and the file times out.
 */
const worstCaseCache = new Map<number, number>();

function playWorstCase(teamCount: number): number {
  const cached = worstCaseCache.get(teamCount);
  if (cached !== undefined) return cached;
  const size = JSON.stringify(playFullMatch(teamCount)).length;
  worstCaseCache.set(teamCount, size);
  return size;
}

/**
 * Per-test timeout. A full 90-minute match at the platform maximum is a real
 * computation -- 99 teams x 18 issues x 6 Orders x (3 hints + a LEAK) -- and it
 * runs past bun:test's 5s default on CI hardware. Slow is the point: these are
 * measurements, not unit tests, and the alternative is asserting against a
 * number nobody re-derives.
 */
const HEAVY_TEST_TIMEOUT_MS = 60_000;

/**
 * A whole match with every team leaking everything it is allowed to leak, and
 * buying every hint on every Order first.
 *
 * [Issue #659 §9] The hints are in the worst case rather than left out of it
 * because that is what a worst case is: `Contract.hintsRevealed` is written on
 * every Order a team buys help on, and a Battle sized off a measurement that
 * assumed nobody ever asks for help would be sized off the easy path. It costs
 * about 216 bytes per team over the whole match — real, small, and now pinned
 * rather than discovered at 24 teams in play.
 */
function playFullMatch(teamCount: number) {
  const teamIds = Array.from({ length: teamCount }, (_, i) => `team-${i}`);
  let state = initialState({ eventId: "state-size", teamIds, matchSecret: "s".repeat(64) });
  for (let atMs = 0; atMs <= DEFAULT_CONFIG.matchDurationMs; atMs += DEFAULT_CONFIG.contractIntervalMs) {
    state = tick(state, atMs);
    for (const teamId of teamIds) {
      const open = state.contracts.filter((c) => c.teamId === teamId && c.status === "open");
      for (const contract of open) {
        for (let level = 0; level < HINT_LEVELS; level += 1) {
          const op = { kind: "reveal-hint" as const, contractId: contract.id };
          if (validateOp(state, teamId, op).ok) state = applyOp(state, teamId, op);
        }
      }
      const leakable = state.contracts.filter(
        (c) => c.teamId === teamId && c.status === "open" && c.allowedMethods.includes("leak"),
      );
      for (const contract of leakable) {
        const op = buildLeakOp(contract.id);
        if (validateOp(state, teamId, op).ok) state = applyOp(state, teamId, op);
      }
    }
  }
  return state;
}

describe("a full match's persisted state fits the backend that has to hold it", () => {
  test(`a ${PLATFORM_MAX_TEAMS}-team match — the platform's maximum — stays well inside a Turso row`, () => {
    // [Issue #659] The assertion the storage model exists for. Measured before
    // it: 4.49 MB, 45.4 KB per team, of which Orders were 72% — 10,692 of them,
    // almost all long dead. A 4.5 MB read-modify-write per click is broken on
    // any backend, and it put the supported maximum at six teams against a
    // platform that sells ninety-nine.
    expect(playWorstCase(PLATFORM_MAX_TEAMS)).toBeLessThan(TURSO_BUDGET_BYTES);
  }, HEAVY_TEST_TIMEOUT_MS);

  test("the cost per team is linear, so the ceiling can be computed rather than guessed", () => {
    // A super-linear term — anything cross-team, like a per-pair record — would
    // pass at small sizes and blow up at the top of the range, which no
    // single-size check would catch.
    const small = playWorstCase(4) / 4;
    const large = playWorstCase(PLATFORM_MAX_TEAMS) / PLATFORM_MAX_TEAMS;
    expect(large).toBeLessThan(small * 1.5);
  }, HEAVY_TEST_TIMEOUT_MS);

  /**
   * [Issue #659] The DynamoDB backend cannot host a full-size match, and that
   * is a property of the GAME, not a coding deficiency.
   *
   * The public ledger is permanent by design — #659 §10 makes the fact that it
   * does not disappear the source of LEAK's weight — and it grows with every
   * team that plays. At 99 teams it alone is about two thirds of the row. No
   * encoding removes that: pruning it would delete the thing the game is about.
   *
   * So the honest statement is a team ceiling per backend, measured. Turso has
   * no comparable per-row cap and takes the platform's full 99; DynamoDB's
   * 400 KB item limit stops well short, and since there is no partial write,
   * crossing it stops the match mid-play. This test pins where that line is so
   * an operator sizing an event on DynamoDB has a number, and so a change that
   * moves it has to move this too.
   */
  test("the DynamoDB ceiling is measured, not assumed", () => {
    const budget = DDB_ITEM_LIMIT_BYTES * REQUIRED_HEADROOM;

    // Extrapolating from 8 teams gets close, but reads slightly LOW: per-team
    // cost creeps up with team count (the ledger each team reads is longer),
    // so the estimate can name a size that does not actually fit — which is
    // how this test passed at an 18-team estimate whose real match was 1.4 KB
    // over. Estimate, then walk down to the largest size that measures inside
    // the budget, so the number below is the ceiling rather than a projection
    // of it.
    let ddbMaxTeams = Math.floor(budget / (playWorstCase(8) / 8));
    while (ddbMaxTeams > 1 && playWorstCase(ddbMaxTeams) >= budget) ddbMaxTeams -= 1;

    expect(ddbMaxTeams).toBeGreaterThanOrEqual(16);
    expect(ddbMaxTeams).toBeLessThan(PLATFORM_MAX_TEAMS);
    // A match at that size really does fit, with the headroom claimed --
    // and one team more does not, so this is the edge and not an understatement
    // that would let the row grow unnoticed.
    expect(playWorstCase(ddbMaxTeams)).toBeLessThan(budget);
    expect(playWorstCase(ddbMaxTeams + 1)).toBeGreaterThanOrEqual(budget);
  }, HEAVY_TEST_TIMEOUT_MS);

  test("the Order belt does not grow without bound over a match", () => {
    // The belt is a work queue, not a record: terminal Orders are pruned past a
    // short retention window. Without that it grew to `issues x batch` per team
    // and dominated everything else.
    const state = playFullMatch(2);
    const perTeam = state.contracts.filter((c) => c.teamId === "team-0").length;
    expect(perTeam).toBeLessThanOrEqual(
      DEFAULT_CONFIG.contractsPerIssue * (TERMINAL_ORDER_RETENTION_BATCHES + 2),
    );
  });
});
