/**
 * pg-client — the live Postgres adapter the grader drives inside the container.
 *
 * Connects as the `postgres` superuser (no tenant/authorization boundary in
 * this Challenge — the subject is index/query-plan diagnosis, not access
 * control) and implements the control surface grade.mjs expects.
 *
 * This file is the seam the unit tests replace with a fake; the grader logic
 * itself (grade.mjs) has no Postgres dependency.
 */

/** The fixed lookup every check evaluates — the same query the participant is
 * handed as "the endpoint that's slow" (see metadata.json instructions). Not
 * a secret: the participant runs this exact text themselves. */
export const TARGET_CUSTOMER_ID = 2500;
export const BASELINE_QUERY_ID = "customer-order-history-lookup";

/**
 * Run EXPLAIN (ANALYZE, BUFFERS) for the target order-history lookup and
 * return every node type appearing in the plan, the "Relation Name" of any
 * Seq Scan node, the "Index Name" of every index-based node the planner
 * actually chose, and the total Shared Hit + Shared Read blocks for the
 * WHOLE query (read from the root node only — see totalBuffers() below for
 * why summing every node would be wrong here).
 *
 * ## Why "Index Name", not just "no Seq Scan"
 *
 * Verified against a live Postgres 16 instance while authoring this
 * Challenge: the planner can — and does — choose the pre-existing red
 * herring (`idx_orders_status_customer`, on `(status, customer_id)`) for
 * this exact query, EVEN THOUGH `customer_id` is not its leading column. It
 * does this because a full walk of that (narrower) index, checking
 * `customer_id` against each index tuple directly, is genuinely cheaper
 * than a full walk of the (wider) heap — Postgres shows this as
 * `Index Cond: (customer_id = 2500)`, not `Filter`, and it never produces a
 * `Seq Scan` node at all. So "does the plan avoid Seq Scan" is NOT
 * sufficient proof of a real fix here — it is already true in the untouched
 * starting state. What actually distinguishes a real fix is WHICH index the
 * plan used: only an index genuinely LED by `customer_id` lets the planner
 * narrow the b-tree search itself, rather than just cheaply filtering a full
 * walk of the wrong one.
 *
 * Parallel workers are disabled for this probe (`SET LOCAL
 * max_parallel_workers_per_gather = 0`, scoped to the probe's own transaction
 * only) so the plan shape (and therefore which index gets chosen) stays
 * stable regardless of how many CPUs the container happens to have — same
 * rationale as db-a2-index-tradeoff's identical probe.
 */
async function explainTargetQuery(sql) {
  const rows = await sql.begin(async (tx) => {
    await tx.unsafe("set local max_parallel_workers_per_gather = 0");
    return tx`
      explain (analyze, buffers, format json)
      select id, status, total_cents, created_at
      from storefront.orders
      where customer_id = ${TARGET_CUSTOMER_ID}
      order by created_at desc
      limit 20
    `;
  });
  const plan = rows[0]["QUERY PLAN"][0].Plan;
  return {
    nodeTypes: collectNodeTypes(plan),
    seqScanRelations: collectSeqScanRelations(plan),
    indexNamesUsed: collectIndexNamesUsed(plan),
    buffers: totalBuffers(plan),
  };
}

function collectNodeTypes(node, acc = new Set()) {
  acc.add(node["Node Type"]);
  if (Array.isArray(node.Plans)) {
    for (const child of node.Plans) collectNodeTypes(child, acc);
  }
  return acc;
}

function collectSeqScanRelations(node, acc = new Set()) {
  if (node["Node Type"] === "Seq Scan" && typeof node["Relation Name"] === "string") {
    acc.add(node["Relation Name"]);
  }
  if (Array.isArray(node.Plans)) {
    for (const child of node.Plans) collectSeqScanRelations(child, acc);
  }
  return acc;
}

function collectIndexNamesUsed(node, acc = new Set()) {
  if (typeof node["Index Name"] === "string") {
    acc.add(node["Index Name"]);
  }
  if (Array.isArray(node.Plans)) {
    for (const child of node.Plans) collectIndexNamesUsed(child, acc);
  }
  return acc;
}

/**
 * Total Shared Hit + Shared Read blocks for the WHOLE query.
 *
 * Deliberately reads only the ROOT node's own Buffers, not a sum over every
 * node in the tree. Postgres's EXPLAIN (ANALYZE, BUFFERS) reports each
 * node's Buffers (like its Actual Total Time) as CUMULATIVE — already
 * including every descendant's buffer usage — which db-a2-index-tradeoff's
 * identical-looking helper never had to account for (that query's plan is
 * always a single node, Seq Scan or Index Scan, with no Sort/Limit wrapper).
 * This Challenge's target query has `order by ... limit 20`, so its plan is
 * `Limit -> Sort -> <scan>` — summing every node's cumulative count would
 * count the scan's buffers 2–3 times over. Verified against a live Postgres
 * 16 instance while authoring this Challenge (the naive sum-every-node
 * version reported ~1160 buffers for a query whose root node actually
 * reported 389).
 */
function totalBuffers(node) {
  return (node["Shared Hit Blocks"] ?? 0) + (node["Shared Read Blocks"] ?? 0);
}

/** @param {import('postgres').Sql} sql */
export function createPgGraderClient(sql) {
  return {
    /**
     * Does any index on storefront.orders have `customer_id` as its LEADING
     * (first) column? Deliberately NOT "does an index merely mention
     * customer_id anywhere" — the red herring mentions it too, as the SECOND
     * column. Matching only "the column list opens with customer_id" is what
     * distinguishes a real fix from the red herring already sitting in the
     * table.
     */
    async ordersCustomerIdLeadsAnIndex() {
      const names = await this.customerIdLeadingIndexNames();
      return names.size > 0;
    },

    /** The set of index NAMES on storefront.orders whose column list opens
     * with customer_id — used to check not just "does such an index exist"
     * but "is the SPECIFIC index the planner chose one of them" (see
     * explainTargetQuery's file comment for why existence alone is not
     * enough against this Challenge's red herring). */
    async customerIdLeadingIndexNames() {
      const rows = await sql`
        select indexname, indexdef
        from pg_indexes
        where schemaname = 'storefront' and tablename = 'orders'
      `;
      return new Set(
        rows.filter((r) => /\(\s*customer_id\b/i.test(r.indexdef)).map((r) => r.indexname),
      );
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
 * Capture the "before any fix" baseline exactly once, tied to the data on
 * disk rather than to any particular container run — a later container
 * restart (with the participant's fix already in place) reuses the
 * originally captured number instead of recomputing a now-meaningless one.
 * Safe to call on every boot: it is a no-op once the row exists. Same pattern
 * as db-a2-index-tradeoff's identical helper.
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
