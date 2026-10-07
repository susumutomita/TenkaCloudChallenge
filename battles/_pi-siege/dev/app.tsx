import { createRoot } from "react-dom/client";
import type { PortalCoordinationClient, PortalCoordinationOutcome } from "@tenkacloud/portal-plugin-sdk";
import StatusPanel from "../portal/StatusPanel.tsx";
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
  <aside className="pi-toolbar"><strong>ローカル試作 · 認証なし · 得点は公式記録に送らない</strong><a href="/?team=alpha">青席</a><a href="/?team=bravo" target="_blank" rel="noreferrer">橙席を別タブで開く</a><button onClick={async () => { if (!confirm("このローカル試合を最初から作り直します。")) return; const r = await fetch("/api/reset", { method: "POST" }); if (r.ok) location.reload(); else alert(await r.text()); }}>ローカル試合を作り直す</button></aside>
  <StatusPanel team={{ teamId: seat, teamName: seat, eventId: "local-pi-siege" }} problemId="pi-siege" jobId="local-pi-siege" score={0} locale="ja" endpoints={[]} phases={[]} disruptions={[]} nowIso={new Date().toISOString()} coordinationClient={client} />
</>);
