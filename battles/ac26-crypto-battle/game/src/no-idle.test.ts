import { describe, expect, test } from "bun:test";
import { applyOp, DEFAULT_CONFIG, initialState, projectForTeam, tick, validateOp } from "./reducer.ts";
import { buildClearingOp } from "./playtest.ts";
import type { Contract, CryptoBattleOp, CryptoBattleState } from "./types.ts";

/**
 * [Issue #645] Clear one Order by whichever method its task admits.
 *
 * This test is about the ISSUE CADENCE, not about any one method: the question
 * is whether a team that clears its belt instantly is ever left waiting. So
 * "clear it" has to mean "answer it correctly, whatever it asks".
 *
 * [Issue #659] Delegated to `playtest.ts`'s exhaustive `buildClearingOp`. This
 * file used to carry its own copy, and when the ladder added a fourth task kind
 * that copy fell through to `buildMpcOp`, which returns `undefined` for a task
 * it cannot serve. Nothing failed -- `walkMatch(true)` just stopped clearing
 * about a fifth of the belt, so "the fastest possible team" was no longer the
 * fastest possible team and the idle window it exists to measure could not
 * appear. An exhaustive switch in one place makes a fifth task kind a compile
 * error instead.
 */
function clearingOpFor(
  state: CryptoBattleState,
  teamId: string,
  contract: Contract,
): CryptoBattleOp | undefined {
  const projection = projectForTeam(state, teamId);
  const projected = projection.myContracts.find((c) => c.id === contract.id);
  if (!projected) return undefined;
  return buildClearingOp(projected, projection.vault, state.config.prime);
}

/**
 * Issue #486 Gate 2 / Definition of Done: "90 分本戦で idle を発生させない
 * contract cadence がある".
 *
 * Gate 2's full claim has two halves. The half a test can decide is the
 * Contract lane: does the queue actually keep supplying work for the whole
 * 90 minutes, and how long is a team left with nothing in it? The other half
 * -- that Vault and Ledger still offer a meaningful choice while the Contract
 * lane is empty -- is a design property about what a player finds worth doing,
 * and no assertion here decides it. These tests pin the cadence so a later
 * tuning pass cannot silently open a hole in it.
 *
 * Everything below walks the real reducer clock rather than reasoning about
 * DEFAULT_CONFIG arithmetic, so a change to issuance, expiry, or phase
 * boundaries is caught even when the constants still look reasonable.
 */

const CTX = { eventId: "match-no-idle", teamIds: ["teamA", "teamB"] } as const;

/** 15 s: fine enough that a gap shorter than a quarter-minute cannot hide between samples. */
const SAMPLE_MS = 15_000;

function openContractsFor(state: CryptoBattleState, teamId: string) {
  return state.contracts.filter((c) => c.teamId === teamId && c.status === "open");
}

/**
 * Walk the whole match at `SAMPLE_MS` resolution.
 *
 * `clearImmediately` models the worst case for the supply side: a team so fast
 * it resolves every contract the moment it appears, which is the team most
 * likely to run out of work. Passing false models a team that never acts, which
 * is the worst case for the *expiry* side.
 */
function walkMatch(clearImmediately: boolean) {
  const config = DEFAULT_CONFIG;
  let state = tick(initialState(CTX), 0);
  const samples: { atMs: number; open: number; phase: string }[] = [];
  // [Issue #659] The final state is not a history -- resolved and lapsed Orders
  // are pruned from the persisted row past a short retention window. A question
  // about what the belt SUPPLIED has to be answered while it supplies it.
  const issued = new Map<string, Contract>();

  for (let atMs = 0; atMs <= config.matchDurationMs; atMs += SAMPLE_MS) {
    state = tick(state, atMs);
    for (const c of state.contracts) issued.set(c.id, c);
    samples.push({ atMs, open: openContractsFor(state, "teamA").length, phase: state.phase });
    if (clearImmediately) {
      for (const contract of openContractsFor(state, "teamA")) {
        const op = clearingOpFor(state, "teamA", contract);
        if (!op) continue;
        const verdict = validateOp(state, "teamA", op);
        if (!verdict.ok) throw new Error(`clearing op rejected: ${verdict.error}`);
        state = applyOp(state, "teamA", op);
      }
    }
  }
  return { samples, finalState: state, issued: [...issued.values()] };
}

/** Longest run of consecutive samples with an empty queue, in ms. */
function longestEmptyRunMs(samples: { open: number }[]) {
  let longest = 0;
  let current = 0;
  for (const sample of samples) {
    current = sample.open === 0 ? current + SAMPLE_MS : 0;
    if (current > longest) longest = current;
  }
  return longest;
}

describe("90-minute contract cadence leaves no idle window", () => {
  test("a team that never acts always has an open contract for as long as the match runs", () => {
    const { samples } = walkMatch(false);
    // The first tick issues immediately, so even t=0 is non-empty.
    //
    // [Issue #659] Sampled over the running match, not over the final instant.
    // Issuance stops at `matchEndAtMs` (`nextContractAtMs < matchEndAtMs` in
    // `tick`) and a batch lives exactly one interval, so the last batch lapses
    // at precisely `matchDurationMs` with nothing to replace it. That sample is
    // the match being over, not the queue starving -- asserted below rather
    // than filtered away silently.
    const running = samples.filter((s) => s.atMs < DEFAULT_CONFIG.matchDurationMs);
    expect(running.filter((s) => s.open === 0)).toEqual([]);
    const final = samples.filter((s) => s.atMs >= DEFAULT_CONFIG.matchDurationMs);
    expect(final.every((s) => s.phase === "ended")).toBe(true);
  });

  test("a team that clears every contract instantly waits at most one issue interval", () => {
    const { samples } = walkMatch(true);
    const longest = longestEmptyRunMs(samples);
    // This is the design's accepted Contract-lane gap: the fastest possible
    // team spends it on Vault or Ledger, which is exactly the tension Gate 2
    // asks for. It must never exceed the issue interval -- if it does, the
    // queue is starving rather than pacing.
    expect(longest).toBeLessThanOrEqual(DEFAULT_CONFIG.contractIntervalMs);
  });

  test("every phase issues contracts, so no phase is dead time", () => {
    const { issued } = walkMatch(false);
    const boundaries = DEFAULT_CONFIG.phaseBoundaries;
    const issuedIn = (fromMs: number, toMs: number) =>
      issued.filter((c) => c.teamId === "teamA" && c.issuedAtMs >= fromMs && c.issuedAtMs < toMs)
        .length;

    expect(issuedIn(0, boundaries.buildToPressureMs)).toBeGreaterThan(0);
    expect(issuedIn(boundaries.buildToPressureMs, boundaries.pressureToEndgameMs)).toBeGreaterThan(0);
    expect(issuedIn(boundaries.pressureToEndgameMs, DEFAULT_CONFIG.matchDurationMs)).toBeGreaterThan(0);
  });

  test("supply runs to the final minutes rather than stopping early", () => {
    const { issued } = walkMatch(false);
    const lastIssuedAtMs = Math.max(
      ...issued.filter((c) => c.teamId === "teamA").map((c) => c.issuedAtMs),
    );
    // Within one interval of the end: a team is still being handed work in the
    // closing minutes, which is what keeps the endgame a decision rather than a
    // countdown.
    expect(DEFAULT_CONFIG.matchDurationMs - lastIssuedAtMs).toBeLessThanOrEqual(
      DEFAULT_CONFIG.contractIntervalMs,
    );
  });

  test("a batch lives exactly one interval, so Orders can never be stockpiled", () => {
    // [Issue #659] This assertion is the REVERSE of what it pinned before, and
    // deliberately so. It used to require both TTLs to EXCEED the interval, so
    // that a passive team always had leftovers in the queue. Under #659 that
    // overlap is precisely the bug: leftovers are a backlog, and with a backlog
    // LEAK strictly beats PROVE at any point values, because leaking frees five
    // minutes that convert into another PROVE and the leak's points are pure
    // profit. "No prefetch" -- TTL exactly equal to the interval, so each batch
    // is fully replaced rather than accumulated -- is what closes that trade,
    // and it is what makes a fast team's spare time worth spending on HUNT.
    //
    // Idle is now prevented by batch SIZE instead: `contractsPerIssue` Orders
    // land together, so a team always has the current batch in front of it.
    expect(DEFAULT_CONFIG.contractTtlMs).toBe(DEFAULT_CONFIG.contractIntervalMs);
    expect(DEFAULT_CONFIG.contractsPerIssue).toBeGreaterThan(1);
    // Rush keeps a shorter fuse: it is voluntary, symmetric and visible up
    // front (unlike #659's rejected "cut the opponent's clock" item), and with
    // a batch behind it an early-expiring rush no longer empties the queue.
    expect(DEFAULT_CONFIG.rushContractTtlMs).toBeLessThan(DEFAULT_CONFIG.contractTtlMs);
  });
});
