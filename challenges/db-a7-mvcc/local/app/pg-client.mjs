/**
 * pg-client — the live Postgres adapter the grader drives inside the container.
 *
 * Connects as the `postgres` superuser (no tenant/authorization boundary in this
 * drill — the subject is row-versioning and dead-tuple behaviour, not access
 * control) and implements the control surface grade.mjs expects.
 *
 * This file is the seam the unit tests replace with a fake; the grader logic
 * itself (grade.mjs) has no Postgres dependency.
 */

/** The bystander row that never takes part in this drill's churn or the
 * long-transaction demo — same role gadget plays in db-a6-lock's
 * inventory.stock. Public, known ahead of time. */
export const REFERENCE_ID = 1;
export const SEED_REFERENCE_NOTE = "do-not-touch";

/** Read mvcc.reference's current note. */
async function currentReferenceNote(sql) {
  const rows = await sql`select note from mvcc.reference where id = ${REFERENCE_ID}`;
  return rows[0]?.note ?? null;
}

/**
 * Read live table statistics for mvcc.tickets from pg_stat_user_tables:
 *   nLiveTup / nDeadTup — current live/dead tuple counts (n_dead_tup only
 *     drops when VACUUM actually reclaims; autovacuum is disabled on this
 *     table — see local/db/schema.sql — so it never shrinks on its own).
 *   nTupUpd / nTupDel — CUMULATIVE counters (never reset by VACUUM), used as
 *     proof that genuine UPDATE/DELETE churn actually happened, not just that
 *     the table happens to look clean right now.
 */
async function currentTicketStats(sql) {
  const rows = await sql`
    select n_live_tup, n_dead_tup, n_tup_upd, n_tup_del
    from pg_stat_user_tables
    where schemaname = 'mvcc' and relname = 'tickets'
  `;
  const row = rows[0];
  if (!row) return { nLiveTup: null, nDeadTup: null, nTupUpd: null, nTupDel: null };
  return {
    nLiveTup: Number(row.n_live_tup),
    nDeadTup: Number(row.n_dead_tup),
    nTupUpd: Number(row.n_tup_upd),
    nTupDel: Number(row.n_tup_del),
  };
}

/**
 * Read the full audit.churn_log trail, oldest first. Every entry was written
 * automatically by the `audit.log_churn()` trigger (local/db/schema.sql) —
 * never by a participant INSERT — so backend_pid, logged_at and
 * concurrent_long_tx_started_at are unforgeable facts about what actually
 * happened, not self-reported data.
 *
 * concurrent_long_tx_started_at is null when no OTHER `participant` backend
 * was sitting "idle in transaction" at the moment of that specific write —
 * i.e. no long-running transaction was open elsewhere at the time.
 */
async function currentChurnLog(sql) {
  const rows = await sql`
    select ticket_id, op, backend_pid, logged_at, concurrent_long_tx_started_at
    from audit.churn_log
    order by log_id asc
  `;
  return rows.map((r) => ({
    ticketId: r.ticket_id,
    op: r.op,
    backendPid: r.backend_pid,
    loggedAtMs: new Date(r.logged_at).getTime(),
    concurrentLongTxStartedAtMs:
      r.concurrent_long_tx_started_at === null ? null : new Date(r.concurrent_long_tx_started_at).getTime(),
  }));
}

/** @param {import('postgres').Sql} sql */
export function createPgGraderClient(sql) {
  return {
    async referenceNote() {
      return currentReferenceNote(sql);
    },
    async ticketStats() {
      return currentTicketStats(sql);
    },
    async churnLog() {
      return currentChurnLog(sql);
    },
  };
}
