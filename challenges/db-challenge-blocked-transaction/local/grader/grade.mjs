/**
 * db-challenge-blocked-transaction — automated grader (the primary evaluation).
 *
 * PURE and dependency-injected: it never opens a socket or runs SQL itself.
 * It drives an injected `client` that reads live database state:
 *
 *   client.accountBalanceCents()      -> number | null
 *   client.originalBlockerStillActive() -> boolean | null
 *   client.waiterWaitMs()             -> number | null
 *
 * Each of the 3 checkpoints below resolves to a `{ id, label, passed, detail }`
 * result, one per `scoring.checks[]` entry in metadata.json (same ids).
 * `/verify` grades ONE checkpoint per request (TenkaCloud#2252's checkpointId
 * contract); `evaluateCheckpoint` looks up the matching entry and runs it.
 *
 * ## Why this distinguishes "genuinely resolved" from "there was never really
 * a problem"
 *
 * The incident is orchestrated entirely by the trusted Node app
 * (local/app/server.mjs) — never by participant SQL, and `participant` has
 * no UPDATE grant on `app.accounts` at all (see local/db/schema.sql). That
 * forecloses the most obvious shallow shortcut for this kind of Challenge:
 * a participant cannot simply run the missing write themselves. The only
 * lever they have is diagnosing and terminating the real blocking backend
 * (`pg_terminate_backend`, via `pg_signal_backend` membership).
 *
 * Given that, the remaining risk is not "the participant faked the fix" but
 * "the final state looks correct by accident" — e.g. a bug that never really
 * held the lock in the first place, so the waiter's write went through
 * near-instantly with no real blocking ever happening. `waiterWaitMs()`
 * guards against exactly that: it is the elapsed time between the SAME
 * trusted app code logging "about to attempt the write" and "the write
 * actually returned." Nothing about that duration is participant-controlled
 * (contrast with db-a6-lock, where the grader has to defend against a
 * PARTICIPANT embedding `pg_sleep()` in their OWN statement — here the
 * participant never runs the write at all), so a near-zero gap can only mean
 * genuine contention never happened.
 *
 * `originalBlockerStillActive() === false` is the third, independent leg:
 * the SPECIFIC backend pid recorded once, at the moment the incident
 * started, must have actually stopped existing — not just "no session is
 * currently blocked" (which would also be trivially true before the
 * incident ever started, or if the blocker happened to still be running but
 * briefly wasn't reported as blocking anyone). Requiring all three
 * (blocker's specific pid gone + a measured real wait + the correct final
 * balance) together is what rules out "there was never really a problem."
 */

/** Seed balance 100000 minus the waiter's debit 5000 (local/db/seed.sql,
 * local/app/pg-client.mjs) — the blocker's own -10000 never lands, because
 * its transaction is rolled back the moment its backend is terminated. */
const EXPECTED_RESOLVED_BALANCE_CENTS = 95000;

/** A floor so a would-be genuine wait is not just clock-resolution noise —
 * comfortably below how long a real diagnosis (reading pg_stat_activity,
 * running pg_blocking_pids, issuing pg_terminate_backend) actually takes a
 * participant, and comfortably above any measurement jitter. Same order of
 * magnitude as db-a6-lock's MIN_OVERLAP_WINDOW_MS, same rationale. */
const MIN_GENUINE_WAIT_MS = 200;

export const CHECKS = [
  {
    id: "blocking-session-cleared",
    label: "リークしていた blocker のセッションが実際に終了している",
    async run(client) {
      const stillActive = await client.originalBlockerStillActive();
      if (stillActive === null) {
        return {
          passed: false,
          detail: "インシデントの blocker がまだ記録されていない。少し待ってから再スキャンしよう。",
        };
      }
      const passed = stillActive === false;
      const detail = passed
        ? "記録されていた blocker の backend は、もう pg_stat_activity に存在しない。"
        : "記録されていた blocker の backend が、まだ pg_stat_activity に存在している。" +
          "pg_blocking_pids() で本当の blocker の pid を特定できているか確認しよう。";
      return { passed, detail };
    },
  },
  {
    id: "genuine-wait-then-resolution",
    label: "書き込みが実際にロック待ちしてから完了した (見せかけではない)",
    async run(client) {
      const waitMs = await client.waiterWaitMs();
      if (waitMs === null) {
        return {
          passed: false,
          detail: "保留中の書き込みがまだ完了していない。",
        };
      }
      const passed = waitMs >= MIN_GENUINE_WAIT_MS;
      const detail = passed
        ? `保留中の書き込みは実際に約 ${waitMs}ms 待たされてから完了した。`
        : `完了はしているが待ち時間が ${waitMs}ms しか無い ── 本当にロック待ちが発生したのか怪しい。`;
      return { passed, detail };
    },
  },
  {
    id: "stuck-write-completed",
    label: "保留中だった書き込みが実際に完了した",
    async run(client) {
      const balance = await client.accountBalanceCents();
      const passed = balance === EXPECTED_RESOLVED_BALANCE_CENTS;
      const detail = passed
        ? `account 1 の残高は ${balance} cents ── 保留中だった書き込みが正しく反映されている。`
        : `account 1 の残高は ${balance} cents (期待 ${EXPECTED_RESOLVED_BALANCE_CENTS})。まだ書き込みが` +
          "完了していないか、想定外の変化が起きている。";
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
