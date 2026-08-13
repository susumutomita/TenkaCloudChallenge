/**
 * db-a7-mvcc — automated grader (the primary evaluation).
 *
 * PURE and dependency-injected: it never opens a socket or runs SQL itself. It
 * drives an injected `client` that reads live database state:
 *
 *   client.referenceNote() -> string|null
 *   client.ticketStats()   -> { nLiveTup, nDeadTup, nTupUpd, nTupDel }
 *   client.churnLog()      -> Array<{ ticketId, op, backendPid, loggedAtMs,
 *                                     concurrentLongTxStartedAtMs: number|null }>
 *
 * Each of the 3 checkpoints below resolves to a `{ id, label, passed, detail }`
 * result, one per `scoring.checks[]` entry in metadata.json (same ids). `/verify`
 * grades ONE checkpoint per request (TenkaCloud#2252's checkpointId contract);
 * `evaluateCheckpoint` looks up the matching entry and runs it.
 *
 * ## Why churnLog, and not just the final dead-tuple count
 *
 * A final read of `n_dead_tup` alone cannot tell "churn happened while a long
 * transaction was genuinely open, and reclaim only became possible once it
 * closed" apart from "nothing interesting ever happened, and the table is
 * simply clean" — both end in n_dead_tup near 0. The whole point of this drill
 * is the FIRST scenario, so grading needs a durable record of whether a
 * long-running transaction was truly open while the writes happened —
 * `audit.churn_log` (local/db/schema.sql), a trigger-populated,
 * participant-unwritable trail, in place of a "participant runs a diagnostic
 * query and INSERTs the result into an answer table" design (rejected for the
 * same reason db-a6-lock rejected it: nothing stops a participant from typing
 * in whatever values make the checkpoint pass). Every column the trigger
 * writes (backend_pid, clock_timestamp(), and — critically — some OTHER
 * backend's `pg_stat_activity.xact_start`, but ONLY when that backend also
 * has a non-null `backend_xmin`, i.e. is actually holding a snapshot that
 * could block VACUUM, not merely sitting inside an idle `begin;`) is
 * something Postgres computes itself; no participant DML grant can forge any
 * of it.
 */

/** How many churned writes must show a genuinely open long transaction to
 * count as "this really happened", not a one-off coincidence. The instructed
 * flow churns 30 rows; this is a generous margin below that. */
const MIN_LONG_TX_CHURN_ROWS = 10;

/** How long the long transaction must have already been open, at the moment a
 * given churn write landed, to not be a same-instant clock-resolution fluke.
 * Kept small on purpose: the real signal against a false positive is not
 * duration but WHICH transactions can set concurrentLongTxStartedAtMs at all
 * — see local/db/schema.sql's trigger, which only records it for another
 * backend that is both idle-in-transaction AND still holding a pinned
 * snapshot (a non-null `backend_xmin`). A plain `begin;` with no query run
 * yet can never produce a non-null value here, no matter how long it sits
 * open, so this floor only needs to rule out true zero-width coincidences. */
const MIN_HELD_OPEN_MS = 20;

/** Cumulative UPDATE+DELETE count on mvcc.tickets (n_tup_upd/n_tup_del never
 * reset on VACUUM) required to call this "real churn", not a couple of stray
 * edits — comfortably below the 30 the instructed flow produces. */
const MIN_TOTAL_CHURN_OPS = 10;

/** How close to zero n_dead_tup must be after the participant closes the long
 * transaction and re-runs VACUUM. autovacuum is disabled on mvcc.tickets (see
 * local/db/schema.sql), so this can only shrink when the participant runs
 * VACUUM themselves. */
const MAX_FINAL_DEAD_TUP = 3;

/** mvcc.reference (id 1) never takes part in this drill and must stay exactly
 * as seeded (local/db/seed.sql) — a stray write here means the wrong row was
 * touched. */
const SEED_REFERENCE_NOTE = "do-not-touch";

/**
 * Count churn writes that landed while a genuinely long-open OTHER
 * transaction existed: concurrentLongTxStartedAtMs is not null (some other
 * `participant` backend was "idle in transaction" at write time — see the
 * trigger in local/db/schema.sql) AND that transaction had already been open
 * for at least MIN_HELD_OPEN_MS when this write landed.
 */
function countChurnWritesUnderLongTx(entries) {
  return entries.filter((e) => {
    if (e.concurrentLongTxStartedAtMs === null) return false;
    return e.loggedAtMs - e.concurrentLongTxStartedAtMs >= MIN_HELD_OPEN_MS;
  }).length;
}

export const CHECKS = [
  {
    id: "reference-untouched",
    label: "churn の対象ではない mvcc.reference の内容が変わっていない",
    async run(client) {
      const note = await client.referenceNote();
      const passed = note === SEED_REFERENCE_NOTE;
      const detail = passed
        ? `note="${note}" で変わっていない。`
        : `note="${note}" になっている (本来 "${SEED_REFERENCE_NOTE}" のはず)。mvcc.tickets 以外の行を誤って更新していないか確認しよう。`;
      return { passed, detail };
    },
  },
  {
    id: "long-transaction-blocked-cleanup-observed",
    label: "長時間開いた transaction がある間に churn (UPDATE/DELETE) が実際に行われた",
    async run(client) {
      const entries = await client.churnLog();
      const underLongTx = countChurnWritesUnderLongTx(entries);
      const passed = underLongTx >= MIN_LONG_TX_CHURN_ROWS;
      const detail = passed
        ? `mvcc.tickets への更新のうち ${underLongTx} 件が、別セッションの長時間 transaction (snapshot を保持したまま) が開いている間に行われた。`
        : `mvcc.tickets への更新記録が ${entries.length} 件あるが、そのうち別セッションの長時間 transaction が開いている間に行われたものは ${underLongTx} 件しかない (${MIN_LONG_TX_CHURN_ROWS} 件必要)。repeatable read で begin し、実際にクエリを 1 つ実行してから (snapshot を確定させてから) churn を走らせよう。`;
      return { passed, detail };
    },
  },
  {
    id: "dead-tuples-reclaimed",
    label: "churn で発生した dead tuple が、長時間 transaction を閉じた後の VACUUM で回収されている",
    async run(client) {
      const stats = await client.ticketStats();
      const totalChurnOps = (stats.nTupUpd ?? 0) + (stats.nTupDel ?? 0);
      const churnedEnough = totalChurnOps >= MIN_TOTAL_CHURN_OPS;
      const reclaimed = stats.nDeadTup !== null && stats.nDeadTup <= MAX_FINAL_DEAD_TUP;
      const passed = churnedEnough && reclaimed;
      const detail = passed
        ? `n_tup_upd+n_tup_del=${totalChurnOps}、現在の n_dead_tup=${stats.nDeadTup} — churn は実際に発生し、その dead tuple は回収されている。`
        : !churnedEnough
          ? `n_tup_upd+n_tup_del=${totalChurnOps} (${MIN_TOTAL_CHURN_OPS} 件必要) — まだ十分な churn が行われていない。`
          : `n_dead_tup=${stats.nDeadTup} (${MAX_FINAL_DEAD_TUP} 以下が必要) — 長時間 transaction を閉じてから VACUUM を実行しよう。`;
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
