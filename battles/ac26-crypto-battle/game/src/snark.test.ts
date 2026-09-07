import {isCryptoBattleProjection} from "../../portal/coordination.ts";
import {expect,test} from 'bun:test';
import {constraintTask,constraintResiduals,parseResiduals} from './snark.ts';
import {initialState,applyOp,tick,validateOp,STREAMING_ORDER_CONFIG,migrateState,projectForTeam} from './reducer.ts';
import {scoreReasons} from './score-reasons.ts';
test('gate correctness and copy correctness are separate constraints',()=>{
 for(let slot=0;slot<5;slot++)for(let value=0;value<7;value++){
  const residuals=[0,0,0,0,0];residuals[slot]=value;
  expect(constraintResiduals(constraintTask([2,3,4,5,1,...residuals]))).toEqual(residuals);
 }
 expect(constraintResiduals(constraintTask([1,2,3,4,0,6,5,4,3,2]))).toEqual([0,0,0,0,0]);
 const observed=new Set<string>();
 for(let a=0;a<7;a++)for(let b=0;b<7;b++)for(let c=0;c<7;c++){
  const residuals=[a,b,c,(a+b)%7,(b+c)%7];
  const result=constraintResiduals(constraintTask([3,5,1,6,1,...residuals]));
  expect(result).toEqual(residuals);observed.add(result.join(' '));
 }
 expect(observed.size).toBe(343);
 for(const value of [null,'','0 0 0 0','0 0 0 0 7','0,0,0,0,0','00 0 0 0 0'])expect(parseResiduals(value)).toBeUndefined();
});
test('SNARK worksheet is graded by the owned order, pays once, and rejects foreign or expired submissions',()=>{
 let s=applyOp(initialState({eventId:'snark',teamIds:['a','b'],matchSecret:'snark-test'},STREAMING_ORDER_CONFIG),'a',{kind:'start'});
 for(let t=0;t<=1_200_000;t+=30_000){s=tick(s,t);if(s.contracts.some(c=>c.teamId==='a'&&c.status==='open'&&c.task.kind==='snark-constraints'))break;}
 const order=s.contracts.find(c=>c.teamId==='a'&&c.status==='open'&&c.task.kind==='snark-constraints')!;
 expect(order).toBeDefined();if(order.task.kind!=='snark-constraints')throw new Error('wrong task');
 expect(order.allowedMethods).toEqual(['snark']);
 const view=projectForTeam(s,'a');expect(isCryptoBattleProjection(view)).toBe(true);
 for(const rows of [undefined,[],[[1,2,3]],[[1,2,3],[1,2,3],[1,2]],[[1,2,3],[1,2,3],[1,2,7]],[[1,2,3],[1,2,3],[1,2,1.5]]]){
  expect(isCryptoBattleProjection({...view,myContracts:view.myContracts.map(c=>c.id===order.id?{...c,task:{kind:'snark-constraints',rows}}:c)})).toBe(false);
 }
 s={...s,phase:'endgame',endgameLightning:{status:'awarded',cards:{a:{status:'available'}}},teams:{...s.teams,a:{...s.teams.a!,score:50}}};
 expect(validateOp(s,'a',{kind:'declare-lightning',contractId:order.id}).ok).toBe(true);
 s=applyOp(s,'a',{kind:'declare-lightning',contractId:order.id});
 const answer=constraintResiduals(order.task).join(' '),op={kind:'snark' as const,contractId:order.id,answer};
 expect(validateOp(s,'a',op).ok).toBe(true);expect(validateOp(s,'b',op).ok).toBe(false);
 const bad={...op,answer:`${(Number(answer[0])+1)%7}${answer.slice(1)}`};
 const miss=applyOp(s,'a',bad);expect(miss.teams.a!.score).toBe(50-Math.abs(s.config.scores.wrongProve));
 expect(scoreReasons(s,miss,{kind:'op',teamId:'a',op:bad})).toEqual({a:'snark'});
 const hit=applyOp(s,'a',op);expect(hit.teams.a!.score).toBe(50+2*order.points);
 expect(validateOp(hit,'a',op).ok).toBe(false);
 expect(validateOp(tick(s,order.expiresAtMs),'a',op).ok).toBe(false);
 expect(scoreReasons(s,hit,{kind:'op',teamId:'a',op})).toEqual({a:'snark'});
 for (const version of [14,15]) expect(migrateState(initialState({eventId:'old',teamIds:['a']}),version).config.snarkOrders).toBeUndefined();
});
