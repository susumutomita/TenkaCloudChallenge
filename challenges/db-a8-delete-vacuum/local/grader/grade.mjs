/**
 * db-a8-delete-vacuum — automated grader (the primary evaluation).
 *
 * PURE and dependency-injected: it never opens a socket or runs SQL itself. It
 * drives an injected `client` that reads live database state:
 *
 *   client.rowCounts()  -> { oldRemaining, recentRemaining }
 *   client.eventStats() -> { nLiveTup, nDeadTup, nTupDel }
 *   client.deleteLog()  -> Array<{ rowsDeleted, minCreatedAtMs, maxCreatedAtMs,
 *                                  backendPid, executedAtMs }>
 *
 * Each of the 3 checkpoints below resolves to a `{ id, label, passed, detail }`
 * result, one per `scoring.checks[]` entry in metadata.json (same ids). `/verify`
 * grades ONE checkpoint per request (TenkaCloud#2252's checkpointId contract);
 * `evaluateCheckpoint` looks up the matching entry and runs it.
 *
 * ## Why deleteLog, and not just the final dead-tuple count
 *
 * A freshly seeded, never-touched telemetry.events already has n_dead_tup = 0
 * (autovacuum is disabled — see local/db/schema.sql — but nothing has written
 * to the table yet either). That means "n_dead_tup is small" alone cannot
 * distinguish "a 300,000-row DELETE happened, and VACUUM then reclaimed it"
 * from "nothing happened, and the participant just ran VACUUM against an
 * untouched table" — the whole shortcut this drill's design brief calls out
 * by name. Grading needs a durable, unforgeable record that a genuinely large
 * DELETE actually executed: `audit.delete_log` (local/db/schema.sql), populated
 * ONLY by a statement-level trigger reading Postgres's own transition table of
 * removed rows — not by a participant INSERT (no INSERT grant exists on that
 * table). `dead-tuples-reclaimed` below cross-checks the same fact a second,
 * independent way via `pg_stat_user_tables.n_tup_del` (a cumulative counter
 * Postgres itself maintains and VACUUM never resets), so defeating the
 * anti-cheat would require defeating two independent, DML-unforgeable data
 * sources at once.
 */

/** The retention cutoff instructions ask the participant to enforce: every
 * row older than this must be gone, every row on/after it must survive
 * untouched. Mirrors local/app/pg-client.mjs's RETENTION_CUTOFF (kept as a
 * separate literal here so this file stays a pure, dependency-free module —
 * same pattern as db-a7-mvcc's SEED_REFERENCE_NOTE duplication). */
const RETENTION_CUTOFF = "2023-01-01T00:00:00Z";

/** local/db/seed.sql seeds exactly this many rows on/after the cutoff —
 * every one of them must still be there afterward, no more, no fewer. */
const SEEDED_RECENT_ROWS = 100_000;

/** Cumulative rows removed (summed across every audit.delete_log entry, or
 * equivalently pg_stat_user_tables.n_tup_del) required to call this "the real
 * bulk DELETE this drill is about", not a couple of stray test rows —
 * comfortably below the 300,000 old rows seed.sql actually plants, so a
 * participant who deletes in a few batches, or misses a handful due to a
 * slightly different WHERE clause, is not penalized for it. */
const MIN_BULK_DELETE_ROWS = 250_000;

/** How close to zero n_dead_tup must be after the participant re-runs VACUUM.
 * autovacuum is disabled on telemetry.events (see local/db/schema.sql), so
 * this can only shrink when the participant runs VACUUM themselves. */
const MAX_FINAL_DEAD_TUP = 100;

export const CHECKS = [
  {
    id: "old-rows-deleted-recent-intact",
    label: "cutoff より古い行が消え、cutoff 以降の行はそのまま残っている",
    async run(client) {
      const { oldRemaining, recentRemaining } = await client.rowCounts();
      const oldGone = oldRemaining === 0;
      const recentIntact = recentRemaining === SEEDED_RECENT_ROWS;
      const passed = oldGone && recentIntact;
      const detail = passed
        ? `${RETENTION_CUTOFF} より古い行は 0 件、それ以降の行は ${recentRemaining} 件 (期待通り) 残っている。`
        : !oldGone
          ? `${RETENTION_CUTOFF} より古い行がまだ ${oldRemaining} 件残っている。DELETE の WHERE 条件を確認しよう。`
          : `${RETENTION_CUTOFF} 以降の行が ${recentRemaining} 件になっている (期待値 ${SEEDED_RECENT_ROWS})。古い行だけを狙って削除できているか確認しよう。`;
      return { passed, detail };
    },
  },
  {
    id: "bulk-delete-observed",
    label: "300,000 行規模の DELETE が実際に実行された",
    async run(client) {
      const entries = await client.deleteLog();
      const totalDeleted = entries.reduce((sum, e) => sum + e.rowsDeleted, 0);
      const passed = totalDeleted >= MIN_BULK_DELETE_ROWS;
      const detail = passed
        ? `audit.delete_log に記録された削除行数の合計は ${totalDeleted} 件 — 実際に大量の DELETE が実行された。`
        : `audit.delete_log に記録された削除行数の合計は ${totalDeleted} 件しかない (${MIN_BULK_DELETE_ROWS} 件必要)。retention cutoff (${RETENTION_CUTOFF}) より古い行をまとめて DELETE しよう。`;
      return { passed, detail };
    },
  },
  {
    id: "dead-tuples-reclaimed",
    label: "DELETE が生んだ dead tuple が VACUUM で回収されている",
    async run(client) {
      const stats = await client.eventStats();
      const deletedEnough = (stats.nTupDel ?? 0) >= MIN_BULK_DELETE_ROWS;
      const reclaimed = stats.nDeadTup !== null && stats.nDeadTup <= MAX_FINAL_DEAD_TUP;
      const passed = deletedEnough && reclaimed;
      const detail = passed
        ? `n_tup_del=${stats.nTupDel}、現在の n_dead_tup=${stats.nDeadTup} — 大量 DELETE は実際に発生し、その dead tuple は VACUUM で回収されている。`
        : !deletedEnough
          ? `n_tup_del=${stats.nTupDel} (${MIN_BULK_DELETE_ROWS} 件必要) — まだ十分な DELETE が行われていない。`
          : `n_dead_tup=${stats.nDeadTup} (${MAX_FINAL_DEAD_TUP} 以下が必要) — autovacuum は無効なので、自分で VACUUM を実行しよう。`;
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
