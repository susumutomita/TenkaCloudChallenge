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
import { initialState } from "./reducer.ts";
import { isTickStep, runScript, type PlaytestOpStep, startedMatch } from "./playtest.ts";
import {
  ATTACKER,
  buildVerticalPlaytestScript,
  DEFENDER,
  EVENT_ID,
  MATCH_SECRET,
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
    const fresh = startedMatch(
      { eventId: EVENT_ID, teamIds: TEAMS, matchSecret: MATCH_SECRET },
      VERTICAL_CONFIG,
    );
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
    // `result.finalState.publicLedger` holds the compact persisted form
    // (`StoredArtifact`, see ledger-codec.ts): `k`/`tm` below are that form's
    // own field names.
    const alphaShares = result.finalState.publicLedger.filter(
      (a) => a.k === "share" && a.tm === DEFENDER,
    );
    expect(alphaShares.length).toBeGreaterThanOrEqual(result.finalState.config.threshold);
  });

  test("MUST 4: bravo never posted a ShareArtifact -- it only ever used methods that publish nothing reconstructable", () => {
    const bravoLedgerEntries = result.finalState.publicLedger.filter((a) => a.tm === ATTACKER);
    expect(bravoLedgerEntries.length).toBeGreaterThan(0);
    // [Issue #645] bravo now answers FHE and MPC Orders too, so its ledger
    // carries ciphertexts and masked partials alongside its proof transcripts.
    // The MUST that matters is unchanged and is asserted directly: not one of
    // those entries is a share. A whitelist of "proof only" would have started
    // failing for a reason that has nothing to do with the property.
    expect(bravoLedgerEntries.some((a) => a.k === "share")).toBe(false);
    expect(new Set(bravoLedgerEntries.map((a) => a.k))).toEqual(
      new Set(["sudoku-reveal", "ciphertext", "partial"]),
    );
  });

  test("PROVE and LEAK pay identical base points for a standard-kind contract (Issue #486 Scoring MUST)", () => {
    const seen = [...result.ordersSeen.values()];
    const standardLeak = seen.find(
      (c) => c.teamId === DEFENDER && c.kind === "standard" && c.resolution === "leak",
    );
    const standardProve = seen.find(
      (c) => c.teamId === ATTACKER && c.kind === "standard" && c.resolution === "prove",
    );
    if (!standardLeak || !standardProve) {
      throw new Error(
        "test setup: expected at least one standard-kind LEAK (alpha) and one standard-kind PROVE (bravo) in this script's contract history",
      );
    }
    // [Issue #659] Both Orders are worth the same to COMPUTE — the Order's rate
    // does not depend on which method the team later chooses. What differs is
    // the payout: LEAK pays `leakPoints`, and that is strictly less.
    expect(standardLeak.points).toBe(result.finalState.config.scores.contract);
    expect(standardProve.points).toBe(result.finalState.config.scores.contract);
    expect(standardLeak.leakPoints).toBeLessThan(standardLeak.points);
  });

  test("MUST 6/7/8: bravo's HUNT was built from public information only, verified by the trusted reducer, and moved both scores", () => {
    const huntStepIndex = built.script.steps.findIndex((s) => !isTickStep(s) && s.op.kind === "hunt" && s.expect === "ok");
    if (huntStepIndex < 0) throw new Error("expected a successful hunt step in the built script");
    const huntStep = built.script.steps[huntStepIndex] as PlaytestOpStep;
    if (huntStep.op.kind !== "hunt") throw new Error("expected a hunt op");

    // "public information only": the recoveredSecret was Lagrange-interpolated
    // by buildHuntOp from projectForTeam("bravo").publicLedger -- a value
    // buildHuntOp (see playtest.ts) can only ever compute from ledger shares,
    // never from state.teams.alpha.secret directly. Assert this against the
    // ACTUAL projection buildHuntOp was called with (built.bravoProjectionBeforeHunt,
    // captured by the fixture at that exact moment) -- not a fresh/empty
    // initialState projection, which would pass this check trivially
    // because it never had alpha's secret material to leak in the first
    // place. At the point this projection was captured, alpha had already
    // leaked `threshold` shares onto the Public Ledger (that is what made
    // the hunt buildable at all) and alpha's `secret` / un-leaked shares
    // must still not appear anywhere in it.
    const bravoProjection = built.bravoProjectionBeforeHunt;
    expect(bravoProjection.publicPuzzles[DEFENDER]).toBeDefined();
    const alphaLeakedShareCount = bravoProjection.publicLedger.filter(
      (a) => a.kind === "share" && a.teamId === DEFENDER,
    ).length;
    expect(alphaLeakedShareCount).toBeGreaterThanOrEqual(result.finalState.config.threshold);

    const alphaSecretAtHuntTime = (() => {
      // Independently derive alpha's pre-hunt (generation-1) secret from the
      // real reducer, purely to have something concrete to assert absence
      // of below -- this does NOT feed into how the hunt op itself was
      // built (that already happened, live, inside buildVerticalPlaytestScript).
      const fresh = startedMatch(
        { eventId: EVENT_ID, teamIds: TEAMS, matchSecret: MATCH_SECRET },
        VERTICAL_CONFIG,
      );
      const alpha = fresh.teams[DEFENDER];
      if (!alpha) throw new Error("test setup: expected team alpha");
      return alpha.secret;
    })();
    const projectionJson = JSON.stringify(bravoProjection);
    expect(projectionJson).not.toContain(alphaSecretAtHuntTime);
    expect(projectionJson).not.toContain(huntStep.op.recoveredSecret);

    const before = result.timeline[huntStepIndex - 1];
    const after = result.timeline[huntStepIndex];
    if (!before || !after) throw new Error("expected timeline entries around the hunt step");
    expect(after.scores[ATTACKER]).toBe((before.scores[ATTACKER] ?? 0) + result.finalState.config.scores.huntBonus);
    expect(after.scores[DEFENDER]).toBe(
      Math.max(0, (before.scores[DEFENDER] ?? 0) - result.finalState.config.scores.huntPenalty),
    );
  });

  test("MUST 9: ROTATE voids alpha's own open contract, and old-generation HUNTs are rejected after it", () => {
    const voided = result.ordersSeen.get(built.alphaContractVoidedByRotateId);
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
    expect(kinds).toEqual(new Set(["leak", "prove-sudoku", "rotate", "hunt"]));
  });

  test("MUST 10 (UI-level 'advance / hunt / defend' tension) is NOT claimed here -- a scripted fixture has no UI or human decision point; see OPERATOR.md's Tuning notes", () => {
    // Deliberately a documentation-only assertion (always true): this test
    // exists so the MUST-10 gap is visible in `bun test` output, not just in
    // a doc comment nobody reads while triaging a failure.
    expect(true).toBe(true);
  });

  test("final score reconciliation: each team's final score equals the sum of its individual scoring events", () => {
    // [Issue #659] From `ordersSeen`, not the final state: resolved Orders are
    // pruned from the persisted row past a short retention window, so the final
    // state is a working queue rather than a history.
    function contractById(contractId: string) {
      const contract = result.ordersSeen.get(contractId);
      if (!contract) throw new Error(`test setup: expected contract ${contractId} in the run`);
      return contract;
    }

    const expected: Record<string, number> = { [DEFENDER]: 0, [ATTACKER]: 0 };
    for (const step of built.script.steps) {
      if (isTickStep(step) || step.expect !== "ok") continue;
      // [Issue #659] Computing an Order and passing on it pay DIFFERENT rates,
      // and the difference is the whole point of the scoring model: PROVE,
      // CIPHER, FHE and MPC all pay the Order's `points` because all four are
      // the team doing the work, while LEAK pays the lower `leakPoints` because
      // the system answered and what it answered became public. Reconciling
      // both against `points` would let a regression that paid the full rate
      // for a LEAK pass here.
      if (step.op.kind === "leak") {
        expected[step.teamId] = (expected[step.teamId] ?? 0) + contractById(step.op.contractId).leakPoints;
      } else if (
        step.op.kind === "prove-sudoku" ||
        step.op.kind === "cipher" ||
        step.op.kind === "fhe" ||
        step.op.kind === "mpc"
      ) {
        expected[step.teamId] = (expected[step.teamId] ?? 0) + contractById(step.op.contractId).points;
      } else if (step.op.kind === "hunt") {
        // [Issue #696] A HUNT that lands is not necessarily a HUNT that HITS.
        // A wrong value is now an accepted move that costs the attacker
        // `wrongHunt` and moves nobody else -- the script exercises exactly one
        // (MUST 9's stale reconstruction), and reconciling every hunt as a hit
        // would silently absorb a regression that paid the bonus for a miss.
        const hit = result.finalState.successfulHunts.includes(
          JSON.stringify([step.teamId, step.op.targetTeamId, step.op.generation]),
        );
        if (hit) {
          expected[step.teamId] = (expected[step.teamId] ?? 0) + result.finalState.config.scores.huntBonus;
          expected[step.op.targetTeamId] =
            (expected[step.op.targetTeamId] ?? 0) - result.finalState.config.scores.huntPenalty;
        } else {
          expected[step.teamId] = (expected[step.teamId] ?? 0) - result.finalState.config.scores.wrongHunt;
        }
      }
    }

    // [Issue #659] Summing the SCRIPT's steps is only a complete account of the
    // score while nothing scores outside them, and the expiry penalty does
    // exactly that -- it is charged by `tick`, for Orders no step ever touches.
    // This fixture switches it off on purpose (see VERTICAL_CONFIG); assert
    // that here, so if it is ever switched back on this reconciliation fails
    // loudly instead of quietly checking an incomplete sum.
    expect(result.finalState.config.scores.expiredOrder).toBe(0);

    // Neither `applyHunt` nor `applyExpiryPenalties` models its `Math.max(0,
    // ...)` floor in the sum above -- assert the floor was never actually
    // reached in this script, so a simple sum is a valid check (not a
    // coincidentally-passing one).
    expect(expected[DEFENDER]).toBeGreaterThanOrEqual(0);
    expect(expected[ATTACKER]).toBeGreaterThanOrEqual(0);
    expect(result.finalState.teams[DEFENDER]?.score).toBe(expected[DEFENDER]);
    expect(result.finalState.teams[ATTACKER]?.score).toBe(expected[ATTACKER]);
  });

  test("narrative sanity: the built script actually contains every op kind, and at least one rejected step", () => {
    // Checks the script's real data (op.kind / expect), not narrative prose
    // strings -- a wording change to buildVerticalPlaytestScript's `label`
    // text must never be able to silently make this test meaningless.
    const opSteps = built.script.steps.filter((s): s is PlaytestOpStep => !isTickStep(s));
    expect(opSteps.length).toBeGreaterThan(0);
    const kinds = new Set(opSteps.map((s) => s.op.kind));
    expect(kinds).toEqual(
      new Set(["leak", "prove-sudoku", "cipher", "fhe", "mpc", "hunt", "rotate"]),
    );
    expect(opSteps.some((s) => s.expect === "rejected")).toBe(true);
    expect(opSteps.some((s) => s.expect === "ok")).toBe(true);

    // narrative is still produced (README/OPERATOR.md-facing readability),
    // just not what this test's pass/fail depends on.
    expect(built.narrative).toHaveLength(opSteps.length);
  });
});
