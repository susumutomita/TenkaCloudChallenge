/**
 * Deterministic scripted-playtest runner (Issue #486 PR5).
 *
 * A `PlaytestScript` is a plain-data fixture -- a fully pre-authored, ordered
 * list of `tick` / op `Step`s for a fixed `eventId`, team roster and optional
 * TEST match secret, plus an optional scaled-down `config` (e.g. a 20-30 min
 * vertical slice instead of the full 90-min match). `runScript` replays it against a fresh
 * `initialState`, exactly the way `reducer.ts`'s own purity contract
 * guarantees: no ambient time/randomness anywhere under `src/` (see
 * reducer.ts's header), so the same script always produces the same
 * `PlaytestResult`, byte-for-byte. That is what makes a `PlaytestScript`
 * useful as a debrief/replay artifact (Issue #486's "120分 debrief /
 * Replay" section) and not just a one-off test harness: it is data that can
 * be re-run, diffed against a prior run, or handed to `replay.ts` to build a
 * human-readable timeline.
 *
 * This module also exports the op-construction helpers a script author (or,
 * in production, a participant's own tooling) uses to build ops in the
 * FIRST place: `buildLeakOp` / `buildRotateOp` are trivial, but
 * `buildProveOp` and `buildHuntOp` matter -- they build a move from exactly
 * the information a participant is allowed to see (`projectForTeam`'s
 * output, i.e. a `CryptoBattleProjection`, plus -- for `buildHuntOp` --
 * public game-rule constants), never from `CryptoBattleState` directly.
 * `buildHuntOp` in particular can never read `state.teams[targetTeamId].secret`
 * even by accident, because it is never handed anything that has it -- see
 * that function's own doc comment.
 */

import { applyOp, initialState, tick, validateOp } from "./reducer.ts";
import { createProof } from "./schnorr-prover.ts";
import { reconstruct, type Share } from "./shamir.ts";
import { addCiphertexts } from "./fhe.ts";
import { inv, mod } from "./field.ts";
import { groupPow, RFC3526_GROUP14 } from "./group.ts";
import { computeChallenge } from "./schnorr-transcript.ts";
import { computePartial } from "./mpc.ts";
import type {
  ContractProjection,
  ProofArtifact,
  CryptoBattleConfig,
  CryptoBattleOp,
  CryptoBattleProjection,
  CryptoBattleState,
  Phase,
  ValidateResult,
  VaultProjection,
} from "./types.ts";

/** One `tick(state, atMs)` call. */
export interface PlaytestTickStep {
  readonly atMs: number;
  readonly kind: "tick";
}

/**
 * One `validateOp` + (if accepted) `applyOp` call for `teamId`. `expect` is
 * optional documentation of what the script author believes will happen;
 * `runScript` never trusts it blindly -- a mismatch is recorded in
 * `PlaytestResult.violations`, not thrown (see `runScript`'s doc comment).
 */
export interface PlaytestOpStep {
  readonly atMs: number;
  readonly teamId: string;
  readonly op: CryptoBattleOp;
  readonly expect?: "ok" | "rejected";
}

export type PlaytestStep = PlaytestTickStep | PlaytestOpStep;

/** Type-narrowing predicate: exported so script authors/consumers (e.g. vertical-playtest-fixture.ts, its tests, replay.test.ts) can filter a `PlaytestStep[]` without redefining this in every call site. */
export function isTickStep(step: PlaytestStep): step is PlaytestTickStep {
  return "kind" in step && step.kind === "tick";
}

export interface PlaytestScript {
  readonly eventId: string;
  readonly teams: readonly [string, string];
  /**
   * The fixed, non-production secret used when the script was authored.
   *
   * #652 moved every hidden derivation off the public `eventId`. Replaying a
   * script without the same derivation root is replaying a different match:
   * the Order belt, proofs, FHE/MPC answers and HUNT value all stop matching.
   * Omit only for legacy/local fixtures that intentionally exercise the
   * self-announcing non-secret fallback. Never copy a live match secret into a
   * script or debrief artifact.
   */
  readonly matchSecret?: string;
  readonly steps: readonly PlaytestStep[];
  /**
   * Optional config override, merged onto `DEFAULT_CONFIG` the same way
   * `initialState(ctx, config)` already does. Issue #486 PR5's own sketch of
   * `PlaytestScript` (`{ eventId, teams, steps }`) has no config field, but a
   * 20-30 min vertical slice needs a scaled-down `matchDurationMs` /
   * `phaseBoundaries` / `contractIntervalMs` -- `initialState` already
   * accepts exactly this shape of override, and a scripted fixture has
   * nowhere else to carry one, so this is a minimal, natural extension of
   * that sketch rather than a second, competing mechanism.
   */
  readonly config?: Partial<CryptoBattleConfig>;
}

/**
 * One step's outcome, recorded for `PlaytestResult.timeline`. Deliberately
 * carries only what `projectForTeam` itself would consider safe to publish
 * (score / generation / ledger length / phase) -- never a team's secret or
 * shares -- so a `PlaytestResult` is itself safe to hand to `replay.ts` for
 * a post-match debrief without an extra redaction pass.
 */
export interface PlaytestTimelineEntry {
  readonly stepIndex: number;
  readonly atMs: number;
  readonly kind: "tick" | "op";
  readonly teamId?: string;
  readonly opKind?: CryptoBattleOp["kind"];
  readonly validation?: ValidateResult;
  readonly applied: boolean;
  readonly phase: Phase;
  readonly scores: Readonly<Record<string, number>>;
  readonly generations: Readonly<Record<string, number>>;
  readonly ledgerLength: number;
}

/** A step whose actual `validateOp` outcome did not match its declared `expect`. */
export interface PlaytestViolation {
  readonly stepIndex: number;
  readonly atMs: number;
  readonly teamId: string;
  readonly opKind: CryptoBattleOp["kind"];
  readonly expected: "ok" | "rejected";
  readonly actual: "ok" | "rejected";
  readonly detail: string;
}

export interface PlaytestResult {
  readonly finalState: CryptoBattleState;
  readonly timeline: readonly PlaytestTimelineEntry[];
  readonly violations: readonly PlaytestViolation[];
}

function summarizeStep(
  state: CryptoBattleState,
  stepIndex: number,
  atMs: number,
  kind: "tick" | "op",
  extra?: {
    readonly teamId?: string;
    readonly opKind?: CryptoBattleOp["kind"];
    readonly validation?: ValidateResult;
    readonly applied?: boolean;
  },
): PlaytestTimelineEntry {
  const scores: Record<string, number> = {};
  const generations: Record<string, number> = {};
  for (const team of Object.values(state.teams)) {
    scores[team.teamId] = team.score;
    generations[team.teamId] = team.generation;
  }
  return {
    stepIndex,
    atMs,
    kind,
    teamId: extra?.teamId,
    opKind: extra?.opKind,
    validation: extra?.validation,
    applied: extra?.applied ?? false,
    phase: state.phase,
    scores,
    generations,
    ledgerLength: state.publicLedger.length,
  };
}

/**
 * Replay a fully pre-authored `PlaytestScript` against a fresh
 * `initialState`, step by step in the given order. Pure, in the same sense
 * `applyOp` / `tick` are pure (see reducer.ts's header): no ambient
 * time/randomness, so two calls with an identical script produce
 * deeply-equal results every time.
 *
 * A step whose declared `expect` does not match `validateOp`'s actual
 * verdict is recorded in the returned `violations`, never thrown -- a
 * scripted fixture's job is to document what the reducer actually does,
 * including the case where a fixture has drifted out of sync with a reducer
 * change (a regression signal a caller should assert against, e.g.
 * `expect(result.violations).toEqual([])`), not to crash the process that
 * is trying to observe that drift.
 */
export function runScript(script: PlaytestScript): PlaytestResult {
  let state = initialState(
    {
      eventId: script.eventId,
      teamIds: script.teams,
      ...(script.matchSecret ? { matchSecret: script.matchSecret } : {}),
    },
    script.config,
  );
  const timeline: PlaytestTimelineEntry[] = [];
  const violations: PlaytestViolation[] = [];

  script.steps.forEach((step, stepIndex) => {
    if (isTickStep(step)) {
      state = tick(state, step.atMs);
      timeline.push(summarizeStep(state, stepIndex, step.atMs, "tick"));
      return;
    }

    const verdict = validateOp(state, step.teamId, step.op);
    const actual: "ok" | "rejected" = verdict.ok ? "ok" : "rejected";
    if (step.expect !== undefined && step.expect !== actual) {
      violations.push({
        stepIndex,
        atMs: step.atMs,
        teamId: step.teamId,
        opKind: step.op.kind,
        expected: step.expect,
        actual,
        detail: verdict.ok ? "op was accepted" : verdict.error,
      });
    }
    if (verdict.ok) {
      state = applyOp(state, step.teamId, step.op);
    }
    timeline.push(
      summarizeStep(state, stepIndex, step.atMs, "op", {
        teamId: step.teamId,
        opKind: step.op.kind,
        validation: verdict,
        applied: verdict.ok,
      }),
    );
  });

  return { finalState: state, timeline, violations };
}

// ---------------------------------------------------------------------------
// Op construction helpers -- these build a `CryptoBattleOp` the way a
// participant's own tooling actually would (see this module's header).
// ---------------------------------------------------------------------------

/** Trivial, but included for a uniform "one builder per op kind" surface. */
export function buildLeakOp(contractId: string): CryptoBattleOp {
  return { kind: "leak", contractId };
}

/** Trivial, same reason as `buildLeakOp`. */
export function buildRotateOp(): CryptoBattleOp {
  return { kind: "rotate" };
}

/**
 * Build a PROVE op from a team's own vault -- exactly what a participant's
 * own script would call: `schnorr-prover.ts`'s `createProof` against
 * `projectForTeam(state, teamId).vault.secret`, the secret a participant
 * already legitimately sees for their own team every match (see
 * schnorr-prover.ts's header). Takes a `VaultProjection`, not a
 * `CryptoBattleState` or `TeamState` -- there is nothing about another
 * team reachable from this function's input at all.
 */
export function buildProveOp(vault: VaultProjection, contractId: string): CryptoBattleOp {
  const proof = createProof(BigInt(vault.secret), vault.generation, vault.teamId, contractId);
  return { kind: "prove", contractId, proof };
}

/**
 * [Issue #645 Phase 2] Build an FHE op from an Order's own projection.
 *
 * Every input comes from `ContractProjection.task` — the ciphertexts the Order
 * published — and the operation is `fhe.ts`'s `addCiphertexts`, the same
 * function a participant's script would call. Nothing here reads a plaintext or
 * a key, and there is nowhere it could: the projection does not carry them.
 * That is the property this builder exists to demonstrate, the same way
 * `buildHuntOp` demonstrates that a HUNT is derivable from public material.
 */
export function buildFheOp(
  contract: ContractProjection,
  prime: string,
): CryptoBattleOp | undefined {
  if (contract.task.kind !== "homomorphic-sum") return undefined;
  const p = BigInt(prime);
  const inputs = contract.task.inputs.map((c) => ({ r: BigInt(c.r), y: BigInt(c.y) }));
  const first = inputs[0];
  if (!first) return undefined;
  const sum = inputs.slice(1).reduce((acc, c) => addCiphertexts(acc, c, p), first);
  return {
    kind: "fhe",
    contractId: contract.id,
    ciphertext: { r: sum.r.toString(), y: sum.y.toString() },
  };
}

/**
 * [Issue #645 Phase 3] Build an MPC op from an Order's own projection.
 *
 * The team's confidential number and its masks arrive on the projection because
 * the Order belongs to this team; the arithmetic is `mpc.ts`'s `computePartial`,
 * again the same function a participant would write. The submitted value is the
 * masked partial — never the input, which is the whole point.
 */
export function buildMpcOp(
  contract: ContractProjection,
  prime: string,
): CryptoBattleOp | undefined {
  if (contract.task.kind !== "masked-total") return undefined;
  const p = BigInt(prime);
  const partial = computePartial(
    {
      myInput: BigInt(contract.task.myInput),
      incomingMasks: contract.task.incomingMasks.map((m) => BigInt(m)),
      outgoingMasks: contract.task.outgoingMasks.map((m) => BigInt(m)),
    },
    p,
  );
  return { kind: "mpc", contractId: contract.id, partial: partial.toString() };
}

/**
 * [Issue #645 Phase 5] Recover a Schnorr witness from two transcripts that
 * share a commitment, and build the HUNT that spends it.
 *
 * Reads the PUBLIC LEDGER only — the same material any participant can see —
 * which is the property that makes this a legitimate attack rather than a
 * privileged shortcut, exactly as `buildHuntOp` does for the Shamir route.
 *
 * Two proofs from one team in one generation with the same commitment R mean
 * one nonce k answered two different challenges:
 *
 * ```text
 * z1 = k + e1*w    z2 = k + e2*w        (mod q)
 * z1 - z2 = (e1 - e2) * w
 * w = (z1 - z2) * (e1 - e2)^-1          (mod q)
 * ```
 *
 * Returns `undefined` when the target never reused a commitment — which is the
 * normal case, because `schnorr-prover.ts` binds the nonce to the contract id.
 * This attack exists for the team that rolled their own prover and got that
 * wrong.
 */
export function buildNonceReuseHuntOp(
  projection: CryptoBattleProjection,
  targetTeamId: string,
): CryptoBattleOp | undefined {
  const target = projection.teams[targetTeamId];
  const publicY = projection.publicCommitments[targetTeamId];
  if (!target || publicY === undefined) return undefined;

  const byCommitment = new Map<string, ProofArtifact[]>();
  for (const artifact of projection.publicLedger) {
    if (artifact.kind !== "proof") continue;
    if (artifact.teamId !== targetTeamId || artifact.generation !== target.generation) continue;
    const bucket = byCommitment.get(artifact.commitment) ?? [];
    bucket.push(artifact);
    byCommitment.set(artifact.commitment, bucket);
  }

  const group = RFC3526_GROUP14;
  for (const [commitment, artifacts] of byCommitment) {
    const [first, second] = artifacts;
    if (!first || !second) continue;

    const e1 = computeChallenge(
      {
        teamId: targetTeamId,
        contractId: first.contractId,
        generation: first.generation,
        commitmentR: BigInt(commitment),
        publicY: BigInt(publicY),
      },
      group,
    );
    const e2 = computeChallenge(
      {
        teamId: targetTeamId,
        contractId: second.contractId,
        generation: second.generation,
        commitmentR: BigInt(commitment),
        publicY: BigInt(publicY),
      },
      group,
    );
    const challengeGap = mod(e1 - e2, group.order);
    if (challengeGap === 0n) continue;
    const witness = mod(
      mod(BigInt(first.response) - BigInt(second.response), group.order) * inv(challengeGap, group.order),
      group.order,
    );
    // Only offer the op if the recovered value really is the witness. A
    // participant would check this before spending their attempt, and so does
    // the trusted side.
    if (groupPow(group.generator, witness, group) !== BigInt(publicY)) continue;
    return {
      kind: "hunt-nonce",
      targetTeamId,
      generation: target.generation,
      recoveredWitness: witness.toString(),
    };
  }
  return undefined;
}

/** Public game-rule constants a HUNT needs but `CryptoBattleProjection` deliberately omits -- see `buildHuntOp`'s doc comment. */
export interface PublicHuntParams {
  readonly prime: string;
  readonly threshold: number;
}

/**
 * Build a HUNT op the way an attacking participant actually would: collect
 * `params.threshold` distinct-index shares for `targetTeamId`'s CURRENT
 * generation out of `projection.publicLedger` (public by construction --
 * every entry there got there via some team's own LEAK, see types.ts's
 * `ShareArtifact` doc comment) and Lagrange-interpolate them via
 * `shamir.ts`'s `reconstruct` -- the reference tool README.md points
 * participants at for exactly this move.
 *
 * Deliberately takes a `CryptoBattleProjection` (what `projectForTeam` --
 * the only sanctioned participant read path, see reducer.ts's doc comment
 * on it -- hands back), never a `CryptoBattleState`: this function
 * structurally cannot reach `state.teams[targetTeamId].secret`, because it
 * is never given anything that has it. That is this playtest module's
 * concrete e2e claim for the vertical-playtest fixture (`vertical-playtest.test.ts`):
 * the attacking team's HUNT op is built from public information only.
 *
 * `params` (prime + threshold) are NOT sourced from `projection` --
 * `CryptoBattleProjection` deliberately omits `config` / `config.threshold`
 * (see reducer.ts's `projectForTeam` doc comment and OPERATOR.md's "Portal
 * UI wiring" section on why the UI never computes "you can hunt now" for a
 * participant). They are public game-rule constants a participant already
 * knows from the match briefing / this repo's own published
 * `DEFAULT_CONFIG` -- not secret per-team data -- so accepting them as an
 * explicit parameter here does not smuggle anything across the trust
 * boundary this function's signature otherwise enforces.
 *
 * Returns `undefined` -- never a fabricated, wrong-guess op -- when fewer
 * than `params.threshold` distinct-index shares for the target's CURRENT
 * generation are on the ledger yet. That mirrors `shamir.ts`'s own "the
 * math stays honest" design note (see `completeShares`'s doc comment): this
 * helper never invents a plausible-looking op out of insufficient
 * information, the same way a real participant genuinely could not yet
 * attempt a hunt.
 */
export function buildHuntOp(
  projection: CryptoBattleProjection,
  targetTeamId: string,
  params: PublicHuntParams,
): CryptoBattleOp | undefined {
  const target = projection.teams[targetTeamId];
  if (!target) return undefined;
  const currentGeneration = target.generation;

  const byIndex = new Map<number, Share>();
  for (const artifact of projection.publicLedger) {
    if (artifact.kind !== "share") continue;
    if (artifact.teamId !== targetTeamId) continue;
    if (artifact.generation !== currentGeneration) continue;
    byIndex.set(artifact.shareIndex, { index: artifact.shareIndex, value: BigInt(artifact.value) });
  }
  if (byIndex.size < params.threshold) return undefined;

  const shares = [...byIndex.values()].slice(0, params.threshold);
  const recoveredSecret = reconstruct(shares, BigInt(params.prime));
  return {
    kind: "hunt",
    targetTeamId,
    generation: currentGeneration,
    recoveredSecret: recoveredSecret.toString(),
  };
}
