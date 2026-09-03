/**
 * The 8 adversarial properties from Issue #486 PR1, each its own independent
 * test (not shared setup) so a single regression names exactly one property.
 * Unit-level correctness (field ops, Shamir round trip, prng/fixtures
 * determinism) lives in the sibling *.test.ts files next to what they test;
 * this file is specifically the game-level adversarial contract.
 */

import { describe, expect, test } from "bun:test";
import { deriveFheInputKeys, deriveFhePlaintexts } from "./fhe.ts";
import { deriveMpcPrivateInputs } from "./mpc.ts";
import { SUBSTRING_SAFE_FIELD, buildFheOp, buildLeakOp, buildMpcOp, proveThroughExchange, startedMatch } from "./playtest.ts";
import { completeShares, reconstruct, type Share } from "./shamir.ts";
import { decodeLedger } from "./ledger-codec.ts";
import { applyOp, initialState, projectForTeam, tick, validateOp } from "./reducer.ts";
import type { CryptoBattleOp, CryptoBattleState, PublicArtifact, ShareArtifact } from "./types.ts";

const P101 = 101n;

function ctx(eventId: string, teamIds: readonly string[] = ["teamA", "teamB"]) {
  return { eventId, teamIds };
}

/** Type-narrowing predicate: `PublicArtifact` is a `ShareArtifact | ProofArtifact` union since PR2 (PROVE artifacts). */
function isShareArtifact(a: PublicArtifact): a is ShareArtifact {
  return a.kind === "share";
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
        leakPoints: 10,
        task: { kind: "reveal-share" as const, shareIndices: [shareIndex] },
        issuedAtMs: state.nowMs ?? 0,
        expiresAtMs: (state.nowMs ?? 0) + state.config.contractTtlMs,
        status: "open",
        privacyConstraint: "none" as const,
        allowedMethods: ["leak", "prove"] as const,
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
  let state = tick(startedMatch(ctx("adv-2")), 0);
  const target = "teamA";
  const attacker = "teamB";

  // Drive real contract issuance/leak until teamA has leaked >= threshold
  // DISTINCT share indices -- bounded loop so a fixture regression that never
  // converges fails loudly instead of hanging.
  const GUARD_LIMIT = 200;
  let guard = 0;
  while (true) {
    const distinctIndices = new Set(
      decodeLedger(state.publicLedger)
        .filter((a) => a.teamId === target)
        .filter(isShareArtifact)
        .map((a) => a.shareIndex),
    );
    if (distinctIndices.size >= state.config.threshold) break;
    if (guard >= GUARD_LIMIT) {
      throw new Error("did not accumulate `threshold` distinct leaked shares within the guard bound");
    }
    // [Issue #645] This loop is accumulating LEAKED SHARES, so it wants the
    // Orders that can produce one: a share Order whose client permits raw
    // disclosure. The belt also carries PROVE-only, FHE and MPC Orders now, and
    // none of those puts a share on the ledger — which is exactly the property
    // the rest of this suite checks elsewhere.
    const open = state.contracts.find(
      (c) =>
        c.teamId === target &&
        c.status === "open" &&
        c.task.kind === "reveal-share" &&
        c.allowedMethods.includes("leak"),
    );
    state = open
      ? applyOp(state, target, { kind: "leak", contractId: open.id })
      : tick(state, (state.nowMs ?? 0) + state.config.contractIntervalMs);
    guard += 1;
  }

  const byIndex = new Map<number, Share>();
  for (const artifact of decodeLedger(state.publicLedger).filter((a) => a.teamId === target).filter(isShareArtifact)) {
    byIndex.set(artifact.shareIndex, { index: artifact.shareIndex, value: BigInt(artifact.value) });
  }
  const shares = [...byIndex.values()].slice(0, state.config.threshold);
  expect(shares).toHaveLength(state.config.threshold);

  const recoveredSecret = reconstruct(shares, BigInt(state.config.prime));
  const targetTeam = state.teams[target];
  if (!targetTeam) throw new Error("expected target team");
  expect(recoveredSecret).toBe(BigInt(targetTeam.secret));

  const op: CryptoBattleOp = {
    kind: "hunt",
    targetTeamId: target,
    generation: targetTeam.generation,
    recoveredSecret: recoveredSecret.toString(),
  };
  expect(validateOp(state, attacker, op)).toEqual({ ok: true });

  const attackerBefore = state.teams[attacker]?.score ?? 0;
  const targetBefore = targetTeam.score;
  const next = applyOp(state, attacker, op);
  expect(next.teams[attacker]?.score).toBe(attackerBefore + state.config.scores.huntBonus);
  expect(next.teams[target]?.score).toBe(Math.max(0, targetBefore - state.config.scores.huntPenalty));
});

test("adversarial 3: ROTATE invalidates old leaks -- mixed old+new generations do not reconstruct, and stale generation hunts are rejected", () => {
  let state = tick(startedMatch(ctx("adv-3")), 0);
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

  const ledgerAfterRotate = decodeLedger(state.publicLedger);
  const oldLeaks = ledgerAfterRotate
    .filter((a) => a.teamId === target && a.generation === 1)
    .filter(isShareArtifact);
  const newLeaks = ledgerAfterRotate
    .filter((a) => a.teamId === target && a.generation === 2)
    .filter(isShareArtifact);
  expect(oldLeaks).toHaveLength(2);
  expect(newLeaks).toHaveLength(1);

  const mixed: Share[] = [...oldLeaks, ...newLeaks].map((a) => ({ index: a.shareIndex, value: BigInt(a.value) }));
  const mixedReconstruction = reconstruct(mixed, BigInt(state.config.prime));
  const currentTeam = state.teams[target];
  if (!currentTeam) throw new Error("expected target team");
  expect(mixedReconstruction).not.toBe(BigInt(currentTeam.secret));

  // [Issue #696] A wrong value is no longer refused by `validateOp` -- it is a
  // move that lands and is charged. The claim this test makes is unchanged and
  // is now read off the RESULT: the mixed reconstruction does not unlock the
  // rotated generation, so no successful hunt is recorded and the attacker pays.
  const huntWithMixedGuess: CryptoBattleOp = {
    kind: "hunt",
    targetTeamId: target,
    generation: 2,
    recoveredSecret: mixedReconstruction.toString(),
  };
  const afterMixed = applyOp(state, attacker, huntWithMixedGuess);
  expect(afterMixed.successfulHunts).toEqual([]);
  expect(afterMixed.teams[target]?.huntedGenerations ?? []).toEqual([]);

  // Explicitly naming the stale generation is rejected regardless of value.
  const huntStaleGeneration: CryptoBattleOp = {
    kind: "hunt",
    targetTeamId: target,
    generation: 1,
    recoveredSecret: mixedReconstruction.toString(),
  };
  expect(validateOp(state, attacker, huntStaleGeneration).ok).toBe(false);

  // Once 3 clean shares of the NEW generation are leaked, the hunt succeeds.
  state = leakShareIndex(state, target, 4);
  state = leakShareIndex(state, target, 5);
  const cleanNewLeaks = decodeLedger(state.publicLedger)
    .filter((a) => a.teamId === target && a.generation === 2)
    .filter(isShareArtifact)
    .map((a) => ({ index: a.shareIndex, value: BigInt(a.value) }));
  expect(cleanNewLeaks.length).toBeGreaterThanOrEqual(state.config.threshold);
  const cleanRecovered = reconstruct(cleanNewLeaks.slice(0, state.config.threshold), BigInt(state.config.prime));
  const huntClean: CryptoBattleOp = {
    kind: "hunt",
    targetTeamId: target,
    generation: 2,
    recoveredSecret: cleanRecovered.toString(),
  };
  expect(validateOp(state, attacker, huntClean)).toEqual({ ok: true });
});

test("adversarial 4: a successful HUNT cannot be replayed for the same (attacker, target, generation)", () => {
  let state = tick(startedMatch(ctx("adv-4")), 0);
  const target = "teamA";
  const attacker = "teamB";
  for (let i = 1; i <= state.config.threshold; i += 1) {
    state = leakShareIndex(state, target, i);
  }
  const shares: Share[] = decodeLedger(state.publicLedger)
    .filter((a) => a.teamId === target)
    .filter(isShareArtifact)
    .slice(0, state.config.threshold)
    .map((a) => ({ index: a.shareIndex, value: BigInt(a.value) }));
  const recoveredSecret = reconstruct(shares, BigInt(state.config.prime));
  const op: CryptoBattleOp = {
    kind: "hunt",
    targetTeamId: target,
    generation: 1,
    recoveredSecret: recoveredSecret.toString(),
  };

  expect(validateOp(state, attacker, op)).toEqual({ ok: true });
  state = applyOp(state, attacker, op);

  // Same attacker, same target, same generation, same (correct!) secret -- still rejected.
  expect(validateOp(state, attacker, op).ok).toBe(false);
});

test("adversarial 5: projectForTeam never leaks another team's secret or shares", () => {
  // [Issue #696] Big field -- see SUBSTRING_SAFE_FIELD.
  let state = tick(startedMatch(ctx("adv-5"), SUBSTRING_SAFE_FIELD), 0);
  const target = "teamA";
  const observer = "teamB";
  // Leak a couple of teamA shares onto the PUBLIC ledger -- those are fine to
  // appear (they are public by construction). What must never appear is
  // teamA's *secret*, or a share value teamA never leaked.
  state = leakShareIndex(state, target, 1);

  const targetTeam = state.teams[target];
  if (!targetTeam) throw new Error("expected target team");
  const secretDecimal = targetTeam.secret;
  const unleakedShareValues = targetTeam.shares.filter((s) => s.index !== 1).map((s) => s.value);
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
    const state = tick(startedMatch(ctx("adv-6a")), 0);
    expect(validateOp(state, "teamA", { kind: "leak", contractId: "nope" }).ok).toBe(false);
  });

  test("leak: another team's contract", () => {
    const state = tick(startedMatch(ctx("adv-6b")), 0);
    const theirs = state.contracts.find((c) => c.teamId === "teamB");
    if (!theirs) throw new Error("expected a contract for teamB");
    expect(validateOp(state, "teamA", { kind: "leak", contractId: theirs.id }).ok).toBe(false);
  });

  test("leak: an already-expired contract", () => {
    let state = tick(startedMatch(ctx("adv-6c")), 0);
    const mine = state.contracts.find((c) => c.teamId === "teamA");
    if (!mine) throw new Error("expected a contract for teamA");
    state = tick(state, mine.expiresAtMs + 1);
    expect(state.contracts.find((c) => c.id === mine.id)?.status).toBe("expired");
    expect(validateOp(state, "teamA", { kind: "leak", contractId: mine.id }).ok).toBe(false);
  });

  test("hunt: cannot target your own team", () => {
    const state = tick(startedMatch(ctx("adv-6d")), 0);
    expect(
      validateOp(state, "teamA", { kind: "hunt", targetTeamId: "teamA", generation: 1, recoveredSecret: "0" })
        .ok,
    ).toBe(false);
  });

  test("rotate: rejected while on cooldown", () => {
    let state = tick(startedMatch(ctx("adv-6e")), 0);
    state = applyOp(state, "teamA", { kind: "rotate" });
    state = tick(state, state.config.rotateCooldownMs - 1);
    expect(validateOp(state, "teamA", { kind: "rotate" }).ok).toBe(false);
  });

  test("an unrecognized op kind is rejected, not thrown", () => {
    const state = tick(startedMatch(ctx("adv-6f")), 0);
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
  const frozen = deepFreeze(tick(startedMatch(ctx("adv-7")), 0));
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
    let state = startedMatch(ctx("adv-8"));
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

/**
 * [Issue #645] The consolidated trusted-material leak test.
 *
 * Every method now has a hidden half: LEAK/PROVE have the team's secret and
 * witness, FHE has plaintexts and a key, MPC has an input and four masks. This
 * plays one match through ALL FOUR and then asserts that none of that material
 * appears anywhere a participant can read — not on the Public Ledger, and not
 * in another team's projection.
 *
 * Written as one sweep over the derived values rather than four per-method
 * assertions so that a method added later is covered by construction: the
 * hidden material is enumerated from the Orders that were actually issued.
 */
test("adversarial 9: no trusted material reaches any participant-visible surface, for any method", () => {
  const matchSecret = "adversarial-9-server-only-match-secret";
  // [Issue #696] Big field -- see SUBSTRING_SAFE_FIELD.
  let state = tick(
    startedMatch({ eventId: "adv-9", teamIds: ["teamA", "teamB"], matchSecret }, SUBSTRING_SAFE_FIELD),
    0,
  );
  const prime = BigInt(state.config.prime);

  // Play every open Order for teamA by whichever method its task admits.
  for (let round = 0; round < 8; round += 1) {
    for (const order of projectForTeam(state, "teamA").myContracts) {
      if (order.status !== "open") continue;
      let op: CryptoBattleOp | undefined;
      if (order.task.kind === "reveal-share") {
        if (!order.allowedMethods.includes("leak")) {
          // [Issue #701] PROVE is an exchange, not a single op: commit, read
          // the challenge, respond. It cannot be expressed as one `op` in a
          // loop that applies one.
          state = proveThroughExchange(state, "teamA", order.id).state;
          continue;
        }
        op = buildLeakOp(order.id);
      } else if (order.task.kind === "homomorphic-sum") {
        op = buildFheOp(order, state.config.prime);
      } else {
        op = buildMpcOp(order, state.config.prime);
      }
      if (!op) continue;
      const verdict = validateOp(state, "teamA", op);
      if (!verdict.ok) throw new Error(`setup op rejected: ${verdict.error}`);
      state = applyOp(state, "teamA", op);
    }
    state = tick(state, (round + 1) * state.config.contractIntervalMs);
  }

  // Everything the trusted side holds and no participant may see.
  const teamA = state.teams.teamA;
  if (!teamA) throw new Error("expected teamA");
  const secrets: string[] = [teamA.secret];
  for (const order of state.contracts.filter((c) => c.teamId === "teamA")) {
    if (order.task.kind === "homomorphic-sum") {
      for (const key of deriveFheInputKeys(state.seed, order.id, prime)) {
        secrets.push(key.toString());
      }
      for (const plaintext of deriveFhePlaintexts(state.seed, order.id, prime)) {
        secrets.push(plaintext.toString());
      }
    }
    if (order.task.kind === "masked-total") {
      const inputs = deriveMpcPrivateInputs(state.seed, order.id, prime);
      secrets.push(inputs.myInput.toString());
      for (const mask of [...inputs.incomingMasks, ...inputs.outgoingMasks]) {
        secrets.push(mask.toString());
      }
    }
  }
  // Guard the guard: an empty or trivially-short list would make every
  // assertion below vacuously true.
  expect(secrets.length).toBeGreaterThan(6);
  for (const secret of secrets) expect(secret.length).toBeGreaterThan(4);

  const ledger = JSON.stringify(state.publicLedger);
  const otherTeamView = JSON.stringify(projectForTeam(state, "teamB"));
  // #652: the derivation root itself is server-only too. Keeping derived
  // values out is insufficient if a projection exposes the seed and lets the
  // participant recompute them from this public repository.
  expect(ledger).not.toContain(matchSecret);
  expect(otherTeamView).not.toContain(matchSecret);
  expect(otherTeamView).not.toContain(state.seed);
  for (const secret of secrets) {
    expect(ledger).not.toContain(secret);
    expect(otherTeamView).not.toContain(secret);
  }
});
