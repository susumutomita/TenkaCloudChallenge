import { createHmac, createHash } from "node:crypto";
import { ACTIONS, CONTROLS, type Action, type Context, type Control, type Grant, type Op, type Projection, type State } from "./types.ts";

export const ROUND_MS = 75_000;
export const roles = (s: State) => ({ defender: s.ids[(s.round - 1) % 2]!, attacker: s.ids[s.round % 2]! });
const opaque = (s: State, label: string) => createHmac("sha256", s.secret).update(JSON.stringify([s.eventId,s.round,label])).digest("hex");
const has = (s: State, c: Control) => s.controls.includes(c);
const digest = (op: unknown) => createHash("sha256").update(JSON.stringify(op)).digest("hex");
const receiptKey = (team: string, id: string) => JSON.stringify([team,id]);
const freshDesk = () => ({admins:["fictional-owner"],customerLinked:true,exportedCopies:0,adBudget:100});
export const cost = (cs: readonly Control[]) => cs.reduce((n,c) => n + CONTROLS[c],0);

export function initialState(ctx: Context): State {
  if (ctx.teamIds.length !== 2 || new Set(ctx.teamIds).size !== 2 || ctx.teamIds.some(t => !/^[a-zA-Z0-9_-]{1,80}$/.test(t))) throw new Error("Exactly two distinct team IDs are required");
  if (!ctx.matchSecret || !/^[a-f0-9]{64}$/.test(ctx.matchSecret)) throw new Error("Server-generated matchSecret is required");
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(ctx.eventId)) throw new Error("Bounded host event ID is required");
  if (ctx.teamIds.some(id => ctx.teamNames?.[id] !== undefined && (typeof ctx.teamNames[id] !== "string" || ctx.teamNames[id]!.length > 80))) throw new Error("Host team names must fit 80 UTF-16 units");
  const ids = [...ctx.teamIds].sort();
  return { schema:1, eventId:ctx.eventId, secret:ctx.matchSecret, ids, names:Object.fromEntries(ids.map(t => [t,ctx.teamNames?.[t] ?? t])), ready:[],revision:0,round:1,phase:"waiting",now:0,deadline:0,scores:Object.fromEntries(ids.map(t=>[t,0])),controls:[],sessions:[],grants:[],leak:"",baselineDamage:0,damage:0,done:[],tickets:0,legitimate:false,attackFinished:false,desk:freshDesk(),events:[],results:[],receipts:{} };
}
function openRound(s: State) {
  s.phase = "baseline"; s.deadline = s.now + ROUND_MS; s.controls = []; s.grants = [];
  s.baselineDamage = 0; s.damage = 0; s.done = []; s.tickets = 4; s.legitimate = false;s.attackFinished=false;s.desk=freshDesk();
  const token = `lab_session_${opaque(s,"baseline")}`;
  s.sessions = [{token,owner:roles(s).defender,round:s.round,expires:s.now+300_000,revoked:false}]; s.leak = token;
}
function event(s: State, actor: string, action: string, result: string, damage=0) {
  s.events.push({round:s.round,phase:s.phase,action,actor,result,damage,at:s.now});
}
function settle(s: State, reason: string) {
  const {attacker,defender} = roles(s); const c = cost(s.controls);
  const defensePoints = Math.max(0,100-s.damage-3*c-(s.legitimate?0:20));
  s.scores[attacker]! += s.damage; s.scores[defender]! += defensePoints;
  s.results.push({round:s.round,attacker,defender,controls:[...s.controls],cost:c,damage:s.damage,legitimate:s.legitimate,attackPoints:s.damage,defensePoints,reason});
  event(s,defender,"settle",reason); s.sessions.forEach(x => x.revoked = true); s.grants.forEach(x=>x.consumed=true);
  if (s.round === 4) {s.phase="finished";s.leak="";s.deadline=0;} else {s.round++;openRound(s);}
}
function startContest(s: State, controls: Control[], result: string) {
  s.controls=[...controls];
  if(has(s,"revoke"))s.sessions.forEach(x=>x.revoked=true);
  if(has(s,"shortTTL"))s.sessions.forEach(x=>x.expires=Math.min(x.expires,s.now+15_000));
  if(s.round>=3) {
    const token=`lab_session_${opaque(s,"late")}`;
    s.sessions.push({token,owner:roles(s).defender,round:s.round,expires:s.now+(has(s,"shortTTL")?15_000:90_000),revoked:false});s.leak=token;
  }
  s.phase="contest";s.deadline=s.now+ROUND_MS;s.done=[];s.tickets=4;s.desk=freshDesk();event(s,roles(s).defender,"defend",result);
}

/** Trusted host time only. Clock never rewinds; one phase expires per tick, preventing skipped rounds. */
export function tick(state: State, now: number): State {
  if (!Number.isSafeInteger(now) || now < 0 || now <= state.now) return state;
  const s = structuredClone(state); s.now=now;
  if (s.phase !== "waiting" && s.phase !== "finished" && now >= s.deadline) {
    if(s.phase === "baseline") {s.phase="configure";s.deadline=now+ROUND_MS;event(s,roles(s).attacker,"finish","baseline_timeout");}
    else if(s.phase === "configure") startContest(s,[],"no_controls_timeout");
    else settle(s,"timeout");
    s.revision++;
  }
  return s;
}

/** Fictional application authorization; session identity, policy, and one-use grants are server state. */
export function execute(s: State, token: string, action: Action, proof?: string, approval?: string): string {
  const session=s.sessions.find(x=>x.token===token);
  if(!session || session.owner!==roles(s).defender || session.round!==s.round) return "invalid_session";
  if(session.revoked) return "revoked";
  if(s.now>=session.expires) return "expired";
  if(has(s,"leastPrivilege") && ACTIONS[action].privileged) return "role_denied";
  const find = (id: string|undefined, issuer: Grant["issuer"]) => s.grants.find(g=>g.id===id && g.issuer===issuer && g.token===token && g.action===action && g.round===s.round && !g.consumed && s.now<g.expires);
  const p=find(proof,"owner"), a=find(approval,"reviewer");
  if(has(s,"stepUp") && ACTIONS[action].stepUp && !p) return "reauth_required";
  if(has(s,"approval") && ACTIONS[action].approval && !a) return "approval_required";
  // Only consume after every required authorization succeeds.
  if(p) p.consumed=true; if(a) a.consumed=true;
  return "executed";
}
export function validateOp(s: State, team: string, input: unknown): {ok:true}|{ok:false;error:string} {
  const fail=(error:string)=>({ok:false as const,error});
  if(!s.ids.includes(team)) return fail("unknown_team");
  if(!input || typeof input!=="object" || Array.isArray(input)) return fail("invalid_op");
  const op=input as Record<string,unknown>;
  const keys:Record<string,string[]>={ready:[],try:["action","token","proof","approval"],finish:[],defend:["controls"],legitimate:[]};
  if(typeof op.kind!=="string" || !Object.hasOwn(keys,op.kind) || Object.keys(op).some(k=>!["id","revision","kind",...keys[op.kind as string]!].includes(k))) return fail("invalid_fields");
  if(typeof op.id!=="string" || !/^[a-zA-Z0-9_-]{1,64}$/.test(op.id) || !Number.isSafeInteger(op.revision)) return fail("invalid_request");
  const previous=s.receipts[receiptKey(team,op.id)];
  if(previous) return previous===digest(input)?{ok:true}:fail("request_id_reused");
  if(Object.keys(s.receipts).length>=128) return fail("receipt_limit");
  if(s.phase==="finished") return fail("match_finished");
  if(op.revision!==s.revision) return fail("stale_revision");
  const {attacker,defender}=roles(s);
  if(op.kind==="ready") return s.phase==="waiting" && !s.ready.includes(team)?{ok:true}:fail("not_waiting");
  if(op.kind==="defend") {
    if(s.phase!=="configure" || team!==defender) return fail("not_defender_turn");
    if(!Array.isArray(op.controls) || op.controls.some(c=>typeof c!=="string" || !Object.hasOwn(CONTROLS,c)) || new Set(op.controls).size!==op.controls.length) return fail("invalid_controls");
    return cost(op.controls as Control[])<=6?{ok:true}:fail("budget_exceeded");
  }
  if(op.kind==="legitimate") return s.phase==="contest" && team===defender && !s.legitimate?{ok:true}:fail("not_legitimate_turn");
  if(team!==attacker || !["baseline","contest"].includes(s.phase)) return fail("not_attacker_turn");
  if(s.attackFinished) return fail("attack_finished");
  if(op.kind==="finish") return s.phase!=="baseline" || s.tickets<4?{ok:true}:fail("try_first");
  if(s.tickets<=0) return fail("no_tickets");
  if(typeof op.action!=="string" || !Object.hasOwn(ACTIONS,op.action) || typeof op.token!=="string" || op.token.length>100 || [op.proof,op.approval].some(x=>x!==undefined && (typeof x!=="string" || x.length>100))) return fail("invalid_attempt");
  return {ok:true};
}
export function applyOp(state: State, team: string, op: Op): State {
  const v=validateOp(state,team,op); if(!v.ok) throw new Error(v.error);
  const key=receiptKey(team,op.id); if(state.receipts[key]) return state;
  const s=structuredClone(state); s.receipts[key]=digest(op);s.revision++;
  if(op.kind==="ready") {s.ready.push(team);if(s.ready.length===2)openRound(s);}
  if(op.kind==="try") {
    s.tickets--;const result=execute(s,op.token,op.action,op.proof,op.approval);
    const damage=result==="executed" && !s.done.includes(op.action)?ACTIONS[op.action].damage:0;
    if(result==="executed")s.done.push(op.action);
    if(damage){
      if(op.action==="addAdmin")s.desk.admins.push("fictional-intruder");
      if(op.action==="unlink")s.desk.customerLinked=false;
      if(op.action==="export")s.desk.exportedCopies++;
      if(op.action==="spend")s.desk.adBudget=1000;
    }
    if(s.phase==="baseline")s.baselineDamage+=damage;else s.damage+=damage;
    event(s,team,op.action,result==="executed"&&damage===0?"already_changed":result,damage);
  }
  if(op.kind==="finish") {
    if(s.phase==="baseline") {s.phase="configure";s.deadline=s.now+ROUND_MS;event(s,team,"finish","baseline_complete");}
    else {s.attackFinished=true;if(s.legitimate)settle(s,"submitted");else event(s,team,"finish","waiting_for_legitimate");}
  }
  if(op.kind==="defend") {
    startContest(s,op.controls,"controls_applied");
  }
  if(op.kind==="legitimate") {
    const token=`lab_session_${opaque(s,"legitimate")}`;
    s.sessions.push({token,owner:team,round:s.round,expires:s.now+10_000,revoked:false});
    const grants=(["owner","reviewer"] as const).map(issuer=>({id:`lab_grant_${opaque(s,`${issuer}:spend`)}`,token,action:"spend" as const,round:s.round,expires:s.now+10_000,consumed:false,issuer}));
    s.grants.push(...grants);
    // The defender's trusted host seat models an owner authenticator. No passkey implementation.
    s.legitimate=execute(s,token,"spend",grants[0]!.id,grants[1]!.id)==="executed";
    if(s.legitimate && !s.done.includes("spend"))s.desk.adBudget=150;
    event(s,team,"legitimate",s.legitimate?"legitimate_success":"legitimate_failed");
    if(has(s,"approval")) {
      // A distinct server-side reviewer principal is simulated, never supplied by an op flag.
      const adminGrants=(["owner","reviewer"] as const).map(issuer=>({id:`lab_grant_${opaque(s,`${issuer}:addAdmin`)}`,token,action:"addAdmin" as const,round:s.round,expires:s.now+10_000,consumed:false,issuer}));
      s.grants.push(...adminGrants);
      const result=execute(s,token,"addAdmin",adminGrants[0]!.id,adminGrants[1]!.id);
      if(result==="executed")s.desk.admins.push("fictional-reviewed-admin");
      event(s,team,"reviewed_admin",result==="executed"?"reviewer_success":result);
    }
    if(s.attackFinished)settle(s,"submitted");
  }
  return s;
}
export function projectForTeam(s: State, me: string): Projection {
  if(!s.ids.includes(me))throw new Error("unknown_team");
  const role=roles(s).attacker===me?"attacker":"defender";
  return structuredClone({revision:s.revision,round:s.round,phase:s.phase,now:s.now,deadline:s.deadline,me,names:s.names,ready:s.ready,scores:s.scores,role,controls:s.controls,...(role==="attacker" && ["baseline","contest"].includes(s.phase)?{leak:s.leak}:{}),baselineDamage:s.baselineDamage,damage:s.damage,tickets:s.tickets,legitimate:s.legitimate,attackFinished:s.attackFinished,desk:s.desk,events:s.events,results:s.results,lateLeak:s.round>=3});
}
export const teamScores = (s: State) => ({...s.scores});
