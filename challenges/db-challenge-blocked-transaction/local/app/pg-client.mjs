/**
 * pg-client — the live Postgres adapter the grader drives inside the container.
 *
 * Connects as the `postgres` superuser (no tenant/authorization boundary for
 * grading itself — the subject is lock diagnosis, not access control) and
 * implements the control surface grade.mjs expects.
 *
 * This file is the seam the unit tests replace with a fake; the grader logic
 * itself (grade.mjs) has no Postgres dependency.
 */

/** The one row the incident ever touches. Public and known ahead of time —
 * exactly what the instructions tell the participant (see metadata.json). */
export const ACCOUNT_ID = 1;
export const SEED_BALANCE_CENTS = 100000;
export const BLOCKER_DEBIT_CENTS = 10000;
export const WAITER_DEBIT_CENTS = 5000;
export const EXPECTED_RESOLVED_BALANCE_CENTS = SEED_BALANCE_CENTS - WAITER_DEBIT_CENTS; // 95000

/** Read account 1's CURRENT balance. */
async function currentBalanceCents(sql) {
  const rows = await sql`select balance_cents from app.accounts where id = ${ACCOUNT_ID}`;
  return rows.length > 0 ? Number(rows[0].balance_cents) : null;
}

/**
 * Read the full audit.incident_log trail, oldest first. Every entry was
 * written by the trusted Node app (server.mjs) itself — never by
 * participant SQL, never by a trigger on app.accounts (the incident's writes
 * come from a leaked connection and a retry loop, not from DML the
 * participant can hook) — so it is not something a participant can forge by
 * running SQL of their own. See local/db/schema.sql for the grant boundary
 * (`participant` gets SELECT only on `audit.incident_log`).
 */
async function currentIncidentLog(sql) {
  const rows = await sql`
    select event, backend_pid, logged_at
    from audit.incident_log
    order by log_id asc
  `;
  return rows.map((r) => ({
    event: r.event,
    backendPid: r.backend_pid === null ? null : Number(r.backend_pid),
    loggedAtMs: new Date(r.logged_at).getTime(),
  }));
}

/** Is a given backend pid still an active Postgres backend right now? */
async function backendIsActive(sql, pid) {
  const rows = await sql`select 1 from pg_stat_activity where pid = ${pid}`;
  return rows.length > 0;
}

/** @param {import('postgres').Sql} sql */
export function createPgGraderClient(sql) {
  return {
    async accountBalanceCents() {
      return currentBalanceCents(sql);
    },

    /**
     * true  = the ORIGINAL leaked/blocking backend (recorded once, at the
     *         moment the incident started) is still alive right now — the
     *         participant has not resolved it yet.
     * false = a blocker was recorded and that exact backend pid is no
     *         longer an active Postgres backend (participant genuinely
     *         terminated it, or it otherwise ended).
     * null  = no blocker was ever recorded (should not happen once the app
     *         has booted, but the grader must not crash on it).
     */
    async originalBlockerStillActive() {
      const log = await currentIncidentLog(sql);
      const opened = log.find((e) => e.event === "blocker-opened");
      if (!opened || opened.backendPid === null) return null;
      return backendIsActive(sql, opened.backendPid);
    },

    /**
     * Elapsed milliseconds between the LAST "waiter-attempt-started" entry
     * before the (single) "waiter-attempt-completed" entry, and that
     * completion — i.e. how long the write that finally succeeded was
     * actually pending. null if the write has never completed yet.
     *
     * Both events come from the SAME trusted app code path (server.mjs's
     * retry loop): "started" is logged right before the UPDATE is issued,
     * "completed" only after it actually returns. Nothing about this timing
     * is participant-controlled (unlike A6's grader, which has to defend
     * against a PARTICIPANT embedding pg_sleep() in their own statement —
     * here the write is never something the participant runs themselves).
     * A near-zero gap can therefore only mean the write was never really
     * blocked on anything, i.e. "there was never really a problem".
     */
    async waiterWaitMs() {
      const log = await currentIncidentLog(sql);
      const completed = [...log].reverse().find((e) => e.event === "waiter-attempt-completed");
      if (!completed) return null;
      const startedBefore = log
        .filter((e) => e.event === "waiter-attempt-started" && e.loggedAtMs <= completed.loggedAtMs)
        .at(-1);
      if (!startedBefore) return null;
      return completed.loggedAtMs - startedBefore.loggedAtMs;
    },
  };
}
