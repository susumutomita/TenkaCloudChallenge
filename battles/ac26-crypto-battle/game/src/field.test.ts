import { describe, expect, test } from "bun:test";
import { add, inv, mod, mul, P, pow, sub } from "./field.ts";

describe("mod", () => {
  test("normalizes negative values into [0, p)", () => {
    expect(mod(-1n, 101n)).toBe(100n);
    expect(mod(-105n, 101n)).toBe(97n); // matches ac26-w2-secret-sharing's worked example
  });

  test("leaves already-canonical values untouched", () => {
    expect(mod(42n, 101n)).toBe(42n);
    expect(mod(0n, 101n)).toBe(0n);
  });
});

describe("add / sub / mul", () => {
  test("wrap around the modulus", () => {
    expect(add(70n, 40n, 101n)).toBe(9n); // 110 % 101
    expect(sub(5n, 110n, 101n)).toBe(97n);
    expect(mul(70n, 40n, 101n)).toBe(73n); // 2800 % 101
  });

  test("sub is the inverse of add", () => {
    for (let a = 0n; a < 101n; a += 7n) {
      for (let b = 0n; b < 101n; b += 11n) {
        expect(sub(add(a, b, 101n), b, 101n)).toBe(mod(a, 101n));
      }
    }
  });
});

describe("pow", () => {
  test("matches repeated multiplication for small exponents", () => {
    expect(pow(2n, 10n, 101n)).toBe(mod(1024n, 101n));
    expect(pow(3n, 0n, 101n)).toBe(1n);
    expect(pow(0n, 5n, 101n)).toBe(0n);
  });

  test("rejects a negative exponent", () => {
    expect(() => pow(2n, -1n, 101n)).toThrow();
  });
});

describe("inv", () => {
  test("matches the textbook example (inv(3, 101) = 34)", () => {
    expect(inv(3n, 101n)).toBe(34n);
    expect(mod(3n * 34n, 101n)).toBe(1n);
  });

  test("a * inv(a) === 1 for a sweep of nonzero elements, small prime", () => {
    const p = 101n;
    for (let a = 1n; a < p; a += 1n) {
      expect(mul(a, inv(a, p), p)).toBe(1n);
    }
  });

  test("a * inv(a) === 1 under the default Mersenne prime P", () => {
    const samples = [1n, 2n, 3n, 42n, 1234567n, P - 1n, P - 2n];
    for (const a of samples) {
      expect(mul(a, inv(a), P)).toBe(1n);
    }
  });

  test("inv(a) is its own two-sided inverse: inv(inv(a)) === a", () => {
    const p = 101n;
    for (let a = 1n; a < p; a += 1n) {
      expect(inv(inv(a, p), p)).toBe(mod(a, p));
    }
  });

  test("rejects zero (no multiplicative inverse)", () => {
    expect(() => inv(0n, 101n)).toThrow();
    expect(() => inv(101n, 101n)).toThrow(); // 101 mod 101 === 0
  });
});
