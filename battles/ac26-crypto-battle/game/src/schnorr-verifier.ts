/**
 * Trusted verifier for PROVE's Fiat-Shamir Schnorr proof (Issue #486 PR2).
 *
 * `verifyProof` checks a proof against PUBLIC inputs only: the public
 * commitment Y (from `CryptoBattleState.publicCommitments`, itself already
 * derived and stored by the trusted side -- see schnorr-witness.ts), the
 * proof a team submitted, and the statement's public metadata (teamId,
 * contractId, generation). This module MUST NEVER import a team's secret,
 * `schnorr-witness.ts`'s `deriveWitness` / `derivePublicCommitment`, or
 * `schnorr-prover.ts` -- reducer.ts calls `verifyProof` directly from
 * `validateOp`'s "prove" branch on the trusted dispatcher (PR3 wires this in
 * unchanged), and its correctness must be auditable without ever having to
 * reason about where a secret came from. schnorr.test.ts's module-separation
 * test statically inspects this file's import statements to enforce that.
 *
 * The two sides of PROVE share only group.ts's public group constants and
 * schnorr-transcript.ts's challenge computation -- neither touches secret
 * material.
 */

import { mul, pow } from "./field.ts";
import { RFC3526_GROUP14, type Group } from "./group.ts";
import { computeChallenge, type ChallengeInput } from "./schnorr-transcript.ts";
import type { SchnorrProof } from "./types.ts";

export type { SchnorrProof };

export interface ProveStatement {
  /**
   * [Issue #701] The match seed the challenge is bound to. Public inputs only
   * still holds -- the seed is not a team's secret, it is the trusted side's
   * own coin, and this module reads it exactly as it reads `teamId`: as an
   * opaque string that goes into the transcript.
   */
  readonly matchSeed: string;
  readonly teamId: string;
  readonly contractId: string;
  readonly generation: number;
}

/**
 * The largest decimal value this 2048-bit group's modulus `p` ever needs to
 * represent has 617 digits (`floor(2048 * log10(2)) + 1`); 700 leaves
 * comfortable margin without opening the door to an absurdly long input. This
 * is also the cap `reducer.ts`'s "hunt" branch reuses for `recoveredSecret`
 * (see `parseCanonicalDecimal` below) -- that value only ever needs ~19
 * digits for `field.ts`'s 61-bit `P`, so 700 stays a generous, not tight,
 * bound there too; one shared untrusted-decimal gate is simpler to reason
 * about than a second cap tuned per value space.
 */
const MAX_PROOF_FIELD_DECIMAL_DIGITS = 700;

/** Digits only, no sign, no leading/embedded/trailing whitespace, length-bounded. */
const CANONICAL_DECIMAL = new RegExp(`^\\d{1,${MAX_PROOF_FIELD_DECIMAL_DIGITS}}$`);

/**
 * Parse an untrusted, participant-submitted decimal string into a `bigint`,
 * or `undefined` if it is not a canonical, length-bounded decimal literal.
 * MUST run before any `BigInt()` call on untrusted input: `BigInt()`'s parse
 * cost is superlinear in input length. Measured on this runtime (Bun /
 * JavaScriptCore): a 300,000-digit string takes ~565ms to parse directly,
 * and JavaScriptCore additionally enforces its own hard BigInt size cap
 * somewhere between 300,000 and 400,000 decimal digits, throwing
 * `RangeError: Out of memory` past it -- so an unguarded `BigInt()` call on
 * untrusted input is a CPU-exhaustion vector well within that cap, not only
 * for inputs large enough to hit it. (Other JS engines cap BigInt size much
 * higher or not at all, so an input long enough to be slow there without
 * ever throwing is easy to construct -- the length bound below does not
 * depend on any particular engine's cap.) Rejecting anything that is not
 * `/^\d{1,700}$/` up front closes this off before `BigInt()` ever runs, and
 * as a side effect also rejects every non-canonical encoding `BigInt()`
 * would otherwise happily accept -- a `"0x..."` hex literal, a leading
 * `"+"`, embedded/trailing whitespace, or a `"-"` sign -- so there is
 * exactly one parse path this module trusts. See schnorr.test.ts's
 * "input format/size validation" tests for the measured guarded-vs-unguarded
 * timing gap.
 *
 * Exported (Issue #486 PR3 review fix) so `reducer.ts`'s "hunt" branch can
 * reuse the exact same untrusted-decimal gate for `CryptoBattleOp`'s
 * `recoveredSecret` instead of a second, drifting copy -- `verifyProof`
 * below was its first and remains its only other caller.
 *
 * `value` is typed `unknown`, not `string` (Issue #486 PR3 review fix): every
 * caller here sits right at a JSON wire boundary (a participant-submitted
 * `SchnorrProof` field, or `CryptoBattleOp`'s hunt `recoveredSecret`), where
 * TypeScript's static `string` annotation on the surrounding type is not a
 * runtime guarantee -- `RegExp.prototype.test` coerces a non-string argument
 * via `ToString` before matching, so a JSON *number* like `123` would
 * otherwise sail through as `"123"` instead of being rejected as the wrong
 * wire type. The explicit `typeof` check below closes that off.
 */
export function parseCanonicalDecimal(value: unknown): bigint | undefined {
  if (typeof value !== "string") return undefined;
  if (!CANONICAL_DECIMAL.test(value)) return undefined;
  return BigInt(value);
}

/**
 * Verify that `proof` proves knowledge of the discrete log of
 * `publicCommitmentY` (`= g^w mod p`) bound to `statement`, under this
 * package's Fiat-Shamir Schnorr scheme. Checks `g^z == R * Y^e (mod p)`,
 * where `R`/`z` come from `proof` and `e` is recomputed here from
 * `statement` + `R` + `Y` via `schnorr-transcript.ts` (never trusted from
 * the caller -- Fiat-Shamir's soundness depends on the verifier deriving the
 * challenge itself, not accepting one).
 *
 * Returns `false` (never throws) for a malformed `proof.commitment` /
 * `proof.response` -- an untrusted, participant-submitted proof failing to
 * parse is exactly as "not a valid proof" as one that parses but does not
 * satisfy the verification equation; `validateOp` in reducer.ts treats both
 * identically (op rejected).
 */
export function verifyProof(
  publicCommitmentY: bigint,
  proof: SchnorrProof,
  statement: ProveStatement,
  group: Group = RFC3526_GROUP14,
): boolean {
  const commitmentR = parseCanonicalDecimal(proof.commitment);
  const response = parseCanonicalDecimal(proof.response);
  if (commitmentR === undefined || response === undefined) return false;

  // Range checks before any group arithmetic. `<= 1n` (not just `< 0n`)
  // rejects the group identity (1) in addition to 0: a forged proof against
  // Y = 1 would otherwise verify for ANY response z by simply setting
  // R = g^z (since Y^e = 1^e = 1 makes the check g^z == R unconditionally),
  // a complete forgery. Y is only ever produced by `derivePublicCommitment`
  // today, so landing on 1 has probability ~2^-256, but the reference
  // implementation (`challenges/ac26-w3-schnorr/local/reference/schnorr.py`'s
  // `validate_public_key` / `verify_transcript`) rejects the identity
  // explicitly rather than relying on that -- this mirrors it, and applies
  // the same rejection to the commitment R for consistency.
  if (commitmentR <= 1n || commitmentR >= group.p) return false;
  if (response < 0n || response >= group.order) return false;
  if (publicCommitmentY <= 1n || publicCommitmentY >= group.p) return false;

  const challengeInput: ChallengeInput = {
    matchSeed: statement.matchSeed,
    teamId: statement.teamId,
    contractId: statement.contractId,
    generation: statement.generation,
    commitmentR,
    publicY: publicCommitmentY,
  };
  const e = computeChallenge(challengeInput, group);

  const left = pow(group.generator, response, group.p);
  const right = mul(commitmentR, pow(publicCommitmentY, e, group.p), group.p);
  return left === right;
}
