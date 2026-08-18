import { describe, expect, test } from "bun:test";
import { mod } from "./field.ts";
import { completeShares, reconstruct, share, type Share } from "./shamir.ts";

const P101 = 101n;

/** All k-element subsets of `items`, order preserved within each subset. */
function combinations<T>(items: readonly T[], k: number): T[][] {
  if (k === 0) return [[]];
  if (items.length < k) return [];
  const [head, ...rest] = items;
  const withHead = combinations(rest, k - 1).map((c) => [head as T, ...c]);
  const withoutHead = combinations(rest, k);
  return [...withHead, ...withoutHead];
}

describe("share / reconstruct round trip", () => {
  test("every 3-of-5 subset reconstructs the same secret (worked small-prime example)", () => {
    const t = 3;
    const n = 5;
    const secret = 5n;
    const coeffs = [7n, 13n]; // f(x) = 5 + 7x + 13x^2 (mod 101)
    const shares = share(secret, t, n, coeffs, P101);
    expect(shares).toHaveLength(n);

    const subsets = combinations(shares, t);
    expect(subsets).toHaveLength(10); // C(5,3)
    for (const subset of subsets) {
      expect(reconstruct(subset, P101)).toBe(secret);
    }
  });

  test("holds under the default field P and threshold/n from the battle config", () => {
    const t = 3;
    const n = 5;
    const secret = 123456789012345n;
    const coeffs = [999999999n, 42n];
    const shares = share(secret, t, n, coeffs);
    for (const subset of combinations(shares, t)) {
      expect(reconstruct(subset)).toBe(mod(secret));
    }
  });

  test("a full n-of-n set also reconstructs correctly", () => {
    const shares = share(77n, 2, 4, [5n], P101);
    expect(reconstruct(shares, P101)).toBe(77n);
  });

  test("secret 0 and secret p-1 are handled like any other field element", () => {
    for (const secret of [0n, P101 - 1n]) {
      const shares = share(secret, 3, 5, [1n, 2n], P101);
      expect(reconstruct(shares.slice(0, 3), P101)).toBe(secret);
    }
  });
});

describe("input validation", () => {
  test("share() rejects a coefficient count that does not match threshold - 1", () => {
    expect(() => share(5n, 3, 5, [1n], P101)).toThrow();
    expect(() => share(5n, 3, 5, [1n, 2n, 3n], P101)).toThrow();
  });

  test("share() rejects n < t", () => {
    expect(() => share(5n, 4, 3, [1n, 2n, 3n], P101)).toThrow();
  });

  test("reconstruct() rejects a duplicate share index", () => {
    const dup: Share[] = [
      { index: 1, value: 10n },
      { index: 1, value: 20n },
      { index: 2, value: 30n },
    ];
    expect(() => reconstruct(dup, P101)).toThrow();
  });

  test("reconstruct() rejects an empty share list", () => {
    expect(() => reconstruct([], P101)).toThrow();
  });
});

describe("completeShares (threshold counterexample construction)", () => {
  test("for fixed t-1 partial shares, an arbitrary candidate secret can be completed and reconstructs to itself", () => {
    const partial: Share[] = [
      { index: 1, value: 11n },
      { index: 2, value: 22n },
    ]; // t - 1 = 2 points, threshold t = 3
    for (let candidate = 0n; candidate < P101; candidate += 1n) {
      const evaluator = completeShares(partial, candidate, P101);
      const full: Share[] = [...partial, { index: 3, value: evaluator(3) }];
      expect(reconstruct(full, P101)).toBe(candidate);
    }
  });

  test("two different candidates from the same partial shares are mutually consistent but distinct", () => {
    const partial: Share[] = [{ index: 5, value: 40n }];
    const a = completeShares(partial, 0n, P101);
    const b = completeShares(partial, 40n, P101);
    // Same evaluation point, different candidate secrets -> generally different completions.
    expect(a(9)).not.toBe(b(9));
    expect(reconstruct([...partial, { index: 9, value: a(9) }], P101)).toBe(0n);
    expect(reconstruct([...partial, { index: 9, value: b(9) }], P101)).toBe(40n);
  });

  test("rejects a partial share that collides with the implicit index 0 (the candidate secret's point)", () => {
    const partial: Share[] = [{ index: 0, value: 1n }];
    expect(() => completeShares(partial, 5n, P101)).toThrow();
  });

  test("rejects duplicate indices within the partial shares themselves", () => {
    const partial: Share[] = [
      { index: 1, value: 1n },
      { index: 1, value: 2n },
    ];
    expect(() => completeShares(partial, 5n, P101)).toThrow();
  });
});
