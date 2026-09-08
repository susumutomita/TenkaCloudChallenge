import {isCryptoBattleProjection} from "../../portal/coordination.ts";
import {orderDisplayState,orderResultLabel} from "../../portal/OrderQueue.tsx";
import {expect,test} from "bun:test";
import {initialState,applyOp,tick,validateOp,projectForTeam,STREAMING_ORDER_CONFIG,migrateState} from "./reducer.ts";
import {power,verifySchnorr} from "./schnorr.ts";
const create=()=>tick(applyOp(initialState({eventId:"sigma",teamIds:["a","b"],matchSecret:"server-only-randomness"},STREAMING_ORDER_CONFIG),"a",{kind:"start"}),0);
test("commit precedes the unpredictable challenge, public verification awards once",()=>{
  let state=create(); const id="a-c0";
  expect(validateOp(state,"a",{kind:"hunt-sudoku",targetTeamId:"b",generation:1,solution:projectForTeam(state,"b").vault.sudokuSolution}).ok).toBe(false);
  const before=projectForTeam(state,"a").myContracts[0]!;
  expect(before.schnorr!.pending).toBeUndefined();
  expect(validateOp(state,"a",{kind:"schnorr-response",contractId:id,z:0}).ok).toBe(false);
  expect(validateOp(state,"b",{kind:"schnorr-commit",contractId:id,y:projectForTeam(state,"a").myContracts[0]!.schnorr!.y,a:8}).ok).toBe(false);
  const commit={kind:"schnorr-commit" as const,contractId:id,y:projectForTeam(state,"a").myContracts[0]!.schnorr!.y,a:8};
  expect(validateOp(state,"a",commit).ok).toBe(true);
  state=applyOp(state,"a",commit);
  expect(state.teams.a!.score).toBe(0);
  expect(Object.keys(state.contracts.find(c=>c.id===id)!.schnorr!)).toEqual(["y","a","e"]);
  expect(validateOp(state,"a",commit).ok).toBe(false);
  const projected=projectForTeam(state,"a").myContracts[0]!.schnorr!;
  const x=Array.from({length:11},(_,i)=>i).find(i=>power(2,i)===projected.y)!;
  const z=(3+projected.pending!.e*x)%11;
  const response={kind:"schnorr-response" as const,contractId:id,z};
  expect(validateOp(state,"a",response).ok).toBe(true);
  state=applyOp(state,"a",response);
  expect(state.teams.a!.score).toBe(30);
  expect(projectForTeam(JSON.parse(JSON.stringify(state)),"a").myContracts[0]!.schnorr!.pending!.outcome).toBe("hit");
  expect(validateOp(state,"a",response).ok).toBe(false);
  const record=projectForTeam(state,"b").publicLedger.find(a=>a.kind==="proof")!;
  if(record.kind!=="proof")throw new Error("proof missing");
  expect(verifySchnorr(Number(record.publicKey),Number(record.commitment),Number(record.challenge),Number(record.response))).toBe(true);
  expect(Object.keys(record)).not.toContain("x");
  expect(Object.keys(record)).not.toContain("r");
  expect(projectForTeam(state,"b").myContracts.every(c=>c.id!==id)).toBe(true);
  expect(JSON.stringify(projectForTeam(state,"b"))).not.toContain("server-only-randomness");
});
test("wrong response consumes the proof; no response brute force or old Sudoku bypass",()=>{
  let state=create();const id="a-c0";
  expect(validateOp(state,"a",{kind:"prove-sudoku",contractId:id,grid:projectForTeam(state,"a").vault.sudokuSolution}).ok).toBe(false);
  for(const a of [0,5,23,NaN,1.2]) expect(validateOp(state,"a",{kind:"schnorr-commit",contractId:id,y:projectForTeam(state,"a").myContracts[0]!.schnorr!.y,a}).ok).toBe(false);
  state=applyOp(state,"a",{kind:"schnorr-commit",contractId:id,y:projectForTeam(state,"a").myContracts[0]!.schnorr!.y,a:power(2,4)});
  const proof=projectForTeam(state,"a").myContracts[0]!.schnorr!;
  const x=Array.from({length:11},(_,i)=>i).find(i=>power(2,i)===proof.y)!;
  const right=(4+proof.pending!.e*x)%11;
  state=applyOp(state,"a",{kind:"schnorr-response",contractId:id,z:(right+1)%11});
  expect(state.teams.a!.score).toBe(0);
  expect(state.contracts.find(c=>c.id===id)!.answerAttempted).toBe(true);
  expect(projectForTeam(JSON.parse(JSON.stringify(state)),"a").myContracts[0]!.schnorr!.pending!.outcome).toBe("miss");
  expect(projectForTeam(state,"a").publicLedger).toHaveLength(0);
  expect(validateOp(state,"a",{kind:"schnorr-response",contractId:id,z:right}).ok).toBe(false);
  expect(validateOp(state,"a",{kind:"schnorr-commit",contractId:id,y:projectForTeam(state,"a").myContracts[0]!.schnorr!.y,a:8}).ok).toBe(false);
});
test("expiry and old matches retain their contracts",()=>{
  let state=create();state=applyOp(state,"a",{kind:"schnorr-commit",contractId:"a-c0",y:projectForTeam(state,"a").myContracts[0]!.schnorr!.y,a:8});
  state=tick(state,state.contracts.find(c=>c.id==="a-c0")!.expiresAtMs);
  expect(validateOp(state,"a",{kind:"schnorr-response",contractId:"a-c0",z:1}).ok).toBe(false);
  const old=initialState({eventId:"legacy",teamIds:["a"],matchSecret:"old"});
  expect(migrateState(old,12).config.proofProtocol).toBeUndefined();
});

test("caller cannot replace the issued statement with the universal easy proof",()=>{
 const state=create();
 expect(validateOp(state,"a",{kind:"schnorr-commit",contractId:"a-c0",y:2,a:1}).ok).toBe(false);
});

test("failed response prevents wasting lightning and reports the actual score delta",async()=>{
 const {lightningEligible}=await import("./lightning.ts");
 const {scoreReasons}=await import("./score-reasons.ts");
 let state=create();
 state={...state,phase:"endgame",endgameLightning:{status:"awarded",cards:{a:{status:"available"}}},teams:{...state.teams,a:{...state.teams.a!,score:20}}};
 const order=state.contracts.find(c=>c.id==="a-c0")!;
 expect(lightningEligible(state,order)).toBe(true);
 const y=projectForTeam(state,"a").myContracts[0]!.schnorr!.y;
 state=applyOp(state,"a",{kind:"schnorr-commit",contractId:order.id,y,a:8});
 expect(lightningEligible(state,state.contracts.find(c=>c.id===order.id)!)).toBe(false);
 expect(validateOp(state,"a",{kind:"declare-lightning",contractId:order.id}).ok).toBe(false);
 const e=state.contracts.find(c=>c.id===order.id)!.schnorr!.e;
 const x=Array.from({length:11},(_,i)=>i).find(i=>power(2,i)===y)!;
 const op={kind:"schnorr-response" as const,contractId:order.id,z:(3+e*x+1)%11};
 const after=applyOp(state,"a",op);
 expect(after.teams.a!.score).toBe(Math.max(0,20-Math.abs(state.config.scores.wrongProve)));
 expect(scoreReasons(state,after,{kind:"op",teamId:"a",op})).toEqual({a:"prove"});
 expect(lightningEligible(after,after.contracts.find(c=>c.id===order.id)!)).toBe(false);
 expect(validateOp(after,"a",{kind:"declare-lightning",contractId:order.id}).ok).toBe(false);
});

for (const proveOnly of [true, false]) test(`one-shot miss: terminal=${proveOnly}, with no forced second penalty`,()=>{
 let state=create(); const id="a-c0";
 state={...state,contracts:state.contracts.filter(c=>c.id===id).map(c=>({...c,allowedMethods:proveOnly?["prove" as const]:c.allowedMethods})),teams:{...state.teams,a:{...state.teams.a!,score:100}}};
 if(proveOnly) {
   state={...state,phase:"endgame",endgameLightning:{status:"awarded",cards:{a:{status:"available"}}}};
   state=applyOp(state,"a",{kind:"declare-lightning",contractId:id});
 }
 const y=projectForTeam(state,"a").myContracts[0]!.schnorr!.y;
 state=applyOp(state,"a",{kind:"schnorr-commit",contractId:id,y,a:8});
 const e=state.contracts[0]!.schnorr!.e;
 const x=Array.from({length:11},(_,i)=>i).find(i=>power(2,i)===y)!;
 state=applyOp(state,"a",{kind:"schnorr-response",contractId:id,z:(3+e*x+1)%11});
 const afterMiss=state.teams.a!.score;
 expect(afterMiss).toBe(100-Math.abs(state.config.scores.wrongProve));
 expect(state.contracts[0]!.status).toBe(proveOnly?"completed":"open");
 expect(validateOp(state,"a",{kind:"reveal-hint",contractId:id}).ok).toBe(!proveOnly);
 expect(validateOp(state,"a",{kind:"leak",contractId:id}).ok).toBe(!proveOnly);
 if(proveOnly){
   const view=projectForTeam(state,"a");
   expect(isCryptoBattleProjection(view)).toBe(true);
   expect(orderDisplayState(view.myContracts[0]!)).toBe("failed");
   expect(orderResultLabel(view.myContracts[0]!,"ja")).toBe("✗ 証明失敗");
   expect(orderResultLabel(view.myContracts[0]!,"en")).toBe("✗ Proof failed");
   expect(projectForTeam(migrateState(state,14),"a").lightning).toMatchObject({status:"spent",outcome:"miss",points:0});
   expect(projectForTeam(state,"a").lightning).toMatchObject({status:"spent",outcome:"miss",points:0});
   const restored=JSON.parse(JSON.stringify(state));
   expect(projectForTeam(restored,"a").myContracts[0]!.schnorr!.pending!.outcome).toBe("miss");
   state=tick(restored,state.contracts[0]!.expiresAtMs);
   expect(state.teams.a!.score).toBe(afterMiss);
   state=tick(state,state.nowMs!);
   expect(state.teams.a!.score).toBe(afterMiss);
 }
});

 test("LEAK after a failed proof keeps its real terminal outcome and ordinary score",()=>{
 let state=create();const id="a-c0";
 state={...state,phase:"endgame",endgameLightning:{status:"awarded",cards:{a:{status:"available"}}}};
 state=applyOp(state,"a",{kind:"declare-lightning",contractId:id});
 const y=projectForTeam(state,"a").myContracts[0]!.schnorr!.y;
 state=applyOp(state,"a",{kind:"schnorr-commit",contractId:id,y,a:8});
 const e=state.contracts.find(c=>c.id===id)!.schnorr!.e;
 const x=Array.from({length:11},(_,i)=>i).find(i=>power(2,i)===y)!;
 state=applyOp(state,"a",{kind:"schnorr-response",contractId:id,z:(3+e*x+1)%11});
 expect(projectForTeam(state,"a").lightning?.status).toBe("armed");
 expect(validateOp(state,"a",{kind:"leak",contractId:id}).ok).toBe(true);
 state=applyOp(state,"a",{kind:"leak",contractId:id});
 const view=projectForTeam(state,"a");
 expect(view.lightning).toMatchObject({status:"spent",outcome:"leak"});
 expect(state.teams.a!.score).toBe(10);
 expect(orderResultLabel(view.myContracts.find(c=>c.id===id)!,"ja")).toBe("✓ 完了");
 });

for(const version of [13,14]) test(`migration v${version} preserves the consumed proof and prevents late lightning`,()=>{
 let state=create();const id="a-c0";const y=projectForTeam(state,"a").myContracts[0]!.schnorr!.y;
 state={...state,phase:"endgame",endgameLightning:{status:"awarded",cards:{a:{status:"available"}}}};
 state=applyOp(state,"a",{kind:"schnorr-commit",contractId:id,y,a:8});
 const legacy={...state,contracts:state.contracts.map(c=>({...c,answerAttempted:false}))};
 const migrated=migrateState(JSON.parse(JSON.stringify(legacy)),version);
 expect(validateOp(migrated,"a",{kind:"declare-lightning",contractId:id}).ok).toBe(false);
 for(const leak of [true,false]) {
  const failed={...legacy,contracts:legacy.contracts.map(c=>({...c,allowedMethods:leak?["prove" as const,"leak" as const]:["prove" as const],schnorr:{...c.schnorr!,used:true,outcome:"miss" as const}})),teams:{...legacy.teams,a:{...legacy.teams.a!,score:93}}};
  const after=migrateState(JSON.parse(JSON.stringify(failed)),version);
  expect(after.teams.a!.score).toBe(93);
  expect(after.contracts[0]!.status).toBe(leak?"open":"completed");
  expect(validateOp(after,"a",{kind:"leak",contractId:id}).ok).toBe(leak);
  if(!leak) expect(tick(after,60_000).teams.a!.score).toBe(93);
 }
});
