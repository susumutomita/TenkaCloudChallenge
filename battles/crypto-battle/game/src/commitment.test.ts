import { describe, expect, test } from "bun:test";
import {
  commit,
  discreteLog,
  HAND_NAMES,
  HANDS,
  handDifferenceFromReusedRandomness,
  handWork,
  handWorkSteps,
  isHand,
  RPS_GROUP,
  RPS_RANDOMNESS,
  rpsOutcome,
  verifyOpening,
  type Hand,
} from "./commitment.ts";

const { p, q, g, h } = RPS_GROUP;

/** Plain-number modular power, written here so the tests do not trust the module's. */
function pow(base: number, exp: number, modulus: number): number {
  let acc = 1;
  for (let i = 0; i < exp; i += 1) acc = (acc * base) % modulus;
  return acc;
}

function isPrime(n: number): boolean {
  if (n < 2) return false;
  for (let d = 2; d * d <= n; d += 1) if (n % d === 0) return false;
  return true;
}

/** The order-q subgroup, as the set of powers of g. */
const SUBGROUP: readonly number[] = Array.from({ length: q }, (_, e) => pow(g, e, p));

/**
 * [Issue #710] The group facts, computed rather than remembered: the module
 * header argues that 4 and 9 generate the order-11 subgroup of Z_23*, and an
 * argument is not a check.
 */
describe("the group", () => {
  test("p = 23 is a safe prime with q = 11", () => {
    expect(isPrime(p)).toBe(true);
    expect(isPrime(q)).toBe(true);
    expect(p).toBe(2 * q + 1);
  });

  test("g and h both have order exactly q", () => {
    for (const x of [g, h]) {
      expect(x).not.toBe(1);
      expect(pow(x, q, p)).toBe(1);
    }
    expect(g).not.toBe(h);
    expect(new Set(SUBGROUP).size).toBe(q);
  });

  test("log_g h exists and is 8 -- anyone finds it in eleven multiplications", () => {
    const L = discreteLog(h);
    expect(L).toBe(8);
    expect(pow(g, L!, p)).toBe(h);
    // h is none of the visibly related residues: g^2, g^3, g^-1, or the root of g.
    expect([pow(g, 2, p), pow(g, 3, p), pow(g, q - 1, p), 2]).not.toContain(h);
  });

  test("the issue's draft g = 5, h = 7 are non-residues of order 22, not members of the subgroup", () => {
    for (const x of [5, 7]) {
      expect(pow(x, q, p)).toBe(p - 1);
      expect(discreteLog(x)).toBeUndefined();
    }
  });

  test("the hands are 1..3 with their names, and the blinding is all of Z_q", () => {
    expect(HANDS).toEqual([1, 2, 3]);
    expect(HANDS.map((m) => HAND_NAMES[m])).toEqual(["グー", "チョキ", "パー"]);
    expect(HANDS.every(isHand)).toBe(true);
    expect(isHand(0)).toBe(false);
    expect(isHand(4)).toBe(false);
    expect(RPS_RANDOMNESS).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });
});

describe("commit and open", () => {
  test("commit is g^m * h^r mod p, computed independently here", () => {
    for (const m of HANDS)
      for (const r of RPS_RANDOMNESS) {
        expect(commit(m, r)).toBe((pow(g, m, p) * pow(h, r, p)) % p);
      }
  });

  test("every commitment lands in the subgroup", () => {
    for (const m of HANDS) for (const r of RPS_RANDOMNESS) expect(SUBGROUP).toContain(commit(m, r));
  });

  test("an honest opening verifies; a swapped hand with the same r is rejected", () => {
    for (const m of HANDS)
      for (const r of RPS_RANDOMNESS) {
        const c = commit(m, r);
        expect(verifyOpening(c, m, r)).toBe(true);
        for (const other of HANDS) if (other !== m) expect(verifyOpening(c, other, r)).toBe(false);
        expect(verifyOpening(c, m, (r + 1) % q)).toBe(false);
      }
  });

  test("an opening outside the Order's ranges fails instead of throwing", () => {
    const c = commit(1, 3);
    expect(verifyOpening(c, 0, 3)).toBe(false);
    expect(verifyOpening(c, 4, 3)).toBe(false);
    expect(verifyOpening(c, 1, -1)).toBe(false);
    expect(verifyOpening(c, 1, q)).toBe(false);
    expect(verifyOpening(c, 1, 1.5)).toBe(false);
  });

  test("commit itself refuses a hand or blinding outside the ranges", () => {
    expect(() => commit(4 as Hand, 1)).toThrow(RangeError);
    expect(() => commit(1, q)).toThrow(RangeError);
    expect(() => commit(1, -1)).toThrow(RangeError);
  });
});

/**
 * [Issue #710] Hiding and binding, enumerated over all 33 openings. Perfect
 * hiding holds because r ranges over the whole of Z_11; the second test pins
 * the leak that the issue's 1..10 range would have shipped.
 */
describe("hiding", () => {
  test("every element of the subgroup opens to every hand in exactly one way", () => {
    for (const c of SUBGROUP) {
      for (const m of HANDS) {
        const openings = RPS_RANDOMNESS.filter((r) => commit(m, r) === c);
        expect(openings.length).toBe(1);
      }
    }
  });

  test("with r restricted to 1..10, exactly three commitments each rule out exactly one hand", () => {
    const leaky: Array<{ c: number; missing: Hand[] }> = [];
    for (const c of SUBGROUP) {
      const missing = HANDS.filter((m) => !RPS_RANDOMNESS.slice(1).some((r) => commit(m, r) === c));
      if (missing.length > 0) leaky.push({ c, missing });
    }
    expect(leaky).toEqual([
      { c: pow(g, 1, p), missing: [1] },
      { c: pow(g, 2, p), missing: [2] },
      { c: pow(g, 3, p), missing: [3] },
    ]);
  });
});

describe("binding", () => {
  test("for a fixed r, no two hands give the same commitment", () => {
    for (const r of RPS_RANDOMNESS) {
      expect(new Set(HANDS.map((m) => commit(m, r))).size).toBe(HANDS.length);
    }
  });

  test("binding is only computational: with log_g h in hand, a different hand opens the same c", () => {
    // g^m' h^r' = g^m h^r with h = g^L means m' + L r' = m + L r (mod q), so
    // r' = r + (m - m') / L. The inverse of L is found by trial, like L itself.
    const L = discreteLog(h)!;
    const inverseOfL = RPS_RANDOMNESS.find((x) => (L * x) % q === 1)!;
    expect(inverseOfL).toBe(7);
    let equivocations = 0;
    for (const m of HANDS)
      for (const r of RPS_RANDOMNESS) {
        const c = commit(m, r);
        for (const other of HANDS) {
          if (other === m) continue;
          const rPrime = (((r + (m - other) * inverseOfL) % q) + q) % q;
          expect(verifyOpening(c, other, rPrime)).toBe(true);
          equivocations += 1;
        }
      }
    expect(equivocations).toBe(HANDS.length * q * (HANDS.length - 1));
  });
});

describe("the round", () => {
  test("グー beats チョキ, チョキ beats パー, パー beats グー, and a mirror is a draw", () => {
    const table: Array<[Hand, Hand, ReturnType<typeof rpsOutcome>]> = [
      [1, 1, "draw"],
      [1, 2, "first"],
      [1, 3, "second"],
      [2, 1, "second"],
      [2, 2, "draw"],
      [2, 3, "first"],
      [3, 1, "first"],
      [3, 2, "second"],
      [3, 3, "draw"],
    ];
    for (const [m1, m2, want] of table) expect(rpsOutcome(m1, m2)).toBe(want);
  });
});

/**
 * [Issue #710] The mistake and its punishment: reusing r turns two
 * commitments into g^(m1 - m2), which is read off in five tries.
 */
describe("reusing the blinding is what a hunter needs", () => {
  test("the same r leaks m1 - m2 for every pair of hands and every r", () => {
    for (const r of RPS_RANDOMNESS)
      for (const m1 of HANDS)
        for (const m2 of HANDS) {
          expect(handDifferenceFromReusedRandomness(commit(m1, r), commit(m2, r))).toBe(m1 - m2);
        }
  });

  test("with round one opened, the leaked difference is round two's hand", () => {
    const r = 6;
    const m1: Hand = 3;
    const m2: Hand = 1;
    const d = handDifferenceFromReusedRandomness(commit(m1, r), commit(m2, r))!;
    expect(m1 - d).toBe(m2);
    expect(rpsOutcome(2, m2)).toBe("second");
    expect(rpsOutcome(3, m2)).toBe("first");
  });

  test("with different r the detector never returns the true difference", () => {
    let wrong = 0;
    let nothing = 0;
    for (const r1 of RPS_RANDOMNESS)
      for (const r2 of RPS_RANDOMNESS) {
        if (r1 === r2) continue;
        for (const m1 of HANDS)
          for (const m2 of HANDS) {
            const d = handDifferenceFromReusedRandomness(commit(m1, r1), commit(m2, r2));
            expect(d).not.toBe(m1 - m2);
            if (d === undefined) nothing += 1;
            else wrong += 1;
          }
      }
    // 11 * 10 * 9 fresh-blinding pairs; how many of them still look like a leak
    // is what a hunter guessing on a fresh r is up against.
    expect(wrong + nothing).toBe(q * (q - 1) * HANDS.length * HANDS.length);
    expect(wrong).toBeGreaterThan(0);
    expect(nothing).toBeGreaterThan(0);
  });

  test("a value outside the subgroup is not a leak", () => {
    expect(handDifferenceFromReusedRandomness(5, commit(1, 1))).toBeUndefined();
    expect(handDifferenceFromReusedRandomness(commit(1, 1), 0)).toBeUndefined();
  });
});

/**
 * [Issue #710] The whole point: the walkthrough is arithmetic on numbers a
 * person carries in their head. Every reduced intermediate is at most two
 * digits, every unreduced product is at most (p - 1)^2, and the walkthrough
 * ends where `commit` does -- `commit` multiplies in a loop and the
 * walkthrough squares, so agreement is a real check.
 */
describe("the paper walkthrough", () => {
  test("ends with the value commit returns, for every hand and blinding", () => {
    for (const m of HANDS)
      for (const r of RPS_RANDOMNESS) {
        const steps = handWork(m, r);
        expect(steps[steps.length - 1]?.term).toBe("c");
        expect(steps[steps.length - 1]?.value).toBe(commit(m, r));
        expect(handWorkSteps(m, r).length).toBe(steps.length);
      }
  });

  test("every reduced intermediate is at most two digits, every product at most (p - 1)^2", () => {
    let maxDigits = 0;
    let maxProduct = 0;
    let maxLines = 0;
    for (const m of HANDS)
      for (const r of RPS_RANDOMNESS) {
        const steps = handWork(m, r);
        maxLines = Math.max(maxLines, steps.length);
        for (const step of steps) {
          maxDigits = Math.max(maxDigits, String(step.value).length);
          maxProduct = Math.max(maxProduct, step.product);
          if (step.factors) {
            expect(step.factors[0] * step.factors[1]).toBe(step.product);
            expect(step.factors.every((f) => f >= 0 && f < p)).toBe(true);
          }
          expect(step.value).toBe(step.product % p);
        }
      }
    expect(maxDigits).toBe(2);
    expect(maxProduct).toBeLessThanOrEqual((p - 1) ** 2);
    expect(maxLines).toBe(7);
  });

  test("each multiplication line carries a previous line's value forward", () => {
    for (const m of HANDS)
      for (const r of RPS_RANDOMNESS) {
        const steps = handWork(m, r);
        const known = new Map<string, number>();
        for (const step of steps) {
          if (step.using && step.factors) {
            step.using.forEach((term, i) => {
              const expected = known.get(term) ?? (term === String(g) ? g : term === String(h) ? h : undefined);
              expect(expected).toBe(step.factors![i]!);
            });
          }
          known.set(step.term, step.value);
        }
      }
  });

  test("reads as the lines a person writes, with the player's own numbers", () => {
    expect(handWorkSteps(2, 10)).toEqual([
      "4^2 = 4 × 4 = 16",
      "9^2 = 9 × 9 = 81 → mod 23 = 12",
      "9^4 = 9^2 × 9^2 = 12 × 12 = 144 → mod 23 = 6",
      "9^8 = 9^4 × 9^4 = 6 × 6 = 36 → mod 23 = 13",
      "9^10 = 9^8 × 9^2 = 13 × 12 = 156 → mod 23 = 18",
      "c = 4^2 × 9^10 = 16 × 18 = 288 → mod 23 = 12",
    ]);
    expect(commit(2, 10)).toBe(12);
    expect(handWorkSteps(1, 0)).toEqual(["4^1 = 4", "9^0 = 1", "c = 4^1 × 9^0 = 4 × 1 = 4"]);
    expect(handWorkSteps(3, 7)).toEqual([
      "4^2 = 4 × 4 = 16",
      "4^3 = 4^2 × 4 = 16 × 4 = 64 → mod 23 = 18",
      "9^2 = 9 × 9 = 81 → mod 23 = 12",
      "9^4 = 9^2 × 9^2 = 12 × 12 = 144 → mod 23 = 6",
      "9^6 = 9^4 × 9^2 = 6 × 12 = 72 → mod 23 = 3",
      "9^7 = 9^6 × 9 = 3 × 9 = 27 → mod 23 = 4",
      "c = 4^3 × 9^7 = 18 × 4 = 72 → mod 23 = 3",
    ]);
    expect(commit(3, 7)).toBe(3);
  });

  test("refuses a hand or blinding outside the ranges, like commit", () => {
    expect(() => handWork(0 as Hand, 1)).toThrow(RangeError);
    expect(() => handWorkSteps(1, 11)).toThrow(RangeError);
  });
});
