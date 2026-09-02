/**
 * Reducer-level integration tests for the PROVE op (Issue #486 PR2):
 * validateOp / applyOp wiring, invalid-proof / wrong-contract / replay /
 * wrong-generation rejection, secret non-leakage, and the Scoring MUST that
 * PROVE and LEAK pay identical points for an equal-value Contract. Unit
 * tests for the Schnorr primitives themselves (group, witness, transcript,
 * prover, verifier) live in schnorr.test.ts.
 *
 * Every `createProof` / `applyOp(prove)` call here costs a real 2048-bit
 * modular exponentiation (~13ms measured on this machine) -- this file
 * keeps its total op count modest for that reason (see schnorr.test.ts's
 * header for the same note).
 */

import { describe, expect, test } from "bun:test";
import { applyOp, initialState, projectForTeam, tick, validateOp } from "./reducer.ts";
import { createProof } from "./schnorr-prover.ts";
import { startedMatch } from "./playtest.ts";
import type { CryptoBattleState, CryptoBattleOp } from "./types.ts";

const CTX = { eventId: "prove-basic", teamIds: ["teamA", "teamB"] } as const;

describe("prove: happy path", () => {
  test("a valid proof completes the contract, pays the contract's points, and posts a proof (not a share) artifact", () => {
    const state = tick(startedMatch(CTX), 0);
    const contract = state.contracts.find((c) => c.teamId === "teamA");
    if (!contract) throw new Error("expected a contract for teamA");
    const team = state.teams.teamA;
    if (!team) throw new Error("expected teamA");

    const proof = createProof(BigInt(team.secret), team.generation, "teamA", contract.id);
    const op: CryptoBattleOp = { kind: "prove", contractId: contract.id, proof };

    expect(validateOp(state, "teamA", op)).toEqual({ ok: true });
    const next = applyOp(state, "teamA", op);

    expect(next.teams.teamA?.score).toBe(contract.points);
    expect(next.contracts.find((c) => c.id === contract.id)?.status).toBe("completed");
    expect(next.contracts.find((c) => c.id === contract.id)?.resolution).toBe("prove");
    expect(next.teams.teamA?.completedContractIds).toContain(contract.id);

    expect(next.publicLedger).toHaveLength(1);
    const posted = next.publicLedger[0];
    if (!posted) throw new Error("expected a posted artifact");
    expect(posted.kind).toBe("proof");
    if (posted.kind !== "proof") throw new Error("expected a proof artifact");
    expect(posted.teamId).toBe("teamA");
    expect(posted.contractId).toBe(contract.id);
    expect(posted.generation).toBe(1);
    expect(posted.commitment).toBe(proof.commitment);
    expect(posted.response).toBe(proof.response);
  });

  test("PROVE never adds a ShareArtifact to the public ledger, unlike LEAK", () => {
    const state = tick(startedMatch(CTX), 0);
    const contract = state.contracts.find((c) => c.teamId === "teamA");
    if (!contract) throw new Error("expected a contract for teamA");
    const team = state.teams.teamA;
    if (!team) throw new Error("expected teamA");

    const proof = createProof(BigInt(team.secret), team.generation, "teamA", contract.id);
    const next = applyOp(state, "teamA", { kind: "prove", contractId: contract.id, proof });

    expect(next.publicLedger.some((a) => a.kind === "share")).toBe(false);
  });
});

describe("prove: ProofArtifact normalization [independent review, low #4]", () => {
  test("a proof submitted with a leading zero (still /^\\d{1,700}$/-canonical and still numerically valid) is stored in the Public Ledger in normalized decimal form, not verbatim", () => {
    const state = tick(startedMatch(CTX), 0);
    const contract = state.contracts.find((c) => c.teamId === "teamA");
    if (!contract) throw new Error("expected a contract for teamA");
    const team = state.teams.teamA;
    if (!team) throw new Error("expected teamA");

    const proof = createProof(BigInt(team.secret), team.generation, "teamA", contract.id);
    // A leading zero doesn't violate schnorr-verifier.ts's `/^\d{1,700}$/`
    // format check, and BigInt("0" + x) === BigInt(x), so this still
    // verifies correctly -- it is exactly the kind of "not wrong, but not
    // the canonical form either" input applyProve's BigInt(...).toString()
    // round-trip guards against landing in the ledger unnormalized.
    const paddedProof = { commitment: `0${proof.commitment}`, response: `0${proof.response}` };
    expect(
      validateOp(state, "teamA", { kind: "prove", contractId: contract.id, proof: paddedProof }),
    ).toEqual({ ok: true });

    const next = applyOp(state, "teamA", { kind: "prove", contractId: contract.id, proof: paddedProof });
    const posted = next.publicLedger[0];
    if (!posted) throw new Error("expected a posted artifact");
    if (posted.kind !== "proof") throw new Error("expected a proof artifact");
    expect(posted.commitment).toBe(proof.commitment);
    expect(posted.response).toBe(proof.response);
    expect(posted.commitment.startsWith("0")).toBe(false);
    expect(posted.response.startsWith("0")).toBe(false);
  });
});

describe("prove: invalid proof is rejected", () => {
  test("a tampered response is rejected by validateOp and the contract stays open", () => {
    const state = tick(startedMatch(CTX), 0);
    const contract = state.contracts.find((c) => c.teamId === "teamA");
    if (!contract) throw new Error("expected a contract for teamA");
    const team = state.teams.teamA;
    if (!team) throw new Error("expected teamA");

    const proof = createProof(BigInt(team.secret), team.generation, "teamA", contract.id);
    const tampered = { ...proof, response: (BigInt(proof.response) + 1n).toString() };
    const result = validateOp(state, "teamA", { kind: "prove", contractId: contract.id, proof: tampered });
    expect(result.ok).toBe(false);
    expect(state.contracts.find((c) => c.id === contract.id)?.status).toBe("open");
  });

  test("a tampered commitment is rejected", () => {
    const state = tick(startedMatch(CTX), 0);
    const contract = state.contracts.find((c) => c.teamId === "teamA");
    if (!contract) throw new Error("expected a contract for teamA");
    const team = state.teams.teamA;
    if (!team) throw new Error("expected teamA");

    const proof = createProof(BigInt(team.secret), team.generation, "teamA", contract.id);
    const tampered = { ...proof, commitment: (BigInt(proof.commitment) + 1n).toString() };
    expect(validateOp(state, "teamA", { kind: "prove", contractId: contract.id, proof: tampered }).ok).toBe(false);
  });

  test("a proof built from another team's secret against this team's contract is rejected", () => {
    const state = tick(startedMatch(CTX), 0);
    const contract = state.contracts.find((c) => c.teamId === "teamA");
    if (!contract) throw new Error("expected a contract for teamA");
    const teamB = state.teams.teamB;
    if (!teamB) throw new Error("expected teamB");

    // teamB's own valid witness, submitted as if it proved teamA's contract.
    const wrongProof = createProof(BigInt(teamB.secret), teamB.generation, "teamA", contract.id);
    expect(validateOp(state, "teamA", { kind: "prove", contractId: contract.id, proof: wrongProof }).ok).toBe(
      false,
    );
  });
});

describe("prove: wrong-contract binding", () => {
  test("a proof created for contract A is rejected when submitted against contract B (Fiat-Shamir contractId binding)", () => {
    let state = tick(startedMatch(CTX), 0);
    const contractA = state.contracts.find((c) => c.teamId === "teamA");
    if (!contractA) throw new Error("expected a contract for teamA");
    // Advance to get a second, distinct open contract for teamA.
    state = tick(state, state.config.contractIntervalMs);
    const contractB = state.contracts.find((c) => c.teamId === "teamA" && c.id !== contractA.id);
    if (!contractB) throw new Error("expected a second contract for teamA");
    const team = state.teams.teamA;
    if (!team) throw new Error("expected teamA");

    const proofForA = createProof(BigInt(team.secret), team.generation, "teamA", contractA.id);
    const result = validateOp(state, "teamA", {
      kind: "prove",
      contractId: contractB.id,
      proof: proofForA,
    });
    expect(result.ok).toBe(false);
  });
});

describe("prove: replay", () => {
  test("submitting the same successful proof to the same contract a second time is rejected (contract already completed)", () => {
    const state = tick(startedMatch(CTX), 0);
    const contract = state.contracts.find((c) => c.teamId === "teamA");
    if (!contract) throw new Error("expected a contract for teamA");
    const team = state.teams.teamA;
    if (!team) throw new Error("expected teamA");

    const proof = createProof(BigInt(team.secret), team.generation, "teamA", contract.id);
    const op: CryptoBattleOp = { kind: "prove", contractId: contract.id, proof };
    expect(validateOp(state, "teamA", op)).toEqual({ ok: true });
    const next = applyOp(state, "teamA", op);

    // Exact same op, same proof, replayed against the now-completed contract.
    const replay = validateOp(next, "teamA", op);
    expect(replay.ok).toBe(false);
    if (!replay.ok) {
      expect(replay.error).toMatch(/completed/);
    }
  });
});

describe("prove: cross-resolution double-completion is rejected [independent review, low #6]", () => {
  // LEAK and PROVE share the exact same "status !== 'open'" guard in
  // validateOp -- these two tests pin the cross-resolution case directly
  // (a Contract completed by ONE method cannot then be completed by the
  // OTHER), rather than relying on it as an untested side effect of the
  // same-method replay tests above.

  test("a Contract already completed via PROVE cannot then be LEAKed", () => {
    const state = tick(startedMatch(CTX), 0);
    const contract = state.contracts.find((c) => c.teamId === "teamA");
    if (!contract) throw new Error("expected a contract for teamA");
    const team = state.teams.teamA;
    if (!team) throw new Error("expected teamA");

    const proof = createProof(BigInt(team.secret), team.generation, "teamA", contract.id);
    const provedState = applyOp(state, "teamA", { kind: "prove", contractId: contract.id, proof });
    expect(provedState.contracts.find((c) => c.id === contract.id)?.resolution).toBe("prove");

    const leakResult = validateOp(provedState, "teamA", { kind: "leak", contractId: contract.id });
    expect(leakResult.ok).toBe(false);
    if (!leakResult.ok) {
      expect(leakResult.error).toMatch(/completed/);
    }
    // No share ever gets published as a side effect of the rejected LEAK attempt.
    expect(provedState.publicLedger.some((a) => a.kind === "share")).toBe(false);
  });

  test("a Contract already completed via LEAK cannot then be PROVEn", () => {
    const state = tick(startedMatch(CTX), 0);
    const contract = state.contracts.find((c) => c.teamId === "teamA");
    if (!contract) throw new Error("expected a contract for teamA");
    const team = state.teams.teamA;
    if (!team) throw new Error("expected teamA");

    const leakedState = applyOp(state, "teamA", { kind: "leak", contractId: contract.id });
    expect(leakedState.contracts.find((c) => c.id === contract.id)?.resolution).toBe("leak");

    // A proof built against the now-leaked contract would verify on its own
    // cryptographic merits (the witness/statement binding is unaffected by
    // LEAK) -- it is the shared "contract must be open" guard, not proof
    // validity, that must reject this.
    const proof = createProof(BigInt(team.secret), team.generation, "teamA", contract.id);
    const proveResult = validateOp(leakedState, "teamA", { kind: "prove", contractId: contract.id, proof });
    expect(proveResult.ok).toBe(false);
    if (!proveResult.ok) {
      expect(proveResult.error).toMatch(/completed/);
    }
  });
});

describe("prove: wrong generation", () => {
  test("a proof bound to the pre-rotate generation fails post-rotate; a freshly-built post-rotate proof for the same contract succeeds", () => {
    let state = tick(startedMatch(CTX), 0);
    const preRotateTeam = state.teams.teamA;
    if (!preRotateTeam) throw new Error("expected teamA");
    const preRotateGeneration = preRotateTeam.generation;
    const preRotateSecret = preRotateTeam.secret;

    state = applyOp(state, "teamA", { kind: "rotate" });
    expect(state.teams.teamA?.generation).toBe(preRotateGeneration + 1);

    // Rotate voids every pre-rotate open contract for this team (see
    // reducer.ts's applyRotate) -- advance the clock to get a fresh open
    // contract under the NEW generation to submit the stale proof against.
    // [Issue #645] PROVE only answers a share Order, and the belt now also
    // carries FHE and MPC Orders -- so advance until a share Order appears
    // rather than assuming the next one is.
    const findShareOrder = (from: CryptoBattleState) =>
      from.contracts.find(
        (c) => c.teamId === "teamA" && c.status === "open" && c.task.kind === "reveal-share",
      );
    for (let round = 0; round < 8 && !findShareOrder(state); round += 1) {
      state = tick(state, (state.nowMs ?? 0) + state.config.contractIntervalMs);
    }
    const postRotateContract = findShareOrder(state);
    if (!postRotateContract) throw new Error("expected a fresh open contract for teamA after rotate");

    // Attacker who captured the pre-rotate secret, still trying to prove
    // against the NEW contract with the OLD generation's witness.
    const staleProof = createProof(BigInt(preRotateSecret), preRotateGeneration, "teamA", postRotateContract.id);
    const staleResult = validateOp(state, "teamA", {
      kind: "prove",
      contractId: postRotateContract.id,
      proof: staleProof,
    });
    expect(staleResult.ok).toBe(false);

    // The SAME contract, proven honestly with the post-rotate secret/generation, succeeds.
    const postRotateTeam = state.teams.teamA;
    if (!postRotateTeam) throw new Error("expected teamA");
    const freshProof = createProof(
      BigInt(postRotateTeam.secret),
      postRotateTeam.generation,
      "teamA",
      postRotateContract.id,
    );
    const freshResult = validateOp(state, "teamA", {
      kind: "prove",
      contractId: postRotateContract.id,
      proof: freshProof,
    });
    expect(freshResult).toEqual({ ok: true });
  });
});

describe("prove: secret non-leakage", () => {
  test("the ledger artifact and another team's projection never contain the secret, witness, or any share value after a PROVE", () => {
    const state = tick(startedMatch(CTX), 0);
    const contract = state.contracts.find((c) => c.teamId === "teamA");
    if (!contract) throw new Error("expected a contract for teamA");
    const team = state.teams.teamA;
    if (!team) throw new Error("expected teamA");

    const secretDecimal = team.secret;
    const shareValues = team.shares.map((s) => s.value);

    const proof = createProof(BigInt(team.secret), team.generation, "teamA", contract.id);
    const next = applyOp(state, "teamA", { kind: "prove", contractId: contract.id, proof });

    const ledgerJson = JSON.stringify(next.publicLedger);
    expect(ledgerJson).not.toContain(secretDecimal);
    for (const shareValue of shareValues) {
      expect(ledgerJson).not.toContain(shareValue);
    }
    // The proof transcript IS allowed to appear -- it is public by design.
    expect(ledgerJson).toContain(proof.commitment);
    expect(ledgerJson).toContain(proof.response);

    const observerProjection = projectForTeam(next, "teamB");
    const projectionJson = JSON.stringify(observerProjection);
    expect(projectionJson).not.toContain(secretDecimal);
    for (const shareValue of shareValues) {
      expect(projectionJson).not.toContain(shareValue);
    }
    // teamA's public commitment Y is allowed (and expected) to appear.
    const teamAPublicCommitment = next.publicCommitments.teamA;
    if (!teamAPublicCommitment) throw new Error("expected a public commitment for teamA");
    expect(projectionJson).toContain(teamAPublicCommitment);
  });
});

/**
 * [Issue #659] PROVE must pay MORE than LEAK. This suite used to assert the
 * opposite ("equal pay"), which made LEAK strictly dominant: it costs no
 * computation, so an identical payout meant there was never a reason to work.
 * With equal pay a rational team leaks every Order, nothing is ever computed,
 * and the whole "compute or expose yourself" tension the Battle is built on
 * does not exist.
 */
describe("prove: Scoring MUST -- PROVE pays MORE than LEAK for the same Order", () => {
  test("completing one contract via LEAK and an equal-points contract via PROVE yields DIFFERENT score deltas", () => {
    let state = tick(startedMatch(CTX), 0);
    const leakContract = state.contracts.find((c) => c.teamId === "teamA");
    if (!leakContract) throw new Error("expected a contract for teamA");

    // A second, equal-value synthetic contract for teamA to complete via
    // PROVE instead -- same points as the real issued contract, so any
    // score-delta difference can only come from the resolution method.
    const proveContract = {
      id: "synthetic-prove-teamA",
      teamId: "teamA",
      kind: "standard" as const,
      points: leakContract.points,
      leakPoints: 10,
      task: leakContract.task,
      issuedAtMs: state.nowMs ?? 0,
      expiresAtMs: (state.nowMs ?? 0) + state.config.contractTtlMs,
      status: "open" as const,
      privacyConstraint: "none" as const,
      allowedMethods: ["leak", "prove"] as const,
    };
    state = { ...state, contracts: [...state.contracts, proveContract] };

    const team = state.teams.teamA;
    if (!team) throw new Error("expected teamA");
    const scoreBefore = team.score;

    const afterLeak = applyOp(state, "teamA", { kind: "leak", contractId: leakContract.id });
    const leakDelta = (afterLeak.teams.teamA?.score ?? 0) - scoreBefore;

    const proof = createProof(BigInt(team.secret), team.generation, "teamA", proveContract.id);
    const afterProve = applyOp(state, "teamA", { kind: "prove", contractId: proveContract.id, proof });
    const proveDelta = (afterProve.teams.teamA?.score ?? 0) - scoreBefore;

    // The ordering the design rests on: doing the work pays more than not doing it.
    expect(proveDelta).toBeGreaterThan(leakDelta);
    expect(proveDelta).toBe(leakContract.points);
    expect(leakDelta).toBe(leakContract.leakPoints);
  });

  test("an Order carries both rates, so the trade is visible before it is made", () => {
    const state = tick(startedMatch(CTX), 0);
    const order = state.contracts.find((c) => c.teamId === "teamA");
    if (!order) throw new Error("expected a contract for teamA");
    // A participant choosing LEAK is giving up points, not just accepting risk.
    // Carrying both numbers on the Order is what makes that choice informed.
    expect(order.leakPoints).toBeLessThan(order.points);
    expect(order.leakPoints).toBe(state.config.scores.contractLeak);
  });
});

describe("prove: match end", () => {
  test("is rejected once the match has ended, even for a contract that is still open by its own TTL", () => {
    let state = tick(startedMatch(CTX), 0);
    const team = state.teams.teamA;
    if (!team) throw new Error("expected teamA");
    const stillOpenContract = {
      id: "synthetic-prove-still-open",
      teamId: "teamA",
      kind: "standard" as const,
      points: state.config.scores.contract,
      leakPoints: 10,
      task: { kind: "reveal-share" as const, shareIndices: [1] },
      issuedAtMs: state.nowMs ?? 0,
      expiresAtMs: (state.nowMs ?? 0) + state.config.contractTtlMs,
      status: "open" as const,
      privacyConstraint: "none" as const,
      allowedMethods: ["leak", "prove"] as const,
    };
    const proof = createProof(BigInt(team.secret), team.generation, "teamA", stillOpenContract.id);
    state = { ...state, contracts: [...state.contracts, stillOpenContract] };
    state = tick(state, state.config.matchDurationMs);
    expect(state.phase).toBe("ended");

    expect(
      validateOp(state, "teamA", { kind: "prove", contractId: stillOpenContract.id, proof }).ok,
    ).toBe(false);
  });
});
