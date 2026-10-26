import { expect, test } from "bun:test";
import { rpsSubmissionFeedback } from "../../portal/FastMovePanel.tsx";
import { commit } from "./commitment.ts";
import { applyOp, initialState, projectForTeam, tick, validateOp } from "./reducer.ts";

for (const locale of ["ja", "en"] as const) test(`an absent opponent is pending until the existing deadline award (${locale})`, () => {
  let state = tick(applyOp(initialState({ eventId: "pending", teamIds: ["a", "b"], matchSecret: "unit-fixture" }, { contractsPerIssue: 6 }), "a", { kind: "start" }), 60_000);
  const order = state.contracts.find(c => c.teamId === "a" && c.task.kind === "rps-duel")!;
  // Isolate this duel's award from independent expired-Order penalties.
  state = { ...state, contracts: state.contracts.filter(c => c.task.kind === "rps-duel") };
  state = applyOp(state, "a", { kind: "rps-commit", contractId: order.id, commitment: commit(1, 2) });
  const ownOrder = () => projectForTeam(state, "a").myContracts.find(c => c.id === order.id)!;
  const sealed = rpsSubmissionFeedback(ownOrder(), "rps-commit", locale);
  expect(sealed.kind).toBe("hint");
  expect(sealed.reward).toBeUndefined();
  expect(sealed.body).toContain(locale === "ja" ? "次に審判へ" : "Next give the judge");
  const wrongOpening = { kind: "rps-open" as const, contractId: order.id, hand: 2, randomness: 2 };
  expect(validateOp(state, "a", wrongOpening).ok).toBe(false);
  state = applyOp(state, "a", { kind: "rps-open", contractId: order.id, hand: 1, randomness: 2 });
  state = tick(state, order.expiresAtMs - 1);
  const waiting = rpsSubmissionFeedback(ownOrder(), "rps-open", locale);
  expect(waiting.kind).toBe("hint");
  expect(waiting.reward).toBeUndefined();
  expect(waiting.title).toContain(locale === "ja" ? "未採点" : "not scored yet");
  expect(waiting.body).toContain(`+${order.points}`);
  expect(state.teams.a!.score).toBe(0);
  state = tick(JSON.parse(JSON.stringify(state)), order.expiresAtMs);
  const settled = rpsSubmissionFeedback(ownOrder(), "rps-open", locale);
  expect(settled.kind).toBe("prove");
  expect(settled.reward).toBe(order.points);
  expect(state.teams.a!.score).toBe(order.points);
  expect(tick(state, order.expiresAtMs).teams).toEqual(state.teams);
  expect(rpsSubmissionFeedback(undefined, "rps-open", locale).kind).toBe("error");
});
