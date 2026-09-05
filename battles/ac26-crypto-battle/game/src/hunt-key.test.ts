import { expect, test } from "bun:test";
import { huntKey, storedHuntKey } from "./hunt-key.ts";
import { initialState, migrateState, projectForTeam, STATE_SCHEMA_VERSION, tick, applyOp, validateOp } from "./reducer.ts";
import { decodeArtifact, encodeArtifact, decodeLedger } from "./ledger-codec.ts";
import type { PublicArtifact } from "./types.ts";

test("schema 4 preserves every budget and ledger value through migration and JSON", () => {
  let s = tick(initialState({eventId:"budget-migration",teamIds:["a|b","c","a","b|c"]}),0);
  s = applyOp(s,"a",{kind:"start"});
  const old = { ...s, huntAttempts: {
    [huntKey("a|b","c",1)]: 2,
    [huntKey("a","b|c",1)]: 3,
    [JSON.stringify(["sudoku","a","b|c",1])]: 1,
  }, publicLedger: [{k:"share" as const,tm:"a",c:"a-c0",g:1,m:"leak" as const,t:0,i:1,v:"3"}] };
  const before = JSON.stringify(old);
  const migrated = migrateState(JSON.parse(before),3);
  expect(STATE_SCHEMA_VERSION).toBe(4);
  expect(Object.values(migrated.huntAttempts).sort()).toEqual([1,2,3]);
  expect(projectForTeam(migrated,"a|b").huntAttempts.c?.spent).toBe(2);
  expect(projectForTeam(migrated,"a").huntAttempts["b|c"]?.spent).toBe(3);
  expect(projectForTeam(migrated,"a").sudokuHuntAttempts["b|c"]?.spent).toBe(1);
  expect(decodeLedger(migrated.publicLedger)).toEqual(decodeLedger(old.publicLedger));
  expect(migrated.publicLedger[0]!.c).toBe(0);
  expect(JSON.stringify(old)).toBe(before);
  const reordered = { ...migrated, teams: Object.fromEntries(Object.entries(migrated.teams).reverse()) };
  expect(projectForTeam(reordered,"a").huntAttempts).toEqual(projectForTeam(migrated,"a").huntAttempts);
  expect(validateOp(reordered,"a",{kind:"hunt",targetTeamId:"b|c",generation:1,recoveredSecret:"0"}).ok).toBe(false);
  expect(() => migrateState({...old,huntAttempts:{'["unknown","a",1]':1}},3)).toThrow();
});

test("ledger Order numbers compact only exact IDs, retaining unfamiliar and future forms", () => {
  for (const id of ["a-c0","a-c12","a-c01","a-c-1","a-c1e2","a-c9007199254740993","other-c1"]) {
    const a: PublicArtifact = {kind:"share",id:`${id}-share1`,teamId:"a",contractId:id,generation:1,method:"leak",postedAtMs:1,shareIndex:1,value:"3"};
    const encoded = encodeArtifact(a);
    expect(decodeArtifact(JSON.parse(JSON.stringify(encoded)))).toEqual(a);
    expect(typeof encoded.c).toBe(["a-c0","a-c12"].includes(id) ? "number" : "string");
  }
});

test("rotation retires unreachable counters without touching public records or success history", () => {
  let s = tick(initialState({eventId:"rotate-budgets",teamIds:["a","b"]}),0);
  s=applyOp(s,"a",{kind:"start"});
  const op={kind:"hunt" as const,targetTeamId:"b",generation:1,recoveredSecret:s.teams.b!.secret};
  s=applyOp(s,"a",op);
  const before=s;
  s=applyOp(s,"b",{kind:"rotate"});
  expect(s.huntAttempts[storedHuntKey(s,huntKey("a","b",1))]).toBeUndefined();
  expect(s.successfulHunts).toEqual(before.successfulHunts);
  expect(s.huntLog).toEqual(before.huntLog);
  expect(s.publicLedger).toEqual(before.publicLedger);
  expect(projectForTeam(s,"a").huntAttempts.b?.spent).toBe(0);
});
