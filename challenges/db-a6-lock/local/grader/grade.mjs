/**
 * db-a6-lock — automated grader (the primary evaluation).
 *
 * PURE and dependency-injected: it never opens a socket or runs SQL itself. It
 * drives an injected `client` that reads live database state:
 *
 *   client.stockQuantities() -> { widget: number|null, gadget: number|null }
 *   client.lockWaitLog()     -> Array<{ backendPid, txid, stmtStartedAtMs,
 *                                       committedAtMs: number|null }>
 *
 * Each of the 3 checkpoints below resolves to a `{ id, label, passed, detail }`
 * result, one per `scoring.checks[]` entry in metadata.json (same ids). `/verify`
 * grades ONE checkpoint per request (TenkaCloud#2252's checkpointId contract);
 * `evaluateCheckpoint` looks up the matching entry and runs it.
 *
 * ## Why lockWaitLog, and not just the final quantities
 *
 * A4's transaction drill could grade atomicity from a single final read (xmin
 * equality) because BOTH writes there come from the SAME transaction. This drill
 * is the opposite case: the two writes MUST come from two different sessions, and
 * the entire point is that the second one had to wait for the first one's
 * uncommitted lock. Reading only the final widget.qty cannot distinguish "two
 * sessions really contended for the same row" from "two ordinary autocommit
 * UPDATEs ran back-to-back with no contention at all" — both reach the exact same
 * number. So this drill grades from `audit.lock_wait_log` (local/db/schema.sql), a
 * trigger-populated, participant-unwritable trail of every write to
 * inventory.stock, in place of a "participant runs a diagnostic query and INSERTs
 * the result into an answer table" design (rejected: that would just be
 * self-report with extra steps — nothing stops a participant from typing in
 * whatever pid/duration values make the checkpoint pass, diagnostic framing or
 * not).
 *
 * ## Why an overlap check, not a duration threshold
 *
 * "This write took a long time" is not, by itself, proof of a lock wait — a
 * participant could make their OWN write look slow by embedding `pg_sleep()` in
 * it, with no second session and no real contention at all. What genuinely
 * cannot be faked is the RELATIONSHIP between two DIFFERENT sessions' write
 * windows on the SAME row: if session B's transaction (txid) truly committed
 * WHILE session A's UPDATE statement on that exact row was still in flight
 * (A had already started, but had not yet returned), then A was necessarily
 * blocked on B's row lock — Postgres's own MVCC concurrency control guarantees
 * this for any two UPDATEs that touch the same row, there is no way to reach
 * that timing relationship without the underlying wait actually happening.
 * findGenuineLockWait() looks for exactly that relationship using
 * pg_xact_commit_timestamp() (the TRUE commit instant, from Postgres itself),
 * not a timestamp either side could influence.
 */

/** A minimal floor so a would-be match is not just clock-resolution noise —
 * comfortably below the real ~5s gap the instructions produce (the blocker runs
 * `select pg_sleep(5);` before COMMIT specifically so this is not a race against
 * how fast a human types) and comfortably above any genuine wait worth counting. */
const MIN_OVERLAP_WINDOW_MS = 200;

/** The one contended row: widget (id 1), starting at 300 (local/db/seed.sql).
 * blocker debits 100 (300 -> 200), waiter debits 50 (200 -> 150) once unblocked. */
const EXPECTED_WIDGET_QTY = 300 - 100 - 50; // 150

/** gadget (id 2) never takes part in this drill's blocker/waiter dance and must
 * stay exactly as seeded — a stray write here means the wrong row was touched. */
const EXPECTED_GADGET_QTY = 120;

/**
 * Look for two DIFFERENT-backend log entries where one (the "blocker") truly
 * committed strictly inside the other (the "waiter")'s still-open statement
 * window: waiter.stmtStartedAtMs < blocker.committedAtMs < waiter.committedAtMs.
 * Entries with no known commit timestamp (still uncommitted, or Postgres has no
 * record of it) cannot serve as either role and are skipped.
 */
export function findGenuineLockWait(entries) {
  const known = entries.filter((e) => e.committedAtMs !== null);
  for (const waiter of known) {
    const windowMs = waiter.committedAtMs - waiter.stmtStartedAtMs;
    if (windowMs < MIN_OVERLAP_WINDOW_MS) continue;
    for (const blocker of known) {
      if (blocker.backendPid === waiter.backendPid) continue;
      const overlaps =
        blocker.committedAtMs > waiter.stmtStartedAtMs && blocker.committedAtMs < waiter.committedAtMs;
      if (overlaps) return { waiter, blocker };
    }
  }
  return null;
}

export const CHECKS = [
  {
    id: "gadget-untouched",
    label: "widget と無関係の gadget の在庫数が変わっていない",
    async run(client) {
      const { gadget } = await client.stockQuantities();
      const passed = gadget === EXPECTED_GADGET_QTY;
      const detail = passed
        ? `gadget=${gadget} で変わっていない。`
        : `gadget=${gadget} になっている (本来 ${EXPECTED_GADGET_QTY} のはず)。widget 以外の行を誤って更新していないか確認しよう。`;
      return { passed, detail };
    },
  },
  {
    id: "widget-qty-correct",
    label: "widget の在庫数が blocker (-100) と waiter (-50) の両方を反映して正しい",
    async run(client) {
      const { widget } = await client.stockQuantities();
      const passed = widget === EXPECTED_WIDGET_QTY;
      const detail = passed
        ? `widget=${widget} — 期待どおり。`
        : `widget=${widget} (期待 ${EXPECTED_WIDGET_QTY})。blocker と waiter、両方の更新が正しく commit されているか確認しよう。`;
      return { passed, detail };
    },
  },
  {
    id: "row-lock-wait-observed",
    label: "別セッションが同じ行の lock 待ちで実際にブロックされた",
    async run(client) {
      const entries = await client.lockWaitLog();
      const found = findGenuineLockWait(entries);
      const passed = found !== null;
      const detail = passed
        ? `pid ${found.waiter.backendPid} の更新の実行中に、pid ${found.blocker.backendPid} が commit している — 実際に lock 待ちが発生した。`
        : `widget への更新記録が ${entries.length} 件あるが、「別セッションが commit するまでこのセッションの更新が待たされた」という重なりが見つからない。blocker を begin で開いたまま waiter を走らせ、blocker が commit するまで waiter を待たせよう。`;
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
