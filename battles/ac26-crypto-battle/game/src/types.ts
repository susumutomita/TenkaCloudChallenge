/**
 * State / op / projection / config types for the PROVE / LEAK / HUNT Battle's
 * pure game model.
 *
 * `CoordinationContext` and the `ValidateResult` shape below intentionally
 * mirror what `@tenkacloud/coordination-plugin-sdk` expects a CoordinationPlugin
 * to consume/return (see AGENTS.md ADR-028 note in SCHEMA.json), so that PR3
 * can wrap `reducer.ts`'s exports directly without reshaping them. That SDK
 * package does not exist in this repository (TenkaCloudChallenge owns problem
 * content, not platform packages -- see this repo's AGENTS.md "Repository
 * boundary") and MUST NOT be imported here.
 *
 * PROVE is intentionally absent from `CryptoBattleOp` -- it ships in PR2 with
 * its verifier. Adding the discriminant without a working verifier would let
 * `applyOp` accept an op it cannot honestly score.
 */

import type { Share } from "./shamir.ts";

/** What the platform dispatcher hands a CoordinationPlugin for one event. */
export interface CoordinationContext {
  readonly eventId: string;
  readonly teamIds: readonly string[];
}

export type ValidateResult = { readonly ok: true } | { readonly ok: false; readonly error: string };

export type Phase = "build" | "pressure" | "endgame" | "ended";

export interface ScoreRules {
  /** Points for completing a standard LEAK contract. */
  readonly contract: number;
  /** Points for completing a "rush" LEAK contract (time-pressured, worth more). */
  readonly rushContract: number;
  /** Points an attacker earns for a successful HUNT (secret recovered and matched). */
  readonly huntBonus: number;
  /** Points a target loses when successfully HUNTed (floored at 0, never negative). */
  readonly huntPenalty: number;
}

export interface PhaseBoundaries {
  /** Elapsed match time (ms) at which "build" becomes "pressure". */
  readonly buildToPressureMs: number;
  /** Elapsed match time (ms) at which "pressure" becomes "endgame". */
  readonly pressureToEndgameMs: number;
}

/**
 * Tunable game parameters, fixed once at `initialState()` and immutable for
 * the rest of the match.
 *
 * These are the Issue #486 playtest seed values, not a locked-in balance
 * spec -- operators are expected to tune `scores` / cooldowns / intervals
 * after real playtests, the same way other Battles' `phases[].afterMinutes`
 * and `disruptions[]` timings get tuned (see other battles/*\/metadata.json).
 */
export interface CryptoBattleConfig {
  readonly prime: bigint;
  readonly threshold: number;
  readonly shareCount: number;
  readonly matchDurationMs: number;
  readonly phaseBoundaries: PhaseBoundaries;
  /** How often (ms) a fresh LEAK contract is issued per team. */
  readonly contractIntervalMs: number;
  /** How long (ms) an issued contract stays "open" before it expires unclaimed. */
  readonly contractTtlMs: number;
  /** Minimum time (ms) between two ROTATE ops for the same team. */
  readonly rotateCooldownMs: number;
  readonly scores: ScoreRules;
}

export type ContractKind = "standard" | "rush";
export type ContractStatus = "open" | "completed" | "expired";

export interface Contract {
  readonly id: string;
  /** The team this contract was issued to (only that team may LEAK against it). */
  readonly teamId: string;
  readonly kind: ContractKind;
  readonly points: number;
  readonly requestedShareIndices: readonly number[];
  readonly issuedAtMs: number;
  readonly expiresAtMs: number;
  readonly status: ContractStatus;
  readonly resolution?: "leak";
}

/** One entry in the Public Ledger: a share value a team chose to reveal via LEAK. */
export interface PublicArtifact {
  readonly id: string;
  readonly teamId: string;
  /** The team's secret generation this share belongs to (see ROTATE). */
  readonly generation: number;
  readonly kind: "share";
  readonly shareIndex: number;
  /** Stringified bigint -- see reducer.ts on why the ledger stores strings. */
  readonly value: string;
  readonly contractId: string;
  readonly postedAtMs: number;
}

/**
 * Per-team private state, held only by the trusted pure-model runtime (the
 * platform dispatcher Lambda), never sent to a participant directly --
 * `projectForTeam` is the only sanctioned read path, and it redacts every
 * other team's `secret` / `shares` (see reducer.ts + adversarial test #5).
 */
export interface TeamState {
  readonly teamId: string;
  readonly score: number;
  /** Increments on every successful ROTATE; shares/secret below are for THIS generation. */
  readonly generation: number;
  readonly secret: bigint;
  /** All `shareCount` shares for the current generation (only some may have been LEAKed). */
  readonly shares: readonly Share[];
  readonly lastRotateAtMs: number | undefined;
  readonly completedContractIds: readonly string[];
  /** This team's OWN generations that some attacker has successfully HUNTed. */
  readonly huntedGenerations: readonly number[];
}

export interface CryptoBattleState {
  readonly config: CryptoBattleConfig;
  readonly seed: string;
  readonly phase: Phase;
  /** Wall-clock time of the most recent tick(); undefined before the first tick. */
  readonly nowMs: number | undefined;
  /** Wall-clock time the match started (= the first tick's eventNowMs). */
  readonly startedAtMs: number | undefined;
  readonly nextContractAtMs: number | undefined;
  readonly contracts: readonly Contract[];
  readonly publicLedger: readonly PublicArtifact[];
  readonly teams: Readonly<Record<string, TeamState>>;
  /** Replay guard: `${attackerTeamId}|${targetTeamId}|${generation}` for every successful HUNT. */
  readonly successfulHunts: readonly string[];
}

export type CryptoBattleOp =
  | { readonly kind: "leak"; readonly contractId: string }
  | {
      readonly kind: "hunt";
      readonly targetTeamId: string;
      readonly generation: number;
      readonly recoveredSecret: bigint;
    }
  | { readonly kind: "rotate" };

export interface VaultProjection {
  readonly teamId: string;
  readonly secret: string;
  readonly shares: readonly { readonly index: number; readonly value: string }[];
  readonly generation: number;
  readonly lastRotateAtMs: number | undefined;
  readonly rotateCooldownRemainingMs: number;
  readonly completedContractIds: readonly string[];
  readonly huntedGenerations: readonly number[];
}

export interface ContractProjection {
  readonly id: string;
  readonly kind: ContractKind;
  readonly points: number;
  readonly requestedShareIndices: readonly number[];
  readonly issuedAtMs: number;
  readonly expiresAtMs: number;
  readonly status: ContractStatus;
}

export interface TeamSummaryProjection {
  readonly teamId: string;
  readonly score: number;
  readonly generation: number;
  readonly huntedGenerationCount: number;
}

/**
 * What one team is allowed to see. Built exclusively from `state` by
 * `projectForTeam` -- never hand-assembled elsewhere, so there is exactly one
 * place that has to get the redaction right.
 */
export interface CryptoBattleProjection {
  readonly phase: Phase;
  readonly nowMs: number | undefined;
  readonly startedAtMs: number | undefined;
  readonly matchEndsAtMs: number | undefined;
  readonly vault: VaultProjection;
  readonly myContracts: readonly ContractProjection[];
  readonly otherOpenContractCount: number;
  readonly publicLedger: readonly PublicArtifact[];
  readonly teams: Readonly<Record<string, TeamSummaryProjection>>;
}
