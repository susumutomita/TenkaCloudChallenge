import { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import type { PortalCoordinationClient, PortalCoordinationOutcome, PortalLocale } from "@tenkacloud/portal-plugin-sdk";
import StatusPanel from "../portal/StatusPanel.tsx";

type Session = { seat: string; generation: number; mode: "local-practice" };
const fragment = new URLSearchParams(location.hash.slice(1));
const token = fragment.get("token") ?? "";
async function request(path: string, body?: unknown) {
  const response = await fetch(path, { method: body === undefined ? "GET" : "POST", headers: { authorization: `Bearer ${token}`, ...(body === undefined ? {} : { "content-type": "application/json" }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { response, data: await response.json() };
}
function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [locale, setLocale] = useState<PortalLocale>("ja");
  const [failure, setFailure] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [resetError, setResetError] = useState(false);
  const [resetBusy, setResetBusy] = useState(false);
  const [resetOp, setResetOp] = useState<{ id: string; generation: number; confirmation: string } | null>(null);
  const client = useMemo<PortalCoordinationClient>(() => ({
    async getProjection() { return (await request("/api/projection")).data as PortalCoordinationOutcome; },
    async submitOp(op) { return (await request("/api/op", op)).data as PortalCoordinationOutcome; },
  }), []);
  useEffect(() => { document.documentElement.lang = locale; }, [locale]);
  useEffect(() => { void request("/api/session").then(({ response, data }) => { if (!response.ok) setFailure(true); else setSession(data as Session); }).catch(() => setFailure(true)); }, []);
  async function reset() {
    if (!session || !confirmed || resetBusy) return;
    const op = resetOp ?? { id: crypto.randomUUID(), generation: session.generation, confirmation: "RESET MY PRACTICE" };
    setResetOp(op); setResetBusy(true); setResetError(false);
    try {
      const { response, data } = await request("/api/practice-reset", op);
      if (!response.ok) throw new Error("Reset failed");
      setSession(data as Session); setConfirming(false); setConfirmed(false); setResetOp(null);
    } catch { setResetError(true); } finally { setResetBusy(false); }
  }
  if (failure) return <div className="practice-message" role="alert"><h1>Practice link required / 練習用リンクが必要です</h1><p>Open the complete generated seat link printed by the local server. The seat credential is required. / ローカルサーバーが表示した練習用リンク全体を開いてください。</p></div>;
  if (!session) return <p className="practice-message">Opening local practice… / 練習を準備しています…</p>;
  return <>
    <header className="practice-bar"><div><strong>LOCAL PRACTICE · 練習専用</strong><div data-testid="practice-seat">{session.seat} · {locale === "ja" ? "練習回" : "Run"} <span data-testid="practice-generation">{session.generation}</span></div></div><label>{locale === "ja" ? "表示言語" : "Language"} <select aria-label="Language / 表示言語" value={locale} onChange={(e) => setLocale(e.target.value as PortalLocale)}><option value="ja">日本語</option><option value="en">English</option></select></label><button type="button" data-testid="practice-reset" onClick={() => setConfirming(true)}>{locale === "ja" ? "新しい練習を始める" : "Start a new practice run"}</button></header>
    <p className="practice-note">{locale === "ja" ? "これはこのコンピューターだけで動く練習です。ポイントは公式の競技記録に入りません。別の席は、サーバーが表示した別の練習用リンクで開けます。" : "This practice runs only on this computer. Points are not official competition records. Open another generated seat link from the server to practice in a separate seat."}</p>
    {confirming && <section className="practice-confirm" role="region" aria-label={locale === "ja" ? "練習をやり直す確認" : "Confirm practice reset"}><strong>{locale === "ja" ? "この席の記録を消して、違う証拠でやり直しますか？" : "Clear this seat’s progress and start with new evidence?"}</strong><p>{locale === "ja" ? "この席の回答・ポイント・ヒントは消えます。ほかの席は変わりません。" : "This clears this seat’s answers, points and hints. Other seats are unchanged."}</p><label><input data-testid="confirm-reset-checkbox" type="checkbox" checked={confirmed} disabled={resetBusy || !!resetOp} onChange={(e) => setConfirmed(e.target.checked)} /> {locale === "ja" ? "この席の練習を消すことを確認しました" : "I understand this clears my practice progress"}</label><button type="button" data-testid="confirm-reset" disabled={!confirmed || resetBusy} onClick={() => void reset()}>{locale === "ja" ? "確認して新しい練習を始める" : "Confirm and start new practice"}</button>{!resetOp && <button type="button" onClick={() => { setConfirming(false); setConfirmed(false); }}>{locale === "ja" ? "キャンセル" : "Cancel"}</button>}{resetError && <p role="alert">{locale === "ja" ? "結果を確認できませんでした。同じ確認ボタンで安全に再確認できます。" : "The result could not be confirmed. Use the same confirmation button to retry safely."}</p>}</section>}
    <main><StatusPanel key={`${session.seat}:${session.generation}`} team={{ teamId: session.seat, teamName: session.seat }} problemId="forensic-casebook" jobId={`practice-${session.generation}`} score={0} locale={locale} endpoints={[]} phases={[]} disruptions={[]} nowIso={new Date().toISOString()} coordinationClient={client} /></main>
  </>;
}
const root = document.getElementById("root");
if (!root) throw new Error("Missing root");
createRoot(root).render(<App />);
