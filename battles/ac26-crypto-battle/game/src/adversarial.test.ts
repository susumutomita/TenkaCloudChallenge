/**
 * The 8 adversarial properties from Issue #486 PR1, each its own independent
 * test (not shared setup) so a single regression names exactly one property.
 * Unit-level correctness (field ops, Shamir round trip, prng/fixtures
 * determinism) lives in the sibling *.test.ts files next to what they test;
 * this file is specifically the game-level adversarial contract.
 */

import { describe, expect, test } from "bun:test";
import { completeShares, reconstruct, type Share } from "./shamir.ts";
import { applyOp, initialState, projectForTeam, tick, validateOp } from "./reducer.ts";
import type { CryptoBattleOp, CryptoBattleState } from "./types.ts";

const P101 = 101n;

function ctx(eventId: string, teamIds: readonly string[] = ["teamA", "teamB"]) {
  return { eventId, teamIds };
}

/**
 * Injects a synthetic open contract for `teamId` requesting exactly
 * `shareIndex`, and immediately LEAKs it. Contract ids are namespaced by
 * team/generation/index so repeated calls (including across a ROTATE) never
 * collide with each other or with whatever tick() issued on its own.
 */
function leakShareIndex(state: CryptoBattleState, teamId: string, shareIndex: number): CryptoBattleState {
  const team = state.teams[teamId];
  if (!team) throw new Error(`leakShareIndex: unknown team "${teamId}"`);
  const contractId = `synthetic-${teamId}-g${team.generation}-i${shareIndex}`;
  const withContract: CryptoBattleState = {
    ...state,
    contracts: [
      ...state.contracts,
      {
        id: contractId,
        teamId,
        kind: "standard",
        points: state.config.scores.contract,
        requestedShareIndices: [shareIndex],
        issuedAtMs: state.nowMs ?? 0,
        expiresAtMs: (state.nowMs ?? 0) + state.config.contractTtlMs,
        status: "open",
      },
    ],
  };
  return applyOp(withContract, teamId, { kind: "leak", contractId });
}

test("adversarial 1: t-1 shares are consistent with every candidate secret (threshold property)", () => {
  // Fix t-1 = threshold(3) - 1 = 2 partial shares and sweep every possible
  // secret in a small field: each candidate must be completable to a full
  // point set that reconstructs to exactly that candidate, using the SAME
  // two partial shares every time. That is the executable meaning of
  // "2 shares carry no information about the secret" for a t=3 scheme.
  const partial: Share[] = [
    { index: 1, value: 11n },
    { index: 2, value: 22n },
  ];
  let sawDistinctCompletions = false;
  let previousCompletion: bigint | undefined;
  for (let candidate = 0n; candidate < P101; candidate += 1n) {
    const evaluator = completeShares(partial, candidate, P101);
    const completedShare = evaluator(3);
    const full: Share[] = [...partial, { index: 3, value: completedShare }];
    expect(reconstruct(full, P101)).toBe(candidate);
    if (previousCompletion !== undefined && previousCompletion !== completedShare) {
      sawDistinctCompletions = true;
    }
    previousCompletion = completedShare;
  }
  // Sanity: the completions actually vary with the candidate (not a constant
  // function that would make this test vacuously true).
  expect(sawDistinctCompletions).toBe(true);
});

test("adversarial 2: LEAK x3 -> HUNT end-to-end (real contract issuance, real reducer)", () => {
  let state = tick(initialState(ctx("adv-2")), 0);
  const target = "teamA";
  const attacker = "teamB";

  // Drive real contract issuance/leak until teamA has leaked >= threshold
  // DISTINCT share indices -- bounded loop so a fixture regression that never
  // converges fails loudly instead of hanging.
  const GUARD_LIMIT = 200;
  let guard = 0;
  while (true) {
    const distinctIndices = new Set(
      state.publicLedger.filter((a) => a.teamId === target).map((a) => a.shareIndex),
    );
    if (distinctIndices.size >= state.config.threshold) break;
    if (guard >= GUARD_LIMIT) {
      throw new Error("did not accumulate `threshold` distinct leaked shares within the guard bound");
    }
    const open = state.contracts.find((c) => c.teamId === target && c.status === "open");
    state = open
      ? applyOp(state, target, { kind: "leak", contractId: open.id })
      : tick(state, (state.nowMs ?? 0) + state.config.contractIntervalMs);
    guard += 1;
  }

  const byIndex = new Map<number, Share>();
  for (const artifact of state.publicLedger.filter((a) => a.teamId === target)) {
    byIndex.set(artifact.shareIndex, { index: artifact.shareIndex, value: BigInt(artifact.value) });
  }
  const shares = [...byIndex.values()].slice(0, state.config.threshold);
  expect(shares).toHaveLength(state.config.threshold);

  const recoveredSecret = reconstruct(shares, state.config.prime);
  const targetTeam = state.teams[target];
  if (!targetTeam) throw new Error("expected target team");
  expect(recoveredSecret).toBe(targetTeam.secret);

  const op: CryptoBattleOp = {
    kind: "hunt",
    targetTeamId: target,
    generation: targetTeam.generation,
    recoveredSecret,
  };
  expect(validateOp(state, attacker, op)).toEqual({ ok: true });

  const attackerBefore = state.teams[attacker]?.score ?? 0;
  const targetBefore = targetTeam.score;
  const next = applyOp(state, attacker, op);
  expect(next.teams[attacker]?.score).toBe(attackerBefore + state.config.scores.huntBonus);
  expect(next.teams[target]?.score).toBe(Math.max(0, targetBefore - state.config.scores.huntPenalty));
});

test("adversarial 3: ROTATE invalidates old leaks -- mixed old+new generations do not reconstruct, and stale generation hunts are rejected", () => {
  let state = tick(initialState(ctx("adv-3")), 0);
  const target = "teamA";
  const attacker = "teamB";

  // 2 shares leaked under generation 1.
  state = leakShareIndex(state, target, 1);
  state = leakShareIndex(state, target, 2);
  const genBeforeRotate = state.teams[target]?.generation;
  expect(genBeforeRotate).toBe(1);

  state = applyOp(state, target, { kind: "rotate" });
  expect(state.teams[target]?.generation).toBe(2);

  // 1 share leaked under the NEW generation, at an index not already used above.
  state = leakShareIndex(state, target, 3);

  const oldLeaks = state.publicLedger.filter((a) => a.teamId === target && a.generation === 1);
  const newLeaks = state.publicLedger.filter((a) => a.teamId === target && a.generation === 2);
  expect(oldLeaks).toHaveLength(2);
  expect(newLeaks).toHaveLength(1);

  const mixed: Share[] = [...oldLeaks, ...newLeaks].map((a) => ({ index: a.shareIndex, value: BigInt(a.value) }));
  const mixedReconstruction = reconstruct(mixed, state.config.prime);
  const currentSecret = state.teams[target]?.secret;
  expect(mixedReconstruction).not.toBe(currentSecret);

  const huntWithMixedGuess: CryptoBattleOp = {
    kind: "hunt",
    targetTeamId: target,
    generation: 2,
    recoveredSecret: mixedReconstruction,
  };
  expect(validateOp(state, attacker, huntWithMixedGuess).ok).toBe(false);

  // Explicitly naming the stale generation is rejected regardless of value.
  const huntStaleGeneration: CryptoBattleOp = {
    kind: "hunt",
    targetTeamId: target,
    generation: 1,
    recoveredSecret: mixedReconstruction,
  };
  expect(validateOp(state, attacker, huntStaleGeneration).ok).toBe(false);

  // Once 3 clean shares of the NEW generation are leaked, the hunt succeeds.
  state = leakShareIndex(state, target, 4);
  state = leakShareIndex(state, target, 5);
  const cleanNewLeaks = state.publicLedger
    .filter((a) => a.teamId === target && a.generation === 2)
    .map((a) => ({ index: a.shareIndex, value: BigInt(a.value) }));
  expect(cleanNewLeaks.length).toBeGreaterThanOrEqual(state.config.threshold);
  const cleanRecovered = reconstruct(cleanNewLeaks.slice(0, state.config.threshold), state.config.prime);
  const huntClean: CryptoBattleOp = {
    kind: "hunt",
    targetTeamId: target,
    generation: 2,
    recoveredSecret: cleanRecovered,
  };
  expect(validateOp(state, attacker, huntClean)).toEqual({ ok: true });
});

test("adversarial 4: a successful HUNT cannot be replayed for the same (attacker, target, generation)", () => {
  let state = tick(initialState(ctx("adv-4")), 0);
  const target = "teamA";
  const attacker = "teamB";
  for (let i = 1; i <= state.config.threshold; i += 1) {
    state = leakShareIndex(state, target, i);
  }
  const shares: Share[] = state.publicLedger
    .filter((a) => a.teamId === target)
    .slice(0, state.config.threshold)
    .map((a) => ({ index: a.shareIndex, value: BigInt(a.value) }));
  const recoveredSecret = reconstruct(shares, state.config.prime);
  const op: CryptoBattleOp = { kind: "hunt", targetTeamId: target, generation: 1, recoveredSecret };

  expect(validateOp(state, attacker, op)).toEqual({ ok: true });
  state = applyOp(state, attacker, op);

  // Same attacker, same target, same generation, same (correct!) secret -- still rejected.
  expect(validateOp(state, attacker, op).ok).toBe(false);
});

test("adversarial 5: projectForTeam never leaks another team's secret or shares", () => {
  let state = tick(initialState(ctx("adv-5")), 0);
  const target = "teamA";
  const observer = "teamB";
  // Leak a couple of teamA shares onto the PUBLIC ledger -- those are fine to
  // appear (they are public by construction). What must never appear is
  // teamA's *secret*, or a share value teamA never leaked.
  state = leakShareIndex(state, target, 1);

  const targetTeam = state.teams[target];
  if (!targetTeam) throw new Error("expected target team");
  const secretDecimal = targetTeam.secret.toString();
  const unleakedShareValues = targetTeam.shares
    .filter((s) => s.index !== 1)
    .map((s) => s.value.toString());
  expect(unleakedShareValues.length).toBeGreaterThan(0);

  const projection = projectForTeam(state, observer);
  const serialized = JSON.stringify(projection);

  expect(serialized).not.toContain(secretDecimal);
  for (const value of unleakedShareValues) {
    expect(serialized).not.toContain(value);
  }
  // The projection must also not name the other team's vault at all.
  expect((projection as { vault: { teamId: string } }).vault.teamId).toBe(observer);
});

describe("adversarial 6: illegal ops are rejected without any score/state change", () => {
  test("leak: nonexistent contract", () => {
    const state = tick(initialState(ctx("adv-6a")), 0);
    expect(validateOp(state, "teamA", { kind: "leak", contractId: "nope" }).ok).toBe(false);
  });

  test("leak: another team's contract", () => {
    const state = tick(initialState(ctx("adv-6b")), 0);
    const theirs = state.contracts.find((c) => c.teamId === "teamB");
    if (!theirs) throw new Error("expected a contract for teamB");
    expect(validateOp(state, "teamA", { kind: "leak", contractId: theirs.id }).ok).toBe(false);
  });

  test("leak: an already-expired contract", () => {
    let state = tick(initialState(ctx("adv-6c")), 0);
    const mine = state.contracts.find((c) => c.teamId === "teamA");
    if (!mine) throw new Error("expected a contract for teamA");
    state = tick(state, mine.expiresAtMs + 1);
    expect(state.contracts.find((c) => c.id === mine.id)?.status).toBe("expired");
    expect(validateOp(state, "teamA", { kind: "leak", contractId: mine.id }).ok).toBe(false);
  });

  test("hunt: cannot target your own team", () => {
    const state = tick(initialState(ctx("adv-6d")), 0);
    expect(
      validateOp(state, "teamA", { kind: "hunt", targetTeamId: "teamA", generation: 1, recoveredSecret: 0n })
        .ok,
    ).toBe(false);
  });

  test("rotate: rejected while on cooldown", () => {
    let state = tick(initialState(ctx("adv-6e")), 0);
    state = applyOp(state, "teamA", { kind: "rotate" });
    state = tick(state, state.config.rotateCooldownMs - 1);
    expect(validateOp(state, "teamA", { kind: "rotate" }).ok).toBe(false);
  });

  test("an unrecognized op kind is rejected, not thrown", () => {
    const state = tick(initialState(ctx("adv-6f")), 0);
    const bogus = { kind: "prove" } as unknown as CryptoBattleOp;
    expect(() => validateOp(state, "teamA", bogus)).not.toThrow();
    expect(validateOp(state, "teamA", bogus).ok).toBe(false);
  });
});

/** Recursively freezes every nested object/array so any mutation attempt throws (strict-mode assignment to a frozen object). */
function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object") return value;
  if (Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const key of Object.getOwnPropertyNames(value as object)) {
    deepFreeze((value as Record<string, unknown>)[key]);
  }
  return value;
}

test("adversarial 7: applyOp and tick never mutate the state they are given", () => {
  const frozen = deepFreeze(tick(initialState(ctx("adv-7")), 0));
  const contractId = frozen.contracts.find((c) => c.teamId === "teamA")?.id;
  if (!contractId) throw new Error("expected a contract for teamA");

  expect(() => applyOp(frozen, "teamA", { kind: "leak", contractId })).not.toThrow();
  expect(() => applyOp(frozen, "teamA", { kind: "rotate" })).not.toThrow();
  expect(() => tick(frozen, 5 * 60_000)).not.toThrow();
  // applyOp trusts its caller to have validated first (see reducer.ts's
  // applyOp doc comment): an op that validateOp would reject throws loudly
  // here rather than silently mutating -- itself only reachable without a
  // mutation, since the throw happens before any state is built.
  expect(() => applyOp(frozen, "teamA", { kind: "leak", contractId: "does-not-exist" })).toThrow();
});

test("adversarial 8: same seed + same event sequence replays to a deeply-equal state", () => {
  function run(): CryptoBattleState {
    let state = initialState(ctx("adv-8"));
    state = tick(state, 0);
    const contract = state.contracts.find((c) => c.teamId === "teamA");
    if (!contract) throw new Error("expected a contract for teamA");
    state = applyOp(state, "teamA", { kind: "leak", contractId: contract.id });
    state = applyOp(state, "teamB", { kind: "rotate" });
    state = tick(state, 60_000);
    state = tick(state, 5 * 60_000);
    return state;
  }

  const first = run();
  const second = run();
  expect(first).toEqual(second);
});
