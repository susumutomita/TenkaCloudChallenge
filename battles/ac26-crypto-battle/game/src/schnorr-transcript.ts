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
    lengthPrefixed(input.teamId),
    lengthPrefixed(input.contractId),
    lengthPrefixed(String(input.generation)),
    fixedWidth(input.commitmentR, byteLen),
    fixedWidth(input.publicY, byteLen),
  ]);
}

/**
 * The Fiat-Shamir challenge:
 * `e = H(domain, teamId, contractId, generation, R, Y) mod group.order`.
 */
export function computeChallenge(input: ChallengeInput, group: Group = RFC3526_GROUP14): bigint {
  const digest = createHash("sha256").update(challengePreimage(input, group)).digest();
  let value = 0n;
  for (const byte of digest) {
    value = (value << 8n) | BigInt(byte);
  }
  return mod(value, group.order);
}
