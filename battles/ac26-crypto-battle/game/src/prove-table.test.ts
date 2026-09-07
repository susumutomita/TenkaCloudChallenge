import { test, expect } from "bun:test";
import { chooseProveTable } from "../../portal/prove-table.ts";
import { ALL_PERMUTATIONS } from "./sudoku.ts";
test("automatic relabeling excludes identity and used tables; exhaustion is explicit", () => {
  const seen: (readonly number[])[] = [];
  for (let i = 0; i < 23; i++) {
    const next = chooseProveTable(seen, () => 0)!;
    expect(next).toBeDefined();
    expect(next).not.toEqual([1, 2, 3, 4]);
    expect(seen).not.toContainEqual(next);
    seen.push(next);
  }
  expect(chooseProveTable(seen)).toBeUndefined();
  expect(chooseProveTable(ALL_PERMUTATIONS)).toBeUndefined();
});
test("random choice rejects biased tail of random range", () => {
  let calls = 0;
  const table = chooseProveTable([], () => ++calls === 1 ? 0xffff_ffff : 1);
  expect(calls).toBe(2);
  expect(table).toEqual(chooseProveTable([], () => 1));
  expect(table).not.toEqual(chooseProveTable([], () => 0));
});
