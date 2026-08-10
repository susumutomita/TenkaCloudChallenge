/**
 * pg-client — the live Postgres adapter the grader drives inside the container.
 *
 * Connects as the `postgres` superuser (no tenant/authorization boundary in this
 * drill — the subject is lock/wait behaviour, not access control) and implements
 * the control surface grade.mjs expects.
 *
 * This file is the seam the unit tests replace with a fake; the grader logic
 * itself (grade.mjs) has no Postgres dependency.
 */

/** The fixed rows every check reads. widget is the row both sessions fight over;
 * gadget never takes part in anything and must stay untouched (a bystander, same
 * role carol plays in db-a4-transaction's bank.accounts). */
export const WIDGET_ID = 1;
export const GADGET_ID = 2;

/** Seed values from local/db/seed.sql. Public and known ahead of time — exactly
 * what the instructions tell the participant to work with, not a hidden answer. */
export const SEED_WIDGET_QTY = 300;
export const SEED_GADGET_QTY = 120;

/** Read widget's and gadget's CURRENT quantities. */
async function currentStockQuantities(sql) {
  const rows = await sql`
    select id, qty
    from inventory.stock
    where id in (${WIDGET_ID}, ${GADGET_ID})
  `;
  const byId = new Map(rows.map((r) => [r.id, Number(r.qty)]));
  return { widget: byId.get(WIDGET_ID) ?? null, gadget: byId.get(GADGET_ID) ?? null };
}

/**
 * Read the full audit.lock_wait_log trail for widget (stock_id = 1), oldest
 * first. Every entry was written automatically by the `audit.log_stock_update()`
 * trigger (local/db/schema.sql) — never by a participant INSERT — so backend_pid,
 * txid and stmt_started_at are unforgeable facts about what actually happened,
 * not self-reported data.
 *
 * committedAtMs comes from `pg_xact_commit_timestamp(txid)` — Postgres's own
 * record of when that transaction ACTUALLY committed — not from anything the
 * trigger captured itself (a trigger fires when its statement finishes, which
 * for the blocker in this drill is BEFORE it later runs `select pg_sleep(5)`
 * and only then commits; see local/db/schema.sql for why). null if Postgres has
 * no commit-timestamp record for that txid (not yet committed, or
 * track_commit_timestamp was off — local/entrypoint.sh turns it on).
 */
async function currentLockWaitLog(sql) {
  const rows = await sql`
    select
      backend_pid,
      txid::text as txid,
      stmt_started_at,
      pg_xact_commit_timestamp(txid) as committed_at
    from audit.lock_wait_log
    where stock_id = ${WIDGET_ID}
    order by log_id asc
  `;
  return rows.map((r) => ({
    backendPid: r.backend_pid,
    txid: r.txid,
    stmtStartedAtMs: new Date(r.stmt_started_at).getTime(),
    committedAtMs: r.committed_at === null ? null : new Date(r.committed_at).getTime(),
  }));
}

/** @param {import('postgres').Sql} sql */
export function createPgGraderClient(sql) {
  return {
    async stockQuantities() {
      return currentStockQuantities(sql);
    },
    async lockWaitLog() {
      return currentLockWaitLog(sql);
    },
  };
}
