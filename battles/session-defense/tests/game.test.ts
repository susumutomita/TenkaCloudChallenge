import { test, expect } from "bun:test";
import { initialState, applyOp, validateOp, projectForTeam, roles, tick, execute, teamScores } from "../game/reducer.ts";
import { ACTIONS, type State, type Op, type Control } from "../game/types.ts";
let seq=0;
const fresh=(secret="a".repeat(64),eventId="test")=>initialState({eventId,teamIds:["alpha","bravo"],matchSecret:secret});
function move(s:State,team:string,body:Record<string,unknown>){const op={...body,id:`test_${++seq}`,revision:s.revision} as Op;expect(validateOp(s,team,op).ok).toBe(true);return applyOp(s,team,op);}
function ready(){let s=fresh();s=move(s,"alpha",{kind:"ready"});return move(s,"bravo",{kind:"ready"});}
function defended(cs:Control[],round=1){let s=ready();s.round=round;s=move(s,roles(s).attacker,{kind:"try",action:"export",token:s.leak});s=move(s,roles(s).attacker,{kind:"finish"});return move(s,roles(s).defender,{kind:"defend",controls:cs});}
test("missing secrets, invalid rosters, idle scoring and readiness",()=>{
  expect(()=>initialState({eventId:"x",teamIds:["a","b"]})).toThrow("matchSecret");
  expect(()=>initialState({eventId:"x",teamIds:["a","b","c"],matchSecret:"a".repeat(64)})).toThrow("two");
  const s=tick(fresh(),999999);expect(s.phase).toBe("waiting");expect(teamScores(s)).toEqual({alpha:0,bravo:0});
  expect(ready().phase).toBe("baseline");
});
test("a supplied bearer session mutates fictional assets without breaking login; baseline has no points",()=>{
  let s=ready();for(const action of Object.keys(ACTIONS))s=move(s,"bravo",{kind:"try",action,token:s.leak});
  expect(s.baselineDamage).toBe(100);expect(s.desk).toEqual({admins:["fictional-owner","fictional-intruder"],customerLinked:false,exportedCopies:1,adBudget:1000});expect(s.scores).toEqual({alpha:0,bravo:0});
  expect(validateOp(s,"bravo",{kind:"try",action:"export",token:s.leak,id:"extra",revision:s.revision})).toEqual({ok:false,error:"no_tickets"});
});
test("strict fields, invalid controls, budget, host identity, phase and revision",()=>{
  const s=ready();const common={id:"bad",revision:s.revision};
  for(const op of [{...common,kind:"try",action:"addAdmin",token:s.leak,verified:true},{...common,kind:"try",action:"constructor",token:s.leak},{...common,kind:"try",action:"spend",token:123},{...common,kind:"setScore",score:9000}])expect(validateOp(s,"bravo",op).ok).toBe(false);
  expect(validateOp(s,"outsider",{...common,kind:"finish"}).ok).toBe(false);
  expect(validateOp(s,"alpha",{...common,kind:"try",action:"export",token:s.leak}).ok).toBe(false);
  expect(validateOp(s,"bravo",{...common,kind:"finish"})).toEqual({ok:false,error:"try_first"});
  expect(validateOp(s,"bravo",{...common,revision:0,kind:"try",action:"export",token:s.leak})).toEqual({ok:false,error:"stale_revision"});
  let config=move(move(s,"bravo",{kind:"try",action:"export",token:s.leak}),"bravo",{kind:"finish"});
  for(const controls of [["stepUp","approval","leastPrivilege"],["revoke","revoke"],["fake"],"revoke"])expect(validateOp(config,"alpha",{...common,revision:config.revision,kind:"defend",controls}).ok).toBe(false);
});
test("exact replay survives JSON restore, rejects changed bodies and never consumes twice",()=>{
  const s=ready(), op:Op={kind:"try",action:"export",token:s.leak,id:"retry",revision:s.revision};
  const after=applyOp(s,"bravo",op),restored=JSON.parse(JSON.stringify(after));
  expect(applyOp(restored,"bravo",op)).toEqual(after);expect(after.tickets).toBe(3);expect(after.events).toHaveLength(1);
  expect(validateOp(after,"bravo",{...op,action:"spend"})).toEqual({ok:false,error:"request_id_reused"});
  expect(validateOp(after,"alpha",op).ok).toBe(false);
});
test("wrong and repeated evidence consumes tickets, repeated damage is capped",()=>{
  let s=defended([]);s=move(s,"bravo",{kind:"try",action:"export",token:"not-a-lab-token"});expect(s.damage).toBe(0);
  s=move(s,"bravo",{kind:"try",action:"export",token:s.leak});s=move(s,"bravo",{kind:"try",action:"export",token:s.leak});
  expect(s.damage).toBe(20);expect(s.desk.exportedCopies).toBe(1);expect(s.tickets).toBe(1);
});
test("revocation stops all old evidence but cannot stop a later leak",()=>{
  let s=defended(["revoke"]);s=move(s,"bravo",{kind:"try",action:"addAdmin",token:s.leak});expect(s.events.at(-1)?.result).toBe("revoked");expect(s.damage).toBe(0);
  let late=defended(["revoke"],3);late=move(late,roles(late).attacker,{kind:"try",action:"addAdmin",token:late.leak});expect(late.damage).toBe(40);
});
test("fresh owner authorization and reviewer authorization protect their documented actions, export bypasses both",()=>{
  let s=defended(["stepUp","approval"]);for(const action of ["addAdmin","unlink","spend","export"])s=move(s,"bravo",{kind:"try",action,token:s.leak,proof:"lab_grant_forged",approval:"lab_grant_forged"});
  expect(s.damage).toBe(20);expect(s.events.filter(e=>e.phase==="contest"&&e.action!=="defend").map(e=>e.result)).toEqual(["reauth_required","reauth_required","reauth_required","executed"]);
  s=move(s,"alpha",{kind:"legitimate"});expect(s.legitimate).toBe(true);expect(s.grants.find(g=>g.issuer==="owner")?.consumed).toBe(true);
  expect(s.events.at(-1)?.result).toBe("reviewer_success");expect(s.grants.find(g=>g.action==="addAdmin"&&g.issuer==="reviewer")?.consumed).toBe(true);
  const approval=defended(["approval"]);expect(execute(approval,approval.leak,"unlink")).toBe("approval_required");expect(execute(approval,approval.leak,"spend")).toBe("executed");
});
test("grants bind token, action, issuer, round, expiry; success consumes once; partial denial does not",()=>{
  const s=defended(["stepUp","approval"]);const g={id:"owner-proof",token:s.leak,action:"addAdmin" as const,round:s.round,expires:s.now+10,consumed:false,issuer:"owner" as const};s.grants.push(g);
  expect(execute(s,s.leak,"addAdmin",g.id)).toBe("approval_required");expect(g.consumed).toBe(false);
  expect(execute(s,s.leak,"unlink",g.id)).toBe("reauth_required");
  const reviewer={...g,id:"reviewer-proof",issuer:"reviewer" as const};s.grants.push(reviewer);
  expect(execute(s,s.leak,"addAdmin",g.id,reviewer.id)).toBe("executed");expect(g.consumed).toBe(true);expect(reviewer.consumed).toBe(true);
  expect(execute(s,s.leak,"addAdmin",g.id,reviewer.id)).toBe("reauth_required");
  g.consumed=false;g.token="other";expect(execute(s,s.leak,"addAdmin",g.id,reviewer.id)).toBe("reauth_required");
  g.token=s.leak;g.round++;expect(execute(s,s.leak,"addAdmin",g.id,reviewer.id)).toBe("reauth_required");
  g.round=s.round;g.expires=s.now;expect(execute(s,s.leak,"addAdmin",g.id,reviewer.id)).toBe("reauth_required");
});
test("role separation leaves normal duties; login and HttpOnly do not invalidate supplied evidence",()=>{
  let s=defended(["leastPrivilege"]);for(const action of Object.keys(ACTIONS))s=move(s,"bravo",{kind:"try",action,token:s.leak});expect(s.damage).toBe(30);
  s=defended(["strongLogin","httpOnly"]);s=move(s,"bravo",{kind:"try",action:"addAdmin",token:s.leak});expect(s.damage).toBe(40);
});
test("short TTL rejects exactly at expiry; trusted monotone time cannot be supplied by player",()=>{
  const s=defended(["shortTTL"]);expect(execute(tick(s,14999),s.leak,"export")).toBe("executed");expect(execute(tick(s,15000),s.leak,"export")).toBe("expired");
  const later=tick(s,20000);expect(tick(later,2)).toBe(later);expect(validateOp(s,"bravo",{kind:"try",action:"export",token:s.leak,id:"time",revision:s.revision,now:0}).ok).toBe(false);
});
test("team and event separation, projections and sanitized replay never disclose authority",()=>{
  const s=defended(["stepUp"]);const other=defended([]);other.eventId="other";other.sessions[0]!.token="different";
  expect(execute(other,s.leak,"spend")).toBe("invalid_session");expect(()=>projectForTeam(s,"outsider")).toThrow("unknown_team");
  const d=projectForTeam(s,"alpha"), a=projectForTeam(s,"bravo");expect(d.leak).toBeUndefined();expect(a.leak).toBe(s.leak);
  for(const projection of [d,a]){const json=JSON.stringify(projection);for(const name of ["secret","receipts","grants","sessions"])expect(Object.hasOwn(projection,name)).toBe(false);expect(json).not.toContain(s.secret);}
  d.scores.alpha=999;d.desk.admins.push("fake");expect(s.scores.alpha).toBe(0);expect(s.desk.admins).toHaveLength(1);
  const one=ready(), two=initialState({eventId:"other",teamIds:["alpha","bravo"],matchSecret:"a".repeat(64)});let twoReady=move(move(two,"alpha",{kind:"ready"}),"bravo",{kind:"ready"});expect(twoReady.leak).not.toBe(one.leak);
});
test("settlement waits for defender's legitimate check, alternates roles and final scores are authoritative",()=>{
  let s=ready();for(let round=1;round<=4;round++){
    const {attacker,defender}=roles(s);s=move(s,attacker,{kind:"try",action:"export",token:s.leak});s=move(s,attacker,{kind:"finish"});s=move(s,defender,{kind:"defend",controls:["stepUp","approval"]});
    s=move(s,attacker,{kind:"try",action:"export",token:s.leak});s=move(s,attacker,{kind:"finish"});expect(s.attackFinished).toBe(true);expect(s.round).toBe(round);
    s=move(s,defender,{kind:"legitimate"});expect(s.results.at(-1)?.defensePoints).toBe(65);
    s=JSON.parse(JSON.stringify(s));
  }
  expect(s.phase).toBe("finished");expect(s.results).toHaveLength(4);expect(teamScores(s)).toEqual({alpha:170,bravo:170});
  expect(s.sessions.every(x=>x.revoked)).toBe(true);expect(projectForTeam(s,"alpha").leak).toBeUndefined();
  expect(validateOp(s,"alpha",{kind:"ready",id:"new",revision:s.revision})).toEqual({ok:false,error:"match_finished"});
});
test("timeouts advance without rewind, no duplicate settlement, paused phase baseline token stays valid",()=>{
  let s=tick(ready(),75000);expect(s.phase).toBe("configure");s=tick(s,150000);expect(s.phase).toBe("contest");expect(execute(s,s.leak,"export")).toBe("executed");s=tick(s,225000);expect(s.results).toHaveLength(1);expect(s.results[0]?.defensePoints).toBe(80);expect(tick(s,225000)).toBe(s);
});
test("later-leak round emits fresh session even through delayed configure timeout",()=>{
  const s=ready();s.round=3;const baseline=s.leak;
  const contest=tick(tick(s,300000),375000);
  expect(contest.phase).toBe("contest");expect(contest.leak).not.toBe(baseline);
  expect(execute(contest,contest.leak,"addAdmin")).toBe("executed");
});
test("worst-case legal trace remains bounded and JSON serializable",()=>{
  let s=ready(),max=0;for(let round=1;round<=4;round++){
    const {attacker,defender}=roles(s);for(const action of Object.keys(ACTIONS))s=move(s,attacker,{kind:"try",action,token:s.leak});s=move(s,attacker,{kind:"finish"});s=move(s,defender,{kind:"defend",controls:["stepUp","approval","httpOnly"]});
    s=move(s,defender,{kind:"legitimate"});for(const action of Object.keys(ACTIONS))s=move(s,attacker,{kind:"try",action,token:s.leak});s=move(s,attacker,{kind:"finish"});max=Math.max(max,Buffer.byteLength(JSON.stringify(s)));
  }
  expect(Object.keys(s.receipts)).toHaveLength(50);expect(max).toBeLessThan(32_768);console.log(`maximum measured full trace state: ${max} bytes`);
});
