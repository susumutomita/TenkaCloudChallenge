/**
 * Participant-facing Fiat-Shamir Schnorr prover for PROVE (Issue #486 PR2).
 *
 * A participant runs `createProof` with THEIR OWN team's secret --
 * `projectForTeam(state, teamId).vault.secret` (see reducer.ts), the same
 * value they already legitimately see every match. This module has no
 * special trusted-side access: it is exactly the tool a participant's own
 * script would run, and reducer.ts never calls it (the trusted side only
 * ever needs `schnorr-witness.ts`'s derivation to compute the public
 * commitment, plus `schnorr-verifier.ts` to check a submitted proof -- see
 * those modules' headers).
 */

import { mod } from "./field.ts";
import { deriveBigInt } from "./prng.ts";
import { RFC3526_GROUP14, groupPow, type Group } from "./group.ts";
import { deriveWitness } from "./schnorr-witness.ts";
import { computeChallenge, type ChallengeInput } from "./schnorr-transcript.ts";
import type { SchnorrProof } from "./types.ts";

export type { SchnorrProof };

/**
 * Deterministic nonce derivation (RFC 6979 flavor): `k` is a pure function
 * of the witness and the statement being proven, never `Date.now()` /
 * `Math.random()` -- this package's purity rule (see prng.ts's header)
 * applies to PROVE's tooling too, not only the trusted reducer, so that
 * `createProof` is itself replayable/testable: calling it twice for the
 * same `(secret, generation, teamId, contractId)` always returns the exact
 * same proof.
 *
 * Nonce reuse across two DIFFERENT challenges for the same witness would
 * leak the witness outright (two linear equations `z1 = k + e1*w`,
 * `z2 = k + e2*w` in the unknowns `k` and `w` solve for `w` directly). That
 * cannot happen here: `k` is bound to `(witness, teamId, contractId,
 * generation)`, and `witness` itself already changes per
 * `(secret, generation, teamId)` (see schnorr-witness.ts) -- so the only way
 * to get two different challenges for the same witness is two different
 * `contractId`s, which derive two different nonces.
 */
function deriveNonce(
  witness: bigint,
  teamId: string,
  contractId: string,
  generation: number,
  group: Group,
): bigint {
  return deriveBigInt(witness.toString(), `schnorr-nonce:${teamId}:${contractId}`, generation, group.order);
}

/**
 * Build a non-interactive Schnorr proof that this team knows the discrete
 * log (witness) behind their current generation's public commitment
 * `Y = g^w mod p`, Fiat-Shamir-bound to one specific `contractId` (so the
 * resulting proof cannot be replayed against a different Contract -- see
 * schnorr-transcript.ts).
 */
export function createProof(
  secret: bigint,
  generation: number,
  teamId: string,
  contractId: string,
  group: Group = RFC3526_GROUP14,
): SchnorrProof {
  const witness = deriveWitness(secret, generation, teamId, group);
  const publicY = groupPow(group.generator, witness, group);
  const nonce = deriveNonce(witness, teamId, contractId, generation, group);
  const commitmentR = groupPow(group.generator, nonce, group);

  const challengeInput: ChallengeInput = { teamId, contractId, generation, commitmentR, publicY };
  const e = computeChallenge(challengeInput, group);
  const response = mod(nonce + e * witness, group.order);

  return { commitment: commitmentR.toString(), response: response.toString() };
}
