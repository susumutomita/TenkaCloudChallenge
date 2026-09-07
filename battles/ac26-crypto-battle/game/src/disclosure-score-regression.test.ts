import {expect,test} from 'bun:test';
import {initialState,applyOp,tick,projectForTeam,validateOp,STREAMING_ORDER_CONFIG} from './reducer.ts';
import {buildHuntOp} from './playtest.ts';
import {scoreReasons} from './score-reasons.ts';
const create=()=>tick(applyOp(initialState({eventId:'reported-live-regressions',teamIds:['a','b'],matchSecret:'regression-public-fixture'},STREAMING_ORDER_CONFIG),'a',{kind:'start'}),0);

test('streaming orders force disclosure and enable both teams to hunt using only mandatory public shares',()=>{
 let state=create();const hunted=new Set<string>();const disclosures=new Map<string,Set<string>>([['a',new Set()],['b',new Set()]]);
 for(let time=0;time<=90*60_000;time+=30_000){
  state=tick(state,time);
  for(const id of ['a','b']){
   const view=projectForTeam(state,id);
   for(const order of view.myContracts){
    if(order.status!=='open'||order.privacyConstraint!=='must-disclose')continue;
    expect(order.allowedMethods).toEqual(['leak']);
    expect(order.task.kind).toBe('reveal-share');
    expect(validateOp(state,id,{kind:'schnorr-commit',contractId:order.id,a:2,y:2}).ok).toBe(false);
    const op={kind:'leak' as const,contractId:order.id};
    expect(validateOp(state,id,op).ok).toBe(true);
    state=applyOp(state,id,op);disclosures.get(id)!.add(order.id);
   }
  }
  for(const id of ['a','b']){
   if(hunted.has(id))continue;
   const target=id==='a'?'b':'a';
   const op=buildHuntOp(projectForTeam(state,id),target,{prime:state.config.prime,threshold:state.config.threshold});
   if(!op)continue;
   expect(validateOp(state,id,op).ok).toBe(true);
   const before=state.teams[id]!.score;
   state=applyOp(state,id,op);
   expect(state.teams[id]!.score).toBeGreaterThan(before);
   hunted.add(id);
  }
 }
 expect(hunted).toEqual(new Set(['a','b']));
 for(const count of disclosures.values())expect(count.size).toBeGreaterThanOrEqual(3);
});

test('a missed deadline deducts once and preserves completed order history',()=>{
 let state=create();state=applyOp(state,'a',{kind:'leak',contractId:'a-c0'});
 const earned=state.teams.a!.score;expect(earned).toBeGreaterThan(0);
 state=tick(state,30_000);const before=state;
 // c0 is complete. c1 is still open at its exact deadline.
 state=tick(state,90_000);
 expect(state.teams.a!.score).toBe(Math.max(0,earned+state.config.scores.expiredOrder));
 expect(scoreReasons(before,state,{kind:'tick'}).a).toBe('deadline');
 expect(tick(state,90_000)).toEqual(state);
 // The existing pruning test covers zero-penalty isolation over 30 minutes.
 expect(state.teams.a!.completedContractIds).toContain(0);
});
