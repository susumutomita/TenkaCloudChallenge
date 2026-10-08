import { useCallback, useEffect, useRef, useState } from "react";
import type { PortalSlotProps } from "@tenkacloud/portal-plugin-sdk";
import type { Operation, Projection } from "../game/index.ts";
import { styles } from "./styles.ts";

type Locale = "ja" | "en";
type Copy = { ja: string; en: string };
const words = {
  title: { ja: "証拠から、結論へ。", en: "From evidence to conclusion." },
  lead: { ja: "あなたは調査担当です。3つの架空の事件で記録を読み、分かることと分からないことを分けます。まず事件01のファイルを開き、根拠を選んで最初の問いに答えましょう。", en: "You are the investigator. Read the records in three fictional cases and separate what they prove from what remains unknown. Start by opening a file in case 01, then cite your evidence and answer the first question." },
  score: { ja: "獲得ポイント", en: "Points earned" },
  read: { ja: "記録を読む", en: "Read the records" },
  cite: { ja: "根拠を選ぶ", en: "Cite your evidence" },
  conclude: { ja: "結論を確かめる", en: "Check your conclusion" },
  evidence: { ja: "証拠ファイル", en: "Evidence files" },
  open: { ja: "開く", en: "Open" },
  download: { ja: "証拠をダウンロード", en: "Download evidence" },
  evidenceHelp: { ja: "ファイル名を押すと内容が表示されます。記録はすべて架空です。", en: "Choose a file to read its contents. All records are fictional." },
  hash: { ja: "SHA-256はファイル内容の指紋です。内容が変わると値も変わります。記録の内容が真実かどうかを保証するものではありません。", en: "SHA-256 is a fingerprint of the file contents. A change to the contents changes this value. It does not prove the records are true." },
  answer: { ja: "あなたの結論", en: "Your conclusion" },
  citations: { ja: "この答えを支える証拠", en: "Evidence supporting this answer" },
  submit: { ja: "答えを確かめる", en: "Check answer" },
  hint: { ja: "次のヒント", en: "Next hint" },
  hintTitle: { ja: "考えるためのヒント", en: "A little help thinking it through" },
  hintHelp: { ja: "3段階：仕組み → 小さな例 → この証拠で試す。ポイントは減りません。", en: "Three steps: the mechanism → a small example → apply it to these records. Hints cost no points." },
  solved: { ja: "解決", en: "Solved" },
  explanation: { ja: "解説：証拠から何が言える？", en: "Explanation: what does the evidence establish?" },
  attempts: { ja: "回答回数", en: "Attempts" },
  loading: { ja: "証拠ファイルを準備しています…", en: "Opening the casebook…" },
  unwired: { ja: "調査画面への接続がまだありません。運営に接続状況を確認してください。", en: "The casebook is not connected yet. Ask the organizer to check the connection." },
  retry: { ja: "同じ送信を再確認", en: "Retry the same request" },
  refresh: { ja: "再読み込み", en: "Reload evidence" },
  uncertain: { ja: "送信の結果を確認できませんでした。入力と証拠の選択は残っています。「同じ送信を再確認」で、同じ受付番号のまま安全に確認できます。", en: "The result could not be confirmed. Your answer and evidence choices are saved here. Retry the same request to check it safely with the same request ID." },
  rejected: { ja: "送信を受け付けられませんでした。入力は残っています。必要なら証拠を再読み込みし、内容を確認してもう一度送信してください。", en: "The request was not accepted. Your input is still here. Reload the evidence if needed, then check your answer and submit again." },
  unavailable: { ja: "接続を確認できません。少し待って再読み込みしてください。", en: "The connection is unavailable. Wait a moment, then reload the evidence." },
  footer: { ja: "証拠を読む → 答えと根拠を送る → 結果と解説を確認。間違えても再挑戦できます。追加の点数は、各問いの最初の正解時だけ加算されます。", en: "Read → submit your answer with evidence → review the result and explanation. You can try again after a wrong answer. Each question awards points only on its first correct answer." },
} satisfies Record<string, Copy>;

function isProjection(value: unknown): value is Projection {
  if (!value || typeof value !== "object") return false;
  const localized = (text: unknown): text is Copy => !!text && typeof text === "object" && typeof (text as Copy).ja === "string" && typeof (text as Copy).en === "string";
  const p = value as Projection;
  return Array.isArray(p.cases) && p.cases.length > 0 && Number.isSafeInteger(p.revision) && Number.isSafeInteger(p.generation) && typeof p.teamId === "string" && typeof p.score === "number" && p.maxScore === 300 && p.cases.every((c) =>
    !!c && typeof c.id === "string" && localized(c.title) && localized(c.intro) && Array.isArray(c.evidence) && c.evidence.every((e) =>
      !!e && typeof e.id === "string" && typeof e.name === "string" && typeof e.content === "string" && typeof e.sha256 === "string" && localized(e.description)) &&
    Array.isArray(c.questions) && c.questions.every((q) => !!q && typeof q.id === "string" && localized(q.prompt) && localized(q.format) && Array.isArray(q.hints) && q.hints.every(localized) && typeof q.solved === "boolean" && typeof q.attempts === "number" && typeof q.unlockedHints === "number" && q.totalHints === 3 && (!q.explanation || localized(q.explanation)))) &&
    (!p.lastResult || (typeof p.lastResult.caseId === "string" && typeof p.lastResult.questionId === "string" && localized(p.lastResult.message)));
}

function EvidenceViewer({ evidence, locale }: { evidence: Projection["cases"][number]["evidence"]; locale: Locale }) {
  const [selected, setSelected] = useState(evidence[0]?.id ?? "");
  const file = evidence.find((e) => e.id === selected) ?? evidence[0];
  const [download, setDownload] = useState("");
  useEffect(() => {
    if (!file) return;
    const url = URL.createObjectURL(new Blob([file.content], { type: "text/plain;charset=utf-8" }));
    setDownload(url);
    return () => URL.revokeObjectURL(url);
  }, [file?.content, file?.name]);
  return <aside className="fc-evidence" aria-label={words.evidence[locale]}>
    <div className="fc-section-head"><h3>{words.evidence[locale]}</h3><span className="fc-badge">{evidence.length} FILES</span></div>
    <p className="fc-small">{words.evidenceHelp[locale]}</p>
    <div className="fc-files">{evidence.map((e) => <button type="button" className="fc-file" key={e.id} data-testid={`evidence-${e.id}`} aria-pressed={file?.id === e.id} onClick={() => setSelected(e.id)}><strong>{e.id} · {e.name}</strong><span>{words.open[locale]} ↗</span></button>)}</div>
    {file && <>
      <p className="fc-evidence-description">{file.description[locale]}</p>
      <pre className="fc-content" tabIndex={0} data-testid="evidence-content" aria-label={file.name}>{file.content}</pre>
      <div className="fc-digest" data-testid="evidence-sha256">SHA-256: {file.sha256}</div>
      <p className="fc-small">{words.hash[locale]}</p>
      <a className="fc-download" data-testid="download-evidence" href={download || undefined} download={file.name}>↓ {words.download[locale]}</a>
    </>}
  </aside>;
}

type Draft = { answer: string; evidenceIds: string[] };
export default function StatusPanel(props: PortalSlotProps) {
  const locale: Locale = props.locale === "en" ? "en" : "ja";
  const client = props.coordinationClient;
  const clientRef = useRef(client);
  clientRef.current = client;
  const [projection, setProjection] = useState<Projection | null>(null);
  const projectionRef = useRef<Projection | null>(null);
  const [selected, setSelected] = useState("identity");
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [error, setError] = useState<"uncertain" | "rejected" | "unavailable" | null>(null);
  const [pending, setPending] = useState<Operation | null>(null);
  const pendingRef = useRef<Operation | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const requestEpoch = useRef(0);

  const accept = useCallback((next: Projection) => {
    const old = projectionRef.current;
    if (old && (old.teamId !== next.teamId || old.generation !== next.generation)) {
      setDrafts({}); setPending(null); pendingRef.current = null; setError(null);
    }
    if (old && old.teamId === next.teamId && old.generation === next.generation && next.revision < old.revision) return;
    projectionRef.current = next; setProjection(next);
  }, []);
  const reload = useCallback(async () => {
    const activeClient = clientRef.current;
    if (!activeClient) return;
    const epoch = requestEpoch.current;
    try {
      const result = await activeClient.getProjection();
      if (epoch !== requestEpoch.current) return;
      if (result.kind === "ok" && isProjection(result.projection)) { accept(result.projection); if (!pendingRef.current) setError(null); }
      else setError("unavailable");
    } catch { if (epoch === requestEpoch.current) setError("unavailable"); }
  }, [accept]);
  useEffect(() => {
    requestEpoch.current += 1; projectionRef.current = null; setProjection(null); setDrafts({}); setError(null); setPending(null); pendingRef.current = null; busyRef.current = false; setBusy(false);
    void reload();
    const timer = setInterval(() => { if (!busyRef.current && !pendingRef.current) void reload(); }, 15000);
    return () => { clearInterval(timer); requestEpoch.current += 1; };
  }, [reload, props.team.teamId, props.team.eventId, props.problemId, props.jobId, !!client]);

  async function send(op: Operation) {
    const activeClient = clientRef.current;
    if (!activeClient || busyRef.current) return;
    const epoch = requestEpoch.current;
    busyRef.current = true; setBusy(true); setError(null); setPending(op); pendingRef.current = op;
    try {
      const result = await activeClient.submitOp(op);
      if (epoch !== requestEpoch.current) return;
      if (result.kind === "ok" && isProjection(result.projection)) {
        accept(result.projection); setPending(null); pendingRef.current = null;
      } else if (result.kind === "rejected" || result.kind === "conflict") {
        setPending(null); pendingRef.current = null;
        await reload(); setError("rejected");
      } else { setError("uncertain"); }
    } catch { if (epoch === requestEpoch.current) setError("uncertain"); }
    finally { if (epoch === requestEpoch.current) { busyRef.current = false; setBusy(false); } }
  }
  function edit(key: string, change: Partial<Draft>) { setDrafts((old) => ({ ...old, [key]: { answer: "", evidenceIds: [], ...old[key], ...change } })); }
  const c = projection?.cases.find((entry) => entry.id === selected) ?? projection?.cases[0];
  const locked = busy || !!pending;
  return <div className="fc" data-testid="forensic-casebook">
    <style>{styles}</style>
    <header className="fc-head"><div><div className="fc-kicker">FORENSIC CASEBOOK · 3 CASES</div><h1>{words.title[locale]}</h1><p className="fc-lead">{words.lead[locale]}</p></div><div className="fc-score"><strong data-testid="score">{projection?.score ?? 0}<small> / {projection?.maxScore ?? 300}</small></strong><small>{words.score[locale]}</small></div></header>
    <div className="fc-method"><span><b>01</b>{words.read[locale]}</span><span><b>02</b>{words.cite[locale]}</span><span><b>03</b>{words.conclude[locale]}</span></div>
    {!client && <p role="status">{words.unwired[locale]}</p>}
    {client && !projection && !error && <p role="status">{words.loading[locale]}</p>}
    {error && <div className="fc-error" role="alert"><p>{words[error][locale]}</p>{pending ? <button type="button" data-testid="retry-request" disabled={busy} onClick={() => void send(pending)}>{words.retry[locale]}</button> : <button type="button" onClick={() => void reload()}>{words.refresh[locale]}</button>}</div>}
    {projection && c && <>
      <nav className="fc-tabs" aria-label={locale === "ja" ? "事件を選ぶ" : "Choose a case"}>{projection.cases.map((item, index) => <button type="button" data-testid={`case-${item.id}`} key={item.id} aria-pressed={c.id === item.id} onClick={() => setSelected(item.id)}><span className="fc-tab-number">CASE 0{index + 1}</span><strong>{item.title[locale]}</strong><small>{item.questions.filter((q) => q.solved).length} / {item.questions.length} {words.solved[locale]}</small></button>)}</nav>
      <h2 className="fc-case-title">{c.title[locale]}</h2><p className="fc-intro">{c.intro[locale]}</p>
      <div className="fc-workspace"><EvidenceViewer key={`${projection.generation}:${c.id}`} evidence={c.evidence} locale={locale} /><div className="fc-questions">{c.questions.map((q, index) => {
        const key = `${c.id}:${q.id}`;
        const draft = drafts[key] ?? { answer: "", evidenceIds: [] };
        const result = projection.lastResult?.caseId === c.id && projection.lastResult.questionId === q.id ? projection.lastResult : null;
        return <section className="fc-question" data-testid={`question-${q.id}`} data-solved={q.solved} key={q.id}>
          <div className="fc-question-header"><span className="fc-kicker">QUESTION 0{index + 1}</span><span className="fc-badge">{q.solved ? `✓ ${words.solved[locale]}` : `${q.points} PT`}</span></div>
          <p className="fc-question-prompt">{q.prompt[locale]}</p><p className="fc-format">{q.format[locale]}</p>
          {!q.solved && <form onSubmit={(event) => { event.preventDefault(); if (!locked) void send({ kind: "answer", id: crypto.randomUUID(), generation: projection.generation, revision: projection.revision, caseId: c.id, questionId: q.id, answer: draft.answer, evidenceIds: draft.evidenceIds }); }}>
            <label className="fc-label" htmlFor={`fc-answer-${q.id}`}>{words.answer[locale]}</label><textarea id={`fc-answer-${q.id}`} data-testid={`answer-${q.id}`} required maxLength={512} value={draft.answer} disabled={locked} onChange={(e) => edit(key, { answer: e.target.value })} />
            <fieldset disabled={locked}><legend>{words.citations[locale]}</legend>{c.evidence.map((file) => <label className="fc-citation" key={file.id}><input type="checkbox" data-testid={`cite-${q.id}-${file.id}`} checked={draft.evidenceIds.includes(file.id)} onChange={(event) => edit(key, { evidenceIds: event.target.checked ? [...draft.evidenceIds, file.id] : draft.evidenceIds.filter((id) => id !== file.id) })} /><span>{file.id} · {file.name}</span></label>)}</fieldset>
            <div className="fc-actions"><button className="fc-primary" type="submit" data-testid={`submit-${q.id}`} disabled={locked || !draft.answer.trim() || draft.evidenceIds.length === 0}>{words.submit[locale]} →</button><span className="fc-small">{words.attempts[locale]}: <span data-testid={`attempts-${q.id}`}>{q.attempts}</span></span></div>
          </form>}
          {result?.kind === "answer" && <div className="fc-feedback" data-testid={`result-${q.id}`} data-status={result.status} role="status">{result.message[locale]}</div>}
          {q.solved && q.explanation && <div className="fc-explanation" data-testid={`explanation-${q.id}`}><strong>{words.explanation[locale]}</strong>{q.explanation[locale]}</div>}
          <div className="fc-hints"><p className="fc-label">{words.hintTitle[locale]}</p><p className="fc-small">{words.hintHelp[locale]}</p>{q.hints.length > 0 && <ol data-testid={`hints-${q.id}`}>{q.hints.map((hint, i) => <li key={i}>{hint[locale]}</li>)}</ol>}{q.unlockedHints < q.totalHints && <button type="button" data-testid={`hint-${q.id}`} disabled={locked} onClick={() => void send({ kind: "hint", id: crypto.randomUUID(), generation: projection.generation, revision: projection.revision, caseId: c.id, questionId: q.id, rung: (q.unlockedHints + 1) as 1 | 2 | 3 })}>{words.hint[locale]} {q.unlockedHints + 1} / {q.totalHints}</button>}</div>
        </section>;
      })}</div></div>
    </>}
    <footer className="fc-footer">{words.footer[locale]}</footer>
  </div>;
}
