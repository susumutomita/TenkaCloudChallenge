import {test,expect} from "bun:test";
import {createLab} from "../dev/server.ts";
const base="http://127.0.0.1:5666";
test("lab seats are separated from exercise tokens; host, origin, methods and bounded bodies",async()=>{
  const {handler,seats}=createLab();
  expect((await handler(new Request(`${base}/api/projection?team=alpha`))).status).toBe(401);
  expect((await handler(new Request("http://attacker.invalid/api/projection"))).status).toBe(403);
  expect((await handler(new Request(`${base}/api/projection`,{headers:{authorization:`Seat ${seats.alpha}`,origin:"http://attacker.invalid"}}))).status).toBe(403);
  const headers={authorization:`Seat ${seats.alpha}`,"content-type":"application/json"};
  expect((await handler(new Request(`${base}/api/op`,{headers}))).status).toBe(405);
  expect((await handler(new Request(`${base}/api/op`,{headers,method:"POST",body:"["}))).status).toBe(400);
  expect((await handler(new Request(`${base}/api/op`,{headers,method:"POST",body:" ".repeat(5000)}))).status).toBe(413);
  const body=await (await handler(new Request(`${base}/api/projection?team=bravo`,{headers}))).json();expect(body.projection.me).toBe("alpha");
  expect((await handler(new Request(`${base}/api/op`,{headers:{authorization:`Seat ${seats.alpha}`,"content-type":"text/plain"},method:"POST",body:"{}"}))).status).toBe(415);
});
test("concurrent writes serialize; same request retried awards once; reload preserves server state",async()=>{
  const {handler,seats}=createLab({clock:()=>0});
  const get=async(t:string)=>(await (await handler(new Request(`${base}/api/projection`,{headers:{authorization:`Seat ${seats[t]}`}}))).json()).projection;
  const send=async(t:string,op:unknown)=>(await (await handler(new Request(`${base}/api/op`,{method:"POST",headers:{authorization:`Seat ${seats[t]}`,"content-type":"application/json"},body:JSON.stringify(op)}))).json());
  await send("alpha",{kind:"ready",id:"one",revision:0});await send("bravo",{kind:"ready",id:"two",revision:1});
  const p=await get("bravo"),op={kind:"try",action:"addAdmin",token:p.leak,id:"three",revision:p.revision};
  const outcomes=await Promise.all([send("bravo",op),send("bravo",{...op,id:"four"})]);expect(outcomes.filter(x=>x.kind==="ok")).toHaveLength(1);expect(outcomes.find(x=>x.kind==="rejected")?.error).toBe("stale_revision");
  await send("bravo",op);expect((await get("bravo")).baselineDamage).toBe(40);expect((await get("bravo")).tickets).toBe(3);
  expect((await handler(new Request(`${base}/api/projection`,{headers:{authorization:`Seat ${p.leak}`}}))).status).toBe(401);
});
test("participant JavaScript excludes server authorization and secret derivation",async()=>{
  const {handler}=createLab();const response=await handler(new Request(`${base}/app.js`));expect(response.status).toBe(200);
  const bundle=await response.text();for(const privateName of ["createHmac","startContest","matchSecret","lab_grant_"])expect(bundle).not.toContain(privateName);
});
