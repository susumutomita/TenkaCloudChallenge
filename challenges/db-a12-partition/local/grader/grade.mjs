/**
 * db-a12-partition — automated grader (the primary evaluation).
 *
 * PURE and dependency-injected: it never opens a socket or runs SQL itself. It
 * drives an injected `client` that reads live database state:
 *
 *   client.partitionCatalog()     -> Record<name, { exists, attached }>
 *   client.deleteTargetRowCount() -> number | null
 *   client.detachTargetRowCount() -> number | null
 *   client.bystanderRowCounts()   -> Record<name, number | null>
 *
 * Each of the 3 checkpoints below resolves to a `{ id, label, passed, detail }`
 * result, one per `scoring.checks[]` entry in metadata.json (same ids). `/verify`
 * grades ONE checkpoint per request (TenkaCloud#2252's checkpointId contract);
 * `evaluateCheckpoint` looks up the matching entry and runs it.
 *
 * ## Why the DELETE-target checkpoint requires the partition to STILL be attached
 *
 * "events_y2024m01 has 0 rows" alone cannot tell apart "the participant ran a
 * real row-level DELETE against it" from "the participant DETACHed it instead
 * (the wrong method for this target) and the now-orphaned rows just aren't
 * visible through metrics.events anymore." Both leave metrics.events itself
 * reporting the same row count. Checking that events_y2024m01 is STILL a
 * partition (`pg_class.relispartition` true, read via local/app/pg-client.mjs)
 * closes that gap: DETACH always flips it false, so "still attached AND 0
 * rows" can only be reached by really running DELETE. No participant DML
 * grant can forge `relispartition` — it isn't a table anyone can write to,
 * it's a fact Postgres's own catalog maintains.
 */

/** The leaf partition to empty via an ordinary row-level DELETE, and the one
 * to remove via DETACH PARTITION (optionally DROP TABLE afterward) instead.
 * Mirrors local/app/pg-client.mjs's constants (kept as separate literals here
 * so this file stays a pure, dependency-free module — same pattern as
 * db-a8-delete-vacuum's RETENTION_CUTOFF duplication). */
const DELETE_TARGET_PARTITION = "events_y2024m01";
const DETACH_TARGET_PARTITION = "events_y2024m02";
const BYSTANDER_PARTITIONS = ["events_y2024m03", "events_y2024m04", "events_y2024m05", "events_y2024m06"];

/** local/db/seed.sql seeds exactly this many rows per month — every
 * bystander partition must still have exactly this many, no more, no fewer. */
const SEEDED_ROWS_PER_MONTH = 20_000;

export const CHECKS = [
  {
    id: "old-partition-detached-or-dropped",
    label: "2024-02 の partition が DETACH または DROP されている",
    async run(client) {
      const catalog = await client.partitionCatalog();
      const state = catalog[DETACH_TARGET_PARTITION];
      const passed = !state.exists || !state.attached;
      const detail = passed
        ? state.exists
          ? `${DETACH_TARGET_PARTITION} はまだ存在するが、metrics.events の partition ではなくなっている (DETACH 済み)。`
          : `${DETACH_TARGET_PARTITION} は DROP 済みで存在しない。`
        : `${DETACH_TARGET_PARTITION} はまだ metrics.events に partition として attach されたままだ。ALTER TABLE ... DETACH PARTITION を実行しよう。`;
      return { passed, detail };
    },
  },
  {
    id: "old-month-deleted-via-delete",
    label: "2024-01 の行が row-level DELETE で消え、partition 自体は attach されたまま",
    async run(client) {
      const catalog = await client.partitionCatalog();
      const state = catalog[DELETE_TARGET_PARTITION];
      const rowCount = await client.deleteTargetRowCount();
      const stillAttached = state.exists && state.attached;
      const empty = rowCount === 0;
      const passed = stillAttached && empty;
      const detail = passed
        ? `${DELETE_TARGET_PARTITION} は attach されたままで、行数は 0 — DELETE で正しく消された。`
        : !stillAttached
          ? `${DELETE_TARGET_PARTITION} が attach されていない (DETACH/DROP された?)。この月は DELETE で消す対象だ — DETACH は 2024-02 の方で使おう。`
          : `${DELETE_TARGET_PARTITION} にまだ ${rowCount} 行残っている。delete from metrics.events where created_at >= '2024-01-01' and created_at < '2024-02-01'; を実行しよう。`;
      return { passed, detail };
    },
  },
  {
    id: "bystander-partitions-intact",
    label: "2024-03〜06 の partition は attach されたまま、行数も無傷",
    async run(client) {
      const catalog = await client.partitionCatalog();
      const rowCounts = await client.bystanderRowCounts();
      const problems = [];
      for (const name of BYSTANDER_PARTITIONS) {
        const state = catalog[name];
        if (!state.exists || !state.attached) {
          problems.push(`${name} が attach されていない`);
          continue;
        }
        if (rowCounts[name] !== SEEDED_ROWS_PER_MONTH) {
          problems.push(`${name} の行数が ${rowCounts[name]} (期待値 ${SEEDED_ROWS_PER_MONTH})`);
        }
      }
      const passed = problems.length === 0;
      const detail = passed
        ? `${BYSTANDER_PARTITIONS.join(", ")} はすべて attach されたまま、各 ${SEEDED_ROWS_PER_MONTH} 行で無傷だ。`
        : `このドリルに関わらないはずの partition に問題がある: ${problems.join("; ")}。触っていないか確認しよう。`;
      return { passed, detail };
    },
  },
];

const CHECK_IDS = new Set(CHECKS.map((c) => c.id));

export function isKnownCheckpoint(checkpointId) {
  return CHECK_IDS.has(checkpointId);
}

/** Evaluate exactly one checkpoint (the multi-verify /verify contract grades one at a time). */
export async function evaluateCheckpoint(client, checkpointId) {
  const check = CHECKS.find((c) => c.id === checkpointId);
  if (!check) {
    return { correct: false, message: "unknown checkpoint" };
  }
  const { passed, detail } = await check.run(client);
  return { correct: passed, message: detail };
}
