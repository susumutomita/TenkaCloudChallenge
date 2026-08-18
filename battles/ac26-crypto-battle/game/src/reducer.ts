/**
 * Pure game model for the PROVE / LEAK / HUNT / ROTATE Battle (Issue #486, PR1-PR3).
 *
 * `initialState` / `validateOp` / `applyOp` / `tick` / `projectForTeam` below
 * are plain functions with the exact shape a `@tenkacloud/coordination-plugin-sdk`
 * CoordinationPlugin needs (see ADR-028's description of `interTeamCoordination`
 * in SCHEMA.json): the platform's dispatcher Lambda drives a single tenant/event
 * row through validate -> apply -> project. That SDK package is NOT a dependency
 * of this repository (TenkaCloudChallenge owns problem content, not platform
 * packages) and is deliberately never imported here -- `coordination/crypto-battle.ts`
 * (PR3) wires these exports into a thin plugin file, without reshaping them.
 *
 * Trust model: this whole `game/` package runs only on the trusted side (the
 * platform dispatcher). `TeamState.secret` / `TeamState.shares` are real
 * cryptographic material and this reducer computes with them directly -- that
 * is safe *only* because a participant never receives raw `CryptoBattleState`,
 * only what `projectForTeam` redacts down to (see that function, and
 * adversarial test #5).
 *
 * WIRE BOUNDARY (Issue #486 PR3 review fix): `validateOp` below IS the
 * boundary that turns a participant's untrusted request into something this
 * reducer trusts -- there is no separate parsing layer upstream. The
 * coordination plugin (`coordination/crypto-battle.ts`) is a bare passthrough
 * (`dispatchOp` calls `validateOp` directly on whatever arrived as
 * JSON-parsed `unknown` off the wire; TenkaCloud's `CoordinationOpBodySchema`
 * is `{ op: z.unknown() }`, no shape validation happens before this package
 * ever sees `op`), and `CryptoBattleState` itself has to survive a real
 * database round-trip between calls (Turso / DynamoDB -- see
 * `CryptoBattleOp` / `CryptoBattleState`'s "JSON-SAFETY INVARIANT" in
 * types.ts). Concretely: `CryptoBattleOp`'s hunt variant carries
 * `recoveredSecret` as a string, and `validateOp`'s "hunt" branch parses it
 * with `schnorr-verifier.ts`'s `parseCanonicalDecimal` -- the same
 * untrusted-decimal gate PROVE's proof fields already went through -- and
 * rejects a malformed value with `{ ok: false }` instead of a `mod()` call
 * throwing on a non-bigint value it was never guaranteed to receive.
 *
 * Purity contract (see adversarial tests #7 / #8):
 *   - `applyOp` and `tick` never mutate the `state` they are given; they return
 *     a new value built entirely from immutable updates (object/array spreads).
 *   - No function under src/ reads `Date.now()`, `Math.random()`, or any other
 *     ambient/non-deterministic source. The only "time" a reducer ever sees is
 *     `tick`'s explicit `eventNowMs` argument; the only "randomness" is derived
 *     from `state.seed` via prng.ts.
 *   - Given the same seed and the same ordered sequence of tick/op calls, two
 *     independent replays produce deeply-equal state, always.
 *
 * PROVE (PR2) validates a submitted proof via schnorr-verifier.ts's
 * `verifyProof` -- a trusted verifier that never imports a secret, a witness,
 * or the prover module (see that file's header for why). `applyOp`'s "prove"
 * branch never re-derives or reasons about the underlying secret: it only
 * ever sees `state.publicCommitments[teamId]` (public) and the submitted
 * `SchnorrProof` (public once submitted).
 */

import { deriveContractPlan, deriveTeamGeneration, type FieldConfig } from "./fixtures.ts";
import { mod, P } from "./field.ts";
import { RFC3526_GROUP14 } from "./group.ts";
import { derivePublicCommitment } from "./schnorr-witness.ts";
import { parseCanonicalDecimal, verifyProof } from "./schnorr-verifier.ts";
import type {
  Contract,
  CoordinationContext,
  CryptoBattleConfig,
  CryptoBattleOp,
  CryptoBattleProjection,
  CryptoBattleState,
  Phase,
  ProofArtifact,
  PublicArtifact,
  StoredShare,
  TeamState,
  TeamSummaryProjection,
  ValidateResult,
} from "./types.ts";

/**
 * Issue #486 playtest seed values. Not a locked-in balance spec -- see
 * `CryptoBattleConfig`'s doc comment in types.ts. `prime` is `P.toString()`,
 * not `P`, because `CryptoBattleConfig.prime` is a stringified bigint (see
 * types.ts's "JSON-SAFETY INVARIANT").
 */
export const DEFAULT_CONFIG: CryptoBattleConfig = {
  prime: P.toString(),
  threshold: 3,
  shareCount: 5,
  matchDurationMs: 90 * 60_000,
  phaseBoundaries: {
    buildToPressureMs: 30 * 60_000,
    pressureToEndgameMs: 60 * 60_000,
  },
  contractIntervalMs: 2 * 60_000,
  contractTtlMs: 5 * 60_000,
  rushContractTtlMs: 2.5 * 60_000,
  rotateCooldownMs: 3 * 60_000,
  scores: {
    contract: 10,
    rushContract: 20,
    huntBonus: 20,
    huntPenalty: 10,
  },
};

function mergeConfig(config: Partial<CryptoBattleConfig> | undefined): CryptoBattleConfig {
  return {
    ...DEFAULT_CONFIG,
    ...config,
    phaseBoundaries: { ...DEFAULT_CONFIG.phaseBoundaries, ...config?.phaseBoundaries },
    scores: { ...DEFAULT_CONFIG.scores, ...config?.scores },
  };
}

/**
 * Boundary conversion (Issue #486 PR3 review fix): `fixtures.ts`'s
 * derivations are pure `bigint` functions (see that file's header), but
 * `CryptoBattleConfig.prime` is a stringified bigint for JSON-safety. This is
 * the one place that bridges the two, so every `fixtures.ts` call site below
 * converts through it rather than re-deriving `BigInt(config.prime)` inline.
 */
function fieldConfigOf(config: CryptoBattleConfig): FieldConfig {
  return { prime: BigInt(config.prime), threshold: config.threshold, shareCount: config.shareCount };
}

export function initialState(
  ctx: CoordinationContext,
  config?: Partial<CryptoBattleConfig>,
): CryptoBattleState {
  const mergedConfig = mergeConfig(config);
  const fieldConfig = fieldConfigOf(mergedConfig);
  const teams: Record<string, TeamState> = {};
  const publicCommitments: Record<string, string> = {};
  for (const teamId of ctx.teamIds) {
    const { secret, shares } = deriveTeamGeneration(ctx.eventId, teamId, 1, fieldConfig);
    teams[teamId] = {
      teamId,
      score: 0,
      generation: 1,
      secret: secret.toString(),
      shares: shares.map((s): StoredShare => ({ index: s.index, value: s.value.toString() })),
      lastRotateAtMs: undefined,
      completedContractIds: [],
      huntedGenerations: [],
    };
    publicCommitments[teamId] = derivePublicCommitment(secret, 1, teamId, RFC3526_GROUP14).toString();
  }
  return {
    config: mergedConfig,
    seed: ctx.eventId,
    phase: "build",
    nowMs: undefined,
    startedAtMs: undefined,
    nextContractAtMs: undefined,
    contracts: [],
    publicLedger: [],
    teams,
    publicCommitments,
    successfulHunts: [],
    huntLog: [],
  };
}

function computePhase(elapsedMs: number, config: CryptoBattleConfig): Phase {
  if (elapsedMs >= config.matchDurationMs) return "ended";
  if (elapsedMs >= config.phaseBoundaries.pressureToEndgameMs) return "endgame";
  if (elapsedMs >= config.phaseBoundaries.buildToPressureMs) return "pressure";
  return "build";
}

/**
 * Advance the match clock to `eventNowMs`: recompute phase, expire stale open
 * contracts, and issue every contract batch due at or before `eventNowMs`.
 * `eventNowMs` must be non-decreasing across calls for the same state lineage
 * (the reducer trusts its caller for monotonicity, same as any event-sourced
 * reducer -- it does not read a clock itself, see this file's purity contract
 * above).
 */
export function tick(state: CryptoBattleState, eventNowMs: number): CryptoBattleState {
  const startedAtMs = state.startedAtMs ?? eventNowMs;
  const elapsedMs = eventNowMs - startedAtMs;
  const phase = computePhase(elapsedMs, state.config);
  const matchEndAtMs = startedAtMs + state.config.matchDurationMs;

  const contracts: Contract[] = state.contracts.map((c) =>
    c.status === "open" && c.expiresAtMs <= eventNowMs ? { ...c, status: "expired" } : c,
  );

  const issuedCountByTeam = new Map<string, number>();
  for (const c of contracts) {
    issuedCountByTeam.set(c.teamId, (issuedCountByTeam.get(c.teamId) ?? 0) + 1);
  }

  const issued: Contract[] = [];
  const fieldConfig = fieldConfigOf(state.config);
  let nextContractAtMs = state.nextContractAtMs ?? startedAtMs;
  while (nextContractAtMs <= eventNowMs && nextContractAtMs < matchEndAtMs) {
    for (const teamId of Object.keys(state.teams)) {
      const sequenceIndex = issuedCountByTeam.get(teamId) ?? 0;
      const plan = deriveContractPlan(state.seed, teamId, sequenceIndex, fieldConfig);
      const ttlMs = plan.kind === "rush" ? state.config.rushContractTtlMs : state.config.contractTtlMs;
      issued.push({
        id: `${teamId}-c${sequenceIndex}`,
        teamId,
        kind: plan.kind,
        points: plan.kind === "rush" ? state.config.scores.rushContract : state.config.scores.contract,
        requestedShareIndices: plan.requestedShareIndices,
        issuedAtMs: nextContractAtMs,
        expiresAtMs: nextContractAtMs + ttlMs,
        status: "open",
      });
      issuedCountByTeam.set(teamId, sequenceIndex + 1);
    }
    nextContractAtMs += state.config.contractIntervalMs;
  }

  return {
    ...state,
    phase,
    nowMs: eventNowMs,
    startedAtMs,
    nextContractAtMs,
    contracts: issued.length === 0 ? contracts : [...contracts, ...issued],
  };
}

/**
 * JSON-encoded rather than `|`-joined: a delimiter-joined key would let a
 * team id containing `|` collide with an unrelated (attacker, target,
 * generation) triple and cause a false "already hunted" rejection.
 * `JSON.stringify` on an array of two strings + a number has no such
 * ambiguity (each string element is quoted and escaped independently).
 */
function huntKey(attackerTeamId: string, targetTeamId: string, generation: number): string {
  return JSON.stringify([attackerTeamId, targetTeamId, generation]);
}

export function validateOp(state: CryptoBattleState, teamId: string, op: CryptoBattleOp): ValidateResult {
  const team = state.teams[teamId];
  if (!team) return { ok: false, error: `unknown team "${teamId}"` };

  // No op of any kind is legal once the match clock has run out -- without
  // this, a team could keep LEAKing / HUNTing / ROTATEing past `matchDurationMs`
  // simply because nothing else told the reducer to stop accepting ops.
  if (state.phase === "ended") {
    return { ok: false, error: "match has ended" };
  }

  switch (op.kind) {
    case "leak": {
      const contract = state.contracts.find((c) => c.id === op.contractId);
      if (!contract) return { ok: false, error: `contract "${op.contractId}" not found` };
      if (contract.teamId !== teamId) {
        return { ok: false, error: `contract "${op.contractId}" belongs to another team` };
      }
      if (contract.status !== "open") {
        return { ok: false, error: `contract "${op.contractId}" is ${contract.status}, not open` };
      }
      return { ok: true };
    }
    case "hunt": {
      if (op.targetTeamId === teamId) {
        return { ok: false, error: "cannot hunt your own team" };
      }
      const target = state.teams[op.targetTeamId];
      if (!target) return { ok: false, error: `unknown target team "${op.targetTeamId}"` };
      if (op.generation !== target.generation) {
        return {
          ok: false,
          error: `target team is on generation ${target.generation}, not ${op.generation}`,
        };
      }
      if (state.successfulHunts.includes(huntKey(teamId, op.targetTeamId, op.generation))) {
        return { ok: false, error: "this generation was already hunted successfully by this team" };
      }
      // `op.recoveredSecret` is untrusted wire input (a participant-submitted
      // string -- see this file's header "WIRE BOUNDARY"), never a `bigint`
      // this reducer can assume it already has. Parse it through the same
      // gate PROVE's proof fields use before doing any bigint arithmetic on
      // it -- a malformed value (wrong JS type after JSON round-trip, a
      // non-canonical literal, an absurdly long string) is rejected here,
      // not left to throw out of `mod()` / `BigInt()` uncaught.
      const recoveredSecret = parseCanonicalDecimal(op.recoveredSecret);
      if (recoveredSecret === undefined) {
        return { ok: false, error: "recoveredSecret must be a canonical, length-bounded decimal integer" };
      }
      if (mod(recoveredSecret, BigInt(state.config.prime)) !== BigInt(target.secret)) {
        return { ok: false, error: "recovered secret does not match the target's actual secret" };
      }
      return { ok: true };
    }
    case "rotate": {
      // Before the first tick(), `state.nowMs` is undefined and so is every
      // team's `lastRotateAtMs`, which used to make the cooldown check below
      // vacuously pass -- a team could ROTATE any number of times before the
      // match clock ever advances. Reject outright instead of silently
      // skipping the cooldown it cannot yet measure.
      if (state.nowMs === undefined) {
        return { ok: false, error: "match has not started yet (no tick() has run)" };
      }
      if (team.lastRotateAtMs !== undefined) {
        const sinceLastRotateMs = state.nowMs - team.lastRotateAtMs;
        if (sinceLastRotateMs < state.config.rotateCooldownMs) {
          return {
            ok: false,
            error: `rotate is on cooldown for ${state.config.rotateCooldownMs - sinceLastRotateMs}ms more`,
          };
        }
      }
      return { ok: true };
    }
    case "prove": {
      // Same "own open contract" precondition as leak -- PROVE is a second
      // way to complete a Contract, not a different queue of things to
      // complete.
      const contract = state.contracts.find((c) => c.id === op.contractId);
      if (!contract) return { ok: false, error: `contract "${op.contractId}" not found` };
      if (contract.teamId !== teamId) {
        return { ok: false, error: `contract "${op.contractId}" belongs to another team` };
      }
      if (contract.status !== "open") {
        return { ok: false, error: `contract "${op.contractId}" is ${contract.status}, not open` };
      }
      const publicCommitmentY = state.publicCommitments[teamId];
      if (publicCommitmentY === undefined) {
        // Cannot happen for a known team -- initialState/applyRotate always
        // set this alongside TeamState. Fail loudly rather than silently
        // treating a missing commitment as "nothing to check against".
        return { ok: false, error: `no public commitment on record for team "${teamId}"` };
      }
      const verified = verifyProof(
        BigInt(publicCommitmentY),
        op.proof,
        { teamId, contractId: op.contractId, generation: team.generation },
        RFC3526_GROUP14,
      );
      if (!verified) {
        return { ok: false, error: "proof failed verification" };
      }
      return { ok: true };
    }
    default: {
      const exhaustive: never = op;
      return { ok: false, error: `unknown op kind ${JSON.stringify(exhaustive)}` };
    }
  }
}

function applyLeak(
  state: CryptoBattleState,
  teamId: string,
  op: Extract<CryptoBattleOp, { kind: "leak" }>,
): CryptoBattleState {
  const contract = state.contracts.find((c) => c.id === op.contractId);
  const team = state.teams[teamId];
  if (!contract || !team) {
    // validateOp() must reject before this is reached; a caller that skips
    // validation gets a loud failure, never a silent no-op state change.
    throw new Error("applyOp(leak): invalid op reached apply -- call validateOp() first");
  }

  const nowMs = state.nowMs ?? contract.issuedAtMs;
  const artifacts: PublicArtifact[] = contract.requestedShareIndices.map((shareIndex) => {
    const shareEntry = team.shares.find((s) => s.index === shareIndex);
    if (!shareEntry) {
      throw new Error(`applyOp(leak): team "${teamId}" has no share at index ${shareIndex}`);
    }
    return {
      id: `${contract.id}-share${shareIndex}`,
      teamId,
      generation: team.generation,
      kind: "share",
      shareIndex,
      // `shareEntry.value` is already a stringified bigint (`StoredShare`,
      // see types.ts) -- no `.toString()` needed to reach the ledger's own
      // stringified-bigint `ShareArtifact.value`.
      value: shareEntry.value,
      contractId: contract.id,
      postedAtMs: nowMs,
    };
  });

  const contracts = state.contracts.map((c) =>
    c.id === contract.id ? { ...c, status: "completed" as const, resolution: "leak" as const } : c,
  );
  const updatedTeam: TeamState = {
    ...team,
    score: team.score + contract.points,
    completedContractIds: [...team.completedContractIds, contract.id],
  };

  return {
    ...state,
    contracts,
    publicLedger: [...state.publicLedger, ...artifacts],
    teams: { ...state.teams, [teamId]: updatedTeam },
  };
}

function applyHunt(
  state: CryptoBattleState,
  teamId: string,
  op: Extract<CryptoBattleOp, { kind: "hunt" }>,
): CryptoBattleState {
  const attacker = state.teams[teamId];
  const target = state.teams[op.targetTeamId];
  if (!attacker || !target) {
    throw new Error("applyOp(hunt): invalid op reached apply -- call validateOp() first");
  }

  const updatedAttacker: TeamState = {
    ...attacker,
    score: attacker.score + state.config.scores.huntBonus,
  };
  const updatedTarget: TeamState = {
    ...target,
    score: Math.max(0, target.score - state.config.scores.huntPenalty),
    huntedGenerations: target.huntedGenerations.includes(op.generation)
      ? target.huntedGenerations
      : [...target.huntedGenerations, op.generation],
  };

  return {
    ...state,
    teams: { ...state.teams, [teamId]: updatedAttacker, [op.targetTeamId]: updatedTarget },
    successfulHunts: [...state.successfulHunts, huntKey(teamId, op.targetTeamId, op.generation)],
    // Additive audit trail for replay.ts -- see HuntLogEntry's doc comment
    // in types.ts for why this exists alongside (not instead of)
    // successfulHunts above.
    huntLog: [
      ...state.huntLog,
      { attackerTeamId: teamId, targetTeamId: op.targetTeamId, generation: op.generation, atMs: state.nowMs ?? 0 },
    ],
  };
}

function applyRotate(state: CryptoBattleState, teamId: string): CryptoBattleState {
  const team = state.teams[teamId];
  if (!team) {
    throw new Error("applyOp(rotate): invalid op reached apply -- call validateOp() first");
  }
  const generation = team.generation + 1;
  const { secret, shares } = deriveTeamGeneration(state.seed, teamId, generation, fieldConfigOf(state.config));
  const updatedTeam: TeamState = {
    ...team,
    generation,
    secret: secret.toString(),
    shares: shares.map((s): StoredShare => ({ index: s.index, value: s.value.toString() })),
    lastRotateAtMs: state.nowMs,
  };
  // Rotate's time cost isn't only the cooldown: every contract issued to
  // this team before the rotate is voided along with the old generation.
  // Without this, LEAKing a pre-rotate contract after rotating would just
  // publish a fresh-generation share for free -- a shortcut that defeats the
  // whole point of rotating away from exposure (Issue #486 frames ROTATE as
  // carrying a real compute/time cost; see OPERATOR.md's design note).
  const contracts = state.contracts.map((c) =>
    c.teamId === teamId && c.status === "open" ? { ...c, status: "expired" as const } : c,
  );
  // The Schnorr public commitment is generation-scoped (see
  // schnorr-witness.ts's derivePublicCommitment): rederiving it here is what
  // makes a pre-rotate PROVE proof fail verification post-rotate, the same
  // way rotate already invalidates pre-rotate LEAK shares for HUNT above.
  const publicCommitments = {
    ...state.publicCommitments,
    [teamId]: derivePublicCommitment(secret, generation, teamId, RFC3526_GROUP14).toString(),
  };
  return { ...state, contracts, teams: { ...state.teams, [teamId]: updatedTeam }, publicCommitments };
}

function applyProve(
  state: CryptoBattleState,
  teamId: string,
  op: Extract<CryptoBattleOp, { kind: "prove" }>,
): CryptoBattleState {
  const contract = state.contracts.find((c) => c.id === op.contractId);
  const team = state.teams[teamId];
  if (!contract || !team) {
    throw new Error("applyOp(prove): invalid op reached apply -- call validateOp() first");
  }

  const nowMs = state.nowMs ?? contract.issuedAtMs;
  // Audit-only transcript: commitment/response only, NEVER a share value or
  // the secret/witness they were derived from -- see types.ts's
  // ProofArtifact doc comment and schnorr.test.ts's secret-non-leakage test.
  //
  // Re-serialized via BigInt(...).toString() rather than storing op.proof's
  // raw strings verbatim: validateOp()'s verifyProof() call already forces
  // both fields to match `/^\d{1,700}$/` before this is ever reached (see
  // schnorr-verifier.ts's parseCanonicalDecimal), so this round-trip is
  // defense-in-depth, not a correctness fix -- it guarantees the Public
  // Ledger only ever holds the canonical decimal form of a value, never
  // whatever incidental (but still-canonical) formatting a submitted string
  // happened to carry, should that guarantee ever change upstream.
  const artifact: ProofArtifact = {
    id: `${contract.id}-proof`,
    teamId,
    generation: team.generation,
    kind: "proof",
    contractId: contract.id,
    commitment: BigInt(op.proof.commitment).toString(),
    response: BigInt(op.proof.response).toString(),
    postedAtMs: nowMs,
  };

  const contracts = state.contracts.map((c) =>
    c.id === contract.id ? { ...c, status: "completed" as const, resolution: "prove" as const } : c,
  );
  const updatedTeam: TeamState = {
    ...team,
    // Same points as LEAK for the same Contract -- PROVE is a second way to
    // complete a Contract honestly, not a differently-scored one (Issue #486
    // Scoring MUST: no separate "PROVE bonus" for the educational value of
    // proving instead of leaking).
    score: team.score + contract.points,
    completedContractIds: [...team.completedContractIds, contract.id],
  };

  return {
    ...state,
    contracts,
    publicLedger: [...state.publicLedger, artifact],
    teams: { ...state.teams, [teamId]: updatedTeam },
  };
}

/**
 * Apply `op` for `teamId` and return the resulting state. Callers MUST call
 * `validateOp` first and only call `applyOp` when it returned `{ ok: true }`
 * -- this function does not re-validate (that would duplicate the crypto
 * comparison in `validateOp`'s "hunt" branch) and throws rather than silently
 * no-op-ing if it is handed something `validateOp` would have rejected.
 */
export function applyOp(state: CryptoBattleState, teamId: string, op: CryptoBattleOp): CryptoBattleState {
  switch (op.kind) {
    case "leak":
      return applyLeak(state, teamId, op);
    case "hunt":
      return applyHunt(state, teamId, op);
    case "rotate":
      return applyRotate(state, teamId);
    case "prove":
      return applyProve(state, teamId, op);
    default: {
      const exhaustive: never = op;
      throw new Error(`applyOp: unknown op kind ${JSON.stringify(exhaustive)}`);
    }
  }
}

/**
 * The only sanctioned read path for a participant. Redacts every team's
 * state down to what `teamId` is allowed to see: their own vault in full,
 * every team's public score/generation, the full Public Ledger (public by
 * construction -- every entry got there via a LEAK's revealed share or a
 * PROVE's proof transcript), and every team's Schnorr public commitment
 * (also public by construction). No other team's `secret` or un-leaked
 * `shares` -- and no team's witness -- ever appear here (adversarial test #5
 * / prove.test.ts's secret-non-leakage test assert this by scanning the
 * serialized JSON).
 */
export function projectForTeam(state: CryptoBattleState, teamId: string): CryptoBattleProjection {
  const team = state.teams[teamId];
  if (!team) {
    throw new Error(`projectForTeam: unknown team "${teamId}"`);
  }

  const rotateCooldownRemainingMs =
    team.lastRotateAtMs === undefined || state.nowMs === undefined
      ? 0
      : Math.max(0, state.config.rotateCooldownMs - (state.nowMs - team.lastRotateAtMs));

  const myContracts = state.contracts
    .filter((c) => c.teamId === teamId)
    .map((c) => ({
      id: c.id,
      kind: c.kind,
      points: c.points,
      requestedShareIndices: c.requestedShareIndices,
      issuedAtMs: c.issuedAtMs,
      expiresAtMs: c.expiresAtMs,
      status: c.status,
    }));

  const otherOpenContractCount = state.contracts.filter(
    (c) => c.teamId !== teamId && c.status === "open",
  ).length;

  const teams: Record<string, TeamSummaryProjection> = {};
  for (const other of Object.values(state.teams)) {
    teams[other.teamId] = {
      teamId: other.teamId,
      score: other.score,
      generation: other.generation,
      huntedGenerationCount: other.huntedGenerations.length,
    };
  }

  return {
    phase: state.phase,
    nowMs: state.nowMs,
    startedAtMs: state.startedAtMs,
    matchEndsAtMs: state.startedAtMs === undefined ? undefined : state.startedAtMs + state.config.matchDurationMs,
    vault: {
      teamId,
      // team.secret / team.shares are already stringified bigints
      // (TeamState / StoredShare, see types.ts) -- VaultProjection uses the
      // exact same wire shape, so no conversion is needed here.
      secret: team.secret,
      shares: team.shares,
      generation: team.generation,
      lastRotateAtMs: team.lastRotateAtMs,
      rotateCooldownRemainingMs,
      completedContractIds: team.completedContractIds,
      huntedGenerations: team.huntedGenerations,
    },
    myContracts,
    otherOpenContractCount,
    publicLedger: state.publicLedger,
    teams,
    // Public by construction (see CryptoBattleState.publicCommitments) --
    // passed through unredacted, unlike `teams` above it does not need a
    // per-team summary shape.
    publicCommitments: state.publicCommitments,
  };
}
