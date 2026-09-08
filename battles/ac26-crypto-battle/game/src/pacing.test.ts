import {expect,test} from "bun:test";
import {pacingConfig,MATCH_PACING} from "./pacing.ts";
import {initialState,applyOp,tick,validateOp,projectForTeam,STREAMING_ORDER_CONFIG,migrateState} from "./reducer.ts";
test("deadline parameters are validated and persisted matches retain theirs",()=>{
 const tuned=pacingConfig({...MATCH_PACING,answerSeconds:240});
 expect(tuned.contractTtlMs).toBe(240000);expect(tuned.rushContractTtlMs).toBe(240000);
 expect(()=>pacingConfig({...MATCH_PACING,answerSeconds:0})).toThrow();
 expect(()=>pacingConfig({...MATCH_PACING,answerSeconds:1.5})).toThrow();
 expect(()=>pacingConfig({...MATCH_PACING,arrivalJitterSeconds:30})).toThrow();
 const old=initialState({eventId:"old",teamIds:["a"],matchSecret:"fixture"},{...STREAMING_ORDER_CONFIG,...tuned});
 expect(migrateState(JSON.parse(JSON.stringify(old)),18).config.contractTtlMs).toBe(240000);
});
test("issued five-symbol Caesar tasks still grade their persisted operands",()=>{
 let state=applyOp(initialState({eventId:"legacy",teamIds:["a","b"],matchSecret:"legacy-test"},{...STREAMING_ORDER_CONFIG,orderArrivalJitterMs:0}),"a",{kind:"start"});
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
