import { expect, test } from "bun:test";
import {
  compactSuccessfulHunts,
  expandSuccessfulHunts,
  hasSuccessfulHunt,
  recordSuccessfulHunt,
} from "./hunt-success.ts";
import {
  initialState,
  migrateState,
  projectForTeam,
  applyOp,
  tick,
  validateOp,
} from "./reducer.ts";
import { deriveCipherKey } from "./fixtures.ts";
import { buildReplay } from "./replay.ts";

test("untimed guards preserve all methods and attacker bits across six-bit and roster boundaries", () => {
  let state = initialState({
    eventId: "guard-bits",
    teamIds: Array.from({ length: 99 }, (_, i) => String(i).padStart(26, "0")),
  });
  const ids = Object.keys(state.teams).sort(),
    expected: string[] = [];
  for (const target of [ids[0]!, ids[98]!])
    for (const attacker of ids)
      for (const method of ["share", "sudoku", "caesar", "vigenere"] as const) {
        if (attacker === target) continue;
        const key = JSON.stringify(
          method === "share"
            ? [attacker, target, 31]
            : method === "sudoku"
              ? [method, attacker, target, 31]
              : ["cipher", attacker, target, 31, method],
        );
        expected.push(key);
        state = { ...state, successfulHunts: recordSuccessfulHunt(state, key) };
        expect(hasSuccessfulHunt(state, key)).toBe(true);
        expect(recordSuccessfulHunt(state, key)).toBe(state.successfulHunts);
      }
  const restored = JSON.parse(JSON.stringify(state));
  restored.teams = Object.fromEntries(Object.entries(restored.teams).reverse());
  expect(expandSuccessfulHunts(restored).sort()).toEqual(expected.sort());
  expect(restored.successfulHunts).toHaveLength(8);
  expect(compactSuccessfulHunts(restored)).toEqual(restored.successfulHunts);
  for (const malformed of [
    "g:2:99:1:A",
    "g:2:0:0:A",
    "g:2:0:1:A",
    "g:2:0:1:" + "_".repeat(17),
  ])
    expect(() =>
      expandSuccessfulHunts({ ...state, successfulHunts: [malformed] }),
    ).toThrow();
  expect(() =>
    expandSuccessfulHunts({
      ...state,
      successfulHunts: [state.successfulHunts[0]!, state.successfulHunts[0]!],
    }),
  ).toThrow("Duplicate");
});

test("legacy guard-only success has no fabricated replay time and still blocks the real next operation", () => {
  let state = applyOp(
    tick(
      initialState({
        eventId: "guard-old",
        teamIds: ["a", "b"],
        matchSecret: "synthetic",
      }),
      100,
    ),
    "a",
    { kind: "start" },
  );
  const op = {
    kind: "hunt-cipher" as const,
    targetTeamId: "b",
    generation: 1,
    rung: "caesar" as const,
    recoveredKey: deriveCipherKey(state.seed, "b", 1, "caesar"),
  };
  expect(validateOp(state, "a", op)).toEqual({ ok: true });
  const key = '["cipher","a","b",1,"caesar"]';
  state = { ...state, successfulHunts: [key] };
  const before = buildReplay(state),
    projection = projectForTeam(state, "a");
  const upgraded = migrateState(JSON.parse(JSON.stringify(state)), 10);
  expect(expandSuccessfulHunts(upgraded)).toEqual([key]);
  expect(buildReplay(upgraded)).toEqual(before);
  expect(projectForTeam(upgraded, "a")).toEqual(projection);
  expect(validateOp(upgraded, "a", op).ok).toBe(false);
  expect(validateOp({ ...upgraded, successfulHunts: [] }, "a", op)).toEqual({
    ok: true,
  });
});
