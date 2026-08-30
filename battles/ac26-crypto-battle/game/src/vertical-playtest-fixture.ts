/**
 * Shared 2-team, 25-min vertical-playtest script builder (Issue #486 PR5).
 *
 * `buildVerticalPlaytestScript()` composes the ONE concrete, deterministic
 * `PlaytestScript` (see playtest.ts) that both `vertical-playtest.test.ts`
 * (which replays it via `runScript` and asserts the Issue #486 vertical-
 * slice MUST list) and `replay.test.ts` (which builds a debrief `replay.ts`
 * timeline from the SAME run's final state) depend on. Living here, not
 * inside either `*.test.ts` file, is what lets `replay.test.ts` build its
 * replay from "the vertical playtest's actual final state" (Issue #486
 * PR5's own wording) without one test file importing another test file's
 * module (which would re-register that file's `describe`/`test` blocks a
 * second time under `bun test`).
 *
 * See vertical-playtest.test.ts's header for the full narrative this script
 * tells and how it maps onto Issue #486's 10-item vertical-slice MUST list.
 */

import { applyOp, initialState, projectForTeam, tick, validateOp } from "./reducer.ts";
import {
  buildFheOp,
  buildHuntOp,
  buildLeakOp,
  buildMpcOp,
  buildProveOp,
  buildRotateOp,
  type PlaytestOpStep,
  type PlaytestScript,
  type PlaytestStep,
  type PublicHuntParams,
} from "./playtest.ts";
import type { CryptoBattleConfig, CryptoBattleOp, CryptoBattleProjection } from "./types.ts";

export const EVENT_ID = "vertical-playtest-486-pr5";
/**
 * [Issue #652] The platform secret this scripted playthrough runs on. A fixed
 * value, not a real one: the point is a reproducible Order belt, and this
 * fixture never runs a live event.
 */
export const MATCH_SECRET = "vertical-secret-1";
export const TEAMS: readonly [string, string] = ["alpha", "bravo"];
export const ATTACKER = "bravo";
export const DEFENDER = "alpha";

/**
 * A 25-min scaled-down match (Issue #486's "20-30 min scripted fixture" PR5
 * requirement), phase boundaries and contract cadence scaled down roughly
 * proportionally from `DEFAULT_CONFIG`'s 90-min build (25/90 ~= 0.28) --
 * `threshold` / `shareCount` / `scores` stay at the real values, since
 * neither the Shamir math nor the scoring rules being tested are
 * time-scaled, only the match clock is.
 */
export const VERTICAL_CONFIG: Partial<CryptoBattleConfig> = {
  matchDurationMs: 25 * 60_000,
  phaseBoundaries: {
    buildToPressureMs: 8 * 60_000,
    pressureToEndgameMs: 18 * 60_000,
  },
  contractIntervalMs: 60_000,
  contractTtlMs: 4 * 60_000,
  rushContractTtlMs: 2 * 60_000,
  rotateCooldownMs: 3 * 60_000,
};

export interface BuiltVerticalScript {
  readonly script: PlaytestScript;
  /** Human-readable move-by-move narrative, 1:1 with the op steps -- what a debrief facilitator would read aloud while narrating live; `replay.ts` separately builds a state-derived (not authoring-time) narrative from the FINAL state alone. */
  readonly narrative: readonly string[];
  /** The contract alpha had open at the moment it rotated -- used by "match end" assertions to reuse a real (if by-then-irrelevant) contract id. */
  readonly alphaContractVoidedByRotateId: string;
  /** `buildHuntOp`'s result immediately after alpha's rotate, before any new-generation share has been leaked -- must be `undefined` (see vertical-playtest.test.ts's "MUST 9" test). */
  readonly huntAttemptBeforeNewGenerationThreshold: CryptoBattleOp | undefined;
  /**
   * The ACTUAL `projectForTeam(state, "bravo")` value `buildHuntOp` was
   * called against to build the successful hunt op (captured at the exact
   * moment, not re-derived from a fresh/empty `initialState` later) --
   * exposed so a consumer can assert "the public-information surface the
   * real hunt was built from never contained alpha's secret or an
   * un-leaked share value" against the real thing, not a stand-in that
   * would pass trivially because it never had anything to leak in the
   * first place (see vertical-playtest.test.ts's "MUST 6/7/8" test).
   */
  readonly bravoProjectionBeforeHunt: CryptoBattleProjection;
}

/**
 * Compose the vertical playtest's `PlaytestScript` by actually driving the
 * reducer once, live, recording every tick/op it performs. This is
 * "fixture composition", not part of playtest.ts's own contract -- this
 * function is allowed to look at the full trusted-side `state` to decide
 * WHAT to do next (e.g. "which contract is open for alpha right now"), but
 * every op it hands to `buildProveOp` / `buildHuntOp` is still built from
 * exactly the projection/vault those helpers accept -- see playtest.ts's
 * doc comments on why that is the load-bearing part, not merely a style
 * choice.
 */
export function buildVerticalPlaytestScript(): BuiltVerticalScript {
  const steps: PlaytestStep[] = [];
  const narrative: string[] = [];
  // [Issue #652] Carries a match secret because production always does — the
  // dispatcher issues one before `initialState`. Pinning it also pins the Order
  // belt this scripted playthrough walks: the belt derives from the seed, so a
  // secretless fixture would re-shape every time the seed does.
  let state = initialState(
    { eventId: EVENT_ID, teamIds: TEAMS, matchSecret: MATCH_SECRET },
    VERTICAL_CONFIG,
  );

  function recordTick(atMs: number): void {
    state = tick(state, atMs);
    steps.push({ atMs, kind: "tick" });
  }

  function recordOp(teamId: string, op: CryptoBattleOp, expect: "ok" | "rejected", label: string): void {
    const atMs = state.nowMs ?? 0;
    const verdict = validateOp(state, teamId, op);
    if (verdict.ok !== (expect === "ok")) {
      throw new Error(
        `buildVerticalPlaytestScript: step "${label}" expected ${expect} but validateOp returned ${JSON.stringify(verdict)}`,
      );
    }
    if (verdict.ok) {
      state = applyOp(state, teamId, op);
    }
    const step: PlaytestOpStep = { atMs, teamId, op, expect };
    steps.push(step);
    narrative.push(`${(atMs / 1000).toFixed(0)}s ${label}`);
  }

  function distinctLeakedShareIndices(teamId: string): number[] {
    const team = state.teams[teamId];
    const currentGeneration = team?.generation ?? 1;
    return [
      ...new Set(
        state.publicLedger
          .filter((a) => a.kind === "share" && a.teamId === teamId && a.generation === currentGeneration)
          .map((a) => (a.kind === "share" ? a.shareIndex : -1)),
      ),
    ];
  }

  function hasResolution(teamId: string, method: "leak" | "prove", kind?: "standard" | "rush"): boolean {
    return state.contracts.some(
      (contract) =>
        contract.teamId === teamId &&
        contract.resolution === method &&
        (kind === undefined || contract.kind === kind),
    );
  }

  function ledgerKindsFor(teamId: string): Set<string> {
    return new Set(
      state.publicLedger
        .filter((artifact) => artifact.teamId === teamId)
        .map((artifact) => artifact.kind),
    );
  }

  function narrativeRequirementsMet(): boolean {
    const attackerKinds = ledgerKindsFor(ATTACKER);
    return (
      distinctLeakedShareIndices(DEFENDER).length >= state.config.threshold &&
      hasResolution(DEFENDER, "leak", "standard") &&
      hasResolution(ATTACKER, "prove", "standard") &&
      ["proof", "ciphertext", "partial"].every((kind) => attackerKinds.has(kind))
    );
  }

  // -- MUST 2: tick(0) issues the first Contract batch to both teams.
  recordTick(0);

  // -- MUST 3 + 4: alpha LEAKs every contract addressed to it; bravo PROVEs
  // every contract addressed to it -- contemporaneously, batch by batch --
  // until alpha has leaked `threshold` DISTINCT share indices (the real,
  // schedule-derived contracts may repeat a share index across two
  // different contracts, so this is a bounded loop, not a fixed count --
  // same shape as adversarial.test.ts's "adversarial 2").
  const GUARD_LIMIT = 60;
  let guard = 0;
  while (!narrativeRequirementsMet()) {
    if (guard >= GUARD_LIMIT) {
      throw new Error(
        "buildVerticalPlaytestScript: alpha did not accumulate `threshold` distinct leaked shares within the guard bound",
      );
    }
    guard += 1;

    // [Issue #645] Only a `reveal-share` Order can be LEAKed or PROVEd. FHE and
    // MPC Orders are served below, in the same batch, so this script exercises
    // all four methods against the real issuance schedule rather than a
    // hand-built Order list.
    const alreadyLeaked = new Set(distinctLeakedShareIndices(DEFENDER));
    const leakable = state.contracts.filter(
      (contract) =>
        contract.teamId === DEFENDER &&
        contract.status === "open" &&
        contract.task.kind === "reveal-share" &&
        contract.allowedMethods.includes("leak"),
    );
    // Prefer the property the story still needs: first a standard LEAK for
    // the equal-points assertion, then a previously-unpublished share index
    // so the HUNT threshold converges. Belt position is deliberately not a
    // requirement — it changes with the server-only match seed.
    const alphaOpen =
      (!hasResolution(DEFENDER, "leak", "standard")
        ? leakable.find((contract) => contract.kind === "standard")
        : undefined) ??
      leakable.find(
        (contract) =>
          contract.task.kind === "reveal-share" &&
          contract.task.shareIndices.some((index) => !alreadyLeaked.has(index)),
      ) ??
      leakable[0];
    if (alphaOpen && alphaOpen.task.kind === "reveal-share") {
      recordOp(
        DEFENDER,
        buildLeakOp(alphaOpen.id),
        "ok",
        `Team ${DEFENDER} LEAK ${alphaOpen.id} (${alphaOpen.kind}, share #${alphaOpen.task.shareIndices.join(",")})`,
      );
    }
    const proveable = state.contracts.filter(
      (contract) =>
        contract.teamId === ATTACKER &&
        contract.status === "open" &&
        contract.task.kind === "reveal-share" &&
        contract.allowedMethods.includes("prove"),
    );
    const bravoOpen =
      (!hasResolution(ATTACKER, "prove", "standard")
        ? proveable.find((contract) => contract.kind === "standard")
        : undefined) ?? proveable[0];
    if (bravoOpen) {
      const bravoVault = projectForTeam(state, ATTACKER).vault;
      recordOp(
        ATTACKER,
        buildProveOp(bravoVault, bravoOpen.id),
        "ok",
        `Team ${ATTACKER} PROVE ${bravoOpen.id} (${bravoOpen.kind}) -- no share revealed`,
      );
    }

    // [Issue #645 Phase 2/3] Both new methods, built from the OWNING team's
    // projection only -- `buildFheOp` never sees a plaintext or a key, and
    // `buildMpcOp` sees this office's own number and nobody else's.
    for (const teamId of [DEFENDER, ATTACKER]) {
      const projection = projectForTeam(state, teamId);
      const prime = state.config.prime;
      const fheOrder = projection.myContracts.find(
        (c) => c.status === "open" && c.task.kind === "homomorphic-sum",
      );
      const fheOp = fheOrder ? buildFheOp(fheOrder, prime) : undefined;
      if (fheOrder && fheOp) {
        recordOp(
          teamId,
          fheOp,
          "ok",
          `Team ${teamId} FHE ${fheOrder.id} -- added two ciphertexts without decrypting either`,
        );
      }
      const mpcOrder = projection.myContracts.find(
        (c) => c.status === "open" && c.task.kind === "masked-total",
      );
      const mpcOp = mpcOrder ? buildMpcOp(mpcOrder, prime) : undefined;
      if (mpcOrder && mpcOp) {
        recordOp(
          teamId,
          mpcOp,
          "ok",
          `Team ${teamId} MPC ${mpcOrder.id} -- published a masked subtotal, not its input`,
        );
      }
    }

    if (!narrativeRequirementsMet()) {
      const nextBatchAtMs = state.nextContractAtMs ?? (state.nowMs ?? 0) + state.config.contractIntervalMs;
      recordTick(nextBatchAtMs);
    }
  }

  // -- MUST 6/7/8: bravo builds a HUNT op from PUBLIC information only
  // (projectForTeam("bravo"), never state.teams.alpha.secret directly -- see
  // playtest.ts's buildHuntOp doc comment) and submits it; the trusted
  // verifier (validateOp's mod() comparison) checks it and both scores move.
  const huntParams: PublicHuntParams = { prime: state.config.prime, threshold: state.config.threshold };
  const bravoProjectionBeforeHunt = projectForTeam(state, ATTACKER);
  const huntOp = buildHuntOp(bravoProjectionBeforeHunt, DEFENDER, huntParams);
  if (!huntOp) {
    throw new Error("buildVerticalPlaytestScript: expected buildHuntOp to construct a hunt once threshold shares were leaked");
  }
  recordOp(
    ATTACKER,
    huntOp,
    "ok",
    `Team ${ATTACKER} HUNT ${DEFENDER} -- reconstructed generation-1 secret from ${state.config.threshold} public ledger shares -> success`,
  );

  // -- MUST 9 setup: advance to the next contract batch so alpha has a real
  // open contract at the moment it rotates, to demonstrate ROTATE's concrete
  // cost (the open contract gets voided) rather than rotating into an
  // already-empty queue.
  recordTick(state.nextContractAtMs ?? (state.nowMs ?? 0) + state.config.contractIntervalMs);
  const alphaOpenBeforeRotate = state.contracts.find((c) => c.teamId === DEFENDER && c.status === "open");
  if (!alphaOpenBeforeRotate) {
    throw new Error("buildVerticalPlaytestScript: expected alpha to have a fresh open contract right before rotating");
  }

  recordOp(
    DEFENDER,
    buildRotateOp(),
    "ok",
    `Team ${DEFENDER} ROTATE -- advances to generation 2, voids the open contract ${alphaOpenBeforeRotate.id} and every generation-1 leak`,
  );

  // -- MUST 9: a HUNT reusing the OLD (pre-rotate) op verbatim is rejected --
  // alpha is now on generation 2, so the stale op's `generation: 1` no
  // longer matches.
  recordOp(
    ATTACKER,
    huntOp,
    "rejected",
    `Team ${ATTACKER} re-submits the SAME pre-rotate HUNT op against ${DEFENDER} -> rejected (target has rotated to a new generation)`,
  );

  // -- MUST 9: even re-targeting the CURRENT generation with the OLD
  // (now-stale) reconstructed value is rejected -- the pre-rotate
  // reconstruction genuinely does not match the post-rotate secret, not
  // merely a generation-number mismatch.
  if (huntOp.kind !== "hunt") throw new Error("buildVerticalPlaytestScript: expected a hunt op");
  const staleValueAtCurrentGeneration: CryptoBattleOp = {
    kind: "hunt",
    targetTeamId: DEFENDER,
    generation: state.teams[DEFENDER]?.generation ?? 2,
    recoveredSecret: huntOp.recoveredSecret,
  };
  recordOp(
    ATTACKER,
    staleValueAtCurrentGeneration,
    "rejected",
    `Team ${ATTACKER} HUNTs ${DEFENDER} at the NEW generation using the OLD reconstructed secret -> rejected (does not match)`,
  );

  // -- MUST 9 (structural check, not itself a Step): right after the rotate,
  // and before any generation-2 share has been leaked, buildHuntOp must
  // refuse to even construct an op -- there is nothing on the ledger yet to
  // build one from. This is exactly "alphaの新世代shareが3枚leakされるまでは
  // HUNT不成立" made executable: a real participant's own tooling would be
  // in the identical position.
  const huntAttemptBeforeNewGenerationThreshold = buildHuntOp(
    projectForTeam(state, ATTACKER),
    DEFENDER,
    huntParams,
  );

  // -- Advance through pressure/endgame, then to match end, narrating the
  // 25-min match's remaining phases (Issue #486 PR5: "endgame まで進めて
  // match end").
  recordTick(state.config.phaseBoundaries.pressureToEndgameMs + (state.startedAtMs ?? 0));
  recordTick(state.config.matchDurationMs + (state.startedAtMs ?? 0));
  if (state.phase !== "ended") {
    throw new Error(
      `buildVerticalPlaytestScript: expected phase "ended" after ticking to matchDurationMs, got "${state.phase}"`,
    );
  }

  // -- MUST 9 wording ("全 op 拒否"): every op kind is rejected once the
  // match has ended, regardless of the underlying contract/proof/hunt's own
  // validity -- validateOp's `state.phase === "ended"` guard fires first
  // (see reducer.ts's validateOp), so reusing an already-completed
  // contract id or a garbage proof is fine here, the phase guard rejects
  // before either would even be inspected.
  recordOp(
    DEFENDER,
    buildLeakOp(alphaOpenBeforeRotate.id),
    "rejected",
    `Team ${DEFENDER} LEAK after match end -> rejected`,
  );
  recordOp(
    ATTACKER,
    { kind: "prove", contractId: alphaOpenBeforeRotate.id, proof: { commitment: "2", response: "2" } },
    "rejected",
    `Team ${ATTACKER} PROVE after match end -> rejected`,
  );
  recordOp(DEFENDER, buildRotateOp(), "rejected", `Team ${DEFENDER} ROTATE after match end -> rejected`);
  recordOp(
    ATTACKER,
    { kind: "hunt", targetTeamId: DEFENDER, generation: state.teams[DEFENDER]?.generation ?? 2, recoveredSecret: "0" },
    "rejected",
    `Team ${ATTACKER} HUNT after match end -> rejected`,
  );

  return {
    script: {
      eventId: EVENT_ID,
      teams: TEAMS,
      matchSecret: MATCH_SECRET,
      steps,
      config: VERTICAL_CONFIG,
    },
    narrative,
    alphaContractVoidedByRotateId: alphaOpenBeforeRotate.id,
    huntAttemptBeforeNewGenerationThreshold,
    bravoProjectionBeforeHunt,
  };
}
