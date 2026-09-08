import {expect,test} from "bun:test";
import {enigmaEncrypt,evolutionAnswer,evolutionTask,ECDSA_MULTIPLES,isEvolutionTask} from "./evolution.ts";
import {curriculumPlan} from "./curriculum.ts";
import {pacingConfig,MATCH_PACING} from "./pacing.ts";
import {initialState,applyOp,tick,validateOp,projectForTeam,STREAMING_ORDER_CONFIG,migrateState} from "./reducer.ts";
import {scoreReasons} from "./score-reasons.ts";

test("reflector round trip decrypts at reset positions and never maps a digit to itself",()=>{
 for(let pos=0;pos<4;pos++)for(let m=0;m<4;m++){
  const c=enigmaEncrypt([m],pos);expect(c[0]).not.toBe(m);expect(enigmaEncrypt(c,pos)).toEqual([m]);
 }
});
test("RSA single-digit originals survive encryption then private-key decryption",()=>{
 for(let m=1;m<=9;m++)expect(evolutionAnswer({kind:"rsa-decrypt",n:15,d:3,ciphertext:m**3%15})).toEqual([m]);
});
test("ECDSA signatures satisfy public verification on the order-seven curve",()=>{
 // Independent point arithmetic over F5, rather than the signing lookup table.
 type P=readonly[number,number]|null;
 const mod=(x:number)=>((x%5)+5)%5;
 const inv=(x:number)=>[1,2,3,4].find(n=>mod(n*x)===1)!;
 const add=(p:P,q:P):P=>{
  if(!p)return q;if(!q)return p;if(p[0]===q[0]&&mod(p[1]+q[1])===0)return null;
  const slope=p[0]===q[0]?mod((3*p[0]**2+2)*inv(2*p[1])):mod((q[1]-p[1])*inv(q[0]-p[0]));
  const x=mod(slope*slope-p[0]-q[0]);return[x,mod(slope*(p[0]-x)-p[1])];
 };
 const mul=(n:number,p:P):P=>{let r:P=null;for(let i=0;i<n;i++)r=add(r,p);return r;};
 for(let j=1;j<=6;j++)expect(mul(j,[0,1])).toEqual(ECDSA_MULTIPLES[j]!);
 for(let i=0;i<64;i++){
  const task=evolutionTask("ecdsa-sign",[i,i+2,i+3]);if(task.kind!=="ecdsa-sign")throw Error();
  const [r,s]=evolutionAnswer(task);expect(r).toBeGreaterThan(0);expect(s).toBeGreaterThan(0);
  const w=[1,2,3,4,5,6].find(x=>x*s!%7===1)!;
  const x=add(mul(task.hash*w%7,[0,1]),mul(r!*w%7,mul(task.d,[0,1])));expect(x?.[0]).toBe(r);
 }
});
test("shuffled curriculum covers each topic without waiting for endgame",()=>{
 const base={kind:"standard" as const,taskKind:"reveal-share" as const,privacyConstraint:"none" as const,requestedShareIndices:[1]};
 const row=(seed:string)=>Array.from({length:16},(_,i)=>curriculumPlan(seed,i+2,base)).map(p=>p.rung??p.taskKind);
 expect(new Set(row("a")).size).toBe(16);expect(row("a")).toEqual(row("a"));expect(row("a")).not.toEqual(row("b"));
 expect(row("a")).toContain("rsa-decrypt");expect(row("a")).toContain("ecdsa-sign");
});
test("configured deadlines persist and reject invalid operator inputs",()=>{
 expect(pacingConfig({...MATCH_PACING,answerSeconds:240}).contractTtlMs).toBe(240000);
 expect(()=>pacingConfig({...MATCH_PACING,answerSeconds:0})).toThrow();
 expect(()=>pacingConfig({...MATCH_PACING,arrivalJitterSeconds:30})).toThrow();
 const old=initialState({eventId:"old",teamIds:["a"],matchSecret:"fixture"},{...STREAMING_ORDER_CONFIG,...pacingConfig({...MATCH_PACING,answerSeconds:240}),evolutionOrders:undefined});
 const migrated=migrateState(JSON.parse(JSON.stringify(old)),20);expect(migrated.config.contractTtlMs).toBe(240000);expect(migrated.config.evolutionOrders).toBeUndefined();
});
test("new worksheets submit through real scoring without publishing hunt materials",()=>{
 let state=applyOp(initialState({eventId:"evo",teamIds:["a","b"],matchSecret:"evo-test"},{...STREAMING_ORDER_CONFIG,orderArrivalJitterMs:0}),"a",{kind:"start"});
 const seen=new Set<string>();
 for(let t=0;t<900000;t+=30000){
  state=tick(state,t);
  const view=projectForTeam(state,"a");
  for(const c of view.myContracts){
   if(c.status!=="open"||!c.allowedMethods.includes("evolution"))continue;
   const task=c.task;if(task.kind!=="enigma-encrypt"&&task.kind!=="rsa-decrypt"&&task.kind!=="ecdsa-sign")throw Error();
   expect(isEvolutionTask(task)).toBe(true);
   const op={kind:"evolution" as const,contractId:c.id,answer:evolutionAnswer(task).join(" ")};
   expect(validateOp(state,"b",op).ok).toBe(false);
   expect(validateOp(state,"a",op).ok).toBe(true);
   const before=state;state=applyOp(state,"a",op);
   expect(state.teams.a!.score-before.teams.a!.score).toBe(c.points);
   expect(scoreReasons(before,state,{kind:"op",teamId:"a",op}).a).toBe("evolution");
   expect(state.publicLedger).toEqual(before.publicLedger);
   expect(validateOp(state,"a",op).ok).toBe(false);seen.add(task.kind);
  }
 }
 expect([...seen].sort()).toEqual(["ecdsa-sign","enigma-encrypt","rsa-decrypt"]);
});

test("issued five-symbol Caesar tasks still grade their persisted operands",()=>{
 let state=applyOp(initialState({eventId:"legacy",teamIds:["a","b"],matchSecret:"legacy-test"},{...STREAMING_ORDER_CONFIG,evolutionOrders:false,orderArrivalJitterMs:0}),"a",{kind:"start"});
 state=tick(state,30000);
 const order=state.contracts.find(c=>c.teamId==="a"&&c.task.kind==="caesar-shift")!;
 if(order.task.kind!=="caesar-shift")throw Error();
 expect(order.task.plaintext.length).toBe(3);
 state={...state,contracts:state.contracts.map(c=>c.id===order.id?{...c,task:{...order.task,kind:"caesar-shift" as const,rung:"caesar" as const,plaintext:[0,1,2,3,4]}}:c)};
 const projected=projectForTeam(state,"a").myContracts.find(c=>c.id===order.id)!;
 if(projected.task.kind!=="caesar-shift")throw Error();
 const key=projected.task.myKey;if(typeof key!=="number")throw Error();
 const op={kind:"cipher" as const,contractId:order.id,answer:[0,1,2,3,4].map(n=>String((n+key)%6))};
 expect(validateOp(state,"a",op).ok).toBe(true);
 const next=applyOp(state,"a",op);expect(next.contracts.find(c=>c.id===order.id)?.status).toBe("completed");
});

test("evolution mistakes charge the displayed penalty, permit retry, and deadlines reject late answers",()=>{
 let state=applyOp(initialState({eventId:"penalty",teamIds:["a","b"],matchSecret:"penalty"},{...STREAMING_ORDER_CONFIG,orderArrivalJitterMs:0}),"a",{kind:"start"});
 for(let t=0;t<900000;t+=30000){
  state=tick(state,t);
  const c=state.contracts.find(c=>c.teamId==="a"&&c.status==="open"&&(c.task.kind==="enigma-encrypt"||c.task.kind==="rsa-decrypt"||c.task.kind==="ecdsa-sign"));
  if(!c||(c.task.kind!=="enigma-encrypt"&&c.task.kind!=="rsa-decrypt"&&c.task.kind!=="ecdsa-sign"))continue;
  const answer=evolutionAnswer(c.task);
  const bad={kind:"evolution" as const,contractId:c.id,answer:answer.map((n,i)=>i===0?(n+1)%10:n).join(" ")};
  state={...state,teams:{...state.teams,a:{...state.teams.a!,score:100}}};
  expect(validateOp(state,"a",bad).ok).toBe(true);
  const wrong=applyOp(state,"a",bad);
  expect(wrong.teams.a!.score).toBe(100-Math.abs(state.config.scores.wrongProve));
  const good={...bad,answer:answer.join(" ")};
  expect(validateOp(wrong,"a",good).ok).toBe(true);
  expect(applyOp(wrong,"a",good).teams.a!.score).toBe(wrong.teams.a!.score+c.points);
  const expired=tick(state, t+state.config.contractTtlMs+1);
  expect(validateOp(expired,"a",good).ok).toBe(false);
  return;
 }
 throw Error("No evolution task issued");
});

test("each shuffled Vigenere bag advances the public key position independently of the legacy plan",()=>{
 const base={kind:"standard" as const,taskKind:"reveal-share" as const,privacyConstraint:"none" as const,requestedShareIndices:[1],keyPosition:2};
 for(const seed of ["a","b","c"]){
  const positions=Array.from({length:48},(_,i)=>curriculumPlan(seed,i+2,base)).filter(p=>p.rung==="vigenere").map(p=>p.keyPosition);
  expect(positions).toEqual([0,1,2]);
 }
});

for(const kind of ["enigma-encrypt","rsa-decrypt","ecdsa-sign"] as const)test(`${kind}: endgame projection allows arming Lightning and doubles exactly one answer`,()=>{
 let state=applyOp(initialState({eventId:"light-evo",teamIds:["a","b"],matchSecret:"light-evo"},{...STREAMING_ORDER_CONFIG,orderArrivalJitterMs:0,phaseBoundaries:{buildToPressureMs:1000,pressureToEndgameMs:2000}}),"a",{kind:"start"});
 for(let t=30000;t<900000;t+=30000){
  state=tick(state,t);
  const c=projectForTeam(state,"a").myContracts.find(c=>c.status==="open"&&c.task.kind===kind);
  if(!c||(c.task.kind!=="enigma-encrypt"&&c.task.kind!=="rsa-decrypt"&&c.task.kind!=="ecdsa-sign"))continue;
  expect(c.lightningEligible).toBe(true);
  const arm={kind:"declare-lightning" as const,contractId:c.id};
  expect(validateOp(state,"a",arm).ok).toBe(true);
  state=applyOp(state,"a",arm);
  const op={kind:"evolution" as const,contractId:c.id,answer:evolutionAnswer(c.task).join(" ")};
  const before=state.teams.a!.score;
  state=applyOp(state,"a",op);
  expect(state.teams.a!.score-before).toBe(c.points*2);
  expect(projectForTeam(state,"a").lightning?.status).toBe("spent");
  expect(validateOp(state,"a",op).ok).toBe(false);
  return;
 }
 throw Error(`No ${kind} task issued`);
});
