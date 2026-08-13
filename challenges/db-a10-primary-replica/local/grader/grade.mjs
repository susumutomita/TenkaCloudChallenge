/**
 * db-a10-primary-replica — automated grader (the primary evaluation).
 *
 * PURE and dependency-injected: it never opens a socket or runs SQL itself. It
 * drives an injected `client` that reads live database state from BOTH nodes:
 *
 *   client.replicationRows()  -> Array<{ applicationName, state, syncState,
 *                                        sentLsn, replayLsn, lagBytes }>
 *   client.replicaRecovery()  -> { inRecovery, walReceiverStatus, slotName, senderHost }
 *   client.ledgerCounts()     -> { primary: { wave1, wave2 }, replica: { wave1, wave2 } }
 *
 * Each of the 3 checkpoints below resolves to a `{ id, label, passed, detail }`
 * result, one per `scoring.checks[]` entry in metadata.json (same ids). `/verify`
 * grades ONE checkpoint per request (TenkaCloud#2252's checkpointId contract);
 * `evaluateCheckpoint` looks up the matching entry and runs it.
 *
 * ## Why "two waves" instead of one write
 *
 * A single write landing on the replica proves a copy happened at least once —
 * it does not distinguish real streaming replication from a lucky one-shot
 * snapshot taken right after that write. Two disjoint markers ('wave-1',
 * 'wave-2'), written in two separate statements the instructions ask the
 * participant to run apart from each other, is what actually demonstrates
 * "continuously following changes", the concept this drill is about (see
 * metadata.json's instructions and docs/curricula/database-track/curriculum.md).
 *
 * ## Why matching counts is enough anti-cheat (no audit schema needed here)
 *
 * Every prior Database Track drill needed an append-only `audit` schema
 * (populated only by a trigger, never by participant DML) to keep a
 * participant with full read/write access to their own table from faking the
 * "did the real thing happen" signal. This drill does not need one: the
 * replica is in permanent recovery mode, so ALL regular DML against it is
 * rejected for every role, including superusers — there is no privilege on
 * either node that lets a participant write directly into the replica's
 * app.ledger. A matching count between primary and replica can therefore only
 * be explained by genuine WAL replay.
 */

/** local/app/pg-client.mjs's markers and the exact counts the instructions ask
 * the participant to write, mirrored here (kept as a separate literal so this
 * file stays a pure, dependency-free module — same pattern as every prior
 * Database Track drill's grade.mjs). */
const WAVE_1_NOTE = "wave-1";
const WAVE_2_NOTE = "wave-2";
const WAVE_1_COUNT = 3;
const WAVE_2_COUNT = 3;

/** How many bytes of un-replayed WAL still count as "caught up". Generous for
 * this drill's handful of tiny single-row INSERTs (which top out at a few
 * hundred bytes of WAL) — the point is to catch a genuinely stalled or
 * disconnected replica, not to demand byte-exact equality against a primary
 * that keeps ticking its own WAL forward via background checkpoint activity. */
const MAX_CAUGHT_UP_LAG_BYTES = 1_048_576; // 1 MiB

export const CHECKS = [
  {
    id: "streaming-replication-active",
    label: "primary/replica が streaming replication で接続されている",
    async run(client) {
      const rows = await client.replicationRows();
      // The replica container can genuinely not exist yet (still building /
      // running pg_basebackup) — that is a "not yet", not a grader crash, so
      // this checkpoint (unlike the other two, which only make sense once the
      // topology is up) treats a connection failure as a normal false rather
      // than letting it propagate.
      let recovery;
      try {
        recovery = await client.replicaRecovery();
      } catch {
        recovery = { inRecovery: false, walReceiverStatus: null };
      }
      const streamingRows = rows.filter((r) => r.state === "streaming");
      const primarySeesStreaming = rows.length === 1 && streamingRows.length === 1;
      const replicaInRecovery = recovery.inRecovery === true;
      const replicaReceiverStreaming = recovery.walReceiverStatus === "streaming";
      const passed = primarySeesStreaming && replicaInRecovery && replicaReceiverStreaming;
      const detail = passed
        ? `primary の pg_stat_replication は state=streaming の standby を 1 件確認、replica は pg_is_in_recovery()=true・pg_stat_wal_receiver.status=streaming — 2 ノードは実際に streaming replication で接続されている。`
        : !primarySeesStreaming
          ? `primary の pg_stat_replication に streaming 状態の行が ${streamingRows.length} 件しかない (全 ${rows.length} 件) — replica コンテナが起動しきっていないか、接続が切れている可能性がある。少し待ってから再確認しよう。`
          : `replica 側の状態を確認できない (pg_is_in_recovery=${recovery.inRecovery}, wal_receiver.status=${recovery.walReceiverStatus}) — replica コンテナのログを確認しよう。`;
      return { passed, detail };
    },
  },
  {
    id: "writes-follow-to-replica",
    label: "primary への 2 波の書き込みが、両方とも replica へ反映されている",
    async run(client) {
      const { primary, replica } = await client.ledgerCounts();
      const wave1Ok = primary.wave1 === WAVE_1_COUNT && replica.wave1 === WAVE_1_COUNT;
      const wave2Ok = primary.wave2 === WAVE_2_COUNT && replica.wave2 === WAVE_2_COUNT;
      const passed = wave1Ok && wave2Ok;
      const detail = passed
        ? `primary/replica とも wave-1 が ${replica.wave1} 件、wave-2 が ${replica.wave2} 件で一致している — 2 回に分けて行った書き込みが、どちらも replica へ届いている。`
        : !wave1Ok
          ? `wave-1 の件数が primary=${primary.wave1}、replica=${replica.wave1} (期待値 ${WAVE_1_COUNT}) — まず 1 波目の INSERT を primary で実行し、replica で反映を確認しよう。`
          : `wave-2 の件数が primary=${primary.wave2}、replica=${replica.wave2} (期待値 ${WAVE_2_COUNT}) — 1 波目の後、もう一度 primary へ INSERT しよう (1 回の書き込みだけでは「継続して追従している」ことを示せない)。`;
      return { passed, detail };
    },
  },
  {
    id: "replica-caught-up",
    label: "replica が primary の WAL にほぼ完全に追いついている",
    async run(client) {
      const rows = await client.replicationRows();
      const row = rows[0];
      const streaming = row?.state === "streaming";
      const lagBytes = row?.lagBytes ?? null;
      const caughtUp = lagBytes !== null && lagBytes <= MAX_CAUGHT_UP_LAG_BYTES;
      const passed = streaming && caughtUp;
      const detail = passed
        ? `sent_lsn と replay_lsn の差は ${lagBytes} バイトで、ほぼ 0 ── replica は送られた WAL をすでに適用し終えている。`
        : !streaming
          ? `pg_stat_replication に streaming 状態の standby が見つからない。`
          : `sent_lsn と replay_lsn の差が ${lagBytes ?? "unknown"} バイトある (${MAX_CAUGHT_UP_LAG_BYTES} バイト以下が必要) — 少し待ってから再確認しよう。`;
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
