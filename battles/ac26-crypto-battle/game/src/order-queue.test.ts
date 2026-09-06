import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import OrderQueue, { orderChanges, orderDisplayState } from "../../portal/OrderQueue.tsx";
import { applyOp, initialState, projectForTeam, tick } from "./reducer.ts";
import type { ContractProjection } from "./types.ts";

const context = { eventId: "order-queue", teamIds: ["a", "b"], matchSecret: "queue-regression" };
const started = () => applyOp(initialState(context), "a", { kind: "start" });
const states = (orders: readonly ContractProjection[]) => new Map(orders.map(order => [order.id, orderDisplayState(order)]));

describe("always-visible Order queue", () => {
  test("the real follow-up batch exposes six selectable cards, deadlines and selection without a disclosure", () => {
    const first = started();
    const served = applyOp(first, "a", { kind: "leak", contractId: "a-c0" });
    const projection = projectForTeam(tick(served, 60_000), "a");
    const html = renderToStaticMarkup(createElement(OrderQueue, {
      projection, locale: "ja", selectedId: "a-c1", onSelect: () => {},
    }));
    expect(html.match(/data-order-id=/g)).toHaveLength(6);
    expect(html.match(/role="button"/g)).toHaveLength(6);
    expect(html.match(/tabindex="0"/g)).toHaveLength(6);
    expect(html).toContain("未処理 6 件");
    expect(html).toContain("✓ 選択中");
    expect(html.match(/aria-pressed="true"/g)).toHaveLength(1);
    expect(html.match(/class="tc-order-deadline"/g)).toHaveLength(6);
    expect(html).not.toContain("<details");
    expect(html).toContain('aria-live="polite"');
  });

  test("announces batch arrivals and confirmed completion but not countdown ticks", () => {
    const first = started();
    const before = projectForTeam(first, "a").myContracts;
    const next = projectForTeam(tick(first, 60_000), "a").myContracts;
    expect(orderChanges(states(before), next).arrived).toHaveLength(6);
    expect(orderChanges(states(next), next.map(order => ({ ...order, remainingMs: order.remainingMs - 1000 })))).toEqual({ arrived: [], finished: [] });
    const served = projectForTeam(applyOp(first, "a", { kind: "leak", contractId: "a-c0" }), "a").myContracts;
    expect(orderChanges(states(before), served).finished.map(order => order.id)).toEqual(["a-c0"]);
    expect(orderDisplayState(served[0]!)).toBe("completed");
  });

  test("a deadline ending between polls is expired once, and never a newly arrived card", () => {
    const order = projectForTeam(started(), "a").myContracts[0]!;
    const localExpiry = { ...order, remainingMs: 0 };
    expect(orderDisplayState(localExpiry)).toBe("expired");
    expect(orderChanges(states([order]), [localExpiry]).finished).toEqual([localExpiry]);
    const confirmed = { ...localExpiry, status: "expired" as const };
    expect(orderChanges(states([localExpiry]), [confirmed])).toEqual({ arrived: [], finished: [] });
    expect(orderChanges(new Map(), [confirmed])).toEqual({ arrived: [], finished: [] });
  });
});
