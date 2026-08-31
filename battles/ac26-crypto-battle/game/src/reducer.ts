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

import {
  type ContractPlan,
  deriveContractPlan,
  deriveTeamGeneration,
  type FieldConfig,
} from "./fixtures.ts";
import { decryptOrderSum, deriveFheOrderInputs, expectedFheSum } from "./fhe.ts";
import {
  allPartials,
  deriveMpcPrivateInputs,
  expectedMpcPartial,
  MPC_PARTY_COUNT,
  MPC_TEAM_PARTY_INDEX,
  sumInField,
} from "./mpc.ts";
import {
  allowedMethodsFor,
  methodCanPerformTask,
  type PrivacyConstraint,
  type SubmissionMethod,
} from "./methods.ts";
import { mod, P } from "./field.ts";
import { groupPow, RFC3526_GROUP14 } from "./group.ts";
import { derivePublicCommitment } from "./schnorr-witness.ts";
import { parseCanonicalDecimal, verifyProof } from "./schnorr-verifier.ts";
import type {
  CiphertextArtifact,
  Contract,
  CoordinationContext,
  CryptoBattleConfig,
  CryptoBattleOp,
  CryptoBattleProjection,
  CryptoBattleState,
  OrderTask,
  OrderTaskProjection,
  PartialArtifact,
  Phase,
  ProofArtifact,
  PublicArtifact,
  StoredCiphertext,
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
  // [Issue #659] Orders arrive every 5 minutes and expire in 5, so a team is
  // always working on the batch in front of it — there is no stockpiling and no
  // taking ahead. That single rule is what keeps LEAK from paying: with a
  // backlog to draw on, leaking an Order frees five minutes that convert into
  // another PROVE, so leaking always beat proving no matter how the points were
  // set. It also gives a fast team's spare capacity nowhere to go but HUNT,
  // which is what finally makes hunting worth its five minutes.
  contractIntervalMs: 5 * 60_000,
  contractsPerIssue: 6,
  contractTtlMs: 5 * 60_000,
  rushContractTtlMs: 2.5 * 60_000,
  rotateCooldownMs: 3 * 60_000,
  scores: {
    // [Issue #659] 失効 -15 < LEAK して狩られる -2 < LEAK 無事 +10 < PROVE +30
    contract: 30,
    contractLeak: 10,
    expiredOrder: -15,
    rushContract: 45,
    huntBonus: 25,
    huntPenalty: 12,
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

/**
 * [Issue #652] The prefix marking a seed the platform did NOT issue.
 *
 * Kept visible in `state.seed` on purpose. A match running on this string is
 * one whose hidden material every participant can recompute from the public
 * `eventId`, so it must be greppable in a dump rather than silently
 * indistinguishable from a real match.
 */
export const LOCAL_PLAY_SEED_PREFIX = "local-play-not-secret:";

/**
 * [Issue #652] The seed every hidden value in the match derives from.
 *
 * Prefers the platform's per-match secret. Falls back to a clearly-marked
 * value built from `eventId` ONLY when no secret was issued — local play and
 * unit tests, where there is no dispatcher to issue one and no opponent to
 * hide anything from.
 *
 * The fallback is not a weaker secret; it is not a secret at all, which is why
 * it announces itself. A real event always runs through the coordination
 * dispatcher, so a real event always has `ctx.matchSecret`.
 */
export function resolveMatchSeed(ctx: CoordinationContext): string {
  return ctx.matchSecret ?? `${LOCAL_PLAY_SEED_PREFIX}${ctx.eventId}`;
}

export function initialState(
  ctx: CoordinationContext,
  config?: Partial<CryptoBattleConfig>,
): CryptoBattleState {
  const mergedConfig = mergeConfig(config);
  const fieldConfig = fieldConfigOf(mergedConfig);
  const teams: Record<string, TeamState> = {};
  const publicCommitments: Record<string, string> = {};
  // Derive from the match seed, never from `ctx.eventId` — everything below
  // (and every later ROTATE, Order belt, FHE and MPC derivation, all of which
  // already read `state.seed`) hangs off this one value.
  const seed = resolveMatchSeed(ctx);
  for (const teamId of ctx.teamIds) {
    const { secret, shares } = deriveTeamGeneration(seed, teamId, 1, fieldConfig);
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
    seed,
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
/**
 * [Issue #645] The public payload one Order carries.
 *
 * FHE and MPC payloads are derived from `(seed, orderId)` rather than stored on
 * the plan, and the confidential half is not derived here at all: the judge
 * re-derives the plaintexts, the key and the masks when it needs them, and
 * `projectForTeam` derives the owning team's private inputs. So the only thing
 * that ever reaches `CryptoBattleState` is material that is safe to publish,
 * and there is no new secret field anyone could forget to redact.
 */
function buildOrderTask(
  plan: ContractPlan,
  seed: string,
  contractId: string,
  prime: bigint,
): OrderTask {
  switch (plan.taskKind) {
    case "reveal-share":
      return { kind: "reveal-share", shareIndices: plan.requestedShareIndices };
    case "homomorphic-sum":
      return {
        kind: "homomorphic-sum",
        inputs: deriveFheOrderInputs(seed, contractId, prime).map((c) => ({
          r: c.r.toString(),
          y: c.y.toString(),
        })),
      };
    case "masked-total":
      return { kind: "masked-total", partyCount: MPC_PARTY_COUNT };
    default: {
      const exhaustive: never = plan.taskKind;
      throw new Error(`buildOrderTask: unknown task kind ${JSON.stringify(exhaustive)}`);
    }
  }
}

/**
 * A contract as it may actually come back from storage, rather than as the
 * current version writes it.
 *
 * A match is long-lived and its state is persisted between calls, so a deploy
 * mid-match hands the reducer rows written by an OLDER version of this plugin.
 * Every field this file later treats as required is optional here, which is
 * what makes {@link migrateContract} total instead of a pile of non-null
 * assertions at each use site.
 */
type PersistedContract = Omit<
  Contract,
  "task" | "privacyConstraint" | "allowedMethods" | "leakPoints"
> & {
  /** [Issue #659] Absent on Orders written before LEAK and PROVE paid differently. */
  readonly leakPoints?: number;
  readonly task?: OrderTask;
  /** Pre-#645: an Order asked for share indices and nothing else. */
  readonly requestedShareIndices?: readonly number[];
  /** Pre-#650: an Order carried no privacy rule and no method list. */
  readonly privacyConstraint?: PrivacyConstraint;
  readonly allowedMethods?: readonly SubmissionMethod[];
};

function needsMigration(contract: Contract): boolean {
  const persisted: PersistedContract = contract;
  return persisted.task === undefined || persisted.allowedMethods === undefined;
}

/**
 * [Issue #645] Bring one persisted Order up to the current shape.
 *
 * Any version that adds a REQUIRED contract field has to say what an older row
 * means, or the first read of that field throws and takes the whole match with
 * it. Two fields need that answer here:
 *
 *  - `task` (this change). Before it, every Order asked for share indices and
 *    nothing else -- so a legacy row IS a `reveal-share` Order and converts
 *    exactly. Without this, `projectTask` reads `.kind` off `undefined` and
 *    `projectForTeam` throws for EVERY team in the match: `myContracts`
 *    includes completed and expired rows, so a single pre-upgrade Order is
 *    enough, and no later `tick` ever repairs those rows.
 *  - `privacyConstraint` / `allowedMethods` (#650). Older, and the same class
 *    of failure one function earlier -- `validateOrderSubmission` reads
 *    `allowedMethods.includes(...)`. #650 shipped without a fallback; covering
 *    it is two lines inside the function that has to exist anyway, and leaving
 *    a known crash of exactly this shape out of the migration written to
 *    prevent it would be hard to defend.
 *
 * Lossless where it matters: id, points, deadline, status and resolution are
 * carried through untouched, so no score or history moves.
 */
function migrateContract(contract: Contract): Contract {
  if (!needsMigration(contract)) return contract;
  const persisted: PersistedContract = contract;

  const privacyConstraint = persisted.privacyConstraint ?? "none";
  const task: OrderTask = persisted.task ?? {
    kind: "reveal-share",
    shareIndices: persisted.requestedShareIndices ?? [],
  };
  return {
    ...contract,
    task,
    privacyConstraint,
    allowedMethods: persisted.allowedMethods ?? allowedMethodsFor(task.kind, privacyConstraint),
    // [Issue #659] Orders written before LEAK and PROVE paid differently carry
    // no `leakPoints`. Without this backfill, leaking such an Order adds
    // `undefined` to the score and the team's total becomes NaN — a silent,
    // unrecoverable corruption of a live match rather than a visible failure.
    leakPoints: persisted.leakPoints ?? DEFAULT_CONFIG.scores.contractLeak,
  };
}

/**
 * [Issue #659] Bring a persisted CONFIG up to the current shape.
 *
 * `mergeConfig` runs in `initialState` and nowhere else, so a config only ever
 * gets its defaults filled in at the moment a match starts. Every later read
 * comes off the persisted row -- and a coordination row outlives the code that
 * wrote it (that is the whole reason #3126 / #3135 exist), so a match started
 * before this version is read back by a reducer that expects fields its config
 * has never heard of. Both new fields fail silently rather than loudly:
 *
 *  - `contractsPerIssue` undefined makes the batch loop's bound `undefined`, so
 *    it runs zero times: the match stops issuing Orders altogether and simply
 *    winds down, with nothing in the logs to say why.
 *  - `scores.expiredOrder` undefined turns the first expiry into
 *    `score + undefined`, and the team's total is NaN for the rest of the
 *    match -- the same corruption `migrateContract`'s `leakPoints` backfill
 *    exists to prevent, one level up.
 *
 * Re-merging is the whole fix: `mergeConfig` is already the function that says
 * what a missing field means, and it leaves every value the row does carry
 * exactly as it found it.
 */
function needsConfigMigration(config: CryptoBattleConfig): boolean {
  return (
    config.contractsPerIssue === undefined ||
    config.scores?.expiredOrder === undefined ||
    config.scores?.contractLeak === undefined
  );
}

/**
 * Every entry point below reads `state.contracts` and `state.config`, so every
 * entry point migrates both first. `applyOp` and `tick` return the migrated
 * state, so the upgrade also persists on the next write rather than being
 * redone forever.
 */
function withMigratedContracts(state: CryptoBattleState): CryptoBattleState {
  const config = needsConfigMigration(state.config) ? mergeConfig(state.config) : state.config;
  if (!state.contracts.some(needsMigration)) {
    return config === state.config ? state : { ...state, config };
  }
  return { ...state, config, contracts: state.contracts.map(migrateContract) };
}

export function tick(persistedState: CryptoBattleState, eventNowMs: number): CryptoBattleState {
  const state = withMigratedContracts(persistedState);
  const startedAtMs = state.startedAtMs ?? eventNowMs;
  const elapsedMs = eventNowMs - startedAtMs;
  const phase = computePhase(elapsedMs, state.config);
  const matchEndAtMs = startedAtMs + state.config.matchDurationMs;

  // [Issue #659] Letting an Order expire has to be the WORST outcome available —
  // worse than leaking and then being hunted over it. Otherwise ignoring Orders
  // is a safe strategy: nothing is published, so nothing can be hunted, and the
  // opponent-facing half of the game never happens. The penalty is what makes
  // "I cannot compute this in time" a real decision instead of a free pass.
  const newlyExpired: string[] = [];
  const contracts: Contract[] = state.contracts.map((c) => {
    if (c.status !== "open" || c.expiresAtMs > eventNowMs) return c;
    newlyExpired.push(c.teamId);
    return { ...c, status: "expired" as const, expiryCause: "deadline" as const };
  });

  const issuedCountByTeam = new Map<string, number>();
  for (const c of contracts) {
    issuedCountByTeam.set(c.teamId, (issuedCountByTeam.get(c.teamId) ?? 0) + 1);
  }

  const issued: Contract[] = [];
  const fieldConfig = fieldConfigOf(state.config);
  let nextContractAtMs = state.nextContractAtMs ?? startedAtMs;
  while (nextContractAtMs <= eventNowMs && nextContractAtMs < matchEndAtMs) {
    for (const teamId of Object.keys(state.teams)) {
      // [Issue #659] A whole batch lands at once. This is what makes the match
      // a contest rather than a queue: the batch is sized so a fast team clears
      // it and a slow team cannot, and everything downstream -- LEAK being a
      // real cost, HUNT being worth its five minutes, speed converting into
      // attack -- follows from teams differing in how much of the batch they
      // get through. See `contractsPerIssue` in types.ts.
      for (let inBatch = 0; inBatch < state.config.contractsPerIssue; inBatch += 1) {
      const sequenceIndex = issuedCountByTeam.get(teamId) ?? 0;
      const plan = deriveContractPlan(state.seed, teamId, sequenceIndex, fieldConfig);
      const ttlMs = plan.kind === "rush" ? state.config.rushContractTtlMs : state.config.contractTtlMs;
      // [Issue #659] Never issue an Order whose deadline has already passed.
      //
      // `tick` catches up on every batch it missed, which before #659 was
      // harmless -- a stale Order arrived already expired and simply sat there.
      // With an expiry penalty it stops being harmless: a dispatcher that
      // stalls for twenty minutes would, on its next tick, hand every team two
      // dozen Orders they never had a chance to see and then charge them
      // `expiredOrder` for each one. A platform hiccup would decide the match.
      //
      // The slot is CONSUMED either way. Skipping without advancing
      // `sequenceIndex` re-rolls the identical plan on the next iteration, and
      // since the belt is a pure function of the index, it is stale again and
      // skips again -- the batch dies at its first dead slot and, once the
      // index is frozen on one, the belt never issues anything again. A rush
      // slot (2.5 min) going stale would take the five standard slots behind
      // it, which would still have been live, down with it.
      if (nextContractAtMs + ttlMs <= eventNowMs) {
        issuedCountByTeam.set(teamId, sequenceIndex + 1);
        continue;
      }
      const contractId = `${teamId}-c${sequenceIndex}`;
      issued.push({
        id: contractId,
        teamId,
        kind: plan.kind,
        points: plan.kind === "rush" ? state.config.scores.rushContract : state.config.scores.contract,
        // [Issue #659] LEAK pays the same on a rush Order as on a standard one:
        // rush pays more for the SPEED of computing it, and letting the system
        // answer is not faster work, it is no work.
        leakPoints: state.config.scores.contractLeak,
        task: buildOrderTask(plan, state.seed, contractId, fieldConfig.prime),
        issuedAtMs: nextContractAtMs,
        expiresAtMs: nextContractAtMs + ttlMs,
        status: "open",
        // [Issue #645] The Order states its rule, and the method list follows
        // from it and the task -- never the other way round, so a method added
        // in a later phase is offered on exactly the Orders it legitimately
        // satisfies, and never on one it cannot serve at all.
        privacyConstraint: plan.privacyConstraint,
        allowedMethods: allowedMethodsFor(plan.taskKind, plan.privacyConstraint),
      });
      issuedCountByTeam.set(teamId, sequenceIndex + 1);
      }
    }
    nextContractAtMs += state.config.contractIntervalMs;
  }

  // [Issue #659] Charge the expiry penalty to whoever let the Order lapse.
  // Floored at 0 like the HUNT penalty is: a negative running score reads as a
  // bug to a participant, and "you are at zero" already carries the message.
  const teams = applyExpiryPenalties(state.teams, newlyExpired, state.config.scores.expiredOrder);

  return {
    ...state,
    phase,
    nowMs: eventNowMs,
    startedAtMs,
    nextContractAtMs,
    teams,
    contracts: issued.length === 0 ? contracts : [...contracts, ...issued],
  };
}

/**
 * [Issue #659] Deduct one expiry penalty per Order that lapsed this tick.
 *
 * Per Order, not per team: a team that ignored three Orders is three times as
 * far behind as one that ignored a single Order, and flattening that would make
 * "give up on the whole batch" cost the same as "miss one".
 */
function applyExpiryPenalties(
  teams: Readonly<Record<string, TeamState>>,
  expiredTeamIds: readonly string[],
  penalty: number,
): Record<string, TeamState> {
  if (expiredTeamIds.length === 0) return { ...teams };
  const next = { ...teams };
  for (const teamId of expiredTeamIds) {
    const team = next[teamId];
    if (!team) continue;
    next[teamId] = { ...team, score: Math.max(0, team.score + penalty) };
  }
  return next;
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

/**
 * [Issue #645 Phase 2] Parse a participant-submitted ciphertext.
 *
 * Both components go through the same canonical-decimal gate as every other
 * untrusted number on the wire (see schnorr-verifier.ts's
 * `parseCanonicalDecimal`), so a malformed value is a rejection here rather
 * than a throw out of `BigInt()` somewhere downstream.
 */
function parseStoredCiphertext(ciphertext: StoredCiphertext): { r: bigint; y: bigint } | undefined {
  if (typeof ciphertext !== "object" || ciphertext === null) return undefined;
  const r = parseCanonicalDecimal(ciphertext.r);
  const y = parseCanonicalDecimal(ciphertext.y);
  if (r === undefined || y === undefined) return undefined;
  return { r, y };
}

/**
 * [Issue #645 Phase 5] Whether the target actually reused a proof commitment
 * within one generation — the misuse a nonce-reuse HUNT exploits.
 *
 * Reads only the Public Ledger, deliberately: the attacker's evidence has to be
 * derivable from what they can see, and checking the same source the attacker
 * used is what makes that true rather than merely intended. Two transcripts
 * from one team in one generation sharing a commitment R mean two challenges
 * against one nonce, which solves for the witness:
 *
 * ```text
 * z1 = k + e1*w,  z2 = k + e2*w   ->   w = (z1 - z2) / (e1 - e2)   mod q
 * ```
 *
 * The prover this Battle ships cannot produce that (`schnorr-prover.ts` binds
 * the nonce to the contract id), so a team using the provided tooling is never
 * exposed. A team that rolls its own prover with a fixed nonce is — which is
 * precisely the lesson `ac26-w3-nonce-reuse` teaches, now with consequences.
 */
function hasNonceReuse(
  state: CryptoBattleState,
  targetTeamId: string,
  generation: number,
): boolean {
  const commitments = new Set<string>();
  for (const artifact of state.publicLedger) {
    if (artifact.kind !== "proof") continue;
    if (artifact.teamId !== targetTeamId || artifact.generation !== generation) continue;
    if (commitments.has(artifact.commitment)) return true;
    commitments.add(artifact.commitment);
  }
  return false;
}

/**
 * [Issue #645] The Order gate every submission method passes through.
 *
 * Whether a submission is even eligible is a property of the ORDER -- who it
 * was issued to, whether it is still open, and which methods its client
 * accepts. Only what counts as a valid artifact is a property of the METHOD.
 * Splitting them here is what makes a new method (Phase 2's FHE, Phase 3's MPC)
 * an addition rather than an edit: it writes its own trusted check and inherits
 * ownership, the deadline, and the privacy rule unchanged.
 *
 * The `allowedMethods` check is the one genuinely new rule. An Order carrying
 * `no-raw-disclosure` is #645's Level-1 "technique-specified" Order: the client
 * will not accept the underlying value being published, so LEAK is refused --
 * with the constraint named, because a participant who is told only "not
 * allowed" learns nothing they can carry to the next Order.
 */
function validateOrderSubmission(
  state: CryptoBattleState,
  teamId: string,
  contractId: string,
  method: SubmissionMethod,
): ValidateResult {
  const contract = state.contracts.find((c) => c.id === contractId);
  if (!contract) return { ok: false, error: `contract "${contractId}" not found` };
  if (contract.teamId !== teamId) {
    return { ok: false, error: `contract "${contractId}" belongs to another team` };
  }
  if (contract.status !== "open") {
    return { ok: false, error: `contract "${contractId}" is ${contract.status}, not open` };
  }
  // [Issue #645] Two different refusals, and saying which is the point.
  //
  // "This Order does not accept LEAK" is a RULE the client imposed; "LEAK
  // cannot do this job" is a FACT about the tool. methods.ts keeps them apart
  // deliberately and says so in its own comment -- and this function used to
  // collapse both into the privacy message, so submitting FHE to a share Order
  // with constraint "none" was told that FHE "does not satisfy privacy
  // constraint none". FHE satisfies `none` perfectly well. The message taught
  // the opposite of the distinction the Order model exists to teach.
  if (!methodCanPerformTask(method, contract.task.kind)) {
    return {
      ok: false,
      error: `${method.toUpperCase()} cannot perform contract "${contractId}"'s task (${contract.task.kind}); this Order is done with ${contract.allowedMethods.join(", ").toUpperCase()}`,
    };
  }
  if (!contract.allowedMethods.includes(method)) {
    return {
      ok: false,
      error: `contract "${contractId}" has privacy constraint "${contract.privacyConstraint}", which ${method.toUpperCase()} does not satisfy (allowed: ${contract.allowedMethods.join(", ").toUpperCase()})`,
    };
  }
  return { ok: true };
}

export function validateOp(
  persistedState: CryptoBattleState,
  teamId: string,
  op: CryptoBattleOp,
): ValidateResult {
  const state = withMigratedContracts(persistedState);
  const team = state.teams[teamId];
  if (!team) return { ok: false, error: `unknown team "${teamId}"` };

  // No op of any kind is legal once the match clock has run out -- without
  // this, a team could keep LEAKing / HUNTing / ROTATEing past `matchDurationMs`
  // simply because nothing else told the reducer to stop accepting ops.
  if (state.phase === "ended") {
    return { ok: false, error: "match has ended" };
  }

  switch (op.kind) {
    case "leak":
      // [Issue #645] LEAK's trusted check is exactly the Order gate: the team
      // owns the Order, it is still open, and it permits publishing the raw
      // share. There is no artifact to verify -- the reducer reads the share
      // from the team's own vault in applyLeak, so a participant cannot submit
      // a value at all, let alone a wrong one.
      return validateOrderSubmission(state, teamId, op.contractId, "leak");
    case "hunt": {
      // Same gap "rotate" below already had fixed (Issue #486 PR1 review):
      // before the first tick(), state.nowMs is undefined. Unlike rotate's
      // cooldown check, nothing else in this branch reads state.nowMs at
      // all -- a hunt op supplying the target's ACTUAL secret directly
      // (rather than reconstructing it via Lagrange interpolation from
      // leaked shares, which requires a Contract, which requires a tick())
      // would otherwise validate and apply before the match clock has ever
      // started, leaving applyHunt's huntLog entry with no real elapsed-time
      // meaning to timestamp (see applyHunt's own comment on why it now
      // throws instead of silently recording `atMs: 0` for that case).
      // Rejecting here is what makes that throw structurally unreachable
      // through the validateOp -> applyOp path, the same contract every
      // other applyX function's "invalid op reached apply" throw relies on.
      if (state.nowMs === undefined) {
        return { ok: false, error: "match has not started yet (no tick() has run)" };
      }
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
    case "fhe": {
      // [Issue #645 Phase 2] Order gate first, then the trusted decrypt.
      const gate = validateOrderSubmission(state, teamId, op.contractId, "fhe");
      if (!gate.ok) return gate;
      const contract = state.contracts.find((c) => c.id === op.contractId);
      if (contract?.task.kind !== "homomorphic-sum") {
        // validateOrderSubmission already refused every Order whose
        // allowedMethods exclude FHE, and only a homomorphic-sum task ever
        // allows it -- so this is unreachable and says so loudly rather than
        // treating a mismatched task as a pass.
        return { ok: false, error: `contract "${op.contractId}" is not a homomorphic-sum order` };
      }
      const submitted = parseStoredCiphertext(op.ciphertext);
      if (!submitted) {
        return {
          ok: false,
          error: "ciphertext components must be canonical, length-bounded decimal integers",
        };
      }
      // Both components must already be field elements. `parseCanonicalDecimal`
      // only bounds the digit count, and the two comparisons below both reduce
      // mod p -- so before this check `(r + p, y + p)` was accepted, which let
      // a participant skip the 「p で割った余り」 step the Order asks for and
      // still score, and put a value on the Public Ledger that is not a field
      // element at all. Leading zeros remain fine: `007` is 7, and 7 is in
      // range.
      if (submitted.r >= BigInt(state.config.prime) || submitted.y >= BigInt(state.config.prime)) {
        return {
          ok: false,
          error: "ciphertext components must already be reduced -- take the remainder after dividing by the modulus",
        };
      }
      const prime = BigInt(state.config.prime);
      // BOTH components are checked, and the comment that used to stand here --
      // "a participant who reaches the right plaintext by a different
      // homomorphic route has genuinely done the job" -- was wrong about its
      // own premise. `decryptOrderSum` subtracts this Order's FIXED mask, so
      // exactly one `y` is ever accepted; there is no second route to a
      // different valid `y`. That left `r` as the only free component, and an
      // unchecked `r` accepted `(0, y1 + y2)`: half of the componentwise
      // addition the Order asks for, recorded on the Public Ledger as a
      // ciphertext that is NOT the sum of the two public pairs. Requiring the
      // real `r` therefore rejects no legitimate route, because none exists.
      const expectedR = contract.task.inputs.reduce(
        (acc, input) => mod(acc + BigInt(input.r), prime),
        0n,
      );
      if (mod(submitted.r, prime) !== expectedR) {
        return {
          ok: false,
          error: "submitted ciphertext's first component is not the sum of the Order's first components",
        };
      }
      if (
        decryptOrderSum(submitted, state.seed, op.contractId, prime) !==
        expectedFheSum(state.seed, op.contractId, prime)
      ) {
        return { ok: false, error: "submitted ciphertext does not decrypt to the requested sum" };
      }
      return { ok: true };
    }
    case "mpc": {
      // [Issue #645 Phase 3] Order gate, then compare against the partial this
      // team's own inputs and masks produce. The expected value is re-derived
      // from the seed, never stored, and never handed to another team.
      const gate = validateOrderSubmission(state, teamId, op.contractId, "mpc");
      if (!gate.ok) return gate;
      const contract = state.contracts.find((c) => c.id === op.contractId);
      if (contract?.task.kind !== "masked-total") {
        return { ok: false, error: `contract "${op.contractId}" is not a masked-total order` };
      }
      const submittedPartial = parseCanonicalDecimal(op.partial);
      if (submittedPartial === undefined) {
        return { ok: false, error: "partial must be a canonical, length-bounded decimal integer" };
      }
      // Same hole as the FHE branch above, and fixed with it: the comparison
      // below reduces mod p, so an unreduced partial scored while skipping the
      // remainder step -- and here it was worse, because `applyMpc` puts the
      // submitted value into the published `a + b + c` sum, so one unreduced
      // partial makes the ledger's own arithmetic unreproducible.
      if (submittedPartial >= BigInt(state.config.prime)) {
        return {
          ok: false,
          error: "partial must already be reduced -- take the remainder after dividing by the modulus",
        };
      }
      const prime = BigInt(state.config.prime);
      if (mod(submittedPartial, prime) !== expectedMpcPartial(state.seed, op.contractId, prime)) {
        return { ok: false, error: "submitted partial does not match this office's masked total" };
      }
      return { ok: true };
    }
    case "hunt-nonce": {
      // [Issue #645 Phase 5] Same preconditions as a Shamir HUNT -- see that
      // branch for why each exists -- and a different piece of evidence.
      if (state.nowMs === undefined) {
        return { ok: false, error: "match has not started yet (no tick() has run)" };
      }
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
      // The exploit has to be real, not merely claimed: the target must
      // actually have published two transcripts sharing a commitment. Without
      // this check a lucky guess at the witness would pass, and -- far worse --
      // a team that used the shipped prover correctly could be hunted by
      // someone who obtained their witness any other way. #645's rule is that
      // HUNT punishes misuse, so the misuse has to be on the record.
      if (!hasNonceReuse(state, op.targetTeamId, op.generation)) {
        return {
          ok: false,
          error: `team "${op.targetTeamId}" has not reused a proof commitment in generation ${op.generation}`,
        };
      }
      const recoveredWitness = parseCanonicalDecimal(op.recoveredWitness);
      if (recoveredWitness === undefined) {
        return {
          ok: false,
          error: "recoveredWitness must be a canonical, length-bounded decimal integer",
        };
      }
      const publicY = state.publicCommitments[op.targetTeamId];
      if (publicY === undefined) {
        return { ok: false, error: `no public commitment on record for team "${op.targetTeamId}"` };
      }
      // The witness is checked against the target's PUBLIC commitment, which is
      // the honest statement of "you recovered their key": g^w = Y is exactly
      // what the witness is defined by. Nothing here reads the target's private
      // state, so the check cannot accidentally accept a value the attacker
      // could not have derived from public material.
      if (
        groupPow(RFC3526_GROUP14.generator, mod(recoveredWitness, RFC3526_GROUP14.order), RFC3526_GROUP14) !==
        BigInt(publicY)
      ) {
        return { ok: false, error: "recovered witness does not match the target's public commitment" };
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
      // [Issue #645] Same Order gate as every other method -- PROVE is a second
      // way to fulfil an Order, not a different queue of things to fulfil --
      // followed by PROVE's own trusted check. The gate runs FIRST: an Order
      // that is expired or belongs to another team must be rejected as such,
      // not after spending a 2048-bit verification on it.
      const gate = validateOrderSubmission(state, teamId, op.contractId, "prove");
      if (!gate.ok) return gate;
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

  if (contract.task.kind !== "reveal-share") {
    throw new Error("applyOp(leak): contract is not a reveal-share order -- call validateOp() first");
  }
  const nowMs = state.nowMs ?? contract.issuedAtMs;
  const artifacts: PublicArtifact[] = contract.task.shareIndices.map((shareIndex: number) => {
    const shareEntry = team.shares.find((s) => s.index === shareIndex);
    if (!shareEntry) {
      throw new Error(`applyOp(leak): team "${teamId}" has no share at index ${shareIndex}`);
    }
    return {
      id: `${contract.id}-share${shareIndex}`,
      teamId,
      generation: team.generation,
      kind: "share",
      method: "leak",
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
    // [Issue #659] The leak rate, not the full rate. Paying the same for both
    // made LEAK strictly dominant — no computation, identical payout.
    score: team.score + contract.leakPoints,
    completedContractIds: [...team.completedContractIds, contract.id],
  };

  return {
    ...state,
    contracts,
    publicLedger: [...state.publicLedger, ...artifacts],
    teams: { ...state.teams, [teamId]: updatedTeam },
  };
}

/**
 * [Issue #645 Phase 2] Record an accepted FHE submission.
 *
 * The ciphertext goes on the Public Ledger verbatim. That is safe and it is the
 * lesson: everyone can see that this team answered, and nobody — including the
 * teams who can read the Order's input ciphertexts — learns anything about the
 * numbers involved. See fhe.ts on why that is information-theoretic.
 */
function applyFhe(
  state: CryptoBattleState,
  teamId: string,
  op: Extract<CryptoBattleOp, { kind: "fhe" }>,
): CryptoBattleState {
  const contract = state.contracts.find((c) => c.id === op.contractId);
  const team = state.teams[teamId];
  if (!contract || !team) {
    throw new Error("applyOp(fhe): invalid op reached apply -- call validateOp() first");
  }

  const nowMs = state.nowMs ?? contract.issuedAtMs;
  // Re-serialized through BigInt(...).toString() for the same reason applyProve
  // does it: validateOp has already forced both components through
  // parseCanonicalDecimal, so this guarantees the ledger only ever holds the
  // canonical form rather than whatever the submission happened to carry.
  const artifact: CiphertextArtifact = {
    id: `${contract.id}-ciphertext`,
    teamId,
    generation: team.generation,
    kind: "ciphertext",
    method: "fhe",
    contractId: contract.id,
    r: BigInt(op.ciphertext.r).toString(),
    y: BigInt(op.ciphertext.y).toString(),
    postedAtMs: nowMs,
  };

  return completeOrder(state, teamId, contract, artifact, "fhe");
}

/**
 * [Issue #645 Phase 3] Record an accepted MPC submission.
 *
 * The masked partial goes on the Public Ledger, and the team's own number never
 * does. Publishing the partial is what lets the client add the three offices'
 * partials and learn the total — the point of the protocol — while every
 * individual figure stays hidden. See mpc.ts.
 */
function applyMpc(
  state: CryptoBattleState,
  teamId: string,
  op: Extract<CryptoBattleOp, { kind: "mpc" }>,
): CryptoBattleState {
  const contract = state.contracts.find((c) => c.id === op.contractId);
  const team = state.teams[teamId];
  if (!contract || !team) {
    throw new Error("applyOp(mpc): invalid op reached apply -- call validateOp() first");
  }

  const nowMs = state.nowMs ?? contract.issuedAtMs;
  const prime = BigInt(state.config.prime);
  // [Issue #645 Phase 3] Finish the protocol, not just this office's step.
  //
  // The other two offices publish their partials the moment this one does --
  // that is what the client is waiting for, and the masks only cancel across
  // all three. Recording just this team's partial left the Order's own story
  // unfinished: the participant did the arithmetic, scored, and the result the
  // whole exercise exists to demonstrate never appeared anywhere.
  //
  // The peers are derived, not stored, for the same reason everything else
  // here is: `state` never holds a value a projection would have to remember
  // to redact.
  const peers = allPartials(state.seed, contract.id, prime).filter(
    (_partial, index) => index !== MPC_TEAM_PARTY_INDEX,
  );
  const artifact: PartialArtifact = {
    id: `${contract.id}-partial`,
    teamId,
    generation: team.generation,
    kind: "partial",
    method: "mpc",
    contractId: contract.id,
    partial: BigInt(op.partial).toString(),
    peerPartials: peers.map((partial) => partial.toString()),
    // Summed from the published partials rather than read from
    // `expectedMpcTotal`, so the ledger shows a number the participant can
    // reproduce by adding the three rows in front of them -- which is the
    // lesson. The two agree; `mpc.test.ts` asserts it.
    total: sumInField([BigInt(op.partial), ...peers], prime).toString(),
    postedAtMs: nowMs,
  };

  return completeOrder(state, teamId, contract, artifact, "mpc");
}

/**
 * [Issue #645] Close one Order: post its artifact, mark it completed with the
 * method that did it, and award its points.
 *
 * Shared by the methods added after Phase 1. LEAK and PROVE keep their own
 * inline versions because each does something extra (LEAK posts one artifact
 * per requested share index; PROVE has a longer note about what its transcript
 * may contain), and folding those into a common helper would hide the part of
 * each that is worth reading. What matters is that the SCORING is one
 * expression, not four: every method earns the Order's stated points, never a
 * bonus for the technique used — #486's rule, unchanged.
 */
function completeOrder(
  state: CryptoBattleState,
  teamId: string,
  contract: Contract,
  artifact: PublicArtifact,
  method: SubmissionMethod,
): CryptoBattleState {
  const team = state.teams[teamId];
  if (!team) {
    throw new Error("completeOrder: unknown team -- call validateOp() first");
  }
  const contracts = state.contracts.map((c) =>
    c.id === contract.id ? { ...c, status: "completed" as const, resolution: method } : c,
  );
  return {
    ...state,
    contracts,
    publicLedger: [...state.publicLedger, artifact],
    teams: {
      ...state.teams,
      [teamId]: {
        ...team,
        score: team.score + contract.points,
        completedContractIds: [...team.completedContractIds, contract.id],
      },
    },
  };
}

/**
 * [Issue #645] The task as its owner sees it.
 *
 * `reveal-share` and `homomorphic-sum` pass straight through — their payloads
 * are public. `masked-total` gains the confidential inputs, derived here from
 * the match seed rather than stored, so the only copy that ever exists is the
 * one handed to the team the Order belongs to. `projectForTeam` calls this only
 * for `myContracts`, which is already filtered to that team.
 */
function projectTask(
  state: CryptoBattleState,
  task: OrderTask,
  contractId: string,
): OrderTaskProjection {
  switch (task.kind) {
    case "reveal-share":
      return task;
    case "homomorphic-sum":
      return task;
    case "masked-total": {
      const inputs = deriveMpcPrivateInputs(state.seed, contractId, BigInt(state.config.prime));
      return {
        kind: "masked-total",
        partyCount: task.partyCount,
        myInput: inputs.myInput.toString(),
        incomingMasks: inputs.incomingMasks.map((m) => m.toString()),
        outgoingMasks: inputs.outgoingMasks.map((m) => m.toString()),
      };
    }
    default: {
      const exhaustive: never = task;
      throw new Error(`projectTask: unknown task ${JSON.stringify(exhaustive)}`);
    }
  }
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
  // validateOp's "hunt" branch (above) now rejects before the first tick(),
  // so `state.nowMs` is always defined here for any op that reached this
  // point through the intended validateOp -> applyOp path -- throw loudly
  // (matching the "invalid op reached apply" throw above and every other
  // applyX function's identical pattern) rather than silently recording an
  // untimestamped `huntLog` entry with `atMs: 0`, which would misrepresent
  // when the hunt happened instead of admitting the caller skipped
  // validateOp.
  if (state.nowMs === undefined) {
    throw new Error("applyOp(hunt): invalid op reached apply -- call validateOp() first (match has not started)");
  }
  const nowMs = state.nowMs;

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
      { attackerTeamId: teamId, targetTeamId: op.targetTeamId, generation: op.generation, atMs: nowMs },
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
  //
  // [Issue #659] Voiding has to cost what letting the batch lapse costs, and
  // #659 does not say so -- it settles the ordering
  // `失効 -15 < LEAK して狩られる -2 < LEAK 無事 +10 < PROVE +30` while assuming
  // PROVE, LEAK and expiry are the only three ways an Order can end. ROTATE is
  // a fourth, and unpriced it dominates all of them: `rotateCooldownMs` (3 min)
  // is shorter than `contractIntervalMs` (5 min), so a team could rotate once
  // per batch, void every Order it had not finished for nothing, publish
  // nothing, and additionally retire whatever it had already leaked. A team
  // that cleared 2 of 6 would choose 0 over LEAK's +40 or expiry's -60 every
  // time, and the opponent-facing half of the game would stop happening --
  // exactly the dead end the #659 simulation found and fixed elsewhere.
  //
  // So the rule is one line and holds whatever ends the Order: an Order that is
  // neither PROVEd nor LEAKed costs `scores.expiredOrder`, exactly once. That
  // keeps ROTATE honest without making it useless -- rotating costs nothing
  // extra when the batch was about to lapse anyway, so WHEN to rotate becomes
  // the decision, rather than whether to rotate instead of playing.
  const voided: string[] = [];
  const contracts = state.contracts.map((c) => {
    if (c.teamId !== teamId || c.status !== "open") return c;
    voided.push(c.teamId);
    return { ...c, status: "expired" as const, expiryCause: "rotate" as const };
  });
  // The Schnorr public commitment is generation-scoped (see
  // schnorr-witness.ts's derivePublicCommitment): rederiving it here is what
  // makes a pre-rotate PROVE proof fail verification post-rotate, the same
  // way rotate already invalidates pre-rotate LEAK shares for HUNT above.
  const publicCommitments = {
    ...state.publicCommitments,
    [teamId]: derivePublicCommitment(secret, generation, teamId, RFC3526_GROUP14).toString(),
  };
  // Charged through the same helper the deadline path uses, so the two causes
  // cannot drift apart into different prices for the same unanswered Order.
  const teams = applyExpiryPenalties(
    { ...state.teams, [teamId]: updatedTeam },
    voided,
    state.config.scores.expiredOrder,
  );
  return { ...state, contracts, teams, publicCommitments };
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
    method: "prove",
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
export function applyOp(
  persistedState: CryptoBattleState,
  teamId: string,
  op: CryptoBattleOp,
): CryptoBattleState {
  const state = withMigratedContracts(persistedState);
  switch (op.kind) {
    case "leak":
      return applyLeak(state, teamId, op);
    case "fhe":
      return applyFhe(state, teamId, op);
    case "mpc":
      return applyMpc(state, teamId, op);
    case "hunt":
      return applyHunt(state, teamId, op);
    case "hunt-nonce":
      // [Issue #645 Phase 5] Both hunt kinds score identically, guard against
      // replay identically, and land in the same `huntLog` -- only the evidence
      // differs, and `validateOp` has already checked the evidence this one
      // needs (g^w = Y against the target's PUBLIC commitment). Reusing
      // `applyHunt` keeps one scoring path rather than a near-duplicate that
      // could drift; `applyHunt` re-reads the target's secret itself, so the
      // value passed here is only the shape it expects.
      return applyHunt(state, teamId, {
        kind: "hunt",
        targetTeamId: op.targetTeamId,
        generation: op.generation,
        recoveredSecret: state.teams[op.targetTeamId]?.secret ?? "0",
      });
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
export function projectForTeam(
  persistedState: CryptoBattleState,
  teamId: string,
): CryptoBattleProjection {
  const state = withMigratedContracts(persistedState);
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
      leakPoints: c.leakPoints,
      task: projectTask(state, c.task, c.id),
      status: c.status,
      // [Issue #645] The Order's rule and the methods that satisfy it are
      // participant-visible by design: an Order the participant cannot LEAK
      // must say so BEFORE they choose, not by rejecting their submission.
      // Both are public properties of the job, not of anyone's secret.
      privacyConstraint: c.privacyConstraint,
      allowedMethods: c.allowedMethods,
      // `state.nowMs` is only ever undefined before the first `tick()`, and
      // `state.contracts` is only ever non-empty AFTER at least one `tick()`
      // (`initialState` sets `contracts: []`; only `tick()` ever pushes to
      // it) -- so the `?? c.expiresAtMs` fallback (remainingMs 0) is
      // unreachable in practice. It exists only to keep this arithmetic
      // total without an unsafe assertion.
      remainingMs: Math.max(0, c.expiresAtMs - (state.nowMs ?? c.expiresAtMs)),
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

  const matchRemainingMs =
    state.startedAtMs === undefined || state.nowMs === undefined
      ? undefined
      : Math.max(0, state.startedAtMs + state.config.matchDurationMs - state.nowMs);

  return {
    phase: state.phase,
    prime: state.config.prime,
    matchRemainingMs,
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
