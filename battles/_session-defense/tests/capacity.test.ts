import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { initialState, applyOp, validateOp, projectForTeam, roles, teamScores, tick } from "../game/reducer.ts";
import { ACTIONS, CONTROLS, type Control, type Op, type State } from "../game/types.ts";

const metadata = JSON.parse(readFileSync(new URL("../docs/native-metadata.json", import.meta.url), "utf8"));
const budget: { baseBytes: number; bytesPerTeam: number } = metadata.interTeamCoordination.stateBudget;
const ids = ["a".repeat(80), "b".repeat(80)];
const bytes = (s: State) => Buffer.byteLength(JSON.stringify(s));
const choices = (Object.keys(CONTROLS) as Control[]).reduce<Control[][]>((sets, key) => [...sets, ...sets.map(set => [...set, key])], [[]])
  .filter(set => set.reduce((sum, key) => sum + CONTROLS[key], 0) <= 6);

test("fixed two-team native metadata and bounded host inputs", () => {
  expect(metadata.runtime).toEqual({ provider: "local", engine: "bun", entry: "coordination/session-defense.ts" });
  expect(budget).toEqual({ baseBytes: 0, bytesPerTeam: 16384 });
  for (const count of [0, 1, 3, 80]) expect(() => initialState({ eventId: "x", teamIds: ids.concat("c").slice(0, count), matchSecret: "f".repeat(64) })).toThrow();
  for (const extra of [{ eventId: "x".repeat(81) }, { matchSecret: "f".repeat(65) }, { teamNames: { [ids[0]!]: "x".repeat(81) } }])
    expect(() => initialState({ eventId: "x", teamIds: ids, matchSecret: "f".repeat(64), ...extra })).toThrow();
});

test("every legal defense combination: all four rounds, receipts, maximum host fields, JSON restore", () => {
  let peak = 0, peakRoute = "", traces = 0;
  for (const controls of choices) for (const route of ["early-finish", "owner-first", "expired", "timeout"] as const) {
    let s = initialState({ eventId: "e".repeat(80), teamIds: ids, teamNames: Object.fromEntries(ids.map(id => [id, "\u0000".repeat(80)])), matchSecret: "f".repeat(64) });
    const measure = () => {
      const n = bytes(s); if (n > peak) { peak = n; peakRoute = `${controls.join(",")}/${route}`; }
      expect(n).toBeLessThanOrEqual(budget.baseBytes + 2 * budget.bytesPerTeam);
      const restored: State = JSON.parse(JSON.stringify(s));
      for (const id of ids) expect(projectForTeam(restored, id)).toEqual(projectForTeam(s, id));
      expect(teamScores(restored)).toEqual(teamScores(s)); s = restored;
    };
    function act(id: string, body: Record<string, unknown>) {
      const op = { ...body, id: `req_${String(s.revision).padStart(60, "0")}`, revision: s.revision } as Op;
      expect(validateOp(s, id, op)).toEqual({ ok: true }); s = applyOp(s, id, op); measure();
      // An exact replay preserves receipts, state and scores after the storage boundary.
      expect(applyOp(s, id, op)).toEqual(s);
    }
    measure(); act(ids[0]!, { kind: "ready" }); act(ids[1]!, { kind: "ready" });
    for (let round = 1; round <= 4; round++) {
      const { attacker, defender } = roles(s);
      for (const action of Object.keys(ACTIONS)) act(attacker, { kind: "try", action, token: s.leak });
      act(attacker, { kind: "finish" }); act(defender, { kind: "defend", controls });
      if (route === "expired") { s = tick(s, s.now + 15_000); measure(); }
      if (route === "owner-first") act(defender, { kind: "legitimate" });
      for (const action of Object.keys(ACTIONS)) act(attacker, { kind: "try", action, token: s.leak, proof: "x".repeat(100), approval: "y".repeat(100) });
      if (route === "timeout") { act(defender, { kind: "legitimate" }); s = tick(s, s.deadline); measure(); }
      else { act(attacker, { kind: "finish" }); if (route !== "owner-first") act(defender, { kind: "legitimate" }); }
    }
    expect(s.phase).toBe("finished"); expect(s.results).toHaveLength(4);
    expect(Object.keys(s.receipts)).toHaveLength(route === "timeout" ? 46 : 50);
    expect(s.events.length).toBeLessThanOrEqual(56); traces++;
  }
  console.info(JSON.stringify({ traces, combinations: choices.length, peak, peakRoute, declaredTwoTeamBytes: 2 * budget.bytesPerTeam }));
});
