/** Read-only compatibility evidence against the real, prepared TenkaCloud checkout. */
import { strict as assert } from "node:assert";
import { mkdtempSync, symlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import plugin from "../coordination/session-defense.ts";
import { roles } from "../game/reducer.ts";
import type { State } from "../game/types.ts";
const root=Bun.env.TENKA_ROOT;if(!root)throw new Error("Set TENKA_ROOT to a prepared TenkaCloud checkout");
const {createMatch,transitionMatch}=await import(`${root}/scripts/local-host/coordination-core.ts`);
const {hostBrowserProblemPaths}=await import(`${root}/scripts/local-host/browser-metadata.ts`);
let match=createMatch(plugin,{eventId:"real-core-smoke",teamIds:["alpha","bravo"]});let seq=0;const totals={alpha:0,bravo:0};
function move(team:string,body:Record<string,unknown>){const op={...body,id:`real_${++seq}`,revision:(match.state as State).revision};const out=transitionMatch(plugin,match,["alpha","bravo"],0,{teamId:team,op});assert(!out.rejection,out.rejection);match=JSON.parse(JSON.stringify(out.match));for(const t of ["alpha","bravo"] as const)totals[t]+=out.deltas[t];return op;}
move("alpha",{kind:"ready"});move("bravo",{kind:"ready"});
for(let round=1;round<=4;round++){let s=match.state as State;const {attacker,defender}=roles(s);move(attacker,{kind:"try",action:"export",token:s.leak});move(attacker,{kind:"finish"});move(defender,{kind:"defend",controls:["stepUp","approval"]});move(defender,{kind:"legitimate"});s=match.state as State;move(attacker,{kind:"try",action:"export",token:s.leak});const op=move(attacker,{kind:"finish"});const retry=transitionMatch(plugin,match,["alpha","bravo"],0,{teamId:attacker,op});assert(!retry.rejection);assert.deepEqual(retry.deltas,{alpha:0,bravo:0});}
assert.deepEqual(totals,{alpha:170,bravo:170});assert.deepEqual(match.scores,totals);assert.equal((match.state as State).phase,"finished");
const scratch=mkdtempSync(join(tmpdir(),"tenka-session-catalog-"));
try{symlinkSync(new URL("../../../",import.meta.url).pathname,join(scratch,"problems"),"dir");const paths=hostBrowserProblemPaths(scratch);assert(paths.length>0);assert(!paths.some((p:string)=>p.includes("session-defense")));console.log(`PASS real core: 4 rounds, 170–170 host-core deltas, JSON restore, replay delta 0; real browser catalog: ${paths.length} existing problems, prototype safely excluded`);}finally{rmSync(scratch,{recursive:true,force:true});}
