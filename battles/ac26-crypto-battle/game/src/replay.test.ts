/**
 * Replay reconstruction tests (Issue #486 PR5).
 *
 * The primary fixture here is `vertical-playtest-fixture.ts`'s
 * `buildVerticalPlaytestScript()` -- the SAME 2-team, 25-min scripted match
 * `vertical-playtest.test.ts` replays and asserts the Issue #486 vertical-
 * slice MUST list against. This file replays that identical script via
 * `playtest.ts`'s `runScript` and feeds the run's `finalState` into
 * `buildReplay` / `keyMoments`, asserting the resulting timeline actually
 * narrates the scripted story (threshold crossed, hunt success, rotate
 * invalidating leaks), in both ja and en -- matching Issue #486's "120分
 * debrief / Replay" example format ("34:10 Team A LEAK share #1", ...,
 * "58:01 Team B HUNT success").
 *
 * A second block of tests exercises `buildReplay` / `keyMoments` directly
 * against `reducer.ts` (not through the vertical-playtest fixture) for edge
 * cases that fixture does not hit on its own: an in-progress match with no
 * hunt/rotate yet, phase-change boundary timing, and a team that rotates
 * more than once (only the latest rotate timestamp survives in state -- see
 * replay.ts's header on why).
 */

import { describe, expect, test } from "bun:test";
import { buildFheOp, buildMpcOp, startedMatch } from "./playtest.ts";
import { applyOp, initialState, projectForTeam, tick, validateOp } from "./reducer.ts";
import { runScript } from "./playtest.ts";
import { buildReplay, keyMoments, type ReplayEvent } from "./replay.ts";
import { ATTACKER, buildVerticalPlaytestScript, DEFENDER, TEAMS } from "./vertical-playtest-fixture.ts";

describe("buildReplay / keyMoments: against the vertical playtest's actual final state", () => {
  const built = buildVerticalPlaytestScript();
  const result = runScript(built.script);
  const replay = buildReplay(result.finalState);
  const moments = keyMoments(replay, result.finalState);

  test("every LEAK/PROVE/HUNT/ROTATE from the script appears as a ReplayEvent, in chronological order, in both languages", () => {
    for (let i = 1; i < replay.length; i += 1) {
      const prev = replay[i - 1];
      const cur = replay[i];
      if (!prev || !cur) throw new Error("test setup");
      expect(cur.atMs).toBeGreaterThanOrEqual(prev.atMs);
    }

    const alphaLeaks = replay.filter((e) => e.kind === "leak" && e.teamId === DEFENDER);
    expect(alphaLeaks.length).toBeGreaterThanOrEqual(result.finalState.config.threshold);
    for (const event of alphaLeaks) {
      expect(event.summary.en).toMatch(/LEAK/);
      expect(event.summary.ja).toMatch(/LEAK/);
    }

    const bravoProves = replay.filter((e) => e.kind === "prove" && e.teamId === ATTACKER);
    expect(bravoProves.length).toBeGreaterThan(0);
    for (const event of bravoProves) {
      expect(event.summary.en).toMatch(/PROVE/);
      expect(event.summary.ja).toMatch(/PROVE/);
    }

    const huntEvent = replay.find((e) => e.kind === "hunt-success");
    if (!huntEvent || huntEvent.kind !== "hunt-success") throw new Error("expected a hunt-success ReplayEvent");
    expect(huntEvent.teamId).toBe(ATTACKER);
    expect(huntEvent.detail.targetTeamId).toBe(DEFENDER);
    expect(huntEvent.summary.en).toMatch(/HUNT success/);
    expect(huntEvent.summary.ja).toMatch(/HUNT 成功/);
    // Sourced from huntLog (Issue #486 PR5 addition), not fabricated.
    expect(result.finalState.huntLog).toHaveLength(1);
    const loggedHunt = result.finalState.huntLog[0];
    if (!loggedHunt) throw new Error("expected a huntLog entry");
    expect(huntEvent.atMs).toBe(loggedHunt.atMs);

    const rotateEvent = replay.find((e) => e.kind === "rotate");
    if (!rotateEvent || rotateEvent.kind !== "rotate") throw new Error("expected a rotate ReplayEvent");
    expect(rotateEvent.teamId).toBe(DEFENDER);
    expect(rotateEvent.detail.generation).toBe(2);
    expect(rotateEvent.summary.en).toMatch(/ROTATE/);
    expect(rotateEvent.summary.ja).toMatch(/ROTATE/);

    // The scripted narrative is LEAK/PROVE -> HUNT -> ROTATE, in that order.
    expect(huntEvent.atMs).toBeLessThanOrEqual(rotateEvent.atMs);

    const phaseEvents = replay.filter((e) => e.kind === "phase-change");
    expect(phaseEvents.length).toBeGreaterThan(0);
    for (const event of phaseEvents) {
      expect(event.summary.en).toMatch(/Match phase/);
      expect(event.summary.ja).toMatch(/試合フェーズ/);
    }
  });

  test("keyMoments flags the exact LEAK that crossed the threshold, and the ROTATE's invalidated-leak count, in both languages", () => {
    const thresholdMoment = moments.find((m) => m.kind === "threshold-crossed" && m.teamId === DEFENDER);
    if (!thresholdMoment) throw new Error("expected a threshold-crossed key moment for alpha");
    expect(thresholdMoment.detail.threshold).toBe(result.finalState.config.threshold);
    expect(thresholdMoment.summary.en).toMatch(/reconstructable/);
    expect(thresholdMoment.summary.ja).toMatch(/復元可能/);
    // The moment must coincide with one of alpha's actual LEAK events, not
    // an arbitrary/synthetic timestamp.
    const alphaLeakTimestamps = new Set(
      replay.filter((e) => e.kind === "leak" && e.teamId === DEFENDER).map((e) => e.atMs),
    );
    expect(alphaLeakTimestamps.has(thresholdMoment.atMs)).toBe(true);

    const rotateMoment = moments.find((m) => m.kind === "rotate-invalidated-leaks" && m.teamId === DEFENDER);
    if (!rotateMoment) throw new Error("expected a rotate-invalidated-leaks key moment for alpha");
    expect(rotateMoment.detail.invalidatedShareCount).toBe(result.finalState.config.threshold);
    expect(rotateMoment.detail.priorGeneration).toBe(1);
    expect(rotateMoment.summary.en).toMatch(/invalidated/);
    expect(rotateMoment.summary.ja).toMatch(/無効/);

    // threshold-crossed strictly precedes the hunt it made possible, and the
    // hunt strictly precedes the rotate it provoked -- the causal order a
    // debrief facilitator would narrate.
    const huntEvent = replay.find((e) => e.kind === "hunt-success");
    if (!huntEvent) throw new Error("expected a hunt-success event");
    expect(thresholdMoment.atMs).toBeLessThanOrEqual(huntEvent.atMs);
    expect(huntEvent.atMs).toBeLessThanOrEqual(rotateMoment.atMs);
  });

  test("buildReplay / keyMoments never leak a team's secret, witness, or an un-leaked share value", () => {
    // finalState still holds alpha's post-rotate (generation 2) secret/shares
    // directly, plus bravo's secret (bravo never rotated) -- exactly the
    // material a replay must never surface.
    const alphaSecret = result.finalState.teams[DEFENDER]?.secret;
    const bravoSecret = result.finalState.teams[ATTACKER]?.secret;
    if (!alphaSecret || !bravoSecret) throw new Error("test setup: expected both teams");
    const unleakedShareValues = [
      ...(result.finalState.teams[DEFENDER]?.shares ?? []),
      ...(result.finalState.teams[ATTACKER]?.shares ?? []),
    ]
      .map((s) => s.value)
      .filter((v) => !result.finalState.publicLedger.some((a) => a.kind === "share" && a.value === v));
    expect(unleakedShareValues.length).toBeGreaterThan(0);

    const serialized = JSON.stringify({ replay, moments });
    expect(serialized).not.toContain(alphaSecret);
    expect(serialized).not.toContain(bravoSecret);
    for (const value of unleakedShareValues) {
      expect(serialized).not.toContain(value);
    }
  });
});

describe("buildReplay: edge cases the vertical-playtest fixture does not exercise on its own", () => {
  test("an in-progress match with no successful hunt or rotate yet produces only leak/prove/phase-change events, and zero key moments", () => {
    let state = tick(startedMatch({ eventId: "replay-in-progress", teamIds: TEAMS }), 0);
    const alphaOpen = state.contracts.find((c) => c.teamId === "alpha" && c.status === "open");
    if (!alphaOpen) throw new Error("test setup: expected an open contract");
    state = applyOp(state, "alpha", { kind: "leak", contractId: alphaOpen.id });

    const replay = buildReplay(state);
    expect(replay.some((e) => e.kind === "hunt-success")).toBe(false);
    expect(replay.some((e) => e.kind === "rotate")).toBe(false);
    expect(replay.some((e) => e.kind === "leak")).toBe(true);

    expect(keyMoments(replay, state)).toEqual([]);
  });

  test("a match that has not reached pressure yet reports no phase-change events at all", () => {
    const state = tick(startedMatch({ eventId: "replay-phase-early", teamIds: TEAMS }), 0);
    expect(buildReplay(state).filter((e) => e.kind === "phase-change")).toEqual([]);
  });

  test("a match ticked all the way to match end reports all three phase-change boundaries, in order", () => {
    let state = tick(startedMatch({ eventId: "replay-phase-full", teamIds: TEAMS }), 0);
    state = tick(state, state.config.matchDurationMs);
    const phaseEvents = buildReplay(state).filter(
      (e): e is Extract<ReplayEvent, { kind: "phase-change" }> => e.kind === "phase-change",
    );
    expect(phaseEvents.map((e) => e.detail.phase)).toEqual(["pressure", "endgame", "ended"]);
  });

  test("a team that rotates more than once: only the most recent rotate's timestamp is reported, with an explicit multi-rotate note in both languages", () => {
    let state = tick(startedMatch({ eventId: "replay-multi-rotate", teamIds: TEAMS }), 0);
    state = applyOp(state, "alpha", { kind: "rotate" });
    state = tick(state, state.config.rotateCooldownMs);
    state = applyOp(state, "alpha", { kind: "rotate" });
    expect(state.teams.alpha?.generation).toBe(3);

    const replay = buildReplay(state);
    const rotateEvents = replay.filter((e) => e.kind === "rotate" && e.teamId === "alpha");
    // Only ONE rotate event, not two -- the first rotate's timestamp is gone
    // from state (TeamState.lastRotateAtMs holds only the latest).
    expect(rotateEvents).toHaveLength(1);
    const rotateEvent = rotateEvents[0];
    if (!rotateEvent || rotateEvent.kind !== "rotate") throw new Error("expected a rotate event");
    const lastRotateAtMs = state.teams.alpha?.lastRotateAtMs;
    if (lastRotateAtMs === undefined) throw new Error("expected alpha to have rotated");
    expect(rotateEvent.atMs).toBe(lastRotateAtMs);
    expect(rotateEvent.detail.priorRotateCount).toBe(2);
    expect(rotateEvent.summary.en).toMatch(/only this, the MOST RECENT rotate/);
    expect(rotateEvent.summary.ja).toMatch(/直近の rotate 時刻のみ/);
  });

  test("a failed HUNT attempt leaves no trace in the replay (validateOp rejects it, applyOp is never called)", () => {
    const state = tick(startedMatch({ eventId: "replay-failed-hunt", teamIds: TEAMS }), 0);
    const before = buildReplay(state);

    const wrongGuess = { kind: "hunt", targetTeamId: "bravo", generation: 1, recoveredSecret: "0" } as const;
    const verdict = validateOp(state, "alpha", wrongGuess);
    expect(verdict.ok).toBe(false);

    // `state` itself is untouched (applyOp is never reached for a rejected
    // op), so the replay built from it is byte-for-byte identical to before
    // the attempt -- per this module's header, "failed HUNT attempts leave
    // ZERO trace" is not a documentation claim only, it is this assertion.
    expect(buildReplay(state)).toEqual(before);
  });
});

/**
 * [Issue #645] A debrief must name the method a team actually used.
 *
 * The regression this pins: `buildReplay` used `if (share) ... else prove`,
 * which was exhaustive only while PROVE was the sole non-share method. A match
 * completing an FHE or MPC Order then produced a replay claiming the team had
 * PROVEd — a debrief that lies about what happened is worse than one that omits
 * it, because a participant reviewing the match cannot tell.
 */
describe("Issue #645: the replay names every method", () => {
  test("an FHE and an MPC completion appear as themselves, never as PROVE", () => {
    let state = tick(startedMatch({ eventId: "replay-645", teamIds: ["teamA", "teamB"] }), 0);

    for (let round = 0; round < 8; round += 1) {
      for (const order of projectForTeam(state, "teamA").myContracts) {
        if (order.status !== "open") continue;
        const op =
          order.task.kind === "homomorphic-sum"
            ? buildFheOp(order, state.config.prime)
            : order.task.kind === "masked-total"
              ? buildMpcOp(order, state.config.prime)
              : undefined;
        if (!op) continue;
        const verdict = validateOp(state, "teamA", op);
        if (!verdict.ok) throw new Error(`setup op rejected: ${verdict.error}`);
        state = applyOp(state, "teamA", op);
      }
      state = tick(state, (round + 1) * state.config.contractIntervalMs);
    }

    const events = buildReplay(state);
    const kinds = new Set(events.map((e) => e.kind));
    expect(kinds).toContain("fhe");
    expect(kinds).toContain("mpc");
    // Nothing was PROVEd in this run, so a "prove" event would be a mislabel.
    expect(kinds).not.toContain("prove");

    const fhe = events.find((e) => e.kind === "fhe");
    expect(fhe?.summary.en).toContain("without decrypting");
    expect(fhe?.summary.ja).toContain("復号せずに");
    const mpc = events.find((e) => e.kind === "mpc");
    expect(mpc?.summary.en).toContain("masked subtotal");
    expect(mpc?.summary.ja).toContain("覆面");
  });
});
