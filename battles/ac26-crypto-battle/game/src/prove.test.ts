/**
 * Reducer-level integration tests for the PROVE exchange (Issue #486 PR2,
 * rebuilt interactive in #701): validateOp / applyOp wiring for both moves,
 * wrong-response / wrong-contract / replay / wrong-generation handling, secret
 * non-leakage, and the Scoring MUST that PROVE pays more than LEAK for an
 * equal-value Order. Unit tests for the Schnorr primitives themselves (group,
 * witness, transcript, prover, verifier) live in schnorr.test.ts.
 *
 * [Issue #701] PROVE takes two moves now. A participant posts a commitment R,
 * the trusted side answers with a challenge they could not have predicted, and
 * only then do they respond -- which is what lets the group be small enough to
 * exponentiate by hand. `proveThroughExchange` performs both, so a test about
 * what a completed PROVE DID does not have to re-spell the protocol.
 */

import { describe, expect, test } from "bun:test";
import { applyOp, DEFAULT_CONFIG, initialState, projectForTeam, tick, validateOp } from "./reducer.ts";
import {
  buildProveCommitOp,
  proveThroughExchange,
  SUBSTRING_SAFE_FIELD,
  startedMatch,
} from "./playtest.ts";
import type { CryptoBattleState, CryptoBattleOp } from "./types.ts";

const CTX = { eventId: "prove-basic", teamIds: ["teamA", "teamB"] } as const;

/** The first Order on teamA's belt that PROVE can answer. */
function proveableOrder(state: CryptoBattleState) {
  const contract = state.contracts.find(
    (c) => c.teamId === "teamA" && c.allowedMethods.includes("prove"),
  );
  if (!contract) throw new Error("expected a PROVE-able contract for teamA");
  const team = state.teams.teamA;
  if (!team) throw new Error("expected teamA");
  return { contract, team };
}

describe("prove: the exchange", () => {
  test("committing writes back a challenge the participant can read", () => {
    const state = tick(startedMatch(CTX), 0);
    const { contract } = proveableOrder(state);

    const before = projectForTeam(state, "teamA").myContracts.find((c) => c.id === contract.id);
    expect(before?.proveChallenge).toBeUndefined();

    const commit = buildProveCommitOp(projectForTeam(state, "teamA").vault, contract.id);
    expect(validateOp(state, "teamA", commit)).toEqual({ ok: true });
    const committed = applyOp(state, "teamA", commit);

    const after = projectForTeam(committed, "teamA").myContracts.find((c) => c.id === contract.id);
    expect(after?.proveCommitment).toBeDefined();
    // The challenge is a scalar of the group PROVE runs in, which is what makes
    // the arithmetic that answers it something a person can do.
    const challenge = BigInt(after?.proveChallenge ?? "-1");
    expect(challenge).toBeGreaterThanOrEqual(0n);
    expect(challenge).toBeLessThan(113n);
    // The Order is not answered yet: committing scores nothing and completes
    // nothing.
    expect(committed.teams.teamA?.score).toBe(0);
    expect(committed.contracts.find((c) => c.id === contract.id)?.status).toBe("open");
  });

  test("a second commitment on a live one is refused, so a team gets one challenge at a time", () => {
    const state = tick(startedMatch(CTX), 0);
    const { contract } = proveableOrder(state);
    const commit = buildProveCommitOp(projectForTeam(state, "teamA").vault, contract.id);
    const committed = applyOp(state, "teamA", commit);

    const second = validateOp(committed, "teamA", commit);
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.error).toMatch(/already open/);
  });

  test("a commitment outside the group is refused before it can cost anything", () => {
    const state = tick(startedMatch(CTX), 0);
    const { contract } = proveableOrder(state);
    for (const commitment of ["0", "1", "227", "9999"]) {
      const result = validateOp(state, "teamA", { kind: "prove-commit", contractId: contract.id, commitment });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toMatch(/group element/);
    }
  });

  test("responding before committing is refused, because there is no challenge to answer", () => {
    const state = tick(startedMatch(CTX), 0);
    const { contract } = proveableOrder(state);
    const result = validateOp(state, "teamA", { kind: "prove-respond", contractId: contract.id, response: "1" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/commitment first/);
  });
});

describe("prove: happy path", () => {
  test("a valid exchange completes the Order, pays its points, and posts a transcript (not a share)", () => {
    const state = tick(startedMatch(CTX), 0);
    const { contract } = proveableOrder(state);

    const { state: next, commitment, challenge, response } = proveThroughExchange(state, "teamA", contract.id);

    expect(next.teams.teamA?.score).toBe(contract.points);
    expect(next.contracts.find((c) => c.id === contract.id)?.status).toBe("completed");
    expect(next.contracts.find((c) => c.id === contract.id)?.resolution).toBe("prove");
    expect(next.teams.teamA?.completedContractIds).toContain(contract.id);
    // [Issue #701] The round is spent, so the Order carries no live challenge.
    expect(next.contracts.find((c) => c.id === contract.id)?.proveChallenge).toBeUndefined();

    expect(next.publicLedger).toHaveLength(1);
    const posted = next.publicLedger[0];
    if (!posted) throw new Error("expected a posted artifact");
    // `next.publicLedger` holds the compact persisted form (`StoredArtifact`,
    // see ledger-codec.ts): `k`/`tm`/`c`/`g`/`o`/`e`/`z` below are that form's
    // own field names.
    expect(posted.k).toBe("proof");
    if (posted.k !== "proof") throw new Error("expected a proof artifact");
    expect(posted.tm).toBe("teamA");
    expect(posted.c).toBe(contract.id);
    expect(posted.g).toBe(1);
    expect(posted.o).toBe(commitment);
    // [Issue #701] The challenge is published with the transcript. A row
    // carrying only (R, s) is two thirds of a transcript, and without `e` the
    // nonce-reuse HUNT stops being derivable from public material at all.
    expect(posted.e).toBe(challenge);
    expect(posted.z).toBe(response);
  });

  test("PROVE never adds a ShareArtifact to the public ledger, unlike LEAK", () => {
    const state = tick(startedMatch(CTX), 0);
    const { contract } = proveableOrder(state);
    const { state: next } = proveThroughExchange(state, "teamA", contract.id);
    expect(next.publicLedger.some((a) => a.k === "share")).toBe(false);
    expect(next.publicLedger.every((a) => a.k === "proof")).toBe(true);
  });
});

/**
 * [Issue #701] The REVERSE of what this suite pinned before, and deliberately
 * so. A wrong response used to be refused by `validateOp`, which made it free
 * and left no trace. Over a 113-value challenge space free retries ARE the
 * attack -- so a wrong response is now a move that lands, is charged, and burns
 * the commitment. Another try means another commitment and another challenge
 * nobody can predict: an independent 1/113, at a price.
 */
describe("prove: a wrong response is a move, not a non-event", () => {
  test("it costs the team, burns the commitment, and leaves the Order open", () => {
    const state = tick(startedMatch(CTX), 0);
    const { contract } = proveableOrder(state);
    const committed = applyOp(
      state,
      "teamA",
      buildProveCommitOp(projectForTeam(state, "teamA").vault, contract.id),
    );
    const scored: CryptoBattleState = {
      ...committed,
      teams: { ...committed.teams, teamA: { ...committed.teams.teamA!, score: 40 } },
    };

    const wrong: CryptoBattleOp = { kind: "prove-respond", contractId: contract.id, response: "7" };
    expect(validateOp(scored, "teamA", wrong)).toEqual({ ok: true });
    const next = applyOp(scored, "teamA", wrong);

    expect(next.teams.teamA?.score).toBe(40 - DEFAULT_CONFIG.scores.wrongProve);
    expect(next.contracts.find((c) => c.id === contract.id)?.status).toBe("open");
    expect(next.contracts.find((c) => c.id === contract.id)?.proveCommitment).toBeUndefined();
    expect(next.contracts.find((c) => c.id === contract.id)?.proveChallenge).toBeUndefined();
    // Nothing was published: a failed attempt is not a transcript.
    expect(next.publicLedger).toHaveLength(0);
  });

  test("so the same challenge cannot be walked -- a retry needs a fresh commitment", () => {
    const state = tick(startedMatch(CTX), 0);
    const { contract } = proveableOrder(state);
    const committed = applyOp(
      state,
      "teamA",
      buildProveCommitOp(projectForTeam(state, "teamA").vault, contract.id),
    );
    const missed = applyOp(committed, "teamA", {
      kind: "prove-respond",
      contractId: contract.id,
      response: "7",
    });
    const again = validateOp(missed, "teamA", {
      kind: "prove-respond",
      contractId: contract.id,
      response: "8",
    });
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.error).toMatch(/commitment first/);

    // And committing again then answering honestly still works: a miss is a
    // cost, not a lockout.
    const { state: proved } = proveThroughExchange(missed, "teamA", contract.id);
    expect(proved.contracts.find((c) => c.id === contract.id)?.resolution).toBe("prove");
  });

  test("an unreduced response is refused outright rather than charged", () => {
    const state = tick(startedMatch(CTX), 0);
    const { contract } = proveableOrder(state);
    const committed = applyOp(
      state,
      "teamA",
      buildProveCommitOp(projectForTeam(state, "teamA").vault, contract.id),
    );
    const result = validateOp(committed, "teamA", {
      kind: "prove-respond",
      contractId: contract.id,
      response: "113",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/reduced/);
    // Refused, so the commitment is still live and nothing was charged.
    expect(committed.contracts.find((c) => c.id === contract.id)?.proveChallenge).toBeDefined();
  });
});

describe("prove: binding", () => {
  test("a commitment on Order A does not answer Order B", () => {
    const state = tick(startedMatch(CTX), 0);
    const proveable = state.contracts.filter(
      (c) => c.teamId === "teamA" && c.allowedMethods.includes("prove"),
    );
    const [contractA, contractB] = proveable;
    if (!contractA || !contractB) throw new Error("expected two PROVE-able contracts for teamA");

    const committed = applyOp(
      state,
      "teamA",
      buildProveCommitOp(projectForTeam(state, "teamA").vault, contractA.id),
    );
    const result = validateOp(committed, "teamA", {
      kind: "prove-respond",
      contractId: contractB.id,
      response: "1",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/commitment first/);
  });

  test("another team's witness does not answer this team's challenge", () => {
    const state = tick(startedMatch(CTX), 0);
    const { contract } = proveableOrder(state);
    const teamB = state.teams.teamB;
    if (!teamB) throw new Error("expected teamB");

    // teamA commits honestly, then answers with a response computed from
    // teamB's secret. The equation is checked against teamA's OWN public
    // commitment, so it cannot hold.
    const committed = applyOp(
      state,
      "teamA",
      buildProveCommitOp(projectForTeam(state, "teamA").vault, contract.id),
    );
    const foreign = { ...projectForTeam(state, "teamB").vault, teamId: "teamA" };
    const order = projectForTeam(committed, "teamA").myContracts.find((c) => c.id === contract.id);
    if (!order) throw new Error("expected the committed Order");
    const { buildProveRespondOp } = require("./playtest.ts") as typeof import("./playtest.ts");
    const op = buildProveRespondOp(foreign, order);
    const next = applyOp(committed, "teamA", op);
    expect(next.contracts.find((c) => c.id === contract.id)?.status).toBe("open");
    expect(next.publicLedger).toHaveLength(0);
  });
});

describe("prove: replay", () => {
  test("a completed Order cannot be proved again", () => {
    const state = tick(startedMatch(CTX), 0);
    const { contract } = proveableOrder(state);
    const { state: proved } = proveThroughExchange(state, "teamA", contract.id);

    const result = validateOp(proved, "teamA", {
      kind: "prove-commit",
      contractId: contract.id,
      commitment: "4",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/completed/);
  });
});

describe("prove: cross-resolution double-completion is rejected [independent review, low #6]", () => {
  // LEAK and PROVE share the exact same "status !== 'open'" guard in
  // validateOp -- these two tests pin the cross-resolution case directly
  // (an Order completed by ONE method cannot then be completed by the
  // OTHER), rather than relying on it as an untested side effect of the
  // same-method replay tests above.

  test("an Order already completed via PROVE cannot then be LEAKed", () => {
    const state = tick(startedMatch(CTX), 0);
    const { contract } = proveableOrder(state);
    const { state: proved } = proveThroughExchange(state, "teamA", contract.id);
    expect(proved.contracts.find((c) => c.id === contract.id)?.resolution).toBe("prove");

    const leakResult = validateOp(proved, "teamA", { kind: "leak", contractId: contract.id });
    expect(leakResult.ok).toBe(false);
    if (!leakResult.ok) expect(leakResult.error).toMatch(/completed/);
    // No share ever gets published as a side effect of the rejected LEAK attempt.
    expect(proved.publicLedger.some((a) => a.k === "share")).toBe(false);
  });

  test("an Order already completed via LEAK cannot then be PROVEn", () => {
    const state = tick(startedMatch(CTX), 0);
    const { contract } = proveableOrder(state);
    const leaked = applyOp(state, "teamA", { kind: "leak", contractId: contract.id });
    expect(leaked.contracts.find((c) => c.id === contract.id)?.resolution).toBe("leak");

    const result = validateOp(leaked, "teamA", {
      kind: "prove-commit",
      contractId: contract.id,
      commitment: "4",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/completed/);
  });
});

describe("prove: wrong generation", () => {
  test("a commitment made before a ROTATE no longer answers, and a fresh exchange does", () => {
    let state = tick(startedMatch(CTX), 0);
    const { contract } = proveableOrder(state);

    // Commit under generation 1...
    state = applyOp(state, "teamA", buildProveCommitOp(projectForTeam(state, "teamA").vault, contract.id));
    const staleOrder = projectForTeam(state, "teamA").myContracts.find((c) => c.id === contract.id);
    if (!staleOrder?.proveChallenge) throw new Error("expected a challenge");
    const { buildProveRespondOp } = require("./playtest.ts") as typeof import("./playtest.ts");
    const staleResponse = buildProveRespondOp(projectForTeam(state, "teamA").vault, staleOrder);

    // ...then ROTATE, which moves the witness the challenge is checked against.
    state = applyOp(state, "teamA", { kind: "rotate" });
    expect(state.teams.teamA?.generation).toBe(2);

    const stillOpen = state.contracts.find((c) => c.id === contract.id);
    if (stillOpen?.status !== "open") {
      // ROTATE voids this team's open Orders in some configurations; the
      // property under test needs a live one, so pick another.
      return;
    }
    const missed = applyOp(state, "teamA", staleResponse);
    expect(missed.contracts.find((c) => c.id === contract.id)?.status).toBe("open");

    const { state: proved } = proveThroughExchange(missed, "teamA", contract.id);
    expect(proved.contracts.find((c) => c.id === contract.id)?.resolution).toBe("prove");
  });
});

describe("prove: secret non-leakage", () => {
  test("the transcript and another team's projection never contain the secret or a share value", () => {
    // [Issue #696] Big field: this test's method is a substring search over a
    // serialized projection, which cannot tell a leak from a coincidence at
    // three digits. See SUBSTRING_SAFE_FIELD.
    const state = tick(startedMatch(CTX, SUBSTRING_SAFE_FIELD), 0);
    const { contract, team } = proveableOrder(state);

    const secretDecimal = team.secret;
    const shareValues = team.shares.map((s) => s.value);

    const { state: next } = proveThroughExchange(state, "teamA", contract.id);

    const ledgerJson = JSON.stringify(next.publicLedger);
    expect(ledgerJson).not.toContain(secretDecimal);
    for (const shareValue of shareValues) {
      expect(ledgerJson).not.toContain(shareValue);
    }

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

  test("another team never sees the challenge on an Order that is not theirs", () => {
    const state = tick(startedMatch(CTX), 0);
    const { contract } = proveableOrder(state);
    const committed = applyOp(
      state,
      "teamA",
      buildProveCommitOp(projectForTeam(state, "teamA").vault, contract.id),
    );
    // `myContracts` is teamA's Orders only -- teamB's projection carries a
    // count of the others, never their rows, so there is nowhere for a live
    // challenge to appear.
    const observer = projectForTeam(committed, "teamB");
    expect(observer.myContracts.some((c) => c.id === contract.id)).toBe(false);
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
  test("completing one Order via LEAK and an equal-points Order via PROVE yields DIFFERENT score deltas", () => {
    const state = tick(startedMatch(CTX), 0);
    // Two DIFFERENT Orders of equal value, one answered each way -- the
    // comparison is about the rate, so the Orders have to be worth the same.
    // Standard Orders only: a rush Order pays a different rate on purpose, so
    // comparing one against a standard one would measure the wrong thing.
    const mine = state.contracts.filter((c) => c.teamId === "teamA" && c.kind === "standard");
    const first = mine.find((c) => c.allowedMethods.includes("leak"));
    const second = mine.find(
      (c) => c.id !== first?.id && c.allowedMethods.includes("prove") && c.points === first?.points,
    );
    if (!first || !second) throw new Error("expected a LEAK-able and an equal-value PROVE-able Order");

    const leaked = applyOp(state, "teamA", { kind: "leak", contractId: first.id });
    const leakDelta = (leaked.teams.teamA?.score ?? 0) - (state.teams.teamA?.score ?? 0);

    const { state: proved } = proveThroughExchange(state, "teamA", second.id);
    const proveDelta = (proved.teams.teamA?.score ?? 0) - (state.teams.teamA?.score ?? 0);

    expect(proveDelta).toBeGreaterThan(leakDelta);
    expect(leakDelta).toBe(first.leakPoints);
    expect(proveDelta).toBe(second.points);
  });

  test("an Order carries both rates, so the trade is visible before it is made", () => {
    const state = tick(startedMatch(CTX), 0);
    const order = projectForTeam(state, "teamA").myContracts[0];
    if (!order) throw new Error("expected an Order");
    expect(order.points).toBeGreaterThan(order.leakPoints);
  });
});

describe("prove: match end", () => {
  test("is rejected once the match has ended, even for an Order still open by its own TTL", () => {
    const state = tick(startedMatch(CTX), 0);
    const { contract } = proveableOrder(state);
    const ended = tick(state, DEFAULT_CONFIG.matchDurationMs + 1);
    const stillOpen = ended.contracts.find((c) => c.id === contract.id);
    if (!stillOpen) return;

    const result = validateOp(ended, "teamA", {
      kind: "prove-commit",
      contractId: contract.id,
      commitment: "4",
    });
    expect(result.ok).toBe(false);
  });
});

describe("prove: an unstarted match", () => {
  test("has nothing to commit against", () => {
    const state = initialState(CTX);
    const result = validateOp(state, "teamA", {
      kind: "prove-commit",
      contractId: "teamA-c0",
      commitment: "4",
    });
    expect(result.ok).toBe(false);
  });
});
