import { expect, test } from "bun:test";
import { applyOp, initialState, projectForTeam, teamScores, validateOp } from "./reducer.ts";
import type { Op, State } from "./types.ts";

const ctx = { eventId: "test", teamIds: ["alpha", "bravo"] };
const fresh = () => initialState(ctx);
function envelope(s: State, payload: Record<string, unknown>): Op {
  return { requestId: `req_${s.revision}`, revision: s.revision, round: s.round, ...payload } as Op;
}
function act(s: State, team: string, payload: Record<string, unknown>): State {
  const op = envelope(s, payload);
  expect(validateOp(s, team, op)).toEqual({ ok: true });
  const before = JSON.stringify(s), next = applyOp(s, team, op);
  expect(JSON.stringify(s)).toBe(before);
  expect(JSON.stringify(JSON.parse(JSON.stringify(next)))).toBe(JSON.stringify(next));
  return next;
}
function started() { let s = act(fresh(), "alpha", { kind: "ready" }); return act(s, "bravo", { kind: "ready" }); }
const source = (s: State, id: string) => s.teams[id]!.previews.at(-1)!.id;
const claim = (s: State, id: string) => s.claims.find(c => c.author === id && c.round === s.round)!.id;
function finish(s: State): State { const r = s.round; while (s.phase === "playing" && s.round === r) s = act(s, s.turn, { kind: "pass" }); return s; }

test("waiting, turn-taking, round settlement, and an actual two-player match", () => {
  let s = fresh(); expect(teamScores(s)).toEqual({ alpha: 0, bravo: 0 });
  s = act(s, "alpha", { kind: "ready" }); expect(s.phase).toBe("waiting");
  s = act(s, "bravo", { kind: "ready" }); expect(s.phase).toBe("playing");
  s = act(s, "alpha", { kind: "upgrade" });
  s = act(s, "bravo", { kind: "inspect", task: { kind: "record", p: 3, q: 1 } });
  s = act(s, "alpha", { kind: "inspect", task: { kind: "record", p: 355, q: 113 } });
  s = act(s, "bravo", { kind: "publish", sourceId: source(s, "bravo"), scope: "forever" });
  expect(s.teams.bravo!.score).toBe(0);
  s = act(s, "alpha", { kind: "audit", claimId: claim(s, "bravo"), reason: "scope" });
  s = act(s, "bravo", { kind: "pass" });
  s = act(s, "alpha", { kind: "publish", sourceId: source(s, "alpha"), scope: "finite" });
  s = act(s, "alpha", { kind: "pass" });
  expect(s.round).toBe(1); expect(s.turn).toBe("bravo"); expect(teamScores(s)).toEqual({ alpha: 10, bravo: -3 });
  const valid = [{ n: 1, d: 1 }, { n: 1, d: 2 }, { n: 1, d: 1 }, { n: 5, d: 8 }];
  const zero = [{ n: 1, d: 1 }, { n: 1, d: 2 }, { n: 1, d: 1 }, { n: 1, d: 2 }];
  s = act(s, "bravo", { kind: "inspect", task: { kind: "table", cells: valid } });
  s = act(s, "alpha", { kind: "inspect", task: { kind: "table", cells: zero } });
  s = act(s, "bravo", { kind: "publish", sourceId: source(s, "bravo"), floor: { n: 1, d: 64 } });
  s = act(s, "alpha", { kind: "publish", sourceId: source(s, "alpha"), floor: { n: 1, d: 16 } });
  s = act(s, "bravo", { kind: "audit", claimId: claim(s, "alpha"), reason: "zero" });
  s = finish(s); expect(teamScores(s)).toEqual({ alpha: 7, bravo: 7 });
  s = act(s, "alpha", { kind: "inspect", task: { kind: "terms", ones: 0 } });
  s = act(s, "bravo", { kind: "inspect", task: { kind: "terms", ones: 2 } });
  s = act(s, "alpha", { kind: "publish", sourceId: source(s, "alpha"), exponent: 6 });
  s = act(s, "bravo", { kind: "audit", claimId: claim(s, "alpha"), reason: "mixed", ones: 2, cost: 4 });
  s = act(s, "alpha", { kind: "upgrade" });
  s = act(s, "bravo", { kind: "publish", sourceId: source(s, "bravo"), exponent: 4 });
  s = finish(s); expect(teamScores(s)).toEqual({ alpha: 4, bravo: 17 });
  s = act(s, "bravo", { kind: "upgrade" });
  s = act(s, "alpha", { kind: "inspect", task: { kind: "allocation", n: 6, d: 10 } });
  s = act(s, "bravo", { kind: "inspect", task: { kind: "allocation", n: 27, d: 50 } });
  s = act(s, "alpha", { kind: "publish", sourceId: source(s, "alpha") });
  s = act(s, "bravo", { kind: "audit", claimId: claim(s, "alpha"), reason: "error" });
  s = act(s, "alpha", { kind: "pass" });
  s = act(s, "bravo", { kind: "publish", sourceId: source(s, "bravo") });
  s = act(s, "bravo", { kind: "pass" });
  expect(s.phase).toBe("ended"); expect(teamScores(s)).toEqual({ alpha: 1, bravo: 27 });
  expect(validateOp(s, "alpha", envelope(s, { kind: "upgrade" }))).toEqual({ ok: false, error: "match_ended" });
  expect(s.claims).toHaveLength(8);
  expect(s.ledger.flatMap(e => e.text).some(t => t.includes("実際の項が非零・大きいという判定ではない"))).toBe(true);
});
test("exact retries are no-ops even after a phase transition; reused IDs cannot change meaning", () => {
  let s = started(); const op = envelope(s, { kind: "inspect", task: { kind: "record", p: 3, q: 1 } });
  s = applyOp(s, "alpha", op); const scored = JSON.stringify(s);
  expect(applyOp(s, "alpha", op)).toBe(s); expect(JSON.stringify(s)).toBe(scored);
  expect(validateOp(s, "alpha", { ...op, task: { kind: "record", p: 22, q: 7 } })).toEqual({ ok: false, error: "request_id_reused" });
  s = finish(s); expect(s.round).toBe(1); expect(applyOp(s, "alpha", op)).toBe(s);
});
test("scores, turns, private sources, schemas and numerical bounds cannot be supplied by a player", () => {
  const s = started();
  const bad = [
    { kind: "inspect", task: { kind: "record", p: 22, q: 0 } },
    { kind: "inspect", task: { kind: "record", p: 355, q: 113 } },
    { kind: "inspect", task: { kind: "record", p: Infinity, q: 1 } },
    { kind: "inspect", task: { kind: "record", p: 3.1, q: 1 } },
    { kind: "inspect", task: { kind: "record", p: 3, q: 1, score: 999 } },
    { kind: "inspect", task: { kind: "record", p: 3, q: 1 }, score: 999 },
    { kind: "publish", sourceId: "other_team_source", scope: "finite" },
    { kind: "advance" }, { kind: "reset" },
  ];
  for (const v of bad) expect(validateOp(s, "alpha", envelope(s, v)).ok).toBe(false);
  expect(validateOp(s, "bravo", envelope(s, { kind: "upgrade" }))).toEqual({ ok: false, error: "not_your_turn" });
  expect(validateOp(s, "__proto__", envelope(s, { kind: "upgrade" }))).toEqual({ ok: false, error: "unknown_team" });
  expect(validateOp(s, "alpha", null).ok).toBe(false);
  expect(() => applyOp(s, "alpha", envelope(s, { kind: "advance" }))).toThrow();
  expect(teamScores(s)).toEqual({ alpha: 0, bravo: 0 });
});
test("projection exposes published evidence but not the other team's experiments or receipts", () => {
  let s = started(); s = act(s, "alpha", { kind: "inspect", task: { kind: "record", p: 22, q: 7 } });
  const b = projectForTeam(s, "bravo");
  expect(JSON.stringify(b)).not.toContain("22/7"); expect(JSON.stringify(b)).not.toContain("req_");
  expect(b.opponents[0]).not.toHaveProperty("previews"); expect(b.opponents[0]).not.toHaveProperty("tickets");
  b.me.score = 999; expect(s.teams.bravo!.score).toBe(0);
  expect(() => projectForTeam(s, "ghost")).toThrow();
});
test("a failed audit spends a ticket without deducting points; no repeated or self audits", () => {
  let s = started();
  s = act(s, "alpha", { kind: "inspect", task: { kind: "record", p: 22, q: 7 } });
  s = act(s, "bravo", { kind: "inspect", task: { kind: "record", p: 3, q: 1 } });
  s = act(s, "alpha", { kind: "publish", sourceId: source(s, "alpha"), scope: "finite" });
  const id = claim(s, "alpha"); s = act(s, "bravo", { kind: "audit", claimId: id, reason: "scope" });
  expect(s.teams.bravo!.tickets).toBe(4); expect(s.teams.bravo!.score).toBe(0);
  expect(validateOp(s, "alpha", envelope(s, { kind: "audit", claimId: id, reason: "scope" })).ok).toBe(false);
  s = act(s, "alpha", { kind: "pass" });
  expect(validateOp(s, "bravo", envelope(s, { kind: "audit", claimId: id, reason: "scope" })).ok).toBe(false);
  s = act(s, "bravo", { kind: "publish", sourceId: source(s, "bravo"), scope: "finite" });
  s = act(s, "bravo", { kind: "pass" });
  expect(teamScores(s)).toEqual({ alpha: 8, bravo: 6 });
});
test("running out of tickets and passing both settle each claim once", () => {
  let s = started();
  for (let i = 0; i < 12; i++) s = act(s, s.turn, { kind: "inspect", task: { kind: "record", p: 3, q: 1 } });
  expect(s.round).toBe(1); expect(s.revision).toBe(14); expect(s.claims).toHaveLength(0); expect(s.receipts).toHaveLength(14);
  expect(s.teams.alpha!.tickets).toBe(6);
});
test("term claims snapshot row count; later upgrades cannot silently strengthen earlier evidence", () => {
  let s = finish(finish(started())); expect(s.round).toBe(2);
  s = act(s, "alpha", { kind: "inspect", task: { kind: "terms", ones: 0 } });
  s = act(s, "bravo", { kind: "pass" });
  s = act(s, "alpha", { kind: "upgrade" });
  s = act(s, "alpha", { kind: "publish", sourceId: source(s, "alpha"), exponent: 6 });
  expect(s.claims[0]!.rows).toBe(4);
  s = act(s, "alpha", { kind: "pass" }); expect(s.claims[0]!.status).toBe("broken"); expect(s.teams.alpha!.score).toBe(-3);
});
test("invalid roster and stale revisions fail closed", () => {
  expect(() => initialState({ eventId: "test", teamIds: ["alpha"] })).toThrow();
  expect(() => initialState({ eventId: "test", teamIds: ["alpha", "alpha"] })).toThrow();
  expect(() => initialState({ eventId: "test", teamIds: ["__proto__", "bravo"] })).toThrow();
  const s = started(); expect(validateOp(s, "alpha", { ...envelope(s, { kind: "upgrade" }), revision: 0 })).toEqual({ ok: false, error: "stale_view" });
});
test("positive entry margins alone cannot score; the comparison is the documented entry margin", () => {
  let s = finish(finish(finish(started())));
  s = act(s, "bravo", { kind: "upgrade" });
  s = act(s, "alpha", { kind: "upgrade" });
  s = act(s, "bravo", { kind: "upgrade" });
  s = act(s, "alpha", { kind: "inspect", task: { kind: "allocation", n: 26, d: 50 } });
  s = act(s, "bravo", { kind: "inspect", task: { kind: "allocation", n: 51, d: 100 } });
  s = act(s, "alpha", { kind: "publish", sourceId: source(s, "alpha") });
  s = act(s, "bravo", { kind: "publish", sourceId: source(s, "bravo") });
  s = finish(s); expect(teamScores(s)).toEqual({ alpha: 6, bravo: -3 });
  let both = finish(finish(finish(started())));
  both = act(both, "bravo", { kind: "upgrade" }); both = act(both, "alpha", { kind: "upgrade" });
  both = act(both, "bravo", { kind: "inspect", task: { kind: "allocation", n: 27, d: 50 } });
  both = act(both, "alpha", { kind: "inspect", task: { kind: "allocation", n: 26, d: 50 } });
  both = act(both, "bravo", { kind: "publish", sourceId: source(both, "bravo") });
  both = act(both, "alpha", { kind: "publish", sourceId: source(both, "alpha") });
  both = finish(both); expect(teamScores(both)).toEqual({ alpha: 8, bravo: 6 });
});
