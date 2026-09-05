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
 * `buildProveSudokuOp` and `buildHuntOp` matter -- they build a move from exactly
 * the information a participant is allowed to see (`projectForTeam`'s
 * output, i.e. a `CryptoBattleProjection`, plus -- for `buildHuntOp` --
 * public game-rule constants), never from `CryptoBattleState` directly.
 * `buildHuntOp` in particular can never read `state.teams[targetTeamId].secret`
 * even by accident, because it is never handed anything that has it -- see
 * that function's own doc comment.
 */

import { applyOp, initialState, projectForTeam, tick, validateOp } from "./reducer.ts";
import { reconstruct, type Share } from "./shamir.ts";
import { addCiphertexts } from "./fhe.ts";
import { encryptWithRung, toSymbols } from "./ladder.ts";
import { P } from "./field.ts";
import { computePartial } from "./mpc.ts";
import {
  ALL_PERMUTATIONS,
  applyPermutation,
  IDENTITY_PERMUTATION,
  type Permutation,
  recoverableSolutions,
  samePermutation,
} from "./sudoku.ts";
import type {
  CoordinationContext,
  Contract,
  ContractProjection,
  SudokuRevealArtifact,
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
  /**
   * [Issue #659] Every Order the run ever saw, by id.
   *
   * `finalState.contracts` is no longer a history: resolved and lapsed Orders
   * are pruned from the persisted row past a short retention window, because
   * keeping all of them made a 99-team match a 4.5 MB read-modify-write per
   * click. An assertion about what the match DID has to observe it while it
   * happens, which is what this is for.
   */
  readonly ordersSeen: ReadonlyMap<string, Contract>;
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
/**
 * [Issue #677] A fresh match that has already been started.
 *
 * `initialState` now returns a match in `waiting`, where the belt issues
 * nothing and the clock does not run, so that a deployed-but-unplayed match
 * stays as deployed instead of bleeding expiry penalties into a floored score.
 * Almost every test and every scripted playtest is about the match once it is
 * under way, so they build state through here; the tests that are specifically
 * about `waiting` call `initialState` directly.
 */
/**
 * [Issue #696] A config override whose field is the big one (2^61 - 1).
 *
 * For the trust-boundary tests ONLY, and for a reason about the test method
 * rather than the property. Those tests ask "does this serialized projection
 * contain a value it must not?" and answer it with a substring search, which is
 * sound only while the forbidden values are long enough to be unique. A match
 * now runs in `HAND_PRIME` (97) so a participant can do the arithmetic, and at
 * three digits the search reports a hit on any coincidence -- "124" occurs
 * inside an unrelated 2048-bit commitment.
 *
 * The boundary itself is structural: `projectForTeam` either copies a field or
 * it does not, and which modulus the numbers came from has no bearing on that.
 * Running those assertions in the big field is therefore the same test, made
 * able to tell a leak from a coincidence -- not a weakened one.
 */
export const SUBSTRING_SAFE_FIELD: Partial<CryptoBattleConfig> = { prime: P.toString() };

export function startedMatch(
  ctx: CoordinationContext,
  config?: Partial<CryptoBattleConfig>,
): CryptoBattleState {
  const state = initialState(ctx, config);
  const starter = ctx.teamIds[0];
  // A roster-less match has nobody to start it, and nothing to play either.
  if (starter === undefined) return state;
  // [Issue #689] Past the onboarding Order. Slot 0 is deliberately a single
  // hand-holding share reveal, and these fixtures are about the belt once it is
  // a contest -- a full batch, several methods, a real choice. Consuming the
  // slot here keeps that in one place instead of every caller ticking forward.
  const teams = Object.fromEntries(
    Object.entries(state.teams).map(([id, team]) => [id, { ...team, issuedOrderCount: 1 }]),
  );
  return applyOp({ ...state, teams }, starter, { kind: "start" });
}

export function runScript(script: PlaytestScript): PlaytestResult {
  let state = startedMatch(
    {
      eventId: script.eventId,
      teamIds: script.teams,
      ...(script.matchSecret ? { matchSecret: script.matchSecret } : {}),
    },
    script.config,
  );
  const timeline: PlaytestTimelineEntry[] = [];
  const violations: PlaytestViolation[] = [];
  // [Issue #659] Resolved and lapsed Orders are pruned from the persisted row,
  // so the final state is not a history. Record each Order in its LATEST seen
  // form as the run goes, which is what an assertion about the match needs.
  const ordersSeen = new Map<string, Contract>();
  const remember = () => {
    for (const c of state.contracts) ordersSeen.set(c.id, c);
  };

  script.steps.forEach((step, stepIndex) => {
    if (isTickStep(step)) {
      state = tick(state, step.atMs);
      remember();
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
      remember();
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

  return { finalState: state, timeline, violations, ordersSeen };
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
 * [Issue #709] A relabelling this team has NOT yet used on its current
 * generation -- what a careful participant picks by reading MY VAULT's list.
 *
 * Walks `ALL_PERMUTATIONS` in a fixed order skipping the identity and every
 * entry in `vault.usedPermutations`, so the choice is deterministic (the
 * reducer's purity contract extends to the fixtures that drive it) and never
 * a reuse. Returns `undefined` once all 23 are spent, which is the signal to
 * ROTATE.
 */
export function freshPermutation(vault: VaultProjection): Permutation | undefined {
  return ALL_PERMUTATIONS.find(
    (pi) =>
      !samePermutation(pi, IDENTITY_PERMUTATION) &&
      !vault.usedPermutations.some((used) => samePermutation(used, pi)),
  );
}

/**
 * Build a PROVE op from a team's own vault -- exactly what a participant does
 * by hand: take the solution off MY VAULT, pick a relabelling, rewrite the 16
 * cells. Takes a `VaultProjection`, not a `CryptoBattleState` or `TeamState`
 * -- there is nothing about another team reachable from this function's input
 * at all.
 *
 * `pi` defaults to {@link freshPermutation}, i.e. the careful choice. A test
 * that wants the MISTAKE (the same relabelling twice) passes one explicitly.
 */
export function buildProveSudokuOp(
  vault: VaultProjection,
  contractId: string,
  pi: Permutation | undefined = freshPermutation(vault),
): CryptoBattleOp {
  if (pi === undefined) {
    throw new Error(`buildProveSudokuOp: every relabelling is spent on generation ${vault.generation} -- ROTATE`);
  }
  return { kind: "prove-sudoku", contractId, grid: applyPermutation(vault.sudokuSolution, pi) };
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
 * [Issue #659] Build a CIPHER op from a ladder Order's own projection.
 *
 * The team's key arrives on the projection because the Order belongs to this
 * team, and the arithmetic is `ladder.ts`'s `encryptWithRung` -- the same
 * function a participant reproduces by hand. Written here rather than inline in
 * each test for the reason the other `build*Op` helpers exist: a test that
 * re-derives the cipher is asserting its own copy of the rule, not the rule.
 */
export function buildCipherOp(contract: ContractProjection): CryptoBattleOp | undefined {
  if (contract.task.kind !== "caesar-shift") return undefined;
  const { rung, plaintext, myKey } = contract.task;
  return {
    kind: "cipher",
    contractId: contract.id,
    // Submitted as the pictures a participant would type. `parseAnswer` takes
    // either those or the values; sending the faces exercises the path a human
    // actually uses.
    answer: [...toSymbols(encryptWithRung(plaintext, myKey, rung), rung)],
  };
}

/**
 * [Issue #659] Answer an Order by whichever method it actually admits.
 *
 * Shared because two test files had grown their own copy, and when the ladder
 * added a fourth task kind BOTH copies silently fell through to `buildMpcOp`,
 * which returns `undefined` for a task it cannot serve. Nothing failed: the
 * callers skipped every ladder Order, and two tests whose whole premise is "a
 * team that clears everything" quietly stopped clearing about a fifth of the
 * belt.
 *
 * So the switch is exhaustive on purpose. A fifth task kind is a compile error
 * here rather than a silent gap in whatever those tests were measuring.
 */
export function buildClearingOp(
  contract: ContractProjection,
  vault: CryptoBattleProjection["vault"],
  prime: string,
): CryptoBattleOp | undefined {
  switch (contract.task.kind) {
    case "reveal-share":
      // A share Order may forbid raw disclosure, in which case PROVE is the
      // only way to clear it. Ask the Order rather than assuming LEAK.
      if (contract.allowedMethods.includes("leak")) return buildLeakOp(contract.id);
      return buildProveSudokuOp(vault, contract.id);
    case "zk-sudoku":
      // [Issue #709] PROVE-only by construction. `freshPermutation` reads the
      // vault's used list, so a loop that clears every Order never reuses one
      // -- until all 23 are spent, at which point this throws and the caller
      // has to ROTATE, exactly as a participant would.
      return buildProveSudokuOp(vault, contract.id);
    case "caesar-shift":
      return buildCipherOp(contract);
    case "homomorphic-sum":
      return buildFheOp(contract, prime);
    case "masked-total":
      return buildMpcOp(contract, prime);
    default: {
      const exhaustive: never = contract.task;
      throw new Error(`buildClearingOp: unknown task ${JSON.stringify(exhaustive)}`);
    }
  }
}

/**
 * [Issue #709] Recover a team's sudoku solution from reveals that share a
 * relabelling, and build the HUNT that spends it.
 *
 * Reads the PUBLIC LEDGER and the PUBLIC PUZZLE only — the same material any
 * participant can see — which is the property that makes this a legitimate
 * attack rather than a privileged shortcut, exactly as `buildHuntOp` does for
 * the Shamir route. The reasoning is the one a person does on paper:
 *
 *  1. Two reveals from one team, one generation, SAME TAG were made with one
 *     relabelling π. Their cells are cells of one grid, `π(S)`.
 *  2. Where the target's puzzle shows a given `S[i]` at a cell the reveals
 *     also cover, `π(S[i])` is now known: one row of the relabelling table.
 *  3. Every candidate solution consistent with the puzzle (288 at most, usually
 *     one) is tried: the candidate whose relabelling by the recovered rows
 *     agrees with EVERY revealed cell is `S`.
 *
 * Returns `undefined` when the target never reused a relabelling — the normal
 * case for a team that reads its own vault — or when the material does not
 * yet pin a single solution. Never a fabricated guess.
 */
export function buildSudokuHuntOp(
  projection: CryptoBattleProjection,
  targetTeamId: string,
): CryptoBattleOp | undefined {
  const target = projection.teams[targetTeamId];
  const puzzle = projection.publicPuzzles[targetTeamId];
  if (!target || puzzle === undefined) return undefined;

  const byTag = new Map<string, SudokuRevealArtifact[]>();
  for (const artifact of projection.publicLedger) {
    if (artifact.kind !== "sudoku-reveal") continue;
    if (artifact.teamId !== targetTeamId || artifact.generation !== target.generation) continue;
    const bucket = byTag.get(artifact.tag) ?? [];
    bucket.push(artifact);
    byTag.set(artifact.tag, bucket);
  }

  for (const reveals of byTag.values()) {
    if (reveals.length < 2) continue;
    // Every solution the public puzzle allows, tested against what was seen:
    // the true S relabels onto the revealed cells consistently; a wrong
    // candidate does not. `recoverableSolutions` is the one statement of that
    // reasoning -- the judge gates the HUNT on it too, so what this builder
    // finds is exactly what the judge will accept.
    const matching = recoverableSolutions(puzzle, reveals);
    const [only] = matching;
    if (only && matching.length === 1) {
      return { kind: "hunt-sudoku", targetTeamId, generation: target.generation, solution: [...only] };
    }
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
