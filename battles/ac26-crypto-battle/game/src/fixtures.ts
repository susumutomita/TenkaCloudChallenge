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

import { type CipherRung, rungSpec } from "./ladder.ts";
import { deriveBigInt, deriveStream } from "./prng.ts";
import { share, type Share } from "./shamir.ts";
import type { PrivacyConstraint } from "./methods.ts";
import type { ContractKind, OrderTaskKind } from "./types.ts";

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

/**
 * [Issue #659] A team's key for one rung, at one generation.
 *
 * Lives here rather than in `ladder.ts` for a boundary reason, not a taxonomy
 * one: the Portal imports `ladder.ts` to render symbols and read a rung's break
 * threshold, and anything reachable from there ends up in the SPA bundle.
 * `prng.ts` imports `node:crypto`, which a browser build cannot resolve — so
 * everything derived from the match seed stays on this side, next to
 * `deriveTeamGeneration` and `deriveContractPlan`, which are the same kind of
 * thing.
 *
 * Scoped to `generation` for the same reason the Shamir secret and the Schnorr
 * public commitment are: ROTATE has to defend the rung it is most needed on. A
 * key derived without the generation would stay broken for the rest of the
 * match, and #659 §10's 「ROTATE だけが打ち消せる」 would quietly not be true of
 * the ladder. Deriving it here means `applyRotate` covers the ladder with no
 * branch of its own — the key it hands out after a rotate is simply a different
 * one, and every pair published under the old generation stops meaning anything.
 *
 * Zero is a legal key. It is a weak one — the ciphertext equals the plaintext —
 * and a team that draws it and leaks a pair has published its key in the
 * clearest possible way. That is the rung's lesson, not a bug to design around.
 */
export function deriveCipherKey(
  seed: string,
  teamId: string,
  generation: number,
  rung: CipherRung,
): number {
  const spec = rungSpec(rung);
  const roll = deriveBigInt(seed, `cipher-key:${rung}:${teamId}:${generation}`, generation);
  return Number(roll % BigInt(spec.symbols.length));
}

/**
 * [Issue #659] The plaintext a ladder Order asks the team to encrypt, as symbol
 * VALUES.
 *
 * Derived from the Order's own id so two Orders never ask the same question,
 * and so a replay produces the identical belt.
 */
export function derivePlaintext(
  seed: string,
  contractId: string,
  rung: CipherRung,
): readonly number[] {
  const spec = rungSpec(rung);
  const modulus = BigInt(spec.symbols.length);
  const values: number[] = [];
  for (let position = 0; position < spec.plaintextLength; position += 1) {
    const roll = deriveBigInt(seed, `cipher-plaintext:${rung}:${contractId}`, position);
    values.push(Number(roll % modulus));
  }
  return values;
}

export interface ContractPlan {
  readonly kind: ContractKind;
  /**
   * [Issue #645] What this Order asks for. `reveal-share` carries its share
   * indices; `homomorphic-sum` and `masked-total` carry public payloads that
   * `reducer.ts` derives at issuance from the match seed and the Order id, so
   * nothing about them has to live in this plan.
   */
  readonly taskKind: OrderTaskKind;
  /** Only meaningful for a `reveal-share` task. */
  readonly requestedShareIndices: readonly number[];
  /**
   * [Issue #645] The rule this Order's client imposes on what may be published.
   *
   * For a `reveal-share` Order this is a real roll: roughly 1-in-4 are
   * `"no-raw-disclosure"` — #645's Level-1 "technique-specified" Order, which
   * PROVE alone satisfies — and the rest leave the choice open, which is the
   * Level-3 trade-off Order (LEAK is quick and feeds the Public Ledger; PROVE
   * costs computation and feeds it nothing).
   *
   * For FHE and MPC Orders it is always `"no-raw-disclosure"`, and not as a
   * policy choice: neither method has any way to publish the underlying value,
   * so stating anything weaker would describe an Order that does not exist.
   *
   * Rolled from its own derivation label so it is independent of the rush and
   * task rolls: a rush Order that also forbids disclosure is a real (and
   * interesting) combination, not an artefact of two rolls sharing a stream.
   */
  readonly privacyConstraint: PrivacyConstraint;
  /**
   * [Issue #659] Which rung of the cipher ladder a `caesar-shift` Order sits
   * on. Undefined for every other task kind.
   */
  readonly rung?: CipherRung;
}

/**
 * What the `sequenceIndex`-th Order issued to `teamId` looks like: its task,
 * its kind, and the rule its client imposes. `sequenceIndex` is the count of
 * Orders already issued to that team (0-based) — callers (reducer.ts's tick())
 * derive it from `state.contracts`, so no extra counter needs to live in state.
 *
 * Roughly 1-in-5 Orders are "rush" (worth more, same mechanics). The task
 * rotates so a match reliably contains all three kinds rather than depending on
 * a roll: #645's learning progression only works if a participant actually
 * meets an FHE Order and an MPC Order, and a probabilistic schedule can leave a
 * short match with neither. Deterministic rotation also keeps a replay honest.
 *
 * `reveal-share` gets two of every four Orders because it is the one with a
 * genuine method choice (LEAK or PROVE), which is what #645's Level-3 Orders
 * are for; FHE and MPC take one each.
 */
export function deriveContractPlan(
  seed: string,
  teamId: string,
  sequenceIndex: number,
  config: Pick<FieldConfig, "prime" | "shareCount">,
): ContractPlan {
  const RUSH_MODULUS = 5n;
  const CONSTRAINED_MODULUS = 4n;
  // [Issue #659 §13] The ladder Order takes a slot in the rotation rather than
  // replacing anything: #645's three tasks each teach something the ladder does
  // not, and the ladder teaches the thing none of them do -- how much you can
  // publish before your key is gone. A team meets all four in the first five
  // Orders, which is what makes the comparison between them available at all.
  const TASK_ROTATION: readonly OrderTaskKind[] = [
    "reveal-share",
    "caesar-shift",
    "homomorphic-sum",
    "reveal-share",
    "masked-total",
  ];
  const kindRoll = deriveBigInt(seed, `contract-kind:${teamId}`, sequenceIndex, config.prime);
  const kind: ContractKind = kindRoll % RUSH_MODULUS === 0n ? "rush" : "standard";
  const indexRoll = deriveBigInt(seed, `contract-index:${teamId}`, sequenceIndex, config.prime);
  const shareIndex = Number(indexRoll % BigInt(config.shareCount)) + 1;
  const taskKind = TASK_ROTATION[sequenceIndex % TASK_ROTATION.length] ?? "reveal-share";
  const constraintRoll = deriveBigInt(
    seed,
    `contract-privacy:${teamId}`,
    sequenceIndex,
    config.prime,
  );
  // FHE and MPC publish nothing reconstructable by construction, so their
  // Orders state that rule rather than rolling for it.
  // [Issue #659] A ladder Order never forbids disclosure. The decision it puts
  // in front of a team -- compute it, or publish the pair and hope your rung
  // survives -- only exists while LEAK is genuinely on the table, and an Order
  // that removed it would be a hand calculation with no choice attached.
  const privacyConstraint: PrivacyConstraint =
    taskKind === "caesar-shift"
      ? "none"
      : taskKind !== "reveal-share" || constraintRoll % CONSTRAINED_MODULUS === 0n
        ? "no-raw-disclosure"
        : "none";
  return {
    kind,
    taskKind,
    requestedShareIndices: [shareIndex],
    privacyConstraint,
    // [Issue #659 §12-B] Which rung, resolved by TIME rather than by a team's
    // own choice. #659 leaves this open and leans toward letting a team pick
    // ("いま点を稼ぐか、将来のために強くなるか" is a real investment decision),
    // but that needs per-team ladder progression, an unlock op and a UI of its
    // own. §13 scopes this slice to settling the SHAPE with one rung, and with
    // exactly one rung there is nothing to choose between yet. Phase-based
    // reuses `build → pressure → endgame` and adds no new time concept, which
    // is the rule #659 §9 already set.
    ...(taskKind === "caesar-shift" ? { rung: "caesar" as const } : {}),
  };
}
