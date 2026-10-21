import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Memory, parseProgram, scenario, dispatch } from '../local/app/model.mjs';
import { grade } from '../local/verify/grade.mjs';
const GUARDS = [
  ['slot.live', '==', true], ['handle.generation', '==', 'slot.generation'],
  ['slot.owner', '==', 'caller.owner'], ['slot.kind', '==', 'caller.kind'],
];
const answer = JSON.stringify({ guards: GUARDS });
test('same input: normal A, reused stale read sees control then write selects B, fixed refuses', () => {
  const normal = scenario('normal'), buggy = scenario('buggy'), fixed = scenario('fixed', GUARDS);
  assert.equal(normal.read, '25%'); assert.equal(normal.rejected, false); assert.equal(normal.selected, 'A');
  assert.equal(buggy.old.slot, buggy.control.slot); assert.notEqual(buggy.old.generation, buggy.control.generation);
  assert.equal(buggy.read, 'A'); assert.equal(buggy.selected, 'B'); assert.equal(buggy.log.at(-2).slots[0].value, 'B');
  assert.equal(fixed.selected, 'A'); assert.equal(fixed.read, undefined);
  assert.equal(fixed.log.filter(x=>x.event.endsWith('rejected')).length, 2);
  assert.equal(buggy.log[0].slots[0].value, '25%'); // immutable snapshots
});
test('fix preserves current owner and type; rejects release and repeated same-type reuse', () => {
  const m = new Memory(), old = m.allocate('x','progress','A');
  m.write(old,'B',GUARDS,'x','progress'); assert.equal(m.read(old,GUARDS,'x','progress'),'B');
  assert.throws(()=>m.read(old,GUARDS,'y','progress'));
  assert.throws(()=>m.write(old,'B',GUARDS,'x','control'));
  m.release(old); assert.throws(()=>m.read(old,GUARDS,'x','progress')); assert.throws(()=>m.release(old));
  for(let i=0;i<10;i++){const fresh=m.allocate('x','progress','A');assert.throws(()=>m.write(old,'B',GUARDS,'x','progress')); assert.equal(m.read(fresh,GUARDS,'x','progress'),'A');m.release(fresh);}
  assert.throws(()=>m.read({slot:-1},GUARDS,'x','progress')); assert.match(dispatch('anything'),/^STOP/);
});
test('behavioral grading rejects every incomplete guard combination, malformed and shortcut submissions', () => {
  for (const seed of ['fixture-one','fixture-two']) {
    assert.equal(grade(answer,seed),true);
    assert.equal(grade(JSON.stringify({guards:[...GUARDS].reverse()}),seed),true);
    for(let mask=0;mask<15;mask++) assert.equal(grade(JSON.stringify({guards:GUARDS.filter((_,i)=>mask&(1<<i))}),seed),false);
  }
  for(const s of ['null','{}','{"guards":["eval"]}','{"guards":["live","live"]}','true','{"correct":true}',answer+' garbage','x'.repeat(5000)])assert.equal(grade(s,'seed'),false);
  assert.equal(grade(answer,''),false);assert.throws(()=>parseProgram('{'));
});

test('comparison programs must choose meaningful operands and operators, not just enable checks', () => {
  const submit = guards => grade(JSON.stringify({guards}), 'ast-fixture');
  assert.equal(submit(GUARDS.map(([a,op,b])=>[b,op,a])),true); // equivalent expression
  assert.equal(submit([...GUARDS, [true,'==',true]]),true); // harmless redundancy
  assert.equal(submit([[true,'==',false]]),false); // reject-all breaks valid traffic
  for(let i=0;i<GUARDS.length;i++) {
    const self = structuredClone(GUARDS); self[i][2] = self[i][0];
    assert.equal(submit(self),false); // same field on both sides proves nothing
    const inverted = structuredClone(GUARDS); inverted[i][1] = '!=';
    assert.equal(submit(inverted),false);
  }
  for(const guards of [ [['slot.generation','==','handle.owner']], [['slot.live','==',true,'extra']], [['process.exit()','==',true]], [[true,'execute',true]], Array(9).fill([true,'==',true]) ]) {
    assert.equal(submit(guards),false);
  }
});
