/** Issue #641: participant-visible onboarding and ended-match safety. */

import { describe, expect, it } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import HelpDrawer from "../../portal/HelpDrawer.tsx";
import {
  getActionableContracts,
  isMatchClosed,
  MatchEndedNotice,
  sanitizeProjection,
} from "../../portal/RegistrationPanel.tsx";
import StatusPanel from "../../portal/StatusPanel.tsx";
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
        id: "blue-open",
        kind: "standard",
        points: 10,
        requestedShareIndices: [1],
        status: "open",
        remainingMs: 30_000,
      },
      {
        id: "blue-stale-zero",
        kind: "standard",
        points: 10,
        requestedShareIndices: [2],
        status: "open",
        remainingMs: 0,
      },
    ],
    otherOpenContractCount: 1,
    publicLedger: [],
    teams: {
      blue: { teamId: "blue", score: 0, generation: 1, huntedGenerationCount: 0 },
      red: { teamId: "red", score: 0, generation: 1, huntedGenerationCount: 0 },
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
    expect(leaked.ledger[0]).toMatchObject({
      kind: "share",
      contractId: "tutorial-contract-a",
      generation: 1,
    });

    const proved = advanceTutorial(leaked);
    expect(proved).toMatchObject({ stage: "proved", score: 20, exposedShareIndices: [1] });
    expect(proved.ledger[1]).toMatchObject({
      kind: "proof",
      contractId: "tutorial-contract-b",
      generation: 1,
    });

    const hunted = advanceTutorial(proved);
    expect(hunted).toMatchObject({ stage: "hunted", score: 40, recoveredSecret: "73" });

    const rotated = advanceTutorial(hunted);
    expect(rotated).toMatchObject({ stage: "rotated", generation: 2, exposedShareIndices: [] });
    expect(rotated.ledger[0]?.generation).toBe(1);
  });

  it("uses distinct shares for a real Lagrange reconstruction and pins the documented threshold", () => {
    expect(DOCUMENTED_THRESHOLD).toBe(DEFAULT_CONFIG.threshold);
    expect(TUTORIAL_OPPONENT_SHARES).toHaveLength(DEFAUL_CONFIG.threshold);
    expect(reconstructTutorialSecret(TUTORIAL_OPPONENT_SHARES)).toBe(73);
    expect(() =>
      reconstructTutorialSecret([TUTORIAL_OPPONENT_SHARES[0], TUTORIAL_OPPONENT_SHARES[0]]),
    ).toThrow("distinct share indices");
  });

  for (const locale of ["ja", "en"] as const) {
    it(`puts the 30-second rules before the live status surface (${locale})`, () => {
      const html = renderToStaticMarkup(createElement(StatusPanel, slotProps(locale)));
      const ruleTitle = locale === "ja" ? "30秘で分かるルール" : "30-second rules";
      const statusTitle = locale === "ja" ? "PROVE / LEAK / HUNT — 状態}" : "PROVE / LEAK / HUNT -- Status";
      expect(html).toContain(ruleTitle);
      expect(html.indexOf(ruleTitle)).toBeLessThan(html.indexOf(statusTitle));
    });

    it(`renders the walkthrough before the collapsed complete reference (${locale})`, () => {
      const html = renderToStaticMarkup(createElement(HelpDrawer, slotProps(locale)));
      const tutorialTitle = locale === "ja" ? "ルールを順番に体験する" : "Guided rules walkthrough";
      const fullReference = locale === "ja" ? "完全なルール" : "complete rules";
      expect(html).toContain(tutorialTitle);
      expect(html).toContain("<details");
      expect(html.indexOf(tutorialTitle)).toBeLessThan(html.indexOf(fullReference));
      // The unchanged, executable reference is still present inside details.
      expect(html).toContain("p = 0xffffffffffffffff");
    });
  }
});

describe("Issue #641 live move lifecycle", () => {
  it("does not offer a stale open Contract whose remaining duration is already zero", () => {
    expect(getActionableContracts(projection()).map((contract) => contract.id)).toEqual(["blue-open"]);
    expect(sanitizeProjection(projection()).myContracts.map((contract) => [contract.id, contract.status])).toEqual([
      ["blue-open", "open"],
      ["blue-stale-zero", "expired"],
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
