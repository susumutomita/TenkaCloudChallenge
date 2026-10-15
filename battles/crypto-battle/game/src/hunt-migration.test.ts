import { expandSuccessfulHunts } from "./hunt-success.ts";
import { artifactFields } from "./ledger-codec.ts";
import { decodeLedger, encodeLedger } from "./ledger-codec.ts";
import { decodeHuntLog } from "./hunt-log.ts";
import { readLastHunt } from "./hunt-result.ts";
import { expandHuntAttempts } from "./hunt-budget.ts";
import { expect, test } from "bun:test";
import { buildScenario } from "../../dev/scenarios.ts";
import { buildSudokuHuntOp } from "./playtest.ts";
import { applyOp, migrateState, projectForTeam, tick, validateOp } from "./reducer.ts";
import type { CryptoBattleOp, CryptoBattleState } from "./types.ts";

function move(state: CryptoBattleState, team: string, op: CryptoBattleOp) {
  expect(validateOp(state, team, op)).toEqual({ ok: true });
  return applyOp(state, team, op);
}
function wrongShare(state: CryptoBattleState, target: string): CryptoBattleOp {
  return { kind: "hunt", targetTeamId: target, generation: state.teams[target]!.generation,
    recoveredSecret: String((BigInt(state.teams[target]!.secret) + 1n) % BigInt(state.config.prime)) };
}
/** v4's real compaction is unchanged; only the new result delta is absent. */
function oldRow(state: CryptoBattleState): CryptoBattleState {
  return JSON.parse(JSON.stringify({ ...state, publicLedger: encodeLedger(decodeLedger(state.publicLedger, state.teams)), huntLog: decodeHuntLog(state), successfulHunts: completeGuards(state), huntAttempts: expandHuntAttempts(state), teams: Object.fromEntries(Object.entries(state.teams).map(([id, team]) => {
    if (!team.lastHunt) return [id, team];
    const { points: _newField, ...lastHunt } = readLastHunt(state, team.lastHunt);
    return [id, { ...team, lastHunt }];
  })) }));
}
function completeGuards(state: CryptoBattleState) {
  return [...new Set([...expandSuccessfulHunts(state), ...decodeHuntLog(state).flatMap(e => e.via === undefined ? [JSON.stringify([e.attackerTeamId, e.targetTeamId, e.generation])] : e.via === "sudoku" ? [JSON.stringify(["sudoku", e.attackerTeamId, e.targetTeamId, e.generation])] : [])])].sort();
}
function semanticState(state: CryptoBattleState) { return { ...state, publicLedger: decodeLedger(state.publicLedger, state.teams), huntAttempts: expandHuntAttempts(state), huntLog: decodeHuntLog(state), successfulHunts: completeGuards(state) }; }
function roundTrip(state: CryptoBattleState) {
  const v4 = oldRow(state), serialized = JSON.stringify(v4);
  expect(Object.keys(v4.huntAttempts).length).toBeGreaterThan(0);
  expect(v4.publicLedger.map(artifactFields).some(a => typeof a.c === "number")).toBe(true);
  const v5 = migrateState(JSON.parse(serialized), 4);
  expect(semanticState(v5)).toEqual(semanticState(v4));
  expect(JSON.stringify(v4)).toBe(serialized);
  for (const team of Object.keys(v4.teams)) expect(projectForTeam(v5, team)).toEqual(projectForTeam(v4, team));
  return { v4, v5 };
}

test("v4 nonempty Shamir and Sudoku counters, numeric ledger IDs and completed attacks survive upgrade and next operation", () => {
  let state = buildScenario("pi-reuse").host.state;
  state = move(state, "bravo", wrongShare(state, "alpha"));
  const sudoku = buildSudokuHuntOp(projectForTeam(state, "bravo"), "alpha");
  if (!sudoku) throw new Error("fixture must have public sudoku evidence");
  state = move(state, "bravo", sudoku);
  expect(expandHuntAttempts(state)).toEqual({ '[1,0,1]': 1, '["sudoku",1,0,1]': 1 });
  const { v4, v5 } = roundTrip(state);
  const before = projectForTeam(v5, "bravo");
  expect(before.huntAttempts.alpha?.spent).toBe(1);
  expect(before.sudokuHuntAttempts.alpha?.spent).toBe(1);
  expect(before.completedHunts).toContainEqual({ targetTeamId: "alpha", generation: 1, via: "sudoku" });
  expect(before.lastHunt?.points).toBeUndefined();
  const op = wrongShare(v5, "alpha");
  const next = move(tick(v5, v5.nowMs! + 1), "bravo", op);
  expect(semanticState(next)).toEqual(semanticState(move(tick(v4, v4.nowMs! + 1), "bravo", op)));
  expect(projectForTeam(next, "bravo").huntAttempts.alpha?.spent).toBe(2);
  expect(projectForTeam(next, "bravo").lastHunt?.points).toBeDefined();
});

test("v4 RPS reservations preserve roster-indexed predictions and shared budgets through opening and settlement", () => {
  let state = buildScenario("rps-reuse").host.state;
  state = move(state, "alpha", wrongShare(state, "bravo"));
  const target = projectForTeam(state, "alpha").rpsHunt!.targets[0]!;
  state = move(state, "alpha", { kind: "hunt-rps", targetTeamId: "bravo", duelId: target.duelId, predictedHand: 2 });
  expect(expandHuntAttempts(state)).toEqual({ '[0,1,1]': 2 });
  const b = state.contracts.find(c => c.teamId === "bravo" && c.task.kind === "rps-duel" && c.task.duelId === target.duelId)!;
  const a = state.contracts.find(c => c.teamId === "alpha" && c.task.kind === "rps-duel" && c.task.duelId === target.duelId)!;
  expect(b.rps?.predictions).toEqual({ '0': [2, 1] });
  let { v4, v5 } = roundTrip(state);
  expect(projectForTeam(v5, "alpha").rpsHunt!.pending).toHaveLength(1);
  for (const [team, op] of [
    ["alpha", { kind: "rps-commit", contractId: a.id, commitment: 13 }],
    ["bravo", { kind: "rps-open", contractId: b.id, hand: 2, randomness: 2 }],
    ["alpha", { kind: "rps-open", contractId: a.id, hand: 1, randomness: 1 }],
  ] as const) {
    v4 = move(v4, team, op); v5 = move(v5, team, op);
    expect(semanticState(v5)).toEqual(semanticState(v4));
  }
  const after = projectForTeam(v5, "alpha");
  expect(after.rpsHunt!.pending).toEqual([]);
  expect(after.rpsHunt!.lastResult).toMatchObject({ outcome: "hit", points: 25 });
  expect(after.huntAttempts.bravo?.spent).toBe(2);
  expect(v5.contracts.every(c => !c.rps?.predictions)).toBe(true);
});

test("v4 migration rejects malformed stored counters without rewriting the input", () => {
  const state = buildScenario("fresh").host.state;
  for (const [key, count] of [['[0,1,1]', -1], ['[0,1,1]', 1.5], ['[9,1,1]', 1], ['[0,1,0]', 1], ['[0,1,1.5]', 1], ['["alpha","bravo",1]', 1], ['["sudoku",0,1,1,2]', 1], ['null', 1], [' [0,1,1]', 1]] as const) {
    const invalid = { ...state, huntAttempts: { [key]: count } }, before = JSON.stringify(invalid);
    expect(() => migrateState(invalid, 4)).toThrow();
    expect(JSON.stringify(invalid)).toBe(before);
  }
});
