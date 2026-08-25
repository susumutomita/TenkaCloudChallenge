/**
 * db-battle-slow-apparently — retention worker.
 *
 * This IS the incident. On a fixed tick (see TICK_MS — sped up from a real
 * daily cron to fit a lab session, same "same failure mechanics at lab
 * scale" call the parent Issue makes for row counts), it re-reads
 * `ops.retention_config` and, if any known partition is both (a) fully
 * older than the configured cutoff and (b) still attached to
 * commerce.orders, starts ONE run ("episode", logged to
 * audit.incident_log"):
 *
 *   strategy = 'unsafe_full_delete' (the shipped default / the bug) ---
 *     one single, uncommitted transaction: `DELETE FROM commerce.orders
 *     WHERE created_at < cutoff`. Postgres partition-prunes this to just the
 *     eligible leaf partitions, but it still touches every row individually
 *     — each one pays audit.deleted_orders_log's per-row trigger tax (see
 *     local/db/schema.sql) and generates real WAL. This is the "row-by-row
 *     purge on an already-partitioned table" bug the parent Issue's Variant
 *     A describes.
 *
 *   strategy = 'partition_aware' (the fix `participant` can dial in via
 *     `UPDATE ops.retention_config SET strategy = ...`) --- for every
 *     eligible partition: `ALTER TABLE ... DETACH PARTITION` then
 *     `DROP TABLE`. Catalog-only, no per-row trigger, no per-row WAL.
 *
 * A run that gets cancelled (`pg_cancel_backend`) or terminated
 * (`pg_terminate_backend`) mid-flight rolls back cleanly (nothing was
 * committed) and the worker backs off for COOLDOWN_MS before trying again —
 * long enough to actually finish Phase 3 by hand, not so long that a
 * participant who ignores the incident never sees it resume.
 *
 * Every episode's pid, strategy, cutoff, target partitions, start/end time
 * and outcome is durably recorded — this table is the ground truth
 * local/grader/grade.mjs reads, not anything self-reported by this process
 * at "the end".
 */
import postgres from "postgres";

const DATABASE_URL = process.env.DATABASE_URL ?? "postgres://retention_service@primary:5432/incident";
const TICK_MS = Number(process.env.RETENTION_TICK_MS ?? 5000);
const COOLDOWN_MS = Number(process.env.RETENTION_COOLDOWN_MS ?? 45000);
const START_DELAY_MS = Number(process.env.RETENTION_START_DELAY_MS ?? 5000);

/** Every partition this scenario ever created, and the date each one stops
 * covering (exclusive). Fixed for this MVP (see PR notes on seed variance as
 * a follow-up) — the worker never needs to guess a partition name, only
 * whether it is still attached. */
const PARTITIONS = [
  { name: "orders_2024_01", upperBoundExclusive: "2024-02-01" },
  { name: "orders_2024_02", upperBoundExclusive: "2024-03-01" },
  { name: "orders_2024_03", upperBoundExclusive: "2024-04-01" },
  { name: "orders_2024_04", upperBoundExclusive: "2024-05-01" },
  { name: "orders_2024_05", upperBoundExclusive: "2024-06-01" },
  { name: "orders_2024_06", upperBoundExclusive: "2024-07-01" },
  { name: "orders_2024_07", upperBoundExclusive: "2024-08-01" },
];

const sql = postgres(DATABASE_URL, {
  max: 4,
  onnotice: () => {},
  connection: { application_name: "retention-worker" },
});

async function attachedPartitionNames() {
  const rows = await sql`
    select c.relname
    from pg_inherits i
    join pg_class c on c.oid = i.inhrelid
    where i.inhparent = 'commerce.orders'::regclass
  `;
  return new Set(rows.map((r) => r.relname));
}

/** The `postgres` driver returns a DATE column as a JS Date (midnight UTC),
 * not a string — normalize to plain 'YYYY-MM-DD' so lexicographic string
 * comparison against PARTITIONS[].upperBoundExclusive stays correct. */
function toIsoDate(value) {
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
}

async function getConfig() {
  const [row] = await sql`select strategy, cutoff_date from ops.retention_config where id = 1`;
  return { strategy: row.strategy, cutoffDate: toIsoDate(row.cutoff_date) };
}

async function logEpisodeStart(pid, strategy, cutoffDate, partitions) {
  const [row] = await sql`
    insert into audit.incident_log (backend_pid, strategy, cutoff_date, partitions)
    values (${pid}, ${strategy}, ${cutoffDate}, ${partitions})
    returning episode_id
  `;
  return row.episode_id;
}

async function logEpisodeEnd(episodeId, outcome) {
  await sql`
    update audit.incident_log
    set ended_at = clock_timestamp(), outcome = ${outcome}
    where episode_id = ${episodeId}
  `;
}

function classifyFailure(err) {
  const code = err?.code;
  const message = String(err?.message ?? "");
  if (code === "57014" || /canceling statement/i.test(message)) return "cancelled";
  if (code === "57P01" || /terminat/i.test(message)) return "cancelled";
  return "error";
}

/** Runs on a single reserved connection so `pg_backend_pid()` stays stable
 * for the whole episode — that pid is exactly what Phase 1's diagnosis and
 * Phase 2's containment are graded against. */
async function runEpisode(reserved, strategy, cutoffDate, partitionNames) {
  await reserved.unsafe("begin");
  try {
    if (strategy === "unsafe_full_delete") {
      await reserved.unsafe("delete from commerce.orders where created_at < $1", [cutoffDate]);
    } else {
      for (const name of partitionNames) {
        await reserved.unsafe(`alter table commerce.orders detach partition commerce.${name}`);
        await reserved.unsafe(`drop table commerce.${name}`);
      }
    }
    await reserved.unsafe("commit");
    return "committed";
  } catch (err) {
    try {
      await reserved.unsafe("rollback");
    } catch {
      // connection may already be gone (pg_terminate_backend) — nothing to roll back on.
    }
    const outcome = classifyFailure(err);
    if (outcome === "error") console.error("[retention-worker] episode failed:", err);
    return outcome;
  }
}

let purgeInProgress = false;
let cooldownUntil = 0;

async function tick() {
  if (purgeInProgress || Date.now() < cooldownUntil) return;

  const [cfg, attached] = await Promise.all([getConfig(), attachedPartitionNames()]);
  const eligible = PARTITIONS.filter((p) => attached.has(p.name) && p.upperBoundExclusive <= cfg.cutoffDate);
  if (eligible.length === 0) return;

  purgeInProgress = true;
  const reserved = await sql.reserve();
  try {
    const [{ pid }] = await reserved`select pg_backend_pid() as pid`;
    const partitionNames = eligible.map((p) => p.name);
    console.log(
      `[retention-worker] episode start pid=${pid} strategy=${cfg.strategy} cutoff=${cfg.cutoffDate} partitions=${partitionNames.join(",")}`,
    );
    const episodeId = await logEpisodeStart(pid, cfg.strategy, cfg.cutoffDate, partitionNames);
    const outcome = await runEpisode(reserved, cfg.strategy, cfg.cutoffDate, partitionNames);
    await logEpisodeEnd(episodeId, outcome);
    console.log(`[retention-worker] episode ${episodeId} ended: ${outcome}`);
    if (outcome !== "committed") cooldownUntil = Date.now() + COOLDOWN_MS;
  } finally {
    await reserved.release();
    purgeInProgress = false;
  }
}

async function loop() {
  await new Promise((r) => setTimeout(r, START_DELAY_MS));
  for (;;) {
    try {
      await tick();
    } catch (err) {
      console.error("[retention-worker] tick error:", err);
    }
    await new Promise((r) => setTimeout(r, TICK_MS));
  }
}

loop();
