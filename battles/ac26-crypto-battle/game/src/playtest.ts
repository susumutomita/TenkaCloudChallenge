/**
 * Deterministic scripted-playtest runner (Issue #486 PR5).
 *
 * A `PlaytestScript` is a plain-data fixture -- a fully pre-authored, ordered
 * list of `tick` / op `Step`s for a fixed `eventId` and team roster, plus an
 * optional scaled-down `config` (e.g. a 20-30 min vertical slice instead of
 * the full 90-min match). `runScript` replays it against a fresh
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
import type {
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
  let state = initialState({ eventId: script.eventId, teamIds: script.teams }, script.config);
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
