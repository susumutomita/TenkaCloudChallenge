import {expect,test} from 'bun:test';
import {starkAnswer,starkEvaluate,starkPolynomials,starkTask,parseStarkAnswer,type StarkTask} from './stark.ts';
test('all 343 traces interpolate, divide with remainder, and detect exactly invalid transitions',()=>{
 for(let a=0;a<7;a++)for(let b=0;b<7;b++)for(let c=0;c<7;c++){
  const task:StarkTask={kind:'stark-trace',trace:[a,b,c],beta:3},p=starkPolynomials(task);
  expect([1,2,4].map(x=>starkEvaluate(p.trace,x))).toEqual([a,b,c]);
  expect([1,2].map(x=>starkEvaluate(p.constraint,x))).toEqual(starkAnswer(task).slice(0,2));
  for(let x=0;x<7;x++)expect(starkEvaluate(p.constraint,x)).toBe((starkEvaluate(p.divisor,x)*starkEvaluate(p.quotient,x)+starkEvaluate(p.remainder,x))%7);
  expect(p.remainder.every(n=>n===0)).toBe(b===a*a%7&&c===b*b%7);
 }
});
test('one FRI fold agrees with every nonzero +/-x pair and all challenges',()=>{
 for(let seed=0;seed<343;seed++)for(let beta=1;beta<7;beta++){
  const task:StarkTask={kind:'stark-trace',trace:[seed%7,Math.floor(seed/7)%7,Math.floor(seed/49)],beta},p=starkPolynomials(task);
  for(let x=1;x<7;x++){
   const plus=starkEvaluate(p.quotient,x),minus=starkEvaluate(p.quotient,7-x);
   const inv2x=[1,2,3,4,5,6].find(n=>n*2*x%7===1)!;
   const even=(plus+minus)*4%7,odd=((plus-minus+7)*inv2x)%7;
   expect(starkEvaluate(p.folded,x*x%7)).toBe((even+beta*odd)%7);
  }
 }
});
test('fold correctness does not turn an invalid trace into a valid execution',()=>{
 const task:StarkTask={kind:'stark-trace',trace:[2,4,3],beta:3};
 expect(starkAnswer(task).slice(0,2)).toEqual([0,1]);
 expect(starkPolynomials(task).remainder.some(n=>n!==0)).toBe(true);
 expect(starkPolynomials(task).folded.length).toBe(2);
 for(let n=0;n<256;n++)expect(parseStarkAnswer(starkAnswer(starkTask([n,n*3,n*5,n])).join(' '))).toBeDefined();
 expect(parseStarkAnswer('0 0 0')).toBeUndefined();expect(parseStarkAnswer('0 0 0 7')).toBeUndefined();
});

import {initialState,applyOp,tick,validateOp,STREAMING_ORDER_CONFIG,migrateState,projectForTeam} from './reducer.ts';
import {isCryptoBattleProjection} from '../../portal/coordination.ts';
import {scoreReasons} from './score-reasons.ts';
test('owned STARK orders grade arithmetic, reject replay and expiry, and record the score reason',()=>{
 let s=applyOp(initialState({eventId:'stark',teamIds:['a','b'],matchSecret:'stark-test'},STREAMING_ORDER_CONFIG),'a',{kind:'start'});
 for(let t=0;t<=1_200_000;t+=30_000){s=tick(s,t);if(s.contracts.some(c=>c.teamId==='a'&&c.status==='open'&&c.task.kind==='stark-trace'))break;}
 const order=s.contracts.find(c=>c.teamId==='a'&&c.status==='open'&&c.task.kind==='stark-trace')!;
 expect(order).toBeDefined();if(order.task.kind!=='stark-trace')throw new Error('wrong task');
 expect(order.allowedMethods).toEqual(['stark']);
 const projection=projectForTeam(s,'a');expect(isCryptoBattleProjection(projection)).toBe(true);
 for(const patch of [{beta:0},{beta:7},{trace:undefined},{trace:[1,2]},{trace:[1,2,7]},{trace:[1,2,0.5]}]){
  expect(isCryptoBattleProjection({...projection,myContracts:projection.myContracts.map(c=>c.id===order.id?{...c,task:{...c.task,...patch}}:c)})).toBe(false);
 }

 s={...s,phase:'endgame',endgameLightning:{status:'awarded',cards:{a:{status:'available'}}},teams:{...s.teams,a:{...s.teams.a!,score:50}}};
 expect(validateOp(s,'a',{kind:'declare-lightning',contractId:order.id}).ok).toBe(true);
 s=applyOp(s,'a',{kind:'declare-lightning',contractId:order.id});
 const answer=starkAnswer(order.task).join(' '),op={kind:'stark' as const,contractId:order.id,answer};
 expect(validateOp(s,'a',op).ok).toBe(true);expect(validateOp(s,'b',op).ok).toBe(false);
 const bad={...op,answer:`${(Number(answer[0])+1)%7}${answer.slice(1)}`};
 const miss=applyOp(s,'a',bad);expect(miss.teams.a!.score).toBe(50-Math.abs(s.config.scores.wrongProve));
 expect(scoreReasons(s,miss,{kind:'op',teamId:'a',op:bad})).toEqual({a:'stark'});
 const hit=applyOp(s,'a',op);expect(hit.teams.a!.score).toBe(50+2*order.points);
 expect(validateOp(hit,'a',op).ok).toBe(false);
 expect(validateOp(tick(s,order.expiresAtMs),'a',op).ok).toBe(false);
 expect(scoreReasons(s,hit,{kind:'op',teamId:'a',op})).toEqual({a:'stark'});
});

test('old match configurations do not silently acquire STARK orders',()=>{
 for(const version of [14,15,16,17])expect(migrateState(initialState({eventId:'old',teamIds:['a']}),version).config.starkOrders).toBeUndefined();
});
