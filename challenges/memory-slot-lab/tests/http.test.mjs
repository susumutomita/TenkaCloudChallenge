import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
// Port 0 avoids interfering with other people's local services.
async function start(entry, env = {}) {
  const child = spawn(process.execPath, ['--input-type=module','-e',`const {server}=await import(${JSON.stringify(new URL(entry,import.meta.url).href)}); server.on('listening',()=>console.log(server.address().port));`], {env:{...process.env,PORT:'0',...env},stdio:['ignore','pipe','pipe']});
  let error='';child.stderr.on('data',d=>error+=d);
  const port=await Promise.race([once(child.stdout,'data').then(([d])=>Number(d.toString().trim())),once(child,'exit').then(()=>{throw Error(error);}),new Promise((_,reject)=>{const t=setTimeout(()=>reject(Error('startup timeout')),5000);t.unref();})]);
  return {child,base:`http://127.0.0.1:${port}`};
}
test('surface serves only participant assets; isolated verifier rejects bad inputs and accepts repair', async()=>{
  const surface=await start('../local/app/server.mjs'),verify=await start('../local/verify/server.mjs',{FLAG_SEED:'http-fixture'});
  try {
    assert.equal((await fetch(surface.base+'/')).status,200);
    assert.equal((await fetch(surface.base+'/model.mjs')).status,200);
    for(const path of ['/verify','/verify/grade.mjs','/../verify/grade.mjs','/tests/model.test.mjs'])assert.equal((await fetch(surface.base+path)).status,404);
    const post=body=>fetch(verify.base+'/verify',{method:'POST',body});
    assert.equal((await fetch(verify.base+'/healthz')).status,200);
    for(const [submission,correct]of [['{"guards":[]}',false],[JSON.stringify({guards:[['slot.live','==',true],['handle.generation','==','slot.generation'],['slot.owner','==','caller.owner'],['slot.kind','==','caller.kind']]}),true]]){
      const res=await post(JSON.stringify({submission})); assert.equal(res.status,200);assert.deepEqual(await res.json(),{correct});
    }
    assert.equal((await post('null')).status,200);
    assert.equal((await post('{')).status,400);
    assert.equal((await post('x'.repeat(5000))).status,413);
  } finally {surface.child.kill();verify.child.kill();await Promise.all([once(surface.child,'exit'),once(verify.child,'exit')]);}
});
