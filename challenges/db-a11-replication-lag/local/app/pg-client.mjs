/**
 * pg-client — the live Postgres adapter the grader (and the background lag
 * sampler) drive inside the primary container.
 *
 * Connects as the `postgres` superuser (no tenant/authorization boundary in
 * this drill — the subject is replication lag, not access control) and
 * implements the control surface grade.mjs expects, plus the sampler that
 * keeps writing to `audit.lag_samples` for the whole container lifetime.
 *
 * This file is the seam the unit tests replace with fakes; the grader logic
 * itself (grade.mjs) has no Postgres dependency.
 */

/**
 * Read pg_stat_replication from the PRIMARY — same shape as
 * db-a10-primary-replica/local/app/pg-client.mjs's currentReplicationRows,
 * used here only for the baseline "is the topology actually up" checkpoint
 * (this drill's real subject is the lag HISTORY, not this live snapshot).
 */
async function currentReplicationRows(sql) {
  const rows = await sql`
    select application_name, state, sync_state
    from pg_stat_replication
  `;
  return rows.map((r) => ({
    applicationName: r.application_name,
    state: r.state,
    syncState: r.sync_state,
  }));
}

/** Read recovery/wal-receiver state from the REPLICA — same shape as A10's. */
async function currentReplicaRecovery(sql) {
  const [recoveryRows, receiverRows] = await Promise.all([
    sql`select pg_is_in_recovery() as in_recovery`,
    sql`select status from pg_stat_wal_receiver`,
  ]);
  return {
    inRecovery: recoveryRows[0]?.in_recovery === true,
    walReceiverStatus: receiverRows[0]?.status ?? null,
  };
}

/**
 * Append one row to audit.lag_samples with the CURRENT replay_lag from
 * pg_stat_replication, in seconds. Pure `INSERT ... SELECT`: if
 * pg_stat_replication has no row yet (replica not connected — e.g. still
 * bootstrapping), the SELECT returns 0 rows and the INSERT is a no-op, no
 * special-casing needed here.
 *
 * Called on a timer (see startLagSampler) rather than only when /verify is
 * hit: confirmed on a real Postgres 16 instance that replay_lag is a STALE
 * value between applies (it only updates when the standby reports having
 * applied something new), so a spike caused by `recovery_min_apply_delay` is
 * only visible for the instant the delayed record finally lands — a sampler
 * polling every ~1s is what actually catches it; an on-demand query at
 * /verify time could easily land in a stale gap and miss it entirely.
 */
async function recordLagSample(sql) {
  await sql`
    insert into audit.lag_samples (replay_lag_seconds)
    select extract(epoch from replay_lag) from pg_stat_replication
  `;
}

/**
 * Read the full audit.lag_samples history, oldest first. Every row was
 * written by the sampler above (a privileged connection `participant` cannot
 * write to — no INSERT grant on this table), so it is a durable, unforgeable
 * record of what replay_lag actually was over time, including moments
 * between /verify calls.
 */
async function currentLagSamples(sql) {
  const rows = await sql`
    select sample_id, sampled_at, replay_lag_seconds
    from audit.lag_samples
    order by sample_id asc
  `;
  return rows.map((r) => ({
    sampleId: Number(r.sample_id),
    sampledAtMs: new Date(r.sampled_at).getTime(),
    replayLagSeconds: r.replay_lag_seconds === null ? null : Number(r.replay_lag_seconds),
  }));
}

/**
 * Start the background sampler. Runs for the whole process lifetime (the
 * primary container never restarts the Node app mid-session) — best-effort:
 * a single failed sample (e.g. queried during a brief reconnect) is silently
 * skipped rather than crashing the server, since missing one 1-second sample
 * out of hundreds costs this drill nothing.
 *
 * @param {import('postgres').Sql} sqlPrimary
 * @param {number} intervalMs
 * @returns {() => void} stop function (unused in production, present for tests)
 */
export function startLagSampler(sqlPrimary, intervalMs = 1000) {
  const timer = setInterval(() => {
    recordLagSample(sqlPrimary).catch(() => {});
  }, intervalMs);
  if (typeof timer.unref === "function") timer.unref();
  return () => clearInterval(timer);
}

/**
 * @param {import('postgres').Sql} sqlPrimary
 * @param {import('postgres').Sql} sqlReplica
 */
export function createPgGraderClient(sqlPrimary, sqlReplica) {
  return {
    async replicationRows() {
      return currentReplicationRows(sqlPrimary);
    },
    async replicaRecovery() {
      return currentReplicaRecovery(sqlReplica);
    },
    async lagSamples() {
      return currentLagSamples(sqlPrimary);
    },
  };
}
