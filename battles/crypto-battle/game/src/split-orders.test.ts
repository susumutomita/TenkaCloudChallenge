import {test,expect} from 'bun:test';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {initialState,applyOp,tick,validateOp,projectForTeam,STREAMING_ORDER_CONFIG} from './reducer.ts';
import {anamorphicTask,anamorphicAnswer,parseAnamorphicAnswer} from './anamorphic.ts';
import {AnamorphicWorksheet} from '../../portal/AnamorphicWorksheet.tsx';
import {isCryptoBattleProjection} from '../../portal/coordination.ts';
const create=()=>tick(applyOp(initialState({eventId:'split',teamIds:['a','b'],matchSecret:'split-fixture'},STREAMING_ORDER_CONFIG),'a',{kind:'start'}),0);
for(const exercise of ['encrypt','decrypt','probability'] as const)test(`${exercise} scores independently with one answer and one input`,()=>{
 let byte=0;const task={...anamorphicTask(()=>byte++%256),exercise};
 const initial=create();const order={...initial.contracts[0]!,task,allowedMethods:['anamorphic' as const],privacyConstraint:'no-raw-disclosure' as const};
 const state={...initial,contracts:[order,...initial.contracts.slice(1)]};
 const values=anamorphicAnswer(task);expect(values).toHaveLength(1);
 const op={kind:'anamorphic' as const,contractId:order.id,answer:values.join(' ')};
 expect(validateOp(state,'a',op)).toEqual({ok:true});
 expect(validateOp(state,'b',op).ok).toBe(false);
 expect(validateOp(state,'a',{...op,answer:'1 1 3'}).ok).toBe(false);
 const result=applyOp(state,'a',op);
 expect(result.teams.a!.score-state.teams.a!.score).toBe(order.points);
 expect(result.contracts.find(c=>c.id===order.id)?.status).toBe('completed');
 expect(validateOp(result,'a',op).ok).toBe(false);
 expect(validateOp(tick(state,order.expiresAtMs),'a',op).ok).toBe(false);
 const funded={...state,teams:{...state.teams,a:{...state.teams.a!,score:100}}};
 const wrong=exercise==='probability'?(values[0]===3?'4':'3'):(values[0]===1?'2':'1');
 expect(applyOp(funded,'a',{...op,answer:wrong}).teams.a!.score).toBe(100-Math.abs(state.config.scores.wrongProve));
 expect(isCryptoBattleProjection(projectForTeam(state,'a'))).toBe(true);
 for(const locale of ['ja','en'] as const){
  const html=renderToStaticMarkup(createElement(AnamorphicWorksheet,{task,locale,busy:false,wrongCost:5,onSubmit:()=>{}}));
  expect((html.match(/<input /g)||[])).toHaveLength(1);
  expect(html).not.toContain('Submit selection, decryption and probability');
 }
});
test('newly generated anamorphic Orders use independent exercises; saved triples retain their answer shape',()=>{
 let state=create();state={...state,config:{...state.config,maxOpenOrdersPerTeam:undefined}};
 const seen=new Set<string>();
 for(let t=0;t<state.config.matchDurationMs;t+=30_000){state=tick(state,t);for(const c of state.contracts){if(c.task.kind==='anamorphic-rejection'){expect(c.task.exercise).toBeDefined();seen.add(c.task.exercise!);}}}
 expect([...seen].sort()).toEqual(['decrypt','encrypt','probability']);
 let byte=0;const old=anamorphicTask(()=>byte++%256);const answer=anamorphicAnswer(old);
 expect(answer).toHaveLength(3);expect(parseAnamorphicAnswer(answer.join(' '),old)).toEqual(answer);
});
