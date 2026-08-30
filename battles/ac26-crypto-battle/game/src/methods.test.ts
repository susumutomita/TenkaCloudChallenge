/** Issue #645 Phase 1: the submission-method registry and the Order gate it feeds. */

import { describe, expect, test } from "bun:test";
import {
  ALL_SUBMISSION_METHODS,
  allowedMethodsFor,
  methodSatisfiesConstraint,
  type PrivacyConstraint,
  SUBMISSION_METHODS,
  type SubmissionMethod,
} from "./methods.ts";
import { applyOp, DEFAULT_CONFIG, initialState, projectForTeam, tick, validateOp } from "./reducer.ts";
import { buildProveOp } from "./playtest.ts";
import type { Contract, CryptoBattleState } from "./types.ts";

const CTX = { eventId: "methods-645", teamIds: ["teamA", "teamB"] } as const;

/** See reducer.test.ts's `orderMatching`: which Orders are constrained is a seed roll. */
function orderMatching(
  want: (contract: Contract) => boolean,
  teamId = "teamA",
): { state: CryptoBattleState; order: Contract } {
  let state = tick(initialState(CTX), 0);
  for (let issued = 0; issued < 20; issued += 1) {
    const order = state.contracts.find(
      (c) => c.teamId === teamId && c.status === "open" && want(c),
    );
    if (order) return { state, order };
    state = tick(state, (issued + 1) * DEFAULT_CONFIG.contractIntervalMs);
  }
  throw new Error(`no matching open order for ${teamId} within 20 issuance rounds`);
}

describe("the method registry", () => {
  test("every method in the union is registered, and every entry is in the union", () => {
    // The registry is a `Record<SubmissionMethod, _>`, so a method missing an
    // entry is already a type error. This catches the other direction: an entry
    // whose `method` field disagrees with its key, which would make
    // `SUBMISSION_METHODS[m].method !== m` and quietly mis-route a lookup.
    for (const method of ALL_SUBMISSION_METHODS) {
      expect(SUBMISSION_METHODS[method].method).toBe(method);
    }
    expect(new Set(ALL_SUBMISSION_METHODS).size).toBe(ALL_SUBMISSION_METHODS.length);
    expect([...ALL_SUBMISSION_METHODS].sort()).toEqual(
      (Object.keys(SUBMISSION_METHODS) as SubmissionMethod[]).sort(),
    );
  });

  /**
   * The one fact the whole model turns on, and it is a property of the
   * cryptography rather than a policy knob: a Shamir share is a point on the
   * secret's polynomial; a Schnorr transcript carries no witness (pinned
   * independently by schnorr.test.ts's non-leakage test).
   */
  test("LEAK publishes raw secret material and PROVE does not", () => {
    expect(SUBMISSION_METHODS.leak.publishesRawSecretMaterial).toBe(true);
    expect(SUBMISSION_METHODS.prove.publishesRawSecretMaterial).toBe(false);
  });

  test("an unconstrained Order accepts every method", () => {
    expect(allowedMethodsFor("none")).toEqual([...ALL_SUBMISSION_METHODS]);
    for (const method of ALL_SUBMISSION_METHODS) {
      expect(methodSatisfiesConstraint(method, "none")).toBe(true);
    }
  });

  /**
   * `no-raw-disclosure` is #645's Level-1 "technique-specified" Order. Stated
   * as a rule about the ARTIFACT rather than a hard-coded method name, so a
   * Phase-2 method that also publishes nothing reconstructable joins the
   * allowed set automatically, and one that does not is excluded automatically.
   */
  test("a no-raw-disclosure Order admits exactly the methods that publish nothing reconstructable", () => {
    const expected = ALL_SUBMISSION_METHODS.filter(
      (method) => !SUBMISSION_METHODS[method].publishesRawSecretMaterial,
    );
    expect(allowedMethodsFor("no-raw-disclosure")).toEqual(expected);
    expect(methodSatisfiesConstraint("leak", "no-raw-disclosure")).toBe(false);
    expect(methodSatisfiesConstraint("prove", "no-raw-disclosure")).toBe(true);
  });

  test("the allowed set is never empty for any constraint", () => {
    // An Order nobody can fulfil is a dead Order: it occupies the belt, expires
    // unclaimed, and the participant has no move that would have worked.
    const constraints: readonly PrivacyConstraint[] = ["none", "no-raw-disclosure"];
    for (const constraint of constraints) {
      expect(allowedMethodsFor(constraint).length).toBeGreaterThan(0);
    }
  });
});

describe("Orders carry the model the registry defines", () => {
  test("every issued Order's allowedMethods is exactly its constraint's allowed set", () => {
    let state = tick(initialState(CTX), 0);
    for (let round = 1; round <= 12; round += 1) {
      state = tick(state, round * DEFAULT_CONFIG.contractIntervalMs);
    }
    expect(state.contracts.length).toBeGreaterThan(4);
    for (const order of state.contracts) {
      expect(order.allowedMethods).toEqual(allowedMethodsFor(order.privacyConstraint));
    }
  });

  test("both kinds of Order are issued over a match", () => {
    let state = tick(initialState(CTX), 0);
    for (let round = 1; round <= 12; round += 1) {
      state = tick(state, round * DEFAULT_CONFIG.contractIntervalMs);
    }
    const constraints = new Set(state.contracts.map((c) => c.privacyConstraint));
    expect(constraints).toEqual(new Set(["none", "no-raw-disclosure"]));
  });

  /**
   * The rule has to be visible BEFORE the participant chooses. An Order that
   * only reveals it cannot be LEAKed by rejecting the submission has spent the
   * participant's time to teach them nothing they could have read.
   */
  test("the projection carries the constraint and the allowed methods", () => {
    const { state, order } = orderMatching((c) => c.privacyConstraint === "no-raw-disclosure");
    const projected = projectForTeam(state, "teamA").myContracts.find((c) => c.id === order.id);
    expect(projected).toBeDefined();
    expect(projected?.privacyConstraint).toBe("no-raw-disclosure");
    expect(projected?.allowedMethods).toEqual(["prove"]);
  });
});

describe("the Order gate runs for every method", () => {
  test("PROVE fulfils an Order that forbids raw disclosure, and is recorded as the resolution", () => {
    const { state, order } = orderMatching((c) => c.privacyConstraint === "no-raw-disclosure");
    const vault = projectForTeam(state, "teamA").vault;
    const op = buildProveOp(vault, order.id);

    expect(validateOp(state, "teamA", op)).toEqual({ ok: true });
    const next = applyOp(state, "teamA", op);

    const completed = next.contracts.find((c) => c.id === order.id);
    expect(completed?.status).toBe("completed");
    expect(completed?.resolution).toBe("prove");
    expect(next.teams.teamA?.score).toBe(order.points);
  });

  /**
   * The ledger has to say which method produced each entry -- #645's Public
   * Ledger requirement. Today `kind` implies it; Phase 2's FHE ciphertext is a
   * third artifact whose shape does not name its method, so the field is
   * recorded now rather than after the contract has to change.
   */
  test("every artifact records the method that produced it", () => {
    const { state, order } = orderMatching((c) => c.allowedMethods.includes("leak"));
    const afterLeak = applyOp(state, "teamA", { kind: "leak", contractId: order.id });
    for (const artifact of afterLeak.publicLedger) {
      expect(artifact.method).toBe("leak");
      expect(artifact.kind).toBe("share");
    }

    const proveOrder = afterLeak.contracts.find(
      (c) => c.teamId === "teamB" && c.status === "open",
    );
    if (!proveOrder) throw new Error("expected an open order for teamB");
    const vault = projectForTeam(afterLeak, "teamB").vault;
    const afterProve = applyOp(afterLeak, "teamB", buildProveOp(vault, proveOrder.id));
    const proof = afterProve.publicLedger.find((a) => a.kind === "proof");
    expect(proof?.method).toBe("prove");
  });

  /**
   * The gate runs before the method's own trusted check. An Order belonging to
   * another team must be refused as such, not after spending a 2048-bit
   * verification on it -- and, more importantly, the refusal must not depend on
   * the artifact being invalid.
   */
  test("a valid proof against another team's Order is still refused", () => {
    const { state } = orderMatching(() => true);
    const theirs = state.contracts.find((c) => c.teamId === "teamB" && c.status === "open");
    if (!theirs) throw new Error("expected an open order for teamB");

    const vault = projectForTeam(state, "teamA").vault;
    const verdict = validateOp(state, "teamA", buildProveOp(vault, theirs.id));
    expect(verdict.ok).toBe(false);
    if (verdict.ok) throw new Error("unreachable");
    expect(verdict.error).toContain("belongs to another team");
  });

  test("an expired Order scores nothing by any method", () => {
    const { state, order } = orderMatching((c) => c.allowedMethods.includes("leak"));
    const afterDeadline = tick(state, order.expiresAtMs + 1);

    const verdict = validateOp(afterDeadline, "teamA", { kind: "leak", contractId: order.id });
    expect(verdict.ok).toBe(false);
    if (verdict.ok) throw new Error("unreachable");
    expect(verdict.error).toContain("expired");
    expect(afterDeadline.teams.teamA?.score).toBe(0);
  });
});
