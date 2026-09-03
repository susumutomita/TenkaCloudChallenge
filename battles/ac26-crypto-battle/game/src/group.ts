/**
 * RFC 3526 Group 14 -- the 2048-bit MODP (safe-prime) group PROVE's Schnorr
 * proof (Issue #486 PR2) runs in.
 *
 * The hex constant below was transcribed from Node's own
 * `crypto.getDiffieHellman("modp14").getPrime("hex")` (bun/Node both ship
 * this named group), not hand-copied out of the RFC text, and independently
 * verified with a from-scratch Miller-Rabin primality check on both `p` and
 * `q = (p - 1) / 2` before landing here. A single mistyped hex digit in a
 * 512-digit constant would silently turn "prime" into "composite" and no
 * unit test would catch it just by *using* the resulting Group -- Schnorr
 * verification degrades gracefully into "still computes a number", it does
 * not throw.
 *
 * `p` is a *safe prime*: p = 2q + 1, with `q` also prime. RFC 3526's own
 * generator for this group is 2; this module deliberately uses g = 4 = 2^2
 * instead. `Z_p*` has order `p - 1 = 2q`, so squaring any element strictly
 * between 1 and p-1 lands in the unique order-`q` subgroup (the quadratic
 * residues) -- squaring kills the factor of 2 in the order, and since `q` is
 * prime the only possible orders for a non-identity element of that subgroup
 * are 1 or q. That makes g = 4 *guaranteed* to generate the order-q subgroup
 * regardless of whether 2 itself has order q or 2q (both are possible for a
 * safe prime, and it does not matter which holds here -- no separate proof
 * obligation, just "square it"). Working inside the prime-order-q subgroup
 * (instead of the full order-(p-1) group, which has a small order-2
 * subgroup) is what makes "every scalar arithmetic op is mod q" in
 * schnorr-witness.ts / schnorr-prover.ts / schnorr-verifier.ts sound: with a
 * prime group order, every non-identity element generates the whole
 * subgroup and there is no small-subgroup confusion to worry about.
 *
 * A note on effective security: do not read "2048-bit group" as a claim
 * that values flowing through this module carry 2048-bit (or even the
 * ~112-bit classical index-calculus estimate for a modulus this size)
 * strength. Every value that acts as this scheme's secret material -- the
 * witness `w` (schnorr-witness.ts's `deriveWitness`), the nonce `k`
 * (schnorr-prover.ts's `deriveNonce`), and the Fiat-Shamir challenge `e`
 * (schnorr-transcript.ts's `computeChallenge`) -- is derived through
 * SHA-256 before it is ever reduced into this group. None of those
 * derivations can carry more entropy or collision resistance than SHA-256's
 * 256-bit output provides, and a generic birthday-bound attack against a
 * 256-bit hash costs on the order of 2^128, not 2^2048. Effective security
 * here is therefore bounded at roughly 128-bit by construction, not by
 * omission -- this Battle's threat model is a competing team within a
 * ~90-minute match, not a resourced cryptanalytic adversary, and 128-bit of
 * margin is already far more than that requires.
 */

import { pow } from "./field.ts";

export interface Group {
  readonly p: bigint;
  readonly order: bigint;
  readonly generator: bigint;
}

/** RFC 3526 Group 14 modulus, 2048 bits -- see this module's header for provenance. */
export const MODP_2048_P = BigInt(
  `0x${[
    "ffffffffffffffffc90fdaa22168c234c4c6628b80dc1cd129024e088a67cc",
    "74020bbea63b139b22514a08798e3404ddef9519b3cd3a431b302b0a6df25f",
    "14374fe1356d6d51c245e485b576625e7ec6f44c42e9a637ed6b0bff5cb6f4",
    "06b7edee386bfb5a899fa5ae9f24117c4b1fe649286651ece45b3dc2007cb8",
    "a163bf0598da48361c55d39a69163fa8fd24cf5f83655d23dca3ad961c62f3",
    "56208552bb9ed529077096966d670c354e4abc9804f1746c08ca18217c3290",
    "5e462e36ce3be39e772c180e86039b2783a2ec07a28fb5c55df06f4c52c9de",
    "2bcbf6955817183995497cea956ae515d2261898fa051015728e5a8aacaa68",
    "ffffffffffffffff",
  ].join("")}`,
);

/** The order of the quadratic-residue subgroup g = 4 generates: q = (p - 1) / 2. */
export const MODP_2048_ORDER = (MODP_2048_P - 1n) / 2n;

/** g = 4 -- see this module's header for why not RFC 3526's own g = 2. */
export const MODP_2048_GENERATOR = 4n;

export const RFC3526_GROUP14: Group = {
  p: MODP_2048_P,
  order: MODP_2048_ORDER,
  generator: MODP_2048_GENERATOR,
};

/**
 * [Issue #701] The group a MATCH runs PROVE in: p = 227, q = 113, g = 4.
 *
 * Kept beside the 2048-bit group on purpose. That one is what a real Schnorr
 * proof is built in and this file's header explains why every constant in it
 * had to be verified rather than trusted; this one is what a participant can
 * hold in their hand. A player who finishes a PROVE here and then scrolls up to
 * `MODP_2048_P` has learned the actual shape of the thing -- the arithmetic is
 * identical and only the size differs, which is a lesson the 617-digit constant
 * alone cannot teach because nobody can do anything with it.
 *
 * **This group has no security.** 113 candidates is a second of brute force, so
 * a participant can recover the witness behind any published Y. That costs them
 * nothing here: `w` is derived through SHA-256 from a team's secret and reduced
 * mod 113, so it carries none of the secret back, and an op is authenticated by
 * the submitting team, so holding someone else's witness does not let anyone
 * prove as them. What the small group buys is that the exponentiation is SEVEN
 * squarings of three-digit numbers -- see `HAND_GROUP_MAX_SQUARE`. The
 * participant-facing copy says outright that this is a teaching size.
 *
 * Soundness against a player who guesses instead of computing does NOT come
 * from the group. It comes from the challenge being unpredictable (derived on
 * the trusted side from the match seed, which no participant holds -- see
 * `schnorr-transcript.ts`) plus a penalty for a wrong response: one blind
 * attempt succeeds with probability 1/113.
 *
 * `p = 2q + 1` with both prime, and g = 4 = 2^2 is a quadratic residue, so its
 * order divides the prime q and (being != 1) is exactly q. That argument is the
 * same one the 2048-bit group rests on -- and, exactly as this file's header
 * warns, an argument is not a check: `schnorr.test.ts` computes the order.
 */
export const HAND_GROUP_P = 227n;
export const HAND_GROUP_ORDER = (HAND_GROUP_P - 1n) / 2n;
export const HAND_GROUP_GENERATOR = 4n;

export const HAND_GROUP: Group = {
  p: HAND_GROUP_P,
  order: HAND_GROUP_ORDER,
  generator: HAND_GROUP_GENERATOR,
};

/**
 * The largest number a participant multiplies out while exponentiating in
 * {@link HAND_GROUP}: `(p - 1)^2`. Five digits, which is the same bar the field
 * shrink in #696 was measured against.
 */
export const HAND_GROUP_MAX_SQUARE = (HAND_GROUP_P - 1n) ** 2n;

/** `base^exp mod group.p` -- delegates to field.ts's modular exponentiation. */
export function groupPow(base: bigint, exp: bigint, group: Group = RFC3526_GROUP14): bigint {
  return pow(base, exp, group.p);
}

/**
 * Byte width of a fixed-width big-endian encoding of any element of
 * `[0, group.p)`. Computed from `group.p` itself (not hardcoded to 256 for
 * this one 2048-bit group) so schnorr-transcript.ts's framing stays correct
 * if this module ever grows a second Group.
 */
export function groupByteLength(group: Group): number {
  return Math.ceil(group.p.toString(2).length / 8);
}
