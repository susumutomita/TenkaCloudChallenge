/**
 * pg-client — the live Postgres adapter the grader drives inside the container.
 *
 * Connects as the `postgres` superuser (no tenant/authorization boundary in this
 * drill — the subject is partition catalog state and row counts, not access
 * control) and implements the control surface grade.mjs expects.
 *
 * This file is the seam the unit tests replace with a fake; the grader logic
 * itself (grade.mjs) has no Postgres dependency.
 */

/** The leaf partition the participant is asked to empty via an ordinary
 * row-level DELETE, and the one to remove via DETACH PARTITION (optionally
 * followed by DROP TABLE) instead. Public, known ahead of time. */
export const DELETE_TARGET_PARTITION = "events_y2024m01";
export const DETACH_TARGET_PARTITION = "events_y2024m02";

/** The 4 bystander months that must survive completely untouched — same role
 * the 100,000 "recent" rows play in db-a8-delete-vacuum. */
export const BYSTANDER_PARTITIONS = ["events_y2024m03", "events_y2024m04", "events_y2024m05", "events_y2024m06"];

/** local/db/seed.sql seeds exactly this many rows per month. */
export const SEEDED_ROWS_PER_MONTH = 20_000;

const ALL_PARTITIONS = [DELETE_TARGET_PARTITION, DETACH_TARGET_PARTITION, ...BYSTANDER_PARTITIONS];

/**
 * Read the current catalog state of every partition this drill cares about,
 * in one query. For each name:
 *   exists   — does a relation by this name exist at all (false once
 *              DROPped)?
 *   attached — is it currently a partition of metrics.events (true), or has
 *              it been DETACHed (false)? Read from pg_class.relispartition,
 *              which Postgres itself flips the instant DETACH PARTITION
 *              completes — confirmed on a live Postgres 16 instance.
 * A name absent from the result (DROPped) is reported as
 * `{ exists: false, attached: false }` by the caller below.
 */
async function currentPartitionCatalog(sql) {
  const rows = await sql`
    select relname, relispartition
    from pg_class
    where relkind = 'r' and relname = any(${ALL_PARTITIONS})
  `;
  const byName = new Map(rows.map((r) => [r.relname, Boolean(r.relispartition)]));
  const out = {};
  for (const name of ALL_PARTITIONS) {
    out[name] = byName.has(name)
      ? { exists: true, attached: byName.get(name) }
      : { exists: false, attached: false };
  }
  return out;
}

/**
 * Row count of a single leaf partition, queried by its own table name (not
 * through the partitioned parent) so it works whether or not the partition
 * is still attached — a DETACHed-but-not-DROPped table is an ordinary
 * standalone table and still answers a plain SELECT. Returns null if the
 * relation doesn't exist (DROPped).
 */
async function partitionRowCount(sql, partitionName) {
  try {
    const rows = await sql`select count(*)::bigint as n from metrics.${sql(partitionName)}`;
    return Number(rows[0]?.n ?? 0);
  } catch {
    return null; // relation does not exist (dropped) — a real, expected state here
  }
}

/** @param {import('postgres').Sql} sql */
export function createPgGraderClient(sql) {
  return {
    async partitionCatalog() {
      return currentPartitionCatalog(sql);
    },
    async deleteTargetRowCount() {
      return partitionRowCount(sql, DELETE_TARGET_PARTITION);
    },
    async detachTargetRowCount() {
      return partitionRowCount(sql, DETACH_TARGET_PARTITION);
    },
    async bystanderRowCounts() {
      const counts = {};
      for (const name of BYSTANDER_PARTITIONS) {
        counts[name] = await partitionRowCount(sql, name);
      }
      return counts;
    },
  };
}
