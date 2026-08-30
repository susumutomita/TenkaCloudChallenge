import { useEffect, useMemo, useState } from "react";
import type { PortalCoordinationClient, PortalCoordinationOutcome, PortalSlotProps } from "@tenkacloud/portal-plugin-sdk";
import { isCryptoBattleProjection, usePolledProjection } from "./coordination.ts";
import { submitHunt, submitLeak, submitProve, submitRotate } from "./RegistrationPanelCore.tsx";
import type { ContractProjection, CryptoBattleProjection } from "../game/src/types.ts";

type Locale = "ja" | "en";
type FeedbackKind = "leak" | "prove" | "hunt" | "rotate" | "error";

interface Feedback {
  readonly kind: FeedbackKind;
  readonly title: string;
  readonly body: string;
}

const COPY = {
  en: {
    title: "MAKE A MOVE",
    selectOrder: "1. PICK AN ORDER",
    noOrder: "No Order is open right now.",
    choose: "2. CHOOSE ONE",
    leak: "LEAK",
    leakHint: "FAST / PUBLIC",
    prove: "PROVE",
    proveHint: "COMPUTE / PROTECTED",
    proveOpen: "Enter proof",
    commitment: "commitment",
    response: "response",
    hunt: "HUNT FROM LEDGER",
    huntHint: "Pick a team / generation you inspected in the Public Ledger.",
    noHuntTarget: "No opponent share is public yet.",
    recovered: "recovered secret",
    rotate: "ROTATE",
    rotateHint: "Switch to a fresh generation.",
    send: "SUBMIT",
    running: "SUBMITTING…",
    leakSuccess: "LEAK SUCCESS",
    leakBody: (points: number, shares: readonly number[]) => `+${points} · share ${shares.map((x) => `#${x}`).join(", ")} → PUBLIC LEDGER`,
    proveSuccess: "PROVE SUCCESS",
    proveBody: (points: number) => `+${points} · SHARE PROTECTED`,
    huntSuccess: "HUNT SUCCESS",
    huntBody: "Recovered secret accepted.",
    rotateSuccess: "ROTATE",
    rotateBody: (from: number, to: number) => `GEN ${from} → GEN ${to}`,
    rejected: "REJECTED",
    unavailable: "The match service is unavailable.",
    ended: "MATCH ENDED",
  },
  ja: {
    title: "MAKE A MOVE",
    selectOrder: "1. ORDER を選ぶ",
    noOrder: "現在 open な Order はありません。",
    choose: "2. どちらかを選ぶ",
    leak: "LEAK",
    leakHint: "速い / 公開",
    prove: "PROVE",
    proveHint: "計算 / 守る",
    proveOpen: "proof を入力",
    commitment: "commitment",
    response: "response",
    hunt: "LEDGER から HUNT",
    huntHint: "Public Ledger で見つけた相手チーム / 世代を選びます。",
    noHuntTarget: "まだ相手の share は公開されていません。",
    recovered: "復元した secret",
    rotate: "ROTATE",
    rotateHint: "新しい世代へ切り替えます。",
    send: "SUBMIT",
    running: "送信中…",
    leakSuccess: "LEAK SUCCESS",
    leakBody: (points: number, shares: readonly number[]) => `+${points} · share ${shares.map((x) => `#${x}`).join(", ")} → PUBLIC LEDGER`,
    proveSuccess: "PROVE SUCCESS",
    proveBody: (points: number) => `+${points} · SHARE PROTECTED`,
    huntSuccess: "HUNT SUCCESS",
    huntBody: "復元した secret が受理されました。",
    rotateSuccess: "ROTATE",
    rotateBody: (from: number, to: number) => `世代 ${from} → 世代 ${to}`,
    rejected: "REJECTED",
    unavailable: "試合サービスに接続できません。",
    ended: "MATCH ENDED",
  },
} as const;

function outcomeError(outcome: PortalCoordinationOutcome, locale: Locale): string {
  if (outcome.kind === "rejected") return outcome.error;
  if (outcome.kind === "not_configured") return locale === "ja" ? "coordination が未設定です。" : "Coordination is not configured.";
  return COPY[locale].unavailable;
}

function liveProjection(outcome: PortalCoordinationOutcome): CryptoBattleProjection | undefined {
  return outcome.kind === "ok" && isCryptoBattleProjection(outcome.projection) ? outcome.projection : undefined;
}

function isClosed(projection: CryptoBattleProjection | null): boolean {
  return Boolean(projection && (projection.phase === "ended" || (projection.matchRemainingMs ?? 1) <= 0));
}

function openOrders(projection: CryptoBattleProjection | null): readonly ContractProjection[] {
  if (!projection || isClosed(projection)) return [];
  return projection.myContracts.filter((order) => order.status === "open" && order.remainingMs > 0);
}

function ledgerTargets(projection: CryptoBattleProjection | null) {
  if (!projection) return [];
  const seen = new Set<string>();
  const targets: { teamId: string; generation: number; shareIndices: number[] }[] = [];
  for (const entry of projection.publicLedger) {
    if (entry.kind !== "share" || entry.teamId === projection.vault.teamId) continue;
    const key = `${entry.teamId}:${entry.generation}`;
    let target = targets.find((candidate) => `${candidate.teamId}:${candidate.generation}` === key);
    if (!target) {
      target = { teamId: entry.teamId, generation: entry.generation, shareIndices: [] };
      targets.push(target);
    }
    const indexKey = `${key}:${entry.shareIndex}`;
    if (!seen.has(indexKey)) {
      seen.add(indexKey);
      target.shareIndices.push(entry.shareIndex);
    }
  }
  return targets;
}

const CSS = `
.tc-move-shell{border:2px solid #202b3c;border-radius:12px;padding:12px;background:#f8fafc;display:grid;gap:12px;font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
.tc-move-title{font-size:12px;font-weight:900;letter-spacing:.12em}
.tc-order-picks{display:flex;gap:7px;overflow-x:auto;padding-bottom:4px}
.tc-order-pick{min-width:150px;border:1px solid #b6c2cf;border-radius:9px;padding:8px;background:#fff;cursor:pointer;text-align:left}
.tc-order-pick[aria-pressed="true"]{border:2px solid #0972d3;background:#f1f8ff;padding:7px}
.tc-order-pick strong,.tc-order-pick span{display:block}.tc-order-pick span{font-size:11px;color:#5f6b7a;margin-top:2px}
.tc-primary-actions{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.tc-action{border:0;border-radius:12px;padding:16px 12px;cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:3px;font-weight:900;font-size:18px}
.tc-action small{font-size:10px;font-weight:800;letter-spacing:.06em}
.tc-action:disabled{cursor:not-allowed;opacity:.45}
.tc-leak-button{background:#ffefd1;box-shadow:inset 0 0 0 2px #d8a657}
.tc-prove-button{background:#e7f6ec;box-shadow:inset 0 0 0 2px #69b482}
.tc-input-panel{border:1px solid #cfd8e3;border-radius:9px;padding:9px;background:#fff;display:grid;gap:6px}
.tc-input-panel input,.tc-input-panel select{padding:8px;border:1px solid #aab7c4;border-radius:6px;font-size:12px;min-width:0}
.tc-secondary-grid{display:grid;grid-template-columns:1.3fr .7fr;gap:10px}
.tc-hunt-card,.tc-rotate-card{border:1px solid #cfd8e3;border-radius:10px;padding:10px;background:#fff}
.tc-card-title{font-size:12px;font-weight:900;letter-spacing:.07em}.tc-card-hint{font-size:11px;color:#5f6b7a;margin:3px 0 8px}
.tc-target-row{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:7px}
.tc-target-chip{border:1px solid #b6c2cf;border-radius:999px;background:#fff;padding:6px 9px;cursor:pointer;font-size:11px}
.tc-target-chip[aria-pressed="true"]{background:#eef3f8;border-color:#516a84;font-weight:800}
.tc-submit-small{padding:7px 10px;border:0;border-radius:7px;background:#202b3c;color:#fff;font-weight:800;cursor:pointer}.tc-submit-small:disabled{opacity:.45;cursor:not-allowed}
.tc-feedback{border-radius:10px;padding:10px 12px;font-weight:900;animation:tc-feedback-pop .35s ease-out both}
.tc-feedback span{display:block;font-size:11px;font-weight:600;margin-top:2px}
.tc-feedback-leak{background:#fff0d6;border:1px solid #d8a657}.tc-feedback-prove{background:#e7f6ec;border:1px solid #69b482}.tc-feedback-hunt{background:#f0eaff;border:1px solid #9a7bd1}.tc-feedback-rotate{background:#e8f3ff;border:1px solid #6ba8df}.tc-feedback-error{background:#fff0f0;border:1px solid #d13212}
@keyframes tc-feedback-pop{0%{transform:translateY(7px) scale(.97);opacity:0}60%{transform:translateY(0) scale(1.02);opacity:1}100%{transform:scale(1)}}
@media(max-width:720px){.tc-primary-actions,.tc-secondary-grid{grid-template-columns:1fr}}
@media(prefers-reduced-motion:reduce){.tc-feedback{animation:none!important}}
`;

export default function FastMovePanel(props: PortalSlotProps) {
  const locale: Locale = props.locale === "ja" ? "ja" : "en";
  const copy = COPY[locale];
  const client = props.coordinationClient;
  const polled = usePolledProjection(client);
  const [projection, setProjection] = useState<CryptoBattleProjection | null>(null);
  const [selectedOrderId, setSelectedOrderId] = useState("");
  const [commitment, setCommitment] = useState("");
  const [response, setResponse] = useState("");
  const [proveOpen, setProveOpen] = useState(false);
  const [huntTargetKey, setHuntTargetKey] = useState("");
  const [recoveredSecret, setRecoveredSecret] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);

  useEffect(() => {
    if (polled.projection) setProjection(polled.projection);
  }, [polled.projection]);

  const orders = useMemo(() => openOrders(projection), [projection]);
  const selectedOrder = orders.find((order) => order.id === selectedOrderId) ?? orders[0];
  const targets = useMemo(() => ledgerTargets(projection), [projection]);
  const selectedTarget = targets.find((target) => `${target.teamId}:${target.generation}` === huntTargetKey) ?? targets[0];

  const applyOutcome = (outcome: PortalCoordinationOutcome) => {
    const next = liveProjection(outcome);
    if (next) setProjection(next);
    if (outcome.kind !== "ok") {
      setFeedback({ kind: "error", title: copy.rejected, body: outcomeError(outcome, locale) });
      return false;
    }
    return true;
  };

  const run = async (task: () => Promise<PortalCoordinationOutcome>, success: () => Feedback) => {
    if (submitting) return;
    setSubmitting(true);
    setFeedback(null);
    try {
      const outcome = await task();
      if (applyOutcome(outcome)) setFeedback(success());
    } catch {
      setFeedback({ kind: "error", title: copy.rejected, body: copy.unavailable });
    } finally {
      setSubmitting(false);
    }
  };

  if (!client) return null;
  if (!projection) return <section className="tc-move-shell"><style>{CSS}</style><div>{copy.unavailable}</div></section>;
  if (isClosed(projection)) return <section className="tc-move-shell"><style>{CSS}</style><strong>{copy.ended}</strong></section>;

  return (
    <section className="tc-move-shell" aria-label="crypto-battle-fast-moves">
      <style>{CSS}</style>
      <div className="tc-move-title">{copy.title}</div>

      <div>
        <div className="tc-card-title">{copy.selectOrder}</div>
        {orders.length === 0 ? <div className="tc-card-hint">{copy.noOrder}</div> : (
          <div className="tc-order-picks">
            {orders.map((order) => (
              <button key={order.id} className="tc-order-pick" type="button" aria-pressed={selectedOrder?.id === order.id} onClick={() => setSelectedOrderId(order.id)}>
                <strong>{order.id.replace(/^.*-c/, "ORDER #")}</strong>
                <span>+{order.points} · {Math.ceil(order.remainingMs / 1000)}s</span>
                <span>share [{order.requestedShareIndices.join(", ")}]</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div>
        <div className="tc-card-title">{copy.choose}</div>
        <div className="tc-primary-actions">
          <button
            type="button"
            className="tc-action tc-leak-button"
            disabled={!selectedOrder || submitting}
            onClick={() => selectedOrder && void run(
              () => submitLeak(client, selectedOrder.id),
              () => ({ kind: "leak", title: copy.leakSuccess, body: copy.leakBody(selectedOrder.points, selectedOrder.requestedShareIndices) }),
            )}
          >
            {copy.leak}<small>{copy.leakHint}</small>
          </button>
          <button type="button" className="tc-action tc-prove-button" disabled={!selectedOrder || submitting} onClick={() => setProveOpen((value) => !value)}>
            {copy.prove}<small>{copy.proveHint}</small>
          </button>
        </div>
      </div>

      {proveOpen && selectedOrder && (
        <div className="tc-input-panel">
          <strong style={{ fontSize: "12px" }}>{copy.proveOpen} · {selectedOrder.id.replace(/^.*-c/, "ORDER #")}</strong>
          <input aria-label="fast-prove-commitment" value={commitment} onChange={(event) => setCommitment(event.target.value)} placeholder={copy.commitment} />
          <input aria-label="fast-prove-response" value={response} onChange={(event) => setResponse(event.target.value)} placeholder={copy.response} />
          <button
            type="button"
            className="tc-submit-small"
            disabled={submitting || !commitment.trim() || !response.trim()}
            onClick={() => void run(
              () => submitProve(client, selectedOrder.id, { commitment: commitment.trim(), response: response.trim() }),
              () => ({ kind: "prove", title: copy.proveSuccess, body: copy.proveBody(selectedOrder.points) }),
            )}
          >{submitting ? copy.running : copy.send}</button>
        </div>
      )}

      <div className="tc-secondary-grid">
        <div className="tc-hunt-card">
          <div className="tc-card-title">{copy.hunt}</div>
          <div className="tc-card-hint">{copy.huntHint}</div>
          {targets.length === 0 ? <div className="tc-card-hint">{copy.noHuntTarget}</div> : (
            <>
              <div className="tc-target-row">
                {targets.map((target) => {
                  const key = `${target.teamId}:${target.generation}`;
                  return <button key={key} type="button" className="tc-target-chip" aria-pressed={selectedTarget ? `${selectedTarget.teamId}:${selectedTarget.generation}` === key : false} onClick={() => setHuntTargetKey(key)}>{target.teamId} · gen {target.generation} · [{target.shareIndices.join(",")}]</button>;
                })}
              </div>
              <div className="tc-input-panel">
                <input aria-label="fast-hunt-secret" value={recoveredSecret} onChange={(event) => setRecoveredSecret(event.target.value)} placeholder={copy.recovered} />
                <button
                  type="button"
                  className="tc-submit-small"
                  disabled={submitting || !selectedTarget || !recoveredSecret.trim()}
                  onClick={() => selectedTarget && void run(
                    () => submitHunt(client, selectedTarget.teamId, selectedTarget.generation, recoveredSecret.trim()),
                    () => ({ kind: "hunt", title: copy.huntSuccess, body: copy.huntBody }),
                  )}
                >{submitting ? copy.running : copy.send}</button>
              </div>
            </>
          )}
        </div>

        <div className="tc-rotate-card">
          <div className="tc-card-title">{copy.rotate}</div>
          <div className="tc-card-hint">{copy.rotateHint}</div>
          <button
            type="button"
            className="tc-submit-small"
            disabled={submitting || projection.vault.rotateCooldownRemainingMs > 0}
            onClick={() => {
              const before = projection.vault.generation;
              void run(
                () => submitRotate(client),
                () => ({ kind: "rotate", title: copy.rotateSuccess, body: copy.rotateBody(before, before + 1) }),
              );
            }}
          >{projection.vault.rotateCooldownRemainingMs > 0 ? `${Math.ceil(projection.vault.rotateCooldownRemainingMs / 1000)}s` : copy.rotate}</button>
        </div>
      </div>

      {feedback && <div className={`tc-feedback tc-feedback-${feedback.kind}`}><strong>{feedback.title}</strong><span>{feedback.body}</span></div>}
    </section>
  );
}
