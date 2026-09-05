/**
 * Portal plugin tests (Issue #486, PR4).
 *
 * `../../portal/*.tsx` are the files the participant-portal build actually
 * loads via a Vite `import.meta.glob` over `problems/<category>/<id>/portal/*.tsx`
 * (see `apps/participant-portal/src/plugins/loader.ts`'s header on
 * TenkaCloud's side). This file exercises them from the game package the same way
 * `coordination-plugin.test.ts` exercises `../../coordination/crypto-battle.ts`
 * -- both are one level up from `game/`, both are included by
 * `../game/tsconfig.json` for typecheck coverage, and both need
 * `bun test` to actually run them (portal/ has no `package.json`/test
 * runner of its own).
 *
 * `renderToStaticMarkup` never runs `useEffect` (server/static rendering has
 * no commit phase), so it can exercise a slot's SYNCHRONOUS first paint
 * (fail-closed without a `coordinationClient`, or the "loading" state with
 * one) but never a completed poll -- there is no way to await a fully-loaded
 * `StatusPanel` this way. For the "populated 3 lanes" cases (including the
 * "does not leak the answer" check), this file renders `StatusPanel.tsx`'s
 * exported `StatusPanelBody` directly with a fabricated
 * `CryptoBattleProjection` instead -- the same seam
 * `StatusPanelBody`'s own doc comment describes.
 *
 * `RegistrationPanel.tsx`'s 4 exported `submit*` functions are tested
 * directly against a capturing fake `PortalCoordinationClient`, rather than
 * simulating a DOM click (`onClick` never fires under `renderToStaticMarkup`
 * either, and this repo has no jsdom dependency) -- see that file's header.
 */
import { describe, expect, it } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { startedMatch } from "./playtest.ts";
import type { PortalCoordinationClient, PortalCoordinationOutcome, PortalSlotProps } from "@tenkacloud/portal-plugin-sdk";
import { isCryptoBattleProjection } from "../../portal/coordination.ts";
import HelpDrawer, { PYTHON_SNIPPET } from "../../portal/HelpDrawer.tsx";
import RegistrationPanel, {
  COPY as REGISTRATION_COPY,
  describeOutcome,
  describeProveOutcome,
  submitHunt,
  submitHuntSudoku,
  submitLeak,
  submitProveSudoku,
  submitRotate,
} from "../../portal/RegistrationPanel.tsx";
import { contractsForMethod } from "../../portal/RegistrationPanelCore.tsx";
import { GameBoardBody } from "../../portal/GameBoard.tsx";
import { ledgerPayload } from "../../portal/orderTask.ts";
import { ALL_SUBMISSION_METHODS } from "./methods.ts";
import {
  FAST_MOVE_COPY,
  FeedbackBanner,
  cipherHuntCandidates,
  huntBudgetFor,
  huntFeedback,
  nextHintFor,
  primaryActionsFor,
  proveFeedback,
  rotateVoidCount,
  ageProjection,
  exposureRows,
  sudokuHuntCandidates,
  sudokuRotatePressure,
  tacticAvailability,
} from "../../portal/FastMovePanel.tsx";
import StatusPanel, { StatusPanelBody } from "../../portal/StatusPanel.tsx";
import { rungSpec } from "./ladder.ts";
import { reconstruct } from "./shamir.ts";
import { DEFAULT_CONFIG, initialState, projectForTeam, tick } from "./reducer.ts";
import { ALL_PERMUTATIONS, IDENTITY_PERMUTATION, samePermutation } from "./sudoku.ts";
import type { ContractProjection, CryptoBattleProjection, PublicArtifact } from "./types.ts";

const FIXED_NOW = 1_700_000_000_000;

/**
 * `CryptoBattleProjection.matchRemainingMs` / `ContractProjection.remainingMs`
 * live on the dispatcher's elapsed-since-event-start clock, NOT an absolute
 * Unix epoch ms like `FIXED_NOW` above. `FIXED_NOW` only anchors
 * `baseProps()`'s `PortalSlotProps.nowIso` below -- a field `StatusPanel.tsx`
 * no longer reads at all (see its `useElapsedSincePollMs`, which anchors to
 * `usePolledProjection`'s own `receivedAtWallMs` / `Date.now()` instead);
 * `baseProps()` still has to supply SOME value only because `nowIso` is a
 * required field of the SDK's `PortalSlotProps` type. An earlier version of
 * this fixture conflated the two clocks (built `matchEndsAtMs` /
 * `expiresAtMs` around `FIXED_NOW` as if they were absolute epoch ms, and
 * `StatusPanel.tsx` itself used to derive its display clock from `nowIso`),
 * which exercised only the WRONG unit assumption the real bug shipped with
 * -- `StatusPanelBody`'s countdown math never actually saw a realistic
 * elapsed-vs-wall-clock mismatch in this suite. This constant is a small,
 * clearly-not-an-epoch elapsed duration (40 minutes into the match) so the
 * fixture matches what `../game/src/reducer.ts`'s `projectForTeam` really
 * produces.
 */
const ELAPSED_AT_TICK_MS = 40 * 60_000;

/**
 * A well-formed `CryptoBattleProjection`, close to what
 * `../game/src/reducer.ts`'s `projectForTeam` actually produces mid-match.
 * `publicLedger` deliberately carries exactly 3 of "red"'s shares (indices
 * 0/1/2) -- `DEFAULT_CONFIG.threshold` in reducer.ts -- i.e. a real
 * `threshold`-worth of exposure, the exact case the "does not leak the
 * answer" test below checks the rendered Public Ledger never editorializes
 * about.
 */
function fixtureProjection(overrides: Partial<CryptoBattleProjection> = {}): CryptoBattleProjection {
  return {
    phase: "pressure",
    // [Issue #645] The modulus is on the projection: a participant needs it to
    // compute an FHE or MPC answer, and it is public by construction.
    prime: DEFAULT_CONFIG.prime,
    // [Issue #682] The exposure lane renders "N / threshold" from this.
    threshold: DEFAULT_CONFIG.threshold,
    // [Issue #688] The waiting screen renders "1 / 2 準備完了" from this.
    ready: { count: 2, total: 2, me: true },
    // 90-min matchDurationMs - 40-min elapsed = 50 min left, same numeric
    // value the earlier (buggy) absolute-epoch-based fixture used, so this
    // rewrite changes units, not the scenario the tests exercise.
    matchRemainingMs: 90 * 60_000 - ELAPSED_AT_TICK_MS,
    vault: {
      teamId: "blue",
      secret: "123456789012345678",
      shares: [
        { index: 0, value: "111" },
        { index: 1, value: "222" },
        { index: 2, value: "333" },
        { index: 3, value: "444" },
        { index: 4, value: "555" },
      ],
      generation: 1,
      lastRotateAtMs: undefined,
      rotateCooldownRemainingMs: 0,
      completedContractIds: [],
      huntedGenerations: [],
      // [Issue #709] The PROVE panel draws this and lists these.
      sudokuSolution: [1, 2, 3, 4, 3, 4, 1, 2, 2, 1, 4, 3, 4, 3, 2, 1],
      usedPermutations: [[2, 3, 4, 1]],
      sudokuHuntedGenerations: [],
    },
    myContracts: [
      {
        id: "blue-c0",
        kind: "standard",
        points: 10,
        leakPoints: 10,
        task: { kind: "reveal-share" as const, shareIndices: [0, 1] },
        privacyConstraint: "none",
        allowedMethods: ["leak", "prove"],
        status: "open",
        remainingMs: 5 * 60_000,
        hints: [],
      },
      {
        id: "blue-c-old",
        kind: "standard",
        points: 10,
        leakPoints: 10,
        task: { kind: "reveal-share" as const, shareIndices: [2] },
        privacyConstraint: "none",
        allowedMethods: ["leak", "prove"],
        status: "expired",
        remainingMs: 0,
        hints: [],
      },
    ],
    otherOpenContractCount: 1,
    publicLedger: [
      {
        id: "red-c0-share0",
        teamId: "red",
        generation: 1,
        kind: "share",
        method: "leak" as const,
        shareIndex: 0,
        value: "998877",
        contractId: "red-c0",
        postedAtMs: ELAPSED_AT_TICK_MS - 9000,
      },
      {
        id: "red-c1-share1",
        teamId: "red",
        generation: 1,
        kind: "share",
        method: "leak" as const,
        shareIndex: 1,
        value: "776655",
        contractId: "red-c1",
        postedAtMs: ELAPSED_AT_TICK_MS - 6000,
      },
      {
        id: "red-c2-share2",
        teamId: "red",
        generation: 1,
        kind: "share",
        method: "leak" as const,
        shareIndex: 2,
        value: "554433",
        contractId: "red-c2",
        postedAtMs: ELAPSED_AT_TICK_MS - 3000,
      },
      {
        // [Issue #709] What a PROVE publishes: one opened group of a
        // RELABELLED grid, with the tag naming the relabelling.
        id: "blue-c-old-sudoku",
        teamId: "blue",
        generation: 1,
        kind: "sudoku-reveal",
        method: "prove" as const,
        contractId: "blue-c-old",
        group: 1,
        cells: [4, 2, 3, 1],
        tag: "a1b2c3d4e5f6",
        postedAtMs: ELAPSED_AT_TICK_MS - 1000,
      },
    ],
    teams: {
      blue: { teamId: "blue", teamName: "blue", score: 30, generation: 1, huntedGenerationCount: 0 },
      red: { teamId: "red", teamName: "red", score: 20, generation: 1, huntedGenerationCount: 0 },
    },
    // [Issue #709] Eight cells of each team's solution; 0 is hidden.
    publicPuzzles: {
      blue: [1, 0, 0, 4, 0, 4, 1, 0, 2, 0, 0, 3, 0, 3, 2, 0],
      red: [0, 3, 1, 0, 1, 0, 0, 3, 0, 2, 4, 0, 4, 0, 0, 2],
    },
    // [Issue #696] The HUNT card reads the budget and the miss price from here.
    huntAttempts: { red: { generation: 1, spent: 0, max: DEFAULT_CONFIG.maxHuntAttemptsPerTarget } },
    sudokuHuntAttempts: { red: { generation: 1, spent: 0, max: DEFAULT_CONFIG.maxHuntAttemptsPerTarget } },
    wrongHuntCost: DEFAULT_CONFIG.scores.wrongHunt,
    wrongProveCost: DEFAULT_CONFIG.scores.wrongProve,
    ...overrides,
  };
}

function baseProps(overrides: Partial<PortalSlotProps> = {}): PortalSlotProps {
  return {
    team: { teamId: "blue", teamName: "Blue Team", eventId: "evt-486-pr4" },
    problemId: "ac26-crypto-battle",
    jobId: "job-1",
    score: 0,
    locale: "en",
    endpoints: [],
    phases: [],
    disruptions: [],
    nowIso: new Date(FIXED_NOW).toISOString(),
    ...overrides,
  };
}

/** A `PortalCoordinationClient` that always resolves "ok" with `fixtureProjection()`. */
function okClient(): PortalCoordinationClient {
  return {
    submitOp: async () => ({ kind: "ok", projection: fixtureProjection() }),
    getProjection: async () => ({ kind: "ok", projection: fixtureProjection() }),
  };
}

/** A capturing fake client for the submitOp-shape tests: records every op it receives. */
function capturingClient(outcome: PortalCoordinationOutcome = { kind: "ok", projection: fixtureProjection() }) {
  const calls: unknown[] = [];
  const client: PortalCoordinationClient = {
    submitOp: async (op) => {
      calls.push(op);
      return outcome;
    },
    getProjection: async () => ({ kind: "ok", projection: fixtureProjection() }),
  };
  return { client, calls };
}

describe("portal/coordination.ts isCryptoBattleProjection", () => {
  it("accepts a well-formed CryptoBattleProjection", () => {
    expect(isCryptoBattleProjection(fixtureProjection())).toBe(true);
  });

  it("rejects null", () => {
    expect(isCryptoBattleProjection(null)).toBe(false);
  });

  it("rejects undefined and non-object primitives", () => {
    expect(isCryptoBattleProjection(undefined)).toBe(false);
    expect(isCryptoBattleProjection("not a projection")).toBe(false);
    expect(isCryptoBattleProjection(42)).toBe(false);
  });

  it("rejects an object missing required fields (broken shape)", () => {
    expect(isCryptoBattleProjection({ phase: "pressure" })).toBe(false);
    expect(isCryptoBattleProjection({})).toBe(false);
  });

  it("rejects a projection with an unrecognized phase value", () => {
    expect(isCryptoBattleProjection({ ...fixtureProjection(), phase: "not-a-real-phase" })).toBe(false);
  });

  it("rejects a projection whose vault is malformed", () => {
    const broken = { ...fixtureProjection(), vault: { teamId: "blue" } };
    expect(isCryptoBattleProjection(broken)).toBe(false);
  });

  it("rejects a projection whose vault.huntedGenerations is missing or non-array, even with every other vault field well-formed [Issue #486 PR4 review, medium #2]", () => {
    // Deliberately NOT the "everything missing" broken vault above --
    // StatusPanel.tsx's VaultLane reads `vault.huntedGenerations.length` /
    // `.join(...)` unconditionally, so this is the specific gap where a
    // narrowing bug would previously let a malformed projection through and
    // throw inside the render instead of being caught here.
    const { huntedGenerations, ...vaultWithoutHunted } = fixtureProjection().vault;
    expect(isCryptoBattleProjection({ ...fixtureProjection(), vault: vaultWithoutHunted })).toBe(false);
    expect(
      isCryptoBattleProjection({
        ...fixtureProjection(),
        vault: { ...fixtureProjection().vault, huntedGenerations: "not-an-array" },
      }),
    ).toBe(false);
  });

  it("rejects a projection whose vault.completedContractIds is missing or non-array, even with every other vault field well-formed [Issue #486 PR4 review, medium #2]", () => {
    const { completedContractIds, ...vaultWithoutCompleted } = fixtureProjection().vault;
    expect(isCryptoBattleProjection({ ...fixtureProjection(), vault: vaultWithoutCompleted })).toBe(false);
    expect(
      isCryptoBattleProjection({
        ...fixtureProjection(),
        vault: { ...fixtureProjection().vault, completedContractIds: "not-an-array" },
      }),
    ).toBe(false);
  });

  it("rejects a projection whose myContracts/publicLedger are not arrays", () => {
    expect(isCryptoBattleProjection({ ...fixtureProjection(), myContracts: "nope" })).toBe(false);
    expect(isCryptoBattleProjection({ ...fixtureProjection(), publicLedger: "nope" })).toBe(false);
  });
});

describe("StatusPanel.tsx -- ja/en smoke render + fail-closed", () => {
  for (const locale of ["ja", "en"] as const) {
    it(`renders without crashing and is fail-closed without a coordinationClient (${locale})`, () => {
      const html = renderToStaticMarkup(createElement(StatusPanel, baseProps({ locale })));
      expect(html.length).toBeGreaterThan(0);
      // The fail-closed branch renders only the title + a short notice --
      // none of the 3 lanes' section titles ever appear without a client.
      expect(html).not.toContain("Contract Queue");
      expect(html).not.toContain("My Vault");
      expect(html).not.toContain("Public Ledger");
      expect(html).toContain(
        locale === "ja" ? "coordination が未配線" : "Coordination is not wired up",
      );
    });

    it(`renders the "waiting for data" state without crashing when a coordinationClient IS present (${locale})`, () => {
      const html = renderToStaticMarkup(createElement(StatusPanel, baseProps({ locale, coordinationClient: okClient() })));
      expect(html.length).toBeGreaterThan(0);
      // With a client, the intro (not the fail-closed notice) renders --
      // renderToStaticMarkup never runs the polling effect, so the lanes
      // themselves have not loaded yet.
      expect(html).not.toContain(locale === "ja" ? "coordination が未配線" : "Coordination is not wired up");
      expect(html).toContain(locale === "ja" ? "最初の更新を待っています" : "Waiting for the first match update");
    });
  }
});

describe("StatusPanelBody -- populated 3-lane render", () => {
  for (const locale of ["ja", "en"] as const) {
    it(`renders all 3 lanes without crashing, with locale-correct copy (${locale})`, () => {
      const html = renderToStaticMarkup(
        createElement(StatusPanelBody, { projection: fixtureProjection(), locale, elapsedSincePollMs: 0 }),
      );
      expect(html.length).toBeGreaterThan(0);
      expect(html).toContain("Contract Queue");
      expect(html).toContain("My Vault");
      expect(html).toContain("Public Ledger");
      // Locale-specific prose (not just the shared English jargon terms
      // above, which this problem's own README.ja.md also keeps
      // untranslated -- see HelpDrawer.tsx's header).
      expect(html).toContain(locale === "ja" ? "スコア" : "Score");
      expect(html).toContain(locale === "ja" ? "フェーズ" : "Phase");
      expect(html).toContain(locale === "ja" ? "自チームにのみ表示されます" : "Only your team can see this");
      // [Issue #709] My Vault shows the team's own sudoku solution, as rows,
      // and the relabellings it has already spent.
      expect(html).toContain("1 2 3 4");
      expect(html).toContain("1→2");
      // Raw ledger data (participant-facing, allowed) is present.
      expect(html).toContain("998877");
      expect(html).toContain("554433");
    });

    /**
     * [Issue #709] The sudoku HUNT needs four things off the screen: which
     * group was opened, its four digits, the tag naming the relabelling, and
     * the target's public puzzle. The nonce-reuse HUNT this replaces once
     * shipped with two of its inputs rendered nowhere, so the same class of
     * gap is pinned here for the new one.
     */
    it(`renders every value a sudoku HUNT reads (${locale})`, () => {
      const projection = fixtureProjection();
      const html = renderToStaticMarkup(
        createElement(StatusPanelBody, { projection, locale, elapsedSincePollMs: 0 }),
      );
      const reveal = projection.publicLedger.find((a) => a.kind === "sudoku-reveal");
      if (reveal?.kind !== "sudoku-reveal") throw new Error("expected a sudoku reveal in the fixture");

      expect(html).toContain(reveal.teamId);
      expect(html).toContain(reveal.contractId);
      expect(html).toContain(reveal.cells.join(" "));
      expect(html).toContain(reveal.tag);
      expect(html).toContain(String(reveal.generation));
      // Every team's puzzle, not only the target's -- it is public for all of
      // them, and rendering only one would be the platform choosing a target.
      for (const puzzle of Object.values(projection.publicPuzzles)) {
        const firstRow = puzzle.slice(0, 4).map((v) => (v === 0 ? "." : String(v))).join(" ");
        expect(html).toContain(firstRow);
      }
    });

    it(`does not state or imply that a leaked threshold has been reached (${locale}) [Issue #486 UI principle]`, () => {
      // fixtureProjection() above deliberately leaks exactly
      // DEFAULT_CONFIG.threshold-many of "red"'s shares (3 of them) -- the
      // exact case where a judgement like "threshold reached" / "secret
      // recoverable now" would be tempting to add. It must never appear;
      // the raw share data (already asserted above) is the only thing
      // shown, and reading whether that's enough to reconstruct is left to
      // the participant.
      const html = renderToStaticMarkup(
        createElement(StatusPanelBody, { projection: fixtureProjection(), locale, elapsedSincePollMs: 0 }),
      );
      const lower = html.toLowerCase();
      const forbidden = [
        "threshold",
        "reconstructable",
        "exploitable",
        "at risk",
        "vulnerable",
        "しきい値",
        "復元可能",
        "危険",
        "脆弱",
      ];
      for (const phrase of forbidden) {
        expect(lower).not.toContain(phrase.toLowerCase());
      }
    });
  }
});

describe("StatusPanelBody against a REAL projection (live-deploy report: onboarding repair)", () => {
  // Every test above hand-fabricates `fixtureProjection()`. That never
  // exercised the actual seam a live match uses:
  // `initialState` -> `tick(state, eventNowMs)` -> `projectForTeam` ->
  // `StatusPanelBody`. `tick`'s `eventNowMs` is elapsed-since-event-start
  // (TenkaCloud's dispatcher: `eventNowMs = nowMs - eventStartMs`), so
  // `projectForTeam`'s output only reflects that clock correctly if this
  // seam is actually run end-to-end -- a hand-written fixture can encode
  // any (possibly wrong) unit convention its author assumed, and did: an
  // earlier fixture here built `matchEndsAtMs` / `expiresAtMs` around an
  // absolute-epoch-looking `FIXED_NOW`, which is exactly the wrong
  // assumption `StatusPanel.tsx`'s now-removed `useLiveNowMs` also made --
  // subtracting a real `Date.now()` from an elapsed-since-start duration
  // produces a deeply negative number that `formatDuration` clamps to
  // zero, rendering every live match's countdown as a permanent "0:00"
  // regardless of how much time was actually left (confirmed against a
  // live deployed match). This test runs the real engine and asserts that
  // failure mode cannot recur.
  it("renders a non-zero match and contract countdown right after the first tick", () => {
    const state0 = startedMatch({ eventId: "evt-countdown-regression", teamIds: ["blue"] });
    // eventNowMs = 0 for the very first tick: `tick`'s `startedAtMs ??
    // eventNowMs` then anchors the match start at exactly 0, so every
    // resulting duration below is an exact, non-flaky expected value
    // rather than depending on wall-clock timing.
    const state1 = tick(state0, 0);
    const projection = projectForTeam(state1, "blue");

    // Data-level assertion (the actual regression): a live match's
    // countdown durations must be positive right after issuance, never
    // zero/negative from a unit mismatch.
    expect(projection.matchRemainingMs).toBe(90 * 60_000);
    expect(projection.myContracts.length).toBeGreaterThan(0);
    for (const contract of projection.myContracts) {
      expect(contract.remainingMs).toBeGreaterThan(0);
    }

    // Render-level assertion: the match timer shows the real 90-minute
    // remaining duration ("1:30:00", `formatDuration`'s h>0 branch) and the
    // contract's countdown cell shows its real TTL, not the bug's
    // once-permanent "Time left" / "Expires in" value of exactly zero.
    // (A naive `not.toContain("0:00")` would be a false negative here --
    // "1:30:00" itself ends in the substring "0:00" -- so this checks the
    // two full expected duration strings instead.)
    const html = renderToStaticMarkup(
      createElement(StatusPanelBody, { projection, locale: "en", elapsedSincePollMs: 0 }),
    );
    expect(html).toContain("1:30:00");
    const contractTtlMs = projection.myContracts[0]?.remainingMs;
    if (contractTtlMs === undefined) throw new Error("test setup: expected at least one contract");
    const totalSeconds = Math.floor(contractTtlMs / 1000);
    const expectedContractCountdown = `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, "0")}`;
    expect(expectedContractCountdown).not.toBe("0:00"); // sanity: the TTL itself must be non-zero
    expect(html).toContain(expectedContractCountdown);
  });

  it("remainingMs decreases across LATER ticks, not just the first one (the live match this fix was diagnosed against was ~20-24 min in, not freshly started)", () => {
    // The single-tick test above only proves `projectForTeam` is correct
    // when `state.nowMs === state.startedAtMs` (elapsed 0) -- the easiest
    // possible case. The live match this fix was diagnosed against showed
    // contracts `blue-c10` / `-c11` / `-c12` (sequenceIndex 10-12, i.e.
    // roughly 20-24 minutes and many ticks past the first one), so this
    // asserts `projectForTeam` keeps using the MOST RECENT tick's `nowMs`
    // (not the first tick's) for every duration it computes.
    let state = startedMatch({ eventId: "evt-multi-tick-regression", teamIds: ["blue"] });
    state = tick(state, 0);
    const first = projectForTeam(state, "blue");
    const contractId = first.myContracts[0]?.id;
    if (contractId === undefined) throw new Error("test setup: expected at least one contract after the first tick");
    const remainingAtFirstTick = first.myContracts[0]?.remainingMs;
    if (remainingAtFirstTick === undefined) throw new Error("test setup: expected remainingMs on the first contract");

    // 1 minute later, in the same event-relative units `tick` expects.
    // Well under both `contractTtlMs` (5 min) and `rushContractTtlMs`
    // (2.5 min), so the SAME contract is still open, not expired/replaced --
    // this isolates "did remainingMs decrease" from "did a new contract get
    // issued".
    state = tick(state, 60_000);
    const later = projectForTeam(state, "blue");
    const sameContract = later.myContracts.find((c) => c.id === contractId);
    if (!sameContract) throw new Error(`test setup: expected contract ${contractId} to still be present`);

    expect(sameContract.status).toBe("open");
    expect(sameContract.remainingMs).toBe(remainingAtFirstTick - 60_000);
    expect(later.matchRemainingMs).toBe((first.matchRemainingMs ?? 0) - 60_000);
  });
});

describe("HelpDrawer.tsx -- ja/en smoke render", () => {
  for (const locale of ["ja", "en"] as const) {
    it(`renders without crashing, with locale-correct copy (${locale})`, () => {
      const html = renderToStaticMarkup(createElement(HelpDrawer, baseProps({ locale })));
      expect(html.length).toBeGreaterThan(0);
      expect(html).toContain("LEAK");
      expect(html).toContain("PROVE");
      expect(html).toContain("HUNT");
      expect(html).toContain("ROTATE");
      expect(html).toContain(locale === "ja" ? "この Battle の遊び方" : "How this Battle works");
    });

    /**
     * [Issue #645] The Help Drawer is the Portal's COMPLETE rules reference —
     * the statement points at it for the full detail. Adding FHE and MPC to
     * the live method set without updating it left a participant who opened
     * help after receiving one of those Orders reading an obsolete ruleset
     * that said there were four moves.
     *
     * Driven off `ALL_SUBMISSION_METHODS` rather than a hardcoded list, so a
     * fifth method fails here instead of silently going undocumented.
     */
    it(`documents every submission method the game accepts (${locale})`, () => {
      const html = renderToStaticMarkup(createElement(HelpDrawer, baseProps({ locale })));
      for (const method of ALL_SUBMISSION_METHODS) {
        expect(html).toContain(method.toUpperCase());
      }
      // And no longer claims a fixed count that the method set can outgrow.
      expect(html).not.toContain("The 4 moves");
      expect(html).not.toContain("4 つの操作");
    });
  }

  /**
   * [Issue #709] The snippet's PROVE half is the relabelling written for a
   * machine; its HUNT half is Lagrange interpolation. Both are executed here
   * from the constants the snippet prints, so a participant who checks their
   * hand work against it is checking against the rule the judge applies.
   */
  it("the PROVE snippet's relabelling, executed, is a relabelling the judge would accept", async () => {
    const { applyPermutation, isValidSolution, permutationBetween } = await import("./sudoku.ts");
    // The constants the snippet opens with, read from the snippet itself so
    // a change to one that is not made in the other fails here.
    expect(PYTHON_SNIPPET).toContain("table = {1: 3, 2: 1, 3: 4, 4: 2}");
    const solution = [1, 2, 3, 4, 3, 4, 1, 2, 2, 1, 4, 3, 4, 3, 2, 1];
    expect(PYTHON_SNIPPET).toContain("solution = [1, 2, 3, 4,");
    const table = [3, 1, 4, 2];
    const grid = applyPermutation(solution, table);
    expect(isValidSolution(solution)).toBe(true);
    expect(isValidSolution(grid)).toBe(true);
    expect(permutationBetween(solution, grid)).toEqual(table);
    // And it says the thing the HUNT rests on.
    expect(PYTHON_SNIPPET).toContain("Never the same one twice");
  });

  it("the HUNT snippet's field is the match's, and its interpolation agrees with shamir.ts", () => {
    const match = PYTHON_SNIPPET.match(/^P = (\d+)/m);
    if (!match) throw new Error("PYTHON_SNIPPET: expected a `P = ...` line");
    expect(match[1]).toBe(DEFAULT_CONFIG.prime);
    // The snippet's reconstruct, transcribed: three shares of f(x) = 7 + 2x + 5x^2 mod 97.
    const P = BigInt(DEFAULT_CONFIG.prime);
    const f = (x: bigint) => (7n + 2n * x + 5n * x * x) % P;
    const shares = [1n, 2n, 3n].map((x) => ({ index: Number(x), value: f(x) }));
    const modP = (v: bigint) => ((v % P) + P) % P;
    let total = 0n;
    for (const { index: xi, value: yi } of shares) {
      let num = 1n;
      let den = 1n;
      for (const { index: xj } of shares) {
        if (xj !== xi) {
          num = modP(num * -BigInt(xj));
          den = modP(den * BigInt(xi - xj));
        }
      }
      // pow(den, P - 2, P)
      let inv = 1n;
      let base = modP(den);
      let e = P - 2n;
      while (e > 0n) {
        if (e & 1n) inv = modP(inv * base);
        base = modP(base * base);
        e >>= 1n;
      }
      total = modP(total + yi * num * inv);
    }
    expect(total).toBe(7n);
    expect(reconstruct(shares, P)).toBe(7n);
  });

  it("does not contradict four-hole work, distinct-share counting or the teaching-model boundary", () => {
    for (const locale of ["ja", "en"] as const) {
      const html = renderToStaticMarkup(createElement(HelpDrawer, baseProps({ locale })));
      for (const stale of ["これがゲームの全部", "3 回やったら殺される", "nothing is simulated", "applied to sixteen cells", "4 つの対応表を 16 マス"])
        expect(html).not.toContain(stale);
      expect(html).toContain(locale === "ja" ? "#1・#2・#1 は 2 個分" : "#1, #2, #1 count as two");
      expect(html).toContain(locale === "ja" ? "4 マス" : "four sudoku holes");
      expect(html).toContain(locale === "ja" ? "じゃんけんのお題は続きます" : "Rock-paper-scissors Orders continue");
    }
  });

  it("the snippet no longer asks for code the move does not need", () => {
    // [Issue #713 completion check, taken early] The participant path must
    // not say a program is required for PROVE.
    expect(PYTHON_SNIPPET).toContain("No code needed");
    expect(PYTHON_SNIPPET).not.toContain("pow(g, r, p)");
  });
});

describe("RegistrationPanel.tsx -- ja/en smoke render + fail-closed", () => {
  for (const locale of ["ja", "en"] as const) {
    it(`renders without crashing and is fail-closed without a coordinationClient (${locale})`, () => {
      const html = renderToStaticMarkup(createElement(RegistrationPanel, baseProps({ locale })));
      expect(html.length).toBeGreaterThan(0);
      expect(html).not.toContain("ROTATE する");
      expect(html).toContain(locale === "ja" ? "coordination が未配線" : "Coordination is not wired up");
    });

    it(`renders the 4 move forms without crashing when a coordinationClient IS present (${locale})`, () => {
      const html = renderToStaticMarkup(
        createElement(RegistrationPanel, baseProps({ locale, coordinationClient: okClient() })),
      );
      expect(html.length).toBeGreaterThan(0);
      expect(html).toContain("LEAK");
      expect(html).toContain("PROVE");
      expect(html).toContain("HUNT");
      expect(html).toContain("ROTATE");
      // The PROVE form's "we never compute this for you" note is
      // locale-correct.
      expect(html).toContain(locale === "ja" ? "この form が代わりに proof を計算する" : "This form never computes a proof");
    });
  }
});

describe("RegistrationPanel.tsx submit* helpers build the correct CryptoBattleOp shape", () => {
  it("submitLeak sends { kind: 'leak', contractId }", async () => {
    const { client, calls } = capturingClient();
    const outcome = await submitLeak(client, "blue-c0");
    expect(outcome.kind).toBe("ok");
    expect(calls).toEqual([{ kind: "leak", contractId: "blue-c0" }]);
  });

  it("submitProveSudoku sends { kind: 'prove-sudoku', contractId, grid }", async () => {
    // [Issue #709] One op: the judge holds the solution and checks the whole
    // grid, so there is no challenge to wait for.
    const { client, calls } = capturingClient();
    const grid = [3, 1, 4, 2, 4, 2, 3, 1, 1, 3, 2, 4, 2, 4, 1, 3];
    await submitProveSudoku(client, "blue-c1", grid);
    expect(calls).toEqual([{ kind: "prove-sudoku", contractId: "blue-c1", grid }]);
  });

  it("submitHuntSudoku sends { kind: 'hunt-sudoku', targetTeamId, generation, solution }", async () => {
    const { client, calls } = capturingClient();
    const solution = [1, 2, 3, 4, 3, 4, 1, 2, 2, 1, 4, 3, 4, 3, 2, 1];
    await submitHuntSudoku(client, "red", 2, solution);
    expect(calls).toEqual([{ kind: "hunt-sudoku", targetTeamId: "red", generation: 2, solution }]);
  });

  it("submitHunt sends { kind: 'hunt', targetTeamId, generation, recoveredSecret }", async () => {
    const { client, calls } = capturingClient();
    await submitHunt(client, "red", 2, "999999999999");
    expect(calls).toEqual([
      { kind: "hunt", targetTeamId: "red", generation: 2, recoveredSecret: "999999999999" },
    ]);
  });

  it("submitRotate sends a bare { kind: 'rotate' }", async () => {
    const { client, calls } = capturingClient();
    await submitRotate(client);
    expect(calls).toEqual([{ kind: "rotate" }]);
  });

  it("surfaces a rejected outcome's error string verbatim (no reshaping)", async () => {
    const { client } = capturingClient({ kind: "rejected", error: 'contract "x" is completed, not open' });
    const outcome = await submitLeak(client, "x");
    expect(outcome).toEqual({ kind: "rejected", error: 'contract "x" is completed, not open' });
  });
});

describe("RegistrationPanel.tsx describeOutcome -- localized display text for every outcome kind [Issue #486 PR4 review, medium #1]", () => {
  for (const locale of ["ja", "en"] as const) {
    const copy = REGISTRATION_COPY[locale];

    it(`shows the localized success message for "ok", not the literal string "ok" (${locale})`, () => {
      expect(describeOutcome({ kind: "ok", projection: {} }, copy)).toBe(copy.submitted);
      expect(describeOutcome({ kind: "ok", projection: {} }, copy)).not.toBe("ok");
    });

    it(`prefixes a rejected outcome's error with the localized "rejected" label (${locale})`, () => {
      expect(describeOutcome({ kind: "rejected", error: "boom" }, copy)).toBe(`${copy.rejectedPrefix}boom`);
    });

    it(`maps every infra-side outcome to the same localized retry message, distinct from "rejected" (${locale})`, () => {
      for (const kind of ["unavailable", "conflict", "unauthorized"] as const) {
        expect(describeOutcome({ kind }, copy)).toBe(copy.infraIssue);
      }
      expect(copy.infraIssue).not.toBe(copy.rejectedPrefix);
    });

    it(`maps "not_configured" to the localized fail-closed message (${locale})`, () => {
      expect(describeOutcome({ kind: "not_configured" }, copy)).toBe(copy.notConfiguredResult);
    });
  }
});

describe("the advanced forms only offer Orders their own method can fulfil [Issue #645]", () => {
  /**
   * `CoreRegistrationPanel` used to hand every open Order to both LeakForm and
   * ProveForm. With only LEAK and PROVE in the world that was harmless -- one
   * of the two always applied. Adding FHE and MPC made it a selector full of
   * moves the judge is certain to refuse.
   */
  const orders: ContractProjection[] = [
    {
      id: "free", kind: "standard", points: 10, leakPoints: 10,
      task: { kind: "reveal-share", shareIndices: [0] },
      privacyConstraint: "none", allowedMethods: ["leak", "prove"],
      status: "open", remainingMs: 60_000,
      hints: [],
    },
    {
      id: "prove-only", kind: "standard", points: 10, leakPoints: 10,
      task: { kind: "reveal-share", shareIndices: [1] },
      privacyConstraint: "no-raw-disclosure", allowedMethods: ["prove"],
      status: "open", remainingMs: 60_000,
      hints: [],
    },
    {
      id: "fhe", kind: "standard", points: 10, leakPoints: 10,
      task: { kind: "homomorphic-sum", inputs: [{ r: "1", y: "2" }, { r: "3", y: "4" }] },
      privacyConstraint: "no-raw-disclosure", allowedMethods: ["fhe"],
      status: "open", remainingMs: 60_000,
      hints: [],
    },
    {
      id: "mpc", kind: "standard", points: 10, leakPoints: 10,
      task: { kind: "masked-total", partyCount: 3, myInput: "5", incomingMasks: ["1", "2"], outgoingMasks: ["3", "4"] },
      privacyConstraint: "no-raw-disclosure", allowedMethods: ["mpc"],
      status: "open", remainingMs: 60_000,
      hints: [],
    },
  ];

  it("offers LEAK only the Order whose rule permits it", () => {
    expect(contractsForMethod(orders, "leak").map((c) => c.id)).toEqual(["free"]);
  });

  it("offers PROVE both share Orders and neither compute Order", () => {
    expect(contractsForMethod(orders, "prove").map((c) => c.id)).toEqual(["free", "prove-only"]);
  });

  it("never offers a form an Order its method cannot perform", () => {
    for (const method of ["leak", "prove"] as const) {
      for (const order of contractsForMethod(orders, method)) {
        expect(order.allowedMethods).toContain(method);
        expect(order.task.kind).toBe("reveal-share");
      }
    }
  });
});

describe("the sudoku-HUNT card offers candidates without judging exploitability [Issue #709]", () => {
  const reveal = (teamId: string, generation: number, contractId: string, tag: string, group = 0) =>
    ({
      id: `${contractId}-sudoku`, teamId, generation, kind: "sudoku-reveal" as const,
      method: "prove" as const, contractId, group, cells: [1, 2, 3, 4], tag, postedAtMs: 1,
    });

  const projectionWith = (
    ledger: readonly PublicArtifact[],
    redGeneration: number,
  ): CryptoBattleProjection =>
    fixtureProjection({
      publicLedger: ledger,
      teams: {
        blue: { teamId: "blue", teamName: "blue", score: 0, generation: 1, huntedGenerationCount: 0 },
        red: {
          teamId: "red",
          teamName: "red",
          score: 0,
          generation: redGeneration,
          huntedGenerationCount: 0,
        },
      },
    });

  /**
   * The load-bearing pair. The nonce-reuse card this replaces once listed a
   * team only once two rows shared a commitment — so the card changed the
   * moment the reuse appeared, and the Portal was announcing the pattern the
   * participant is supposed to spot. These two assert the card looks the SAME
   * either way: the tags are shown, the reading stays the participant's.
   */
  it("offers a team that has PROVEd, whether or not a tag repeats", () => {
    const reused = sudokuHuntCandidates(
      projectionWith([reveal("red", 1, "red-c0", "aa", 0), reveal("red", 1, "red-c1", "aa", 5)], 1),
    );
    const distinct = sudokuHuntCandidates(
      projectionWith([reveal("red", 1, "red-c0", "aa", 0), reveal("red", 1, "red-c1", "bb", 5)], 1),
    );
    expect(reused.map((c) => [c.teamId, c.generation, c.reveals.length])).toEqual([["red", 1, 2]]);
    expect(distinct.map((c) => [c.teamId, c.generation, c.reveals.length])).toEqual([["red", 1, 2]]);
    // Every reveal is carried, tag and all: the match is the reader's to spot.
    expect(reused[0]?.reveals.map((r) => r.tag)).toEqual(["aa", "aa"]);
    expect(distinct[0]?.reveals.map((r) => r.tag)).toEqual(["aa", "bb"]);
    // And the public puzzle rides along, because that is what the reveals
    // are lined up against.
    expect(reused[0]?.puzzle).toEqual(fixtureProjection().publicPuzzles.red ?? []);
  });

  it("offers a team with a single reveal, which cannot be hunted at all", () => {
    // Precisely the case an exploitability-computing list would hide, and
    // hiding it is what would leak the verdict.
    expect(sudokuHuntCandidates(projectionWith([reveal("red", 1, "red-c0", "aa")], 1)).map((c) => c.teamId)).toEqual(["red"]);
  });

  it("names each team's current generation, so a stale target cannot be offered", () => {
    // The victim rotated after those rows were written: nothing to offer at
    // generation 2, and nothing stale offered either.
    expect(
      sudokuHuntCandidates(
        projectionWith([reveal("red", 1, "red-c0", "aa"), reveal("red", 1, "red-c1", "aa")], 2),
      ),
    ).toEqual([]);
  });

  it("never offers your own team", () => {
    expect(
      sudokuHuntCandidates(
        projectionWith([reveal("blue", 1, "blue-c0", "aa"), reveal("blue", 1, "blue-c1", "aa")], 1),
      ),
    ).toEqual([]);
  });

  it("offers nothing when no other team has PROVEd", () => {
    expect(sudokuHuntCandidates(projectionWith([], 1))).toEqual([]);
  });
});

describe("advanced tactics use progressive disclosure", () => {
  const share = (teamId: string, generation: number): PublicArtifact => ({
    id: `${teamId}-${generation}-share`,
    teamId,
    generation,
    kind: "share",
    method: "leak",
    shareIndex: 1,
    value: "7",
    contractId: `${teamId}-c1`,
    postedAtMs: 1,
  });
  const proof = (teamId: string, generation: number): PublicArtifact => ({
    id: `${teamId}-${generation}-sudoku`,
    teamId,
    generation,
    kind: "sudoku-reveal",
    method: "prove",
    contractId: `${teamId}-c2`,
    group: 0,
    cells: [1, 2, 3, 4],
    tag: "ff00ff00ff00",
    postedAtMs: 2,
  });

  /**
   * [Issue #682] The lane exists to be watched while nothing is happening yet,
   * so its tests are mostly about the boring states: everyone at zero, a rival
   * climbing, a team that escaped by rotating.
   */
  describe("exposure lane", () => {
    // Built out rather than spread over `share()`: that helper's return type is
    // the PublicArtifact union, and overriding `shareIndex` through a spread
    // asks TypeScript to accept the field on every arm of it.
    const shareAt = (teamId: string, generation: number, shareIndex: number): PublicArtifact => ({
      id: `${teamId}-${generation}-${shareIndex}`,
      teamId,
      generation,
      kind: "share",
      method: "leak",
      shareIndex,
      value: "7",
      contractId: `${teamId}-c1`,
      postedAtMs: 1,
    });

    /**
     * [Issue #3172] The lane names its rows. `teamId` is a ULID, so before this
     * an opponent showed as `01M1J5VK3N6KX5G3MYW190S9Q8` — a danger meter whose
     * rows were 26 random characters.
     */
    it("shows each team's display name, falling back to the id", () => {
      const named = exposureRows(
        fixtureProjection({
          publicLedger: [],
          teams: {
            blue: {
              teamId: "blue",
              teamName: "かけら隊",
              score: 0,
              generation: 1,
              huntedGenerationCount: 0,
            },
            // A platform that could not resolve a name leaves the id, and the
            // lane shows that rather than an empty cell.
            red: { teamId: "red", teamName: "red", score: 0, generation: 1, huntedGenerationCount: 0 },
          },
        }),
      );
      expect(named.map((r) => r.teamName)).toEqual(["かけら隊", "red"]);
    });

    /**
     * [Issue #698] The same complaint as the exposure lane's, one panel over.
     * The Public Ledger exists to answer "who exposed this", and it answered
     * with a 26-character ULID -- for the reader's OWN team as well, which is
     * what the live run screenshotted. The two surfaces sit on one screen, so
     * they name a team the same way.
     */
    it("names each team on the Public Ledger, and calls the reader's own row 'you'", () => {
      const ledger = (teamId: string, shareIndex: number): PublicArtifact => ({
        id: `${teamId}-a${shareIndex}`,
        kind: "share",
        teamId,
        contractId: `${teamId}-c0`,
        generation: 1,
        method: "leak",
        postedAtMs: 0,
        shareIndex,
        value: "7",
      });
      const html = renderToStaticMarkup(
        createElement(GameBoardBody, {
          projection: fixtureProjection({
            publicLedger: [ledger("blue", 1), ledger("red", 2)],
            teams: {
              blue: { teamId: "blue", teamName: "blue", score: 0, generation: 1, huntedGenerationCount: 0 },
              red: { teamId: "red", teamName: "かけら隊", score: 0, generation: 1, huntedGenerationCount: 0 },
            },
          }),
          locale: "ja",
        }),
      );
      const titles = [...html.matchAll(/<strong>([^<]*)<\/strong>/g)].map(([, name]) => name);
      // `blue` is the vault owner in `fixtureProjection`, so its row is the
      // reader's own and says so rather than repeating a name back at them.
      expect(titles).toContain("あなた");
      expect(titles).toContain("かけら隊");
      expect(html).not.toContain(">blue<");
    });

    it("lists every team on a board where nothing has been published", () => {
      const rows = exposureRows(fixtureProjection({ publicLedger: [] }));
      expect(rows.map((r) => [r.teamId, r.exposed, r.huntable])).toEqual([
        ["blue", 0, false],
        ["red", 0, false],
      ]);
      expect(rows[0]?.isSelf).toBe(true);
    });

    it("counts a rival's distinct shares and flags the threshold", () => {
      const climbing = exposureRows(
        fixtureProjection({ publicLedger: [shareAt("red", 1, 1), shareAt("red", 1, 2)] }),
      );
      expect(climbing.find((r) => r.teamId === "red")).toMatchObject({
        exposed: 2,
        huntable: false,
        shareIndices: [1, 2],
      });
      const reached = exposureRows(
        fixtureProjection({
          publicLedger: [shareAt("red", 1, 1), shareAt("red", 1, 2), shareAt("red", 1, 3)],
        }),
      );
      expect(reached.find((r) => r.teamId === "red")).toMatchObject({ exposed: 3, huntable: true });
    });

    it("does not count the same share twice", () => {
      // Re-publishing index 1 is not progress toward the threshold, and a lane
      // that said otherwise would send a hunter after a secret it cannot solve.
      const rows = exposureRows(
        fixtureProjection({ publicLedger: [shareAt("red", 1, 1), shareAt("red", 1, 1)] }),
      );
      expect(rows.find((r) => r.teamId === "red")?.exposed).toBe(1);
    });

    it("forgets shares from a generation the team has left behind", () => {
      // ROTATE is the escape, so the lane has to show the escape working.
      const rows = exposureRows(
        fixtureProjection({
          publicLedger: [shareAt("red", 1, 1), shareAt("red", 1, 2), shareAt("red", 1, 3)],
          teams: {
            blue: { teamId: "blue", teamName: "blue", score: 30, generation: 1, huntedGenerationCount: 0 },
            red: { teamId: "red", teamName: "red", score: 20, generation: 2, huntedGenerationCount: 1 },
          },
        }),
      );
      expect(rows.find((r) => r.teamId === "red")).toMatchObject({ exposed: 0, huntable: false });
    });

    it("puts your own row first, then the teams closest to being hunted", () => {
      const rows = exposureRows(
        fixtureProjection({
          publicLedger: [shareAt("red", 1, 1), shareAt("red", 1, 2)],
          teams: {
            blue: { teamId: "blue", teamName: "blue", score: 0, generation: 1, huntedGenerationCount: 0 },
            green: { teamId: "green", teamName: "green", score: 0, generation: 1, huntedGenerationCount: 0 },
            red: { teamId: "red", teamName: "red", score: 0, generation: 1, huntedGenerationCount: 0 },
          },
        }),
      );
      expect(rows.map((r) => r.teamId)).toEqual(["blue", "red", "green"]);
    });

    it("reports your own exposure from the vault's generation", () => {
      const rows = exposureRows(
        fixtureProjection({ publicLedger: [shareAt("blue", 1, 4), shareAt("blue", 1, 5)] }),
      );
      expect(rows[0]).toMatchObject({ isSelf: true, exposed: 2, huntable: false });
    });
  });

  /**
   * [Issue #682] The countdown the owner reported as frozen. A projection is
   * only true at the instant it was fetched, and the battle surface polls every
   * 30 seconds, so without ageing every timer on it sits on one number for half
   * a minute and a lapsed Order stays on the belt at 0:00.
   */
  describe("ageProjection", () => {
    it("leaves a freshly fetched projection alone", () => {
      const p = fixtureProjection();
      expect(ageProjection(p, 0)).toBe(p);
      expect(ageProjection(p, -5)).toBe(p);
    });

    it("ages the match clock, every Order and the ROTATE cooldown together", () => {
      const p = fixtureProjection();
      const aged = ageProjection(p, 5_000);
      if (!aged || p.matchRemainingMs === undefined) throw new Error("fixture");
      expect(aged.matchRemainingMs).toBe(p.matchRemainingMs - 5_000);
      expect(aged.vault.rotateCooldownRemainingMs).toBe(
        Math.max(0, p.vault.rotateCooldownRemainingMs - 5_000),
      );
      for (const [i, order] of aged.myContracts.entries()) {
        const before = p.myContracts[i];
        if (!before) throw new Error("fixture");
        expect(order.remainingMs).toBe(Math.max(0, before.remainingMs - 5_000));
      }
    });

    it("floors at zero rather than counting into the negative", () => {
      const aged = ageProjection(fixtureProjection(), 10 * 60 * 60_000);
      expect(aged?.matchRemainingMs).toBe(0);
      expect(aged?.myContracts.every((o) => o.remainingMs === 0)).toBe(true);
    });

    it("keeps an unstarted match's undefined clock undefined", () => {
      // `matchRemainingMs` is undefined only before the first tick; subtracting
      // from it would render NaN as a countdown.
      const aged = ageProjection(fixtureProjection({ matchRemainingMs: undefined }), 5_000);
      expect(aged?.matchRemainingMs).toBeUndefined();
    });
  });

  it("keeps every advanced control off a fresh first screen", () => {
    expect(tacticAvailability(fixtureProjection({ publicLedger: [] }))).toEqual({
      hunt: false,
      sudokuHunt: false,
      cipherHunt: false,
      rpsHunt: false,
      rotate: false,
    });
  });

  it("reveals only tactics backed by the current projection", () => {
    expect(tacticAvailability(fixtureProjection({ publicLedger: [share("red", 1)] }))).toEqual({
      hunt: true,
      sudokuHunt: false,
      cipherHunt: false,
      rpsHunt: false,
      rotate: false,
    });
    expect(tacticAvailability(fixtureProjection({ publicLedger: [proof("red", 1)] }))).toEqual({
      hunt: false,
      sudokuHunt: true,
      cipherHunt: false,
      rpsHunt: false,
      rotate: false,
    });
    expect(tacticAvailability(fixtureProjection({ publicLedger: [share("blue", 1)] }))).toEqual({
      hunt: false,
      sudokuHunt: false,
      cipherHunt: false,
      rpsHunt: false,
      rotate: true,
    });
  });

  it("does not offer ROTATE for an old-generation leak", () => {
    expect(tacticAvailability(fixtureProjection({ publicLedger: [share("blue", 0)] })).rotate).toBe(false);
  });
});

describe("the game board ties each method to the Order that accepts it [Issue #645]", () => {
  /**
   * This board got it wrong twice before this shape.
   *
   * First a hardcoded LEAK / OR / PROVE row, which named methods an FHE Order
   * rejects — and `StatusPanel` renders this board first, so that was the
   * participant's first instruction.
   *
   * Then the union of every open Order's methods. Orders are issued every
   * `contractIntervalMs` (2 min) and live `contractTtlMs` (5 min), so up to
   * three overlap and the deterministic task cycle puts a share Order beside
   * an FHE one routinely. The row then read "LEAK OR PROVE OR FHE" — three
   * methods presented as interchangeable when each belongs to a different
   * card.
   *
   * A method list is only ever true of ONE Order. These tests pin that it is
   * rendered there and nowhere else.
   */
  const order = (
    id: string,
    task: ContractProjection["task"],
    allowedMethods: ContractProjection["allowedMethods"],
  ): ContractProjection => ({
    id, kind: "standard", points: 10, leakPoints: 10, task,
    privacyConstraint: allowedMethods.includes("leak") ? "none" : "no-raw-disclosure",
    allowedMethods, status: "open", remainingMs: 60_000,
    hints: [],
  });

  const SHARE = order("s", { kind: "reveal-share", shareIndices: [0] }, ["leak", "prove"]);
  const FHE = order(
    "f",
    { kind: "homomorphic-sum", inputs: [{ r: "1", y: "2" }, { r: "3", y: "4" }] },
    ["fhe"],
  );
  const MPC = order(
    "m",
    {
      kind: "masked-total", partyCount: 3,
      myInput: "5", incomingMasks: ["1", "2"], outgoingMasks: ["3", "4"],
    },
    ["mpc"],
  );

  const render = (myContracts: readonly ContractProjection[]): string =>
    renderToStaticMarkup(
      createElement(GameBoardBody, { projection: fixtureProjection({ myContracts }), locale: "en" }),
    );

  /** Method chips, in render order, matched by class rather than by the words. */
  const chips = (html: string): string[] =>
    [...html.matchAll(/tc-method tc-method-(\w+)/g)].map(([, method]) => method ?? "");

  it("shows a share Order's two methods on its own card", () => {
    expect(chips(render([SHARE]))).toEqual(["leak", "prove"]);
  });

  /**
   * [Issue #659] Computing an Order and passing on it pay different amounts,
   * and the gap between them is the decision the Order exists to ask. A card
   * that shows only the higher number reveals the trade in the confirmation --
   * after it has already been made.
   */
  it("shows BOTH rates on an Order a team is allowed to pass on", () => {
    const priced: ContractProjection = { ...SHARE, points: 30, leakPoints: 10 };
    const html = render([priced]);
    expect(html).toContain("+30");
    expect(html).toContain("+10");
  });

  it("quotes no pass rate on an Order that cannot be passed on", () => {
    // A `no-raw-disclosure` Order has no LEAK route at all. Printing a price
    // next to a move that will be rejected is worse than printing nothing.
    const priced: ContractProjection = { ...FHE, points: 30, leakPoints: 10 };
    const html = render([priced]);
    expect(html).toContain("+30");
    expect(html).not.toContain("+10");
  });

  it("shows FHE alone for an FHE Order", () => {
    expect(chips(render([FHE]))).toEqual(["fhe"]);
  });

  /**
   * The case that broke the union version: two Orders open at once whose
   * methods are NOT interchangeable. Each card carries its own, and no
   * combined claim is made anywhere.
   */
  it("keeps each Order's methods on its own card when several are open", () => {
    expect(chips(render([SHARE, FHE, MPC]))).toEqual(["leak", "prove", "fhe", "mpc"]);
  });

  it("makes no method claim at all when nothing is open", () => {
    expect(chips(render([]))).toEqual([]);
  });

  it("no longer renders a board-level choice row", () => {
    // The row is gone rather than corrected: any statement it could make is
    // either tied to one Order (so it belongs on that card) or false.
    const html = render([SHARE, FHE]);
    expect(html).not.toContain("crypto-battle-primary-choice");
    expect(html).not.toContain("tc-choice-arrow");
  });
});

describe("the MPC ledger row describes an addition that actually reproduces [Issue #645]", () => {
  /**
   * `total` is the three partials summed and then reduced mod p, and three
   * field elements almost always add to more than p. Rendering that as a plain
   * `a + b + c = total` was therefore FALSE in the common case — and false in
   * the worst direction, because the row exists precisely to invite a hand
   * check, and that check would not come out.
   */
  const P = BigInt(DEFAULT_CONFIG.prime);
  const partials = [P - 5n, P - 7n, 9n];
  const total = partials.reduce((acc, v) => (acc + v) % P, 0n);

  const artifact = {
    id: "teamA-c3-partial",
    teamId: "teamA",
    generation: 1,
    kind: "partial" as const,
    method: "mpc" as const,
    contractId: "teamA-c3",
    partial: partials[0]?.toString() ?? "",
    peerPartials: [partials[1]?.toString() ?? "", partials[2]?.toString() ?? ""],
    total: total.toString(),
    postedAtMs: 1,
  };

  it("uses a fixture whose plain sum really does exceed the modulus", () => {
    // Otherwise the test would pass against the unqualified `=` too.
    expect(partials.reduce((acc, v) => acc + v, 0n) > P).toBe(true);
  });

  for (const locale of ["ja", "en"] as const) {
    it(`states the remainder rather than a bare equality (${locale})`, () => {
      const rendered = ledgerPayload(artifact, locale);
      for (const value of [...partials.map(String), total.toString()]) {
        expect(rendered).toContain(value);
      }
      expect(rendered).toContain(locale === "ja" ? "余り" : "remainder");
      // And the numbers on the row are self-consistent under that operation.
      const shown = rendered.match(/\d+/g)?.map(BigInt) ?? [];
      const [a, b, c, shownTotal] = shown;
      if (a === undefined || b === undefined || c === undefined || shownTotal === undefined) {
        throw new Error("expected four numbers on the row");
      }
      expect((a + b + c) % P).toBe(shownTotal);
    });
  }
});

/**
 * [Issue #659] ROTATE voids every Order still open, and each one now costs what
 * letting it expire costs -- up to a whole batch. That is a bigger surprise
 * than the LEAK rate the board already discloses, and it lands at the worst
 * moment: a team rotates because it is under attack. The panel states the price
 * before the button is pressed, counting the Orders actually at stake rather
 * than quoting a rule.
 */
describe("the ROTATE control says what rotating will cost", () => {
  const openOrder = (id: string): ContractProjection => ({
    id, kind: "standard", points: 30, leakPoints: 10,
    task: { kind: "reveal-share", shareIndices: [0] },
    privacyConstraint: "none", allowedMethods: ["leak", "prove"],
    status: "open", remainingMs: 60_000,
    hints: [],
  });

  it("counts every Order a rotate would void", () => {
    const projection = fixtureProjection({ myContracts: [openOrder("a"), openOrder("b")] });
    expect(rotateVoidCount(projection)).toBe(2);
  });

  it("counts nothing once the batch is resolved, because rotating is then free", () => {
    const resolved: ContractProjection = { ...openOrder("a"), status: "completed" };
    expect(rotateVoidCount(fixtureProjection({ myContracts: [resolved] }))).toBe(0);
    expect(rotateVoidCount(fixtureProjection({ myContracts: [] }))).toBe(0);
  });

  it("says nothing at all when there is no projection yet", () => {
    expect(rotateVoidCount(null)).toBe(0);
  });
});

/**
 * [Issue #659 §2] The ladder HUNT has to be OFFERED, and offered only when it
 * is real.
 *
 * #645 Phase 5 shipped `hunt-nonce` with no participant-facing sender at all:
 * the reducer accepted it, the README advertised it, and nothing in the Portal
 * could produce one. This is the same class of gap for the ladder, so it is
 * pinned the same way.
 *
 * "Real" is the rung's own threshold. A team below it is not broken, and
 * listing it would turn 「相手の段を見て狩る価値があるか判断する」 into a list of
 * everyone -- which is exactly the judgement the ladder exists to create.
 */
describe("the ladder HUNT is offered only against teams that are actually broken", () => {
  const pair = (teamId: string, generation: number, id: string): PublicArtifact => ({
    id,
    teamId,
    generation,
    kind: "cipher-pair",
    method: "leak",
    contractId: `${teamId}-c1`,
    rung: "caesar",
    // Symbol VALUES, not pictures: the ledger stores values and the edge
    // renders them through the rung's alphabet (see `CipherPairArtifact`).
    plaintext: [0, 1],
    ciphertext: [2, 3],
    postedAtMs: 1,
  });

  it("offers a team that has published enough pairs to give its key away", () => {
    const candidates = cipherHuntCandidates(
      fixtureProjection({ publicLedger: [pair("red", 1, "p1")] }),
    );
    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.teamId).toBe("red");
    expect(candidates[0]?.pairs).toHaveLength(1);
  });

  it("offers a team only once its pairs reach the rung's own threshold", () => {
    // The threshold is a constant of the RUNG (`rungSpec(rung).pairsToBreak`),
    // not of the artifact, so a fixture cannot dial it down to build a
    // not-yet-broken case. With Caesar the only rung shipped and its threshold
    // at 1, every published pair IS a break -- so what is checkable today is
    // the invariant itself, which holds for whatever rung comes next.
    const ledgers = [[], [pair("red", 1, "p1")], [pair("red", 1, "p1"), pair("red", 1, "p2")]];
    for (const publicLedger of ledgers) {
      for (const candidate of cipherHuntCandidates(fixtureProjection({ publicLedger }))) {
        expect(candidate.pairs.length).toBeGreaterThanOrEqual(candidate.pairsToBreak);
        expect(candidate.pairsToBreak).toBe(rungSpec(candidate.rung).pairsToBreak);
      }
    }
    // A team that has published nothing is never a target.
    expect(cipherHuntCandidates(fixtureProjection({ publicLedger: [] }))).toEqual([]);
  });

  it("never offers your own team, and never a retired generation", () => {
    // Hunting yourself is refused by the reducer; offering it would be offering
    // a move that cannot be made.
    const own = fixtureProjection({ publicLedger: [pair("blue", 1, "p1")] });
    expect(own.vault.teamId).toBe("blue");
    expect(cipherHuntCandidates(own)).toEqual([]);
    // A pair from an older generation groups separately, so a ROTATEd target
    // cannot be hunted with stale material through this control.
    const stale = cipherHuntCandidates(
      fixtureProjection({ publicLedger: [pair("red", 1, "p1"), pair("red", 2, "p2")] }),
    );
    expect(stale.map((c) => c.generation).sort()).toEqual([1, 2]);
  });

  it("says nothing at all when there is no projection yet", () => {
    expect(cipherHuntCandidates(null)).toEqual([]);
  });
});

/**
 * [Issue #659] The LEAK / PROVE action area is gated on what the Order ACCEPTS,
 * not on which task it is.
 *
 * Those were the same thing while `reveal-share` was the only Order that took
 * LEAK. The ladder Order takes it too, and a `task.kind === "reveal-share"`
 * test hid the button on the one Order whose entire point is the choice between
 * computing it and passing on it -- the card advertised LEAK, the working panel
 * warned what LEAKing would cost, and there was nothing to press. Found by
 * playing the harness, which is why it is pinned here.
 */
describe("the primary actions follow what the Order accepts", () => {
  const order = (
    kind: ContractProjection["task"]["kind"],
    allowedMethods: ContractProjection["allowedMethods"],
  ): ContractProjection => ({
    id: "o",
    kind: "standard",
    points: 30,
    leakPoints: 10,
    task:
      kind === "caesar-shift"
        ? { kind: "caesar-shift", rung: "caesar", plaintext: [0], symbols: ["⚀", "⚁"], pairsToBreak: 1, myKey: 1 }
        : { kind: "reveal-share", shareIndices: [0] },
    privacyConstraint: allowedMethods.includes("leak") ? "none" : "no-raw-disclosure",
    allowedMethods,
    status: "open",
    remainingMs: 60_000,
    hints: [],
  });

  it("shows the area for a ladder Order, because a ladder Order can be LEAKed", () => {
    const actions = primaryActionsFor(order("caesar-shift", ["leak", "cipher"]));
    expect(actions.visible).toBe(true);
    expect(actions.leakAllowed).toBe(true);
    // PROVE cannot serve a ladder Order, so it is offered-and-disabled rather
    // than silently absent.
    expect(actions.proveAllowed).toBe(false);
  });

  it("still shows both for a share Order", () => {
    const actions = primaryActionsFor(order("reveal-share", ["leak", "prove"]));
    expect(actions).toEqual({ visible: true, leakAllowed: true, proveAllowed: true });
  });

  it("hides the area entirely for an Order neither method can serve", () => {
    // An FHE Order takes neither, and its own panel is the whole interface for
    // it -- two permanently-dead buttons above it would be noise.
    expect(primaryActionsFor(order("reveal-share", ["fhe"])).visible).toBe(false);
  });

  it("shows the area before any Order is picked, so the panel does not jump", () => {
    expect(primaryActionsFor(undefined).visible).toBe(true);
  });
});

/**
 * [Issue #659] What the board is FOR, once there is more than one Order on it.
 *
 * From a real screenshot of a live match: six cards that looked alike, in issue
 * order, with the score as a 12px chip in a row of three identical chips. The
 * operator's words were 「ボードが小さくてよくわからない。ついでに何をみればいい
 * のかよくわからない」 — which is a layout problem, not a data problem: every
 * number was on screen and none of them answered "what do I do now".
 */
describe("the board answers what to do next", () => {
  const order = (id: string, remainingMs: number): ContractProjection => ({
    id,
    kind: "standard",
    points: 30,
    leakPoints: 10,
    task: { kind: "reveal-share", shareIndices: [0] },
    privacyConstraint: "none",
    allowedMethods: ["leak", "prove"],
    status: "open",
    remainingMs,
    hints: [],
  });

  const render = (myContracts: readonly ContractProjection[]): string =>
    renderToStaticMarkup(
      createElement(GameBoardBody, { projection: fixtureProjection({ myContracts }), locale: "en" }),
    );

  it("puts the soonest deadline first, whatever order the Orders arrived in", () => {
    // Issue order is arbitrary with respect to urgency: a rush Order issued
    // last can be the one about to lapse.
    const html = render([order("t-c0", 240_000), order("t-c1", 30_000), order("t-c2", 120_000)]);
    const seen = [...html.matchAll(/ORDER #(\d)/g)].map(([, n]) => n);
    expect(seen).toEqual(["1", "2", "0"]);
  });

  it("names the one that is due first", () => {
    const html = render([order("t-c0", 240_000), order("t-c1", 30_000)]);
    expect(html).toContain("DUE FIRST");
    // Exactly one CARD carries it — marking several would be marking none.
    // Counted on the class attribute, not the whole document: the stylesheet
    // this component injects also contains the selector.
    expect(html.match(/class="tc-order-card[^"]*tc-order-next/g)).toHaveLength(1);
  });

  it("shows the score as the largest thing on the board", () => {
    // It was a chip indistinguishable from "phase" and "time left"; it is the
    // number that changes when you play.
    const html = render([order("t-c0", 240_000)]);
    expect(html).toContain("tc-scoreline-value");
    expect(html).toContain("tc-scoreline-hint");
  });

  it("keeps the vault out of the way until it is asked for", () => {
    // Five 19-digit numbers took a third of the board and matter only while
    // building a PROVE. The generation stays visible because ROTATE moves it.
    const html = render([order("t-c0", 240_000)]);
    expect(html).toContain("tc-vault-details");
    expect(html).not.toMatch(/<details class="tc-vault-details"[^>]*\sopen/);
  });
});

/**
 * [Issue #659] The Battle's actual goal: a player leaves understanding secure
 * computation, homomorphic encryption and zero-knowledge proofs — the
 * primitives blockchains are built on.
 *
 * They already performed all three. An FHE Order IS homomorphic addition, an
 * MPC Order IS secure multi-party computation, a PROVE IS a zero-knowledge
 * proof. But the words appeared ZERO times anywhere a participant could see,
 * and the only mention of blockchain was a disclaimer saying a Contract is NOT
 * one — so a player could finish the match having done all three and be unable
 * to name any of them.
 */
describe("the help drawer names what the player is learning", () => {
  for (const locale of ["ja", "en"] as const) {
    it(`names all three modern primitives (${locale})`, () => {
      const html = renderToStaticMarkup(createElement(HelpDrawer, baseProps({ locale })));
      const expected =
        locale === "ja"
          ? ["準同型暗号", "秘密計算", "ゼロ知識証明"]
          : ["Homomorphic encryption", "Secure computation", "Zero-knowledge proofs"];
      for (const term of expected) expect(html).toContain(term);
    });

    it(`explains the use case and the trusted-judge boundary (${locale})`, () => {
      // Teach concrete uses and the model boundary without claiming that
      // every mechanism here is a full production cryptographic protocol.
      const html = renderToStaticMarkup(createElement(HelpDrawer, baseProps({ locale })));
      expect(html).toContain(locale === "ja" ? "合計を求めたい" : "company total");
      expect(html).toContain(locale === "ja" ? "審判を信頼するモデル" : "trusted-judge teaching model");
    });

    it(`frames the historical cipher as the way in, not the destination (${locale})`, () => {
      const html = renderToStaticMarkup(createElement(HelpDrawer, baseProps({ locale })));
      expect(html).toContain(locale === "ja" ? "シーザー" : "Caesar");
    });
  }
});

/**
 * [Issue #659] Each Order teaches three things: what it is used for, why the
 * trick works, and what to actually do. The operator's constraint was that the
 * text stay short — 「文章は少なくしないと楽しめない」 — so it is three labelled
 * lines, not a paragraph.
 *
 * The procedure alone was what shipped before, which meant a player could
 * complete a homomorphic addition without ever learning that adding ciphertexts
 * is supposed to work, let alone why.
 */
describe("each Order carries its use, its mechanism, and its procedure", () => {
  it("explains the FHE input-specific hiding totals instead of a shared-key identity", () => {
    const copy = FAST_MOVE_COPY.ja;
    expect(copy.fheUse).toContain("つかいみち");
    // Each input has a different key; the old Enc(a+b) wording taught a
    // shared-key identity that this scheme does not implement.
    expect(copy.fheWhy).toContain("中身の合計 + 隠す数の合計");
    expect(copy.fheWhy).toContain("各入力の鍵");
    expect(copy.fheWhy).not.toContain("Enc(a+b)");
    expect(FAST_MOVE_COPY.en.fheWhy).toContain("separate input keys");
    expect(copy.fheHelp).toContain("やること");
  });

  it("gives the MPC Order the cancellation that makes it work", () => {
    const copy = FAST_MOVE_COPY.ja;
    expect(copy.mpcUse).toContain("つかいみち");
    expect(copy.mpcWhy).toContain("覆面");
    expect(copy.mpcWhy).toContain("小計");
    expect(copy.mpcWhy).toContain("打ち消し合");
    expect(copy.mpcHelp).toContain("やること");
  });

  it("frames the ladder Order as the breakable one, and says why it breaks", () => {
    const copy = FAST_MOVE_COPY.ja;
    expect(copy.cipherUse).toContain("破れる");
    expect(copy.cipherWhy).toContain("鍵");
  });

  it("keeps each line short enough to be read mid-match", () => {
    // The constraint that makes this usable rather than a wall of text.
    const copy = FAST_MOVE_COPY.ja;
    for (const line of [copy.fheUse, copy.fheWhy, copy.mpcUse, copy.mpcWhy, copy.cipherUse, copy.cipherWhy]) {
      expect(line.length).toBeLessThan(70);
    }
  });

  it("names the blocked method correctly, per method", () => {
    // A ladder Order accepts LEAK and refuses PROVE. One shared string naming
    // LEAK told the reader LEAK was refused while the LEAK button sat enabled
    // beside it.
    const copy = FAST_MOVE_COPY.ja;
    expect(copy.leakBlocked).toContain("LEAK");
    expect(copy.proveBlocked).toContain("PROVE");
    expect(copy.leakBlocked).not.toEqual(copy.proveBlocked);
  });
});

/**
 * [Issue #659 §9] The hint control on the ticket.
 *
 * `renderToStaticMarkup` never runs the polling effect (see this file's
 * header), so the panel itself has no projection under test and what is pinned
 * here is the decision behind the control: which rung is offered next, and what
 * the button says it costs.
 */
describe("the hint control offers the next unopened rung, at its stated price", () => {
  const withHints = (hints: ContractProjection["hints"]): ContractProjection => ({
    id: "o",
    kind: "standard",
    points: 30,
    leakPoints: 10,
    task: { kind: "reveal-share", shareIndices: [0] },
    privacyConstraint: "none",
    allowedMethods: ["leak", "prove"],
    status: "open",
    remainingMs: 60_000,
    hints,
  });

  const rung = (level: number, cost: number, opened: boolean) => ({
    level,
    id: `reveal-share/${level + 1}`,
    cost,
    ...(opened ? { text: { ja: `ja-${level}`, en: `en-${level}` } } : {}),
  });

  it("offers the first rung when nothing is open", () => {
    const next = nextHintFor(withHints([rung(0, 2, false), rung(1, 4, false)]));
    expect(next?.level).toBe(0);
    expect(next?.cost).toBe(2);
  });

  it("offers the rung after the last one opened, never one already paid for", () => {
    // The failure this rules out is charging a team again for a hint they can
    // already read, which is what a Portal-side counter would eventually do.
    const next = nextHintFor(withHints([rung(0, 2, true), rung(1, 4, false), rung(2, 8, false)]));
    expect(next?.level).toBe(1);
  });

  it("offers nothing once the ladder is exhausted", () => {
    expect(nextHintFor(withHints([rung(0, 2, true), rung(1, 4, true)]))).toBeUndefined();
  });

  it("offers nothing when no Order is selected", () => {
    expect(nextHintFor(undefined)).toBeUndefined();
  });

  it("prints the price on the button, in both locales", () => {
    // A cost the player only discovers after paying it is not a choice they
    // made, so the number has to be in the label itself.
    for (const locale of ["ja", "en"] as const) {
      expect(FAST_MOVE_COPY[locale].hintBuy(4)).toContain("4");
      expect(FAST_MOVE_COPY[locale].hintsHint.length).toBeGreaterThan(0);
      expect(FAST_MOVE_COPY[locale].hintsExhausted.length).toBeGreaterThan(0);
    }
  });
});

/**
 * [Issue #709] PROVE is a hand relabelling, and the panel has to say so in
 * the three-line shape every other Order uses (use / mechanism / procedure),
 * and report a wrong grid as a miss rather than a success.
 */
describe("Issue #709: the PROVE panel teaches the relabelling and reports a miss as a miss", () => {
  it("carries use, mechanism and procedure, and names the one rule that matters", () => {
    for (const locale of ["ja", "en"] as const) {
      const copy = FAST_MOVE_COPY[locale];
      expect(copy.proveUse.length).toBeGreaterThan(0);
      expect(copy.proveWhy.length).toBeGreaterThan(0);
      expect(copy.proveHelp).toMatch(locale === "ja" ? /同じ表は 2 度使わない/ : /Never the same table twice/);
      // The identity relabelling is named as the one that is NOT fresh.
      expect(copy.proveNoneUsed).toContain("1→1");
    }
  });

  const hit = (contractId: string) =>
    fixtureProjection({
      lastProve: { contractId, outcome: "hit" },
      publicLedger: [
        {
          id: `${contractId}-sudoku`, teamId: "blue", generation: 1, kind: "sudoku-reveal",
          method: "prove", contractId, group: 6, cells: [2, 4, 1, 3], tag: "0123456789ab", postedAtMs: 5,
        },
      ],
    });
  const miss = (contractId: string) => fixtureProjection({ lastProve: { contractId, outcome: "miss" } });

  for (const locale of ["ja", "en"] as const) {
    it(`a hit names the group that was opened and carries the zero-knowledge lesson (${locale})`, () => {
      const copy = FAST_MOVE_COPY[locale];
      const draft = proveFeedback(hit("blue-c0"), "blue-c0", 30, locale);
      expect(draft.kind).toBe("prove");
      expect(draft.title).toBe(copy.proveSuccess);
      expect(draft.body).toContain("30");
      expect(draft.body).toContain(locale === "ja" ? "3 列目" : "column 3");
      expect(draft.lesson).toBe(copy.proveLesson);
    });

    it(`a miss shows PROVE MISS with the price, never the success copy (${locale})`, () => {
      const copy = FAST_MOVE_COPY[locale];
      const html = renderToStaticMarkup(
        createElement(FeedbackBanner, { feedback: { ...proveFeedback(miss("blue-c0"), "blue-c0", 30, locale), attempt: 1 }, locale }),
      );
      expect(html).toContain(copy.proveMiss);
      expect(html).toContain(`-${DEFAULT_CONFIG.scores.wrongProve}`);
      expect(html).not.toContain(copy.proveSuccess);
      expect(html).toContain("tc-feedback-error");
    });

    it(`an outcome for a different Order, or none, is never rounded up to SUCCESS (${locale})`, () => {
      const copy = FAST_MOVE_COPY[locale];
      expect(proveFeedback(hit("blue-c9"), "blue-c0", 30, locale).title).toBe(copy.proveUnread);
      expect(proveFeedback(undefined, "blue-c0", 30, locale).title).toBe(copy.proveUnread);
      const { lastProve, ...none } = fixtureProjection();
      expect(proveFeedback(none, "blue-c0", 30, locale).title).toBe(copy.proveUnread);
    });
  }

  it("the price on the miss banner is the projection's, not a literal", () => {
    const pricey = fixtureProjection({ lastProve: { contractId: "blue-c0", outcome: "miss" }, wrongProveCost: 11 });
    expect(proveFeedback(pricey, "blue-c0", 30, "en").body).toContain("-11");
  });
});

/**
 * [Issue #709] A sudoku HUNT reports on its own channel: a Shamir hit must not
 * read as a recovered solution, and a sudoku miss must read its budget off the
 * sudoku counter.
 */
describe("Issue #709: sudoku HUNT feedback reads the sudoku channel", () => {
  it("a sudoku hit is reported as a recovered solution, a Shamir hit is not", () => {
    const sudokuHit = fixtureProjection({ lastHunt: { targetTeamId: "red", generation: 1, outcome: "hit", via: "sudoku" } });
    expect(huntFeedback(sudokuHit, "red", "en", "sudoku").body).toBe(FAST_MOVE_COPY.en.huntSudokuBody);
    // The same projection read on the Shamir channel is not a Shamir hit.
    expect(huntFeedback(sudokuHit, "red", "en").title).toBe(FAST_MOVE_COPY.en.huntUnread);
    const shamirHit = fixtureProjection({ lastHunt: { targetTeamId: "red", generation: 1, outcome: "hit" } });
    expect(huntFeedback(shamirHit, "red", "en", "sudoku").title).toBe(FAST_MOVE_COPY.en.huntUnread);
  });

  it("a sudoku miss counts attempts off the sudoku budget", () => {
    const sudokuMiss = fixtureProjection({
      lastHunt: { targetTeamId: "red", generation: 1, outcome: "miss", via: "sudoku" },
      sudokuHuntAttempts: { red: { generation: 1, spent: 2, max: 3 } },
      huntAttempts: { red: { generation: 1, spent: 0, max: 3 } },
    });
    expect(huntFeedback(sudokuMiss, "red", "en", "sudoku").body).toContain("1 attempt left");
  });
});

/**
 * [Issue #696] A HUNT miss is reported as a miss.
 *
 * Since #696 a wrong secret is a move that lands: `validateOp` no longer
 * refuses it, `applyHunt` charges `wrongHunt` and spends one of
 * `maxHuntAttemptsPerTarget`. The plugin SDK answers that op with the same
 * `{ ok: true }` it answers a hit with, and the panel keyed the SUCCESS banner
 * on ok alone -- so a player who guessed wrong lost 8 points, burned an
 * attempt, and read 「復元した secret が受理されました」. The panel has no
 * projection under `renderToStaticMarkup` (see this file's header), so what
 * is rendered here is the banner the panel would show, built from the
 * projection the op came back with.
 */
describe("Issue #696: a HUNT miss renders the miss banner, never the success banner", () => {
  const missProjection = (spent: number) =>
    fixtureProjection({
      lastHunt: { targetTeamId: "red", generation: 1, outcome: "miss" },
      huntAttempts: { red: { generation: 1, spent, max: DEFAULT_CONFIG.maxHuntAttemptsPerTarget } },
    });
  const hitProjection = () =>
    fixtureProjection({
      lastHunt: { targetTeamId: "red", generation: 1, outcome: "hit" },
      huntAttempts: { red: { generation: 1, spent: 1, max: DEFAULT_CONFIG.maxHuntAttemptsPerTarget } },
    });
  const render = (projection: CryptoBattleProjection | undefined, locale: "ja" | "en") =>
    renderToStaticMarkup(
      createElement(FeedbackBanner, { feedback: { ...huntFeedback(projection, "red", locale), attempt: 1 }, locale }),
    );

  for (const locale of ["ja", "en"] as const) {
    it(`a miss shows HUNT MISS with the price and the attempts left, and no success copy (${locale})`, () => {
      const copy = FAST_MOVE_COPY[locale];
      const html = render(missProjection(1), locale);
      expect(html).toContain(copy.huntMiss);
      expect(html).toContain(copy.huntMissBody(DEFAULT_CONFIG.scores.wrongHunt, DEFAULT_CONFIG.maxHuntAttemptsPerTarget - 1));
      // The numbers are real: -8 and "2 left" at the shipped config.
      expect(html).toContain(`-${DEFAULT_CONFIG.scores.wrongHunt}`);
      expect(html).toContain(String(DEFAULT_CONFIG.maxHuntAttemptsPerTarget - 1));
      expect(html).not.toContain(copy.huntSuccess);
      expect(html).not.toContain(copy.huntBody);
      // Styled as an error, not as a landed hunt.
      expect(html).toContain("tc-feedback-error");
      expect(html).not.toContain("tc-feedback-hunt");
    });

    it(`a hit still shows HUNT SUCCESS (${locale})`, () => {
      const copy = FAST_MOVE_COPY[locale];
      const html = render(hitProjection(), locale);
      expect(html).toContain(copy.huntSuccess);
      expect(html).toContain(copy.huntBody);
      expect(html).not.toContain(copy.huntMiss);
    });

    it(`an accepted op whose outcome cannot be read is never rounded up to SUCCESS (${locale})`, () => {
      const copy = FAST_MOVE_COPY[locale];
      // No projection at all (the response failed the guard) ...
      expect(render(undefined, locale)).not.toContain(copy.huntSuccess);
      // ... and a projection with no recorded HUNT: neither is a hit.
      const { lastHunt, ...noOutcome } = fixtureProjection();
      expect(render(noOutcome, locale)).not.toContain(copy.huntSuccess);
      expect(render(noOutcome, locale)).toContain(copy.huntUnread);
    });
  }

  it("the last attempt reports 0 left, in the singular/plural the locale needs", () => {
    const max = DEFAULT_CONFIG.maxHuntAttemptsPerTarget;
    expect(huntFeedback(missProjection(max), "red", "en").body).toContain("0 attempts left");
    expect(huntFeedback(missProjection(max - 1), "red", "en").body).toContain("1 attempt left");
    expect(huntFeedback(missProjection(max), "red", "ja").body).toContain("あと 0 回");
  });

  it("the price on the banner is the projection's, not a literal", () => {
    const pricey = fixtureProjection({
      lastHunt: { targetTeamId: "red", generation: 1, outcome: "miss" },
      wrongHuntCost: 13,
    });
    expect(huntFeedback(pricey, "red", "en").body).toContain("-13");
    expect(huntFeedback(pricey, "red", "ja").body).toContain("-13");
  });
});

/**
 * [Issue #696] The cap is visible BEFORE the attempt is spent. A budget the
 * player only discovers when the judge refuses the fourth try is a wall they
 * walked into, not a rule they played around.
 */
describe("Issue #696: the HUNT budget is shown on the target before it is spent", () => {
  it("names the attempts left on a target at its current generation, in both locales", () => {
    const budget = huntBudgetFor(fixtureProjection(), { teamId: "red", generation: 1 });
    expect(budget).toEqual({ generation: 1, spent: 0, max: DEFAULT_CONFIG.maxHuntAttemptsPerTarget });
    for (const locale of ["ja", "en"] as const) {
      const label = FAST_MOVE_COPY[locale].huntAttemptsLeft(2, 3);
      expect(label).toContain("2");
      expect(label).toContain("3");
    }
  });

  it("shows no budget on a generation the target has already rotated away from", () => {
    // `ledgerTargets` still lists old generations (their shares are on the
    // record), but `validateOp` refuses a HUNT at any but the current one, so
    // advertising attempts there would advertise a budget that cannot be spent.
    const rotated = fixtureProjection({
      huntAttempts: { red: { generation: 2, spent: 0, max: DEFAULT_CONFIG.maxHuntAttemptsPerTarget } },
    });
    expect(huntBudgetFor(rotated, { teamId: "red", generation: 1 })).toBeUndefined();
    expect(huntBudgetFor(rotated, { teamId: "red", generation: 2 })).toBeDefined();
  });

  it("the card's own hint states the price of a miss from the projection", () => {
    for (const locale of ["ja", "en"] as const) {
      expect(FAST_MOVE_COPY[locale].huntHint(8)).toContain("8");
      expect(FAST_MOVE_COPY[locale].huntExhausted.length).toBeGreaterThan(0);
    }
  });

  it("the guard fails closed on a projection that predates the budget", () => {
    const { huntAttempts, ...noBudget } = fixtureProjection();
    expect(isCryptoBattleProjection(noBudget)).toBe(false);
    const { wrongHuntCost, ...noPrice } = fixtureProjection();
    expect(isCryptoBattleProjection(noPrice)).toBe(false);
    expect(isCryptoBattleProjection({ ...fixtureProjection(), lastHunt: { outcome: "maybe" } })).toBe(false);
    expect(isCryptoBattleProjection(fixtureProjection({ lastHunt: { targetTeamId: "red", generation: 1, outcome: "miss" } }))).toBe(true);
  });
});

/**
 * [Issue #696] The Help Drawer must not promise a wrong HUNT is free. It said
 * 「何も起こりません」 / "does nothing" while the reducer charged 8 points.
 */
describe("Issue #696: the Help Drawer says what a wrong HUNT costs", () => {
  for (const locale of ["ja", "en"] as const) {
    it(`no longer claims a wrong guess does nothing (${locale})`, () => {
      const html = renderToStaticMarkup(createElement(HelpDrawer, baseProps({ locale })));
      expect(html).not.toContain("does nothing");
      expect(html).not.toContain("何も起こりません");
      expect(html).not.toContain("guessing never scores");
      expect(html).not.toContain("当て推量は得点になりません");
    });
  }
  it("says, in words, that a miss costs points and attempts", () => {
    const en = renderToStaticMarkup(createElement(HelpDrawer, baseProps({ locale: "en" })));
    expect(en).toContain("A wrong guess is not free");
    expect(en).toMatch(/attempts/);
    const ja = renderToStaticMarkup(createElement(HelpDrawer, baseProps({ locale: "ja" })));
    expect(ja).toContain("外した HUNT はタダではありません");
    expect(ja).toContain("減点");
  });
});

describe("the sudoku side of the vault reaches the participant [Issue #709 review]", () => {
  const vaultWith = (overrides: Partial<CryptoBattleProjection["vault"]>): CryptoBattleProjection =>
    fixtureProjection({ vault: { ...fixtureProjection().vault, ...overrides } });

  it("the Vault lane names the generations whose sudoku solution was recovered, separately from Shamir HUNTs", () => {
    for (const locale of ["ja", "en"] as const) {
      const projection = vaultWith({ sudokuHuntedGenerations: [1] });
      const html = renderToStaticMarkup(
        createElement(StatusPanelBody, { projection, locale, elapsedSincePollMs: 0 }),
      );
      const label = locale === "en" ? "sudoku solution was recovered" : "数独の解を割り出された世代";
      expect(html).toContain(label);
      // The line reads "label: 1" -- the generation is printed after this label,
      // not folded into the Shamir line, which still reads "none".
      const at = html.indexOf(label);
      expect(html.slice(at, at + 200)).toMatch(/:\s*(<!-- -->)?1\b/);
    }
  });

  it("ROTATE opens when this generation's solution was recovered, with no share exposed", () => {
    const hunted = vaultWith({ sudokuHuntedGenerations: [1] });
    expect(sudokuRotatePressure(hunted)).toBe("hunted");
    expect(tacticAvailability(hunted).rotate).toBe(true);
    // An OLDER generation's recovery is history, not pressure.
    expect(sudokuRotatePressure(vaultWith({ generation: 2, sudokuHuntedGenerations: [1] }))).toBeUndefined();
  });

  it("ROTATE opens when every usable relabelling on this generation is spent", () => {
    const allButIdentity = ALL_PERMUTATIONS.filter((pi) => !samePermutation(pi, IDENTITY_PERMUTATION));
    expect(allButIdentity).toHaveLength(23);
    const exhausted = vaultWith({ usedPermutations: allButIdentity });
    expect(sudokuRotatePressure(exhausted)).toBe("exhausted");
    expect(tacticAvailability(exhausted).rotate).toBe(true);
    expect(sudokuRotatePressure(vaultWith({ usedPermutations: allButIdentity.slice(0, 22) }))).toBeUndefined();
    // The fixture's own vault (one table used, nothing hunted) still does not open it.
    expect(tacticAvailability(fixtureProjection({ publicLedger: [] })).rotate).toBe(false);
  });
});

describe("the manual PROVE form reports a landed miss, not a generic 'submitted' [Issue #709 review]", () => {
  for (const locale of ["ja", "en"] as const) {
    const copy = REGISTRATION_COPY[locale];
    it(`a miss on the submitted Order names the cost; a hit says so; anything else falls through (${locale})`, () => {
      const miss = fixtureProjection({ lastProve: { contractId: "blue-c0", outcome: "miss" } });
      const text = describeProveOutcome({ kind: "ok", projection: miss }, "blue-c0", copy);
      expect(text).toBe(copy.proveMissResult(miss.wrongProveCost));
      expect(text).toContain(String(miss.wrongProveCost));
      expect(text).not.toBe(copy.submitted);

      const hit = fixtureProjection({ lastProve: { contractId: "blue-c0", outcome: "hit" } });
      expect(describeProveOutcome({ kind: "ok", projection: hit }, "blue-c0", copy)).toBe(copy.proveHitResult);

      // A stale lastProve from another Order is not this submission's verdict.
      expect(describeProveOutcome({ kind: "ok", projection: miss }, "blue-c9", copy)).toBe(copy.submitted);
      // A projection the guard rejects, or a rejection, reads as before.
      expect(describeProveOutcome({ kind: "ok", projection: {} }, "blue-c0", copy)).toBe(copy.submitted);
      expect(describeProveOutcome({ kind: "rejected", error: "boom" }, "blue-c0", copy)).toBe(`${copy.rejectedPrefix}boom`);
    });
  }
});

describe("the Ledger pairs a puzzle only with the generation it belongs to [Issue #709 review]", () => {
  const revealFor = (teamId: string, generation: number): PublicArtifact => ({
    id: `${teamId}-g${generation}-sudoku`, teamId, generation, kind: "sudoku-reveal", method: "prove",
    contractId: `${teamId}-c-g${generation}`, group: 2, cells: [4, 1, 2, 3], tag: "0a0a0a0a0a0a", postedAtMs: 7,
  });
  const boardWith = (ledger: readonly PublicArtifact[], redGeneration: number) => {
    const base = fixtureProjection();
    const projection = fixtureProjection({
      publicLedger: ledger,
      teams: { ...base.teams, red: { ...base.teams.red, generation: redGeneration } as (typeof base.teams)["red"] },
    });
    return renderToStaticMarkup(createElement(GameBoardBody, { projection, locale: "en" }));
  };

  it("shows the current puzzle on the current generation's card", () => {
    const html = boardWith([revealFor("red", 1)], 1);
    expect(html).toContain('aria-label="puzzle-red"');
    expect(html).not.toContain("retired generation");
  });

  it("does not show the current puzzle beside a retired generation's reveals", () => {
    // red has ROTATEd to generation 2; its generation-1 reveal is still on the
    // ledger. Pairing it with the generation-2 puzzle would invite an
    // impossible reconstruction.
    const html = boardWith([revealFor("red", 1)], 2);
    expect(html).not.toContain('aria-label="puzzle-red"');
    expect(html).toContain("retired generation");
  });

  it("with reveals on both generations, only the current card carries the puzzle", () => {
    const html = boardWith([revealFor("red", 1), revealFor("red", 2)], 2);
    expect(html.split('aria-label="puzzle-red"')).toHaveLength(2);
    expect(html).toContain("retired generation");
  });
});
