import { artifactFields } from "./ledger-codec.ts";
import { rotorEncrypt } from "./rotor.ts";
import { rsaEncrypt } from "./rsa.ts";
import { createHash } from "node:crypto";
import { expect, test } from "bun:test";
import { commit, HANDS, type Hand } from "./commitment.ts";
import { buildCipherOp, buildFheOp, buildMpcOp, buildProveSudokuOp } from "./playtest.ts";
import { applyOp, DEFAULT_CONFIG, initialState, projectForTeam, tick, validateOp } from "./reducer.ts";
import type { CryptoBattleOp, CryptoBattleProjection } from "./types.ts";

const teams = ["alpha", "bravo"] as const;
type Team = typeof teams[number];

/** Reproducible synthetic choices, using rejection sampling to avoid modulo bias. */
function draw(label: string, count: number): number {
  for (let retry = 0; ; retry++) {
    const value = createHash("sha256").update(`${label}:${retry}`).digest().readUInt32BE(0);
    if (value < Math.floor(2 ** 32 / count) * count) return value % count;
  }
}

/** The attacking strategy has no state/secret input: only public projected evidence. */
function publicPrediction(view: CryptoBattleProjection): CryptoBattleOp | undefined {
  const target = view.rpsHunt?.targets[0];
  if (!target) return undefined;
  const pastR = target.evidence[0]?.randomness;
  if (pastR === undefined) return undefined;
  const hand = HANDS.find(m => commit(m, pastR) === target.commitment);
  return hand === undefined ? undefined : {
    kind: "hunt-rps", targetTeamId: target.targetTeamId, duelId: target.duelId, predictedHand: hand,
  };
}

test("90 standard minutes: both safe teams can score a public-evidence RPS prediction before simultaneous publication", () => {
  // Trial 85 from the 200-trial author simulation; selected as an equal-score
  // example, not as an estimate of success probability. This is NOT a human
  // reading-speed/playability claim. Non-RPS answers below are author helpers
  // for the team's own projection. They never supply an opponent's secret.
  const fixture = "issue740-synthetic-85";
  let state = initialState({ eventId: "local-issue740", teamIds: teams, matchSecret: fixture });
  expect(state.config).toEqual(DEFAULT_CONFIG);
  const attempts: Record<Team, number> = { alpha: 0, bravo: 0 };
  const opportunities: Record<Team, number> = { alpha: 0, bravo: 0 };
  const hits: Record<Team, number> = { alpha: 0, bravo: 0 };
  const heldHits: Record<Team, number> = { alpha: 0, bravo: 0 };
  const rotations: Record<Team, number> = { alpha: 0, bravo: 0 };
  const predicted = new Set<string>();

  function move(team: Team, op: CryptoBattleOp) {
    expect(validateOp(state, team, op)).toEqual({ ok: true });
    state = applyOp(state, team, op);
  }
  state = tick(state, 0);
  for (const team of teams) move(team, { kind: "ready" });
  let round = 0;
  for (const minute of [0, ...Array.from({ length: 18 }, (_, i) => 1 + i * 5)]) {
    state = tick(state, minute * 60_000);
    for (const team of teams) {
      const view = projectForTeam(state, team);
      const orders = view.myContracts.filter(c => c.status === "open");
      expect(orders.length).toBeLessThanOrEqual(6);
      for (const order of orders) {
        if (order.task.kind === "rps-duel") continue;
        const own = projectForTeam(state, team);
        let op: CryptoBattleOp | undefined;
        switch (order.task.kind) {
          case "reveal-share":
          case "zk-sudoku": op = buildProveSudokuOp(own.vault, order.id); break;
          case "rsa-encrypt": op = { kind: "cipher", contractId: order.id, answer: [String(rsaEncrypt(order.task.plaintext, order.task))] }; break;
          case "caesar-shift": op = buildCipherOp(order); break;
          case "rotor-encrypt": op = { kind: "cipher", contractId: order.id, answer: rotorEncrypt(order.task.plaintext, order.task.myInitial).map(String) }; break;
          case "homomorphic-sum": op = buildFheOp(order, view.prime); break;
          case "masked-total": op = buildMpcOp(order, view.prime); break;
        }
        if (!op) throw new Error("An issued Order has no author answer");
        move(team, op);
      }
    }
    const openings = new Map<Team, { contractId: string; duelId: string; hand: Hand; randomness: number }>();
    for (const team of teams) {
      const order = projectForTeam(state, team).myContracts.find(c => c.status === "open" && c.task.kind === "rps-duel");
      if (!order || order.task.kind !== "rps-duel") continue;
      const hand = (draw(`${fixture}:${team}:${order.task.duelId}:hand`, 3) + 1) as Hand;
      const randomness = draw(`${fixture}:${team}:${order.task.duelId}:r`, 11);
      openings.set(team, { contractId: order.id, duelId: order.task.duelId, hand, randomness });
      move(team, { kind: "rps-commit", contractId: order.id, commitment: commit(hand, randomness) });
    }
    const held = new Set<Team>();
    // Alternate who opens first; the same public strategy serves both roles.
    const turn: readonly Team[] = round % 2 === 0 ? ["bravo", "alpha"] : teams;
    for (const team of turn) {
      const opening = openings.get(team);
      if (!opening) continue;
      const view = projectForTeam(state, team);
      if (view.rpsHunt?.targets.length) opportunities[team]++;
      const op = publicPrediction(view);
      if (op) {
        expect(view.publicLedger.filter(a => a.kind === "rps-open" && a.duelId === opening.duelId)).toEqual([]);
        if (view.rpsHunt?.targets[0]?.openingHeld) held.add(team);
        move(team, op);
        attempts[team]++;
        predicted.add(`${team}:${opening.duelId}`);
      }
      move(team, { kind: "rps-open", contractId: opening.contractId, hand: opening.hand, randomness: opening.randomness });
    }
    for (const team of teams) {
      const opening = openings.get(team);
      if (opening && predicted.has(`${team}:${opening.duelId}`)) {
        const result = projectForTeam(state, team).rpsHunt?.lastResult;
        expect(result?.duelId).toBe(opening.duelId);
        if (result?.outcome === "hit") {
          hits[team]++;
          if (held.has(team)) heldHits[team]++;
        }
      }
      if (validateOp(state, team, { kind: "rotate" }).ok) {
        move(team, { kind: "rotate" });
        rotations[team]++;
      }
    }
    if (openings.size) round++;
  }
  state = tick(state, 90 * 60_000);
  expect(state.phase).toBe("ended");
  expect(attempts).toEqual({ alpha: 3, bravo: 3 });
  expect(opportunities).toEqual({ alpha: 14, bravo: 14 });
  expect(hits).toEqual({ alpha: 1, bravo: 1 });
  expect(heldHits).toEqual(hits); // Both successful attacks used the newly preserved window.
  expect(rotations).toEqual({ alpha: 18, bravo: 18 });
  for (const team of teams) {
    expect(state.teams[team]!.score).toBe(3284);
    expect(state.teams[team]!.completedContractIds).toHaveLength(109);
    expect(projectForTeam(state, team).publicLedger.some(a => a.kind === "share" || a.kind === "cipher-pair")).toBe(false);
  }
  expect(state.contracts.some(c => c.status === "expired")).toBe(false);
});

test("fresh uniform hands and hiding numbers give no prediction advantage from a past r", () => {
  for (let pastR = 0; pastR < 11; pastR++) {
    let matched = 0, correct = 0;
    for (const hand of HANDS) for (let currentR = 0; currentR < 11; currentR++) {
      const currentCommitment = commit(hand, currentR);
      const candidate = HANDS.find(m => commit(m, pastR) === currentCommitment);
      if (candidate !== undefined) { matched++; if (candidate === hand) correct++; }
    }
    expect({ matched, correct }).toEqual({ matched: 9, correct: 3 });
  }
});
