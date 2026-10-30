import { power, scalar } from "../game/src/schnorr.ts";

interface Witness { readonly x: number; readonly r: number; readonly recovered?: true }
interface Statement { readonly y: number; readonly pending?: { readonly y: number; readonly a: number } }

/** The exponent whose power of 2 is `value`; this tiny model makes the table search possible. */
function exponentOf(value: number): number | undefined {
  return Array.from({ length: 11 }, (_, i) => i).find(i => power(2, i) === value);
}

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
  if (proof.pending) {
    // A reload in another tab or device loses this tab's notes. The accepted a still fixes r,
    // and the same power table that finds x from y finds r, so the proof can be finished.
    const x = exponentOf(proof.pending.y);
    const r = exponentOf(proof.pending.a);
    return x === undefined || r === undefined ? undefined : { x, r, recovered: true };
  }
  const x = exponentOf(proof.y);
  return x === undefined ? undefined : { x, r: draw() };
}
