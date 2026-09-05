/**
 * [Issue #709] ZK sudoku on a 4x4 board -- the pure model.
 *
 * PROVE is a zero-knowledge proof of knowing a sudoku solution, the way the
 * course taught it and the way a person can perform it: pick a relabeling
 * `pi` of {1,2,3,4}, apply it to every cell of your solution, and hand the
 * relabeled grid in. The judge (this Battle's trusted reducer) checks the grid
 * is a valid sudoku and that it agrees with the team's PUBLIC puzzle under some
 * relabeling, then publishes ONE constraint -- a row, a column or a box -- of
 * the relabeled grid. Other teams see four cells that are a permutation of
 * 1..4, which every valid grid has, and learn nothing about which of the 288
 * solutions is yours. That is the whole point of the exercise, and it is the
 * point at any board size; 4x4 is the size at which the exercise fits on paper.
 *
 * Nothing here is random and nothing here is secret: the solution is DERIVED
 * from the team's secret by the reducer (`fixtures.ts`), the puzzle is derived
 * from the solution, and the published constraint is chosen from the match
 * seed. This module is arithmetic on 16-cell grids and knows about none of
 * that.
 *
 * ## Why the hunt exists
 *
 * A relabeled row reveals nothing. Several relabeled constraints under the SAME
 * `pi` reveal the whole relabeled grid once they cover every cell -- and the
 * public puzzle then pins `pi` down, which recovers the solution. Reusing `pi`
 * is this Battle's version of reusing a Schnorr nonce, and `hunt-sudoku` is the
 * op that punishes it. `assembleReusedRelabeling` below is the detector.
 */

/** A 4x4 grid, row-major, 16 values each in 1..4. */
export type Grid = readonly number[];

export const SUDOKU_SIZE = 4;
export const SUDOKU_CELLS = SUDOKU_SIZE * SUDOKU_SIZE;
export const SUDOKU_SYMBOLS: readonly number[] = [1, 2, 3, 4];

/**
 * The twelve constraints a 4x4 sudoku has: rows r0..r3, columns c0..c3, boxes
 * b0..b3 (b0 top-left, b1 top-right, b2 bottom-left, b3 bottom-right). Each is
 * the four cell indices it covers, in reading order.
 */
export type ConstraintId =
  | "r0" | "r1" | "r2" | "r3"
  | "c0" | "c1" | "c2" | "c3"
  | "b0" | "b1" | "b2" | "b3";

export const CONSTRAINT_IDS: readonly ConstraintId[] = [
  "r0", "r1", "r2", "r3",
  "c0", "c1", "c2", "c3",
  "b0", "b1", "b2", "b3",
];

export function constraintCells(id: ConstraintId): readonly number[] {
  const n = Number(id[1]);
  switch (id[0]) {
    case "r":
      return [0, 1, 2, 3].map((j) => n * SUDOKU_SIZE + j);
    case "c":
      return [0, 1, 2, 3].map((i) => i * SUDOKU_SIZE + n);
    default: {
      const top = n < 2 ? 0 : 2;
      const left = n % 2 === 0 ? 0 : 2;
      return [0, 1].flatMap((i) => [0, 1].map((j) => (top + i) * SUDOKU_SIZE + left + j));
    }
  }
}

function isPermutationOfSymbols(values: readonly number[]): boolean {
  if (values.length !== SUDOKU_SIZE) return false;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.every((v, i) => v === SUDOKU_SYMBOLS[i]);
}

/** Every row, column and box is a permutation of 1..4, and there are 16 cells. */
export function isValidGrid(grid: readonly number[]): grid is Grid {
  if (grid.length !== SUDOKU_CELLS) return false;
  if (!grid.every((v) => Number.isInteger(v) && v >= 1 && v <= SUDOKU_SIZE)) return false;
  return CONSTRAINT_IDS.every((id) => isPermutationOfSymbols(constraintCells(id).map((i) => grid[i] ?? 0)));
}

/**
 * All 288 valid 4x4 grids, in a fixed order, so "solution number k" means the
 * same grid on every machine and on every run. Built once at module load by
 * trying every combination of four row-permutations (24^4 = 331,776 candidates)
 * -- cheap, and it is the enumeration the tests check rather than a literal
 * someone typed in.
 */
function permutations(values: readonly number[]): number[][] {
  if (values.length <= 1) return [[...values]];
  return values.flatMap((v, i) =>
    permutations([...values.slice(0, i), ...values.slice(i + 1)]).map((rest) => [v, ...rest]),
  );
}

const ROW_PERMUTATIONS = permutations(SUDOKU_SYMBOLS);

export const ALL_SOLUTIONS: readonly Grid[] = (() => {
  const out: Grid[] = [];
  for (const r0 of ROW_PERMUTATIONS)
    for (const r1 of ROW_PERMUTATIONS)
      for (const r2 of ROW_PERMUTATIONS)
        for (const r3 of ROW_PERMUTATIONS) {
          const grid = [...r0, ...r1, ...r2, ...r3];
          if (isValidGrid(grid)) out.push(grid);
        }
  return out;
})();

export const SOLUTION_COUNT = ALL_SOLUTIONS.length;

/** A relabeling of the symbols: `pi[v - 1]` is what `v` becomes. */
export type Relabeling = readonly [number, number, number, number];

export function isRelabeling(pi: readonly number[]): pi is Relabeling {
  return isPermutationOfSymbols(pi);
}

export function relabel(grid: Grid, pi: Relabeling): Grid {
  return grid.map((v) => pi[v - 1] ?? 0);
}

/**
 * The public puzzle: the values at `givenCells` of the solution. Which cells are
 * given is the reducer's decision (derived from the seed); this just reads them.
 */
export type Puzzle = Readonly<Record<number, number>>;

export function puzzleFrom(solution: Grid, givenCells: readonly number[]): Puzzle {
  const out: Record<number, number> = {};
  for (const cell of givenCells) out[cell] = solution[cell] ?? 0;
  return out;
}

/**
 * Does `grid` agree with `puzzle` under SOME relabeling of the symbols?
 *
 * This is the judge's second check, and it is what makes the proof about THIS
 * team's solution rather than about any valid sudoku: two given cells holding
 * the same value must hold the same value in the grid, two holding different
 * values must differ. It does not need to know which relabeling -- only that
 * one exists -- which is exactly the zero-knowledge posture: the judge learns
 * the grid is a relabeling of a solution to the public puzzle, and nothing
 * about which relabeling.
 *
 * Returns the relabeling when there is one (the judge never publishes it).
 */
export function relabelingConsistentWithPuzzle(grid: Grid, puzzle: Puzzle): Relabeling | undefined {
  const pi: number[] = [0, 0, 0, 0];
  const used = new Set<number>();
  for (const [cellText, givenValue] of Object.entries(puzzle)) {
    const cell = Number(cellText);
    const seen = grid[cell];
    if (seen === undefined) return undefined;
    const current = pi[givenValue - 1];
    if (current === 0) {
      if (used.has(seen)) return undefined;
      pi[givenValue - 1] = seen;
      used.add(seen);
    } else if (current !== seen) {
      return undefined;
    }
  }
  // Fill the symbols the puzzle never mentions with whatever is left, so the
  // result is a full relabeling. Any completion is fine: the puzzle does not
  // constrain those symbols, and the caller only asks whether one exists.
  const free = SUDOKU_SYMBOLS.filter((v) => !used.has(v));
  for (let i = 0; i < pi.length; i += 1) if (pi[i] === 0) pi[i] = free.shift() ?? 0;
  return isRelabeling(pi) ? pi : undefined;
}

/** What one PROVE publishes: a constraint and the relabeled values on its cells. */
export interface Opening {
  readonly constraint: ConstraintId;
  /** The four relabeled values, in the order of `constraintCells(constraint)`. */
  readonly values: readonly number[];
}

export function open(grid: Grid, constraint: ConstraintId): Opening {
  return { constraint, values: constraintCells(constraint).map((i) => grid[i] ?? 0) };
}

/**
 * The detector behind `hunt-sudoku`: do these openings, taken together as if
 * they were made under ONE relabeling, determine a complete valid grid?
 *
 * Openings under different relabelings will almost always contradict each other
 * somewhere (the same cell opened twice with different values) or leave cells
 * undetermined. Openings under one reused relabeling that cover all 16 cells
 * assemble into the relabeled solution -- and that is the mistake this detects.
 * The assembled grid is returned so the caller can compare it against a hunter's
 * claim; it is the relabeled solution, not the solution, and un-relabeling it
 * is the hunter's job (the public puzzle is what makes that possible).
 *
 * Returns undefined on a contradiction or an incomplete cover.
 */
export function assembleReusedRelabeling(openings: readonly Opening[]): Grid | undefined {
  const cells: number[] = new Array<number>(SUDOKU_CELLS).fill(0);
  for (const opening of openings) {
    const targets = constraintCells(opening.constraint);
    for (let k = 0; k < targets.length; k += 1) {
      const cell = targets[k] ?? -1;
      const value = opening.values[k] ?? 0;
      const current = cells[cell];
      if (current === 0) cells[cell] = value;
      else if (current !== value) return undefined;
    }
  }
  if (cells.some((v) => v === 0)) return undefined;
  return isValidGrid(cells) ? cells : undefined;
}

/**
 * Un-relabel an assembled grid using the public puzzle: the relabeling that
 * maps the puzzle's given values onto the assembled grid's values at those
 * cells, inverted. This is the hunter's final step, and it is the reason the
 * puzzle has to be public -- without it a fully assembled relabeled grid is
 * still one of 24 candidates.
 */
export function recoverSolution(assembled: Grid, puzzle: Puzzle): Grid | undefined {
  const pi = relabelingConsistentWithPuzzle(assembled, puzzle);
  if (!pi) return undefined;
  const inverse: number[] = [0, 0, 0, 0];
  pi.forEach((to, fromIndex) => {
    inverse[to - 1] = fromIndex + 1;
  });
  if (!isRelabeling(inverse)) return undefined;
  return relabel(assembled, inverse);
}

/** Pretty 4 lines of 4, for hints and narration. */
export function formatGrid(grid: Grid): string {
  const rows: string[] = [];
  for (let r = 0; r < SUDOKU_SIZE; r += 1) {
    rows.push(grid.slice(r * SUDOKU_SIZE, (r + 1) * SUDOKU_SIZE).join(" "));
  }
  return rows.join("\n");
}
