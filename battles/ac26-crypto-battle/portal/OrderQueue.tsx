import { useEffect, useReducer, useRef, useState } from "react";
import type { ContractProjection, CryptoBattleProjection } from "../game/src/types.ts";
import { OrderBelt } from "./GameBoard.tsx";
import { taskLabel } from "./orderTask.ts";

export interface OrderReceipt { readonly id: string; readonly points: number }
type Locale = "ja" | "en";

/** A deadline may end between server polls; do not leave it actionable at 0:00. */
export function orderDisplayState(order: ContractProjection): "open" | "completed" | "expired" | "voided" | "failed" {
  if (order.status === "completed" && order.schnorr?.pending?.outcome === "miss") return "failed";
  if (order.status === "expired" && order.expiryCause === "rotate") return "voided";
  return order.status === "open" && order.remainingMs <= 0 ? "expired" : order.status;
}

export function orderResultLabel(order: ContractProjection, locale: Locale): string {
  if (orderDisplayState(order) === "failed") return locale === "ja" ? "✗ 証明失敗" : "✗ Proof failed";
  if (orderDisplayState(order) === "completed") return locale === "ja" ? "✓ 完了" : "✓ Completed";
  if (orderDisplayState(order) === "voided") return locale === "ja" ? "↻ ROTATEで無効" : "↻ Voided by ROTATE";
  return locale === "ja" ? "⌛ 期限切れ" : "⌛ Expired";
}

interface OrderAnnouncement { readonly version: number; readonly text: string }
type AnnouncementAction = { readonly text: string } | { readonly clearVersion: number };
/** A repeated message is a new event; an older timer cannot erase that event. */
export function updateOrderAnnouncement(current: OrderAnnouncement, action: AnnouncementAction): OrderAnnouncement {
  if ("text" in action) return { version: current.version + 1, text: action.text };
  return action.clearVersion === current.version ? { ...current, text: "" } : current;
}

/** Changes only, not countdown ticks: the live region must never read every second. */
export function orderChanges(previous: ReadonlyMap<string, string>, orders: readonly ContractProjection[]) {
  return {
    arrived: orders.filter(order => !previous.has(order.id) && orderDisplayState(order) === "open"),
    finished: orders.filter(order => previous.has(order.id) && previous.get(order.id) !== orderDisplayState(order) && orderDisplayState(order) !== "open"),
  };
}

/** Always visible, including while answering. Updates never select, focus, or scroll. */
export default function OrderQueue({ projection, locale, selectedId, onSelect, receipt }: {
  readonly projection: CryptoBattleProjection;
  readonly locale: Locale;
  readonly selectedId?: string;
  readonly onSelect: (id: string) => void;
  readonly receipt?: OrderReceipt;
}) {
  const previous = useRef<ReadonlyMap<string, string> | null>(null);
  const [newIds, setNewIds] = useState<readonly string[]>([]);
  const [announcement, announce] = useReducer(updateOrderAnnouncement, { version: 0, text: "" });
  const [recent, setRecent] = useState<readonly ContractProjection[]>([]);
  const [receipts, setReceipts] = useState<Readonly<Record<string, number>>>({});

  useEffect(() => {
    const orders = projection.myContracts;
    if (previous.current !== null) {
      const changes = orderChanges(previous.current, orders);
      if (changes.arrived.length || changes.finished.length) {
        const messages: string[] = [];
        if (changes.arrived.length) {
          setNewIds(changes.arrived.map(order => order.id));
          messages.push(locale === "ja" ? `新しいお題が${changes.arrived.length}件到着。「到着」のカードを追加しました。` : `${changes.arrived.length} new Order(s) arrived. Look for the New cards.`);
        }
        const failed = changes.finished.filter(order => orderDisplayState(order) === "failed").length;
        const completed = changes.finished.filter(order => orderDisplayState(order) === "completed").length;
        const expired = changes.finished.filter(order => orderDisplayState(order) === "expired").length;
        const voided = changes.finished.filter(order => orderDisplayState(order) === "voided").length;
        if (failed) messages.push(locale === "ja" ? `${failed}件が証明失敗で終了。` : `${failed} proof(s) failed.`);
        if (completed) messages.push(locale === "ja" ? `${completed}件完了。` : `${completed} completed.`);
        if (expired) messages.push(locale === "ja" ? `${expired}件が期限切れ。` : `${expired} expired.`);
        if (voided) messages.push(locale === "ja" ? `${voided}件がROTATEで無効になりました。` : `${voided} voided by ROTATE.`);
        announce({ text: messages.join(" ") });
        if (changes.finished.length) setRecent(current => [
          ...changes.finished.slice().reverse(),
          ...current.filter(order => !changes.finished.some(changed => changed.id === order.id)),
        ].slice(0, 3));
      }
    }
    previous.current = new Map(orders.map(order => [order.id, orderDisplayState(order)]));
  }, [projection.myContracts, locale]);

  useEffect(() => {
    if (!newIds.length) return;
    const timer = setTimeout(() => setNewIds([]), 15_000);
    return () => clearTimeout(timer);
  }, [newIds]);

  useEffect(() => {
    if (receipt) setReceipts(current => ({ ...current, [receipt.id]: receipt.points }));
  }, [receipt]);

  useEffect(() => {
    if (!announcement.text) return;
    const timer = setTimeout(() => announce({ clearVersion: announcement.version }), 15_000);
    return () => clearTimeout(timer);
  }, [announcement]);

  return <aside className="tc-order-queue" aria-label={locale === "ja" ? "お題一覧と締切" : "Orders and deadlines"}>
    <style>{ORDER_QUEUE_CSS}</style>
    <div className="tc-order-notice" role="status" aria-live="polite" aria-atomic="true">{announcement.text && <span key={announcement.version} data-announcement-version={announcement.version}>{announcement.text}</span>}</div>
    <div className="tc-order-open">
      <OrderBelt projection={projection} locale={locale} selectedId={selectedId} onSelect={onSelect} compact newIds={newIds} />
    </div>
    {recent.length > 0 && <ul className="tc-order-recent" aria-label={locale === "ja" ? "直近のお題の結果" : "Recent Order results"}>
      {recent.map(order => <li key={order.id} data-order-result={orderDisplayState(order)}>
        <strong>{orderResultLabel(order, locale)}</strong>
        <span>{order.id.replace(/^.*-c/, "ORDER #")} · {taskLabel(order.task, locale)}</span>
        {receipts[order.id] !== undefined && <b>+{receipts[order.id]} {locale === "ja" ? "点" : "pt"}</b>}
      </li>)}
    </ul>}
  </aside>;
}

export const ORDER_QUEUE_CSS = `
.tc-order-queue{position:sticky;top:8px;z-index:5;display:flex;flex-direction:column;background:#f6f8fb;border-radius:12px;box-shadow:0 4px 12px #1e3a5f14;max-height:48vh;overflow:hidden}
.tc-order-open{min-height:0;overflow:auto;scrollbar-gutter:stable;scroll-padding-block:36px 8px}
.tc-workspace,.tc-result-anchor{scroll-margin-top:calc(48vh + 24px)}
.tc-workspace :is(input,select,button,summary),.tc-hunt-workspace :is(input,select,button,summary){scroll-margin-top:calc(48vh + 64px);scroll-margin-bottom:64px}
.tc-order-notice{flex:none;font-size:13px;font-weight:650;line-height:1.45;color:#174e78;padding:6px 12px}.tc-order-notice:empty{display:none}
.tc-order-belt-compact{border:1px solid #b9cbe0;background:#fff;margin:0;padding:10px}
.tc-order-belt-compact .tc-section-label{position:sticky;top:0;z-index:1;background:#fff;font-size:12px;letter-spacing:0;margin-bottom:6px;padding:4px 0}
.tc-order-belt-compact .tc-order-row{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px;overflow:visible;padding:2px}
.tc-order-belt-compact .tc-order-card{min-width:0;padding:8px;border-width:2px;animation:none}
.tc-order-belt-compact .tc-order-top{gap:4px;flex-wrap:wrap;font-size:12px}.tc-order-belt-compact .tc-points{font-size:12px}.tc-order-belt-compact .tc-points-pass{font-size:11px}
.tc-order-belt-compact .tc-order-meta{font-size:12px;line-height:1.35;gap:3px;margin-top:3px}
.tc-order-belt-compact .tc-order-deadline{font-size:15px;font-weight:750;font-variant-numeric:tabular-nums}
.tc-order-belt-compact .tc-order-clock-state{display:flex;align-items:center;justify-content:space-between;gap:4px;flex-wrap:wrap}
.tc-order-belt-compact .tc-order-methods{display:none}.tc-order-belt-compact .tc-timer-track{height:3px;margin-top:5px}
.tc-order-belt-compact .tc-order-selected{background:#edf5ff;box-shadow:none}.tc-order-belt-compact .tc-order-clickable:focus-visible{outline:3px solid #245ea0;outline-offset:2px}
.tc-order-state{display:flex;align-items:center;gap:8px;font-size:11px}.tc-order-arrived{color:#174e78;background:#dceeff;border:1px solid #7aadd3;border-radius:4px;padding:0 5px}
.tc-order-recent{flex:none;list-style:none;margin:0;padding:5px 10px;display:flex;gap:6px;flex-wrap:wrap;font-size:12px}
.tc-order-recent li{display:flex;gap:5px;flex-wrap:wrap;align-items:center;padding:4px 6px;border:1px solid #a7cbb7;border-radius:6px;background:#f0fbf4}
.tc-order-recent li[data-order-result="expired"]{border-color:#d0b7a4;background:#fff7ef}.tc-order-recent li>span{max-width:230px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tc-order-recent li[data-order-result="voided"]{border-color:#a8bdd4;background:#eef4fc}
@media(max-width:600px){.tc-order-queue{top:0;max-height:42vh}.tc-workspace,.tc-result-anchor{scroll-margin-top:calc(42vh + 24px)}.tc-order-belt-compact .tc-order-row{grid-template-columns:repeat(2,minmax(0,1fr))}.tc-order-belt-compact{padding:6px}.tc-order-belt-compact .tc-order-card{padding:6px}.tc-order-belt-compact .tc-order-meta{font-size:11px}.tc-order-belt-compact .tc-order-deadline{font-size:13px}}
@media(max-width:1023px){.tc-order-queue{top:40px}.tc-workspace,.tc-result-anchor{scroll-margin-top:calc(48vh + 64px)}}
@media(max-height:520px){.tc-order-queue{max-height:28vh}.tc-workspace,.tc-result-anchor,.tc-workspace :is(input,select,button,summary),.tc-hunt-workspace :is(input,select,button,summary){scroll-margin-top:calc(28vh + 64px)}}
@media(prefers-reduced-motion:reduce){.tc-order-queue *{animation:none!important;transition:none!important;scroll-behavior:auto!important}}
`;
