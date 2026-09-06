import { describe, expect, it } from "bun:test";
import { initialState } from "./reducer.ts";
import { scoreReasons } from "./score-reasons.ts";
import type { CryptoBattleOp } from "./types.ts";

const before = initialState({ eventId: "score-reasons", teamIds: ["red", "blue"] });
const red = before.teams.red;
const blue = before.teams.blue;
if (!red || !blue) throw new Error("Missing fixture team");
const after = { ...before, teams: { ...before.teams, red: { ...red, score: 30 }, blue: { ...blue, score: 10 } } };

describe("public coordination score reasons", () => {
  it.each([
    ["prove-sudoku", "prove"], ["cipher", "cipher"], ["leak", "leak"], ["fhe", "fhe"], ["mpc", "mpc"],
    ["rps-commit", "duel"], ["rps-open", "duel"], ["rotate", "rotate"], ["reveal-hint", "hint"],
    ["ready", "coordination"], ["start", "coordination"],
  ] as const)("classifies %s without copying operation inputs", (kind, reason) => {
    const op = { kind, answer: "private answer", recoveredSecret: "private secret" } as unknown as CryptoBattleOp;
    expect(scoreReasons(before, after, { kind: "op", teamId: "red", op })).toEqual({ red: reason, blue: reason });
  });
  it.each(["hunt", "hunt-cipher", "hunt-sudoku", "hunt-rps"] as const)("distinguishes %s attacker and victim", (kind) => {
    expect(scoreReasons(before, after, { kind: "op", teamId: "red", op: { kind } as CryptoBattleOp })).toEqual({ red: "hunt", blue: "hunted" });
  });
  it("describes automatic expiration and omits teams whose actual score did not move", () => {
    expect(scoreReasons(before, after, { kind: "tick" })).toEqual({ red: "deadline", blue: "deadline" });
    expect(scoreReasons(before, before, { kind: "tick" })).toEqual({});
  });
});

it("classifies a third-party RPS prediction settlement as HUNT, not the opponent's DUEL", () => {
  const settled = { ...after, teams: { ...after.teams, red: { ...red, score: 25, lastRpsHunt: { targetTeamId: "blue", duelId: "public-duel", generation: 1, predictedHand: 1 as const, actualHand: 1 as const, outcome: "hit" as const, points: 25, atMs: 1 } } } };
  expect(scoreReasons(before, settled, { kind: "op", teamId: "blue", op: { kind: "rps-open", contractId: "public-order", hand: 1, randomness: 1 } }).red).toBe("hunt");
});

it("keeps HUNT classification when the final of several predictions reaches the zero-point floor", () => {
  const prior = {...before, teams: {...before.teams, red: {...red, score: 5}}};
  const settled = {...before, teams: {...before.teams, red: {...red, score: 0, lastRpsHunt: {targetTeamId: "blue", duelId: "public-duel", generation: 1, predictedHand: 1 as const, actualHand: 2 as const, outcome: "miss" as const, points: 0, atMs: 1}}}};
  expect(scoreReasons(prior, settled, {kind:"op", teamId:"blue", op: {kind:"rps-open", contractId:"public-order", hand:2, randomness:1}})).toEqual({red:"hunt"});
});
