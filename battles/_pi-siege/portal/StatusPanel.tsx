import { useEffect, useRef, useState } from "react";
import type { PortalCoordinationClient, PortalSlotProps } from "@tenkacloud/portal-plugin-sdk";
import type { Claim, Op, Projection, Task } from "../game/types.ts";
import { debrief, errors, rounds } from "./content.ts";
import "./style.css";

function isProjection(v: unknown): v is Projection {
  if (typeof v !== "object" || v === null) return false;
  const p = v as Projection;
  return p.schema === 1 && ["waiting", "playing", "ended"].includes(p.phase) && Number.isInteger(p.round) && p.round >= 0 && p.round <= 3 && Number.isInteger(p.revision) && !!p.me && typeof p.me.id === "string" && Number.isFinite(p.me.score) && Number.isInteger(p.me.tickets) && Array.isArray(p.me.previews) && Array.isArray(p.me.feedback) && Array.isArray(p.opponents) && Array.isArray(p.claims) && Array.isArray(p.ledger);
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
  const split = Number.isInteger(ones) && ones >= 0 && ones <= rows ? ones : 0;
  return <div className="pi-cards" aria-label="種類と次数の配置">{[rows - split, split].map((count, kind) => <div key={kind}><span>種類{kind}</span><div>{Array.from({ length: count }, (_, degree) => <span className={`pi-card pi-card-${kind}`} key={degree}>種類{kind}<br />次数{degree}</span>)}</div></div>)}</div>;
}
function ClaimSummary({ c }: { c: Claim }) {
  if (c.task.kind === "record") return <><strong>{c.task.p}/{c.task.q}</strong> — {c.scope === "finite" ? "この一回の記録" : "この近さが、どこまでも続く"}</>;
  if (c.task.kind === "table") return <>小ささ1/8以下・整数由来の下限 <strong>{c.floor?.n}/{c.floor?.d}</strong></>;
  if (c.task.kind === "terms") return <><strong>{c.rows}枚</strong>の全配置で指数 <strong>{c.exponent}以上</strong></>;
  return <>両方を守る配分 <strong>{c.task.n}/{c.task.d}</strong></>;
}
function Audit({ c, disabled, send }: { c: Claim; disabled: boolean; send: Send }) {
  const [reason, setReason] = useState<Extract<Op, { kind: "audit" }>["reason"]>(c.round === 0 ? "scope" : c.round === 1 ? "zero" : c.round === 2 ? "mixed" : "collision");
  const [ones, setOnes] = useState("1"), [cost, setCost] = useState("");
  return <form onSubmit={e => { e.preventDefault(); void send({ kind: "audit", claimId: c.id, reason, ...(c.round === 2 ? { ones: Number(ones), cost: Number(cost) } : {}) }); }}>
    {c.round !== 2 && <label>どこに逃げ道がある？<select aria-label="監査の理由" value={reason} onChange={e => setReason(e.target.value as typeof reason)}>
      {c.round === 0 && <option value="scope">一回の記録では、どこまでも続く根拠にならない</option>}
      {c.round === 1 && <><option value="zero">差がゼロで、下限が使えない</option><option value="floor">整数化の倍率に対して下限が強すぎる</option><option value="large">差が目標1/8を超えている</option></>}
      {c.round === 3 && <><option value="collision">重複側の条件が0以下</option><option value="error">誤差側の条件が0以下</option></>}
    </select></label>}
    {c.round === 2 && <><p>反例の配置を作ろう。種類ごとに次数を0,1,2…と付け、合計を自分で計算する。</p><div className="pi-fields"><label>種類1の枚数<input aria-label="反例の種類1の枚数" type="number" min="0" max={c.rows} value={ones} onChange={e => setOnes(e.target.value)} required /></label><label>種類＋次数の合計<input aria-label="反例の指数" type="number" min="0" max="30" value={cost} onChange={e => setCost(e.target.value)} required /></label></div><Cards rows={c.rows!} ones={Number(ones)} /></>}
    <button disabled={disabled} type="submit">反例・根拠不足を指摘する（券1枚）</button>
  </form>;
}

function RoundControls({ p, disabled, send }: { p: Projection; disabled: boolean; send: Send }) {
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
    <section className="pi-workshop" aria-label="自分の作業台">
      <div className="pi-section-title"><h2>自分の作業台</h2><span>試す・公開・監査は各1枚</span></div>
      {upgrading && <button className="pi-secondary" disabled={disabled} onClick={() => void send({ kind: "upgrade" })}>
        {p.round === 0 ? `分母を${p.me.range === 7 ? 120 : 1000}まで広げる` : p.round === 2 ? `行を${p.me.rows + 1}枚へ増やす` : `目盛りを1/${p.me.grid === 10 ? 50 : 100}へ細かくする`}（券1枚）
      </button>}
      <form onSubmit={e => { e.preventDefault(); void send({ kind: "inspect", task: trial() }); }}>
        {p.round === 0 && <div className="pi-fields"><label>分子 p<input aria-label="分子 p" type="number" min="0" max="4000" value={pn} onChange={e => setPn(e.target.value)} required /></label><span className="pi-slash">÷</span><label>分母 q（1〜{p.me.range}）<input aria-label="分母 q" type="number" min="1" max={p.me.range} value={qd} onChange={e => setQd(e.target.value)} required /></label></div>}
        {p.round === 1 && <><div className="pi-table">{cells.map((value, i) => <label key={i}>{["左上", "右上", "左下", "右下"][i]}<input aria-label={`セル ${i + 1}`} value={value} onChange={e => setCells(cells.map((v, j) => i === j ? e.target.value : v))} required pattern="-?[0-9]+(/[0-9]+)?" /></label>)}</div><p>整数または「1/2」のような分数。分子−9〜9、分母1〜16。差は左上×右下−右上×左下。</p></>}
        {p.round === 2 && <><label>{p.me.rows}枚のうち種類1にする枚数<input aria-label="試す種類1の枚数" type="number" min="0" max={p.me.rows} value={ones} onChange={e => setOnes(e.target.value)} required /></label><p>残りは種類0。次数はそれぞれの種類で0から順につける。混ぜ方を変えると、残る候補の上限が変わる。</p><Cards rows={p.me.rows} ones={Number(ones)} /></>}
        {p.round === 3 && <div className="pi-fields"><label>配分bの分子<input aria-label="配分の分子" type="number" min="1" max={p.me.grid - 1} value={bn} onChange={e => setBn(e.target.value)} required /></label><span className="pi-slash">/ {p.me.grid}</span><p>0&lt;b&lt;1。目盛りを細かくしたら分子も選び直す。</p></div>}
        <button disabled={disabled} type="submit">{rounds[p.round].action}（券1枚）</button>
      </form>
    </section>
    {source && <section className="pi-result"><h2>自分だけの試行記録</h2>
      <label>公開に使う試行<select aria-label="公開に使う試行" value={source.id} onChange={e => setSourceId(e.target.value)}>{p.me.previews.map((v, i) => <option key={v.id} value={v.id}>試行{i + 1}: {v.facts[0]}</option>)}</select></label>
      <Lines lines={source.facts} />
      {!p.me.claimed && <form onSubmit={e => { e.preventDefault(); publish(); }}>
        {p.round === 0 && <label>どこまで主張する？<select aria-label="主張の範囲" value={scope} onChange={e => setScope(e.target.value as typeof scope)}><option value="finite">この一回の記録</option><option value="forever">この近さが、どこまでも続く</option></select></label>}
        {p.round === 1 && <label>公開する整数由来の下限<input aria-label="公開する下限" placeholder="正の分数で入力" value={bound} onChange={e => setBound(e.target.value)} required pattern="[0-9]+(/[0-9]+)?" /></label>}
        {p.round === 2 && <label>どの配置でも指数k以上と主張する k<input aria-label="公開する指数" type="number" min="0" max="30" value={exponent} onChange={e => setExponent(e.target.value)} required /></label>}
        <button disabled={disabled} type="submit">主張を公開する（券1枚）</button><p>公開はこのラウンド1回。材料を相手に渡し、監査か精算で採点する。</p>
      </form>}
    </section>}
  </>;
}

export default function StatusPanel(props: PortalSlotProps) {
  const client = props.coordinationClient;
  if (!client) return <p className="pi-root" role="alert">対戦の接続がありません。この試作は問題付属のローカル入口から起動してください。</p>;
  return <Connected key={`${props.jobId}:${props.team.teamId}`} client={client} />;
}
function Connected({ client }: { client: PortalCoordinationClient }) {
  const [p, setP] = useState<Projection>(), [error, setError] = useState("");
  const [busy, setBusy] = useState(false), [retry, setRetry] = useState(false);
  const pending = useRef<Op | undefined>(undefined);
  const accept = (v: unknown) => {
    if (!isProjection(v)) { setError("盤の形式を確認できません。接続を確認してください。"); return; }
    setP(old => old && old.revision > v.revision ? old : v);
  };
  useEffect(() => {
    let live = true;
    const read = async () => {
      try { const r = await client.getProjection(); if (live) { if (r.kind === "ok") accept(r.projection); else setError(`盤を取得できません: ${r.kind}`); } }
      catch { if (live) setError("接続できません。ページを開いたまま再接続を待てます。"); }
    };
    void read(); const timer = setInterval(() => void read(), 1000);
    return () => { live = false; clearInterval(timer); };
  }, [client]);
  const deliver = async () => {
    const op = pending.current;
    if (!op) return;
    setBusy(true); setError("");
    try {
      const result = await client.submitOp(op);
      pending.current = undefined; setRetry(false);
      if (result.kind === "ok") accept(result.projection);
      else { setError(result.kind === "rejected" ? errors[result.error] ?? `操作を受理できません: ${result.error}` : `操作を受理できません: ${result.kind}`); const r = await client.getProjection(); if (r.kind === "ok") accept(r.projection); }
    } catch { setRetry(true); setError("通信結果を確認できません。同じ操作を再送しても、券と得点は二重に動きません。"); }
    finally { setBusy(false); }
  };
  const send: Send = async move => {
    if (!p || pending.current || busy) return;
    pending.current = { ...move, requestId: crypto.randomUUID(), round: p.round, revision: p.revision } as Op;
    await deliver();
  };
  if (!p) return <p className="pi-root" role="status">{error || "盤を読み込んでいます…"}</p>;
  const disabled = busy || retry || p.phase !== "playing" || p.turn !== p.me.id || p.me.passed;
  const opponent = p.opponents[0];
  return <main className="pi-root">
    <header className="pi-heading"><div><p className="pi-kicker">近づく記録と、逃げ道を塞ぐ競技</p><h1>π包囲戦</h1></div><div className="pi-circle" aria-hidden="true">π</div></header>
    <div className="pi-scoreboard"><div><span>{p.me.name}</span><strong>{p.me.score}<small>点</small></strong></div><div><span>{opponent?.name}</span><strong>{opponent?.score}<small>点</small></strong></div><div><span>自分の行動券</span><strong>{p.me.tickets}<small>枚</small></strong></div></div>
    {error && <div role="alert" className="pi-error">{error}{retry && <button disabled={busy} onClick={() => void deliver()}>同じ操作を再送</button>}</div>}
    {p.phase === "waiting" && <section className="pi-intro"><h2>直径1の円を、分数で測る係になろう</h2><p>相手と記録を競い、公開された主張の逃げ道を突きます。後半は論文の「なぜ昔は難しかったか」「どう限界を示そうとしたか」を小さい数で体験します。</p><p>監査するのはプレイヤーの有限の主張です。研究原稿の誤りを見つける競技ではありません。突破案の体験は、ゼロ・混合配置・片側の条件に逃げ道を残さず道具を作ることです。</p><p>まず分数3/1を試すと、πからの誤差が返ります。4ラウンド、各6枚の券。試す・強化・公開・監査へどう配るかは自分で選びます。</p><p>公開された主張が成立すると+6、反例を示すと+4、誤った主張は−3。両者の有効な主張を比べ、強い方に+2。起動や待機では得点しません。</p><button disabled={busy || p.me.ready} onClick={() => void send({ kind: "ready" })}>{p.me.ready ? "相手の準備を待っています" : "準備完了"}</button><p>{p.me.ready ? "1" : "0"} / 1 自分の準備 · 相手は{opponent?.ready ? "準備完了" : "準備中"}</p></section>}
    {p.phase === "playing" && <>
      <nav className="pi-rounds" aria-label="試合の進行">{rounds.map((r, i) => <span aria-current={p.round === i ? "step" : undefined} key={r.title}>{i + 1}. {r.title}</span>)}</nav>
      <section className="pi-intro"><p className="pi-kicker">ROUND {p.round + 1} · {rounds[p.round].badge}</p><h2>{rounds[p.round].title}</h2><p>{rounds[p.round].story}</p><p className="pi-goal">{rounds[p.round].goal}</p><details><summary>無料の式と小さい例</summary><p>{rounds[p.round].rule}</p><p>{rounds[p.round].link}</p></details>
      <details><summary>段階ヒント（無料・券不要）</summary>{rounds[p.round].hints.map((h, i) => <details key={h}><summary>{["1. 仕組み", "2. 式と小さい例", "3. 自分の数字での手順"][i]}</summary><p>{h}</p></details>)}</details></section>
      <p className="pi-turn" role="status">{p.me.passed ? "自分は終了。相手の終了を待っています。" : p.turn === p.me.id ? "あなたの手番です。券をどこへ使いますか？" : "相手の手番です。公開記録から次の手を考えよう。"}</p>
      <section className="pi-feedback" aria-label="操作の結果" aria-live="polite"><h2>今回の手で何が分かった？</h2>{p.me.feedback.length ? <Lines lines={p.me.feedback} /> : <p>試すと、自分の数字に対する計算と理由がここに出ます。</p>}</section>
      <RoundControls key={p.round} p={p} disabled={disabled} send={send} />
      <section className="pi-ledger"><h2>公開された主張</h2><p>自分の試行は公開するまで相手に見えません。反例は相手の公開材料だけから作ります。</p>
        {p.claims.filter(c => c.round === p.round).map(c => <article key={c.id}><div className="pi-section-title"><h3>{c.author === p.me.id ? "自分" : opponent?.name}の主張</h3><span>{c.status === "open" ? "監査受付中" : c.status === "held" ? "成立" : "崩れた"}</span></div><p><ClaimSummary c={c} /></p><Lines lines={c.facts} />{c.author !== p.me.id && c.status === "open" && !c.challenged.includes(p.me.id) && <Audit c={c} disabled={disabled} send={send} />}</article>)}
        {!p.claims.some(c => c.round === p.round) && <p>まだ主張は公開されていません。</p>}
      </section>
      <button className="pi-secondary pi-pass" disabled={disabled} onClick={() => void send({ kind: "pass" })}>このラウンドの行動を終える（残りの券は持ち越さない）</button>
    </>}
    {p.phase === "ended" && <section className="pi-debrief"><p className="pi-kicker">試合終了 · 有限の競技から論文へ</p><h2>{p.me.score === opponent?.score ? "引き分け" : p.me.score > (opponent?.score ?? 0) ? `${p.me.name}の勝ち` : `${opponent?.name}の勝ち`}</h2><p>得点はこの小さい模型での記録・保証・監査の結果です。πの定理を証明した得点ではありません。監査が成功しても、研究原稿の定理を反証したことにはなりません。</p>{debrief.map((text, i) => <article key={text}><h3>{["記録と無限の問い", "歴史的な難所", "原稿の突破案", "二つの道を同時に塞ぐ", "なぜ2が境界に現れるか", "検証範囲"][i]}</h3><p>{text}</p></article>)}
      <h3>自分たちの判断を振り返る</h3>{p.claims.map(c => <article key={c.id}><p>第{c.round + 1}ラウンド · {c.author === p.me.id ? "自分" : opponent?.name} · {c.status === "held" ? "成立" : "崩れた"}</p><ClaimSummary c={c} /><Lines lines={c.facts} /></article>)}
    </section>}
    {!!p.ledger.length && <details className="pi-score-log"><summary>得点と判定の記録</summary>{p.ledger.map((e, i) => <article key={i}><strong>R{e.round + 1} · {e.team === p.me.id ? "自分" : opponent?.name} · {e.points > 0 ? "+" : ""}{e.points}点</strong><Lines lines={e.text} /></article>)}</details>}
    <footer><p>これは公開原稿の戦略を学ぶ有限模型。論文の証明全体や実用の暗号を再現するものではありません。</p><a href="https://github.com/openai/math/blob/adc7f1241b42e322a6451854ab7e4b4c146bf78a/preprints/The-irrationality-exponent-of-pi-is-2-September-24-2026/paper.pdf" target="_blank" rel="noreferrer">元の論文</a> · <a href="https://arxiv.org/html/1912.06345v2" target="_blank" rel="noreferrer">先行研究</a></footer>
  </main>;
}
