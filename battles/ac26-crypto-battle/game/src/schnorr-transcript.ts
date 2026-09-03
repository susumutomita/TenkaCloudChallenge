/**
 * Fiat-Shamir challenge computation shared between the prover
 * (schnorr-prover.ts) and the verifier (schnorr-verifier.ts).
 *
 * This module intentionally contains no secret material -- it is the ONLY
 * thing the two sides of PROVE's trust boundary share, besides group.ts's
 * public group constants (see schnorr-verifier.ts's header for why that
 * separation matters).
 *
 * Preimage encoding follows
 * `challenges/ac26-w3-schnorr/local/reference/schnorr.py`'s
 * `challenge_preimage`: every variable-length field (the domain separator,
 * `teamId`, `contractId`, and `generation`-as-decimal-string) is 4-byte
 * big-endian length-prefixed before concatenation. Without that,
 * `("ab", "cd")` and `("a", "bcd")` would concatenate to the same bytes and
 * hash to the same challenge -- two different statements sharing one valid
 * proof between them. `commitmentR` / `publicY` are fixed-width (every
 * group element is padded to `groupByteLength(group)` bytes), so they do not
 * need a length prefix, but they still sit adjacent to the variable-length
 * fields above rather than being separated by fixed-width padding that would
 * hide the ambiguity behind an accident of layout (see the Python
 * reference's own docstring on this point, and schnorr.test.ts's binding
 * test).
 */

import { createHash } from "node:crypto";
import { mod } from "./field.ts";
import { groupByteLength, RFC3526_GROUP14, type Group } from "./group.ts";

/** Domain separator for this Battle's PROVE proof -- fixed by Issue #486 PR2's design. */
export const PROVE_DOMAIN = "ac26-crypto-battle/prove/v1";

export interface ChallengeInput {
  /**
   * [Issue #701] The match seed -- what turns this from Fiat-Shamir into the
   * verifier's own coin.
   *
   * PROVE is interactive now: the participant commits R, and only then is the
   * challenge revealed. That ordering is worth nothing if the participant can
   * COMPUTE the challenge from R themselves, because then they can grind: pick
   * a response s, guess e, set R = g^s * Y^-e, hash it, and keep going until
   * the hash agrees with the guess. Over a 113-element challenge space that is
   * a hundred hashes, offline, where no penalty can reach it -- which is
   * precisely why the group could not simply be made small while the challenge
   * stayed a hash of public values.
   *
   * The seed is held only by the trusted dispatcher (`CryptoBattleState.seed`,
   * never projected -- see reducer.ts's projection), so the challenge is
   * unpredictable to the prover and fixed to their commitment once it lands.
   * That is the verifier's random challenge, in a system with no live verifier
   * to send one.
   */
  readonly matchSeed: string;
  readonly teamId: string;
  readonly contractId: string;
  readonly generation: number;
  /** Schnorr commitment R = g^k mod p. */
  readonly commitmentR: bigint;
  /** Public commitment Y = g^w mod p the proof is checked against. */
  readonly publicY: bigint;
}

function lengthPrefixed(value: string): Buffer {
  const bytes = Buffer.from(value, "utf8");
  const prefix = Buffer.alloc(4);
  prefix.writeUInt32BE(bytes.length, 0);
  return Buffer.concat([prefix, bytes]);
}

/** Fixed-width big-endian encoding of a group element, zero-padded to `byteLen`. */
function fixedWidth(value: bigint, byteLen: number): Buffer {
  if (value < 0n) {
    throw new RangeError(`schnorr-transcript: cannot encode a negative value (${value})`);
  }
  let hex = value.toString(16);
  if (hex.length % 2 !== 0) hex = `0${hex}`;
  const raw = Buffer.from(hex, "hex");
  if (raw.length > byteLen) {
    throw new RangeError(`schnorr-transcript: value does not fit in ${byteLen} bytes`);
  }
  return Buffer.concat([Buffer.alloc(byteLen - raw.length), raw]);
}

/**
 * Everything the Fiat-Shamir challenge binds, in an unambiguous encoding.
 * Exported separately from `computeChallenge` so tests can assert the
 * length-prefix framing directly (see schnorr.test.ts's binding test).
 */
export function challengePreimage(input: ChallengeInput, group: Group = RFC3526_GROUP14): Buffer {
  const byteLen = groupByteLength(group);
  return Buffer.concat([
    lengthPrefixed(PROVE_DOMAIN),
    // [Issue #701] First, and length-prefixed like every other string here, so
    // no seed can be confused with the teamId that follows it.
    lengthPrefixed(input.matchSeed),
    lengthPrefixed(input.teamId),
    lengthPrefixed(input.contractId),
    lengthPrefixed(String(input.generation)),
    fixedWidth(input.commitmentR, byteLen),
    fixedWidth(input.publicY, byteLen),
  ]);
}

/**
 * The challenge:
 * `e = H(domain, matchSeed, teamId, contractId, generation, R, Y) mod group.order`.
 *
 * [Issue #701] With `matchSeed` in the preimage this is no longer Fiat-Shamir
 * in the usual sense -- the prover cannot evaluate it, because they do not hold
 * the seed. It is the trusted side's unpredictable-but-deterministic challenge,
 * which is what lets the group be small enough to exponentiate by hand.
 */
export function computeChallenge(input: ChallengeInput, group: Group = RFC3526_GROUP14): bigint {
  const digest = createHash("sha256").update(challengePreimage(input, group)).digest();
  let value = 0n;
  for (const byte of digest) {
    value = (value << 8n) | BigInt(byte);
  }
  return mod(value, group.order);
}
