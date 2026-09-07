import {expect,test} from "bun:test";
import {addPoints,CURVE_POINTS,onCurve,inverse7,parsePoint} from "./ec.ts";
import {initialState,applyOp,tick,validateOp,projectForTeam,STREAMING_ORDER_CONFIG,migrateState} from "./reducer.ts";
import {scoreReasons} from "./score-reasons.ts";
test("finite curve is closed; addition, doubling, inverse and identity obey the group law",()=>{
 expect(addPoints([2,1],[3,1])).toEqual([2,6]);
 expect(addPoints([2,1],[2,1])).toEqual([3,6]);
 expect(addPoints([2,1],[2,6])).toBeNull();
 expect(addPoints([6,0],[6,0])).toBeNull();
 expect(()=>inverse7(0)).toThrow();expect(()=>addPoints([0,0],[2,1])).toThrow();
 for(const p of CURVE_POINTS)for(const q of CURVE_POINTS){
  expect(onCurve(addPoints(p,q))).toBe(true);expect(addPoints(p,q)).toEqual(addPoints(q,p));
  expect(addPoints(p,null)).toEqual(p);
  for(const r of CURVE_POINTS)expect(addPoints(addPoints(p,q),r)).toEqual(addPoints(p,addPoints(q,r)));
 }
 for(const v of [null,5,"7 0","2,1","02 1","2 1 3","0 0","Infinity"])expect(parsePoint(v)).toBeUndefined();
 expect(parsePoint("O")).toBeNull();
});
test("new matches issue EC; real answer pays once, wrong and foreign answers cannot forge points",()=>{
 let s=applyOp(initialState({eventId:"ec",teamIds:["a","b"],matchSecret:"ec-test"},STREAMING_ORDER_CONFIG),"a",{kind:"start"});
 for(let t=0;t<=900000;t+=30000){s=tick(s,t);if(s.contracts.some(c=>c.task.kind==="ec-add"&&c.status==="open"))break;}
 s={...s,teams:{...s.teams,a:{...s.teams.a!,score:50}}};
 const c=s.contracts.find(c=>c.teamId==="a"&&c.task.kind==="ec-add"&&c.status==="open")!;
 expect(c).toBeDefined();if(c.task.kind!=="ec-add")throw new Error("missing EC");
 expect(c.allowedMethods).toEqual(["ec"]);expect(c.expiresAtMs-c.issuedAtMs).toBe(60000);
 const result=addPoints(c.task.left,c.task.right),answer=result?.join(" ")??"O";
 const op={kind:"ec" as const,contractId:c.id,answer};
 expect(validateOp(s,"b",op).ok).toBe(false);
 expect(validateOp(s,"a",{...op,answer:"7 7"}).ok).toBe(false);
 const wrong=CURVE_POINTS.find(p=>JSON.stringify(p)!==JSON.stringify(result));
 const miss=applyOp(s,"a",{...op,answer:wrong?.join(" ")??"O"});
 expect(miss.teams.a!.score).toBe(50-Math.abs(s.config.scores.wrongProve));
 expect(scoreReasons(s,miss,{kind:"op",teamId:"a",op:{...op,answer:wrong?.join(" ")??"O"}})).toEqual({a:"ec"});
 expect(miss.contracts.find(o=>o.id===c.id)!.answerAttempted).toBe(true);
 expect(validateOp(s,"a",op).ok).toBe(true);const next=applyOp(s,"a",op);
 expect(next.teams.a!.score-s.teams.a!.score).toBe(c.points);
 expect(scoreReasons(s,next,{kind:"op",teamId:"a",op})).toEqual({a:"ec"});
 expect(validateOp(next,"a",op).ok).toBe(false);
 expect(validateOp(tick(s,c.expiresAtMs),"a",op).ok).toBe(false);
 expect(projectForTeam(next,"b").myContracts.some(o=>o.id===c.id)).toBe(false);
 const old=initialState({eventId:"old",teamIds:["a"],matchSecret:"old"});
 expect(migrateState(old,13).config.ecOrders).toBeUndefined();
});
