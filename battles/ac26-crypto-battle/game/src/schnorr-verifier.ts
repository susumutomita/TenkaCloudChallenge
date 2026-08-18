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
  readonly teamId: string;
  readonly contractId: string;
  readonly generation: number;
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
  let commitmentR: bigint;
  let response: bigint;
  try {
    commitmentR = BigInt(proof.commitment);
    response = BigInt(proof.response);
  } catch {
    return false;
  }

  // Range checks before any group arithmetic: an out-of-range commitment or
  // response is never a valid proof, whatever it happens to hash to.
  if (commitmentR < 0n || commitmentR >= group.p) return false;
  if (response < 0n || response >= group.order) return false;
  if (publicCommitmentY <= 0n || publicCommitmentY >= group.p) return false;

  const challengeInput: ChallengeInput = {
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
