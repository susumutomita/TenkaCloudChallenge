import {test,expect} from 'bun:test';
import {anamorphicEncrypt,anamorphicDecrypt,ANAMORPHIC_LOOKUPS,anamorphicTask,anamorphicAnswer,parseAnamorphicAnswer} from './anamorphic.ts';
test('normal decryption remains correct for every message, key and randomness',()=>{
 for(let key=1;key<=5;key++)for(let m=1;m<=6;m++){
  const ciphertexts=Array.from({length:6},(_,r)=>anamorphicEncrypt(m,key,r));
  expect(new Set(ciphertexts.map(c=>c.join(','))).size).toBe(6);
  for(const c of ciphertexts)expect(anamorphicDecrypt(c,key)).toBe(m);
 }
});
test('balanced hidden lookup averaged over secret tables gives the ordinary single-packet distribution',()=>{
 expect(ANAMORPHIC_LOOKUPS.length).toBe(20);
 // Rejection sampling with independent uniform trials produces a uniform
 // accepted ciphertext for each fixed table, NOT the first row in sorted order.
 for(const bit of [0,1])for(let r=0;r<6;r++){
  const accepting=ANAMORPHIC_LOOKUPS.filter(k=>k[r]===bit);
  expect(accepting.length).toBe(10);
  // 10 of 20 tables accept r, then choose among 3 accepted values: 1/6.
  expect(accepting.length*6).toBe(ANAMORPHIC_LOOKUPS.length*3);
 }
 // A known/public lookup destroys that argument: three outcomes never occur.
 expect(ANAMORPHIC_LOOKUPS[0]!.filter(b=>b===1).length).toBe(3);
});
test('worksheet selects the first matching trial and decodes a separate incoming packet',()=>{
 for(let n=0;n<256;n++){
  const t=anamorphicTask([n,n*3,n*5,n*7,n*11,n*13,n*17,n*19,n*23,n*29]),a=anamorphicAnswer(t);
  expect(t.secretBits[a[0]!-1]).toBe(t.targetBit);
  expect(t.secretBits.slice(0,a[0]!-1).every(b=>b!==t.targetBit)).toBe(true);
  expect(a[1]).toBe(1+n*3%6);expect(a[2]).toBe(t.secretBits[t.receivedIndex]);
  expect(parseAnamorphicAnswer(a.join(' '))).toEqual(a);
 }
 expect(parseAnamorphicAnswer('0 1 0')).toBeUndefined();
});

import {initialState,applyOp,tick,validateOp,STREAMING_ORDER_CONFIG,migrateState,projectForTeam} from './reducer.ts';
import {isCryptoBattleProjection} from '../../portal/coordination.ts';
import {scoreReasons} from './score-reasons.ts';
test('owned anamorphic orders grade arithmetic, reject replay and expiry, and record the score reason',()=>{
 let s=applyOp(initialState({eventId:'anamorphic',teamIds:['a','b'],matchSecret:'anamorphic-test'},STREAMING_ORDER_CONFIG),'a',{kind:'start'});
 for(let t=0;t<=1_200_000;t+=30_000){s=tick(s,t);if(s.contracts.some(c=>c.teamId==='a'&&c.status==='open'&&c.task.kind==='anamorphic-rejection'))break;}
 const order=s.contracts.find(c=>c.teamId==='a'&&c.status==='open'&&c.task.kind==='anamorphic-rejection')!;
 expect(order).toBeDefined();if(order.task.kind!=='anamorphic-rejection')throw new Error('wrong task');
 expect(order.allowedMethods).toEqual(['anamorphic']);
 const projection=projectForTeam(s,'a');expect(isCryptoBattleProjection(projection)).toBe(true);
 for(const patch of [{ordinaryKey:0},{targetBit:2},{receivedIndex:6},{candidates:[]},{candidates:[[1]]},{secretBits:[0,1]},{secretBits:[0,0,0,0,0,2]}]){
  expect(isCryptoBattleProjection({...projection,myContracts:projection.myContracts.map(c=>c.id===order.id?{...c,task:{...c.task,...patch}}:c)})).toBe(false);
 }

 s={...s,phase:'endgame',endgameLightning:{status:'awarded',cards:{a:{status:'available'}}},teams:{...s.teams,a:{...s.teams.a!,score:50}}};
 expect(validateOp(s,'a',{kind:'declare-lightning',contractId:order.id}).ok).toBe(true);
 s=applyOp(s,'a',{kind:'declare-lightning',contractId:order.id});
 const answer=anamorphicAnswer(order.task).join(' '),op={kind:'anamorphic' as const,contractId:order.id,answer};
 expect(validateOp(s,'a',op).ok).toBe(true);expect(validateOp(s,'b',op).ok).toBe(false);
 const bad={...op,answer:`${Number(answer[0])%6+1}${answer.slice(1)}`};
 const miss=applyOp(s,'a',bad);expect(miss.teams.a!.score).toBe(50-Math.abs(s.config.scores.wrongProve));
 expect(scoreReasons(s,miss,{kind:'op',teamId:'a',op:bad})).toEqual({a:'anamorphic'});
 const hit=applyOp(s,'a',op);expect(hit.teams.a!.score).toBe(50+2*order.points);
 expect(validateOp(hit,'a',op).ok).toBe(false);
 expect(validateOp(tick(s,order.expiresAtMs),'a',op).ok).toBe(false);
 expect(scoreReasons(s,hit,{kind:'op',teamId:'a',op})).toEqual({a:'anamorphic'});
});

test('old match configurations do not silently acquire anamorphic orders',()=>{
 for(const version of [14,15,16,17,18])expect(migrateState(initialState({eventId:'old',teamIds:['a']}),version).config.anamorphicOrders).toBeUndefined();
});
