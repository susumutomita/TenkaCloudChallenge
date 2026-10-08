import { createContext, useContext, useEffect, useRef, useState } from "react";
import type { PortalCoordinationClient, PortalSlotProps } from "@tenkacloud/portal-plugin-sdk";
import type { Locale, Op, Projection as WireProjection, Task } from "../game/types.ts";
import { debrief, errors, rounds } from "./content.ts";
import { debriefEn, errorsEn, roundsEn } from "./content.en.ts";
import "./style.css";
const LocaleContext = createContext<Locale>("ja");
const useTranslate = () => { const locale = useContext(LocaleContext); return (ja: string, en: string) => locale === "ja" ? ja : en; };
const roundText = (locale: Locale) => locale === "ja" ? rounds : roundsEn;
import { localizeProjection } from "./localize.ts";
type Projection = ReturnType<typeof localizeProjection>;
type Claim = Projection["claims"][number];

function isProjection(v: unknown): v is WireProjection {
  if (typeof v !== "object" || v === null) return false;
  const p = v as WireProjection;
  return p.schema === 2 && ["waiting", "playing", "ended"].includes(p.phase) && Number.isInteger(p.round) && p.round >= 0 && p.round <= 3 && Number.isInteger(p.revision) && !!p.me && typeof p.me.id === "string" && Number.isFinite(p.me.score) && Number.isInteger(p.me.tickets) && Array.isArray(p.me.previews) && Array.isArray(p.me.feedback) && Array.isArray(p.opponents) && Array.isArray(p.claims) && Array.isArray(p.ledger);
}
type Move = Omit<Extract<Op, { kind: "ready" | "upgrade" | "pass" }>, "requestId" | "revision" | "round">
  | { kind: "inspect"; task: Task }
  | { kind: "publish"; sourceId: string; scope?: "finite" | "forever"; floor?: { n: number; d: number }; exponent?: number }
  | { kind: "audit"; claimId: string; reason: Extract<Op, { kind: "audit" }>["reason"]; ones?: number; cost?: number };
type Send = (move: Move) => Promise<void>;
const parseCell = (s: string) => {
  const [n, d = "1"] = s.trim().split("/");
  return { n: Number(n), d: Number(d) };
};
function Lines({ lines }: { lines: string[] }) {
  return <ul className="pi-lines">{lines.map((line, i) => <li key={i}>{line}</li>)}</ul>;
}
function Cards({ rows, ones }: { rows: number; ones: number }) {
  const tr = useTranslate();
  const split = Number.isInteger(ones) && ones >= 0 && ones <= rows ? ones : 0;
  return <div className="pi-cards" aria-label={tr("種類と次数の配置","Arrangement of types and degrees")}>{[rows - split, split].map((count, kind) => <div key={kind}><span>{tr("種類","Type ")}{kind}</span><div>{Array.from({ length: count }, (_, degree) => <span className={`pi-card pi-card-${kind}`} key={degree}>{tr("種類","Type ")}{kind}<br />{tr("次数","Degree ")}{degree}</span>)}</div></div>)}</div>;
}
function ClaimSummary({ c }: { c: Claim }) {
  const tr = useTranslate();
  if (c.task.kind === "record") return <><strong>{c.task.p}/{c.task.q}</strong> — {c.scope === "finite" ? tr("この一回の記録","This one record") : tr("この近さが、どこまでも続く","Such close records continue arbitrarily far")}</>;
  if (c.task.kind === "table") return <>{tr("小ささ1/8以下・整数由来の下限 ","Magnitude ≤1/8; integer-derived floor ")} <strong>{c.floor?.n}/{c.floor?.d}</strong></>;
  if (c.task.kind === "terms") return <><strong>{c.rows}</strong>{tr("枚の全配置で指数 "," rows, every arrangement has exponent ")}<strong>{c.exponent}{tr("以上"," or greater")}</strong></>;
  return <>{tr("両方を守る配分 ","Allocation protecting both sides ")}<strong>{c.task.n}/{c.task.d}</strong></>;
}
function Audit({ c, disabled, send }: { c: Claim; disabled: boolean; send: Send }) {
  const tr = useTranslate();
  const [reason, setReason] = useState<Extract<Op, { kind: "audit" }>["reason"]>(c.round === 0 ? "scope" : c.round === 1 ? "zero" : c.round === 2 ? "mixed" : "collision");
  const [ones, setOnes] = useState("1"), [cost, setCost] = useState("");
  return <form onSubmit={e => { e.preventDefault(); void send({ kind: "audit", claimId: c.id, reason, ...(c.round === 2 ? { ones: Number(ones), cost: Number(cost) } : {}) }); }}>
    {c.round !== 2 && <label>{tr("どこに逃げ道がある？","Where is the escape?")}<select aria-label={tr("監査の理由","Audit reason")} value={reason} onChange={e => setReason(e.target.value as typeof reason)}>
      {c.round === 0 && <option value="scope">{tr("一回の記録では、どこまでも続く根拠にならない","One record does not justify continuing arbitrarily far")}</option>}
      {c.round === 1 && <><option value="zero">{tr("差がゼロで、下限が使えない","Zero difference invalidates the floor")}</option><option value="floor">{tr("整数化の倍率に対して下限が強すぎる","Floor is stronger than integer clearing permits")}</option><option value="large">{tr("差の大きさが目標1/8を超えている","Magnitude of the difference exceeds the 1/8 goal")}</option></>}
      {c.round === 3 && <><option value="collision">{tr("重複側の条件が0以下","Repetition condition is nonpositive")}</option><option value="error">{tr("誤差側の条件が0以下","Error condition is nonpositive")}</option></>}
    </select></label>}
    {c.round === 2 && <><p>{tr("反例の配置を作ろう。種類ごとに次数を0,1,2…と付け、合計を自分で計算する。","Build a counterexample arrangement. Assign degrees 0,1,2… within each type and calculate the sum yourself.")}</p><div className="pi-fields"><label>{tr("種類1の枚数","Number of type-1 cards")}<input aria-label={tr("反例の種類1の枚数","Counterexample type-1 count")} type="number" min="0" max={c.rows} value={ones} onChange={e => setOnes(e.target.value)} required /></label><label>{tr("種類＋次数の合計","Type sum + degree sum")}<input aria-label={tr("反例の指数","Counterexample exponent")} type="number" min="0" max="30" value={cost} onChange={e => setCost(e.target.value)} required /></label></div><Cards rows={c.rows!} ones={Number(ones)} /></>}
    <button disabled={disabled} type="submit">{tr("反例・根拠不足を指摘する（券1枚）","Audit counterexample or insufficient evidence (one ticket)")}</button>
  </form>;
}

function RoundControls({ p, disabled, send }: { p: Projection; disabled: boolean; send: Send }) {
  const tr = useTranslate(), locale = useContext(LocaleContext);
  const rt = roundText(locale);
  const [pn, setPn] = useState("3"), [qd, setQd] = useState("1");
  const [cells, setCells] = useState(["1", "1/2", "1", "3/4"]);
  const [ones, setOnes] = useState("0"), [bn, setBn] = useState("6");
  const [scope, setScope] = useState<"finite" | "forever">("finite");
  const [bound, setBound] = useState(""), [exponent, setExponent] = useState("");
  const [sourceId, setSourceId] = useState("");
  const latest = p.me.previews.at(-1);
  const source = p.me.previews.find(v => v.id === sourceId) ?? latest;
  const trial = (): Task => {
    if (p.round === 0) return { kind: "record", p: Number(pn), q: Number(qd) };
    if (p.round === 1) return { kind: "table", cells: cells.map(parseCell) as [ReturnType<typeof parseCell>, ReturnType<typeof parseCell>, ReturnType<typeof parseCell>, ReturnType<typeof parseCell>] };
    if (p.round === 2) return { kind: "terms", ones: Number(ones) };
    return { kind: "allocation", n: Number(bn), d: p.me.grid };
  };
  const upgrading = p.round !== 1 && (p.round === 0 ? p.me.range < 1000 : p.round === 2 ? p.me.rows < 6 : p.me.grid < 100);
  const publish = () => {
    if (!source) return;
    const move: Move = { kind: "publish", sourceId: source.id };
    if (p.round === 0) move.scope = scope;
    if (p.round === 1) move.floor = parseCell(bound);
    if (p.round === 2) move.exponent = Number(exponent);
    void send(move);
  };
  return <>
    <section className="pi-workshop" aria-label={tr("自分の作業台","Your workbench")}>
      <div className="pi-section-title"><h2>{tr("自分の作業台","Your workbench")}</h2><span>{tr("試す・公開・監査は各1枚","Experiment, publish or audit: one ticket each")}</span></div>
      {upgrading && <button className="pi-secondary" disabled={disabled} onClick={() => void send({ kind: "upgrade" })}>
        {p.round === 0 ? tr(`分母を${p.me.range === 7 ? 120 : 1000}まで広げる`,`Expand denominators to ${p.me.range === 7 ? 120 : 1000}`) : p.round === 2 ? tr(`行を${p.me.rows + 1}枚へ増やす`,`Increase to ${p.me.rows + 1} rows`) : tr(`目盛りを1/${p.me.grid === 10 ? 50 : 100}へ細かくする`,`Refine grid to 1/${p.me.grid === 10 ? 50 : 100}`)}{tr("（券1枚）"," (one ticket)")}
      </button>}
      <form onSubmit={e => { e.preventDefault(); void send({ kind: "inspect", task: trial() }); }}>
        {p.round === 0 && <div className="pi-fields"><label>{tr("分子 p","Numerator p")}<input aria-label={tr("分子 p","Numerator p")} type="number" min="0" max="4000" value={pn} onChange={e => setPn(e.target.value)} required /></label><span className="pi-slash">÷</span><label>{tr(`分母 q（1〜${p.me.range}）`,`Denominator q (1…${p.me.range})`)}<input aria-label={tr("分母 q","Denominator q")} type="number" min="1" max={p.me.range} value={qd} onChange={e => setQd(e.target.value)} required /></label></div>}
        {p.round === 1 && <><div className="pi-table">{cells.map((value, i) => <label key={i}>{(locale === "ja" ? ["左上", "右上", "左下", "右下"] : ["Top left", "Top right", "Bottom left", "Bottom right"])[i]}<input aria-label={tr(`セル ${i + 1}`,`Cell ${i + 1}`)} value={value} onChange={e => setCells(cells.map((v, j) => i === j ? e.target.value : v))} required pattern="-?[0-9]+(/[0-9]+)?" /></label>)}</div><p>{tr("整数または「1/2」のような分数。分子−9〜9、分母1〜16。差は左上×右下−右上×左下。","Use integers or fractions such as 1/2. Numerators −9…9, denominators 1…16. Difference = top-left×bottom-right−top-right×bottom-left.")}</p></>}
        {p.round === 2 && <><label>{tr(`${p.me.rows}枚のうち種類1にする枚数`,`Type-1 count among ${p.me.rows} cards`)}<input aria-label={tr("試す種類1の枚数","Trial type-1 count")} type="number" min="0" max={p.me.rows} value={ones} onChange={e => setOnes(e.target.value)} required /></label><p>{tr("残りは種類0。次数はそれぞれの種類で0から順につける。混ぜ方を変えると、残る候補の上限が変わる。","The rest are type 0. Assign degrees from 0 within each type. A different mix changes the candidate bound.")}</p><Cards rows={p.me.rows} ones={Number(ones)} /></>}
        {p.round === 3 && <div className="pi-fields"><label>{tr("配分bの分子","Allocation numerator")}<input aria-label={tr("配分の分子","Allocation numerator")} type="number" min="1" max={p.me.grid - 1} value={bn} onChange={e => setBn(e.target.value)} required /></label><span className="pi-slash">/ {p.me.grid}</span><p>{tr("0<b<1。目盛りを細かくしたら分子も選び直す。","0<b<1. Choose the numerator again after refining the grid.")}</p></div>}
        <button disabled={disabled} type="submit">{rt[p.round].action}{tr("（券1枚）"," (one ticket)")}</button>
      </form>
    </section>
    {source && <section className="pi-result"><h2>{tr("自分だけの試行記録","Your private experiments")}</h2>
      <label>{tr("公開に使う試行","Experiment to publish")}<select aria-label={tr("公開に使う試行","Experiment to publish")} value={source.id} onChange={e => setSourceId(e.target.value)}>{p.me.previews.map((v, i) => <option key={v.id} value={v.id}>{tr(`試行${i + 1}: `,`Trial ${i + 1}: `)}{v.facts[0]}</option>)}</select></label>
      <Lines lines={source.facts} />
      {!p.me.claimed && <form onSubmit={e => { e.preventDefault(); publish(); }}>
        {p.round === 0 && <label>{tr("どこまで主張する？","Scope of your claim")}<select aria-label={tr("主張の範囲","Claim scope")} value={scope} onChange={e => setScope(e.target.value as typeof scope)}><option value="finite">{tr("この一回の記録","This one record")}</option><option value="forever">{tr("この近さが、どこまでも続く","Such close records continue arbitrarily far")}</option></select></label>}
        {p.round === 1 && <label>{tr("公開する整数由来の下限","Integer-derived floor to publish")}<input aria-label={tr("公開する下限","Published floor")} placeholder={tr("正の分数で入力","Enter a positive fraction")} value={bound} onChange={e => setBound(e.target.value)} required pattern="[0-9]+(/[0-9]+)?" /></label>}
        {p.round === 2 && <label>{tr("どの配置でも指数k以上と主張する k","Claim every arrangement has exponent at least k")}<input aria-label={tr("公開する指数","Published exponent")} type="number" min="0" max="30" value={exponent} onChange={e => setExponent(e.target.value)} required /></label>}
        <button disabled={disabled} type="submit">{tr("主張を公開する（券1枚）","Publish claim (one ticket)")}</button><p>{tr("公開はこのラウンド1回。材料を相手に渡し、監査か精算で採点する。","One publication this round. Your opponent receives the evidence; audit or settlement grades it.")}</p>
      </form>}
    </section>}
  </>;
}

export default function StatusPanel(props: PortalSlotProps) {
  const client = props.coordinationClient;
  if (!client) return <p className="pi-root" role="alert">{props.locale === "ja" ? "対戦の接続がありません。問題の接続を確認してください。" : "No coordination connection. Check this problem’s connection."}</p>;
  return <LocaleContext.Provider value={props.locale}><Connected key={`${props.jobId}:${props.team.teamId}`} client={client} /></LocaleContext.Provider>;
}
function Connected({ client }: { client: PortalCoordinationClient }) {
  const locale = useContext(LocaleContext), tr = useTranslate();
  const rt = roundText(locale), narrative = locale === "ja" ? debrief : debriefEn, failure = locale === "ja" ? errors : errorsEn;
  const [wire, setP] = useState<WireProjection>(), [error, setError] = useState("");
  const [busy, setBusy] = useState(false), [retry, setRetry] = useState(false);
  const pending = useRef<Op | undefined>(undefined);
  const p = wire ? localizeProjection(wire, locale) : undefined;
  const accept = (v: unknown) => {
    if (!isProjection(v)) { setError(tr("盤の形式を確認できません。接続を確認してください。","Cannot recognize this board. Check the connection.")); return; }
    setP(old => old && old.revision > v.revision ? old : v);
  };
  useEffect(() => {
    let live = true;
    const read = async () => {
      try { const r = await client.getProjection(); if (live) { if (r.kind === "ok") accept(r.projection); else setError(tr(`盤を取得できません: ${r.kind}`,`Cannot load the board: ${r.kind}`)); } }
      catch { if (live) setError(tr("接続できません。ページを開いたまま再接続を待てます。","Cannot connect. Leave the page open to wait for reconnection.")); }
    };
    void read(); const timer = setInterval(() => void read(), 1000);
    return () => { live = false; clearInterval(timer); };
  }, [client, locale]);
  const deliver = async () => {
    const op = pending.current;
    if (!op) return;
    setBusy(true); setError("");
    try {
      const result = await client.submitOp(op);
      pending.current = undefined; setRetry(false);
      if (result.kind === "ok") accept(result.projection);
      else { setError(result.kind === "rejected" ? failure[result.error] ?? tr(`操作を受理できません: ${result.error}`,`Operation rejected: ${result.error}`) : tr(`操作を受理できません: ${result.kind}`,`Operation unavailable: ${result.kind}`)); const r = await client.getProjection(); if (r.kind === "ok") accept(r.projection); }
    } catch { setRetry(true); setError(tr("通信結果を確認できません。同じ操作を再送しても、券と得点は二重に動きません。","The response was lost. Resending the same operation does not spend tickets or award points twice.")); }
    finally { setBusy(false); }
  };
  const send: Send = async move => {
    if (!p || pending.current || busy) return;
    pending.current = { ...move, requestId: crypto.randomUUID(), round: p.round, revision: p.revision } as Op;
    await deliver();
  };
  if (!p) return <p className="pi-root" role="status">{error || tr("盤を読み込んでいます…","Loading the board…")}</p>;
  const disabled = busy || retry || p.phase !== "playing" || p.turn !== p.me.id || p.me.passed;
  const opponent = p.opponents[0];
  return <main className="pi-root">
    <header className="pi-heading"><div><p className="pi-kicker">{tr("近づく記録と、逃げ道を塞ぐ競技","Close records and close every escape")}</p><h1>{tr("π包囲戦","Pi Siege")}</h1></div><div className="pi-circle" aria-hidden="true">π</div></header>
    <div className="pi-scoreboard"><div><span>{p.me.name}</span><strong>{p.me.score}<small>{tr("点","points")}</small></strong></div><div><span>{opponent?.name}</span><strong>{opponent?.score}<small>{tr("点","points")}</small></strong></div><div><span>{tr("自分の行動券","Your action tickets")}</span><strong>{p.me.tickets}<small>{tr("枚","tickets")}</small></strong></div></div>
    {error && <div role="alert" className="pi-error">{error}{retry && <button disabled={busy} onClick={() => void deliver()}>{tr("同じ操作を再送","Resend the same operation")}</button>}</div>}
    {p.phase === "waiting" && <section className="pi-intro"><h2>{tr("直径1の円を、分数で測る係になろう","Measure a diameter-1 circle using fractions")}</h2><p>{tr("相手と記録を競い、公開された主張の逃げ道を突きます。後半は論文の「なぜ昔は難しかったか」「どう限界を示そうとしたか」を小さい数で体験します。","Compete over records and expose gaps in published claims. Later, use small numbers to experience historical obstacles and the manuscript's proposed approach.")}</p><p>{tr("監査するのはこの有限ゲームでプレイヤーが公開した主張です。研究原稿の誤りを見つける競技ではありません。突破案の体験は、ゼロ・混合配置・片側の条件に逃げ道を残さず道具を作ることです。","Audits target players' claims in this finite game, not errors in the manuscript. Experience the proposed strategy by building tools that cover zero, mixed arrangements and both conditions.")}</p><p>{tr("まず分数3/1を試すと、πからの誤差が返ります。4ラウンド、各6枚の券。試す・強化・公開・監査へどう配るかは自分で選びます。","First try fraction 3/1 to see its distance from π. Four rounds, six tickets each. Choose how many to spend on experiments, upgrades, publication and audits.")}</p><p>{tr("公開された主張が成立すると+6、反例を示すと+4、誤った主張は−3。両者の有効な主張を比べ、強い方に+2。起動や待機では得点しません。","A held claim earns +6, a counterexample +4, a failed claim −3. If both claims hold, the stronger earns +2. Startup and waiting earn no points.")}</p><button disabled={busy || p.me.ready} onClick={() => void send({ kind: "ready" })}>{p.me.ready ? tr("相手の準備を待っています","Waiting for opponent to be ready") : tr("準備完了","Ready")}</button><p>{p.me.ready ? "1" : "0"} / 1 {tr("自分の準備 · 相手は","your readiness · opponent: ")}{opponent?.ready ? tr("準備完了","Ready") : tr("準備中","Not ready")}</p></section>}
    {p.phase === "playing" && <>
      <nav className="pi-rounds" aria-label={tr("試合の進行","Match progress")}>{rt.map((r, i) => <span aria-current={p.round === i ? "step" : undefined} key={r.title}>{i + 1}. {r.title}</span>)}</nav>
      <section className="pi-intro"><p className="pi-kicker">ROUND {p.round + 1} · {rt[p.round].badge}</p><h2>{rt[p.round].title}</h2><p>{rt[p.round].story}</p><p className="pi-goal">{rt[p.round].goal}</p><details><summary>{tr("無料の式と小さい例","Free rules and a small example")}</summary><p>{rt[p.round].rule}</p><p>{rt[p.round].link}</p></details>
      <details><summary>{tr("段階ヒント（無料・券不要）","Step-by-step hints (free)")}</summary>{rt[p.round].hints.map((h, i) => <details key={h}><summary>{(locale === "ja" ? ["1. 仕組み", "2. 式と小さい例", "3. 自分の数字での手順"] : ["1. Mechanism", "2. Formula and example", "3. Steps for your numbers"])[i]}</summary><p>{h}</p></details>)}</details></section>
      <p className="pi-turn" role="status">{p.me.passed ? tr("自分は終了。相手の終了を待っています。","You finished. Waiting for your opponent.") : p.turn === p.me.id ? tr("あなたの手番です。券をどこへ使いますか？","Your turn. Where will you spend your tickets?") : tr("相手の手番です。公開記録から次の手を考えよう。","Opponent's turn. Plan your next move from published evidence.")}</p>
      <section className="pi-feedback" aria-label={tr("操作の結果","Move feedback")} aria-live="polite"><h2>{tr("今回の手で何が分かった？","What did this move teach you?")}</h2>{p.me.feedback.length ? <Lines lines={p.me.feedback} /> : <p>{tr("試すと、自分の数字に対する計算と理由がここに出ます。","An experiment returns calculations and reasons for your own numbers here.")}</p>}</section>
      <RoundControls key={p.round} p={p} disabled={disabled} send={send} />
      <section className="pi-ledger"><h2>{tr("公開された主張","Published claims")}</h2><p>{tr("自分の試行は公開するまで相手に見えません。反例は相手の公開材料だけから作ります。","Experiments stay private until publication. Build counterexamples from published evidence only.")}</p>
        {p.claims.filter(c => c.round === p.round).map(c => <article key={c.id}><div className="pi-section-title"><h3>{c.author === p.me.id ? tr("自分","You") : opponent?.name}{tr("の主張","’s claim")}</h3><span>{c.status === "open" ? tr("監査受付中","Open for audit") : c.status === "held" ? tr("成立","Held") : tr("崩れた","Broken")}</span></div><p><ClaimSummary c={c} /></p><Lines lines={c.facts} />{c.author !== p.me.id && c.status === "open" && !c.challenged.includes(p.me.id) && <Audit c={c} disabled={disabled} send={send} />}</article>)}
        {!p.claims.some(c => c.round === p.round) && <p>{tr("まだ主張は公開されていません。","No claims published yet.")}</p>}
      </section>
      <button className="pi-secondary pi-pass" disabled={disabled} onClick={() => void send({ kind: "pass" })}>{tr("このラウンドの行動を終える（残りの券は持ち越さない）","Finish this round (unused tickets do not carry over)")}</button>
    </>}
    {p.phase === "ended" && <section className="pi-debrief"><p className="pi-kicker">{tr("試合終了 · 有限の競技から論文へ","Match over · From a finite game to the manuscript")}</p><h2>{p.me.score === opponent?.score ? tr("引き分け","Draw") : p.me.score > (opponent?.score ?? 0) ? tr(`${p.me.name}の勝ち`,`${p.me.name} wins`) : tr(`${opponent?.name}の勝ち`,`${opponent?.name} wins`)}</h2><p>{tr("得点はこの小さい模型での記録・保証・監査の結果です。πの定理を証明した得点ではありません。監査が成功しても、研究原稿の定理を反証したことにはなりません。","Scores reflect records, guarantees and audits in this small model. They do not prove π's theorem. A successful audit does not refute the research theorem.")}</p>{narrative.map((text, i) => <article key={text}><h3>{(locale === "ja" ? ["記録と無限の問い", "歴史的な難所", "原稿の突破案", "二つの道を同時に塞ぐ", "なぜ2が境界に現れるか", "検証範囲"] : ["Records and the infinite question", "Historical obstacle", "Proposed strategy", "Cover both branches", "Why the boundary 2 appears", "Verification scope"])[i]}</h3><p>{text}</p></article>)}
      <h3>{tr("自分たちの判断を振り返る","Review your choices")}</h3>{p.claims.map(c => <article key={c.id}><p>{tr(`第${c.round + 1}ラウンド`,`Round ${c.round + 1}`)} · {c.author === p.me.id ? tr("自分","You") : opponent?.name} · {c.status === "held" ? tr("成立","Held") : tr("崩れた","Broken")}</p><ClaimSummary c={c} /><Lines lines={c.facts} /></article>)}
    </section>}
    {!!p.ledger.length && <details className="pi-score-log"><summary>{tr("得点と判定の記録","Score and verdict history")}</summary>{p.ledger.map((e, i) => <article key={i}><strong>R{e.round + 1} · {e.team === p.me.id ? tr("自分","You") : opponent?.name} · {e.points > 0 ? "+" : ""}{e.points}{tr("点"," points")}</strong><Lines lines={e.text} /></article>)}</details>}
    <footer><p>{tr("これは公開原稿の戦略を学ぶ有限模型。論文の証明全体や実用の暗号を再現するものではありません。","A finite model for learning the manuscript's strategy. It does not reproduce the full proof or practical cryptography.")}</p><a href="https://github.com/openai/math/blob/adc7f1241b42e322a6451854ab7e4b4c146bf78a/preprints/The-irrationality-exponent-of-pi-is-2-September-24-2026/paper.pdf" target="_blank" rel="noreferrer">{tr("元の論文","Source manuscript")}</a> · <a href="https://arxiv.org/html/1912.06345v2" target="_blank" rel="noreferrer">{tr("先行研究","Earlier research")}</a></footer>
  </main>;
}
