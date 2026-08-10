/**
 * db-challenge-slow-query — automated grader (the primary evaluation).
 *
 * PURE and dependency-injected: it never opens a socket or runs EXPLAIN
 * itself. It drives an injected `client` that reads live database state:
 *
 *   client.ordersCustomerIdLeadsAnIndex()   -> boolean
 *   client.customerIdLeadingIndexNames()    -> Set<string>
 *   client.explainTargetQuery()             -> { nodeTypes: Set<string>,
 *                                                 seqScanRelations: Set<string>,
 *                                                 indexNamesUsed: Set<string>,
 *                                                 buffers: number }
 *   client.baselineBuffers()                -> number | null (captured once
 *                                                at container boot, red
 *                                                herring index already in
 *                                                place)
 *
 * Each of the 3 checkpoints below resolves to a `{ id, label, passed, detail }`
 * result, one per `scoring.checks[]` entry in metadata.json (same ids).
 * `/verify` grades ONE checkpoint per request (TenkaCloud#2252's checkpointId
 * contract); `evaluateCheckpoint` looks up the matching entry and runs it.
 *
 * ## Why this resists "just add any index" — and why NOT "avoids Seq Scan"
 *
 * `storefront.orders` is NOT bare — it already has
 * `idx_orders_status_customer` on `(status, customer_id)` (see
 * local/db/schema.sql), added by a fictional "previous engineer." A shallow
 * pass that just checks "does an index exist on this table?" would already
 * be true before the participant does anything, which would make the
 * checkpoint meaningless.
 *
 * Verified against a live Postgres 16 instance while authoring this
 * Challenge: it is NOT enough to check "the plan has no Seq Scan node"
 * either. The planner can, and does, choose the red herring for the target
 * query — even though `customer_id` is not its leading column — because
 * walking that (narrower) index end-to-end and checking `customer_id`
 * against each index tuple directly is genuinely cheaper than walking the
 * (wider) heap end-to-end. Postgres reports this as `Index Cond`, not
 * `Filter`, and no `Seq Scan` node ever appears — so "no Seq Scan" is
 * already true in the UNTOUCHED starting state, before any fix. That would
 * make `target-query-uses-customer-id-led-index` trivially pass from boot,
 * which is not a checkpoint at all.
 *
 * So this grader checks something more specific: not "did the plan avoid a
 * Seq Scan" but "did the plan use an index that ACTUALLY OPENS WITH
 * customer_id" — read off the plan's own `Index Name` and cross-referenced
 * against `pg_indexes`. Only a genuine fix (an index led by `customer_id`,
 * which lets the planner narrow the b-tree search itself instead of merely
 * filtering a full walk of the wrong one) can satisfy this. `buffers-
 * dramatically-reduced` then confirms the SAME conclusion with a real
 * measurement: the red herring alone measurably helps (via the mechanism
 * above), but nowhere near as much as a properly-led index — see
 * local/README.md's "Numbers behind the thresholds" for the actual measured
 * gap.
 */

const SEQ_SCAN = "Seq Scan";
const TARGET_RELATION = "orders";

export const CHECKS = [
  {
    id: "orders-customer-id-leads-an-index",
    label: "storefront.orders に customer_id を先頭に持つ index がある",
    async run(client) {
      const passed = await client.ordersCustomerIdLeadsAnIndex();
      const detail = passed
        ? "customer_id を先頭列とするインデックスが storefront.orders に実在する。"
        : "customer_id を先頭列とするインデックスがまだ見つからない。既存のインデックスがある" +
          "ことと、それがこのクエリに使えることは別問題であることを思い出そう。";
      return { passed, detail };
    },
  },
  {
    id: "target-query-uses-customer-id-led-index",
    label: "対象クエリの実行計画が customer_id を先頭に持つ index を実際に選んでいる",
    async run(client) {
      const [{ seqScanRelations, indexNamesUsed }, leadingNames] = await Promise.all([
        client.explainTargetQuery(),
        client.customerIdLeadingIndexNames(),
      ]);
      const seqScansOrders = seqScanRelations.has(TARGET_RELATION);
      const usedLeadingIndex = [...indexNamesUsed].some((name) => leadingNames.has(name));
      const passed = !seqScansOrders && usedLeadingIndex;
      const used = [...indexNamesUsed].join(", ") || "(none)";
      const detail = passed
        ? `実行計画は customer_id を先頭列とする index (${used}) を実際に使っている。`
        : `実行計画が使っている index (${used}) は customer_id を先頭列としていない ── 既存の` +
          "index が選ばれているように見えても、それが正しい列順とは限らない。";
      return { passed, detail };
    },
  },
  {
    id: "buffers-dramatically-reduced",
    label: "取得に必要なバッファ数が導入前より大きく減った",
    async run(client) {
      const [{ buffers }, baseline] = await Promise.all([
        client.explainTargetQuery(),
        client.baselineBuffers(),
      ]);
      if (baseline === null) {
        return { passed: false, detail: "baseline が未計測。コンテナを再起動してみよう。" };
      }
      // The floor and ratio here are deliberately less aggressive than
      // db-a2-index-tradeoff's max(50, baseline*0.1): the red herring
      // ALREADY buys a real (if partial) improvement over a true Seq Scan
      // (see this file's top comment), so baseline itself is already lower
      // than a from-scratch Seq Scan would be. A correctly-led single-column
      // index still clears this with room to spare; only the red herring
      // (or an equally wrong-order alternative) fails it. See local/README.md
      // for the measured numbers behind this choice.
      const threshold = Math.max(100, baseline * 0.3);
      const passed = buffers <= threshold;
      const detail = passed
        ? `導入前 ${baseline} buffers → 現在 ${buffers} buffers。`
        : `導入前 ${baseline} buffers → 現在 ${buffers} buffers。まだ改善が足りない (目標: ${Math.floor(threshold)} 以下)。`;
      return { passed, detail };
    },
  },
];

const CHECK_IDS = new Set(CHECKS.map((c) => c.id));

export function isKnownCheckpoint(checkpointId) {
  return CHECK_IDS.has(checkpointId);
}

/** Evaluate exactly one checkpoint (the multi-verify /verify contract grades one at a time). */
export async function evaluateCheckpoint(client, checkpointId) {
  const check = CHECKS.find((c) => c.id === checkpointId);
  if (!check) {
    return { correct: false, message: "unknown checkpoint" };
  }
  const { passed, detail } = await check.run(client);
  return { correct: passed, message: detail };
}
