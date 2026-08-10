/**
 * pg-client — the live Postgres adapter the grader drives inside the container.
 *
 * Connects as the `postgres` superuser (no tenant/authorization boundary in this
 * drill — the subject is dead-tuple/VACUUM behaviour, not access control) and
 * implements the control surface grade.mjs expects.
 *
 * This file is the seam the unit tests replace with a fake; the grader logic
 * itself (grade.mjs) has no Postgres dependency.
 */

/** The retention cutoff the participant is asked to enforce: DELETE every row
 * older than this, keep every row on/after it. Public, known ahead of time —
 * seed.sql deliberately puts a 2-year gap (2022 vs. 2024) around it so no
 * off-by-one on the WHERE clause can straddle the boundary. */
export const RETENTION_CUTOFF = "2023-01-01T00:00:00Z";
export const SEEDED_OLD_ROWS = 300_000;
export const SEEDED_RECENT_ROWS = 100_000;

/**
 * Live row counts split by the retention cutoff:
 *   oldRemaining    — rows with created_at < cutoff still in the table (should
 *                     reach 0 once the participant deletes them).
 *   recentRemaining — rows with created_at >= cutoff still in the table
 *                     (must stay exactly SEEDED_RECENT_ROWS — the bystander
 *                     set, same role gadget plays in db-a6-lock's
 *                     inventory.stock / db-a7-mvcc's mvcc.reference).
 */
async function currentRowCounts(sql) {
  const rows = await sql`
    select
      count(*) filter (where created_at < ${RETENTION_CUTOFF}) as old_remaining,
      count(*) filter (where created_at >= ${RETENTION_CUTOFF}) as recent_remaining
    from telemetry.events
  `;
  const row = rows[0];
  return {
    oldRemaining: Number(row?.old_remaining ?? 0),
    recentRemaining: Number(row?.recent_remaining ?? 0),
  };
}

/**
 * Read live table statistics for telemetry.events from pg_stat_user_tables:
 *   nLiveTup / nDeadTup — current live/dead tuple counts (n_dead_tup only
 *     drops when VACUUM actually reclaims; autovacuum is disabled on this
 *     table — see local/db/schema.sql — so it never shrinks on its own).
 *   nTupDel — a CUMULATIVE counter (never reset by VACUUM), used alongside
 *     audit.delete_log as a second, independent signal that genuine DELETE
 *     churn actually happened, not just that the table happens to look clean
 *     right now.
 */
async function currentEventStats(sql) {
  const rows = await sql`
    select n_live_tup, n_dead_tup, n_tup_del
    from pg_stat_user_tables
    where schemaname = 'telemetry' and relname = 'events'
  `;
  const row = rows[0];
  if (!row) return { nLiveTup: null, nDeadTup: null, nTupDel: null };
  return {
    nLiveTup: Number(row.n_live_tup),
    nDeadTup: Number(row.n_dead_tup),
    nTupDel: Number(row.n_tup_del),
  };
}

/**
 * Read the full audit.delete_log trail, oldest first. Every entry was written
 * automatically by the `audit.log_bulk_delete()` statement-level trigger
 * (local/db/schema.sql) — never by a participant INSERT (no INSERT grant on
 * this table) — so rows_deleted is an unforgeable fact about what a DELETE
 * statement actually removed, not self-reported data.
 */
async function currentDeleteLog(sql) {
  const rows = await sql`
    select rows_deleted, min_created_at, max_created_at, backend_pid, executed_at
    from audit.delete_log
    order by log_id asc
  `;
  return rows.map((r) => ({
    rowsDeleted: Number(r.rows_deleted),
    minCreatedAtMs: r.min_created_at === null ? null : new Date(r.min_created_at).getTime(),
    maxCreatedAtMs: r.max_created_at === null ? null : new Date(r.max_created_at).getTime(),
    backendPid: r.backend_pid,
    executedAtMs: new Date(r.executed_at).getTime(),
  }));
}

/**
 * Physical size of telemetry.events on disk (table + toast + indexes), in
 * bytes — what the "status" info page shows so a participant can watch it
 * (not) move without leaving the terminal. Never used by grade.mjs: physical
 * byte counts vary by Postgres build/page layout, so grading reads
 * pg_stat_user_tables and audit.delete_log instead, which are exact.
 */
async function currentRelationSizeBytes(sql) {
  const rows = await sql`select pg_total_relation_size('telemetry.events') as bytes`;
  return Number(rows[0]?.bytes ?? 0);
}

/** @param {import('postgres').Sql} sql */
export function createPgGraderClient(sql) {
  return {
    async rowCounts() {
      return currentRowCounts(sql);
    },
    async eventStats() {
      return currentEventStats(sql);
    },
    async deleteLog() {
      return currentDeleteLog(sql);
    },
    async relationSizeBytes() {
      return currentRelationSizeBytes(sql);
    },
  };
}
