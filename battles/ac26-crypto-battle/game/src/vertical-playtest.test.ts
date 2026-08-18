/**
 * 2-team, 20-30 min scripted vertical playtest (Issue #486 PR5).
 *
 * This file replays the concrete, deterministic `PlaytestScript`
 * `vertical-playtest-fixture.ts`'s `buildVerticalPlaytestScript()` composes
 * for a scaled-down 25-min match between two teams -- "alpha" (plays mostly
 * LEAK) and "bravo" (plays mostly PROVE, then HUNTs alpha) -- via
 * `playtest.ts`'s `runScript`, and asserts against the resulting
 * `PlaytestResult.timeline` / `.finalState`.
 *
 * The narrative itself is authored by `buildVerticalPlaytestScript()`: it
 * drives the reducer live once (tick / validateOp / applyOp, reading state
 * via `projectForTeam` the same way the op-builder helpers in playtest.ts
 * are documented to), recording each tick/op it performs as a
 * `PlaytestStep`. That recorded step list IS the `PlaytestScript` handed to
 * `runScript` here -- so this file is itself the proof that the script,
 * once written down, replays deterministically (Issue #486's "120分
 * debrief / Replay" section: a scripted fixture is meant to be replayable,
 * not just a one-off simulation). `replay.test.ts` separately builds a
 * debrief timeline from this SAME script's final state, via the shared
 * fixture module (not by importing this test file).
 *
 * This test intentionally exercises the REAL contract-issuance schedule
 * (via `tick`), not synthetic injected contracts the way some reducer-level
 * unit tests do (e.g. reducer.test.ts's `leakThreshold` helper) -- the
 * whole point of a vertical playtest is to show the actual deterministic
 * fixtures.ts-derived schedule producing a playable match end to end.
 *
 * Maps to Issue #486's "MVP / Vertical Slice" 10-item MUST list:
 *   1. secret/shares generated for both teams       -- see "MUST 1" test
 *   2. a Contract arrives                            -- fixture's tick(0)
 *   3. LEAK completes a Contract                      -- alpha's LEAK loop
 *   4. PROVE completes the same-value Contract, secretless -- bravo's PROVE loop
 *   5. LEAK artifact lands on the Public Ledger        -- see "MUST 2/3/5" test
 *   6. an attacker reconstructs the secret from threshold-many ledger shares
 *      -- buildHuntOp, built from projectForTeam("bravo") only
 *   7. HUNT is checked by the trusted verifier (validateOp's mod() check)
 *      -- see "MUST 6/7/8" test
 *   8. score changes on a successful HUNT              -- see "MUST 6/7/8" test
 *   9. post-ROTATE, old-generation leaks cannot HUNT the new secret
 *      -- see "MUST 9" tests
 *  10. UI-level "advance / hunt / defend" tension       -- NOT verifiable by
 *      a scripted, no-UI fixture; see OPERATOR.md's "Tuning notes" section
 *      and this repo's AGENTS.md "検証" contract: a scripted playtest is not
 *      a substitute for a real, human playtest.
 */

import { describe, expect, test } from "bun:test";
import { initialState, projectForTeam } from "./reducer.ts";
import { isTickStep, runScript, type PlaytestOpStep } from "./playtest.ts";
import {
  ATTACKER,
  buildVerticalPlaytestScript,
  DEFENDER,
  EVENT_ID,
  TEAMS,
  VERTICAL_CONFIG,
} from "./vertical-playtest-fixture.ts";

const built = buildVerticalPlaytestScript();
const result = runScript(built.script);

describe("vertical playtest (Issue #486 PR5): 2-team, 25-min scripted fixture", () => {
  test("the script replays with zero expectation violations (deterministic replay -- see runScript's doc comment)", () => {
    expect(result.violations).toEqual([]);
  });

  test("replaying the SAME script twice produces byte-for-byte identical results (purity contract)", () => {
    const again = runScript(built.script);
    expect(again).toEqual(result);
  });

  test("MUST 1: both teams start with a secret and shareCount shares (initialState, independently)", () => {
    const fresh = initialState({ eventId: EVENT_ID, teamIds: TEAMS }, VERTICAL_CONFIG);
    for (const teamId of TEAMS) {
      const team = fresh.teams[teamId];
      if (!team) throw new Error(`expected team ${teamId}`);
      expect(team.secret.length).toBeGreaterThan(0);
      expect(team.shares).toHaveLength(fresh.config.shareCount);
      expect(team.score).toBe(0);
      expect(team.generation).toBe(1);
    }
  });

  test("MUST 2/3/5: alpha's LEAKs actually posted ShareArtifacts to the Public Ledger", () => {
    const alphaShares = result.finalState.publicLedger.filter(
      (a) => a.kind === "share" && a.teamId === DEFENDER,
    );
    expect(alphaShares.length).toBeGreaterThanOrEqual(result.finalState.config.threshold);
  });

  test("MUST 4: bravo's PROVEs never posted a ShareArtifact -- only ProofArtifacts, and never a share value", () => {
    const bravoLedgerEntries = result.finalState.publicLedger.filter((a) => a.teamId === ATTACKER);
    expect(bravoLedgerEntries.length).toBeGreaterThan(0);
    expect(bravoLedgerEntries.every((a) => a.kind === "proof")).toBe(true);
  });

  test("PROVE and LEAK pay identical base points for a standard-kind contract (Issue #486 Scoring MUST)", () => {
    const standardLeak = result.finalState.contracts.find(
      (c) => c.teamId === DEFENDER && c.kind === "standard" && c.resolution === "leak",
    );
    const standardProve = result.finalState.contracts.find(
      (c) => c.teamId === ATTACKER && c.kind === "standard" && c.resolution === "prove",
    );
    if (!standardLeak || !standardProve) {
      throw new Error(
        "test setup: expected at least one standard-kind LEAK (alpha) and one standard-kind PROVE (bravo) in this script's contract history",
      );
    }
    expect(standardLeak.points).toBe(result.finalState.config.scores.contract);
    expect(standardProve.points).toBe(result.finalState.config.scores.contract);
    expect(standardLeak.points).toBe(standardProve.points);
  });

  test("MUST 6/7/8: bravo's HUNT was built from public information only, verified by the trusted reducer, and moved both scores", () => {
    const huntStepIndex = built.script.steps.findIndex((s) => !isTickStep(s) && s.op.kind === "hunt" && s.expect === "ok");
    if (huntStepIndex < 0) throw new Error("expected a successful hunt step in the built script");
    const huntStep = built.script.steps[huntStepIndex] as PlaytestOpStep;
    if (huntStep.op.kind !== "hunt") throw new Error("expected a hunt op");

    // "public information only": the recoveredSecret was Lagrange-interpolated
    // by buildHuntOp from projectForTeam("bravo").publicLedger -- a value
    // buildHuntOp (see playtest.ts) can only ever compute from ledger shares,
    // never from state.teams.alpha.secret directly. Independently confirm
    // bravo's own projection carries alpha's PUBLIC commitment (never its
    // secret) at match start, the same public surface buildHuntOp relies on.
    const bravoView = projectForTeam(initialState({ eventId: EVENT_ID, teamIds: TEAMS }, VERTICAL_CONFIG), ATTACKER);
    expect(bravoView.publicCommitments[DEFENDER]).toBeDefined();
    expect(JSON.stringify(bravoView)).not.toContain(huntStep.op.recoveredSecret);

    const before = result.timeline[huntStepIndex - 1];
    const after = result.timeline[huntStepIndex];
    if (!before || !after) throw new Error("expected timeline entries around the hunt step");
    expect(after.scores[ATTACKER]).toBe((before.scores[ATTACKER] ?? 0) + result.finalState.config.scores.huntBonus);
    expect(after.scores[DEFENDER]).toBe(
      Math.max(0, (before.scores[DEFENDER] ?? 0) - result.finalState.config.scores.huntPenalty),
    );
  });

  test("MUST 9: ROTATE voids alpha's own open contract, and old-generation HUNTs are rejected after it", () => {
    const voided = result.finalState.contracts.find((c) => c.id === built.alphaContractVoidedByRotateId);
    expect(voided?.status).toBe("expired");
    expect(result.finalState.teams[DEFENDER]?.generation).toBe(2);

    const rejectedHuntSteps = built.script.steps.filter(
      (s): s is PlaytestOpStep => !isTickStep(s) && s.op.kind === "hunt" && s.expect === "rejected",
    );
    expect(rejectedHuntSteps.length).toBeGreaterThanOrEqual(2);

    // Structural check from buildVerticalPlaytestScript: before any
    // generation-2 share was leaked, a participant's own tooling
    // (buildHuntOp) could not even construct a hunt attempt -- there was
    // nothing on the ledger to build one from yet.
    expect(built.huntAttemptBeforeNewGenerationThreshold).toBeUndefined();
  });

  test("MUST 9 (\"全 op 拒否\"): every op kind is rejected once the match has ended", () => {
    expect(result.finalState.phase).toBe("ended");
    const matchEndAtMs = (result.finalState.startedAtMs ?? 0) + result.finalState.config.matchDurationMs;
    const postEndSteps = built.script.steps.filter(
      (s): s is PlaytestOpStep => !isTickStep(s) && s.atMs >= matchEndAtMs,
    );
    expect(postEndSteps.length).toBeGreaterThanOrEqual(4);
    expect(postEndSteps.every((s) => s.expect === "rejected")).toBe(true);
    const kinds = new Set(postEndSteps.map((s) => s.op.kind));
    expect(kinds).toEqual(new Set(["leak", "prove", "rotate", "hunt"]));
  });

  test("MUST 10 (UI-level 'advance / hunt / defend' tension) is NOT claimed here -- a scripted fixture has no UI or human decision point; see OPERATOR.md's Tuning notes", () => {
    // Deliberately a documentation-only assertion (always true): this test
    // exists so the MUST-10 gap is visible in `bun test` output, not just in
    // a doc comment nobody reads while triaging a failure.
    expect(true).toBe(true);
  });

  test("final score reconciliation: each team's final score equals the sum of its individual scoring events", () => {
    function pointsForContract(contractId: string): number {
      const contract = result.finalState.contracts.find((c) => c.id === contractId);
      if (!contract) throw new Error(`test setup: expected contract ${contractId} in final state`);
      return contract.points;
    }

    const expected: Record<string, number> = { [DEFENDER]: 0, [ATTACKER]: 0 };
    for (const step of built.script.steps) {
      if (isTickStep(step) || step.expect !== "ok") continue;
      if (step.op.kind === "leak" || step.op.kind === "prove") {
        expected[step.teamId] = (expected[step.teamId] ?? 0) + pointsForContract(step.op.contractId);
      } else if (step.op.kind === "hunt") {
        expected[step.teamId] = (expected[step.teamId] ?? 0) + result.finalState.config.scores.huntBonus;
        expected[step.op.targetTeamId] = (expected[step.op.targetTeamId] ?? 0) - result.finalState.config.scores.huntPenalty;
      }
    }

    // The additive reconciliation above does not model applyHunt's
    // `Math.max(0, ...)` floor -- assert the floor was never actually
    // reached in this script, so a simple sum is a valid check (not a
    // coincidentally-passing one).
    expect(expected[DEFENDER]).toBeGreaterThanOrEqual(0);
    expect(result.finalState.teams[DEFENDER]?.score).toBe(expected[DEFENDER]);
    expect(result.finalState.teams[ATTACKER]?.score).toBe(expected[ATTACKER]);
  });

  test("narrative sanity: the built script tells a coherent LEAK -> PROVE -> HUNT -> ROTATE -> rejected-hunt -> match-end story", () => {
    expect(built.narrative.length).toBeGreaterThan(0);
    const joined = built.narrative.join("\n");
    expect(joined).toContain("LEAK");
    expect(joined).toContain("PROVE");
    expect(joined).toContain("HUNT");
    expect(joined).toContain("ROTATE");
    expect(joined).toMatch(/rejected/);
  });
});
