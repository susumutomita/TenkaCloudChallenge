/**
 * Deterministic derivation of everything a match needs from a single seed
 * string: per-team secrets, Shamir coefficients, and the LEAK contract
 * schedule. All of it goes through prng.ts's SHA-256 counter stream -- see
 * that file for why (purity contract for the whole reducer).
 *
 * Field-space params here (`FieldConfig.prime`) stay `bigint`, deliberately
 * decoupled from `CryptoBattleConfig.prime` (a stringified bigint -- see
 * types.ts's "JSON-SAFETY INVARIANT"): this module is one of `game/src`'s
 * pure crypto modules, not a state/op boundary, so it keeps working directly
 * in `bigint` the same way `field.ts` / `shamir.ts` do. `reducer.ts` is what
 * converts `CryptoBattleConfig.prime` to `bigint` before calling in here.
 */

import { deriveBigInt, deriveStream } from "./prng.ts";
import { share, type Share } from "./shamir.ts";
import type { PrivacyConstraint } from "./methods.ts";
import type { ContractKind } from "./types.ts";

/** The bigint-space subset of `CryptoBattleConfig` this module's derivations need. */
export interface FieldConfig {
  readonly prime: bigint;
  readonly threshold: number;
  readonly shareCount: number;
}

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
  config: FieldConfig,
): { readonly secret: bigint; readonly shares: readonly Share[] } {
  const secret = deriveSecret(seed, teamId, generation, config.prime);
  const coeffs = deriveCoefficients(seed, teamId, generation, config.threshold, config.prime);
  const shares = share(secret, config.threshold, config.shareCount, coeffs, config.prime);
  return { secret, shares };
}

export interface ContractPlan {
  readonly kind: ContractKind;
  readonly requestedShareIndices: readonly number[];
  /**
   * [Issue #645] The rule this Order's client imposes on what may be published.
   * Roughly 1-in-4 Orders are `"no-raw-disclosure"` -- #645's Level-1
   * "technique-specified" Order, which PROVE alone satisfies. Rolled from its
   * own derivation label so it is independent of the rush roll: a rush Order
   * that also forbids disclosure is a real (and interesting) combination, not
   * an artefact of two rolls sharing a stream.
   */
  readonly privacyConstraint: PrivacyConstraint;
}

/**
 * What the `sequenceIndex`-th contract issued to `teamId` looks like (kind +
 * which share index it asks the team to reveal). `sequenceIndex` is the count
 * of contracts already issued to that team (0-based) -- callers (reducer.ts's
 * tick()) derive it from `state.contracts`, so no extra counter needs to live
 * in state.
 *
 * Roughly 1-in-5 contracts are "rush" (worth more, same mechanics) and
 * roughly 1-in-4 forbid raw disclosure -- playtest ratios, see types.ts's
 * CryptoBattleConfig doc comment.
 */
export function deriveContractPlan(
  seed: string,
  teamId: string,
  sequenceIndex: number,
  config: Pick<FieldConfig, "prime" | "shareCount">,
): ContractPlan {
  const RUSH_MODULUS = 5n;
  const CONSTRAINED_MODULUS = 4n;
  const kindRoll = deriveBigInt(seed, `contract-kind:${teamId}`, sequenceIndex, config.prime);
  const kind: ContractKind = kindRoll % RUSH_MODULUS === 0n ? "rush" : "standard";
  const indexRoll = deriveBigInt(seed, `contract-index:${teamId}`, sequenceIndex, config.prime);
  const shareIndex = Number(indexRoll % BigInt(config.shareCount)) + 1;
  const constraintRoll = deriveBigInt(
    seed,
    `contract-privacy:${teamId}`,
    sequenceIndex,
    config.prime,
  );
  const privacyConstraint: PrivacyConstraint =
    constraintRoll % CONSTRAINED_MODULUS === 0n ? "no-raw-disclosure" : "none";
  return { kind, requestedShareIndices: [shareIndex], privacyConstraint };
}
