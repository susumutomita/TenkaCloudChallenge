/**
 * Issue #645 Phase 2: the additively homomorphic cipher behind FHE Orders.
 *
 * An FHE Order hands a team two ciphertexts and asks for the encryption of
 * their sum, without ever handing over the plaintexts or the key. This module
 * is the scheme that makes that a real cryptographic exercise rather than a
 * story about one.
 *
 * ## The scheme
 *
 * Over the same prime field `field.ts` already uses, with a secret key `k`:
 *
 * ```text
 * Enc(m; r) = (r, m + k*r mod p)      r != 0, drawn per ciphertext
 * Dec(r, y) = y - k*r mod p
 * ```
 *
 * Adding two ciphertexts componentwise gives an encryption of the sum:
 *
 * ```text
 * (r1, y1) + (r2, y2) = (r1+r2, y1+y2)
 * Dec = (y1+y2) - k*(r1+r2) = (m1 + k*r1) + (m2 + k*r2) - k*r1 - k*r2 = m1+m2
 * ```
 *
 * That is the whole participant-facing operation: add two pairs of numbers and
 * take the remainder. No library, no lattice, no noise budget -- and it is not
 * a toy in the pejorative sense. It is genuinely additively homomorphic and
 * genuinely hides its plaintext, which are exactly the two properties an FHE
 * Order needs to teach.
 *
 * ## Why this scheme and not a "real" FHE library
 *
 * #645's non-goals say so directly: 「実用 FHE / MPC ライブラリの性能 benchmark を
 * 競うこと」 is out of scope. What is in scope is that a participant computes on
 * data they cannot read, and that the judge -- not the participant -- decides
 * whether the answer is right. A BFV/CKKS dependency would add megabytes, a
 * noise-growth failure mode with nothing to teach at this level, and numbers no
 * participant could check by hand. This scheme keeps every one of #645's FHE
 * acceptance criteria and stays inside §12b's arithmetic (add, multiply,
 * remainder).
 *
 * What it is NOT is fully homomorphic: there is no multiplication of two
 * ciphertexts here, only addition and multiplication by a public constant. The
 * participant-facing copy says "encrypted addition", never "FHE can do
 * anything" -- claiming otherwise would be teaching something false.
 *
 * ## What it hides, precisely
 *
 * Given `(r, y)` with `r != 0` and no knowledge of `k`, every candidate
 * plaintext `m'` is consistent: take `k' = (y - m') * r^-1 mod p`, which exists
 * because `p` is prime and `r != 0`. The ciphertext therefore carries *no*
 * information about `m` -- this is information-theoretic, not a hardness
 * assumption, and `fhe.test.ts` executes it rather than asserting it in prose.
 *
 * The same argument covers the pair of ciphertexts an Order publishes: two
 * equations, three unknowns (`k`, `m1`, `m2`), so every `(m1, m2)` remains
 * possible. What breaks the scheme is reusing one key across ciphertexts whose
 * plaintexts become known -- two known pairs solve for `k` immediately. That is
 * why {@link deriveFheKey} binds the key to a single Order: an Order's key
 * never encrypts anything outside that Order, so nothing a participant later
 * learns about one Order can unlock another.
 *
 * ## Why the participant cannot fake an answer
 *
 * The judge decrypts the submitted ciphertext and compares against the hidden
 * expected sum (#645: 「judge が decrypt + expected value compare で採点する」).
 * Submitting `(0, v)` decrypts to `v`, so a participant who KNEW the expected
 * sum could forge one -- and cannot, because the plaintexts are full field
 * elements derived from the match seed, so the sum is one value out of ~2^61.
 * Producing a valid ciphertext any other way needs `k`, which is exactly what
 * the paragraph above says they cannot learn. So the only tractable route to a
 * passing submission is to actually perform the homomorphic addition.
 */

import { add, mod, mul, sub } from "./field.ts";
import { deriveBigInt } from "./prng.ts";

/**
 * One ciphertext, in this module's `bigint` working form.
 *
 * The state/op wire shape uses stringified decimals instead
 * (`StoredCiphertext` in types.ts) -- see types.ts's "JSON-SAFETY INVARIANT".
 */
export interface Ciphertext {
  readonly r: bigint;
  readonly y: bigint;
}

/**
 * The key for one Order.
 *
 * Bound to `orderId` so no two Orders share a key. See this module's header on
 * why that binding is the difference between a scheme that stays hiding and
 * one that unravels the moment a single plaintext is learned.
 *
 * Derived from the match seed, never stored: `CryptoBattleState` holds the
 * public ciphertexts and nothing else, so there is no new secret field for
 * `projectForTeam` to have to remember to redact.
 */
export function deriveFheKey(seed: string, orderId: string, p: bigint): bigint {
  // A zero key would make Enc(m; r) = (r, m) -- the plaintext in the clear.
  // Vanishingly unlikely, and cheap to exclude outright rather than leave as a
  // one-in-2^61 hole that no test would ever catch.
  const key = deriveBigInt(seed, `fhe-key:${orderId}`, 0, p);
  return key === 0n ? 1n : key;
}

/**
 * The plaintexts an FHE Order asks a team to add, without showing them.
 *
 * Trusted-side only: the judge re-derives these to compute the expected sum.
 * Nothing hands them to a participant, and `fhe.test.ts` pins that the Order's
 * public payload does not contain them.
 */
export function deriveFhePlaintexts(seed: string, orderId: string, p: bigint): readonly bigint[] {
  return [
    deriveBigInt(seed, `fhe-plaintext-a:${orderId}`, 0, p),
    deriveBigInt(seed, `fhe-plaintext-b:${orderId}`, 0, p),
  ];
}

/**
 * The per-ciphertext randomness `r`.
 *
 * Forced non-zero: `r = 0` collapses `Enc(m; 0)` to `(0, m)`, publishing the
 * plaintext. Same reasoning as the key above -- exclude it at the source rather
 * than rely on it never coming up.
 */
function deriveRandomness(seed: string, orderId: string, index: number, p: bigint): bigint {
  const r = deriveBigInt(seed, `fhe-randomness:${orderId}`, index, p);
  return r === 0n ? 1n : r;
}

/** `Enc(plaintext; randomness)` under `key`. */
export function encrypt(plaintext: bigint, key: bigint, randomness: bigint, p: bigint): Ciphertext {
  return { r: mod(randomness, p), y: add(plaintext, mul(key, randomness, p), p) };
}

/** `Dec(ciphertext)` under `key`. */
export function decrypt(ciphertext: Ciphertext, key: bigint, p: bigint): bigint {
  return sub(ciphertext.y, mul(key, ciphertext.r, p), p);
}

/**
 * Componentwise addition -- an encryption of the sum of the two plaintexts.
 *
 * This is the operation the participant performs. It is exported so the
 * reference solution, the tests, and the dev harness all run the same code a
 * participant would write, rather than three descriptions of it.
 */
export function addCiphertexts(a: Ciphertext, b: Ciphertext, p: bigint): Ciphertext {
  return { r: add(a.r, b.r, p), y: add(a.y, b.y, p) };
}

/**
 * The public payload of one FHE Order: the ciphertexts a team is asked to add.
 *
 * Deterministic in `(seed, orderId)`, so the judge can re-derive both the
 * inputs and the expected answer without either being stored.
 */
export function deriveFheOrderInputs(seed: string, orderId: string, p: bigint): readonly Ciphertext[] {
  const key = deriveFheKey(seed, orderId, p);
  return deriveFhePlaintexts(seed, orderId, p).map((plaintext, index) =>
    encrypt(plaintext, key, deriveRandomness(seed, orderId, index, p), p),
  );
}

/** The plaintext a correct submission must decrypt to. Trusted-side only. */
export function expectedFheSum(seed: string, orderId: string, p: bigint): bigint {
  return deriveFhePlaintexts(seed, orderId, p).reduce((acc, m) => add(acc, m, p), 0n);
}
