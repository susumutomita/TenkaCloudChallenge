import { describe, expect, test } from "bun:test";
import { deriveBigInt, deriveBytes, deriveStream } from "./prng.ts";

const P101 = 101n;

describe("determinism", () => {
  test("same (seed, label, counter) always derives the same value", () => {
    const a = deriveBigInt("match-42", "secret:teamA:1", 0, P101);
    const b = deriveBigInt("match-42", "secret:teamA:1", 0, P101);
    expect(a).toBe(b);
  });

  test("deriveBytes is stable across repeated calls", () => {
    expect(deriveBytes("s", "l", 3).equals(deriveBytes("s", "l", 3))).toBe(true);
  });

  test("deriveStream is exactly deriveBigInt for counters 0..count-1", () => {
    const stream = deriveStream("seed-x", "coeffs:teamB:1", 4, P101);
    for (let i = 0; i < stream.length; i += 1) {
      expect(stream[i]).toBe(deriveBigInt("seed-x", "coeffs:teamB:1", i, P101));
    }
  });
});

describe("independence", () => {
  test("different seeds derive different values (overwhelmingly likely)", () => {
    const a = deriveBigInt("seed-1", "label", 0, P101);
    const b = deriveBigInt("seed-2", "label", 0, P101);
    expect(a).not.toBe(b);
  });

  test("different labels from the same seed derive different streams", () => {
    const a = deriveBigInt("seed", "secret:teamA:1", 0, P101);
    const b = deriveBigInt("seed", "coeffs:teamA:1", 0, P101);
    expect(a).not.toBe(b);
  });

  test("different counters walk to different values", () => {
    const stream = deriveStream("seed", "label", 20, P101);
    expect(new Set(stream).size).toBeGreaterThan(1);
  });

  test("every derived value is in the canonical range [0, p)", () => {
    for (const v of deriveStream("range-check", "label", 50, P101)) {
      expect(v >= 0n && v < P101).toBe(true);
    }
  });
});

describe("input validation", () => {
  test("deriveStream rejects a negative count", () => {
    expect(() => deriveStream("s", "l", -1, P101)).toThrow();
  });

  test("deriveStream(count=0) returns an empty array", () => {
    expect(deriveStream("s", "l", 0, P101)).toEqual([]);
  });
});
