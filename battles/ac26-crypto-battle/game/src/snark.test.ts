import {expect,test} from 'bun:test';
import {constraintTask,constraintResiduals,parseResiduals} from './snark.ts';
import {initialState,applyOp,tick,validateOp,STREAMING_ORDER_CONFIG,migrateState} from './reducer.ts';
import {scoreReasons} from './score-reasons.ts';
test('gate correctness and copy correctness are separate constraints',()=>{
 for(let a=0;a<7;a++)for(let b=0;b<7;b++)for(let mode=0;mode<3;mode++){
  const result=constraintResiduals(constraintTask([a,b,2,3,mode]));
  expect(result).toEqual(mode===0?[0,0,0,0,0]:mode===1?[0,0,6,0,0]:[0,0,0,6,0]);
 }
 for(const value of [null,'','0 0 0 0','0 0 0 0 7','0,0,0,0,0','00 0 0 0 0'])expect(parseResiduals(value)).toBeUndefined();
});
test('SNARK worksheet is graded by the owned order, pays once, and rejects foreign or expired submissions',()=>{
 let s=applyOp(initialState({eventId:'snark',teamIds:['a','b'],matchSecret:'snark-test'},STREAMING_ORDER_CONFIG),'a',{kind:'start'});
 for(let t=0;t<=1_200_000;t+=30_000){s=tick(s,t);if(s.contracts.some(c=>c.teamId==='a'&&c.status==='open'&&c.task.kind==='snark-constraints'))break;}
 const order=s.contracts.find(c=>c.teamId==='a'&&c.status==='open'&&c.task.kind==='snark-constraints')!;
 expect(order).toBeDefined();if(order.task.kind!=='snark-constraints')throw new Error('wrong task');
 expect(order.allowedMethods).toEqual(['snark']);
 s={...s,teams:{...s.teams,a:{...s.teams.a!,score:50}}};
 const answer=constraintResiduals(order.task).join(' '),op={kind:'snark' as const,contractId:order.id,answer};
 expect(validateOp(s,'a',op).ok).toBe(true);expect(validateOp(s,'b',op).ok).toBe(false);
 const bad={...op,answer:`${(Number(answer[0])+1)%7}${answer.slice(1)}`};
 const miss=applyOp(s,'a',bad);expect(miss.teams.a!.score).toBe(50-Math.abs(s.config.scores.wrongProve));
 expect(scoreReasons(s,miss,{kind:'op',teamId:'a',op:bad})).toEqual({a:'snark'});
 const hit=applyOp(s,'a',op);expect(hit.teams.a!.score).toBe(50+order.points);
 expect(validateOp(hit,'a',op).ok).toBe(false);
 expect(validateOp(tick(s,order.expiresAtMs),'a',op).ok).toBe(false);
 expect(scoreReasons(s,hit,{kind:'op',teamId:'a',op})).toEqual({a:'snark'});
 expect(migrateState(initialState({eventId:'old',teamIds:['a']}),14).config.snarkOrders).toBeUndefined();
});
