import type { PortalCoordinationClient, PortalCoordinationOutcome, PortalSlotProps } from "@tenkacloud/portal-plugin-sdk";
import { useCallback, useEffect, useState } from "react";
import type { ExchangeProjection } from "../coordination/exchange";
import { COPY } from "./copy";

function isProjection(value: unknown): value is ExchangeProjection {
  if (!value || typeof value !== "object") return false;
  const v = value as Partial<ExchangeProjection>;
  return typeof v.ready === "boolean" && typeof v.code === "string" && typeof v.bonus === "number" && typeof v.limit === "number" && Array.isArray(v.teams) && v.teams.every(t => t && typeof t.id === "string" && typeof t.name === "string" && typeof t.complete === "boolean" && typeof t.waiting === "boolean" && typeof t.selected === "boolean" && typeof t.bonus === "number");
}
const button = { padding: "12px 20px", minHeight: 48, borderRadius: 8, border: "2px solid #296b61", background: "#296b61", color: "white", fontSize: 16, cursor: "pointer" };
export default function StatusPanel(props: PortalSlotProps) {
  if (!props.coordinationClient) return null;
  return <Exchange key={`${props.team.eventId}:${props.team.teamId}`} client={props.coordinationClient} locale={props.locale} />;
}
function Exchange({ client, locale }: { client: PortalCoordinationClient; locale: string }) {
  const c = COPY[locale === "ja" ? "ja" : "en"];
  const [projection, setProjection] = useState<ExchangeProjection | null>(null);
  const [peer, setPeer] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const accept = useCallback((result: PortalCoordinationOutcome) => {
    if (result.kind === "ok" && isProjection(result.projection)) { setProjection(result.projection); setError(""); }
    else setError(result.kind === "rejected" ? result.error : "unavailable");
  }, []);
  const refresh = useCallback(async () => {
    try { accept(await client.getProjection()); } catch { setError("unavailable"); }
  }, [client, accept]);
  useEffect(() => {
    let active = true;
    const load = async () => { try { const value = await client.getProjection(); if (active) accept(value); } catch { if (active) setError("unavailable"); } };
    void load(); const timer = setInterval(() => void load(), 30_000);
    return () => { active = false; clearInterval(timer); };
  }, [client, accept]);
  async function submit(op: unknown) {
    setBusy(true);
    try { accept(await client.submitOp(op)); } catch { setError("unavailable"); }
    finally { setBusy(false); }
  }
  const selected = projection?.teams.find(t => t.id === peer);
  return <section style={{ padding: 24, background: "#f0faf7", border: "2px solid #91c6b4", borderRadius: 16 }}>
    <h2>{c.title}</h2><p>{c.intro}</p>
    {error && <p role="alert">{Object.hasOwn(c.errors, error) ? c.errors[error as keyof typeof c.errors] : c.errors.unavailable}</p>}
    {projection && !projection.ready && <button type="button" style={button} disabled={busy} onClick={() => void submit({ kind: "cancel" })}>{c.start}</button>}
    {projection?.ready && <>
      <p>{c.yourCode} <strong style={{ fontSize: 24, fontFamily: "monospace", overflowWrap: "anywhere" }}>{projection.code.match(/.{1,4}/g)?.join("-")}</strong></p>
      <p>{c.how}</p><p><strong>{c.bonus}: {projection.bonus} / {projection.limit}</strong> · {c.cap}</p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
        {projection.teams.map(team => <button key={team.id} type="button" style={{ ...button, color: "#163f37", background: peer === team.id ? "#c0e5d7" : "white" }} disabled={busy || team.complete} aria-pressed={peer === team.id} onClick={() => { setPeer(team.id); setCode(""); }}>
          {team.name} · {team.complete ? c.complete : team.waiting ? c.waiting : c.choose}
        </button>)}
      </div>
      {projection.teams.length === 0 && <p>{c.noPeer}</p>}
      {selected && !selected.complete && <form onSubmit={event => { event.preventDefault(); void submit({ kind: "exchange", peer, code }); }} style={{ marginTop: 20 }}>
        <label>{selected.name} — {c.partnerCode}<input value={code} onChange={event => setCode(event.target.value)} autoComplete="off" maxLength={24} style={{ display: "block", boxSizing: "border-box", width: "100%", maxWidth: 400, padding: 12, fontSize: 18, margin: "8px 0" }} /></label>
        <button type="submit" style={button} disabled={busy || !code.trim()}>{c.send}</button>
      </form>}
      {projection.teams.some(team => team.selected) && <p role="status">{c.pending} <button type="button" style={{ ...button, background: "white", color: "#296b61" }} disabled={busy} onClick={() => void submit({ kind: "cancel" })}>{c.cancel}</button></p>}
    </>}
    <p><button type="button" style={{ ...button, background: "white", color: "#296b61" }} disabled={busy} onClick={() => void refresh()}>{c.refresh}</button></p>
  </section>;
}
