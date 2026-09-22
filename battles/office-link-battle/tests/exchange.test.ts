import { describe, expect, test } from "bun:test";
import { applyOp, initialState, projectForTeam, teamScores, validateOp, type ExchangeState } from "../coordination/exchange";

const ctx = { teamIds: ["a", "b", "c", "d", "e"], eventId: "event", matchSecret: "a-private-match-secret-never-in-projection" };
function confirm(state: ExchangeState, from: string, peer: string) {
  return applyOp(state, from, { kind: "exchange", peer, code: projectForTeam(state, peer).code });
}
function connect(state: ExchangeState, a: string, b: string) { return confirm(confirm(state, a, b), b, a); }
describe("two authenticated teams must exchange before a bounded reward", () => {
  test("one confirmation gives no points, reciprocal confirmation rewards both exactly once", () => {
    const initial = initialState(ctx);
    const waiting = confirm(initial, "a", "b");
    expect(teamScores(waiting)).toEqual({ a: 0, b: 0, c: 0, d: 0, e: 0 });
    expect(projectForTeam(waiting, "b").teams.find(t => t.id === "a")?.waiting).toBe(true);
    const done = confirm(waiting, "b", "a");
    expect(teamScores(done)).toEqual({ a: 20, b: 20, c: 0, d: 0, e: 0 });
    expect(validateOp(done, "a", { kind: "exchange", peer: "b", code: initial.teams.b.code })).toEqual({ ok: false, error: "already_exchanged" });
    expect(initial.teams.a.pending).toBeUndefined();
  });
  test("private material is scoped to event and viewer, including before initialization", () => {
    const initial = initialState(ctx);
    const p = JSON.stringify(projectForTeam(initial, "a"));
    for (const id of ["b", "c", "d", "e"]) expect(p).not.toContain(initial.teams[id].code);
    expect(p).not.toContain(ctx.matchSecret);
    expect(initialState({ ...ctx, eventId: "other" }).teams.a.code).not.toBe(initial.teams.a.code);
    expect(projectForTeam(initialState({ ...ctx, matchSecret: undefined }), "a").ready).toBe(false);
    expect(() => projectForTeam(initial, "outsider")).toThrow("unknown_team");
  });
  test("reject malformed, self, foreign, wrong and non-ascii codes without throwing", () => {
    const initial = initialState(ctx);
    for (const op of [null, {}, { kind: "exchange" }, { kind: "exchange", peer: "a", code: initial.teams.a.code }, { kind: "exchange", peer: "__proto__", code: "x" }, { kind: "exchange", peer: "b", code: "0".repeat(16) }, { kind: "exchange", peer: "b", code: "あ".repeat(16) }]) expect(validateOp(initial, "a", op).ok).toBe(false);
    expect(validateOp(initial, "outsider", { kind: "cancel" }).ok).toBe(false);
    expect(() => applyOp(initial, "a", null)).toThrow("invalid_operation");
  });
  test("replacement and cancellation prevent stale partner confirmation from awarding", () => {
    const s = initialState(ctx);
    const replaced = confirm(confirm(s, "a", "b"), "a", "c");
    expect(teamScores(confirm(replaced, "b", "a")).a).toBe(0);
    const cancelled = applyOp(confirm(s, "a", "b"), "a", { kind: "cancel" });
    expect(teamScores(confirm(cancelled, "b", "a")).b).toBe(0);
  });
  test("three different partners cap rewards, but capped teams can help late arrivals", () => {
    let s = initialState(ctx);
    for (const peer of ["b", "c", "d"]) s = connect(s, "a", peer);
    expect(teamScores(s).a).toBe(60);
    s = connect(s, "a", "e");
    expect(teamScores(s).a).toBe(60); expect(teamScores(s).e).toBe(20);
    expect(projectForTeam(s, "a").teams.find(t => t.id === "e")?.complete).toBe(true);
    expect(validateOp(s, "a", { kind: "exchange", peer: "e", code: s.teams.e.code }).ok).toBe(false);
    expect(s.teams.a.partners).toHaveLength(3);
  });
  test("99 teams fit declared capacity with bounded partner lists", () => {
    const ids = Array.from({ length: 99 }, (_, i) => `${i}`.padStart(26, "0"));
    let s = initialState({ ...ctx, teamIds: ids, teamNames: Object.fromEntries(ids.map(id => [id, "界".repeat(120)])) });
    for (let i = 1; i < 99; i++) s = connect(s, ids[0], ids[i]);
    for (const id of ids) {
      for (const peer of ids) {
        if (s.teams[id].partners.length >= 3) break;
        if (validateOp(s, id, { kind: "exchange", peer, code: s.teams[peer].code }).ok) s = connect(s, id, peer);
      }
    }
    expect(Object.values(teamScores(s)).every(score => score <= 60)).toBe(true);
    expect(Buffer.byteLength(JSON.stringify(s), "utf8")).toBeLessThan(1024 + 2048 * 99);
    for (const team of Object.values(s.teams)) expect(team.partners.length).toBeLessThanOrEqual(3);
  });
});
