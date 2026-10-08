import { createRoot } from "react-dom/client";
import type { PortalCoordinationClient, PortalCoordinationOutcome } from "@tenkacloud/portal-plugin-sdk";
import StatusPanel from "../portal/StatusPanel.tsx";
const locale = new URL(location.href).searchParams.get("locale") === "en" ? "en" : "ja";
const tr = (ja: string, en: string) => locale === "ja" ? ja : en;
const seat = new URL(location.href).searchParams.get("team") ?? "alpha";
const api = async (path: string, body?: unknown): Promise<PortalCoordinationOutcome> => {
  const response = await fetch(`/api/${path}?team=${encodeURIComponent(seat)}`, body === undefined ? {} : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`HTTP ${response.status}: ${detail}`);
  }
  return response.json();
};
const client: PortalCoordinationClient = { getProjection: () => api("projection"), submitOp: op => api("op", op) };
createRoot(document.getElementById("app")!).render(<>
  <aside className="pi-toolbar"><strong>{tr("ローカル試作 · 認証なし · 得点は公式記録に送らない","Local prototype · No authentication · No official score writes")}</strong><a href={`/?team=alpha&locale=${locale}`}>{tr("青席","Blue seat")}</a><a href={`/?team=bravo&locale=${locale}`} target="_blank" rel="noreferrer">{tr("橙席を別タブで開く","Open orange seat in another tab")}</a><button onClick={async () => { if (!confirm(tr("このローカル試合を最初から作り直します。","Restart this local match from the beginning?"))) return; const r = await fetch("/api/reset", { method: "POST" }); if (r.ok) location.reload(); else alert(await r.text()); }}>{tr("ローカル試合を作り直す","Restart the local match")}</button></aside>
  <StatusPanel team={{ teamId: seat, teamName: seat, eventId: "local-pi-siege" }} problemId="pi-siege" jobId="local-pi-siege" score={0} locale={locale} endpoints={[]} phases={[]} disruptions={[]} nowIso={new Date().toISOString()} coordinationClient={client} />
</>);
