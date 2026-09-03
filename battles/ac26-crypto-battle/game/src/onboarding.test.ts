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
  checkTutorialHunt,
  createTutorialState,
  DOCUMENTED_THRESHOLD,
  reconstructTutorialSecret,
  TUTORIAL_LAGRANGE_COEFFICIENTS,
  TUTORIAL_OPPONENT_SHARES,
  TUTORIAL_PRIME,
  TUTORIAL_TOY_SCHNORR,
  TUTORIAL_WORKED_EXAMPLE,
} from "../../portal/TutorialWalkthrough.tsx";
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

    // [Issue #643] HUNT no longer advances on a button press. The participant
    // computes the value by hand and types it; the walkthrough only checks it.
    const answer = String(reconstructTutorialSecret(TUTORIAL_OPPONENT_SHARES));
    const hunted = advanceTutorial(proved, { kind: "hunt", answer });
    expect(hunted).toMatchObject({ stage: "hunted", score: 40, recoveredSecret: answer });

    const rotated = advanceTutorial(hunted);
    expect(rotated).toMatchObject({ stage: "rotated", generation: 2, exposedShareIndices: [] });
    expect(rotated.ledger[0]?.generation).toBe(1);
  });

  it("uses distinct shares for a real Lagrange reconstruction and pins the documented threshold", () => {
    expect(DOCUMENTED_THRESHOLD).toBe(DEFAULT_CONFIG.threshold);
    expect(TUTORIAL_OPPONENT_SHARES).toHaveLength(DEFAULT_CONFIG.threshold);
    expect(reconstructTutorialSecret(TUTORIAL_OPPONENT_SHARES)).toBe(5);
    expect(() => reconstructTutorialSecret([TUTORIAL_OPPONENT_SHARES[0], TUTORIAL_OPPONENT_SHARES[0]])).toThrow(
      "distinct share indices",
    );
  });
});

/**
 * [Issue #643] The playtest complaint the whole step exists for: 小さい数字なら
 * 手計算でも作れるようにした方が原理を理解しやすい. What #641 shipped let a
 * reader press a button and watch a number appear, so they saw THAT three
 * shares reconstruct a secret without ever doing it.
 */
describe("Issue #643 hand-calculable tutorial HUNT", () => {
  const CORRECT = String(reconstructTutorialSecret(TUTORIAL_OPPONENT_SHARES));

  it("stays in a field small enough to work on paper", () => {
    expect(TUTORIAL_PRIME).toBeLessThan(100);
    for (const share of TUTORIAL_OPPONENT_SHARES) {
      expect(share.value).toBeGreaterThanOrEqual(0);
      expect(share.value).toBeLessThan(TUTORIAL_PRIME);
    }
  });

  /**
   * The load-bearing invariant. Participants are handed three whole numbers
   * instead of the general Lagrange formula, which is only legitimate because
   * the indices 1/2/3 make every denominator divide exactly -- no modular
   * inverse. If a future edit changes the share set, the taught shortcut would
   * quietly stop matching the checker; this catches that.
   */
  it("teaches whole-number coefficients that reproduce the general interpolation", () => {
    expect(TUTORIAL_LAGRANGE_COEFFICIENTS).toHaveLength(TUTORIAL_OPPONENT_SHARES.length);
    const byHand = TUTORIAL_OPPONENT_SHARES.reduce(
      (total, share, index) => total + TUTORIAL_LAGRANGE_COEFFICIENTS[index]! * share.value,
      0,
    );
    const reduced = ((byHand % TUTORIAL_PRIME) + TUTORIAL_PRIME) % TUTORIAL_PRIME;
    expect(String(reduced)).toBe(CORRECT);
  });

  /** The worked example must work, and must not be the exercise's answer. */
  it("ships a worked example that checks out and gives a different answer", () => {
    const byHand = TUTORIAL_WORKED_EXAMPLE.shares.reduce(
      (total, share, index) => total + TUTORIAL_LAGRANGE_COEFFICIENTS[index]! * share.value,
      0,
    );
    const reduced = ((byHand % TUTORIAL_PRIME) + TUTORIAL_PRIME) % TUTORIAL_PRIME;
    expect(reduced).toBe(TUTORIAL_WORKED_EXAMPLE.answer);
    expect(String(TUTORIAL_WORKED_EXAMPLE.answer)).not.toBe(CORRECT);
  });

  it("accepts only the reconstructed value", () => {
    expect(checkTutorialHunt(CORRECT)).toBe("correct");
    expect(checkTutorialHunt(` ${CORRECT} `)).toBe("correct");
    const wrong = String((Number(CORRECT) + 1) % TUTORIAL_PRIME);
    expect(checkTutorialHunt(wrong)).toBe("wrong");
  });

  /**
   * `-12` is the honest intermediate result before taking the remainder.
   * Rejecting it rather than normalising it keeps the step being taught --
   * "reduce it into 0..16" -- from being done for the participant.
   */
  it("rejects input that has not been reduced into the field", () => {
    expect(checkTutorialHunt("")).toBe("malformed");
    expect(checkTutorialHunt("-12")).toBe("malformed");
    expect(checkTutorialHunt(String(TUTORIAL_PRIME))).toBe("malformed");
    expect(checkTutorialHunt("five")).toBe("malformed");
  });

  it("does not advance the stage on a wrong or empty answer", () => {
    const proved = advanceTutorial(advanceTutorial(createTutorialState()));
    expect(proved.stage).toBe("proved");

    const wrong = advanceTutorial(proved, { kind: "hunt", answer: "0" });
    expect(wrong.stage).toBe("proved");
    expect(wrong.attempt).toBe(Number(CORRECT) === 0 ? null : "wrong");
    expect(wrong.recoveredSecret).toBeUndefined();
    expect(wrong.score).toBe(proved.score);

    // A bare press with nothing typed is an unfinished attempt, not a pass.
    const empty = advanceTutorial(proved);
    expect(empty.stage).toBe("proved");
    expect(empty.attempt).toBe("malformed");
    expect(empty.recoveredSecret).toBeUndefined();
  });

  /**
   * The Portal must never hand over the answer. `advanceTutorial` echoes the
   * participant's own string back, so a rendered "recovered secret" can only
   * ever be something they typed.
   */
  it("echoes the participant's own answer rather than computing one", () => {
    const proved = advanceTutorial(advanceTutorial(createTutorialState()));
    const hunted = advanceTutorial(proved, { kind: "hunt", answer: ` ${CORRECT} ` });
    expect(hunted.recoveredSecret).toBe(CORRECT);
  });

  /**
   * The paper-sized Schnorr has to actually verify, or the optional PROVE
   * detour teaches a worked example that does not work.
   */
  it("ships a toy Schnorr whose verification equation holds", () => {
    const { p, q, g, w, r, e, publicValue, commitment, response, verifies } = TUTORIAL_TOY_SCHNORR;
    const modPow = (base: number, exponent: number, prime: number): number => {
      let result = 1;
      let factor = base % prime;
      for (let remaining = exponent; remaining > 0; remaining = Math.floor(remaining / 2)) {
        if (remaining % 2 === 1) result = (result * factor) % prime;
        factor = (factor * factor) % prime;
      }
      return result;
    };
    expect(modPow(g, q, p)).toBe(1); // g really generates the order-q subgroup
    expect(modPow(g, w, p)).toBe(publicValue);
    expect(modPow(g, r, p)).toBe(commitment);
    expect((r + e * w) % q).toBe(response);
    expect(modPow(g, response, p)).toBe(verifies);
    expect((commitment * modPow(publicValue, e, p)) % p).toBe(verifies);
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
