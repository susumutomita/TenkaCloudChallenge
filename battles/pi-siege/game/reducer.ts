import { abs, allocation, approximation, candidateCost, compare, format, fraction, minimumCost, table } from "./math.ts";
import type { Claim, Context, Op, Projection, Round, State, Task, Team, Text, Verdict } from "./types.ts";

export const STATE_SCHEMA_VERSION = 2;
export const line = (ja: string, en: string): Text => ({ ja, en });
const displayName = (name: string) => { const characters = Array.from(name); return characters.length <= 64 ? name : `${characters.slice(0, 63).join("")}…`; };
const ok: Verdict = { ok: true };
const no = (error: string): Verdict => ({ ok: false, error });
const object = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const integer = (v: unknown, min: number, max: number): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= min && v <= max;
const keys = (v: Record<string, unknown>, allowed: string[]) => Object.keys(v).every(k => allowed.includes(k));
const shortId = (v: unknown): v is string => typeof v === "string" && /^[a-zA-Z0-9_-]{1,80}$/.test(v);
const cell = (v: unknown) => object(v) && keys(v, ["n", "d"]) && integer(v.n, -9, 9) && integer(v.d, 1, 16);
const floor = (v: unknown) => object(v) && keys(v, ["n", "d"]) && integer(v.n, 1, 256) && integer(v.d, 1, 4096);

export function initialState(ctx: Context): State {
  if (ctx.teamIds.length !== 2 || new Set(ctx.teamIds).size !== 2 || ctx.teamIds.some(id => !shortId(id) || ["__proto__", "constructor", "prototype"].includes(id))) throw new Error("pi-siege requires two distinct teams");
  const roster = [...ctx.teamIds];
  const teams = Object.fromEntries(roster.map(id => [id, {
    id, name: displayName(ctx.teamNames?.[id] ?? id), ready: false, score: 0, tickets: 6, passed: false,
    range: 7, rows: 4, grid: 10, previews: [], claimed: false, feedback: [],
  } satisfies Team]));
  return { schema: 2, phase: "waiting", round: 0, revision: 0, roster, teams, turn: roster[0]!, claims: [], ledger: [], receipts: [] };
}
function taskValid(task: unknown, round: Round, team: Team): task is Task {
  if (!object(task)) return false;
  if (round === 0) return task.kind === "record" && keys(task, ["kind", "p", "q"]) && integer(task.p, 0, 4000) && integer(task.q, 1, team.range);
  if (round === 1) return task.kind === "table" && keys(task, ["kind", "cells"]) && Array.isArray(task.cells) && task.cells.length === 4 && task.cells.every(cell);
  if (round === 2) return task.kind === "terms" && keys(task, ["kind", "ones"]) && integer(task.ones, 0, team.rows);
  return task.kind === "allocation" && keys(task, ["kind", "n", "d"]) && task.d === team.grid && integer(task.n, 1, team.grid - 1);
}
function replay(state: State, teamId: string, op: unknown): Verdict | undefined {
  if (!object(op) || !shortId(op.requestId)) return undefined;
  const receipt = state.receipts.find(r => r.id === op.requestId && r.team === teamId);
  if (!receipt) return undefined;
  return receipt.payload === JSON.stringify(op) ? ok : no("request_id_reused");
}
export function validateOp(state: State, teamId: string, input: unknown): Verdict {
  if (!Object.hasOwn(state.teams, teamId)) return no("unknown_team");
  const repeated = replay(state, teamId, input);
  if (repeated) return repeated;
  if (!object(input) || !shortId(input.requestId) || !integer(input.revision, 0, 100) || !integer(input.round, 0, 3)) return no("bad_envelope");
  if (input.revision !== state.revision || input.round !== state.round) return no("stale_view");
  if (state.phase === "ended") return no("match_ended");
  const envelope = ["kind", "requestId", "revision", "round"];
  const team = state.teams[teamId]!;
  if (input.kind === "ready") return state.phase === "waiting" && !team.ready && keys(input, envelope) ? ok : no("already_ready");
  if (state.phase !== "playing") return no("not_started");
  if (state.turn !== teamId || team.passed) return no("not_your_turn");
  if (input.kind === "pass") return keys(input, envelope) ? ok : no("bad_op");
  if (team.tickets < 1) return no("no_tickets");
  if (input.kind === "upgrade") {
    if (!keys(input, envelope) || state.round === 1 || (state.round === 0 && team.range === 1000) || (state.round === 2 && team.rows === 6) || (state.round === 3 && team.grid === 100)) return no("upgrade_unavailable");
    return ok;
  }
  if (input.kind === "inspect") return keys(input, [...envelope, "task"]) && taskValid(input.task, state.round, team) ? ok : no("bad_task");
  if (input.kind === "publish") {
    if (!keys(input, [...envelope, "sourceId", "scope", "floor", "exponent"]) || team.claimed) return no("already_published");
    if (!shortId(input.sourceId) || !team.previews.some(p => p.id === input.sourceId)) return no("unknown_source");
    if (state.round === 0) return ["finite", "forever"].includes(String(input.scope)) && input.floor === undefined && input.exponent === undefined ? ok : no("bad_claim");
    if (state.round === 1) return floor(input.floor) && input.scope === undefined && input.exponent === undefined ? ok : no("bad_claim");
    if (state.round === 2) return integer(input.exponent, 0, 30) && input.scope === undefined && input.floor === undefined ? ok : no("bad_claim");
    return input.scope === undefined && input.floor === undefined && input.exponent === undefined ? ok : no("bad_claim");
  }
  if (input.kind === "audit") {
    if (!keys(input, [...envelope, "claimId", "reason", "ones", "cost"]) || !shortId(input.claimId)) return no("bad_audit");
    const claim = state.claims.find(c => c.id === input.claimId);
    if (!claim || claim.round !== state.round || claim.author === teamId || claim.status !== "open" || claim.challenged.includes(teamId)) return no("audit_unavailable");
    if (state.round === 2) return input.reason === "mixed" && integer(input.ones, 0, claim.rows ?? 0) && integer(input.cost, 0, 30) ? ok : no("bad_evidence");
    const reasons = state.round === 0 ? ["scope"] : state.round === 1 ? ["zero", "floor", "large"] : ["collision", "error"];
    return reasons.includes(String(input.reason)) && input.ones === undefined && input.cost === undefined ? ok : no("bad_evidence");
  }
  return no("bad_op");
}

export function facts(task: Task, rows: number): Text[] {
  if (task.kind === "record") {
    const r = approximation(task.p, task.q);
    return [line(`${r.value}: 誤差の目安は ${r.error}。表示は丸めているが、判定は丸め前の分数区間で行う。`, `${r.value}: approximate error ${r.error.replace("約", "")}. Display is rounded; decisions use the exact rational interval before rounding.`),
      line(`1/q³との比較: ${r.cubic === "below" ? "この一回は基準より良い" : r.cubic === "above" ? "この一回は基準より粗い" : "区間の精度では判定できない"}`, `Compared with 1/q³: ${r.cubic === "below" ? "this one record beats the benchmark" : r.cubic === "above" ? "this one record is coarser than the benchmark" : "the interval cannot decide"}.`),
      line("良い分数を一つ見つけても、いくら先でも続くとは言えない。公開する範囲を自分で選ぶ。", "One good fraction does not show that such records continue arbitrarily far. Choose the scope of your publication.")];
  }
  if (task.kind === "table") {
    const r = table(task.cells);
    return [line(`対角の積の差 = ${format(r.determinant)}`, `Difference of diagonal products = ${format(r.determinant)}`),
      line(`全セルを ${r.common} 倍すると整数になる。差は ${r.common * r.common} 倍される。`, `Multiplying every cell by ${r.common} clears its denominator. The difference is multiplied by ${r.common * r.common}.`),
      line(`差がゼロでないことを確認できれば、整数由来の下限は ${format(r.floor)}。ゼロならこの下限は使えない。`, `If the difference is nonzero, integer clearing gives the floor ${format(r.floor)}. This floor cannot be used for a zero difference.`),
      line(`小ささの目標 1/8 以下: ${r.small ? "達成" : "まだ大きい"}`, `Magnitude at most 1/8: ${r.small ? "reached" : "still too large"}.`)];
  }
  if (task.kind === "terms") {
    const cost = candidateCost(rows, task.ones);
    return [line(`種類0が ${rows - task.ones} 枚、種類1が ${task.ones} 枚。`, `${rows - task.ones} type-0 cards and ${task.ones} type-1 cards.`),
      line(`各種類の次数を0,1,2…とずらすと、種類の合計＋次数の合計 = ${cost}。候補の上限は 1/${2 ** cost}。`, `Degrees 0,1,2… within each type give type sum + degree sum = ${cost}. Candidate upper bound: 1/${2 ** cost}.`),
      line("この配置で調べたことは、全配置を調べたことではない。相手は別の混ぜ方で反例を作れる。", "Checking this arrangement does not check all arrangements. An opponent can try another split."),
      line("これは係数の大きさの上限を1と置いた教育用模型。重複しない候補でも、実際にはゼロになる可能性がある。", "This teaching model bounds the magnitude of the extra coefficient by 1. A candidate without repeated pairs may still actually be zero.")];
  }
  const r = allocation(task.n, task.d);
  return [line(`配分 b = ${task.n}/${task.d}、基準 ν = 9/4。`, `Allocation b = ${task.n}/${task.d}; benchmark ν = 9/4.`),
    line(`入口の余裕: 重複側 2b−1 = ${format(r.collision)}、誤差側 ν(1−b)−1 = ${format(r.error)}。`, `Entry margins: repetition 2b−1 = ${format(r.collision)}; error ν(1−b)−1 = ${format(r.error)}.`),
    line(`小さな調整 δ=1/10 も確認: θ−A² = ${format(r.actualCollision)}、ν(A−θ)−(1−θ) = ${format(r.actualError)}。`, `With adjustment δ=1/10: θ−A² = ${format(r.actualCollision)}; ν(A−θ)−(1−θ) = ${format(r.actualError)}.`),
    line("入口2つと調整後2つ、4つ全て正で成立。比較点は入口の2つの余裕の小さい方を比べる。これは補間定理を使う前の配分条件で、証明完成ではない。", "All four margins, two entry and two adjusted, must be positive. Bonus compares the smaller entry margin. These conditions precede interpolation and do not finish the proof.")];
}
function validClaim(state: State, c: Claim): boolean {
  if (c.task.kind === "record") return c.scope === "finite" && approximation(c.task.p, c.task.q).cubic !== "uncertain";
  if (c.task.kind === "table") {
    const r = table(c.task.cells);
    return r.determinant.n !== 0n && r.small && !!c.floor && compare(fraction(c.floor.n, c.floor.d), r.floor) <= 0;
  }
  if (c.task.kind === "terms") return c.exponent !== undefined && c.exponent <= minimumCost(c.rows!);
  return allocation(c.task.n, c.task.d).valid;
}
function auditWorks(state: State, c: Claim, op: Extract<Op, { kind: "audit" }>): boolean {
  if (c.task.kind === "record") return op.reason === "scope" && c.scope === "forever";
  if (c.task.kind === "table") {
    const r = table(c.task.cells);
    return (op.reason === "zero" && r.determinant.n === 0n) || (op.reason === "large" && !r.small) || (op.reason === "floor" && !!c.floor && compare(fraction(c.floor.n, c.floor.d), r.floor) > 0);
  }
  if (c.task.kind === "terms") {
    const actual = candidateCost(c.rows!, op.ones!);
    return op.cost === actual && actual < c.exponent!;
  }
  const r = allocation(c.task.n, c.task.d);
  return op.reason === "collision" ? r.collision.n <= 0n || r.actualCollision.n <= 0n : r.error.n <= 0n || r.actualError.n <= 0n;
}
function award(state: State, teamId: string, points: number, text: Text[]) {
  state.teams[teamId]!.score += points;
  state.ledger.push({ round: state.round, team: teamId, points, text });
}
function settle(state: State) {
  const claims = state.claims.filter(c => c.round === state.round);
  for (const c of claims) {
    if (c.status !== "open") continue;
    const valid = validClaim(state, c);
    c.status = valid ? "held" : "broken";
    award(state, c.author, valid ? 6 : -3, [valid ? line("主張はこの有限の証拠の範囲で成立。+6", "Claim holds within this finite evidence. +6") : line("主張に未解決の逃げ道が残った。−3", "An uncovered gap remains in the claim. −3"), ...c.facts]);
  }
  const held = claims.filter(c => c.status === "held");
  if (held.length === 2) {
    const quality = (c: Claim) => {
      if (c.task.kind === "record") return approximation(c.task.p, c.task.q).scaledHigh;
      if (c.task.kind === "table") return fraction(-c.floor!.n, c.floor!.d);
      if (c.task.kind === "terms") return fraction(-c.exponent!);
      const r = allocation(c.task.n, c.task.d);
      return fraction(-r.weakest.n, r.weakest.d);
    };
    const cmp = compare(quality(held[0]!), quality(held[1]!));
    if (cmp !== 0) award(state, held[cmp < 0 ? 0 : 1]!.author, 2, [line("有効な主張同士の比較で、より強い記録・保証に+2。行動券を探索や再設計へ回した成果。", "Among valid claims, the stronger record or guarantee earns +2. Your exploration and design choices count.")]);
  }
  if (state.round === 3) { state.phase = "ended"; return; }
  state.round = (state.round + 1) as Round;
  state.turn = state.roster[state.round % 2]!;
  for (const id of state.roster) {
    const t = state.teams[id]!;
    Object.assign(t, { tickets: 6, passed: false, range: 7, rows: 4, grid: 10, previews: [], claimed: false, feedback: [] });
  }
}
export function applyOp(state: State, teamId: string, op: Op): State {
  const verdict = validateOp(state, teamId, op);
  if (!verdict.ok) throw new Error(verdict.error);
  if (replay(state, teamId, op)?.ok) return state;
  const next: State = structuredClone(state), t = next.teams[teamId]!;
  if (op.kind === "ready") {
    t.ready = true;
    if (next.roster.every(id => next.teams[id]!.ready)) next.phase = "playing";
  } else {
    t.feedback = [];
    if (op.kind === "pass") { t.passed = true; t.feedback = [line("このラウンドの行動を終えた。相手が終えると公開主張を精算する。", "You finished this round. Published claims settle when your opponent finishes.")] }
    else {
      t.tickets -= 1;
      if (op.kind === "upgrade") {
        if (next.round === 0) { t.range = t.range === 7 ? 120 : 1000; t.feedback = [line(`探索できる分母を ${t.range} まで広げた。探索に券を使うほど、相手を監査する券は減る。`, `Denominator range expanded to ${t.range}. Tickets spent exploring leave fewer for audits.`)] }
        if (next.round === 2) { t.rows += 1; t.feedback = [line(`行カードを ${t.rows} 枚に増やした。どの種類へ分けても消せない次数費用を増やせるが、監査用の券を1枚使った。`, `Increased row cards to ${t.rows}. More rows raise unavoidable degree costs, but spend one audit ticket.`)] }
        if (next.round === 3) { t.grid = t.grid === 10 ? 50 : 100; t.feedback = [line(`配分を 1/${t.grid} 刻みで選べるようにした。基準が2に近づくほど両立する幅が狭くなり、粗い目盛りでは見落とす。`, `Allocation grid refined to 1/${t.grid}. As the benchmark approaches 2, the feasible window narrows and coarse grids miss it.`)] }
      }
      if (op.kind === "inspect") {
        const preview = { id: `p_${next.revision}`, task: op.task, facts: facts(op.task, t.rows), ...(op.task.kind === "terms" ? { rows: t.rows } : {}) };
        t.previews.push(preview); t.feedback = preview.facts;
      }
      if (op.kind === "publish") {
        const p = t.previews.find(p => p.id === op.sourceId)!;
        const c: Claim = { id: `c_${next.revision}`, author: teamId, round: next.round, task: p.task, status: "open", challenged: [], facts: p.facts };
        if (op.scope !== undefined) c.scope = op.scope;
        if (op.floor !== undefined) c.floor = op.floor;
        if (op.exponent !== undefined) c.exponent = op.exponent;
        if (p.rows !== undefined) c.rows = p.rows;
        next.claims.push(c); t.claimed = true;
        t.feedback = [line("主張を公開した。相手に材料が渡った。監査またはラウンド精算で判定される。まだ加点されない。", "Claim published. Your opponent can inspect its evidence. Audit or round settlement decides; no points yet.")];
      }
      if (op.kind === "audit") {
        const c = next.claims.find(c => c.id === op.claimId)!;
        c.challenged.push(teamId);
        const hit = auditWorks(next, c, op);
        if (hit) {
          c.status = "broken";
          const evidence = c.task.kind === "terms" ? [line(`種類1を ${op.ones} 枚にした配置の指数は ${op.cost}。主張の指数 ${c.exponent} 未満なので、『全配置で指数 ${c.exponent} 以上』という主張が崩れた。実際の項が非零・大きいという判定ではない。`, `With ${op.ones} type-1 cards, the exponent is ${op.cost}, below the claimed ${c.exponent}. This refutes the all-arrangements exponent guarantee. It does not establish that an actual term is nonzero or large.`)] : c.facts;
          const reason = c.task.kind === "record" ? line("有限の記録は、どこまでも続く根拠にならない。分数そのものが間違いという判定ではない。", "A finite record does not justify records continuing arbitrarily far. The fraction itself is not being declared wrong.") : line("相手が覆いきれなかった条件を、公開した材料から突いた。", "Published evidence exposes a condition the opponent did not cover.");
          award(next, teamId, 4, [line("反例・根拠不足の指摘が成立。+4", "Counterexample or insufficient-evidence audit succeeds. +4"), reason, ...evidence]);
          award(next, c.author, -3, [line("公開主張が監査で崩れた。−3", "Published claim failed the audit. −3"), reason, ...evidence]);
          t.feedback = [line("監査成立。+4", "Audit succeeds. +4"), reason, ...evidence];
        } else t.feedback = [line("この指摘では主張を崩せなかった。得点は変わらず、行動券1枚を使った。", "This audit does not refute the claim. No score change; one ticket used."), ...c.facts];
      }
    }
    if (t.tickets === 0) t.passed = true;
    const available = next.roster.filter(id => !next.teams[id]!.passed);
    if (available.length === 0) settle(next);
    else next.turn = available.find(id => id !== teamId) ?? teamId;
  }
  next.receipts.push({ id: op.requestId, team: teamId, payload: JSON.stringify(op) });
  next.revision += 1;
  return next;
}
export function projectForTeam(state: State, teamId: string): Projection {
  if (!Object.hasOwn(state.teams, teamId)) throw new Error("unknown_team");
  return structuredClone({ schema: 2, phase: state.phase, round: state.round, revision: state.revision, turn: state.turn,
    me: state.teams[teamId]!, opponents: state.roster.filter(id => id !== teamId).map(id => {
      const t = state.teams[id]!;
      return { id, name: t.name, score: t.score, ready: t.ready, passed: t.passed };
    }), claims: state.claims, ledger: state.ledger } satisfies Projection);
}
export const teamScores = (state: State) => Object.fromEntries(state.roster.map(id => [id, state.teams[id]!.score]));

/** Replay the retained accepted v1 operations through the bilingual reducer.
 * Compare all old Japanese/structural data before accepting the migration, so an
 * unsupported or corrupt checkpoint fails instead of silently changing a match.
 */
export function migrateState(value: unknown, fromVersion: number): State {
  if (fromVersion !== 1 || !object(value) || value.schema !== 1 || !object(value.teams) || !Array.isArray(value.roster) || !Array.isArray(value.receipts) || value.receipts.length > 50 || !Array.isArray(value.claims) || !Array.isArray(value.ledger)) throw new Error("Unsupported pi-siege state migration");
  const old = structuredClone(value) as unknown as Omit<State, "schema"> & { schema: number };
  const names = Object.fromEntries(Object.entries(old.teams).map(([id,team]) => [id,displayName(team.name)]));
  let restored = initialState({eventId:"migration",teamIds:old.roster,teamNames:names});
  for (const receipt of old.receipts) {
    const op = JSON.parse(receipt.payload) as Op;
    if (op.requestId !== receipt.id) throw new Error("Invalid legacy pi-siege receipt");
    restored = applyOp(restored,receipt.team,op);
  }
  const ja = (texts: Text[]) => texts.map(text => text.ja);
  const oldView = { ...restored, schema:1,
    teams:Object.fromEntries(Object.entries(restored.teams).map(([id,team]) => [id,{...team,feedback:ja(team.feedback),previews:team.previews.map(p=>({...p,facts:ja(p.facts)}))}])),
    claims:restored.claims.map(c=>({...c,facts:ja(c.facts)})), ledger:restored.ledger.map(e=>({...e,text:ja(e.text)})) };
  for (const team of Object.values(old.teams)) team.name = displayName(team.name);
  const normalize = (snapshot: unknown) => JSON.stringify(snapshot, (_key,value: unknown) => object(value) ? Object.fromEntries(Object.keys(value).sort().map(key=>[key,value[key]])) : value).replaceAll("これは係数の上限を1と置いた教育用模型。", "これは係数の大きさの上限を1と置いた教育用模型。");
  if (normalize(oldView) !== normalize(old)) throw new Error("Legacy pi-siege checkpoint differs from its retained operations");
  return restored;
}
export function scoreReasons(before: State, after: State): Readonly<Record<string, string>> {
  return Object.fromEntries(after.ledger.slice(before.ledger.length).map(e => [e.team, e.points === 6 ? "pi-claim-held" : e.points === 4 ? "pi-audit-held" : e.points === 2 ? "pi-comparison-bonus" : "pi-claim-broken"]));
}
