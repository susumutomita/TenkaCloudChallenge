/** Issue #641/#646: participant-visible onboarding and visual game surface. */

import { describe, expect, it } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { GameBoardBody } from "../../portal/GameBoard.tsx";
import HelpDrawer from "../../portal/HelpDrawer.tsx";
import StatusPanel from "../../portal/StatusPanel.tsx";
import {
  getActionableContracts,
  isMatchClosed,
  MatchEndedNotice,
  sanitizeProjection,
} from "../../portal/RegistrationPanel.tsx";
import { checkPracticeAnswer, PRACTICE_STEPS } from "../../portal/TutorialWalkthrough.tsx";
import { DEFAULT_CONFIG } from "./reducer.ts";
import type { CryptoBattleProjection } from "./types.ts";

function projection(overrides: Partial<CryptoBattleProjection> = {}): CryptoBattleProjection {
  return {
    phase: "pressure",
    // [Issue #645] The modulus is on the projection: a participant needs it to
    // compute an FHE or MPC answer, and it is public by construction.
    prime: DEFAULT_CONFIG.prime,
    threshold: DEFAULT_CONFIG.threshold,
    // [Issue #688] The waiting screen renders "1 / 2 準備完了" from this.
    ready: { count: 2, total: 2, me: true },
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
      sudokuSolution: [1, 2, 3, 4, 3, 4, 1, 2, 2, 1, 4, 3, 4, 3, 2, 1],
      usedPermutations: [],
      sudokuHuntedGenerations: [],
    },
    myContracts: [
      {
        id: "blue-c7",
        kind: "standard",
        points: 10,
        leakPoints: 10,
        task: { kind: "reveal-share" as const, shareIndices: [1] },
        privacyConstraint: "none",
        allowedMethods: ["leak", "prove"],
        status: "open",
        remainingMs: 30_000,
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
        status: "open",
        remainingMs: 0,
        hints: [],
      },
    ],
    otherOpenContractCount: 1,
    publicLedger: [
      {
        id: "red-c1-share1",
        teamId: "red",
        generation: 1,
        kind: "share",
        method: "leak" as const,
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
        method: "leak" as const,
        shareIndex: 3,
        value: "776655",
        contractId: "red-c2",
        postedAtMs: 20_000,
      },
    ],
    teams: {
      blue: { teamId: "blue", teamName: "blue", score: 0, generation: 1, huntedGenerationCount: 0 },
      red: { teamId: "red", teamName: "red", score: 20, generation: 1, huntedGenerationCount: 0 },
    },
    publicPuzzles: {
      blue: [1, 0, 0, 4, 0, 4, 1, 0, 2, 0, 0, 3, 0, 3, 2, 0],
      red: [0, 3, 1, 0, 1, 0, 0, 3, 0, 2, 4, 0, 4, 0, 0, 2],
    },
    huntAttempts: { red: { generation: 1, spent: 0, max: DEFAULT_CONFIG.maxHuntAttemptsPerTarget } },
    sudokuHuntAttempts: { red: { generation: 1, spent: 0, max: DEFAULT_CONFIG.maxHuntAttemptsPerTarget } },
    wrongHuntCost: DEFAULT_CONFIG.scores.wrongHunt,
    wrongProveCost: DEFAULT_CONFIG.scores.wrongProve,
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

describe("optional arithmetic practice", () => {
  it("covers the seven small-number operations and rejects empty, wrong and non-digit answers", () => {
    // Fixed, hand-worked values; the real cryptographic examples are checked
    // against the game primitives in concept-explanation.test.ts.
    const answers = ["1", "1", "6", "2", "4", "1", "2"];
    expect(PRACTICE_STEPS.map(step => step.topic)).toEqual(["remainder", "sharing", "mpc", "zk", "fhe", "caesar", "commit"]);
    for (let i = 0; i < answers.length; i++) {
      expect(checkPracticeAnswer(i, answers[i]!)).toBe(true);
      for (const invalid of ["", " ", "-1", "10", "a", "0"]) expect(checkPracticeAnswer(i, invalid)).toBe(false);
    }
    expect(checkPracticeAnswer(99, "1")).toBe(false);
  });

  for (const locale of ["ja", "en"] as const) {
    it(`keeps the explanation visible and offers only optional practice above the board (${locale})`, () => {
      const status = renderToStaticMarkup(createElement(StatusPanel, slotProps(locale)));
      const help = renderToStaticMarkup(createElement(HelpDrawer, slotProps(locale)));
      const html = status + help;
      const tutorialTitle = locale === "ja" ? "練習する（任意）" : "Practice (optional)";
      const explanation = locale === "ja" ? "この問題の解説" : "How this problem works";
      const fullReference = locale === "ja" ? "完全なルール" : "complete rules";
      expect(status).toContain(tutorialTitle);
      expect(status).toContain('aria-label="crypto-battle-tutorial-collapsed"');
      expect(status).toContain('aria-expanded="false"');
      expect(status).not.toContain('aria-label="crypto-battle-tutorial"');
      expect(status.indexOf(explanation)).toBeGreaterThanOrEqual(0);
      expect(status.indexOf(explanation)).toBeLessThan(status.indexOf(tutorialTitle));
      expect(status).not.toContain("tutorial-contract-a");
      expect(help).not.toContain(tutorialTitle);
      const raw = locale === "ja" ? "生の試合データ" : "Raw match data";
      expect(status.indexOf(tutorialTitle)).toBeLessThan(status.indexOf(raw));
      expect(status).toContain("color:#16212e");
      expect(html).toContain("<details");
      expect(html.indexOf(tutorialTitle)).toBeLessThan(html.indexOf(fullReference));
      // [Issue #709] The snippet opens with the relabelling table.
      expect(html).toContain("table = {1: 3, 2: 1, 3: 4, 4: 2}");
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
