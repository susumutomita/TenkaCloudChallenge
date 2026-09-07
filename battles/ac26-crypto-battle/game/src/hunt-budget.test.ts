import { expect, test } from "bun:test";
import {
  changeHuntCount,
  expandHuntAttempts,
  huntCount,
  packHuntAttempts,
} from "./hunt-budget.ts";
import { huntKey, storedHuntKey } from "./hunt-key.ts";
import { initialState, migrateState, projectForTeam } from "./reducer.ts";
import { storeLastHunt, readLastHunt } from "./hunt-result.ts";
import type { CryptoBattleState, LastHunt } from "./types.ts";

test("both independent counters and arbitrary safe legacy counts survive packing, JSON and roster reordering", () => {
  const base = initialState({
    eventId: "budget-codec",
    teamIds: ["a|b", "a", "b|c", "c"],
  });
  const counters = {
    "[0,1,1]": 3,
    '["sudoku",0,1,1]': 2,
    "[1,0,2]": 65,
    '["sudoku",2,3,40]': Number.MAX_SAFE_INTEGER,
  };
  const legacy = { ...base, huntAttempts: counters };
  const packed = { ...legacy, huntAttempts: packHuntAttempts(legacy) };
  const restored: CryptoBattleState = JSON.parse(
    JSON.stringify({
      ...packed,
      teams: Object.fromEntries(Object.entries(packed.teams).reverse()),
    }),
  );
  expect(expandHuntAttempts(restored)).toEqual(counters);
  for (const [key, count] of Object.entries(counters))
    expect(huntCount(restored, key)).toBe(count);
  const changed = {
    ...restored,
    huntAttempts: changeHuntCount(restored, "[0,1,1]", -1),
  };
  expect(huntCount(changed, "[0,1,1]")).toBe(2);
  expect(huntCount(changed, '["sudoku",0,1,1]')).toBe(2);
  expect(huntCount(changed, "[1,0,2]")).toBe(65);
  expect(() => changeHuntCount(changed, '["sudoku",2,3,40]', 1)).toThrow();
  expect(() => changeHuntCount(changed, "[0,2,1]", -1)).toThrow();
  expect(
    expandHuntAttempts(migrateState(JSON.parse(JSON.stringify(legacy)), 10)),
  ).toEqual(counters);
  expect(legacy.huntAttempts).toEqual(counters);
});

test("stored budget rows reject malformed identities, digits, widths, duplicate styles and changed roster sizes", () => {
  const base = initialState({ eventId: "budget-reject", teamIds: ["a", "b"] });
  for (const huntAttempts of [
    { "b:1:1": [0, "AAAA"] },
    { "b:1:1": [1, "AAA"] },
    { "b:1:1": [1, "AAA!"] },
    { "b:01:1": [1, "AAAA"] },
    { "b:2:1": [1, "AAAA"] },
    { "b:1:0": [1, "AAAA"] },
    { "b:1:1": [1, "BAAA"], "[0,1,1]": 1 },
    { "b:1:1": [1, "AAAA"], "[0,1,1]": 0 },
    { "b:1:1": 3 },
  ])
    expect(() =>
      expandHuntAttempts({
        ...base,
        huntAttempts,
      } as unknown as CryptoBattleState),
    ).toThrow();
  const key = storedHuntKey(base, huntKey("a", "b", 1));
  const packed = { ...base, huntAttempts: changeHuntCount(base, key, 1) };
  expect(projectForTeam(packed, "a").huntAttempts.b?.spent).toBe(1);
  const once = { ...packed, huntAttempts: changeHuntCount(packed, key, -1) };
  expect(once.huntAttempts).toEqual({});
  expect(projectForTeam(once, "a").huntAttempts.b?.spent).toBe(0);
});

test("latest verdict compaction preserves every method, zero-floor miss and unknown legacy points", () => {
  const state = initialState({ eventId: "result-codec", teamIds: ["a", "b"] });
  for (const via of [undefined, "sudoku", "rotor"] as const)
    for (const outcome of ["hit", "miss"] as const)
      for (const points of [undefined, 0, -8, 25]) {
        const result: LastHunt = {
          targetTeamId: "b",
          generation: 7,
          outcome,
          ...(via ? { via } : {}),
          ...(points === undefined ? {} : { points }),
        };
        const stored = storeLastHunt(state, result);
        const reversed = {
          ...state,
          teams: { b: state.teams.b!, a: state.teams.a! },
        };
        expect(
          readLastHunt(reversed, JSON.parse(JSON.stringify(stored))),
        ).toEqual(result);
        expect(readLastHunt(reversed, result)).toEqual(result);
      }
  for (const bad of [
    [2, 1, 0, 1, 25],
    [1, 0, 0, 1, 25],
    [1, 1, 9, 1, 25],
    [1, 1, 0, 7, 25],
    [1, 1, 0, 1, Infinity],
  ])
    expect(() => readLastHunt(state, bad as never)).toThrow();
});
