import { expect, test } from "bun:test";
import { applyOp, initialState, STREAMING_ORDER_CONFIG, tick, validateOp } from "./reducer.ts";
import type { CryptoBattleState } from "./types.ts";

// Compare whole persisted state, including scores, terminal Orders, duel
// counters and endgame awards. Only the read clock is not gameplay state.
const gameplay = ({ nowMs: _clock, ...state }: CryptoBattleState) => state;
for (const teamCount of [4, 40]) for (const moves of [false, true]) {
  test(`polling cadence is immaterial: ${teamCount} teams, moves=${moves}`, () => {
    for (const seed of [1, 17, 897]) {
      const teamIds = Array.from({ length: teamCount }, (_, i) => `team-${i}`);
      let frequent = tick(applyOp(initialState({ eventId: `cadence-${seed}`, teamIds,
        matchSecret: `cadence-${seed}` }, STREAMING_ORDER_CONFIG), teamIds[0]!, { kind: "start" }), 0);
      let saved = structuredClone(frequent);
      let random = seed;
      const next = () => { random = (Math.imul(random, 1664525) + 1013904223) >>> 0; return random; };
      let checkpoint = 1 + next() % 50;
      for (let step = 1; step <= 1080; step++) {
        const now = step * 5000;
        frequent = tick(frequent, now);
        // Model a host which ticks on reads but only persists score changes
        // or moves. Random checkpoints also persist a reload snapshot.
        let sparse = tick(saved, now);
        expect(gameplay(sparse)).toEqual(gameplay(frequent));
        if (moves && step % 6 === 0) {
          for (const order of frequent.contracts.filter(c => c.status === "open")) {
            const op = { kind: "leak" as const, contractId: order.id };
            if (validateOp(frequent, order.teamId, op).ok) {
              frequent = applyOp(frequent, order.teamId, op);
              sparse = applyOp(sparse, order.teamId, op);
            }
          }
          expect(gameplay(sparse)).toEqual(gameplay(frequent));
          saved = structuredClone(sparse);
        } else if (step === checkpoint || Object.keys(saved.teams).some(id => saved.teams[id]!.score !== sparse.teams[id]!.score)) {
          saved = structuredClone(sparse);
          checkpoint = step + 1 + next() % 50;
        }
      }
      expect(tick(saved, 90 * 60_000)).toEqual(frequent);
      expect(tick(frequent, frequent.nowMs!)).toEqual(frequent);
      expect(tick(frequent, frequent.nowMs! - 1)).toBe(frequent);
    }
  }, 120_000);
}

test("a sealed duel and armed lightning survive delayed advancement identically", () => {
  let state = tick(applyOp(initialState({eventId: "cadence-duel", teamIds: ["a", "b"], matchSecret: "cadence-duel"},
    { phaseBoundaries: { buildToPressureMs: 60_000, pressureToEndgameMs: 120_000 } }), "a", {kind: "start"}), 120_000);
  const order = state.contracts.find(c => c.teamId === "a" && c.status === "open" && c.task.kind !== "rps-duel")!;
  const arm = {kind: "declare-lightning" as const, contractId: order.id};
  expect(validateOp(state, "a", arm).ok).toBe(true);
  state = applyOp(state, "a", arm);
  const duel = state.contracts.find(c => c.teamId === "a" && c.status === "open" && c.task.kind === "rps-duel")!;
  const seal = {kind: "rps-commit" as const, contractId: duel.id, commitment: 1};
  expect(validateOp(state, "a", seal).ok).toBe(true);
  state = applyOp(state, "a", seal);
  let frequent = state;
  for (let now = state.nowMs! + 5000; now <= 900_000; now += 5000) frequent = tick(frequent, now);
  expect(tick(state, 900_000)).toEqual(frequent);
});
