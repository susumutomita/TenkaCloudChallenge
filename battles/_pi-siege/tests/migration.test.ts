import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { applyOp, migrateState, projectForTeam, scoreReasons, teamScores, validateOp } from "../game/reducer.ts";
import type { Op, State } from "../game/types.ts";
import { localizeProjection } from "../portal/localize.ts";
const legacy = () => JSON.parse(readFileSync(new URL("fixtures/legacy-v1.json", import.meta.url), "utf8"));

test("actual schema-1 checkpoint preserves signed scores, claims, tickets and exact replay", () => {
  const old = legacy(), before = JSON.stringify(old);
  const migrated = migrateState(old, 1);
  expect(JSON.stringify(old)).toBe(before);
  expect(migrated.schema).toBe(2);
  expect(scoreReasons({...migrated,ledger:[]} as State,migrated)).toEqual({alpha:"pi-claim-broken",bravo:"pi-audit-held"});
  expect(teamScores(migrated)).toEqual({ alpha: -3, bravo: 4 });
  for (const key of ["phase", "round", "revision", "roster", "turn", "receipts"] as const) expect(migrated[key]).toEqual(old[key]);
  for (const id of old.roster) for (const key of ["tickets", "score", "ready", "passed", "range", "rows", "grid", "claimed"] as const) expect(migrated.teams[id]![key]).toEqual(old.teams[id][key]);
  expect(migrated.claims.map(c => [c.id, c.author, c.status, c.challenged, c.task])).toEqual(old.claims.map((c: State["claims"][number]) => [c.id, c.author, c.status, c.challenged, c.task]));
  expect(migrated.ledger.map(e => [e.round, e.team, e.points, e.text.map(t => t.ja)])).toEqual(old.ledger.map((e: {round:number;team:string;points:number;text:string[]}) => [e.round,e.team,e.points,e.text]));
  const checkpoint: State = JSON.parse(JSON.stringify(migrated));
  const replay: Op = JSON.parse(checkpoint.receipts.at(-1)!.payload);
  expect(validateOp(checkpoint, "bravo", replay)).toEqual({ ok: true });
  expect(applyOp(checkpoint, "bravo", replay)).toBe(checkpoint);
  const move: Op = {kind:"pass",requestId:"after_migration",revision:checkpoint.revision,round:checkpoint.round};
  const next = applyOp(checkpoint, "alpha", move);
  expect(teamScores(next)).toEqual({ alpha: -3, bravo: 4 });
  expect(next.receipts).toHaveLength(checkpoint.receipts.length + 1);
  expect(scoreReasons(checkpoint, next)).toEqual({});
});
test("locale projection translates facts without changing game evidence or score", () => {
  const state = migrateState(legacy(), 1), wire = projectForTeam(state, "bravo");
  const before = JSON.stringify(wire), ja = localizeProjection(wire, "ja"), en = localizeProjection(wire, "en");
  expect(JSON.stringify(wire)).toBe(before);
  expect(ja.me.score).toBe(en.me.score); expect(ja.me.tickets).toBe(en.me.tickets);
  expect(ja.claims[0]!.task).toEqual(en.claims[0]!.task);
  expect(ja.claims[0]!.facts[0]).toContain("3/1: 誤差");
  expect(en.claims[0]!.facts[0]).toContain("3/1: approximate error");
  expect(en.me.feedback[0]).toContain("Audit succeeds. +4");
  expect(en.ledger.flatMap(e=>e.text).join(" ")).toContain("A finite record does not justify");
  expect(en.claims[0]!.facts.join(" ")).not.toMatch(/[\u3040-\u30ff\u4e00-\u9fff]/u);
});
test("unsupported or invalid snapshots fail rather than erase a match", () => {
  for (const [value, version] of [[legacy(),0],[legacy(),2],[null,1],[{schema:1},1]] as const) expect(() => migrateState(value,version)).toThrow();
  const bad = legacy(); bad.teams.alpha.feedback = [42];
  expect(() => migrateState(bad,1)).toThrow("Legacy pi-siege checkpoint");
});
test("actual v1 mixed audit retains 4<6 and its mathematical limits in English",()=>{
  const old=JSON.parse(readFileSync(new URL("fixtures/legacy-mixed-v1.json",import.meta.url),"utf8"));
  const state=migrateState(old,1),en=localizeProjection(projectForTeam(state,"bravo"),"en");
  expect(en.me.score).toBe(4);expect(en.opponents[0]!.score).toBe(-3);
  const evidence=en.ledger.flatMap(e=>e.text).join(" ");
  expect(evidence).toContain("the exponent is 4, below the claimed 6");
  expect(evidence).toContain("does not establish that an actual term is nonzero or large");
  expect(evidence).not.toMatch(/[\u3040-\u30ff\u4e00-\u9fff]/u);
  expect(state.receipts).toEqual(old.receipts);
});

test("migration compares JSON values independently of object-key ordering",()=>{
  const old=legacy(),reordered=JSON.parse(JSON.stringify(old,(_key,value:unknown)=>value&&typeof value==="object"&&!Array.isArray(value)?Object.fromEntries(Object.entries(value).reverse()):value));
  expect(migrateState(reordered,1)).toEqual(migrateState(old,1));
});
