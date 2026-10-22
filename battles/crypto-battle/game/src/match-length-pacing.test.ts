import { describe, expect, test } from "bun:test";
import { buildClearingOp } from "./playtest.ts";
import { applyOp, initialState, projectForTeam, STREAMING_ORDER_CONFIG, tick, validateOp } from "./reducer.ts";
import type { CryptoBattleOp, CryptoBattleState } from "./types.ts";

/**
 * [Issue #926] Whether the current pacing (3-minute answers, an arrival every
 * 30 +- 10 s, at most 3 open Orders) still makes a playable match when the
 * organizer chooses a short one. Two teams play the same model through the
 * platform's length report, sampled every second.
 *
 * `solveMs` undefined never answers and 0 answers every Order the second it
 * arrives. Otherwise a team works on one Order at a time, takes `solveMs`, and
 * picks the earliest deadline it can still meet.
 */
function play(minutes: number, solveMs: number | undefined) {
  const length = { matchDurationMs: minutes * 60_000 };
  const teams = ["alpha", "bravo"];
  let state: CryptoBattleState = applyOp(initialState({ eventId: `pacing-${minutes}`, teamIds: teams,
    matchSecret: "pacing-secret", ...length }, STREAMING_ORDER_CONFIG), "alpha", { kind: "start" });
  const { buildToPressureMs, pressureToEndgameMs } = state.config.phaseBoundaries;
  const phaseOf = (ms: number) => (ms < buildToPressureMs ? 0 : ms < pressureToEndgameMs ? 1 : 2);
  const issued = [0, 0, 0], completed = [0, 0, 0];
  const seen = new Set<string>();
  const jobs = new Map<string, { readonly id: string; readonly at: number }>();
  let idleMs = 0, longestIdleMs = 0, beforeEnd = 0;
  const submit = (team: string, op: CryptoBattleOp | undefined) => {
    if (!op || !validateOp(state, team, op).ok) return false;
    state = applyOp(state, team, op);
    return true;
  };
  const answer = (team: string, id: string, at: number) => {
    const view = projectForTeam(state, team);
    const order = view.myContracts.find((c) => c.id === id && c.status === "open");
    if (!order) return;
    if (state.phase === "endgame") submit(team, { kind: "declare-lightning", contractId: id });
    let op: CryptoBattleOp | undefined;
    try {
      op = buildClearingOp(order, view.vault, view.prime);
    } catch {
      op = undefined;
    }
    if (!submit(team, op)) submit(team, { kind: "leak", contractId: id });
    if (op?.kind === "rps-commit") jobs.set(team, { id, at: at + 1_000 });
    if (team === "alpha" && state.contracts.find((c) => c.id === id)?.status === "completed") completed[phaseOf(at)]!++;
  };
  for (let at = 0; at <= length.matchDurationMs; at += 1_000) {
    beforeEnd = state.teams.alpha!.score;
    state = tick(state, at, length);
    for (const order of state.contracts.filter((c) => c.teamId === "alpha" && !seen.has(c.id))) {
      seen.add(order.id);
      issued[phaseOf(order.issuedAtMs)]!++;
    }
    const waiting = state.phase !== "ended" && !state.contracts.some((c) => c.teamId === "alpha" && c.status === "open");
    idleMs = waiting ? idleMs + 1_000 : 0;
    longestIdleMs = Math.max(longestIdleMs, idleMs);
    if (solveMs === undefined || state.phase === "ended") continue;
    for (const team of teams) {
      if (solveMs === 0) {
        for (const order of state.contracts.filter((c) => c.teamId === team && c.status === "open")) answer(team, order.id, at);
        continue;
      }
      const job = jobs.get(team);
      if (job && at < job.at) continue;
      jobs.delete(team);
      if (job) {
        answer(team, job.id, at);
        continue;
      }
      const next = projectForTeam(state, team).myContracts.filter((c) => c.status === "open" && c.remainingMs > solveMs)
        .sort((a, b) => a.remainingMs - b.remainingMs)[0];
      if (next) jobs.set(team, { id: next.id, at: at + solveMs });
    }
  }
  const card = state.endgameLightning?.status === "awarded" ? state.endgameLightning.cards.alpha : undefined;
  const lightning = card?.status === "spent" ? card.outcome : card?.status;
  const score = state.teams.alpha!.score;
  return { issued, completed, longestIdleMs, lightning, score, finalTickDelta: score - beforeEnd, phase: state.phase };
}

for (const minutes of [10, 90]) {
  describe(`a ${minutes}-minute match at the current pacing`, () => {
    const passive = play(minutes, undefined);
    const steady = play(minutes, 90_000);
    const instant = play(minutes, 0);
    console.info(JSON.stringify({ minutes, passive, steady, instant }));

    test("every phase issues Orders, and a team that clears them at once never waits beyond one arrival", () => {
      for (const run of [passive, steady, instant]) {
        expect(run.issued.every((n) => n >= 3)).toBe(true);
        expect(run.phase).toBe("ended");
      }
      expect(instant.longestIdleMs).toBeLessThanOrEqual(40_000);
    });

    test("a team answering one Order per 90 seconds scores in every phase and lands its lightning card", () => {
      expect(steady.completed.every((n) => n >= 1)).toBe(true);
      expect(steady.lightning).toBe("hit");
    });
  });
}
