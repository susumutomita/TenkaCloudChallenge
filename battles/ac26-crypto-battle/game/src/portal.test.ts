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
import type { PortalCoordinationClient, PortalCoordinationOutcome, PortalSlotProps } from "@tenkacloud/portal-plugin-sdk";
import { isCryptoBattleProjection } from "../../portal/coordination.ts";
import HelpDrawer, { PYTHON_SNIPPET } from "../../portal/HelpDrawer.tsx";
import RegistrationPanel, {
  COPY as REGISTRATION_COPY,
  describeOutcome,
  submitHunt,
  submitLeak,
  submitProve,
  submitRotate,
} from "../../portal/RegistrationPanel.tsx";
import { contractsForMethod } from "../../portal/RegistrationPanelCore.tsx";
import { GameBoardBody } from "../../portal/GameBoard.tsx";
import { ALL_SUBMISSION_METHODS } from "./methods.ts";
import { nonceHuntCandidates } from "../../portal/FastMovePanel.tsx";
import StatusPanel, { StatusPanelBody } from "../../portal/StatusPanel.tsx";
import { MODP_2048_P } from "./group.ts";
import { DEFAULT_CONFIG, initialState, projectForTeam, tick } from "./reducer.ts";
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
    },
    myContracts: [
      {
        id: "blue-c0",
        kind: "standard",
        points: 10,
        task: { kind: "reveal-share" as const, shareIndices: [0, 1] },
        privacyConstraint: "none",
        allowedMethods: ["leak", "prove"],
        status: "open",
        remainingMs: 5 * 60_000,
      },
      {
        id: "blue-c-old",
        kind: "standard",
        points: 10,
        task: { kind: "reveal-share" as const, shareIndices: [2] },
        privacyConstraint: "none",
        allowedMethods: ["leak", "prove"],
        status: "expired",
        remainingMs: 0,
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
        id: "blue-c-old-proof",
        teamId: "blue",
        generation: 1,
        kind: "proof",
        method: "prove" as const,
        contractId: "blue-c-old",
        commitment: "112233",
        response: "445566",
        postedAtMs: ELAPSED_AT_TICK_MS - 1000,
      },
    ],
    teams: {
      blue: { teamId: "blue", score: 30, generation: 1, huntedGenerationCount: 0 },
      red: { teamId: "red", score: 20, generation: 1, huntedGenerationCount: 0 },
    },
    publicCommitments: { blue: "1010101010", red: "2020202020" },
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
      // My Vault shows the team's own teamId -- the only on-screen source
      // for PROVE's Python `team` variable.
      // (React HTML-escapes the English copy's apostrophe to `&#x27;`, so
      // this checks the apostrophe-free tail of that string instead.)
      expect(html).toContain(locale === "ja" ? "PROVE の `team` 変数" : "`team` variable");
      // Raw ledger data (participant-facing, allowed) is present.
      expect(html).toContain("998877");
      expect(html).toContain("554433");
    });

    /**
     * [Issue #645 Phase 5] A proof's challenge binds five values -- domain,
     * team, contract, generation, R, Y -- and the nonce-reuse HUNT needs two
     * challenges recomputed from ledger rows. Two of those inputs reached no
     * participant surface at all: `ledgerPayload` dropped the Order id, and Y
     * was rendered nowhere. A reader who understood the maths perfectly still
     * could not compute a single challenge, so the HUNT was unplayable by hand
     * no matter what the statement said.
     */
    it(`renders every value a proof's challenge binds (${locale})`, () => {
      const projection = fixtureProjection();
      const html = renderToStaticMarkup(
        createElement(StatusPanelBody, { projection, locale, elapsedSincePollMs: 0 }),
      );
      const proof = projection.publicLedger.find((a) => a.kind === "proof");
      if (proof?.kind !== "proof") throw new Error("expected a proof row in the fixture");

      expect(html).toContain(proof.teamId);
      expect(html).toContain(proof.contractId);
      expect(html).toContain(proof.commitment);
      expect(html).toContain(String(proof.generation));
      // Every team's Y, not only the target's -- it is public for all of them,
      // and rendering only one would be the platform choosing a target.
      for (const y of Object.values(projection.publicCommitments)) {
        expect(html).toContain(y);
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
    const state0 = initialState({ eventId: "evt-countdown-regression", teamIds: ["blue"] });
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
    let state = initialState({ eventId: "evt-multi-tick-regression", teamIds: ["blue"] });
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

  it("PROVE Python snippet's prime is byte-for-byte the real RFC 3526 Group 14 constant", () => {
    // An earlier version of this snippet shipped `p = <RFC 3526 Group 14
    // prime>` -- a syntactically invalid placeholder, despite the
    // surrounding copy promising "そのまま動く Python" / "runnable
    // Python". This test is the machine-checkable half of fixing that: it
    // fails if a future edit ever reintroduces a placeholder, drifts from
    // `group.ts`'s real constant, or mistypes even one of its 512 hex
    // digits (see `group.ts`'s own header on why that specific failure
    // mode is otherwise silent -- Schnorr verification "still computes a
    // number", it does not throw on a wrong prime).
    const match = PYTHON_SNIPPET.match(/^p = 0x([0-9a-f]+)/m);
    if (!match?.[1]) throw new Error("PYTHON_SNIPPET: expected a `p = 0x<hex>` line");
    expect(BigInt(`0x${match[1]}`)).toBe(MODP_2048_P);
  });

  it("PROVE Python snippet, run for real, matches createProof()'s real output and verifies", async () => {
    // The other half of "runnable Python" is actually running it. This
    // repo's Python isn't itself under `bun test`, so this asserts the
    // TRANSCRIPTION is exact (every hash label, the length-prefix framing,
    // the operation order) by re-deriving the same proof in TypeScript
    // using the identical primitives the snippet calls out to
    // (`prng.ts`'s `deriveBigInt` == the snippet's `derive`,
    // `schnorr-transcript.ts`'s length-prefix + fixed-width framing == the
    // snippet's `lp` / `fw`) -- one-time manual verification against a real
    // `python3` run of this exact snippet (same secret/team/generation/
    // contract) additionally confirmed identical `commitment` / `response`
    // decimal strings, which this test cannot itself shell out to `python3`
    // to re-check on every run without adding that as a test-time
    // dependency this repo does not otherwise have.
    const { createProof } = await import("./schnorr-prover.ts");
    const { verifyProof } = await import("./schnorr-verifier.ts");
    const { derivePublicCommitment } = await import("./schnorr-witness.ts");

    const secret = 123456789012345678n;
    const team = "blue";
    const generation = 1;
    const contract = "blue-c0";

    const proof = createProof(secret, generation, team, contract);
    // These exact decimal strings were also produced by running
    // PYTHON_SNIPPET's real Python (with the same inputs) by hand before
    // this fix shipped -- pinning them here means a future accidental
    // change to the framing (this snippet's OR schnorr-prover.ts's) that
    // still "verifies" but silently diverges from what a participant
    // copy-pasting this exact Python would compute gets caught too.
    expect(proof.commitment).toBe(
      "12491904079717215833289811861220956048131206574919718145925209972398991206550006999619986512335299316987035579151265564160905430804756070893245491304906574426512819514797618407919681861453404509081259916574473758059436583306737429056168559213105116239617298111422348935851536075343460252578596791285162186249960968769354288041789857921094185762502840065986960829626732425410297434567412792768095341828845359892161906091162086495027395998743458945660683858268942938522993404146830635328411484578493755418282595586209950518050109052386659393336806948058372378342971254888277990456825964420607659201042108347562933100138",
    );
    expect(proof.response).toBe(
      "8240697219374735644623142365545472691120352149005885012557939550420978958098898382175055561578100915092772978845894423099683761252258163195079737990667",
    );

    const publicY = derivePublicCommitment(secret, generation, team);
    expect(verifyProof(publicY, proof, { teamId: team, contractId: contract, generation })).toBe(true);
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

  it("submitProve sends { kind: 'prove', contractId, proof }", async () => {
    const { client, calls } = capturingClient();
    await submitProve(client, "blue-c1", { commitment: "111", response: "222" });
    expect(calls).toEqual([
      { kind: "prove", contractId: "blue-c1", proof: { commitment: "111", response: "222" } },
    ]);
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
      id: "free", kind: "standard", points: 10,
      task: { kind: "reveal-share", shareIndices: [0] },
      privacyConstraint: "none", allowedMethods: ["leak", "prove"],
      status: "open", remainingMs: 60_000,
    },
    {
      id: "prove-only", kind: "standard", points: 10,
      task: { kind: "reveal-share", shareIndices: [1] },
      privacyConstraint: "no-raw-disclosure", allowedMethods: ["prove"],
      status: "open", remainingMs: 60_000,
    },
    {
      id: "fhe", kind: "standard", points: 10,
      task: { kind: "homomorphic-sum", inputs: [{ r: "1", y: "2" }, { r: "3", y: "4" }] },
      privacyConstraint: "no-raw-disclosure", allowedMethods: ["fhe"],
      status: "open", remainingMs: 60_000,
    },
    {
      id: "mpc", kind: "standard", points: 10,
      task: { kind: "masked-total", partyCount: 3, myInput: "5", incomingMasks: ["1", "2"], outgoingMasks: ["3", "4"] },
      privacyConstraint: "no-raw-disclosure", allowedMethods: ["mpc"],
      status: "open", remainingMs: 60_000,
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

describe("the nonce-HUNT card offers candidates without judging exploitability [Issue #645]", () => {
  const proof = (teamId: string, generation: number, contractId: string, commitment: string) =>
    ({
      id: `${contractId}-proof`, teamId, generation, kind: "proof" as const,
      method: "prove" as const, contractId, commitment, response: "9", postedAtMs: 1,
    });

  const projectionWith = (
    ledger: readonly PublicArtifact[],
    redGeneration: number,
  ): CryptoBattleProjection =>
    fixtureProjection({
      publicLedger: ledger,
      teams: {
        blue: { teamId: "blue", score: 0, generation: 1, huntedGenerationCount: 0 },
        red: { teamId: "red", score: 0, generation: redGeneration, huntedGenerationCount: 0 },
      },
    });

  /**
   * The load-bearing pair. An earlier version listed a team only once it had
   * found two proof rows sharing a commitment — so the card changed the moment
   * the reuse appeared, and the Portal was announcing the pattern the
   * participant is supposed to spot. These two assert the card looks the SAME
   * either way: the reading stays the participant's.
   */
  it("offers a team that has posted proofs, whether or not a commitment repeats", () => {
    const reused = nonceHuntCandidates(
      projectionWith([proof("red", 1, "red-c0", "77"), proof("red", 1, "red-c1", "77")], 1),
    );
    const distinct = nonceHuntCandidates(
      projectionWith([proof("red", 1, "red-c0", "77"), proof("red", 1, "red-c1", "88")], 1),
    );
    expect(reused).toEqual([{ teamId: "red", generation: 1 }]);
    expect(distinct).toEqual(reused);
  });

  it("offers a team with a single proof row, which cannot be hunted at all", () => {
    // Precisely the case an exploitability-computing list would hide, and
    // hiding it is what would leak the verdict.
    expect(nonceHuntCandidates(projectionWith([proof("red", 1, "red-c0", "77")], 1))).toEqual([
      { teamId: "red", generation: 1 },
    ]);
  });

  it("names each team's current generation, so a stale target cannot be offered", () => {
    // The victim rotated after those rows were written. The candidate carries
    // generation 2 — what `validateOp` will accept — not the ledger's 1.
    expect(
      nonceHuntCandidates(
        projectionWith([proof("red", 1, "red-c0", "77"), proof("red", 1, "red-c1", "77")], 2),
      ),
    ).toEqual([]);
  });

  it("never offers your own team", () => {
    expect(
      nonceHuntCandidates(
        projectionWith([proof("blue", 1, "blue-c0", "77"), proof("blue", 1, "blue-c1", "77")], 1),
      ),
    ).toEqual([]);
  });

  it("offers nothing when no other team has posted a proof", () => {
    expect(nonceHuntCandidates(projectionWith([], 1))).toEqual([]);
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
    id, kind: "standard", points: 10, task,
    privacyConstraint: allowedMethods.includes("leak") ? "none" : "no-raw-disclosure",
    allowedMethods, status: "open", remainingMs: 60_000,
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
