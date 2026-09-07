/**
 * [Issue #740] Do two COMPETENT teams ever touch?
 *
 * The live run (two teams, forty minutes, participant API only) ended with
 * zero attacks fired: computing pays three times what leaking pays, so a team
 * that can compute never leaks, and every attack in the game needed a leak.
 * The board was two independent calculation races.
 *
 * This file plays the match the way that run's own numbers say it goes: two
 * bots that clear EVERY Order (the upper bound on competence, the case the
 * issue says never interacts), never leak by choice, never reuse a relabelling
 * or a hiding number, and HUNT whenever the public record allows. The
 * disclosure Order (`must-disclose`, fixtures.ts) is what changes the answer:
 * every team publishes a share on the rules' schedule, three of them reach the
 * threshold, and the other team -- reading the same board -- collects.
 *
 * Every bot move goes through `validateOp` first and only public material
 * (`projectForTeam`) feeds the attack builders, so what fires here is what a
 * participant could fire from the screen. The issue's completion criterion is
 * asserted directly: an attack fires at least once between evenly matched
 * teams, and it is not one team beating on the one that fell behind -- both
 * get hit, because both are on the same schedule.
 */

import { describe, expect, test } from "bun:test";
import { commit } from "./commitment.ts";
import {
  buildCipherOp,
  buildClearingOp,
  buildFheOp,
  buildLeakOp,
  buildMpcOp,
  buildProveSudokuOp,
  buildHuntOp,
  buildRotateOp,
  buildSudokuHuntOp,
  freshPermutation,
  startedMatch,
} from "./playtest.ts";
import { applyOp, DEFAULT_CONFIG, projectForTeam, tick, validateOp } from "./reducer.ts";
import type { ContractProjection, CryptoBattleOp, CryptoBattleProjection, CryptoBattleState } from "./types.ts";

const TEAMS = ["north", "south"] as const;
const STEP_MS = 60_000;

/** What one team decides on top of "clear everything": when it ROTATEs. */
interface Policy {
  /**
   * `race`: keep the generation and let the other team come; ROTATE only after
   * being hunted. `dodge`: ROTATE before the disclosure that would reach the
   * threshold, paying for whatever is still open.
   */
  readonly rotate: "race" | "dodge" | "escape";
}

interface Tally {
  huntsLanded: number;
  sudokuHuntsLanded: number;
  disclosures: number;
  voluntaryLeaks: number;
  rotations: number;
  huntedAtScoreGap: number[];
}

function ownExposedIndices(view: CryptoBattleProjection): Set<number> {
  const indices = new Set<number>();
  for (const entry of view.publicLedger) {
    if (entry.kind === "share" && entry.teamId === view.vault.teamId && entry.generation === view.vault.generation) {
      indices.add(entry.shareIndex);
    }
  }
  return indices;
}

class Bot {
  private duelCount = 0;
  private readonly duels = new Map<string, { hand: 1 | 2 | 3; randomness: number }>();
  readonly tally: Tally = { huntsLanded: 0, sudokuHuntsLanded: 0, disclosures: 0, voluntaryLeaks: 0, rotations: 0, huntedAtScoreGap: [] };

  constructor(readonly teamId: string, readonly policy: Policy) {}

  /** A fresh hiding number every duel -- the reuse `hunt-rps` punishes never happens. */
  private duelOp(order: ContractProjection): CryptoBattleOp | undefined {
    if (order.task.kind !== "rps-duel") return undefined;
    if (order.task.myCommitment === undefined) {
      this.duelCount += 1;
      const hand = ((this.duelCount % 3) + 1) as 1 | 2 | 3;
      const randomness = (this.duelCount * 7) % 11;
      this.duels.set(order.id, { hand, randomness });
      return { kind: "rps-commit", contractId: order.id, commitment: commit(hand, randomness) };
    }
    const mine = this.duels.get(order.id);
    if (order.task.opponentCommitment !== undefined && order.task.myOpening === undefined && mine) {
      return { kind: "rps-open", contractId: order.id, ...mine };
    }
    return undefined;
  }

  /** Clear an Order the competent way: compute when computing is allowed. */
  private clearingOp(order: ContractProjection, view: CryptoBattleProjection): CryptoBattleOp | undefined {
    switch (order.task.kind) {
      case "rps-duel":
        return this.duelOp(order);
      case "reveal-share":
        if (order.allowedMethods.includes("prove")) {
          return freshPermutation(view.vault) ? buildProveSudokuOp(view.vault, order.id) : undefined;
        }
        return buildLeakOp(order.id);
      case "zk-sudoku":
        return freshPermutation(view.vault) ? buildProveSudokuOp(view.vault, order.id) : undefined;
      case "snark-constraints":
      case "ec-add":
      case "rotor-encrypt":
      case "rsa-encrypt":
        return buildClearingOp(order, view.vault, view.prime);
      case "caesar-shift":
        return buildCipherOp(order);
      case "homomorphic-sum":
        return buildFheOp(order, view.prime);
      case "masked-total":
        return buildMpcOp(order, view.prime);
      default: {
        const exhaustive: never = order.task;
        throw new Error(`unknown task ${JSON.stringify(exhaustive)}`);
      }
    }
  }

  private wantsRotate(view: CryptoBattleProjection, open: readonly ContractProjection[]): boolean {
    if (view.vault.rotateCooldownRemainingMs > 0) return false;
    const gen = view.vault.generation;
    if (view.vault.huntedGenerations.includes(gen) || view.vault.sudokuHuntedGenerations.includes(gen)) return true;
    if (freshPermutation(view.vault) === undefined) return true;
    if (this.policy.rotate === "dodge") {
      // The disclosure on the belt would be the threshold-th distinct index.
      const exposed = ownExposedIndices(view);
      const pending = open.filter(
        (o) => o.task.kind === "reveal-share" && !o.allowedMethods.includes("prove") && o.task.shareIndices.some((i) => !exposed.has(i)),
      );
      if (pending.length > 0 && exposed.size + 1 >= view.threshold) return true;
    }
    return false;
  }

  /** One minute of play. Returns the state after every move this bot makes. */
  act(state: CryptoBattleState, opponent: string): CryptoBattleState {
    let next = state;
    let view = projectForTeam(next, this.teamId);
    const open = view.myContracts.filter((c) => c.status === "open");

    if (this.wantsRotate(view, open)) {
      const op = buildRotateOp();
      if (validateOp(next, this.teamId, op).ok) {
        next = applyOp(next, this.teamId, op);
        this.tally.rotations += 1;
        view = projectForTeam(next, this.teamId);
      }
    }

    const work = view.myContracts.filter(c => c.status === "open");
    if (this.policy.rotate === "escape") work.sort((a,b) => Number(a.privacyConstraint === "must-disclose") - Number(b.privacyConstraint === "must-disclose"));
    for (const order of work) {
      const op = this.clearingOp(order, view);
      if (!op) continue;
      if (!validateOp(next, this.teamId, op).ok) continue;
      next = applyOp(next, this.teamId, op);
      if (op.kind === "leak") {
        if (order.allowedMethods.includes("prove")) this.tally.voluntaryLeaks += 1;
        else this.tally.disclosures += 1;
      }
      view = projectForTeam(next, this.teamId);
      if (op.kind === "leak" && order.privacyConstraint === "must-disclose" && this.policy.rotate === "escape" && validateOp(next, this.teamId, buildRotateOp()).ok) {
        const before = next.teams[this.teamId]!.score;
        next = applyOp(next, this.teamId, buildRotateOp());
        expect(before - next.teams[this.teamId]!.score).toBe(Math.abs(next.config.scores.expiredOrder));
        this.tally.rotations += 1;
        view = projectForTeam(next, this.teamId);
      }
    }

    // Attacks, from the public record only.
    const before = next.teams[opponent];
    const shamir = buildHuntOp(view, opponent, { prime: view.prime, threshold: view.threshold });
    if (shamir && validateOp(next, this.teamId, shamir).ok) {
      next = applyOp(next, this.teamId, shamir);
      const after = next.teams[opponent];
      if (before && after && after.huntedGenerations.length > before.huntedGenerations.length) {
        this.tally.huntsLanded += 1;
        this.tally.huntedAtScoreGap.push((next.teams[this.teamId]?.score ?? 0) - before.score);
      }
      view = projectForTeam(next, this.teamId);
    }
    const sudoku = buildSudokuHuntOp(view, opponent);
    if (sudoku && validateOp(next, this.teamId, sudoku).ok) {
      const beforeSudoku = next.teams[opponent]?.sudokuHuntedGenerations?.length ?? 0;
      next = applyOp(next, this.teamId, sudoku);
      if ((next.teams[opponent]?.sudokuHuntedGenerations?.length ?? 0) > beforeSudoku) this.tally.sudokuHuntsLanded += 1;
    }
    return next;
  }
}

function playMatch(eventId: string, policies: Record<(typeof TEAMS)[number], Policy>): {
  readonly state: CryptoBattleState;
  readonly bots: Record<string, Bot>;
} {
  let state = tick(startedMatch({ eventId, teamIds: [...TEAMS] }), 0);
  const bots: Record<string, Bot> = {
    north: new Bot("north", policies.north),
    south: new Bot("south", policies.south),
  };
  for (let atMs = STEP_MS; atMs <= DEFAULT_CONFIG.matchDurationMs; atMs += STEP_MS) {
    state = tick(state, atMs);
    // Alternate who moves first each minute so neither team is structurally ahead.
    const order: readonly (typeof TEAMS)[number][] = (atMs / STEP_MS) % 2 === 0 ? ["north", "south"] : ["south", "north"];
    for (const teamId of order) {
      const opponent = teamId === "north" ? "south" : "north";
      const bot = bots[teamId];
      if (!bot) throw new Error(`no bot for ${teamId}`);
      state = bot.act(state, opponent);
    }
  }
  return { state, bots };
}

describe("two competent teams interact [Issue #740]", () => {
  const race = { north: { rotate: "race" as const }, south: { rotate: "race" as const } };

  test("attacks fire, in both directions, without anyone leaking by choice", () => {
    const { state, bots } = playMatch("interaction-race", race);
    const north = bots.north!.tally;
    const south = bots.south!.tally;
    if (process.env.INTERACTION_TALLY) console.log(JSON.stringify({ north, south, scores: TEAMS.map((t) => [t, state.teams[t]?.score]) }));

    // Nobody leaked a share they could have PROVEd: the exposure is the rules'.
    expect(north.voluntaryLeaks).toBe(0);
    expect(south.voluntaryLeaks).toBe(0);
    expect(north.disclosures).toBeGreaterThanOrEqual(DEFAULT_CONFIG.threshold);
    expect(south.disclosures).toBeGreaterThanOrEqual(DEFAULT_CONFIG.threshold);

    // The completion criterion: at least one attack, and not one-sided.
    expect(north.huntsLanded + south.huntsLanded).toBeGreaterThanOrEqual(1);
    expect(north.huntsLanded).toBeGreaterThanOrEqual(1);
    expect(south.huntsLanded).toBeGreaterThanOrEqual(1);
    for (const team of TEAMS) expect(state.teams[team]?.huntedGenerations.length).toBeGreaterThanOrEqual(1);

    // Evenly matched stays evenly matched: the hits do not decide the match on
    // their own, and neither team is buried by them.
    const scores = TEAMS.map((t) => state.teams[t]?.score ?? 0);
    expect(Math.abs((scores[0] ?? 0) - (scores[1] ?? 0))).toBeLessThan(DEFAULT_CONFIG.scores.huntBonus * 3);
    // The hunter was not already far ahead when it struck.
    for (const gap of [...north.huntedAtScoreGap, ...south.huntedAtScoreGap]) {
      expect(Math.abs(gap)).toBeLessThan(DEFAULT_CONFIG.scores.contract * 4);
    }
  });

  test("LEAK then immediate ROTATE has a score cost even after clearing the other work", () => {
    const escaped = playMatch("interaction-escape", { north: { rotate: "escape" }, south: { rotate: "escape" } });
    const racing = playMatch("interaction-escape", race);
    for (const team of TEAMS) {
      expect(escaped.bots[team]!.tally.rotations).toBeGreaterThan(0);
      expect(escaped.state.teams[team]!.score).toBeLessThan(racing.state.teams[team]!.score);
    }
  });

  test("the same two teams, one of which ROTATEs ahead of its third disclosure, is never Shamir-hunted -- and pays for it", () => {
    const { state, bots } = playMatch("interaction-dodge", { north: { rotate: "race" }, south: { rotate: "dodge" } });
    const south = bots.south!.tally;
    expect(state.teams.south?.huntedGenerations).toEqual([]);
    expect(south.rotations).toBeGreaterThanOrEqual(2);
    // The dodge is a real trade: every ROTATE voids the Orders still open,
    // and the same team racing on the same seed ends higher.
    const raceRun = playMatch("interaction-dodge", race);
    expect(state.teams.south?.score ?? 0).toBeLessThan(raceRun.state.teams.south?.score ?? 0);
  });
});
