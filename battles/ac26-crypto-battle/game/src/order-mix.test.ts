/**
 * [Issue #645 Phase 4] What a real match's Order belt actually contains.
 *
 * Phase 4 asks for Orders where more than one method is reasonable, and for
 * evidence of the resulting mix rather than an assertion that it exists. The
 * learning progression #645 describes only happens if a participant actually
 * MEETS each kind of Order, and "roughly 1-in-N" is not evidence — a short
 * match can miss a 1-in-4 roll entirely.
 *
 * So this file measures the schedule the reducer really issues:
 *
 *  - every task kind appears, and appears early enough to matter;
 *  - free-choice Orders (LEAK or PROVE, participant decides) exist, and so do
 *    Orders that state a rule and leave exactly one method;
 *  - no Order is unfulfillable.
 *
 * These are not balance assertions. They are the structural preconditions for
 * the progression: if any of them stopped holding, some participants would
 * finish a match having never seen half the game.
 */

import { describe, expect, test } from "bun:test";
import { allowedMethodsFor } from "./methods.ts";
import { DEFAULT_CONFIG, initialState, tick } from "./reducer.ts";
import type { Contract, CryptoBattleState, OrderTaskKind, SubmissionMethod } from "./types.ts";

const CTX = { eventId: "order-mix", teamIds: ["teamA", "teamB", "teamC"] } as const;

/** Every Order issued to `teamId` across a full-length match. */
function ordersAcrossMatch(teamId: string): readonly Contract[] {
  let state: CryptoBattleState = tick(initialState(CTX), 0);
  const total = DEFAULT_CONFIG.matchDurationMs;
  for (let atMs = 0; atMs <= total; atMs += DEFAULT_CONFIG.contractIntervalMs) {
    state = tick(state, atMs);
  }
  return state.contracts.filter((c) => c.teamId === teamId);
}

describe("the Order belt a participant actually sees", () => {
  const orders = ordersAcrossMatch("teamA");

  test("a full match issues a substantial number of Orders", () => {
    expect(orders.length).toBeGreaterThan(10);
  });

  test("every task kind appears", () => {
    const kinds = new Set<OrderTaskKind>(orders.map((o) => o.task.kind));
    expect(kinds).toEqual(new Set(["reveal-share", "homomorphic-sum", "masked-total"]));
  });

  /**
   * The progression needs each technique EARLY, not eventually. A participant
   * who meets their first FHE Order in the last five minutes has not had the
   * chance to learn anything from it.
   */
  test("each task kind appears within the first handful of Orders", () => {
    const firstSix = orders.slice(0, 6).map((o) => o.task.kind);
    expect(new Set(firstSix)).toEqual(new Set(["reveal-share", "homomorphic-sum", "masked-total"]));
  });

  test("every Order can be fulfilled by at least one method", () => {
    for (const order of orders) {
      expect(order.allowedMethods.length).toBeGreaterThan(0);
      expect(order.allowedMethods).toEqual(
        allowedMethodsFor(order.task.kind, order.privacyConstraint),
      );
    }
  });

  /**
   * #645's Level-3 Order: the participant chooses, and the choice has a
   * consequence (LEAK is immediate and feeds the Public Ledger; PROVE costs a
   * computation and feeds it nothing). This asserts such Orders exist in a real
   * match, which is what makes the choice a recurring decision rather than a
   * one-off.
   */
  test("free-choice Orders exist: more than one method is reasonable", () => {
    const freeChoice = orders.filter((o) => o.allowedMethods.length > 1);
    expect(freeChoice.length).toBeGreaterThan(0);
    for (const order of freeChoice) {
      expect(order.task.kind).toBe("reveal-share");
      expect(order.privacyConstraint).toBe("none");
      expect([...order.allowedMethods].sort()).toEqual(["leak", "prove"]);
    }
  });

  /**
   * And #645's Level-1 Order: the constraint is stated and exactly one method
   * meets it. Both shapes have to be present for the contrast to teach
   * anything.
   */
  test("constrained Orders exist: the rule leaves exactly one method", () => {
    const constrained = orders.filter(
      (o) => o.task.kind === "reveal-share" && o.privacyConstraint === "no-raw-disclosure",
    );
    expect(constrained.length).toBeGreaterThan(0);
    for (const order of constrained) {
      expect(order.allowedMethods).toEqual(["prove"]);
    }
  });

  test("no Order publishes raw material unless its rule permits it", () => {
    for (const order of orders) {
      if (order.privacyConstraint !== "no-raw-disclosure") continue;
      expect(order.allowedMethods).not.toContain("leak" satisfies SubmissionMethod);
    }
  });

  test("the mix is identical for every team on the same seed, and differs between teams", () => {
    // Determinism is what makes a replay honest; per-team variation is what
    // stops two teams sharing one answer.
    expect(ordersAcrossMatch("teamA").map((o) => o.id)).toEqual(orders.map((o) => o.id));
    const teamB = ordersAcrossMatch("teamB");
    expect(teamB.map((o) => o.task.kind)).toEqual(orders.map((o) => o.task.kind));
    const shareIndicesA = orders
      .filter((o) => o.task.kind === "reveal-share")
      .map((o) => (o.task.kind === "reveal-share" ? o.task.shareIndices.join(",") : ""));
    const shareIndicesB = teamB
      .filter((o) => o.task.kind === "reveal-share")
      .map((o) => (o.task.kind === "reveal-share" ? o.task.shareIndices.join(",") : ""));
    expect(shareIndicesA).not.toEqual(shareIndicesB);
  });
});
