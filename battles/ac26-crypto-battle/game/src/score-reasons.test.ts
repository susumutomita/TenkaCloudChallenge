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
