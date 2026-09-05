import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { applyOp, DEFAULT_CONFIG, initialState, projectForTeam, tick, validateOp } from "./reducer.ts";
import { commit, type Hand } from "./commitment.ts";
import { huntKey, storedHuntKey } from "./hunt-key.ts";
import { rpsReuseEvidence } from "./rps-hunt.ts";
import type { CryptoBattleOp, CryptoBattleState } from "./types.ts";
import RpsHunt, { RpsHuntCandidate, RpsHuntStatus } from "../../portal/RpsHunt.tsx";
import { isCryptoBattleProjection } from "../../portal/coordination.ts";
import { tacticAvailability, ageProjection } from "../../portal/FastMovePanel.tsx";

function move(s: CryptoBattleState, who: string, op: CryptoBattleOp): CryptoBattleState {
  expect(validateOp(s, who, op)).toEqual({ok:true}); return applyOp(s, who, op);
}
function start(ids=["a","b"]): CryptoBattleState {
  const s=tick(initialState({eventId:"rps-hunt-test",teamIds:ids,matchSecret:"rps-hunt-test-only"}),0);
  return tick(move(s,ids[0]!,{kind:"start"}),DEFAULT_CONFIG.onboardingFollowUpMs);
}
function order(s:CryptoBattleState,who:string) {
  const c=s.contracts.find(c=>c.teamId===who&&c.task.kind==="rps-duel"&&c.status==="open");
  if(!c||c.task.kind!=="rps-duel") throw new Error("fixture has no open duel");
  return {...c,task:c.task};
}
function seal(s:CryptoBattleState,who:string,m:Hand,r:number) { return move(s,who,{kind:"rps-commit",contractId:order(s,who).id,commitment:commit(m,r)}); }
function open(s:CryptoBattleState,who:string,m:Hand,r:number) { return move(s,who,{kind:"rps-open",contractId:order(s,who).id,hand:m,randomness:r}); }
function history(rounds=2,secondR=2,ids=["a","b"]):CryptoBattleState {
  let s=start(ids);
  for(let round=0;round<rounds;round++) {
    const participants=s.contracts.filter(c=>c.status==="open"&&c.task.kind==="rps-duel").map(c=>c.teamId);
    for(const who of participants) s=seal(s,who,who==="b"?(round===0?1:3):1,who==="b"?(round===0?2:secondR):round+3);
    for(const who of participants) s=open(s,who,who==="b"?(round===0?1:3):1,who==="b"?(round===0?2:secondR):round+3);
    s=tick(s,DEFAULT_CONFIG.onboardingFollowUpMs+(round+1)*DEFAULT_CONFIG.contractIntervalMs);
  }
  return s;
}
function ready(ids=["a","b"],r=2) { return seal(history(2,2,ids),"b",2,r); }
function prediction(s:CryptoBattleState,hand=2):CryptoBattleOp { return {kind:"hunt-rps",targetTeamId:"b",duelId:order(s,"b").task.duelId,predictedHand:hand}; }

// The fixtures deliberately choose known hands. Participant playability below
// uses only rendered public evidence to compute the submitted prediction.
describe("RPS prediction gates",()=>{
  test("requires two public equal-r openings from different duels",()=>{
    for(const s of [seal(start(),"b",2,2),seal(history(1),"b",2,2),seal(history(2,4),"b",2,2)]) expect(validateOp(s,"a",prediction(s)).ok).toBe(false);
    const s=ready(); expect(rpsReuseEvidence(s,"b").map(a=>a.randomness)).toEqual([2,2]);
    expect(validateOp(s,"a",prediction(s))).toEqual({ok:true});
    const one=s.publicLedger.find(a=>a.k==="rps-open"&&a.tm==="b")!;
    expect(validateOp({...s,publicLedger:[one,one]},"a",prediction(s)).ok).toBe(false);
  });
  test("rejects unsealed, self, unknown, malformed, late and ended targets",()=>{
    const before=history(); expect(validateOp(before,"a",prediction(before)).ok).toBe(false);
    const s=ready(),op=prediction(s);
    for(const patch of [{targetTeamId:"a"},{targetTeamId:"unknown"},{duelId:"old"},{predictedHand:0},{predictedHand:4},{predictedHand:1.5},{predictedHand:"2"},{predictedHand:null}]) expect(validateOp(s,"a",{...op,...patch} as CryptoBattleOp).ok).toBe(false);
    expect(validateOp(s,"unknown",op).ok).toBe(false);
    expect(validateOp(tick(s,order(s,"b").expiresAtMs),"a",op).ok).toBe(false);
    expect(validateOp({...s,phase:"ended"},"a",op).ok).toBe(false);
    expect(validateOp(initialState({eventId:"idle",teamIds:["a","b"]}),"a",op).ok).toBe(false);
  });
  test("one immutable prediction per hunter/duel, including after target rotation",()=>{
    let s=ready(); const op=prediction(s); s=move(s,"a",op);
    const before=JSON.stringify(s);
    expect(validateOp(s,"a",op).ok).toBe(false);
    expect(validateOp(s,"a",{...op,predictedHand:3} as CryptoBattleOp).ok).toBe(false);
    expect(JSON.stringify(s)).toBe(before);
    s=move(s,"b",{kind:"rotate"}); expect(validateOp(s,"a",op).ok).toBe(false);
    expect(projectForTeam(s,"a").rpsHunt!.pending[0]?.generation).toBe(1);
  });
  test("shares the Shamir attempt budget in both directions",()=>{
    let s=ready(); const wrong=String((BigInt(s.teams.b!.secret)+1n)%BigInt(s.config.prime));
    const shamir={kind:"hunt" as const,targetTeamId:"b",generation:1,recoveredSecret:wrong};
    s=move(s,"a",shamir); const key=storedHuntKey(s,huntKey("a","b",1)); expect(s.huntAttempts[key]).toBe(1);
    s=move(s,"a",prediction(s)); expect(s.huntAttempts[key]).toBe(2);
    s=move(s,"a",shamir); expect(s.huntAttempts[key]).toBe(3);
    expect(validateOp(s,"a",shamir).ok).toBe(false);
    const next=ready(); expect(validateOp({...next,huntAttempts:s.huntAttempts},"a",prediction(next)).ok).toBe(false);
    expect(projectForTeam(s,"a").huntAttempts.b?.spent).toBe(3);
  });
});

describe("prediction privacy and delayed settlement",()=>{
  test("a third team can hunt; target and other seats see no prediction",()=>{
    let s=ready(["a","b","c","d"]); s=move(s,"c",prediction(s,3));
    expect(projectForTeam(s,"c").rpsHunt!.pending).toEqual([{targetTeamId:"b",duelId:order(s,"b").task.duelId,generation:1,predictedHand:3}]);
    for(const reader of ["a","b","d"]) {
      const p=projectForTeam(s,reader); expect(p.rpsHunt!.pending).toEqual([]);
      expect(JSON.stringify(p)).not.toContain('"predictedHand"');
      expect(JSON.stringify(p.myContracts)).not.toContain('"predictions"');
    }
  });
  test("first opening gives no score/result/opening oracle; both openings settle exactly once",()=>{
    let s=seal(ready(),"a",1,7); const op=prediction(s), before=s.teams.a!.score;
    s=move(s,"a",op); expect(s.teams.a!.score).toBe(before);
    const count=s.publicLedger.length; s=open(s,"b",2,2);
    expect(s.teams.a!.score).toBe(before); expect(s.publicLedger).toHaveLength(count);
    expect(projectForTeam(s,"a").rpsHunt!.lastResult).toBeUndefined();
    expect(validateOp(s,"a",{...op,predictedHand:1} as CryptoBattleOp).ok).toBe(false);
    s=open(s,"a",1,7);
    expect(s.teams.a!.score).toBe(before+s.config.scores.duelWin+s.config.scores.huntBonus);
    expect(s.teams.a!.lastRpsHunt).toMatchObject({outcome:"hit",actualHand:2,predictedHand:2,points:s.config.scores.huntBonus});
    expect(s.contracts.every(c=>!c.rps?.predictions)).toBe(true);
    const after=s.teams.a!.score; s=tick(s,s.nowMs!+1); expect(s.teams.a!.score).toBe(after);
    expect(validateOp(s,"a",op).ok).toBe(false);
  });
  test("a miss costs wrongHunt at public settlement, never at submission",()=>{
    let s=seal(ready(),"a",1,7); s={...s,teams:{...s.teams,a:{...s.teams.a!,score:100}}};
    s=move(s,"a",prediction(s,3)); s=open(s,"b",2,2); expect(s.teams.a!.score).toBe(100);
    s=open(s,"a",1,7); expect(s.teams.a!.score).toBe(100+s.config.scores.duelWin-s.config.scores.wrongHunt);
    expect(s.teams.a!.lastRpsHunt).toMatchObject({outcome:"miss",points:-s.config.scores.wrongHunt});
  });
  test("current fresh r does not affect acceptance; prediction remains an assumption",()=>{
    let s=seal(ready(["a","b"],4),"a",1,7);
    for(const hand of [1,2,3]) expect(validateOp(s,"a",prediction(s,hand))).toEqual({ok:true});
    s=move(s,"a",prediction(s,1)); s=open(s,"b",2,4); s=open(s,"a",1,7);
    expect(s.teams.a!.lastRpsHunt?.outcome).toBe("miss");
  });
  for(const targetOpened of [false,true]) test(`timeout refunds without revealing a private opening (${targetOpened})`,()=>{
    let s=seal(ready(),"a",1,7); s=move(s,"a",prediction(s));
    if(targetOpened) s=open(s,"b",2,2);
    const expired=order(s,"b").expiresAtMs, count=s.publicLedger.length;
    s=tick(s,expired);
    expect(s.huntAttempts[storedHuntKey(s,huntKey("a","b",1))]).toBeUndefined();
    expect(s.teams.a!.lastRpsHunt).toMatchObject({outcome:"cancelled",points:0});
    expect(s.teams.a!.lastRpsHunt).not.toHaveProperty("actualHand");
    expect(s.publicLedger).toHaveLength(count); expect(s.contracts.every(c=>!c.rps?.predictions)).toBe(true);
    s=tick(s,expired+1); expect(s.huntAttempts[storedHuntKey(s,huntKey("a","b",1))]).toBeUndefined();
  });
  test("cancellation refunds the acceptance generation and preserves newer attempts",()=>{
    let s=ready(); s=move(s,"a",prediction(s)); s=move(s,"b",{kind:"rotate"});
    const wrong=String((BigInt(s.teams.b!.secret)+1n)%BigInt(s.config.prime));
    s=move(s,"a",{kind:"hunt",targetTeamId:"b",generation:2,recoveredSecret:wrong});
    s=tick(s,order(s,"b").expiresAtMs);
    expect(s.huntAttempts[storedHuntKey(s,huntKey("a","b",1))]).toBeUndefined();
    expect(s.huntAttempts[storedHuntKey(s,huntKey("a","b",2))]).toBe(1);
  });
});

/** Read ONLY rendered text; no fixture state, commitment helper or private answer. */
function predictionFromScreen(html:string):number|undefined {
  const text=html.replace(/<[^>]*>/g," ");
  const sealed=Number(text.match(/sealed c=(\d+)/)?.[1]);
  const rows=[...html.matchAll(/<tr><td>Past [12] \([^<]+<\/td><td>(\d+)<\/td><td>([123]) = [^<]+<\/td><td>(\d+)<\/td><\/tr>/g)];
  if(rows.length!==2||rows[0]![3]!==rows[1]![3]) throw new Error("screen lacks matching public r values");
  const r=Number(rows[0]![3]);
  const marker=text.indexOf("r → remainder of 9^r:");
  const fours=[...text.slice(text.indexOf("Hand m → remainder of 4^m:"),marker).matchAll(/(\d+) → (\d+)/g)].map(m=>[Number(m[1]),Number(m[2])] as const);
  const nines=new Map([...text.slice(marker).matchAll(/(\d+) → (\d+)/g)].map(m=>[Number(m[1]),Number(m[2])]));
  if(!text.includes("take the remainder after division by 23")) throw new Error("no computation stated");
  return fours.find(([m,v])=>(v*nines.get(r)!)%23===sealed)?.[0];
}

test("participant-only route: two public records and free tables lead to a prediction and score",()=>{
  let s=ready(); const p=projectForTeam(s,"a"),target=p.rpsHunt!.targets.find(t=>t.targetTeamId==="b")!;
  const html=renderToStaticMarkup(createElement(RpsHuntCandidate,{target,projection:p,locale:"en",submitting:false,onSubmit:async()=>{}}));
  const hand=predictionFromScreen(html); expect(hand).toBe(2);
  expect(html).toContain("Choose a hand"); expect(html).toContain("shared with share HUNT");
  expect(tacticAvailability(p).rpsHunt).toBe(true);
  s=move(s,"a",prediction(s,hand));
  const pending=renderToStaticMarkup(createElement(RpsHuntStatus,{projection:projectForTeam(s,"a"),locale:"en"}));
  expect(pending).toContain("not scored yet"); expect(pending).not.toContain("Latest RPS prediction");
  s=seal(s,"a",1,7); s=open(s,"b",2,2); s=open(s,"a",1,7);
  const result=renderToStaticMarkup(createElement(RpsHuntStatus,{projection:projectForTeam(s,"a"),locale:"en"}));
  expect(result).toContain("hit"); expect(result).toContain("Published hand");
});
test("old projections retain existing controls without requiring the new optional data",()=>{
  const {rpsHunt,...old}=projectForTeam(start(),"a");
  expect(tacticAvailability(old).rpsHunt).toBe(false);
  expect(renderToStaticMarkup(createElement(RpsHuntStatus,{projection:old,locale:"ja"}))).toBe("");
});

test("a fresh hunter cannot predict after the target has privately opened", () => {
  let s = ready(["a", "b", "c", "d"]);
  const target = order(s, "b"), peer = target.task.opponentTeamId;
  s = seal(s, peer, 1, 7);
  const op = prediction(s);
  s = open(s, "b", 2, 2);
  expect(validateOp(s, "c", op).ok).toBe(false);
  expect(projectForTeam(s, "c").rpsHunt!.targets.some(t => t.targetTeamId === "b")).toBe(false);
});

test("a wrong prediction at zero points reports the actual zero deduction", () => {
  let s = seal(ready(), "a", 3, 7); // paper loses to target scissors
  s = { ...s, teams: { ...s.teams, a: { ...s.teams.a!, score: 0 } } };
  s = move(s, "a", prediction(s, 1)); s = open(s, "b", 2, 2); s = open(s, "a", 3, 7);
  expect(s.teams.a!.score).toBe(0);
  expect(s.teams.a!.lastRpsHunt).toMatchObject({ outcome: "miss", points: 0 });
});

test("prediction controls reject malformed payloads and expire between polls", () => {
  const p = projectForTeam(ready(), "a");
  expect(isCryptoBattleProjection(p)).toBe(true);
  const { rpsHunt, ...old } = p;
  expect(isCryptoBattleProjection(old)).toBe(true);
  for (const bad of [null, {}, { ...rpsHunt, targets: null }, { ...rpsHunt, pending: [null] }, { ...rpsHunt, targets: [{ ...rpsHunt!.targets[0], evidence: [null] }] }, { ...rpsHunt, lastResult: { outcome: "other" } }]) expect(isCryptoBattleProjection({ ...p, rpsHunt: bad })).toBe(false);
  const aged = ageProjection(p, p.rpsHunt!.targets[0]!.remainingMs + 1)!;
  expect(aged.rpsHunt!.targets[0]!.remainingMs).toBe(0);
  const html = renderToStaticMarkup(createElement(RpsHuntCandidate, { target: aged.rpsHunt!.targets[0]!, projection: aged, locale: "en", submitting: false, onSubmit: async () => {} }));
  expect(html).toContain('disabled=""');
  expect(p.rpsHunt!.targets[0]!.remainingMs).toBeGreaterThan(0);
});

test("multiple eligible targets still present one focused prediction form", () => {
  const p = projectForTeam(ready(), "a"), target = p.rpsHunt!.targets[0]!;
  const many = { ...p, rpsHunt: { ...p.rpsHunt!, targets: [target, { ...target, targetTeamId: "c" }] } };
  const html = renderToStaticMarkup(createElement(RpsHunt, { projection: many, locale: "en", submitting: false, onSubmit: async () => {} }));
  expect(html).toContain("Choose a target and round");
  expect(html.match(/Submit prediction to the judge/g)).toHaveLength(1);
});
