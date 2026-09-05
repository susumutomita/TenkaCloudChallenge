import { describe, expect, test } from "bun:test";
import { applyOp, DEFAULT_CONFIG, initialState, projectForTeam, tick, validateOp } from "./reducer.ts";
import { buildClearingOp, buildLeakOp } from "./playtest.ts";
import { huntKey, storedHuntKey } from "./hunt-key.ts";
import { HINT_LEVELS } from "./hints.ts";
import { TERMINAL_ORDER_RETENTION_BATCHES } from "./reducer.ts";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Full 90-minute participant route: one opening Order, then every batch at its
 * actual arrival. All hints are purchased; leakable Orders disclose; the other
 * individual Orders are computed; both stages of every duel finish. Every team
 * also spends its RPS budget against every eligible opponent. Near match end,
 * ROTATE reopens budgets so pending predictions coexist with the full ledger.
 * Measure before opening and after settlement; the terminal row is not the peak.
 *
 * Use 26-character team IDs, epoch timestamps and UTF-8 byte length. The old
 * LEAK-only fixture omitted FHE/MPC/PROVE and RPS records, used short IDs and
 * missed rush Orders when advancing on five-minute boundaries after onboarding.
 * That path understated the row; it was not a worst-case capacity check.
 *
 * This scenario measures 2,968,946 peak bytes at 99 teams (2026-09-05), about 30.0 KB
 * per team. The declaration reserves 30 KiB per team. SQL's platform policy is
 * 4 MiB; its guard is checked here with 25% headroom. DDB fits 11 teams with that
 * same headroom. Runtime-specific overrides remain the platform's decision.
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
// Matches TenkaCloud infrastructure/lib/problem-deploy/control-data/domain/
// coordination-budget.ts SQL_STATE_LIMIT_BYTES (4 MiB), with 25% headroom.
const TURSO_BUDGET_BYTES = 4 * 1024 * 1024 * REQUIRED_HEADROOM;

/**
 * Memoised because `playFullMatch` is deterministic and slow: the worst case
 * now buys three hints on every Order before leaking it, which roughly triples
 * the ops, and the tests below ask for the same team counts repeatedly (8 for
 * the per-team figure, then the ceiling itself, then one team past it). Without
 * this the 99-team run alone is played twice and the file times out.
 */
const worstCaseCache = new Map<number, ReturnType<typeof playMeasuredMatch>>();
function measured(teamCount: number) {
  const cached = worstCaseCache.get(teamCount);
  if (cached) return cached;
  const result = playMeasuredMatch(teamCount);
  worstCaseCache.set(teamCount, result);
  return result;
}

function playWorstCase(teamCount: number): number { return measured(teamCount).peak; }

/**
 * Per-test timeout. A full 90-minute match at the platform maximum is a real
 * computation -- 99 teams x 18 issues x 6 Orders x (3 hints + a LEAK) -- and it
 * runs past bun:test's 5s default on CI hardware. Slow is the point: these are
 * measurements, not unit tests, and the alternative is asserting against a
 * number nobody re-derives.
 */
const HEAVY_TEST_TIMEOUT_MS = 120_000;

/**
 * A whole match with every team finishing every mechanism and duel, choosing
 * disclosure when offered, and buying every hint on every Order first.
 *
 * [Issue #659 §9] The hints are in the worst case rather than left out of it
 * because that is what a worst case is: `Contract.hintsRevealed` is written on
 * every Order a team buys help on, and a Battle sized off a measurement that
 * assumed nobody ever asks for help would be sized off the easy path. It costs
 * about 216 bytes per team over the whole match — real, small, and now pinned
 * rather than discovered at 24 teams in play.
 */
function playMeasuredMatch(teamCount: number) {
  const teamIds = Array.from({ length: teamCount }, (_, i) => String(i).padStart(26, "0"));
  const startMs = 1_788_595_200_000;
  const idle = tick(initialState({ eventId: "state-size", teamIds, matchSecret: "s".repeat(64) }), startMs);
  let state = applyOp(idle, teamIds[0]!, { kind: "start" });
  let peak=0, pendingPeak=0;
  for (let atMs = 0; atMs <= DEFAULT_CONFIG.matchDurationMs; atMs = atMs === 0 ? DEFAULT_CONFIG.onboardingFollowUpMs : atMs + DEFAULT_CONFIG.contractIntervalMs) {
    state = tick(state, startMs + atMs);
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
      const projection = projectForTeam(state, teamId);
      for (const c of projection.myContracts.filter(c => c.status === "open" && c.task.kind !== "rps-duel")) {
        const op = buildClearingOp(c, projectForTeam(state, teamId).vault, projection.prime);
        if (!op) throw new Error("state footprint: unhandled individual Order");
        expect(validateOp(state, teamId, op)).toEqual({ ok: true });
        state = applyOp(state, teamId, op);
      }
    }
    // RPS writes two public artifacts per team. A budget that lets these
    // Orders expire measures an idle duel, not its maximum record footprint.
    for (const kind of ["rps-commit", "rps-open"] as const) {
      if (kind === "rps-open") {
        // The last active batch reserves predictions beside the nearly full ledger.
        if (atMs > DEFAULT_CONFIG.matchDurationMs - DEFAULT_CONFIG.contractIntervalMs * 2 && state.phase !== "ended") {
          for (const teamId of teamIds) {
            const op={kind:"rotate" as const};
            if(validateOp(state,teamId,op).ok) state=applyOp(state,teamId,op);
          }
        }
        for (const c of state.contracts.filter(c=>c.status==="open"&&c.task.kind==="rps-duel")) {
          for (const hunter of teamIds) {
            if(hunter===c.teamId || (state.huntAttempts[storedHuntKey(state,huntKey(hunter,c.teamId,state.teams[c.teamId]!.generation))]??0)>=state.config.maxHuntAttemptsPerTarget) continue;
            const op={kind:"hunt-rps" as const,targetTeamId:c.teamId,duelId:(c.task as {duelId:string}).duelId,predictedHand:1};
            if(validateOp(state,hunter,op).ok) state=applyOp(state,hunter,op);
          }
        }
      }
      peak=Math.max(peak,Buffer.byteLength(JSON.stringify(state)));
      pendingPeak=Math.max(pendingPeak,state.contracts.reduce((n,c)=>n+Object.keys(c.rps?.predictions??{}).length,0));
      for (const teamId of teamIds) {
      for (const c of state.contracts.filter(c => c.teamId === teamId && c.status === "open" && c.task.kind === "rps-duel")) {
        const op = kind === "rps-commit" ? { kind, contractId: c.id, commitment: 13 } : { kind, contractId: c.id, hand: 1, randomness: 1 };
        expect(validateOp(state, teamId, op)).toEqual({ ok: true });
        state = applyOp(state, teamId, op);
      }
    }
    }
  }
  peak = Math.max(peak, Buffer.byteLength(JSON.stringify(state), "utf8"));
  return { state, peak, pendingPeak };
}

function playFullMatch(teamCount: number) { return measured(teamCount).state; }

describe("a full match's persisted state fits the backend that has to hold it", () => {
  test(`a ${PLATFORM_MAX_TEAMS}-team match — the platform's maximum — stays well inside a Turso row`, () => {
    // [Issue #659] The assertion the storage model exists for. Measured before
    // it: 4.49 MB, 45.4 KB per team, of which Orders were 72% — 10,692 of them,
    // almost all long dead. A 4.5 MB read-modify-write per click is broken on
    // any backend, and it put the supported maximum at six teams against a
    // platform that sells ninety-nine.
    expect(playWorstCase(PLATFORM_MAX_TEAMS)).toBeLessThan(TURSO_BUDGET_BYTES);
    expect(measured(PLATFORM_MAX_TEAMS).pendingPeak).toBe((PLATFORM_MAX_TEAMS - 1) ** 2);
  }, HEAVY_TEST_TIMEOUT_MS);

  test("the supported range stays near the per-team budget despite pairwise predictions", () => {
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
   * team that plays. At 99 teams it is 54.0% of the row (`ledger-codec.ts`,
   * Issue #679, shrank it from 65.7% by shortening its persisted keys -- see
   * this file's header). No encoding removes its CONTENT: pruning it would
   * delete the thing the game is about, and `contracts` alone (389.7 KB) is
   * already past this test's budget on its own -- see below.
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
    while (ddbMaxTeams < PLATFORM_MAX_TEAMS && playWorstCase(ddbMaxTeams + 1) < budget) ddbMaxTeams += 1;

    // Pin both sides of the measured boundary. Lossless schema-4 storage
    // recovers capacity while the fixture now includes pairwise HUNT moves.
    expect(ddbMaxTeams).toBe(11);
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
    const perTeam = state.contracts.filter((c) => c.teamId === "0".repeat(26)).length;
    expect(perTeam).toBeGreaterThan(0);
    expect(perTeam).toBeLessThanOrEqual(
      DEFAULT_CONFIG.contractsPerIssue * (TERMINAL_ORDER_RETENTION_BATCHES + 2),
    );
  });
});

/**
 * [Issue #3169] The declaration in `metadata.json`, kept true by measurement.
 *
 * The platform refuses to deploy an event whose team count cannot fit the
 * selected backend, and it decides that from `interTeamCoordination.stateBudget`
 * — two numbers this repository writes down. A written-down number rots: the
 * game grows, the declaration does not, and the platform then admits an event
 * that stops mid-match, which is the exact failure the check exists to prevent.
 *
 * So the declaration is re-derived here from the same worst-case match the rest
 * of this file measures. If the game grows, this fails and the number has to be
 * updated deliberately — which is the point.
 */
describe("the state budget this Battle declares to the platform", () => {
  /**
   * Read rather than imported: an import attribute (`with { type: "json" }`)
   * needs a newer `module` setting than this package's tsconfig uses, and
   * loosening the tsconfig to import one file would be the wrong trade.
   */
  const metadata: { interTeamCoordination?: { stateBudget?: unknown } } = JSON.parse(
    readFileSync(join(import.meta.dir, "..", "..", "metadata.json"), "utf8"),
  );
  const declared = metadata.interTeamCoordination?.stateBudget as
    | { bytesPerTeam: number; baseBytes: number }
    | undefined;

  test("is declared at all, because an undeclared problem is never checked", () => {
    expect(declared).toBeDefined();
  });

  test("still matches a re-measured worst case", () => {
    // RPS predictions are pairwise. Declare from the measured peak at the
    // maximum roster, then check supported small sizes independently below.
    const large = playWorstCase(PLATFORM_MAX_TEAMS);
    const perTeam = large / PLATFORM_MAX_TEAMS;
    const base = playWorstCase(4) - perTeam * 4;

    expect(declared).toBeDefined();
    if (!declared) return;
    // Within 5%: the declaration is a deployment gate, not a checksum, and a
    // exact-equality assertion would fail on a one-byte wording change in a
    // hint. Wide enough to survive that, tight enough that a real change to how
    // the match grows lands here.
    expect(declared.bytesPerTeam).toBeGreaterThan(perTeam * 0.95);
    expect(declared.bytesPerTeam).toBeLessThan(perTeam * 1.05);
    expect(declared.baseBytes).toBeLessThan(Math.max(base * 1.5, 4096));
  }, HEAVY_TEST_TIMEOUT_MS);

  test("forecasts the real 99-team row rather than under-reporting it", () => {
    // The direction that matters. A forecast BELOW the truth is what lets the
    // platform admit an event that then dies; above it only costs an operator
    // teams they could have had.
    expect(declared).toBeDefined();
    if (!declared) return;
    const forecast = declared.baseBytes + declared.bytesPerTeam * PLATFORM_MAX_TEAMS;
    expect(forecast).toBeGreaterThanOrEqual(playWorstCase(PLATFORM_MAX_TEAMS));
    for (const n of [2,4,8,9,10,11]) expect(declared.baseBytes + declared.bytesPerTeam * n).toBeGreaterThanOrEqual(playWorstCase(n));
  }, HEAVY_TEST_TIMEOUT_MS);
});
