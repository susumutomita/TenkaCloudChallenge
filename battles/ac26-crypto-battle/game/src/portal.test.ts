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
import HelpDrawer from "../../portal/HelpDrawer.tsx";
import RegistrationPanel, { submitHunt, submitLeak, submitProve, submitRotate } from "../../portal/RegistrationPanel.tsx";
import StatusPanel, { StatusPanelBody } from "../../portal/StatusPanel.tsx";
import type { CryptoBattleProjection } from "./types.ts";

const FIXED_NOW = 1_700_000_000_000;

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
    nowMs: FIXED_NOW,
    startedAtMs: FIXED_NOW - 40 * 60_000,
    matchEndsAtMs: FIXED_NOW + 50 * 60_000,
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
        requestedShareIndices: [0, 1],
        issuedAtMs: FIXED_NOW - 60_000,
        expiresAtMs: FIXED_NOW + 5 * 60_000,
        status: "open",
      },
      {
        id: "blue-c-old",
        kind: "standard",
        points: 10,
        requestedShareIndices: [2],
        issuedAtMs: FIXED_NOW - 10 * 60_000,
        expiresAtMs: FIXED_NOW - 5 * 60_000,
        status: "expired",
      },
    ],
    otherOpenContractCount: 1,
    publicLedger: [
      {
        id: "red-c0-share0",
        teamId: "red",
        generation: 1,
        kind: "share",
        shareIndex: 0,
        value: "998877",
        contractId: "red-c0",
        postedAtMs: FIXED_NOW - 9000,
      },
      {
        id: "red-c1-share1",
        teamId: "red",
        generation: 1,
        kind: "share",
        shareIndex: 1,
        value: "776655",
        contractId: "red-c1",
        postedAtMs: FIXED_NOW - 6000,
      },
      {
        id: "red-c2-share2",
        teamId: "red",
        generation: 1,
        kind: "share",
        shareIndex: 2,
        value: "554433",
        contractId: "red-c2",
        postedAtMs: FIXED_NOW - 3000,
      },
      {
        id: "blue-c-old-proof",
        teamId: "blue",
        generation: 1,
        kind: "proof",
        contractId: "blue-c-old",
        commitment: "112233",
        response: "445566",
        postedAtMs: FIXED_NOW - 1000,
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
        createElement(StatusPanelBody, { projection: fixtureProjection(), locale, nowMs: FIXED_NOW }),
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
      // Raw ledger data (participant-facing, allowed) is present.
      expect(html).toContain("998877");
      expect(html).toContain("554433");
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
        createElement(StatusPanelBody, { projection: fixtureProjection(), locale, nowMs: FIXED_NOW }),
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
  }
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
