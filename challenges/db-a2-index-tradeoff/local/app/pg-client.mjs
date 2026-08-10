/**
 * pg-client — the live Postgres adapter the grader drives inside the container.
 *
 * Connects as the `postgres` superuser (no tenant/authorization boundary in
 * this drill — the subject is index / query-plan trade-offs, not access
 * control) and implements the control surface grade.mjs expects.
 *
 * This file is the seam the unit tests replace with a fake; the grader logic
 * itself (grade.mjs) has no Postgres dependency.
 */

/** The fixed lookup every check evaluates — same query the participant runs. */
export const TARGET_ORDER_NUMBER = "ORD-00256789";
export const BASELINE_QUERY_ID = "order-number-lookup";

/**
 * Run EXPLAIN (ANALYZE, BUFFERS) for the target lookup and return every node
 * type that appears in the plan plus the total Shared Hit + Shared Read
 * blocks summed across the whole plan tree.
 *
 * Parallel workers are disabled for this specific query (`SET LOCAL
 * max_parallel_workers_per_gather = 0`, scoped to the probe's own transaction
 * only) so the plan tree is a single, easy-to-sum path regardless of how many
 * CPUs the container happens to have. This does not change which plan shape
 * the planner considers "cheapest" for a single-row equality lookup, only
 * whether it is allowed to split that one lookup across workers — the
 * participant's own un-restricted psql session may see a `Gather` wrapper the
 * grader does not, but the underlying lesson (Seq Scan vs. Index Scan) is the
 * same either way.
 */
async function explainTargetQuery(sql) {
  const rows = await sql.begin(async (tx) => {
    await tx.unsafe("set local max_parallel_workers_per_gather = 0");
    return tx`
      explain (analyze, buffers, format json)
      select * from shop.orders where order_number = ${TARGET_ORDER_NUMBER}
    `;
  });
  const plan = rows[0]["QUERY PLAN"][0].Plan;
  return { nodeTypes: collectNodeTypes(plan), buffers: sumBuffers(plan) };
}

function collectNodeTypes(node, acc = new Set()) {
  acc.add(node["Node Type"]);
  if (Array.isArray(node.Plans)) {
    for (const child of node.Plans) collectNodeTypes(child, acc);
  }
  return acc;
}

function sumBuffers(node) {
  let total = (node["Shared Hit Blocks"] ?? 0) + (node["Shared Read Blocks"] ?? 0);
  if (Array.isArray(node.Plans)) {
    for (const child of node.Plans) total += sumBuffers(child);
  }
  return total;
}

/** @param {import('postgres').Sql} sql */
export function createPgGraderClient(sql) {
  return {
    async orderNumberIndexExists() {
      const rows = await sql`
        select indexdef
        from pg_indexes
        where schemaname = 'shop' and tablename = 'orders'
      `;
      return rows.some((r) => /order_number/i.test(r.indexdef));
    },

    async explainTargetQuery() {
      return explainTargetQuery(sql);
    },

    async baselineBuffers() {
      const rows = await sql`
        select buffers from grading.baseline_buffers where query_id = ${BASELINE_QUERY_ID}
      `;
      return rows.length > 0 ? Number(rows[0].buffers) : null;
    },
  };
}

/**
 * Capture the "before any index" baseline exactly once, tied to the data on
 * disk rather than to any particular container run — so a later container
 * restart (with the participant's index already in place) reuses the
 * originally captured number instead of recomputing a now-meaningless one.
 * Safe to call on every boot: it is a no-op once the row exists.
 */
export async function ensureBaselineCaptured(sql) {
  const existing = await sql`
    select buffers from grading.baseline_buffers where query_id = ${BASELINE_QUERY_ID}
  `;
  if (existing.length > 0) return Number(existing[0].buffers);

  const { buffers } = await explainTargetQuery(sql);
  await sql`
    insert into grading.baseline_buffers (query_id, buffers)
    values (${BASELINE_QUERY_ID}, ${buffers})
    on conflict (query_id) do nothing
  `;
  return buffers;
}
