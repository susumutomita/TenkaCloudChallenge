/**
 * db-battle-slow-apparently — automated grader (the primary evaluation).
 *
 * PURE and dependency-injected, same shape as every other Database Track
 * grader (db-a11, db-a12, db-challenge-blocked-transaction): it never opens a
 * socket itself. It drives an injected `client` that reads live/durable
 * state (see local/app/pg-client.mjs for the real implementation):
 *
 *   client.metricsSamples()  -> ordered array of continuous ~1/s samples
 *   client.incidentEpisodes()-> ordered array of retention-worker job runs
 *   client.partitionCatalog()-> Record<name, {exists, attached}>
 *   client.partitionRowCount(name) -> number
 *   client.retentionConfig() -> {strategy, cutoffDate}
 *   client.latestDiagnoses() -> recent /diagnosis submissions (raw fields)
 *   client.unsafePids()      -> every backend pid ever seen running the
 *                                buggy strategy (the Phase 1 ground truth)
 *
 * None of the 7 checkpoints read anything the participant can write
 * directly — episodes and samples come from processes `participant` has no
 * INSERT grant on (see local/db/schema.sql), and partition/row-count facts
 * come from Postgres's own catalog, not from a value anyone can forge.
 */

// ---- Tunable thresholds --------------------------------------------------
// Confirmed against this Battle's own real Docker stack while authoring it
// (see PR description for the actual measured numbers): normal steady-state
// traffic sits comfortably under these, the bad purge clears them by a wide
// margin, and a genuinely resolved incident settles back under them well
// before the sample window this grader looks at ends.
export const SLO_P99_MS = 80;
export const SLO_ERROR_RATE = 0.05;
export const LAG_INDUCED_SECONDS = 2;
export const LAG_RESOLVED_SECONDS = 0.5;
export const CONTAINMENT_GRACE_MS = 10000;
export const RECOVERY_TAIL_MS = 8000;
export const OUTAGE_STREAK_LEN = 5;

export const MECHANISM_CORRECT = "bulk-delete-transaction";
export const TRIGGER_CORRECT = "scheduled-retention-job";
export const FIRST_ACTION_CORRECT = "cancel-offending-transaction";

const PURGE_TARGET_PARTITIONS = [
  "orders_2024_01",
  "orders_2024_02",
  "orders_2024_03",
  "orders_2024_04",
  "orders_2024_05",
  "orders_2024_06",
];
const HELD_BACK_PARTITION = "orders_2024_07";
const ORIGINAL_CUTOFF = "2024-07-01";
const WIDENED_CUTOFF = "2024-08-01";
const SEEDED_HELD_BACK_ROWS = 20_000;

function samplesInWindow(samples, startMs, endMsOrNull) {
  return samples.filter(
    (s) => s.sampledAtMs >= startMs && (endMsOrNull === null || s.sampledAtMs <= endMsOrNull),
  );
}

function hasSustainedOutage(samples) {
  let streak = 0;
  for (const s of samples) {
    if (s.apiErrorRate !== null && s.apiErrorRate >= 0.9) {
      streak += 1;
      if (streak >= OUTAGE_STREAK_LEN) return true;
    } else {
      streak = 0;
    }
  }
  return false;
}

/** True if postmaster start time ever changes across the sample history —
 * the one thing that can only mean "this server actually restarted". */
function everRestarted(samples, field) {
  const seen = new Set(samples.map((s) => s[field]).filter((v) => v !== null));
  return seen.size > 1;
}

/** Consecutive disconnected samples required, WITHIN the incident window, to
 * count as a real drop. Confirmed on this Battle's own Docker stack: the
 * replica's OWN bootstrap (pg_basebackup's replication-mode connection
 * closing, then its real streaming walreceiver connection opening, with a
 * few connect/disconnect samples in between while it catches up) can take
 * several real seconds and multiple samples — entirely before the
 * retention-worker's first episode even begins. A participant actually
 * terminating the replica's backend or restarting it takes at least a
 * couple of real seconds to notice and reconnect too, so a streak
 * requirement alone cannot tell bootstrap noise from a genuine drop; only
 * excluding samples from BEFORE the incident starts can. Requiring a streak
 * on top of that exclusion is defense in depth against any remaining
 * timing noise right at the boundary (e.g. a single interleaved read from
 * two ticks racing) rather than the primary defense — 2 is enough for that. */
const DISCONNECT_STREAK_THRESHOLD = 2;

/** Split at the first moment the retention-worker is ever observed running —
 * see DISCONNECT_STREAK_THRESHOLD's comment for why everything before that
 * is infrastructure bootstrap noise no participant action could have
 * caused. `wasConnectedBeforeIncident` carries forward whether replication
 * was in a stable connected state right as the incident began, so a drop
 * that starts exactly AT the incident (e.g. disconnected for its entire
 * duration) is not missed just because "connected" was never re-observed
 * inside the sliced window before the streak starts. */
function splitAtFirstIncident(samples) {
  const idx = samples.findIndex((s) => s.retentionWorkerState === "running");
  if (idx === -1) return { sinceIncident: samples, wasConnectedBeforeIncident: false };
  const before = samples[idx - 1];
  return { sinceIncident: samples.slice(idx), wasConnectedBeforeIncident: before?.replicationConnected === true };
}

/** True if, once the incident is underway, there is a SUSTAINED run of
 * consecutive samples where replication dropped to disconnected — evidence
 * of "terminate the replica's backend / stop the replica to make lag go
 * away" rather than a graceful catch-up or infrastructure noise. */
function replicationEverDroppedAfterEstablished(samples) {
  const { sinceIncident, wasConnectedBeforeIncident } = splitAtFirstIncident(samples);
  let everConnected = wasConnectedBeforeIncident;
  let disconnectStreak = 0;
  for (const s of sinceIncident) {
    if (s.replicationConnected) {
      everConnected = true;
      disconnectStreak = 0;
      continue;
    }
    if (everConnected) {
      disconnectStreak += 1;
      if (disconnectStreak >= DISCONNECT_STREAK_THRESHOLD) return true;
    }
  }
  return false;
}

function slaBreached(sample) {
  if (sample.apiP99Ms === null && sample.apiErrorRate === null) return false;
  const p99Bad = sample.apiP99Ms !== null && sample.apiP99Ms > SLO_P99_MS;
  const errBad = sample.apiErrorRate !== null && sample.apiErrorRate > SLO_ERROR_RATE;
  return p99Bad || errBad;
}

function lagBreached(sample) {
  return sample.replayLagSeconds !== null && sample.replayLagSeconds > LAG_INDUCED_SECONDS;
}

function findUnsafeCancelledEpisode(episodes) {
  return episodes.find((e) => e.strategy === "unsafe_full_delete" && e.outcome === "cancelled");
}

function findRecurrencePreventionEpisode(episodes) {
  return episodes.find(
    (e) =>
      e.strategy === "partition_aware" &&
      e.outcome === "committed" &&
      e.cutoffDate >= WIDENED_CUTOFF &&
      e.partitions.includes(HELD_BACK_PARTITION),
  );
}

export function isDiagnosisCorrect(submission, validPids) {
  if (!submission) return false;
  return (
    validPids.includes(submission.offendingPid) &&
    submission.mechanism === MECHANISM_CORRECT &&
    submission.triggerSource === TRIGGER_CORRECT &&
    submission.firstAction === FIRST_ACTION_CORRECT
  );
}

export const CHECKS = [
  {
    id: "evidence-based-diagnosis",
    label: "証拠に基づいて、真因メカニズムと安全な最初の一手を言い当てた",
    async run(client) {
      const [diagnoses, validPids] = await Promise.all([client.latestDiagnoses(), client.unsafePids()]);
      if (validPids.length === 0) {
        return { passed: false, detail: "まだ何のインシデントも記録されていない。しばらく待とう。" };
      }
      const passed = diagnoses.some((d) => isDiagnosisCorrect(d, validPids));
      return {
        passed,
        detail: passed
          ? "記録されている実際の backend pid・メカニズム・trigger・最初の一手が正しく揃った提出が見つかった。"
          : "/diagnosis への提出がまだ正しくない。pg_stat_activity で実際の pid を確認し、正しい組み合わせで再提出しよう。",
      };
    },
  },
  {
    id: "safe-containment",
    label: "本番の書き込みを止めずに、悪化の原因を安全に止めた",
    async run(client) {
      const [episodes, samples] = await Promise.all([client.incidentEpisodes(), client.metricsSamples()]);
      const episode = findUnsafeCancelledEpisode(episodes);
      if (!episode) {
        return {
          passed: false,
          detail: "unsafe_full_delete の episode がまだキャンセルされて終わっていない。pg_stat_activity で backend pid を見つけ、pg_cancel_backend() しよう。",
        };
      }
      const windowSamples = samplesInWindow(samples, episode.startedAtMs, (episode.endedAtMs ?? Date.now()) + CONTAINMENT_GRACE_MS);
      const outaged = hasSustainedOutage(windowSamples);
      const restarted = everRestarted(samples, "primaryStartTimeMs") || everRestarted(samples, "replicaStartTimeMs");
      const replicaDropped = replicationEverDroppedAfterEstablished(samples);
      const passed = !outaged && !restarted && !replicaDropped;
      const problems = [];
      if (outaged) problems.push("この間 API のエラー率が高止まりした期間があった (書き込みを止めてしまった可能性)");
      if (restarted) problems.push("primary か replica が再起動した形跡がある");
      if (replicaDropped) problems.push("replication 接続が一度確立した後に切断された形跡がある (replica を無効化した?)");
      return {
        passed,
        detail: passed
          ? `episode #${episode.episodeId} (pid ${episode.backendPid}) は本番を止めずに cancel された。`
          : `cancel はできたが: ${problems.join("; ")}`,
      };
    },
  },
  {
    id: "availability-slo",
    label: "p99 latency と error rate が、実際に崩れてから、実際に持続的に回復した",
    async run(client) {
      const [episodes, samples] = await Promise.all([client.incidentEpisodes(), client.metricsSamples()]);
      const unsafeEpisodes = episodes.filter((e) => e.strategy === "unsafe_full_delete");
      if (unsafeEpisodes.length === 0 || samples.length === 0) {
        return { passed: false, detail: "まだインシデントの記録が無い。" };
      }
      const breachedEarly = samples.some((s) => slaBreached(s));
      const containment = findUnsafeCancelledEpisode(episodes);
      const recovery = findRecurrencePreventionEpisode(episodes) ?? containment;
      if (!breachedEarly) {
        return { passed: false, detail: "SLO 違反そのものが記録されていない (starter がまだ壊れていない状態か、サンプルが足りない)。" };
      }
      if (!containment) {
        return { passed: false, detail: "まだ safe-containment が成立していない。先にそちらを終えよう。" };
      }
      const tailStart = (recovery.endedAtMs ?? containment.endedAtMs) + CONTAINMENT_GRACE_MS;
      const tail = samplesInWindow(samples, tailStart, null);
      const enoughTail = tail.length >= Math.floor(RECOVERY_TAIL_MS / 1000) - 1;
      const allGood = tail.every((s) => !slaBreached(s));
      const passed = enoughTail && allGood;
      return {
        passed,
        detail: passed
          ? "SLO 違反が実際に発生し、containment 後は持続的に回復している。"
          : !enoughTail
            ? "containment 後にまだ十分なサンプルが溜まっていない。数秒待って再スキャンしよう。"
            : "containment 後もまだ SLO 違反のサンプルが残っている。",
      };
    },
  },
  {
    id: "replication-health",
    label: "replication lag が実際に発生してから、実際に元の水準へ戻った",
    async run(client) {
      const [episodes, samples] = await Promise.all([client.incidentEpisodes(), client.metricsSamples()]);
      const containment = findUnsafeCancelledEpisode(episodes);
      if (!containment) return { passed: false, detail: "まだ safe-containment が成立していない。" };
      const induced = samples.some((s) => lagBreached(s));
      const replicaDropped = replicationEverDroppedAfterEstablished(samples);
      const tailStart = containment.endedAtMs + CONTAINMENT_GRACE_MS;
      const tail = samplesInWindow(samples, tailStart, null);
      const enoughTail = tail.length >= Math.floor(RECOVERY_TAIL_MS / 1000) - 1;
      const resolved = tail.every((s) => s.replicationConnected && (s.replayLagSeconds ?? 0) <= LAG_RESOLVED_SECONDS);
      const passed = induced && !replicaDropped && enoughTail && resolved;
      const problems = [];
      if (!induced) problems.push("lag が閾値を超えた記録が無い");
      if (replicaDropped) problems.push("replication 接続が切断された形跡がある");
      if (induced && !replicaDropped && !enoughTail) problems.push("containment 後のサンプルがまだ足りない");
      if (induced && !replicaDropped && enoughTail && !resolved) problems.push("containment 後も lag が高いままのサンプルがある");
      return {
        passed,
        detail: passed ? "lag は実際に発生し、その後実際に解消して安定した。" : problems.join("; "),
      };
    },
  },
  {
    id: "correct-purge-strategy",
    label: "対象の古い partition を DELETE ではなく DETACH/DROP で片付けた",
    async run(client) {
      const catalog = await client.partitionCatalog();
      const remaining = PURGE_TARGET_PARTITIONS.filter((name) => {
        const state = catalog[name];
        return state.exists && state.attached;
      });
      const passed = remaining.length === 0;
      return {
        passed,
        detail: passed
          ? "2024-01〜06 の partition は全て DETACH または DROP 済みだ。"
          : `まだ attach されたままの partition がある: ${remaining.join(", ")}。row 単位の DELETE ではなく、partition ごと外す方法を検討しよう。`,
      };
    },
  },
  {
    id: "purge-completion-correctness",
    label: "対象データは残さず消し、対象外データは 1 件も壊さなかった",
    async run(client) {
      const [catalog, config, samples] = await Promise.all([
        client.partitionCatalog(),
        client.retentionConfig(),
        client.metricsSamples(),
      ]);
      const leftoverRows = [];
      for (const name of PURGE_TARGET_PARTITIONS) {
        const state = catalog[name];
        if (state.exists && state.attached) {
          const n = await client.partitionRowCount(name);
          if (n > 0) leftoverRows.push(`${name}(${n})`);
        }
      }
      const problems = [];
      if (leftoverRows.length > 0) problems.push(`まだ行が残っている: ${leftoverRows.join(", ")}`);

      // The held-back partition must stay fully intact for as long as the
      // ORIGINAL cutoff is still in effect — touching it before Phase 4 is
      // exactly the "deleted data that wasn't due yet" mistake.
      if (config.cutoffDate === ORIGINAL_CUTOFF) {
        const heldBack = catalog[HELD_BACK_PARTITION];
        if (!heldBack.exists || !heldBack.attached) {
          problems.push(`${HELD_BACK_PARTITION} はまだ対象外のはずなのに attach されていない`);
        } else {
          const n = await client.partitionRowCount(HELD_BACK_PARTITION);
          if (n !== SEEDED_HELD_BACK_ROWS) {
            problems.push(`${HELD_BACK_PARTITION} の行数が ${n} (期待値 ${SEEDED_HELD_BACK_ROWS})`);
          }
        }
      }

      // orders_current (live/protected traffic) must never have DECREASED
      // anywhere in its whole continuous history.
      let prev = null;
      let everDropped = false;
      for (const s of samples) {
        if (prev !== null && s.currentPartitionRowCount < prev) everDropped = true;
        prev = s.currentPartitionRowCount;
      }
      if (everDropped) problems.push("orders_current の行数が一度でも減った形跡がある (現在稼働中のデータを壊した可能性)");

      const passed = problems.length === 0;
      return { passed, detail: passed ? "対象データは完全に消え、対象外データは無傷だ。" : problems.join("; ") };
    },
  },
  {
    id: "recurrence-prevention",
    label: "retention job を直し、同じ日次実行が二度と SLO を壊さないと確認した",
    async run(client) {
      const [episodes, samples, config] = await Promise.all([
        client.incidentEpisodes(),
        client.metricsSamples(),
        client.retentionConfig(),
      ]);
      if (config.strategy !== "partition_aware" || config.cutoffDate < WIDENED_CUTOFF) {
        return {
          passed: false,
          detail: "ops.retention_config をまだ partition_aware / 2024-08-01 以降へ更新していない。",
        };
      }
      const episode = findRecurrencePreventionEpisode(episodes);
      if (!episode) {
        return {
          passed: false,
          detail: "設定は直っているが、job がまだ 2024-07 分を partition_aware で処理し切っていない。数秒待って再スキャンしよう。",
        };
      }
      const windowSamples = samplesInWindow(samples, episode.startedAtMs - 1000, episode.endedAtMs + CONTAINMENT_GRACE_MS);
      const anySlaBreach = windowSamples.some((s) => slaBreached(s));
      const anyLagBreach = windowSamples.some((s) => lagBreached(s));
      const passed = !anySlaBreach && !anyLagBreach;
      return {
        passed,
        detail: passed
          ? "修正後の job 実行 (2024-07 分) は SLO も replication lag も壊さずに完了した。"
          : "設定は直り job も完走したが、その実行中に SLO か lag の悪化が記録された。",
      };
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
  if (!check) return { correct: false, message: "unknown checkpoint" };
  const { passed, detail } = await check.run(client);
  return { correct: passed, message: detail };
}
