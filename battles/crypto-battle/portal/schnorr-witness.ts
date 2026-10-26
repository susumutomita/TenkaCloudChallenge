import { power, scalar } from "../game/src/schnorr.ts";

interface Witness { readonly x: number; readonly r: number }
interface Statement { readonly y: number; readonly pending?: { readonly y: number; readonly a: number } }

/** A calculation belongs to its Order, including before the first submission. */
export function schnorrWitness(proof: Statement, stored: string | null, draw: () => number): Witness | undefined {
  if (stored) {
    try {
      const saved = JSON.parse(stored);
      if (saved && scalar(saved.x) && scalar(saved.r) && power(2, saved.x) === proof.y &&
          (!proof.pending || (power(2, saved.x) === proof.pending.y && power(2, saved.r) === proof.pending.a))) {
        return { x: saved.x, r: saved.r };
      }
    } catch { /* Invalid browser notes cannot replace an accepted commitment. */ }
  }
  if (proof.pending) return undefined;
  const x = Array.from({ length: 11 }, (_, i) => i).find(i => power(2, i) === proof.y);
  return x === undefined ? undefined : { x, r: draw() };
}
