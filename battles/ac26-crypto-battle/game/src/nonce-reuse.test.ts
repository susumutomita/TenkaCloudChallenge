/**
 * [Issue #645 Phase 5] The nonce-reuse HUNT.
 *
 * #645's rule for HUNT is precise, and this file is where it is enforced:
 *
 * > 正しく使った ZK / FHE / MPC を「頑張って破れ」というゲームにはしない。
 * > 誤用・漏洩・手抜きを暗号知識で見抜くことを HUNT にする。
 *
 * So there are two halves to test. A team that used the shipped prover is not
 * huntable this way — not "hard to hunt", not huntable, because the evidence
 * the judge requires does not exist on the ledger. A team that rolled its own
 * prover and reused a nonce is, and the attacker's whole derivation runs off
 * public material.
 *
 * The careless prover below is deliberately NOT exported from the package. It
 * is the mistake, written out once so the consequence can be executed.
 */

import { describe, expect, test } from "bun:test";
import { inv, mod } from "./field.ts";
import { groupPow, RFC3526_GROUP14 } from "./group.ts";
import { buildNonceReuseHuntOp, buildProveOp } from "./playtest.ts";
import { applyOp, DEFAULT_CONFIG, initialState, projectForTeam, tick, validateOp } from "./reducer.ts";
import { computeChallenge } from "./schnorr-transcript.ts";
import { deriveWitness } from "./schnorr-witness.ts";
import type { Contract, CryptoBattleState, SchnorrProof } from "./types.ts";

const CTX = { eventId: "nonce-reuse-tests", teamIds: ["victim", "attacker"] } as const;
const VICTIM = "victim";
const ATTACKER = "attacker";

/**
 * A prover that reuses one nonce for every statement — the ac26-w3 mistake.
 *
 * Kept local to this test file on purpose: shipping it would be shipping a
 * footgun, and `schnorr-prover.ts` already documents why its own nonce is bound
 * to the contract id.
 */
function carelessProof(
  secret: bigint,
  generation: number,
  teamId: string,
  contractId: string,
  fixedNonce: bigint,
): SchnorrProof {
  const group = RFC3526_GROUP14;
  const witness = deriveWitness(secret, generation, teamId, group);
  const publicY = groupPow(group.generator, witness, group);
  const commitmentR = groupPow(group.generator, fixedNonce, group);
  const e = computeChallenge(
    { teamId, contractId, generation, commitmentR, publicY },
    group,
  );
  return {
    commitment: commitmentR.toString(),
    response: mod(fixedNonce + e * witness, group.order).toString(),
  };
}

/** Advance until the victim has `count` open share Orders it may PROVE. */
function shareOrdersFor(state: CryptoBattleState, teamId: string, count: number): {
  state: CryptoBattleState;
  orders: readonly Contract[];
} {
  let current = state;
  const found: Contract[] = [];
  for (let round = 0; round < 20 && found.length < count; round += 1) {
    for (const order of current.contracts) {
      if (found.some((o) => o.id === order.id)) continue;
      if (order.teamId !== teamId || order.status !== "open") continue;
      if (order.task.kind !== "reveal-share") continue;
      found.push(order);
      if (found.length === count) break;
    }
    if (found.length < count) {
      current = tick(current, (round + 1) * DEFAULT_CONFIG.contractIntervalMs);
    }
  }
  if (found.length < count) throw new Error(`only found ${found.length} share orders`);
  return { state: current, orders: found };
}

/** Play the victim into a state where it has posted two proofs sharing a nonce. */
function stateAfterCarelessProofs(): CryptoBattleState {
  let state = tick(initialState(CTX), 0);
  const { state: withOrders, orders } = shareOrdersFor(state, VICTIM, 2);
  state = withOrders;

  const vault = projectForTeam(state, VICTIM).vault;
  const FIXED_NONCE = 123_456_789n;
  for (const order of orders) {
    const proof = carelessProof(
      BigInt(vault.secret),
      vault.generation,
      VICTIM,
      order.id,
      FIXED_NONCE,
    );
    const op = { kind: "prove" as const, contractId: order.id, proof };
    // The proofs are individually VALID -- that is the point. Nonce reuse does
    // not make a proof fail verification; it makes the pair leak the witness.
    expect(validateOp(state, VICTIM, op)).toEqual({ ok: true });
    state = applyOp(state, VICTIM, op);
  }
  return state;
}

describe("nonce reuse is a real, and really exploitable, mistake", () => {
  test("two careless proofs share a commitment, and each one verifies on its own", () => {
    const state = stateAfterCarelessProofs();
    const proofs = state.publicLedger.filter((a) => a.kind === "proof" && a.teamId === VICTIM);
    expect(proofs).toHaveLength(2);
    const commitments = new Set(proofs.map((a) => (a.kind === "proof" ? a.commitment : "")));
    expect(commitments.size).toBe(1);
  });

  test("the witness is recoverable from the ledger alone, and the HUNT is accepted", () => {
    const state = stateAfterCarelessProofs();
    // The attacker sees only its own projection.
    const attackerView = projectForTeam(state, ATTACKER);
    const op = buildNonceReuseHuntOp(attackerView, VICTIM);
    expect(op).toBeDefined();
    if (!op) throw new Error("unreachable");

    expect(validateOp(state, ATTACKER, op)).toEqual({ ok: true });

    const before = state.teams[ATTACKER]?.score ?? 0;
    const next = applyOp(state, ATTACKER, op);
    expect(next.teams[ATTACKER]?.score).toBe(before + state.config.scores.huntBonus);
    expect(next.teams[VICTIM]?.huntedGenerations).toContain(state.teams[VICTIM]?.generation ?? -1);
    expect(next.huntLog.at(-1)?.attackerTeamId).toBe(ATTACKER);
  });

  test("the recovered value really is the discrete log behind the victim's public commitment", () => {
    const state = stateAfterCarelessProofs();
    const op = buildNonceReuseHuntOp(projectForTeam(state, ATTACKER), VICTIM);
    if (!op || op.kind !== "hunt-nonce") throw new Error("expected a hunt-nonce op");

    const group = RFC3526_GROUP14;
    const publicY = state.publicCommitments[VICTIM];
    if (publicY === undefined) throw new Error("expected a public commitment for the victim");
    expect(groupPow(group.generator, BigInt(op.recoveredWitness), group).toString()).toBe(publicY);
  });
});

describe("a team that used the shipped prover cannot be hunted this way", () => {
  test("no two of its transcripts share a commitment, so no evidence exists", () => {
    let state = tick(initialState(CTX), 0);
    const { state: withOrders, orders } = shareOrdersFor(state, VICTIM, 2);
    state = withOrders;
    for (const order of orders) {
      const vault = projectForTeam(state, VICTIM).vault;
      state = applyOp(state, VICTIM, buildProveOp(vault, order.id));
    }

    const proofs = state.publicLedger.filter((a) => a.kind === "proof" && a.teamId === VICTIM);
    expect(proofs.length).toBeGreaterThanOrEqual(2);
    const commitments = new Set(proofs.map((a) => (a.kind === "proof" ? a.commitment : "")));
    expect(commitments.size).toBe(proofs.length);

    expect(buildNonceReuseHuntOp(projectForTeam(state, ATTACKER), VICTIM)).toBeUndefined();
  });

  /**
   * The load-bearing test for #645's HUNT principle. Even an attacker who
   * somehow obtained the correct witness — by any means outside the game —
   * cannot spend it against a team that did nothing wrong, because the judge
   * requires the misuse to be on the public record.
   */
  test("even a correct witness is refused when the target never reused a nonce", () => {
    let state = tick(initialState(CTX), 0);
    const { state: withOrders, orders } = shareOrdersFor(state, VICTIM, 1);
    state = withOrders;
    const order = orders[0];
    if (!order) throw new Error("expected an order");
    const vault = projectForTeam(state, VICTIM).vault;
    state = applyOp(state, VICTIM, buildProveOp(vault, order.id));

    const witness = deriveWitness(
      BigInt(vault.secret),
      vault.generation,
      VICTIM,
      RFC3526_GROUP14,
    );
    const verdict = validateOp(state, ATTACKER, {
      kind: "hunt-nonce",
      targetTeamId: VICTIM,
      generation: vault.generation,
      recoveredWitness: witness.toString(),
    });
    expect(verdict.ok).toBe(false);
    if (verdict.ok) throw new Error("unreachable");
    expect(verdict.error).toContain("has not reused a proof commitment");
  });
});

describe("the nonce-reuse HUNT obeys the same rules as every other hunt", () => {
  test("a wrong witness is refused even when the reuse is real", () => {
    const state = stateAfterCarelessProofs();
    const verdict = validateOp(state, ATTACKER, {
      kind: "hunt-nonce",
      targetTeamId: VICTIM,
      generation: state.teams[VICTIM]?.generation ?? 0,
      recoveredWitness: "12345",
    });
    expect(verdict.ok).toBe(false);
    if (verdict.ok) throw new Error("unreachable");
    expect(verdict.error).toContain("does not match the target's public commitment");
  });

  test("a malformed witness is rejected, not thrown on", () => {
    const state = stateAfterCarelessProofs();
    for (const recoveredWitness of ["", "-1", "abc"]) {
      const verdict = validateOp(state, ATTACKER, {
        kind: "hunt-nonce",
        targetTeamId: VICTIM,
        generation: state.teams[VICTIM]?.generation ?? 0,
        recoveredWitness,
      });
      expect(verdict.ok).toBe(false);
      if (verdict.ok) throw new Error("unreachable");
      expect(verdict.error).toContain("canonical");
    }
  });

  test("hunting your own team is refused", () => {
    const state = stateAfterCarelessProofs();
    const op = buildNonceReuseHuntOp(projectForTeam(state, ATTACKER), VICTIM);
    if (!op || op.kind !== "hunt-nonce") throw new Error("expected a hunt-nonce op");

    const verdict = validateOp(state, VICTIM, { ...op, targetTeamId: VICTIM });
    expect(verdict.ok).toBe(false);
    if (verdict.ok) throw new Error("unreachable");
    expect(verdict.error).toContain("cannot hunt your own team");
  });

  test("the same generation cannot be hunted twice by the same attacker", () => {
    const state = stateAfterCarelessProofs();
    const op = buildNonceReuseHuntOp(projectForTeam(state, ATTACKER), VICTIM);
    if (!op) throw new Error("expected a hunt-nonce op");
    const next = applyOp(state, ATTACKER, op);

    const verdict = validateOp(next, ATTACKER, op);
    expect(verdict.ok).toBe(false);
    if (verdict.ok) throw new Error("unreachable");
    expect(verdict.error).toContain("already hunted");
  });

  test("a stale generation is refused after the victim rotates", () => {
    const state = stateAfterCarelessProofs();
    const op = buildNonceReuseHuntOp(projectForTeam(state, ATTACKER), VICTIM);
    if (!op) throw new Error("expected a hunt-nonce op");

    const rotated = applyOp(state, VICTIM, { kind: "rotate" });
    const verdict = validateOp(rotated, ATTACKER, op);
    expect(verdict.ok).toBe(false);
    if (verdict.ok) throw new Error("unreachable");
    expect(verdict.error).toContain("not");
  });
});

describe("the recovery arithmetic itself", () => {
  test("two responses under one nonce solve for the witness", () => {
    const group = RFC3526_GROUP14;
    const witness = 987_654_321n;
    const nonce = 42n;
    const e1 = 7n;
    const e2 = 19n;
    const z1 = mod(nonce + e1 * witness, group.order);
    const z2 = mod(nonce + e2 * witness, group.order);

    const recovered = mod(
      mod(z1 - z2, group.order) * inv(mod(e1 - e2, group.order), group.order),
      group.order,
    );
    expect(recovered).toBe(witness);
  });
});
