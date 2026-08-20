/**
 * Deterministic derivation of everything a match needs from a single seed
 * string: per-team secrets, Shamir coefficients, and the LEAK contract
 * schedule. All of it goes through prng.ts's SHA-256 counter stream -- see
 * that file for why (purity contract for the whole reducer).
 */

import { deriveBigInt, deriveStream } from "./prng.ts";
import { share, type Share } from "./shamir.ts";
import type { ContractKind, CryptoBattleConfig } from "./types.ts";

/** This team's secret for this generation, as a field element. */
export function deriveSecret(seed: string, teamId: string, generation: number, p: bigint): bigint {
  return deriveBigInt(seed, `secret:${teamId}:${generation}`, generation, p);
}

/** The `t - 1` Shamir polynomial coefficients (c1..c_{t-1}) for this team/generation. */
export function deriveCoefficients(
  seed: string,
  teamId: string,
  generation: number,
  threshold: number,
  p: bigint,
): bigint[] {
  return deriveStream(seed, `coeffs:${teamId}:${generation}`, threshold - 1, p);
}

/** Secret + full share set for one team's generation, derived purely from the seed. */
export function deriveTeamGeneration(
  seed: string,
  teamId: string,
  generation: number,
  config: Pick<CryptoBattleConfig, "prime" | "threshold" | "shareCount">,
): { readonly secret: bigint; readonly shares: readonly Share[] } {
  const secret = deriveSecret(seed, teamId, generation, config.prime);
  const coeffs = deriveCoefficients(seed, teamId, generation, config.threshold, config.prime);
  const shares = share(secret, config.threshold, config.shareCount, coeffs, config.prime);
  return { secret, shares };
}

export interface ContractPlan {
  readonly kind: ContractKind;
  readonly requestedShareIndices: readonly number[];
}

/**
 * What the `sequenceIndex`-th contract issued to `teamId` looks like (kind +
 * which share index it asks the team to reveal). `sequenceIndex` is the count
 * of contracts already issued to that team (0-based) -- callers (reducer.ts's
 * tick()) derive it from `state.contracts`, so no extra counter needs to live
 * in state.
 *
 * Roughly 1-in-5 contracts are "rush" (worth more, same LEAK mechanics) --
 * a playtest ratio, see types.ts's CryptoBattleConfig doc comment.
 */
export function deriveContractPlan(
  seed: string,
  teamId: string,
  sequenceIndex: number,
  config: Pick<CryptoBattleConfig, "prime" | "shareCount">,
): ContractPlan {
  const RUSH_MODULUS = 5n;
  const kindRoll = deriveBigInt(seed, `contract-kind:${teamId}`, sequenceIndex, config.prime);
  const kind: ContractKind = kindRoll % RUSH_MODULUS === 0n ? "rush" : "standard";
  const indexRoll = deriveBigInt(seed, `contract-index:${teamId}`, sequenceIndex, config.prime);
  const shareIndex = Number(indexRoll % BigInt(config.shareCount)) + 1;
  return { kind, requestedShareIndices: [shareIndex] };
}
