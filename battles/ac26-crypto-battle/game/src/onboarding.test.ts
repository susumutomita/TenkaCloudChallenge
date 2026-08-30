/** Issue #641/#646: participant-visible onboarding and visual game surface. */

import { describe, expect, it } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { GameBoardBody } from "../../portal/GameBoard.tsx";
import HelpDrawer from "../../portal/HelpDrawer.tsx";
import {
  getActionableContracts,
  isMatchClosed,
  MatchEndedNotice,
  sanitizeProjection,
} from "../../portal/RegistrationPanel.tsx";
import {
  advanceTutorial,
  createTutorialState,
  DOCUMENTED_THRESHOLD,
  reconstructTutorialSecret,
  TUTORIAL_OPPONENT_SHARES,
} from "../../portal/TutorialWalkthrough.tsx";
import { DEFAULT_CONFIG } from "./reducer.ts";
import type { CryptoBattleProjection } from "./types.ts";

function projection(overrides: Partial<CryptoBattleProjection> = {}): CryptoBattleProjection {
  return {
    phase: "pressure",
    matchRemainingMs: 30_000,
    vault: {
      teamId: "blue",
      secret: "42",
      shares: [
        { index: 1, value: "80" },
        { index: 2, value: "91" },
        { index: 3, value: "5" },
      ],
      generation: 1,
      lastRotateAtMs: undefined,
      rotateCooldownRemainingMs: 0,
      completedContractIds: [],
      huntedGenerations: [],
    },
    myContracts: [
      {
        id: "blue-c7",
        kind: "standard",
        points: 10,
        requestedShareIndices: [1],
        status: "open",
        remainingMs: 30_000,
      },
      {
        id: "blue-c-old",
        kind: "standard",
        points: 10,
        requestedShareIndices: [2],
        status: "open",
        remainingMs: 0,
      },
    ],
    otherOpenContractCount: 1,
    publicLedger: [
      {
        id: "red-c1-share1",
        teamId: "red",
        generation: 1,
        kind: "share",
        shareIndex: 1,
        value: "998877",
        contractId: "red-c1",
        postedAtMs: 10_000,
      },
      {
        id: "red-c2-share3",
        teamId: "red",
        generation: 1,
        kind: "share",
        shareIndex: 3,
        value: "776655",
        contractId: "red-c2",
        postedAtMs: 20_000,
      },
    ],
    teams: {
      blue: { teamId: "blue", score: 0, generation: 1, huntedGenerationCount: 0 },
      red: { teamId: "red", score: 20, generation: 1, huntedGenerationCount: 0 },
    },
    publicCommitments: { blue: "1", red: "2" },
    ...overrides,
  };
}

function slotProps(locale: "ja" | "en") {
  return {
    team: { teamId: "blue", teamName: "Blue", eventId: "event" },
    problemId: "ac26-crypto-battle",
    jobId: "job",
    score: 0,
    locale,
    endpoints: [],
    phases: [],
    disruptions: [],
    nowIso: new Date(0).toISOString(),
  } as const;
}

describe("Issue #641 tutorial walkthrough", () => {
  it("teaches LEAK -> PROVE -> HUNT -> ROTATE without touching match state", () => {
    const ready = createTutorialState();
    expect(ready).toMatchObject({ stage: "ready", score: 0, generation: 1, ledger: [] });

    const leaked = advanceTutorial(ready);
    expect(leaked).toMatchObject({ stage: "leaked", score: 10, exposedShareIndices: [1] });
    expect(leaked.ledger[0]).toMatchObject({ kind: "share", contractId: "tutorial-contract-a", generation: 1 });

    const proved = advanceTutorial(leaked);
    expect(proved).toMatchObject({ stage: "proved", score: 20, exposedShareIndices: [1] });
    expect(proved.ledger[1]).toMatchObject({ kind: "proof", contractId: "tutorial-contract-b", generation: 1 });

    const hunted = advanceTutorial(proved);
    expect(hunted).toMatchObject({ stage: "hunted", score: 40, recoveredSecret: "73" });

    const rotated = advanceTutorial(hunted);
    expect(rotated).toMatchObject({ stage: "rotated", generation: 2, exposedShareIndices: [] });
    expect(rotated.ledger[0]?.generation).toBe(1);
  });

  it("uses distinct shares for a real Lagrange reconstruction and pins the documented threshold", () => {
    expect(DOCUMENTED_THRESHOLD).toBe(DEFAULT_CONFIG.threshold);
    expect(TUTORIAL_OPPONENT_SHARES).toHaveLength(DEFAULT_CONFIG.threshold);
    expect(reconstructTutorialSecret(TUTORIAL_OPPONENT_SHARES)).toBe(73);
    expect(() => reconstructTutorialSecret([TUTORIAL_OPPONENT_SHARES[0], TUTORIAL_OPPONENT_SHARES[0]])).toThrow(
      "distinct share indices",
    );
  });

  for (const locale of ["ja", "en"] as const) {
    it(`renders the walkthrough before the collapsed complete reference (${locale})`, () => {
      const html = renderToStaticMarkup(createElement(HelpDrawer, slotProps(locale)));
      const tutorialTitle = locale === "ja" ? "ルールを順番に体験する" : "Guided rules walkthrough";
      const fullReference = locale === "ja" ? "完全なルール" : "complete rules";
      expect(html).toContain(tutorialTitle);
      expect(html).toContain("<details");
      expect(html.indexOf(tutorialTitle)).toBeLessThan(html.indexOf(fullReference));
      expect(html).toContain("p = 0xffffffffffffffff");
    });
  }
});

describe("Issue #646 visual game board", () => {
  for (const locale of ["ja", "en"] as const) {
    it(`puts the Order belt and LEAK / PROVE choice before raw values (${locale})`, () => {
      const html = renderToStaticMarkup(createElement(GameBoardBody, { projection: projection(), locale }));
      expect(html).toContain("ORDER BELT");
      expect(html).toContain("ORDER #7");
      expect(html).toContain("LEAK");
      expect(html).toContain("PROVE");
      expect(html).toContain("MY VAULT");
      expect(html).toContain("PUBLIC LEDGER");
      expect(html.indexOf("ORDER BELT")).toBeLessThan(html.indexOf("MY VAULT"));
      expect(html.indexOf("ORDER BELT")).toBeLessThan(html.indexOf("PUBLIC LEDGER"));
    });

    it(`renders shares as cards grouped by team/generation, without an exploitability verdict (${locale})`, () => {
      const html = renderToStaticMarkup(createElement(GameBoardBody, { projection: projection(), locale }));
      expect(html).toContain("red");
      expect(html).toContain("#1");
      expect(html).toContain("#3");
      expect(html).toContain("998877");
      const lower = html.toLowerCase();
      for (const forbidden of ["hunt possible", "threshold reached", "reconstructable", "復元可能", "あと1枚", "hunt可能"]) {
        expect(lower).not.toContain(forbidden.toLowerCase());
      }
    });
  }

  it("ships reduced-motion fallback in the participant-visible board", () => {
    const html = renderToStaticMarkup(createElement(GameBoardBody, { projection: projection(), locale: "en" }));
    expect(html).toContain("prefers-reduced-motion:reduce");
  });
});

describe("Issue #641 live move lifecycle", () => {
  it("does not offer a stale open Order whose remaining duration is already zero", () => {
    expect(getActionableContracts(projection()).map((contract) => contract.id)).toEqual(["blue-c7"]);
    expect(sanitizeProjection(projection()).myContracts.map((contract) => [contract.id, contract.status])).toEqual([
      ["blue-c7", "open"],
      ["blue-c-old", "expired"],
    ]);
  });

  it("treats both phase=ended and a zero remaining duration as read-only", () => {
    expect(isMatchClosed(projection({ phase: "ended", matchRemainingMs: 10_000 }))).toBe(true);
    expect(isMatchClosed(projection({ phase: "endgame", matchRemainingMs: 0 }))).toBe(true);
    expect(isMatchClosed(projection({ phase: "endgame", matchRemainingMs: 1 }))).toBe(false);
  });

  for (const locale of ["ja", "en"] as const) {
    it(`shows an explicit read-only end state (${locale})`, () => {
      const html = renderToStaticMarkup(createElement(MatchEndedNotice, { locale }));
      expect(html).toContain(locale === "ja" ? "この試合は終了しました" : "This match has ended");
      expect(html).toContain(locale === "ja" ? "実行できません" : "no longer available");
    });
  }
});
