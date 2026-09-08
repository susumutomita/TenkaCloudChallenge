import { expect, test } from "bun:test";
import { applyOp, initialState, projectForTeam, STREAMING_ORDER_CONFIG, tick, validateOp } from "./reducer.ts";
import { scoreReasons } from "./score-reasons.ts";

function start() {
  return tick(applyOp(initialState({
    eventId: "score-polling-regression", teamIds: ["a", "b"],
    matchSecret: "local-score-polling-fixture",
  }, { ...STREAMING_ORDER_CONFIG, orderArrivalJitterMs: 0 }), "a", { kind: "start" }), 0);
}

test("polling and ticking cannot buy hints, and every waiting-period deduction matches newly expired own orders", () => {
  let state = start();
  expect(projectForTeam(state, "a").expiryPenalty).toBe(state.config.scores.expiredOrder);
  state = applyOp(state, "a", { kind: "leak", contractId: "a-c0" });
  for (let now = 5_000; now <= 900_000; now += 5_000) {
    const before = state;
    const saved = JSON.stringify(before);
    // Both teams can poll; projection must leave the authoritative state intact.
    for (const id of ["a", "b"]) projectForTeam(before, id);
    expect(JSON.stringify(before)).toBe(saved);
    state = tick(before, now);
    for (const id of ["a", "b"]) {
      const expired = before.contracts.filter(order => order.teamId === id
        && order.status === "open" && order.expiresAtMs <= now);
      expect(state.teams[id]!.score).toBe(Math.max(0,
        before.teams[id]!.score + expired.length * state.config.scores.expiredOrder));
      expect(state.contracts.filter(order => (order.hintsRevealed ?? 0) > 0)).toEqual([]);
    }
    expect(tick(state, now)).toEqual(state);
  }
});

test("the reported 2, 4, 8 deductions require explicit own-team hint operations", () => {
  let state = start();
  // Enough earned points to observe all three prices without the zero floor.
  state = { ...state, teams: { ...state.teams,
    a: { ...state.teams.a!, score: 30 }, b: { ...state.teams.b!, score: 30 } } };
  for (const cost of [2, 4, 8]) {
    const op = { kind: "reveal-hint" as const, contractId: "a-c0", expectedCost: cost };
    expect(validateOp(state, "b", op).ok).toBe(false);
    expect(validateOp(state, "a", op).ok).toBe(true);
    const before = state;
    state = applyOp(state, "a", op);
    expect(state.teams.a!.score).toBe(before.teams.a!.score - cost);
    expect(state.teams.b).toEqual(before.teams.b);
    expect(scoreReasons(before, state, { kind: "op", teamId: "a", op })).toEqual({ a: "hint" });
    for (let poll = 0; poll < 3; poll++) projectForTeam(state, "a");
    expect(state.teams.a!.score).toBe(before.teams.a!.score - cost);
  }
  expect(state.teams.a!.score).toBe(16);
  const deadline = state.contracts.find(order => order.id === "a-c0")!.expiresAtMs;
  const beforeDeadline = state;
  state = tick(state, deadline);
  expect(state.teams.a!.score).toBe(1);
  expect(scoreReasons(beforeDeadline, state, { kind: "tick" }).a).toBe("deadline");
  const nextDeadline = state.contracts.find(order => order.teamId === "a" && order.status === "open")!.expiresAtMs;
  state = tick(state, nextDeadline);
  expect(state.teams.a!.score).toBe(0);
});
