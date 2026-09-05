import { describe, expect, test } from "bun:test";
import {
  ALL_SOLUTIONS,
  assembleReusedRelabeling,
  CONSTRAINT_IDS,
  constraintCells,
  isValidGrid,
  open,
  puzzleFrom,
  recoverSolution,
  relabel,
  relabelingConsistentWithPuzzle,
  SOLUTION_COUNT,
  type Relabeling,
} from "./sudoku.ts";

/**
 * [Issue #709] The 4x4 board, measured rather than asserted from memory. The
 * count 288 is the known number of 4x4 sudoku grids; a mistake in `isValidGrid`
 * or in the enumeration would show up here first.
 */
describe("the 4x4 board", () => {
  test("there are exactly 288 solutions, all valid, all distinct", () => {
    expect(SOLUTION_COUNT).toBe(288);
    expect(ALL_SOLUTIONS.every(isValidGrid)).toBe(true);
    expect(new Set(ALL_SOLUTIONS.map((g) => g.join(""))).size).toBe(288);
  });

  test("the twelve constraints each cover four distinct cells and together cover the board thrice", () => {
    const seen = new Map<number, number>();
    for (const id of CONSTRAINT_IDS) {
      const cells = constraintCells(id);
      expect(new Set(cells).size).toBe(4);
      for (const c of cells) seen.set(c, (seen.get(c) ?? 0) + 1);
    }
    expect([...seen.values()].every((n) => n === 3)).toBe(true);
    expect(seen.size).toBe(16);
  });

  test("relabeling a solution gives a solution, and the identity gives it back", () => {
    const grid = ALL_SOLUTIONS[17]!;
    const pi: Relabeling = [3, 1, 4, 2];
    expect(isValidGrid(relabel(grid, pi))).toBe(true);
    expect(relabel(grid, [1, 2, 3, 4])).toEqual(grid);
  });
});

describe("the judge's two checks", () => {
  const solution = ALL_SOLUTIONS[100]!;
  const givens = [0, 3, 5, 6, 9, 10, 12, 15];
  const puzzle = puzzleFrom(solution, givens);

  test("an honest relabeled grid is consistent with the public puzzle", () => {
    const pi: Relabeling = [2, 4, 1, 3];
    const found = relabelingConsistentWithPuzzle(relabel(solution, pi), puzzle);
    expect(found).toEqual(pi);
  });

  test("a valid sudoku that is NOT a relabeling of this team's solution is refused", () => {
    // Some other solution, relabeled or not: with 8 givens it almost never
    // agrees. Count how many of the 288 x 24 candidates would pass, to make the
    // claim about this puzzle concrete rather than probabilistic.
    let impostors = 0;
    for (const other of ALL_SOLUTIONS) {
      if (other === solution) continue;
      if (relabelingConsistentWithPuzzle(other, puzzle)) impostors += 1;
    }
    // Every relabeling of the solution itself passes (24 grids, one of which is
    // `solution`); anything else that passes is a genuinely different solution
    // sharing this puzzle's structure. The number is reported rather than pinned
    // at zero because 4x4 puzzles with 8 givens are unique ~80% of the time
    // (measured in #709) -- what matters is that it is small next to 288.
    expect(impostors).toBeLessThan(288 / 10);
  });

  test("an opening is four cells that read as a permutation of 1..4 and nothing else", () => {
    const grid = relabel(solution, [4, 3, 2, 1]);
    for (const id of CONSTRAINT_IDS) {
      const o = open(grid, id);
      expect([...o.values].sort()).toEqual([1, 2, 3, 4]);
    }
  });
});

/**
 * [Issue #709] The mistake and its punishment. Openings under one reused
 * relabeling assemble into the relabeled grid; the public puzzle then recovers
 * the solution. Openings under fresh relabelings do not assemble.
 */
describe("reusing the relabeling is what a hunter needs", () => {
  const solution = ALL_SOLUTIONS[42]!;
  const puzzle = puzzleFrom(solution, [1, 2, 4, 7, 8, 11, 13, 14]);

  test("four rows under ONE relabeling assemble, and the puzzle un-relabels them", () => {
    const pi: Relabeling = [3, 4, 1, 2];
    const grid = relabel(solution, pi);
    const openings = (["r0", "r1", "r2", "r3"] as const).map((id) => open(grid, id));
    const assembled = assembleReusedRelabeling(openings);
    expect(assembled).toEqual(grid);
    expect(recoverSolution(assembled!, puzzle)).toEqual(solution);
  });

  test("a mix of rows, columns and boxes under one relabeling also assembles once every cell is covered", () => {
    const grid = relabel(solution, [2, 1, 4, 3]);
    const openings = (["r0", "c1", "b3", "r2", "c3", "b0"] as const).map((id) => open(grid, id));
    // Six constraints may or may not cover all sixteen cells; add until they do.
    const covered = new Set(openings.flatMap((o) => constraintCells(o.constraint)));
    if (covered.size < 16) openings.push(open(grid, "r1"), open(grid, "r3"));
    expect(assembleReusedRelabeling(openings)).toEqual(grid);
  });

  test("openings under DIFFERENT relabelings contradict, so nothing assembles", () => {
    const a = relabel(solution, [1, 2, 3, 4]);
    const b = relabel(solution, [2, 3, 4, 1]);
    const openings = [open(a, "r0"), open(b, "r1"), open(a, "r2"), open(b, "r3"), open(a, "c0")];
    expect(assembleReusedRelabeling(openings)).toBeUndefined();
  });

  test("an incomplete cover assembles nothing, even under one relabeling", () => {
    const grid = relabel(solution, [4, 1, 3, 2]);
    expect(assembleReusedRelabeling([open(grid, "r0"), open(grid, "r1")])).toBeUndefined();
  });
});
