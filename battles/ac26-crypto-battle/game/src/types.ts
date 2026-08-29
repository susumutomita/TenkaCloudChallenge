/**
 * State / op / projection / config types for the PROVE / LEAK / HUNT Battle's
 * pure game model.
 *
 * `CoordinationContext` and the `ValidateResult` shape below intentionally
 * mirror what `@tenkacloud/coordination-plugin-sdk` expects a CoordinationPlugin
 * to consume/return (see AGENTS.md ADR-028 note in SCHEMA.json), which is why
 * `coordination/crypto-battle.ts` (PR3) wraps `reducer.ts`'s exports directly
 * without reshaping them. That SDK package does not exist in this repository
 * (TenkaCloudChallenge owns problem content, not platform packages -- see
 * this repo's AGENTS.md "Repository boundary") and MUST NOT be imported here.
 *
 * PROVE (Issue #486 PR2) is a `CryptoBattleOp` discriminant backed by a real
 * Fiat-Shamir Schnorr verifier (schnorr-verifier.ts) -- see that module and
 * schnorr-prover.ts / schnorr-witness.ts / schnorr-transcript.ts / group.ts
 * for the scheme.
 *
 * JSON-SAFETY INVARIANT (Issue #486 PR3 review fix): `CryptoBattleState` and
 * `CryptoBattleOp` MUST both round-trip cleanly through `JSON.stringify` /
 * `JSON.parse` -- no field anywhere in either type may be a raw `bigint`.
 * This is not a style preference: the platform dispatcher receives `op` as
 * plain parsed-JSON `unknown` off the wire (TenkaCloud's
 * `CoordinationOpBodySchema` is `{ op: z.unknown() }`, no shape validation
 * happens before it reaches this package's `validateOp`) and persists `state`
 * through backends that cannot carry a `bigint` either (Turso:
 * `JSON.stringify` throws on one outright; DynamoDB: round-tripping through
 * `Number` silently loses precision above 2^53-1, well under this package's
 * 2048-bit Schnorr group elements and even under `field.ts`'s own 61-bit
 * `P`). So every bigint that used to live in `CryptoBattleState` /
 * `CryptoBattleOp` (`TeamState.secret`, `TeamState.shares[].value`,
 * `CryptoBattleConfig.prime`, the hunt op's `recoveredSecret`) is a
 * stringified decimal here instead -- the same convention `SchnorrProof` /
 * `ShareArtifact` / `ProofArtifact` / `publicCommitments` already used from
 * PR1/PR2. `game/src`'s pure crypto modules (`field.ts`, `shamir.ts`,
 * `group.ts`, `schnorr-*.ts`, `prng.ts`, `fixtures.ts`) are unaffected and
 * keep working in `bigint` internally -- only the shapes that cross the
 * state/op boundary changed; `reducer.ts` converts at that boundary
 * (`BigInt(...)` on the way in, `.toString()` on the way out).
 */

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
  /** Stringified bigint -- see this file's header "JSON-SAFETY INVARIANT". */
  readonly prime: string;
  readonly threshold: number;
  readonly shareCount: number;
  readonly matchDurationMs: number;
  readonly phaseBoundaries: PhaseBoundaries;
  /** How often (ms) a fresh LEAK contract is issued per team. */
  readonly contractIntervalMs: number;
  /** How long (ms) an issued contract stays "open" before it expires unclaimed. */
  readonly contractTtlMs: number;
  /**
   * How long (ms) a "rush" contract stays open. Shorter than `contractTtlMs`
   * so the extra `scores.rushContract` points are genuinely time-pressured,
   * not just a flat bonus with the same deadline as a standard contract.
   */
  readonly rushContractTtlMs: number;
  /** Minimum time (ms) between two ROTATE ops for the same team. */
  readonly rotateCooldownMs: number;
  readonly scores: ScoreRules;
}

export type ContractKind = "standard" | "rush";
export type ContractStatus = "open" | "completed" | "expired";

export interface Contract {
  readonly id: string;
  /** The team this contract was issued to (only that team may LEAK/PROVE against it). */
  readonly teamId: string;
  readonly kind: ContractKind;
  readonly points: number;
  readonly requestedShareIndices: readonly number[];
  readonly issuedAtMs: number;
  readonly expiresAtMs: number;
  readonly status: ContractStatus;
  readonly resolution?: "leak" | "prove";
}

/**
 * A non-interactive Fiat-Shamir Schnorr proof, as PROVE submits it and as
 * the Public Ledger's `ProofArtifact` records it -- see schnorr-prover.ts /
 * schnorr-verifier.ts. Both fields are stringified bigints (same convention
 * as `ShareArtifact.value` below): a decimal `Contract.id`-sized JSON payload
 * stays JSON-safe without a bigint-aware serializer.
 */
export interface SchnorrProof {
  /** The Schnorr commitment R = g^k mod p. */
  readonly commitment: string;
  /** The response z = k + e*w mod group.order. */
  readonly response: string;
}

/** One entry in the Public Ledger: a share value a team chose to reveal via LEAK. */
export interface ShareArtifact {
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
 * One entry in the Public Ledger: an audit-only record that a team completed
 * a Contract via PROVE. Deliberately holds ONLY the proof transcript
 * (`commitment` / `response`) -- never a share value and never the secret or
 * witness those were derived from. Recording the transcript at all (rather
 * than nothing) is what makes a PROVE completion independently replay-
 * verifiable after the fact (Issue #486's trusted-verification minimum bar),
 * while the transcript itself carries no cryptographic material a viewer
 * could use to reconstruct anything (see schnorr.test.ts's secret-non-
 * leakage test).
 */
export interface ProofArtifact {
  readonly id: string;
  readonly teamId: string;
  /** The team's secret generation the proven public commitment Y belongs to. */
  readonly generation: number;
  readonly kind: "proof";
  readonly contractId: string;
  readonly commitment: string;
  readonly response: string;
  readonly postedAtMs: number;
}

export type PublicArtifact = ShareArtifact | ProofArtifact;

/**
 * A Shamir share as it lives in `CryptoBattleState` / `CryptoBattleProjection`
 * -- `value` is a stringified bigint (see this file's header "JSON-SAFETY
 * INVARIANT"), unlike `shamir.ts`'s own `Share`, which stays `bigint` because
 * it is that module's pure internal computation type, never part of the
 * state/op wire shape directly.
 */
export interface StoredShare {
  readonly index: number;
  readonly value: string;
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
  /** Stringified bigint -- see this file's header "JSON-SAFETY INVARIANT". */
  readonly secret: string;
  /** All `shareCount` shares for the current generation (only some may have been LEAKed). */
  readonly shares: readonly StoredShare[];
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
  /**
   * Every team's current-generation Schnorr public commitment
   * `Y = g^w mod p` (stringified bigint), keyed by teamId -- PROVE's
   * verifier checks a submitted proof against this. Public by construction
   * (unlike `TeamState.secret` / `.shares`): derived once per team at
   * `initialState` and re-derived on every ROTATE (see reducer.ts's
   * `applyRotate`), so it always reflects the team's *current* generation
   * the same way `TeamState.generation` does. Lives at the state's top
   * level, not inside `TeamState`, specifically so it is unambiguous that
   * this field -- unlike everything else `TeamState` holds -- is always safe
   * to hand to every team via `projectForTeam`.
   */
  readonly publicCommitments: Readonly<Record<string, string>>;
  /**
   * Replay guard: `JSON.stringify([attackerTeamId, targetTeamId, generation])`
   * for every successful HUNT. JSON-encoded (not `|`-joined) so a team id
   * that happens to contain `|` can never collide with a different triple.
   */
  readonly successfulHunts: readonly string[];
  /**
   * Ordered log of successful HUNTs, WITH a timestamp (Issue #486 PR5,
   * `replay.ts`). `successfulHunts` above deliberately carries only the
   * replay-guard KEY, no `atMs` -- it cannot answer "when did this HUNT
   * succeed?" on its own, and every other `PublicArtifact` on the ledger
   * already has a `postedAtMs` a debrief/replay can use, but a HUNT posts no
   * ledger artifact at all (see reducer.ts's `applyHunt`). This field exists
   * purely so `replay.ts`'s post-match debrief (Issue #486's "120分 debrief
   * / Replay" -- the worked example is literally "58:01 Team B HUNT
   * success") can be honest about hunt timing instead of omitting it or
   * guessing. Purely additive: `validateOp`'s replay guard still reads only
   * `successfulHunts` above, never this field -- see `applyHunt`.
   */
  readonly huntLog: readonly HuntLogEntry[];
}

/** One entry in `CryptoBattleState.huntLog` -- see that field's doc comment. */
export interface HuntLogEntry {
  readonly attackerTeamId: string;
  readonly targetTeamId: string;
  readonly generation: number;
  readonly atMs: number;
}

export type CryptoBattleOp =
  | { readonly kind: "leak"; readonly contractId: string }
  | {
      readonly kind: "hunt";
      readonly targetTeamId: string;
      readonly generation: number;
      /**
       * Stringified bigint -- see this file's header "JSON-SAFETY INVARIANT".
       * `validateOp`'s "hunt" branch parses this with `schnorr-verifier.ts`'s
       * `parseCanonicalDecimal` (the same untrusted-decimal-parsing gate
       * PROVE's proof fields already go through) and rejects a malformed
       * value with `{ ok: false }` rather than throwing.
       */
      readonly recoveredSecret: string;
    }
  | { readonly kind: "rotate" }
  | { readonly kind: "prove"; readonly contractId: string; readonly proof: SchnorrProof };

export interface VaultProjection {
  readonly teamId: string;
  readonly secret: string;
  readonly shares: readonly StoredShare[];
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
  readonly status: ContractStatus;
  /**
   * Ms remaining until this contract expires, AS OF the state's last
   * `tick()` -- a duration, not a timestamp. `Contract.expiresAtMs` (which
   * this is derived from in `projectForTeam`) lives on the same clock as
   * `tick(state, eventNowMs)`'s `eventNowMs`, which TenkaCloud's dispatcher
   * documents as `nowMs - eventStartMs` (elapsed ms since the event started,
   * NOT a Unix epoch ms) -- see `CryptoBattleState.nowMs`'s doc comment.
   * Handing a raw `expiresAtMs` to a portal that subtracts its own
   * wall-clock `Date.now()` (an absolute epoch ms, off by a factor of
   * roughly 10^9 from an elapsed-ms duration) silently produces a deeply
   * negative number that every duration-formatting helper clamps to zero --
   * this repo's own `StatusPanel.tsx` did exactly that before this field
   * existed, rendering every live contract's deadline as a permanent
   * "0:00" regardless of how much time was actually left. Shipping a
   * pre-computed duration instead removes the unit mismatch at its source;
   * the portal only adds its own wall-clock elapsed-since-last-poll delta on
   * top (`coordination.ts`'s `receivedAtWallMs`) to animate a smooth
   * per-second countdown between 30s polls, never a second subtraction
   * against an absolute clock.
   */
  readonly remainingMs: number;
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
  /**
   * Ms remaining until the match ends, AS OF the state's last `tick()` --
   * `undefined` before the first tick (match not started). Same
   * duration-not-timestamp rationale as `ContractProjection.remainingMs`
   * above: `CryptoBattleState.startedAtMs` lives on `tick()`'s
   * elapsed-since-event-start clock, not an absolute epoch, so this field
   * is computed here rather than exposing `startedAtMs` /
   * `state.config.matchDurationMs` for the portal to (mis)combine with its
   * own wall clock.
   */
  readonly matchRemainingMs: number | undefined;
  readonly vault: VaultProjection;
  readonly myContracts: readonly ContractProjection[];
  readonly otherOpenContractCount: number;
  readonly publicLedger: readonly PublicArtifact[];
  readonly teams: Readonly<Record<string, TeamSummaryProjection>>;
  /** Every team's current-generation Schnorr public commitment -- see CryptoBattleState's field of the same name. Public by construction, safe for every team to see. */
  readonly publicCommitments: Readonly<Record<string, string>>;
}
