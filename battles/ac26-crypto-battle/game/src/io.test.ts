import {expect,test} from 'bun:test';
import {ioAnswer,ioDistribution,ioEncode,ioEvaluate,ioOverlap,ioTables,ioTask,parseIoAnswer,ioRotations,type IoTable} from './io.ts';
test('every encoding preserves every input, including constant tables',()=>{
 for(let n=0;n<625;n++){
  const table=[n%5,Math.floor(n/5)%5,Math.floor(n/25)%5,Math.floor(n/125)%5] as IoTable;
  const encodings=ioDistribution(table);
  expect(new Set(encodings.map(e=>JSON.stringify(e))).size).toBe(4);
  for(const e of encodings)for(let x=0;x<4;x++)expect(ioEvaluate(e,x)).toBe(table[x]!);
 }
});
test('equivalent functions have identical distributions; one changed input separates them',()=>{
 const t:IoTable=[2,4,1,3];
 expect(ioOverlap(t,[2,4,1,3])).toBe(4);
 for(let i=0;i<4;i++){
  const changed=[...t] as [number,number,number,number];changed[i]=(changed[i]!+1)%5;
  expect(ioOverlap(t,changed)).toBe(0);
 }
 // Swapped cells alone are not the full published representation.
 expect(ioOverlap(t,ioEncode(t,1).cells)).toBe(0);
});
test('issued programs cover both equivalent and inequivalent cases with one-digit parameters',()=>{
 const answers=new Set<string>();let equal=0,unequal=0;
 for(let n=0;n<256;n++){
  const task=ioTask([n,n*3,n*7,n,n*11,n%4,(n+1)%4]);
  const [a,b]=ioTables(task),answer=ioAnswer(task);
  expect(answer[0]).toBe(a[task.missing[0]]);expect(answer[1]).toBe(b[task.missing[1]]);
  expect(answer[2]).toBe(Number(task.c===(task.b-task.a*task.d%5+5)%5));
  expect(answer[3]).toBe(answer[2]===1?ioRotations(task.rotations![0]).filter(r=>ioRotations(task.rotations![1]).includes(r)).length:0);
  answer[2]===1?equal++:unequal++;
  expect(parseIoAnswer(answer.join(' '))).toEqual(answer);answers.add(answer.join(' '));
 }
 expect(equal).toBe(128);expect(unequal).toBe(128);expect(answers.size).toBeGreaterThan(10);
 expect(parseIoAnswer('1 2 1')).toBeUndefined();expect(parseIoAnswer('1 2 2 4')).toBeUndefined();
 expect(()=>ioEncode([0,1,2,3],4)).toThrow();expect(()=>ioEvaluate(ioEncode([0,1,2,3],0),4)).toThrow();
});

import {initialState,applyOp,tick,validateOp,STREAMING_ORDER_CONFIG,migrateState,projectForTeam} from './reducer.ts';
import {isCryptoBattleProjection} from '../../portal/coordination.ts';
import {scoreReasons} from './score-reasons.ts';
test('owned iO orders grade arithmetic, reject replay and expiry, and record the score reason',()=>{
 let s=applyOp(initialState({eventId:'io',teamIds:['a','b'],matchSecret:'io-test'},STREAMING_ORDER_CONFIG),'a',{kind:'start'});
 for(let t=0;t<=1_200_000;t+=30_000){s=tick(s,t);if(s.contracts.some(c=>c.teamId==='a'&&c.status==='open'&&c.task.kind==='io-equivalence'))break;}
 const order=s.contracts.find(c=>c.teamId==='a'&&c.status==='open'&&c.task.kind==='io-equivalence')!;
 expect(order).toBeDefined();if(order.task.kind!=='io-equivalence')throw new Error('wrong task');
 expect(order.allowedMethods).toEqual(['io']);
 const projection=projectForTeam(s,'a');expect(isCryptoBattleProjection(projection)).toBe(true);
 for(const patch of [{rotations:[0,1]},{rotations:[1]},{rotations:[1,16]},{a:0},{a:5},{b:-1},{c:0.5},{d:0},{missing:undefined},{missing:[0]},{missing:[0,4]}]){
  const malformed={...projection,myContracts:projection.myContracts.map(c=>c.id===order.id?{...c,task:{...c.task,...patch}}:c)};
  expect(isCryptoBattleProjection(malformed)).toBe(false);
 }

 s={...s,phase:'endgame',endgameLightning:{status:'awarded',cards:{a:{status:'available'}}},teams:{...s.teams,a:{...s.teams.a!,score:50}}};
 expect(validateOp(s,'a',{kind:'declare-lightning',contractId:order.id}).ok).toBe(true);
 s=applyOp(s,'a',{kind:'declare-lightning',contractId:order.id});
 const answer=ioAnswer(order.task).join(' '),op={kind:'io' as const,contractId:order.id,answer};
 expect(validateOp(s,'a',op).ok).toBe(true);expect(validateOp(s,'b',op).ok).toBe(false);
 const bad={...op,answer:`${(Number(answer[0])+1)%5}${answer.slice(1)}`};
 const miss=applyOp(s,'a',bad);expect(miss.teams.a!.score).toBe(50-Math.abs(s.config.scores.wrongProve));
 expect(scoreReasons(s,miss,{kind:'op',teamId:'a',op:bad})).toEqual({a:'io'});
 const hit=applyOp(s,'a',op);expect(hit.teams.a!.score).toBe(50+2*order.points);
 expect(validateOp(hit,'a',op).ok).toBe(false);
 expect(validateOp(tick(s,order.expiresAtMs),'a',op).ok).toBe(false);
 expect(scoreReasons(s,hit,{kind:'op',teamId:'a',op})).toEqual({a:'io'});
});

test('old match configurations do not silently acquire iO orders',()=>{
 for(const version of [14,15,16])expect(migrateState(initialState({eventId:'old',teamIds:['a']}),version).config.ioOrders).toBeUndefined();
});

test('equal functions can have every shared support count under flawed source-dependent randomness',()=>{
 const table:IoTable=[0,1,2,3],counts=new Set<number>();
 for(let a=1;a<16;a++)for(let b=1;b<16;b++){
  const left=ioDistribution(table,a),right=ioDistribution(table,b);
  const overlap=ioOverlap(table,table,a,b);counts.add(overlap);
  expect(overlap).toBe(left.filter(e=>right.some(f=>e.offset===f.offset)).length);
  for(const e of [...left,...right])for(let x=0;x<4;x++)expect(ioEvaluate(e,x)).toBe(table[x]!);
 }
 expect([...counts].sort()).toEqual([0,1,2,3,4]);
 // Same function and shared event r=1, but event r=0 identifies source A.
 expect(ioOverlap(table,table,3,14)).toBe(1);
 expect(ioRotations(3)).toEqual([0,1]);expect(ioRotations(14)).toEqual([1,2,3]);
});
