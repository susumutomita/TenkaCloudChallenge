/**
 * db-a3-query-plan — automated grader (the primary evaluation).
 *
 * PURE and dependency-injected: it never opens a socket or runs EXPLAIN itself. It
 * drives an injected `client` that reads live database state:
 *
 *   client.statisticsCollected() -> boolean
 *   client.explainRareQuery()    -> { nodeTypes: Set<string>, planRows: number, actualRows: number }
 *   client.explainCommonQuery()  -> { nodeTypes: Set<string>, planRows: number, actualRows: number }
 *
 * Both `explain*` methods run the SAME two fixed lookups the participant runs
 * themselves — `select * from support.tickets where priority = 'urgent'` (rare,
 * ~0.017% of rows) and `... = 'normal'` (common, ~99.98% of rows) — against a table
 * whose index on `priority` already exists from the start (see local/db/schema.sql).
 * `planRows` is the planner's ESTIMATE of matching rows before running the query;
 * `actualRows` is the real count EXPLAIN ANALYZE measured while running it.
 *
 * Each of the 3 checkpoints below resolves to a `{ id, label, passed, detail }`
 * result, one per `scoring.checks[]` entry in metadata.json (same ids). `/verify`
 * grades ONE checkpoint per request (TenkaCloud#2252's checkpointId contract);
 * `evaluateCheckpoint` looks up the matching entry and runs it.
 *
 * Why this shape: none of the three can be talked into passing. Statistics have to
 * actually have been collected (checked from `pg_stat_user_tables`, not a
 * submission), the planner's OWN row estimate has to actually be close to reality
 * for both queries (not just "an index exists"), and the planner has to actually
 * pick different strategies for the two queries — an index-based plan for the rare
 * value, a plain Seq Scan for the common one — which is exactly the behaviour that
 * does NOT happen until real statistics exist (verified against a live Postgres 16
 * instance while authoring this drill; see README "Numbers behind the thresholds").
 */

/** How far the planner's estimate may be from reality (either direction) and still
 * count as "matches". 5x is generous — a freshly ANALYZEd table lands within ~1.2x
 * in practice, while the pre-ANALYZE default estimate is off by 19x-320x on this
 * seed, so this threshold has wide margin on both sides and is not sensitive to
 * small machine-to-machine sampling variance. */
const ESTIMATE_TOLERANCE = 5;

function estimateRatio(planRows, actualRows) {
  const a = Math.max(planRows, 1);
  const b = Math.max(actualRows, 1);
  return Math.max(a, b) / Math.min(a, b);
}

const SEQ_SCAN = "Seq Scan";
const INDEX_NODE_TYPES = /Index/;

function usesSeqScan(nodeTypes) {
  return nodeTypes.has(SEQ_SCAN);
}

function usesIndex(nodeTypes) {
  return [...nodeTypes].some((t) => INDEX_NODE_TYPES.test(t));
}

export const CHECKS = [
  {
    id: "table-statistics-collected",
    label: "support.tickets の統計 (ANALYZE) が更新されている",
    async run(client) {
      const passed = await client.statisticsCollected();
      const detail = passed
        ? "pg_stat_user_tables.last_analyze が記録されている — ANALYZE が実行済み。"
        : "pg_stat_user_tables.last_analyze が空のまま — まだ ANALYZE が実行されていない。`analyze support.tickets;` を試そう。";
      return { passed, detail };
    },
  },
  {
    id: "row-estimates-match-reality",
    label: "プランナの row estimate が実際の行数に近づいている",
    async run(client) {
      const [rare, common] = await Promise.all([
        client.explainRareQuery(),
        client.explainCommonQuery(),
      ]);
      const rareRatio = estimateRatio(rare.planRows, rare.actualRows);
      const commonRatio = estimateRatio(common.planRows, common.actualRows);
      const passed = rareRatio <= ESTIMATE_TOLERANCE && commonRatio <= ESTIMATE_TOLERANCE;
      const detail = passed
        ? `rare: 推定 ${rare.planRows} / 実際 ${rare.actualRows} 行、common: 推定 ${common.planRows} / 実際 ${common.actualRows} 行 — どちらも実測に近い。`
        : `rare: 推定 ${rare.planRows} / 実際 ${rare.actualRows} 行、common: 推定 ${common.planRows} / 実際 ${common.actualRows} 行 — 推定と実測が大きく乖離している (統計が古いままの可能性)。`;
      return { passed, detail };
    },
  },
  {
    id: "scan-strategy-matches-selectivity",
    label: "希少値は Index Scan、大多数を占める値は Seq Scan が選ばれている",
    async run(client) {
      const [rare, common] = await Promise.all([
        client.explainRareQuery(),
        client.explainCommonQuery(),
      ]);
      const rareOk = usesIndex(rare.nodeTypes) && !usesSeqScan(rare.nodeTypes);
      const commonOk = usesSeqScan(common.nodeTypes) && !usesIndex(common.nodeTypes);
      const passed = rareOk && commonOk;
      const rareSeen = [...rare.nodeTypes].join(", ");
      const commonSeen = [...common.nodeTypes].join(", ");
      const detail = passed
        ? `rare (urgent) は index を使う plan (${rareSeen})、common (normal) は Seq Scan (${commonSeen}) — 選択性で使い分けられている。`
        : `rare (urgent): ${rareSeen}${rareOk ? " (OK)" : " (期待は index scan、Seq Scan 無し)"} / common (normal): ${commonSeen}${commonOk ? " (OK)" : " (期待は Seq Scan のみ、index scan 無し)"}`;
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
