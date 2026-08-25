/**
 * pg-client — the live Postgres (+ order API) adapter for db-battle-slow-apparently.
 *
 * Connects as the `postgres` superuser (no tenant/authorization boundary is
 * this Battle's subject — production diagnosis is) and:
 *
 *   1. Runs a background sampler (startMetricsSampler) that writes ONE row to
 *      `audit.metrics_samples` roughly every second, for the whole container
 *      lifetime. This is the durable, participant-unwritable history every
 *      checkpoint in local/grader/grade.mjs actually reads — not a live
 *      snapshot taken the instant /verify happens to be called. See
 *      db-a11-replication-lag's identical rationale: a transient spike
 *      between polls would otherwise be invisible.
 *   2. Implements the read-only control surface grade.mjs expects.
 *   3. Records Phase 1 /diagnosis submissions (see server.mjs).
 *
 * This file is the seam the unit tests (grade.test.mjs) replace with a fake;
 * grade.mjs itself has no Postgres or fetch dependency.
 */

/** The `postgres` driver returns a DATE column as a JS Date (midnight UTC),
 * not a string — normalize to plain 'YYYY-MM-DD' everywhere a cutoff/date is
 * read, so grade.mjs's lexicographic string comparisons stay correct. */
function toIsoDate(value) {
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
}

const ALL_PARTITIONS = [
  "orders_2024_01",
  "orders_2024_02",
  "orders_2024_03",
  "orders_2024_04",
  "orders_2024_05",
  "orders_2024_06",
  "orders_2024_07",
];

async function fetchApiMetrics(apiMetricsUrl) {
  try {
    const res = await fetch(apiMetricsUrl, { signal: AbortSignal.timeout(2000) });
    if (!res.ok) return { p99Ms: null, errorRate: 1 };
    const body = await res.json();
    return { p99Ms: body.p99Ms ?? null, errorRate: typeof body.errorRate === "number" ? body.errorRate : 1 };
  } catch {
    // Cannot even reach the api — treat as a full outage sample, not a gap.
    return { p99Ms: null, errorRate: 1 };
  }
}

async function currentReplicationState(sqlPrimary) {
  const rows = await sqlPrimary`select extract(epoch from replay_lag) as lag from pg_stat_replication`;
  if (rows.length === 0) return { connected: false, replayLagSeconds: null };
  return { connected: true, replayLagSeconds: rows[0].lag === null ? null : Number(rows[0].lag) };
}

async function postmasterStartTime(sql) {
  try {
    const [row] = await sql`select pg_postmaster_start_time() as t`;
    return row.t;
  } catch {
    return null;
  }
}

async function longestRetentionTxnSeconds(sqlPrimary) {
  const rows = await sqlPrimary`
    select extract(epoch from clock_timestamp() - xact_start) as age
    from pg_stat_activity
    where application_name = 'retention-worker' and xact_start is not null
    order by age desc
    limit 1
  `;
  return rows.length > 0 ? Number(rows[0].age) : null;
}

async function currentPartitionRowCount(sqlPrimary) {
  const [row] = await sqlPrimary`select count(*)::int as n from commerce.orders_current`;
  return row.n;
}

// ---------------------------------------------------------------------------
// Replica apply throttling, tied to REAL observed retention-worker activity.
//
// A modest bulk DELETE's raw WAL volume replays on a modern disk in well
// under a second regardless of how slowly the PRIMARY produced it (physical
// streaming replication ships and replays raw block changes, not the SQL
// that produced them) — confirmed empirically while authoring this Battle.
// At the row counts this lab can seed without asking for a genuinely huge
// dataset, that means a bulk DELETE alone does not reliably produce
// measurable replication lag on ordinary developer hardware, even under a
// tight cpu limit.
//
// So this models what a genuinely capacity-constrained managed replica does
// under sustained heavy write load: once the retention-worker's transaction
// has been open for more than GRACE_SECONDS (long enough that a normal,
// catalog-only partition_aware run — sub-second — never trips it), the
// sampler dials the REPLICA's real `recovery_min_apply_delay` up via
// `ALTER SYSTEM` (the exact mechanism db-a11-replication-lag's drill teaches,
// here driven by the scenario instead of by the participant), and dials it
// back to 0 the instant that transaction is no longer active. The resulting
// `pg_stat_replication.replay_lag` participants observe is a completely real
// Postgres measurement of a real, if scenario-triggered, apply delay — not a
// synthesized number. See the PR description's Validation section for the
// measured effect.
const RETENTION_LAG_GRACE_SECONDS = 3;
const RETENTION_LAG_DELAY = "3s";
let replicaDelayActive = false;

async function setReplicaApplyDelay(sqlReplica, enabled) {
  if (enabled === replicaDelayActive) return;
  try {
    await sqlReplica.unsafe(`alter system set recovery_min_apply_delay = '${enabled ? RETENTION_LAG_DELAY : "0"}'`);
    await sqlReplica`select pg_reload_conf()`;
    replicaDelayActive = enabled;
  } catch {
    // Replica may not be reachable yet (still bootstrapping) — next tick retries.
  }
}

async function recordSample(sqlPrimary, sqlReplica, apiMetricsUrl) {
  const [replication, primaryStart, replicaStart, longTxn, currentCount, apiMetrics] = await Promise.all([
    currentReplicationState(sqlPrimary),
    postmasterStartTime(sqlPrimary),
    postmasterStartTime(sqlReplica),
    longestRetentionTxnSeconds(sqlPrimary),
    currentPartitionRowCount(sqlPrimary),
    fetchApiMetrics(apiMetricsUrl),
  ]);
  await setReplicaApplyDelay(sqlReplica, longTxn !== null && longTxn > RETENTION_LAG_GRACE_SECONDS);
  await sqlPrimary`
    insert into audit.metrics_samples (
      api_p99_ms, api_error_rate, replication_connected, replay_lag_seconds,
      primary_start_time, replica_start_time, long_txn_seconds,
      retention_worker_state, current_partition_row_count
    ) values (
      ${apiMetrics.p99Ms}, ${apiMetrics.errorRate}, ${replication.connected}, ${replication.replayLagSeconds},
      ${primaryStart}, ${replicaStart}, ${longTxn},
      ${longTxn !== null ? "running" : "idle"}, ${currentCount}
    )
  `;
}

/**
 * @param {import('postgres').Sql} sqlPrimary
 * @param {import('postgres').Sql} sqlReplica
 * @param {string} apiMetricsUrl
 * @param {number} intervalMs
 */
export function startMetricsSampler(sqlPrimary, sqlReplica, apiMetricsUrl, intervalMs = 1000) {
  // Re-entrancy guard: confirmed on this Battle's own Docker stack that
  // WITHOUT this, a single slow tick (e.g. the replica still bootstrapping,
  // so postmasterStartTime()/currentReplicationState() hang toward their
  // timeout) lets the NEXT tick start before it finishes. The two then race
  // to `insert`, and `sample_id` (assigned at commit time) stops matching
  // chronological order — grade.mjs's checks read history strictly by
  // `sample_id asc`, so an out-of-order pair can misrepresent a monotonic
  // count as having dipped, or fabricate an isolated false-disconnect blip
  // out of two ticks' interleaved reads. Skipping an overlapping tick
  // entirely (rather than queueing it) is fine — the next tick a second
  // later covers it.
  let sampling = false;
  const timer = setInterval(() => {
    if (sampling) return;
    sampling = true;
    recordSample(sqlPrimary, sqlReplica, apiMetricsUrl)
      .catch((err) => {
        console.error("[sampler] failed:", err?.message ?? err);
      })
      .finally(() => {
        sampling = false;
      });
  }, intervalMs);
  if (typeof timer.unref === "function") timer.unref();
  return () => clearInterval(timer);
}

async function metricsSamples(sqlPrimary) {
  const rows = await sqlPrimary`
    select sample_id, sampled_at, api_p99_ms, api_error_rate, replication_connected,
           replay_lag_seconds, primary_start_time, replica_start_time, long_txn_seconds,
           retention_worker_state, current_partition_row_count
    from audit.metrics_samples
    order by sample_id asc
  `;
  return rows.map((r) => ({
    sampleId: Number(r.sample_id),
    sampledAtMs: new Date(r.sampled_at).getTime(),
    apiP99Ms: r.api_p99_ms === null ? null : Number(r.api_p99_ms),
    apiErrorRate: r.api_error_rate === null ? null : Number(r.api_error_rate),
    replicationConnected: r.replication_connected,
    replayLagSeconds: r.replay_lag_seconds === null ? null : Number(r.replay_lag_seconds),
    primaryStartTimeMs: r.primary_start_time ? new Date(r.primary_start_time).getTime() : null,
    replicaStartTimeMs: r.replica_start_time ? new Date(r.replica_start_time).getTime() : null,
    longTxnSeconds: r.long_txn_seconds === null ? null : Number(r.long_txn_seconds),
    retentionWorkerState: r.retention_worker_state,
    currentPartitionRowCount: Number(r.current_partition_row_count),
  }));
}

async function incidentEpisodes(sqlPrimary) {
  const rows = await sqlPrimary`
    select episode_id, backend_pid, strategy, cutoff_date, partitions, started_at, ended_at, outcome
    from audit.incident_log
    order by episode_id asc
  `;
  return rows.map((r) => ({
    episodeId: Number(r.episode_id),
    backendPid: r.backend_pid,
    strategy: r.strategy,
    cutoffDate: toIsoDate(r.cutoff_date),
    partitions: r.partitions,
    startedAtMs: new Date(r.started_at).getTime(),
    endedAtMs: r.ended_at ? new Date(r.ended_at).getTime() : null,
    outcome: r.outcome,
  }));
}

async function partitionCatalog(sqlPrimary) {
  const rows = await sqlPrimary`
    select c.relname, c.relispartition
    from pg_class c
    where c.relname = any(${ALL_PARTITIONS}) and c.relkind = 'r'
  `;
  const byName = new Map(rows.map((r) => [r.relname, r.relispartition]));
  /** @type {Record<string, {exists: boolean, attached: boolean}>} */
  const catalog = {};
  for (const name of ALL_PARTITIONS) {
    const attached = byName.get(name);
    catalog[name] = { exists: byName.has(name), attached: attached === true };
  }
  return catalog;
}

async function partitionRowCount(sqlPrimary, name) {
  if (!/^orders_2024_0[1-7]$/.test(name)) throw new Error(`refusing unexpected partition name: ${name}`);
  const [row] = await sqlPrimary.unsafe(`select count(*)::int as n from commerce.${name}`);
  return row ? Number(row.n) : null;
}

async function retentionConfig(sqlPrimary) {
  const [row] = await sqlPrimary`select strategy, cutoff_date from ops.retention_config where id = 1`;
  return { strategy: row.strategy, cutoffDate: toIsoDate(row.cutoff_date) };
}

async function latestDiagnosis(sqlPrimary) {
  const rows = await sqlPrimary`
    select submission_id, offending_pid, mechanism, trigger_source, first_action
    from audit.diagnosis_log
    order by submission_id desc
    limit 20
  `;
  return rows.map((r) => ({
    submissionId: Number(r.submission_id),
    offendingPid: r.offending_pid,
    mechanism: r.mechanism,
    triggerSource: r.trigger_source,
    firstAction: r.first_action,
  }));
}

/** All backend pids EVER recorded running the buggy strategy — the ground
 * truth Phase 1's diagnosis is graded against. Deliberately not just "the
 * most recent one": a participant may correctly diagnose an earlier episode
 * after it already ended (same allowance db-challenge-blocked-transaction
 * makes for its recorded blocker pid). */
async function unsafePids(sqlPrimary) {
  const rows = await sqlPrimary`
    select distinct backend_pid from audit.incident_log where strategy = 'unsafe_full_delete'
  `;
  return rows.map((r) => r.backend_pid);
}

export async function recordDiagnosisSubmission(sqlPrimary, submission) {
  await sqlPrimary`
    insert into audit.diagnosis_log (offending_pid, mechanism, trigger_source, first_action, correct)
    values (${submission.offendingPid ?? null}, ${submission.mechanism ?? null},
            ${submission.triggerSource ?? null}, ${submission.firstAction ?? null}, ${submission.correct})
  `;
}

/**
 * @param {import('postgres').Sql} sqlPrimary
 * @param {import('postgres').Sql} sqlReplica
 */
export function createPgGraderClient(sqlPrimary, sqlReplica) {
  return {
    metricsSamples: () => metricsSamples(sqlPrimary),
    incidentEpisodes: () => incidentEpisodes(sqlPrimary),
    partitionCatalog: () => partitionCatalog(sqlPrimary),
    partitionRowCount: (name) => partitionRowCount(sqlPrimary, name),
    retentionConfig: () => retentionConfig(sqlPrimary),
    latestDiagnoses: () => latestDiagnosis(sqlPrimary),
    unsafePids: () => unsafePids(sqlPrimary),
  };
}
