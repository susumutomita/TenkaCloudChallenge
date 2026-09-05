import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { commit, HANDS, isCommitment, RPS_RANDOMNESS } from "./commitment.ts";
import { decodeLedger, encodeLedger } from "./ledger-codec.ts";
import { applyOp, DEFAULT_CONFIG, initialState, projectForTeam, tick, validateOp } from "./reducer.ts";
import { pairTeams } from "./rps.ts";
import RpsDuel, { POWER_FOURS, POWER_NINES, rpsRejection } from "../../portal/RpsDuel.tsx";
import type { Contract, CryptoBattleOp, CryptoBattleState } from "./types.ts";

function running(ids = ["a", "b"], batch = 6): CryptoBattleState {
  const idle = tick(initialState({ eventId: "rps", teamIds: ids, matchSecret: "private-test-fixture" }, { contractsPerIssue: batch }), 0);
  return tick(applyOp(idle, ids[0]!, { kind: "start" }), DEFAULT_CONFIG.onboardingFollowUpMs);
}
function duel(s: CryptoBattleState, id: string): Contract { return s.contracts.find(c => c.teamId === id && c.task.kind === "rps-duel" && c.status === "open")!; }
function dispatch(s: CryptoBattleState, id: string, op: CryptoBattleOp) {
  expect(validateOp(s, id, op)).toEqual({ ok: true });
  const before = JSON.stringify(s);
  const next = applyOp(JSON.parse(before), id, JSON.parse(JSON.stringify(op)));
  expect(JSON.stringify(s)).toBe(before);
  return next;
}
function seal(s: CryptoBattleState, id: string, hand: 1 | 2 | 3, r: number) { return dispatch(s, id, { kind: "rps-commit", contractId: duel(s, id).id, commitment: commit(hand, r) }); }
function open(s: CryptoBattleState, id: string, hand: number, r: number) { return dispatch(s, id, { kind: "rps-open", contractId: duel(s, id).id, hand, randomness: r }); }

describe("paired issue and clock", () => {
  test("the opening is one share; the next six Orders cover all six mechanisms", () => {
    const s = running();
    for (const id of ["a", "b"]) {
      const orders = s.contracts.filter(c => c.teamId === id);
      expect(orders[0]!.task.kind).toBe("reveal-share");
      expect(new Set(orders.slice(1).map(c => c.task.kind)).size).toBe(6);
      expect(orders).toHaveLength(7);
    }
    expect(duel(s, "a").task).toEqual({ kind: "rps-duel", duelId: (duel(s,"b").task as {duelId:string}).duelId, opponentTeamId: "b" });
    expect(duel(s,"a").expiresAtMs).toBe(duel(s,"b").expiresAtMs);
  });
  test("circle pairing covers each pair once and rotates an odd bye", () => {
    for (const n of [2,3,4,5,6,7]) {
      const ids = Array.from({ length: n }, (_, i) => `team${i}`);
      const seen = new Set<string>();
      const byes = new Set<string>();
      for (let round = 0; round < (n % 2 ? n : n - 1); round++) {
        const pairs = pairTeams(ids, round);
        const playing = pairs.flat();
        expect(new Set(playing).size).toBe(playing.length);
        for (const pair of pairs) { const key = JSON.stringify([...pair].sort()); expect(seen.has(key)).toBe(false); seen.add(key); }
        for (const id of ids) if (!playing.includes(id)) byes.add(id);
      }
      expect(seen.size).toBe(n*(n-1)/2);
      if (n % 2) expect(byes.size).toBe(n);
    }
  });
  test("single-Order batches retain all five individual tasks and occasionally issue a duel", () => {
    let s = running(["a","b"], 1);
    const kinds = new Set(s.contracts.filter(c=>c.teamId==="a").map(c=>c.task.kind));
    for (let i=1;i<13;i++) { s=tick(s, DEFAULT_CONFIG.onboardingFollowUpMs+i*DEFAULT_CONFIG.contractIntervalMs); for(const c of s.contracts) if(c.teamId==="a") kinds.add(c.task.kind); }
    expect(kinds.size).toBe(6);
  });
  test("a late tick skips unseen expired pairs and never charges for them", () => {
    const idle=tick(initialState({eventId:"late",teamIds:["a","b"]}),0);
    let s=applyOp(idle,"a",{kind:"start"});
    s=tick(s,DEFAULT_CONFIG.onboardingFollowUpMs+4*DEFAULT_CONFIG.contractIntervalMs);
    expect(s.contracts.filter(c=>c.task.kind==="rps-duel")).toHaveLength(2);
    expect(Object.values(s.teams).every(t=>t.score===0)).toBe(true);
  });
});

describe("commit/open authority and privacy", () => {
  test("all legal subgroup elements, including 1, are accepted; malformed/out-of-subgroup inputs are refused", () => {
    const s=running(), id=duel(s,"a").id;
    for (const c of [...Array(24).keys(), -1, 1.5, NaN, Infinity, "13", {}, null] as unknown[]) {
      const v=validateOp(s,"a",{kind:"rps-commit",contractId:id,commitment:c} as CryptoBattleOp);
      expect(v.ok).toBe(typeof c==="number" && isCommitment(c));
    }
    expect(validateOp(s,"b",{kind:"rps-commit",contractId:id,commitment:13}).ok).toBe(false);
    expect(validateOp(s,"a",{kind:"leak",contractId:id}).ok).toBe(false);
  });
  test("neither commitment nor accepted opening can be replaced, and opening waits for both commitments", () => {
    let s=seal(running(),"a",1,1); const id=duel(s,"a").id;
    expect(validateOp(s,"a",{kind:"rps-commit",contractId:id,commitment:2}).ok).toBe(false);
    expect(validateOp(s,"a",{kind:"rps-open",contractId:id,hand:1,randomness:1}).ok).toBe(false);
    s=seal(s,"b",2,2);
    const before=JSON.stringify(s);
    expect(validateOp(s,"a",{kind:"rps-open",contractId:id,hand:2,randomness:1}).ok).toBe(false);
    expect(JSON.stringify(s)).toBe(before);
    s=open(s,"a",1,1);
    expect(validateOp(s,"a",{kind:"rps-open",contractId:id,hand:1,randomness:1}).ok).toBe(false);
  });
  test("every possible first opening stays out of the opponent projection until the atomic settlement", () => {
    for (const hand of HANDS) for(const r of RPS_RANDOMNESS) {
      let s=seal(seal(running(),"a",hand,r),"b",3,5);
      s=open(s,"a",hand,r);
      const p=JSON.parse(JSON.stringify(projectForTeam(s,"b")));
      expect(p.publicLedger.filter((a:{kind:string})=>a.kind==="rps-open")).toEqual([]);
      const task=p.myContracts.find((c:{task:{kind:string}})=>c.task.kind==="rps-duel").task;
      expect(task).toEqual({kind:"rps-duel",duelId:(duel(s,"b").task as {duelId:string}).duelId,opponentTeamId:"a",drawPoints:10,expiryPenalty:-15,myCommitment:commit(3,5),opponentCommitment:commit(hand,r),opponentOpened:true});
      expect(Object.keys(p)).not.toContain("contracts");
      s=open(s,"b",3,5);
      const records=projectForTeam(s,"b").publicLedger.filter(a=>a.kind==="rps-open");
      expect(records).toHaveLength(2);
      expect(new Set(records.map(a=>a.postedAtMs)).size).toBe(1);
      expect(encodeLedger(decodeLedger(s.publicLedger))).toEqual([...s.publicLedger]);
    }
  });
  test("all nine hand pairs settle exactly once with the correct points", () => {
    for(const a of HANDS) for(const b of HANDS) {
      let s=seal(seal(running(),"a",a,0),"b",b,10);
      const ids=[duel(s,"a").id,duel(s,"b").id];
      s=open(open(s,"a",a,0),"b",b,10);
      const aWins=(a===1&&b===2)||(a===2&&b===3)||(a===3&&b===1);
      expect(s.teams.a!.score).toBe(a===b?10:aWins?30:0);
      expect(s.teams.b!.score).toBe(a===b?10:aWins?0:30);
      expect(ids.every(id=>s.contracts.find(c=>c.id===id)?.status==="completed")).toBe(true);
      expect(validateOp(s,"b",{kind:"rps-open",contractId:ids[1]!,hand:b,randomness:10}).ok).toBe(false);
    }
  });
});

describe("duel expiry and upgrade", () => {
  test("a team waiting for a commitment or opening gets a forfeit win; unready opponent pays ordinary expiry", () => {
    for(const stage of ["commit","open"]) {
      let s=running();
      s={...s, contracts:s.contracts.filter(c=>c.task.kind==="rps-duel"), teams:Object.fromEntries(Object.entries(s.teams).map(([id,t])=>[id,{...t,score:100}]))};
      s=seal(s,"a",1,1);
      if(stage==="open") s=open(seal(s,"b",2,2),"a",1,1);
      s=tick(s,duel(s,"a").expiresAtMs);
      expect(s.teams.a!.score).toBe(130); expect(s.teams.b!.score).toBe(85);
      expect(decodeLedger(s.publicLedger).some(a=>a.kind==="rps-open")).toBe(false);
      const again=tick(s,s.nowMs!);
      expect(again.teams).toEqual(s.teams);
    }
  });
  test("ROTATE does not cancel a committed duel or expose its opening", () => {
    let s=seal(seal(running(),"a",1,1),"b",2,2); const id=duel(s,"a").id;
    s=dispatch(s,"a",{kind:"rotate"});
    expect(duel(s,"a").id).toBe(id);
    s=open(open(s,"a",1,1),"b",2,2);
    expect(s.contracts.find(c=>c.id===id)?.rps?.outcome).toBe("win");
  });
  test("old config fields backfill on all read/write paths", () => {
    const old=JSON.parse(JSON.stringify(running())); delete old.config.scores.duelWin; delete old.config.scores.duelDraw;
    expect(projectForTeam(old,"a").myContracts.find(c=>c.task.kind==="rps-duel")?.task).toMatchObject({drawPoints:10});
    const next=seal(old,"a",1,1); expect(next.config.scores.duelWin).toBe(30); expect(next.teams.a!.score).toBe(0);
  });
});

test("the free worksheet tables agree with independent repeated multiplication for every choice", () => {
  const pow=(n:number,e:number)=>{let v=1;for(let i=0;i<e;i++)v=v*n%23;return v;};
  for(const {m,value} of POWER_FOURS) expect(value).toBe(pow(4,m));
  for(const {r,value} of POWER_NINES) expect(value).toBe(pow(9,r));
  const p=projectForTeam(running(),"a"), order=p.myContracts.find(c=>c.task.kind==="rps-duel")!;
  for(const locale of ["ja","en"] as const) {
    const html=renderToStaticMarkup(createElement(RpsDuel,{order,opponentName:"Bravo",locale,submitting:false,onSubmit:async()=>{}}));
    expect(html).toContain("4×9=36"); expect(html).toContain("36−23=13");
    expect(html).toContain(locale==="ja"?"封じる数字":"Sealed number");
    expect(html).not.toContain('value="13"');
  }
});


test("an opening error names the correction in Japanese and preserves unfamiliar errors", () => {
  const s=seal(seal(running(),"a",1,1),"b",2,2);
  const result=validateOp(s,"a",{kind:"rps-open",contractId:duel(s,"a").id,hand:2,randomness:1});
  if(result.ok) throw new Error("wrong opening accepted");
  expect(rpsRejection(result.error,"ja")).toContain("紙に控えた手と隠す数を確認");
  expect(rpsRejection(result.error,"ja")).toContain("減点はありません");
  expect(rpsRejection(result.error,"en")).toBe(result.error);
  expect(rpsRejection("unexpected server rejection","ja")).toBe("unexpected server rejection");
});

test("no Order deadline extends beyond the match; unfinished final duels expire once", () => {
  let s=running();
  s=tick(s,DEFAULT_CONFIG.matchDurationMs-60_000);
  expect(s.contracts.every(c=>c.expiresAtMs<=DEFAULT_CONFIG.matchDurationMs)).toBe(true);
  s=tick(s,DEFAULT_CONFIG.matchDurationMs);
  expect(s.phase).toBe("ended");
  expect(s.contracts.some(c=>c.status==="open")).toBe(false);
});
