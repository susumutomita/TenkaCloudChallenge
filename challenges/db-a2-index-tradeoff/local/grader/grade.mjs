/**
 * db-a2-index-tradeoff — automated grader (the primary evaluation).
 *
 * PURE and dependency-injected: it never opens a socket or runs EXPLAIN
 * itself. It drives an injected `client` that reads live database state:
 *
 *   client.orderNumberIndexExists() -> boolean
 *   client.explainTargetQuery()     -> { nodeTypes: Set<string>, buffers: number }
 *   client.baselineBuffers()        -> number | null   (captured once at container boot)
 *
 * `explainTargetQuery` runs the SAME fixed lookup
 * (`select * from shop.orders where order_number = 'ORD-00256789'`) that the
 * participant runs themselves. `nodeTypes` is every "Node Type" appearing
 * anywhere in the EXPLAIN plan tree; `buffers` is Shared Hit + Shared Read
 * blocks summed across the whole tree.
 *
 * Each of the 3 checkpoints below resolves to a `{ id, label, passed, detail }`
 * result, one per `scoring.checks[]` entry in metadata.json (same ids).
 * `/verify` grades ONE checkpoint per request (TenkaCloud#2252's checkpointId
 * contract); `evaluateCheckpoint` looks up the matching entry and runs it.
 *
 * Why this shape: none of the three can be talked into passing. An index has
 * to actually exist on the right column, the planner has to actually choose
 * it for the fixed query (a planner is free not to — this is what makes the
 * check honest rather than a formality), and the buffer count the query
 * touches has to have genuinely collapsed relative to the pre-index baseline,
 * not just changed.
 */

const SEQ_SCAN = "Seq Scan";
const INDEX_NODE_TYPES = /Index/;

export const CHECKS = [
  {
    id: "order-number-index-exists",
    label: "shop.orders.order_number にインデックスがある",
    async run(client) {
      const passed = await client.orderNumberIndexExists();
      const detail = passed
        ? "shop.orders(order_number) を対象とするインデックスが実在する。"
        : "order_number を対象とするインデックスがまだ見つからない。CREATE INDEX から始めよう。";
      return { passed, detail };
    },
  },
  {
    id: "query-plan-avoids-seq-scan",
    label: "対象クエリの実行計画が Seq Scan を使わなくなった",
    async run(client) {
      const { nodeTypes } = await client.explainTargetQuery();
      const usesSeqScan = nodeTypes.has(SEQ_SCAN);
      const usesIndex = [...nodeTypes].some((t) => INDEX_NODE_TYPES.test(t));
      const passed = !usesSeqScan && usesIndex;
      const seen = [...nodeTypes].join(", ");
      const detail = passed
        ? `実行計画は index を使っている (Node Type: ${seen})。`
        : `実行計画がまだ Seq Scan を使っている、または index を使う形になっていない (Node Type: ${seen})。CREATE INDEX の後に ANALYZE も忘れずに。`;
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
      const threshold = Math.max(50, baseline * 0.1);
      const passed = buffers <= threshold;
      const detail = passed
        ? `index 追加前 ${baseline} buffers → 現在 ${buffers} buffers。`
        : `index 追加前 ${baseline} buffers → 現在 ${buffers} buffers。まだ改善が足りない (目標: ${Math.floor(threshold)} 以下)。`;
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
