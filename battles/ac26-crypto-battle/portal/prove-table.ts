import { ALL_PERMUTATIONS, type Permutation } from "../game/src/sudoku.ts";

/** Private random relabeling; the first unused table would be predictable. */
export function chooseProveTable(used: readonly Permutation[], draw: () => number = () => crypto.getRandomValues(new Uint32Array(1))[0]!): Permutation | undefined {
  const available = ALL_PERMUTATIONS.filter(table => table.some((to, i) => to !== i + 1)
    && !used.some(previous => previous.every((to, i) => to === table[i])));
  if (!available.length) return undefined;
  const bound = Math.floor(0x1_0000_0000 / available.length) * available.length;
  let value: number;
  do { value = draw(); } while (value >= bound);
  return available[value % available.length];
}
