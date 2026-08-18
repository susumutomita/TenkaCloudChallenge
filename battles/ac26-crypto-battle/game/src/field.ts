/**
 * BigInt arithmetic over F_p (prime field).
 *
 * Every function is pure and total for a > 0 prime p: no `Date.now()`, no
 * `Math.random()`, no I/O. This is deliberate -- the whole game/ package is a
 * trusted-side pure reducer (see reducer.ts header) and cryptographic
 * correctness must never depend on wall-clock or platform randomness.
 *
 * Default prime: P = 2^61 - 1, a Mersenne prime. Large enough that brute-force
 * guessing a secret is infeasible for the playtest match length, small enough
 * that every value fits in a single 64-bit-ish BigInt limb (no performance
 * cost from arbitrary-precision arithmetic in a hot reducer path).
 */

/** Default field modulus: the Mersenne prime 2^61 - 1. */
export const P = 2n ** 61n - 1n;

/** Reduce `a` into the canonical representative range [0, p). */
export function mod(a: bigint, p: bigint = P): bigint {
  const r = a % p;
  return r < 0n ? r + p : r;
}

export function add(a: bigint, b: bigint, p: bigint = P): bigint {
  return mod(a + b, p);
}

export function sub(a: bigint, b: bigint, p: bigint = P): bigint {
  return mod(a - b, p);
}

export function mul(a: bigint, b: bigint, p: bigint = P): bigint {
  return mod(a * b, p);
}

/** Modular exponentiation by repeated squaring. `exp` must be >= 0. */
export function pow(base: bigint, exp: bigint, p: bigint = P): bigint {
  if (exp < 0n) {
    throw new RangeError(`field.pow: negative exponent ${exp} (use inv() first)`);
  }
  let result = 1n;
  let b = mod(base, p);
  let e = exp;
  while (e > 0n) {
    if (e & 1n) result = mul(result, b, p);
    b = mul(b, b, p);
    e >>= 1n;
  }
  return result;
}

/**
 * Modular multiplicative inverse via the extended Euclidean algorithm.
 *
 * Deliberately not Fermat's little theorem (`pow(a, p-2, p)`) -- the extended
 * Euclidean algorithm works for any modulus (not only primes) and is the
 * textbook construction this problem's README teaches from, so the
 * implementation should read the same way the participant-facing material
 * describes it.
 */
export function inv(a: bigint, p: bigint = P): bigint {
  const x = mod(a, p);
  if (x === 0n) {
    throw new RangeError("field.inv: 0 has no multiplicative inverse");
  }
  let [oldR, r] = [x, p];
  let [oldS, s] = [1n, 0n];
  while (r !== 0n) {
    const q = oldR / r;
    [oldR, r] = [r, oldR - q * r];
    [oldS, s] = [s, oldS - q * s];
  }
  // oldR is now gcd(x, p); for prime p and x != 0 (mod p) this is always 1.
  if (oldR !== 1n) {
    throw new RangeError(`field.inv: ${a} is not invertible mod ${p} (gcd = ${oldR})`);
  }
  return mod(oldS, p);
}
