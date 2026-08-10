/**
 * db-a11-replication-lag — automated grader (the primary evaluation).
 *
 * PURE and dependency-injected: it never opens a socket or runs SQL itself. It
 * drives an injected `client` that reads live database state:
 *
 *   client.replicationRows()  -> Array<{ applicationName, state, syncState }>
 *   client.replicaRecovery()  -> { inRecovery, walReceiverStatus }
 *   client.lagSamples()       -> Array<{ sampleId, sampledAtMs, replayLagSeconds }>
 *                                 (oldest first — written continuously by the
 *                                 primary Node app's background sampler, see
 *                                 local/app/pg-client.mjs's startLagSampler)
 *
 * Each of the 3 checkpoints below resolves to a `{ id, label, passed, detail }`
 * result, one per `scoring.checks[]` entry in metadata.json (same ids). `/verify`
 * grades ONE checkpoint per request (TenkaCloud#2252's checkpointId contract);
 * `evaluateCheckpoint` looks up the matching entry and runs it.
 *
 * ## Why a sampled history, not a single live query, decides this drill
 *
 * `pg_stat_replication.replay_lag` is STALE between applies — confirmed on a
 * real Postgres 16 instance while authoring this drill: it only updates the
 * instant the standby reports having applied a new WAL record, and otherwise
 * holds whatever value it last computed. A single live query at /verify time
 * could easily land in a stale gap and see neither the spike nor the
 * recovery. `audit.lag_samples` is a continuous history, written on a timer
 * for the whole container lifetime, so it can see both moments even though
 * neither is happening at the instant `/verify` is actually called.
 *
 * ## Why "lag-resolved" also re-checks for an earlier spike
 *
 * A replica that was NEVER throttled also has near-zero lag the entire time —
 * that must not pass `lag-resolved` (it never demonstrated fixing anything).
 * So `lag-resolved` requires BOTH the most recent samples to be low AND an
 * earlier sample (older than that recent window) to have been high — i.e. a
 * genuine induce-then-resolve sequence, not "it was always fine".
 */

/** How high replay_lag (seconds) must reach, at least once, to count as "the
 * participant deliberately induced lag" — comfortably below the delay this
 * drill's instructions suggest (recovery_min_apply_delay of several seconds),
 * comfortably above ordinary streaming jitter (which stays well under 1s on
 * this drill's tiny writes — see db-a10-primary-replica for the measured
 * near-0 baseline). */
const LAG_INDUCE_THRESHOLD_SECONDS = 3;

/** How low the most recent samples must be to count as "resolved". */
const LAG_RESOLVE_THRESHOLD_SECONDS = 1;

/** How many of the most recent samples must ALL be low for "resolved" to
 * count — one low sample could be a fluke right after a delayed record
 * finally applies but before the next one starts building up again; several
 * in a row (at the sampler's ~1/second rate — see local/app/server.mjs) is
 * what actually demonstrates sustained recovery, not a blip. */
const RESOLVED_WINDOW_SIZE = 5;

export const CHECKS = [
  {
    id: "streaming-replication-topology-active",
    label: "primary/replica が streaming replication で接続されている",
    async run(client) {
      const rows = await client.replicationRows();
      let recovery;
      try {
        recovery = await client.replicaRecovery();
      } catch {
        recovery = { inRecovery: false, walReceiverStatus: null };
      }
      const streamingRows = rows.filter((r) => r.state === "streaming");
      const primarySeesStreaming = rows.length === 1 && streamingRows.length === 1;
      const passed = primarySeesStreaming && recovery.inRecovery === true && recovery.walReceiverStatus === "streaming";
      const detail = passed
        ? `primary/replica は streaming replication で接続されている — ここから recovery_min_apply_delay を操作する土台が整っている。`
        : `topology がまだ完全に起動していない (primary の streaming 行: ${streamingRows.length}/${rows.length}、replica: in_recovery=${recovery.inRecovery}, wal_receiver=${recovery.walReceiverStatus}) — 少し待って再確認しよう。`;
      return { passed, detail };
    },
  },
  {
    id: "lag-induced",
    label: "replication lag を意図的に発生させた",
    async run(client) {
      const samples = await client.lagSamples();
      const maxLag = samples.reduce(
        (max, s) => (s.replayLagSeconds !== null && s.replayLagSeconds > max ? s.replayLagSeconds : max),
        0,
      );
      const passed = maxLag >= LAG_INDUCE_THRESHOLD_SECONDS;
      const detail = passed
        ? `audit.lag_samples の履歴に、replay_lag が ${maxLag.toFixed(2)} 秒に達した記録がある — lag を意図的に発生させたことが確認できる。`
        : `audit.lag_samples に記録された最大の replay_lag は ${maxLag.toFixed(2)} 秒 (${LAG_INDUCE_THRESHOLD_SECONDS} 秒以上が必要)。replica で recovery_min_apply_delay を上げてから primary へ書き込もう。`;
      return { passed, detail };
    },
  },
  {
    id: "lag-resolved",
    label: "発生させた lag をその後、縮小/解消させた",
    async run(client) {
      const samples = await client.lagSamples();
      if (samples.length < RESOLVED_WINDOW_SIZE) {
        return {
          passed: false,
          detail: `記録された履歴が ${samples.length} 件しかない (${RESOLVED_WINDOW_SIZE} 件以上必要) — もう少し時間を置いてから再確認しよう。`,
        };
      }
      const recent = samples.slice(-RESOLVED_WINDOW_SIZE);
      const earlier = samples.slice(0, samples.length - RESOLVED_WINDOW_SIZE);
      const recentAllLow = recent.every(
        (s) => s.replayLagSeconds !== null && s.replayLagSeconds < LAG_RESOLVE_THRESHOLD_SECONDS,
      );
      const hadEarlierSpike = earlier.some(
        (s) => s.replayLagSeconds !== null && s.replayLagSeconds >= LAG_INDUCE_THRESHOLD_SECONDS,
      );
      const passed = recentAllLow && hadEarlierSpike;
      const detail = passed
        ? `直近 ${RESOLVED_WINDOW_SIZE} 件の replay_lag はすべて ${LAG_RESOLVE_THRESHOLD_SECONDS} 秒未満で、それより前に ${LAG_INDUCE_THRESHOLD_SECONDS} 秒以上の spike も記録されている — lag を発生させてから、その後実際に縮小させたことが確認できる。`
        : !hadEarlierSpike
          ? `直近の replay_lag は低いが、それより前に大きな lag が記録されていない ── 何も発生させていない (最初からずっと低いだけ) 可能性がある。まず lag-induced を満たそう。`
          : `直近 ${RESOLVED_WINDOW_SIZE} 件の replay_lag に ${LAG_RESOLVE_THRESHOLD_SECONDS} 秒以上のものが含まれている ── replica で recovery_min_apply_delay を 0 に戻し、primary へもう一度書き込んでから再確認しよう。`;
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
