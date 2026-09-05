/**
 * [Issue #709] The 4x4 sudoku the PROVE is built on: the enumeration, the
 * relabelling algebra, and the seed-driven derivations `fixtures.ts` builds on
 * top of it. Everything the judge relies on is pinned here, not assumed.
 */

import { describe, expect, test } from "bun:test";
import {
  derivePermutationTag,
  deriveRevealGroup,
  deriveSudokuPuzzle,
  deriveSudokuSolution,
} from "./fixtures.ts";
import {
  ALL_PERMUTATIONS,
  ALL_SOLUTIONS,
  applyPermutation,
  CONSTRAINT_GROUP_COUNT,
  CONSTRAINT_GROUPS,
  consistentUnderRelabelling,
  describeGroup,
  IDENTITY_PERMUTATION,
  isFullGridShape,
  isPermutation,
  isValidSolution,
  permutationBetween,
  samePermutation,
  solutionsConsistentWith,
  SUDOKU_CELLS,
  SUDOKU_GIVEN_COUNT,
} from "./sudoku.ts";

describe("the enumeration", () => {
  test("there are exactly 288 solutions, every one valid, no duplicates", () => {
    // 288 is the known count of 4x4 sudoku grids. A wrong enumeration would
    // silently give some teams no solution or two teams the same one.
    expect(ALL_SOLUTIONS).toHaveLength(288);
    for (const s of ALL_SOLUTIONS) expect(isValidSolution(s)).toBe(true);
    expect(new Set(ALL_SOLUTIONS.map((s) => s.join(""))).size).toBe(288);
  });

  test("the twelve constraint groups are four rows, four columns and four boxes", () => {
    expect(CONSTRAINT_GROUP_COUNT).toBe(12);
    for (const cells of CONSTRAINT_GROUPS) expect(cells).toHaveLength(4);
    expect(describeGroup(0)).toEqual({ kind: "row", index: 0 });
    expect(describeGroup(5)).toEqual({ kind: "column", index: 1 });
    expect(describeGroup(11)).toEqual({ kind: "box", index: 3 });
    // Every cell sits in exactly one row, one column and one box.
    for (let cell = 0; cell < SUDOKU_CELLS; cell += 1) {
      expect(CONSTRAINT_GROUPS.filter((g) => g.includes(cell))).toHaveLength(3);
    }
  });

  test("a grid that breaks one group is not a solution", () => {
    const [first] = ALL_SOLUTIONS;
    if (!first) throw new Error("no solutions");
    const broken = [...first];
    broken[0] = broken[1] as number;
    expect(isFullGridShape(broken)).toBe(true);
    expect(isValidSolution(broken)).toBe(false);
  });

  test("shape checks refuse anything that is not 16 digits in 1..4", () => {
    expect(isFullGridShape(new Array(16).fill(1))).toBe(true);
    expect(isFullGridShape(new Array(15).fill(1))).toBe(false);
    expect(isFullGridShape([...new Array(15).fill(1), 5])).toBe(false);
    expect(isFullGridShape([...new Array(15).fill(1), 0])).toBe(false);
    expect(isFullGridShape([...new Array(15).fill(1), "1"])).toBe(false);
    expect(isFullGridShape("1111111111111111")).toBe(false);
  });
});

describe("relabelling", () => {
  test("there are 24 relabellings, all bijections, one of them the identity", () => {
    expect(ALL_PERMUTATIONS).toHaveLength(24);
    for (const pi of ALL_PERMUTATIONS) expect(isPermutation(pi)).toBe(true);
    expect(ALL_PERMUTATIONS.filter((pi) => samePermutation(pi, IDENTITY_PERMUTATION))).toHaveLength(1);
    expect(isPermutation([1, 1, 2, 3])).toBe(false);
    expect(isPermutation([1, 2, 3])).toBe(false);
  });

  test("a relabelled solution is still a solution -- the property PROVE rests on", () => {
    for (const s of ALL_SOLUTIONS) {
      for (const pi of ALL_PERMUTATIONS) expect(isValidSolution(applyPermutation(s, pi))).toBe(true);
    }
  });

  test("permutationBetween recovers exactly the relabelling that was applied", () => {
    const [s] = ALL_SOLUTIONS;
    if (!s) throw new Error("no solutions");
    for (const pi of ALL_PERMUTATIONS) {
      const recovered = permutationBetween(s, applyPermutation(s, pi));
      expect(recovered).toBeDefined();
      expect(samePermutation(recovered ?? [], pi)).toBe(true);
    }
  });

  test("permutationBetween refuses a grid that is not a relabelling of the source", () => {
    const [s, other] = ALL_SOLUTIONS;
    if (!s || !other) throw new Error("no solutions");
    // A different solution is (almost always) not a relabelling of this one.
    const relabellings = new Set(ALL_PERMUTATIONS.map((pi) => applyPermutation(s, pi).join("")));
    const unrelated = ALL_SOLUTIONS.find((candidate) => !relabellings.has(candidate.join("")));
    if (!unrelated) throw new Error("expected a solution outside this orbit");
    expect(permutationBetween(s, unrelated)).toBeUndefined();
    // Fifteen cells right and one wrong is not a proof either.
    const nearly = applyPermutation(s, [2, 3, 4, 1]);
    nearly[15] = nearly[15] === 1 ? 2 : 1;
    expect(permutationBetween(s, nearly)).toBeUndefined();
  });

  test("consistentUnderRelabelling is what a verifier WITHOUT the solution could check", () => {
    const seed = "sudoku-consistency";
    const solution = deriveSudokuSolution(seed, "t", 1);
    const puzzle = deriveSudokuPuzzle(seed, "t", 1, solution);
    for (const pi of ALL_PERMUTATIONS) {
      expect(consistentUnderRelabelling(puzzle, applyPermutation(solution, pi))).toBe(true);
    }
    // Two givens that differ in the puzzle but coincide in the grid: refused.
    const givens = puzzle.map((v, i) => (v === 0 ? -1 : i)).filter((i) => i >= 0);
    const [a, b] = givens.filter((i) => puzzle[i] !== puzzle[givens[0] ?? 0]).length > 0
      ? [givens[0] as number, givens.find((i) => puzzle[i] !== puzzle[givens[0] ?? 0]) as number]
      : [givens[0] as number, givens[1] as number];
    const grid = applyPermutation(solution, [2, 3, 4, 1]);
    grid[b] = grid[a] as number;
    expect(consistentUnderRelabelling(puzzle, grid)).toBe(false);
  });
});

describe("what the seed derives", () => {
  const seed = "s".repeat(64);

  test("a team's solution is a real solution, and differs by team and by generation", () => {
    const a1 = deriveSudokuSolution(seed, "teamA", 1);
    const b1 = deriveSudokuSolution(seed, "teamB", 1);
    const a2 = deriveSudokuSolution(seed, "teamA", 2);
    for (const s of [a1, b1, a2]) expect(isValidSolution(s)).toBe(true);
    expect(a1.join("")).not.toBe(b1.join(""));
    expect(a1.join("")).not.toBe(a2.join(""));
    // Deterministic: the same inputs pick the same grid every time.
    expect(deriveSudokuSolution(seed, "teamA", 1)).toEqual(a1);
  });

  test("the puzzle shows exactly SUDOKU_GIVEN_COUNT cells of the solution and hides the rest", () => {
    const solution = deriveSudokuSolution(seed, "teamA", 1);
    const puzzle = deriveSudokuPuzzle(seed, "teamA", 1, solution);
    expect(puzzle).toHaveLength(SUDOKU_CELLS);
    expect(puzzle.filter((v) => v !== 0)).toHaveLength(SUDOKU_GIVEN_COUNT);
    puzzle.forEach((v, i) => {
      if (v !== 0) expect(solution[i]).toBe(v);
    });
    // The solution is always among the puzzle's consistent solutions.
    expect(solutionsConsistentWith(puzzle).some((s) => s.join("") === solution.join(""))).toBe(true);
  });

  test("eight givens pin a unique solution most of the time -- measured, and recorded, not required", () => {
    // The Order does not depend on the puzzle being hard (see fixtures.ts), so
    // this records the rate rather than asserting a threshold that would turn
    // a shuffle change into a failure for no game reason.
    let unique = 0;
    const trials = 200;
    for (let i = 0; i < trials; i += 1) {
      const puzzle = deriveSudokuPuzzle(`uniqueness-${i}`, "team", 1);
      if (solutionsConsistentWith(puzzle).length === 1) unique += 1;
    }
    // Sanity floor only: below half, "usually unique" would be a false claim
    // in the fixtures.ts comment and the participant copy that repeats it.
    expect(unique / trials).toBeGreaterThan(0.5);
  });

  test("the group the judge opens is one of the twelve, bound to the Order id", () => {
    const seen = new Set<number>();
    for (let i = 0; i < 200; i += 1) {
      const group = deriveRevealGroup(seed, `teamA-c${i}`);
      expect(group).toBeGreaterThanOrEqual(0);
      expect(group).toBeLessThan(CONSTRAINT_GROUP_COUNT);
      seen.add(group);
    }
    // Every kind of group gets opened over a match -- rows, columns, boxes --
    // or the reuse HUNT could not line reveals up across a whole grid.
    expect(seen.size).toBe(CONSTRAINT_GROUP_COUNT);
    expect(deriveRevealGroup(seed, "teamA-c1")).toBe(deriveRevealGroup(seed, "teamA-c1"));
  });

  test("the judge avoids a group this generation already opened, until all twelve are", () => {
    const opened = new Set<number>();
    for (let i = 0; i < CONSTRAINT_GROUP_COUNT; i += 1) {
      const group = deriveRevealGroup(seed, `teamA-c${i}`, opened);
      expect(opened.has(group)).toBe(false);
      opened.add(group);
    }
    expect(opened.size).toBe(CONSTRAINT_GROUP_COUNT);
    // Everything open: the pick falls back to the whole set rather than failing.
    const fallback = deriveRevealGroup(seed, "teamA-c99", opened);
    expect(fallback).toBeGreaterThanOrEqual(0);
    expect(fallback).toBeLessThan(CONSTRAINT_GROUP_COUNT);
  });

  test("a tag names a relabelling without revealing it", () => {
    const tags = ALL_PERMUTATIONS.map((pi) => derivePermutationTag(seed, "teamA", 1, pi));
    // Distinct relabellings, distinct tags: equality of tags means equality of π.
    expect(new Set(tags).size).toBe(24);
    // The same relabelling under a different seed, team or generation tags
    // differently, so a tag cannot be looked up without the seed.
    const pi = ALL_PERMUTATIONS[5] as readonly number[];
    expect(derivePermutationTag("other-seed", "teamA", 1, pi)).not.toBe(tags[5]);
    expect(derivePermutationTag(seed, "teamB", 1, pi)).not.toBe(tags[5]);
    expect(derivePermutationTag(seed, "teamA", 2, pi)).not.toBe(tags[5]);
    // Short, so the ledger row stays small: twelve hex characters.
    for (const tag of tags) expect(tag).toMatch(/^[0-9a-f]{12}$/);
  });
});
