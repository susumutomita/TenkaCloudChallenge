/**
 * pg-client — the live Postgres adapter the grader drives inside the container.
 *
 * Connects as the `postgres` superuser (no tenant/authorization boundary in this
 * drill — the subject is planner behaviour, not access control) and implements the
 * control surface grade.mjs expects.
 *
 * This file is the seam the unit tests replace with a fake; the grader logic itself
 * (grade.mjs) has no Postgres dependency.
 */

/** The two fixed lookups every check evaluates — same queries the participant runs. */
export const RARE_VALUE = "urgent"; // ~50 / 300,000 rows (0.017%)
export const COMMON_VALUE = "normal"; // ~299,950 / 300,000 rows (99.98%)

/**
 * Run EXPLAIN (ANALYZE, BUFFERS) for `select * from support.tickets where priority =
 * $1` and return every "Node Type" in the plan tree plus the ROOT node's planner row
 * estimate ("Plan Rows") and the real row count it actually returned ("Actual Rows").
 *
 * Parallel workers are disabled for this probe (`SET LOCAL
 * max_parallel_workers_per_gather = 0`, scoped to the probe's own transaction only)
 * so the plan tree is a single, easy-to-read path regardless of how many CPUs the
 * container happens to have — see the identical rationale in
 * db-a2-index-tradeoff/local/app/pg-client.mjs. This does not change which plan
 * shape the planner considers cheapest, only whether it may split the scan across
 * workers.
 */
async function explainPriority(sql, value) {
  const rows = await sql.begin(async (tx) => {
    await tx.unsafe("set local max_parallel_workers_per_gather = 0");
    return tx`
      explain (analyze, buffers, format json)
      select * from support.tickets where priority = ${value}
    `;
  });
  const plan = rows[0]["QUERY PLAN"][0].Plan;
  return {
    nodeTypes: collectNodeTypes(plan),
    planRows: Number(plan["Plan Rows"]),
    actualRows: Number(plan["Actual Rows"]),
  };
}

function collectNodeTypes(node, acc = new Set()) {
  acc.add(node["Node Type"]);
  if (Array.isArray(node.Plans)) {
    for (const child of node.Plans) collectNodeTypes(child, acc);
  }
  return acc;
}

/** @param {import('postgres').Sql} sql */
export function createPgGraderClient(sql) {
  return {
    /**
     * Has the participant run ANALYZE (or VACUUM ANALYZE) on support.tickets at
     * least once since the table was seeded? `pg_stat_user_tables.last_analyze` is
     * only ever set by a completed ANALYZE — there is no way to fake this value
     * without actually running one. `last_autoanalyze` is deliberately not checked
     * here: autovacuum is disabled on this table (schema.sql) specifically so this
     * signal stays a manual action.
     */
    async statisticsCollected() {
      const rows = await sql`
        select last_analyze
        from pg_stat_user_tables
        where schemaname = 'support' and relname = 'tickets'
      `;
      return rows.length > 0 && rows[0].last_analyze !== null;
    },

    async explainRareQuery() {
      return explainPriority(sql, RARE_VALUE);
    },

    async explainCommonQuery() {
      return explainPriority(sql, COMMON_VALUE);
    },
  };
}
