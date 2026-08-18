/**
 * Hash-derivation of a team's Schnorr witness and public commitment for
 * PROVE (Issue #486 PR2).
 *
 * This module reads a team's real Shamir `secret` (a trusted-side value --
 * see reducer.ts's TeamState doc comment) to derive `w`, so it is imported
 * by BOTH sides of the trust boundary:
 *   - reducer.ts (trusted side) calls `derivePublicCommitment` at
 *     `initialState` and on every ROTATE, using the secret it already holds
 *     directly, to compute the public Y every proof gets checked against.
 *   - schnorr-prover.ts (participant-facing tooling) calls `deriveWitness`
 *     using the secret a participant already legitimately knows (their own
 *     team's `projectForTeam(...).vault.secret`), to build a proof.
 * schnorr-verifier.ts, by contrast, MUST NEVER import this module -- see its
 * header for why that separation is load-bearing, not stylistic.
 */

import { deriveBigInt } from "./prng.ts";
import { RFC3526_GROUP14, groupPow, type Group } from "./group.ts";

/**
 * Hash-derived Schnorr witness for team `teamId`'s `generation` secret:
 * `w = SHA256(secret | "schnorr-witness:teamId" | generation) mod group.order`.
 *
 * Deliberately NOT `w = secret mod group.order`. The Shamir secret lives in
 * a 61-bit field (field.ts's `P = 2^61 - 1`), so a commitment `Y = g^secret`
 * would let an attacker recover `secret` from `Y` via baby-step
 * giant-step in roughly `sqrt(2^61) ~= 2^31` group operations -- entirely
 * feasible offline, well within a match's timeframe. Every successful PROVE
 * would then itself leak the secret it was supposed to keep hidden, making
 * PROVE strictly worse than LEAK for a team's opsec. Hashing `secret`
 * through SHA-256 first (the same construction every other "random-looking"
 * value in this package uses -- see prng.ts) severs the algebraic
 * relationship between `secret` and `w`: recovering `secret` from `w` (or
 * from `Y = g^w`) is no longer a discrete-log problem over a 61-bit space,
 * it is a SHA-256 preimage search over that same 61-bit secret space, which
 * is not feasible within a match -- baby-step giant-step has no purchase on
 * a hash output.
 */
export function deriveWitness(
  secret: bigint,
  generation: number,
  teamId: string,
  group: Group = RFC3526_GROUP14,
): bigint {
  return deriveBigInt(secret.toString(), `schnorr-witness:${teamId}`, generation, group.order);
}

/**
 * The public commitment `Y = g^w mod p` a team's PROVE proofs for this
 * generation are checked against. Safe to publish (and to place in
 * `CryptoBattleState.publicCommitments` / the projection every team can
 * see) precisely because recovering `w` from `Y` is the group's discrete-log
 * problem over the full 2048-bit `RFC3526_GROUP14`, not the underlying
 * 61-bit secret space.
 */
export function derivePublicCommitment(
  secret: bigint,
  generation: number,
  teamId: string,
  group: Group = RFC3526_GROUP14,
): bigint {
  return groupPow(group.generator, deriveWitness(secret, generation, teamId, group), group);
}
