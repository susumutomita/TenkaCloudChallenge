/**
 * Unit tests for the db-battle-slow-apparently grader.
 *
 * `bun test` — no live Postgres, no Docker, no network. The fake client
 * models the histories a real playthrough produces (an unsafe episode that
 * gets cancelled, a metrics-sample history that breaches then recovers, a
 * later partition_aware replay) so the grader's job — turning that history
 * into a verdict — is what these tests pin down.
 */
import { describe, expect, it } from "bun:test";
import {
  CHECKS,
  evaluateCheckpoint,
  FIRST_ACTION_CORRECT,
  isDiagnosisCorrect,
  isKnownCheckpoint,
  MECHANISM_CORRECT,
  TRIGGER_CORRECT,
} from "./grade.mjs";

const ALL_PARTITIONS = [
  "orders_2024_01",
  "orders_2024_02",
  "orders_2024_03",
  "orders_2024_04",
  "orders_2024_05",
  "orders_2024_06",
  "orders_2024_07",
];

function attachedCatalog(overrides = {}) {
  const catalog = {};
  for (const name of ALL_PARTITIONS) catalog[name] = { exists: true, attached: true };
  return { ...catalog, ...overrides };
}

function sample(overrides, sampleId, sampledAtMs) {
  return {
    sampleId,
    sampledAtMs,
    apiP99Ms: 50,
    apiErrorRate: 0,
    replicationConnected: true,
    replayLagSeconds: 0.1,
    primaryStartTimeMs: 1000,
    replicaStartTimeMs: 1000,
    longTxnSeconds: null,
    retentionWorkerState: "idle",
    currentPartitionRowCount: 3000,
    ...overrides,
  };
}

/** Build a plausible full-run sample series: baseline -> breach (unsafe
 * episode running) -> containment gap -> recovered tail. */
function fullRunSamples({ recoveredTailLen = 12, replicaDropped = false, restarted = false } = {}) {
  const rows = [];
  let t = 0;
  const push = (overrides) => {
    rows.push(sample(overrides, rows.length + 1, t));
    t += 1000;
  };
  // baseline, healthy
  for (let i = 0; i < 3; i += 1) push({});
  // incident: SLO breach + lag induced + long txn observed
  for (let i = 0; i < 8; i += 1) {
    push({
      apiP99Ms: 900,
      apiErrorRate: 0.2,
      replayLagSeconds: 5,
      longTxnSeconds: 8 + i,
      retentionWorkerState: "running",
      replicationConnected: !replicaDropped,
      primaryStartTimeMs: restarted && i === 4 ? 2000 : 1000,
    });
  }
  // recovered tail
  for (let i = 0; i < recoveredTailLen; i += 1) push({});
  return rows;
}

function unsafeCancelledEpisode(startedAtMs, endedAtMs) {
  return {
    episodeId: 1,
    backendPid: 4242,
    strategy: "unsafe_full_delete",
    cutoffDate: "2024-07-01",
    partitions: ["orders_2024_01", "orders_2024_02", "orders_2024_03", "orders_2024_04", "orders_2024_05", "orders_2024_06"],
    startedAtMs,
    endedAtMs,
    outcome: "cancelled",
  };
}

function recurrenceEpisode(startedAtMs, endedAtMs) {
  return {
    episodeId: 2,
    backendPid: 5252,
    strategy: "partition_aware",
    cutoffDate: "2024-08-01",
    partitions: ["orders_2024_07"],
    startedAtMs,
    endedAtMs,
    outcome: "committed",
  };
}

class Client {
  constructor({
    samples = [],
    episodes = [],
    catalog = attachedCatalog(),
    rowCounts = {},
    config = { strategy: "unsafe_full_delete", cutoffDate: "2024-07-01" },
    diagnoses = [],
    unsafePids = [],
  } = {}) {
    this._samples = samples;
    this._episodes = episodes;
    this._catalog = catalog;
    this._rowCounts = rowCounts;
    this._config = config;
    this._diagnoses = diagnoses;
    this._unsafePids = unsafePids;
  }
  async metricsSamples() {
    return this._samples;
  }
  async incidentEpisodes() {
    return this._episodes;
  }
  async partitionCatalog() {
    return this._catalog;
  }
  async partitionRowCount(name) {
    return this._rowCounts[name] ?? 0;
  }
  async retentionConfig() {
    return this._config;
  }
  async latestDiagnoses() {
    return this._diagnoses;
  }
  async unsafePids() {
    return this._unsafePids;
  }
}

const byId = Object.fromEntries(CHECKS.map((c) => [c.id, c]));

describe("CHECKS", () => {
  it("declares exactly the 7 checkpoints scoring.checks[] expects", () => {
    expect(CHECKS.map((c) => c.id)).toEqual([
      "evidence-based-diagnosis",
      "safe-containment",
      "availability-slo",
      "replication-health",
      "correct-purge-strategy",
      "purge-completion-correctness",
      "recurrence-prevention",
    ]);
  });

  it("isKnownCheckpoint recognises declared ids and rejects unknown ones", () => {
    for (const check of CHECKS) expect(isKnownCheckpoint(check.id)).toBe(true);
    expect(isKnownCheckpoint("not-a-real-checkpoint")).toBe(false);
  });
});

describe("isDiagnosisCorrect", () => {
  const good = { offendingPid: 4242, mechanism: MECHANISM_CORRECT, triggerSource: TRIGGER_CORRECT, firstAction: FIRST_ACTION_CORRECT };

  it("passes only the exact correct combination", () => {
    expect(isDiagnosisCorrect(good, [4242])).toBe(true);
  });

  it("fails on the CPU decoy pid", () => {
    expect(isDiagnosisCorrect({ ...good, offendingPid: 9999 }, [4242])).toBe(false);
  });

  it("fails on a plausible-but-wrong mechanism (the CPU decoy diagnosis)", () => {
    expect(isDiagnosisCorrect({ ...good, mechanism: "cpu-starvation" }, [4242])).toBe(false);
  });

  it("fails when the recommended first action is an escalation instead of a safe cancel", () => {
    for (const wrong of ["restart-primary", "stop-replica", "terminate-application-writes"]) {
      expect(isDiagnosisCorrect({ ...good, firstAction: wrong }, [4242])).toBe(false);
    }
  });

  it("fails on a null/missing submission", () => {
    expect(isDiagnosisCorrect(null, [4242])).toBe(false);
    expect(isDiagnosisCorrect({}, [4242])).toBe(false);
  });
});

describe("evidence-based-diagnosis", () => {
  it("fails before any incident has ever been recorded", async () => {
    const client = new Client({ unsafePids: [] });
    expect((await byId["evidence-based-diagnosis"].run(client)).passed).toBe(false);
  });

  it("fails when the only submission names the CPU decoy", async () => {
    const client = new Client({
      unsafePids: [4242],
      diagnoses: [{ offendingPid: 4242, mechanism: "cpu-starvation", triggerSource: TRIGGER_CORRECT, firstAction: FIRST_ACTION_CORRECT }],
    });
    expect((await byId["evidence-based-diagnosis"].run(client)).passed).toBe(false);
  });

  it("passes once a correct submission exists among the history", async () => {
    const client = new Client({
      unsafePids: [4242],
      diagnoses: [
        { offendingPid: 1, mechanism: "cpu-starvation", triggerSource: "unknown", firstAction: "restart-primary" },
        { offendingPid: 4242, mechanism: MECHANISM_CORRECT, triggerSource: TRIGGER_CORRECT, firstAction: FIRST_ACTION_CORRECT },
      ],
    });
    expect((await byId["evidence-based-diagnosis"].run(client)).passed).toBe(true);
  });
});

describe("safe-containment", () => {
  it("fails when no episode was ever cancelled", async () => {
    const client = new Client({ episodes: [], samples: fullRunSamples() });
    expect((await byId["safe-containment"].run(client)).passed).toBe(false);
  });

  it("passes for a clean cancel with no outage/restart/replica-drop", async () => {
    const samples = fullRunSamples();
    const episode = unsafeCancelledEpisode(samples[3].sampledAtMs, samples[10].sampledAtMs);
    const client = new Client({ episodes: [episode], samples });
    const result = await byId["safe-containment"].run(client);
    expect(result.passed).toBe(true);
  });

  it("fails when the API had a sustained outage during containment (e.g. writes were stopped)", async () => {
    const samples = fullRunSamples();
    for (let i = 3; i < 3 + 6; i += 1) samples[i].apiErrorRate = 1;
    const episode = unsafeCancelledEpisode(samples[3].sampledAtMs, samples[10].sampledAtMs);
    const client = new Client({ episodes: [episode], samples });
    expect((await byId["safe-containment"].run(client)).passed).toBe(false);
  });

  it("fails when the primary restarted at some point", async () => {
    const samples = fullRunSamples({ restarted: true });
    const episode = unsafeCancelledEpisode(samples[3].sampledAtMs, samples[10].sampledAtMs);
    const client = new Client({ episodes: [episode], samples });
    expect((await byId["safe-containment"].run(client)).passed).toBe(false);
  });

  it("fails when the replica connection was dropped (sustained, 2+ samples) after being established", async () => {
    const samples = fullRunSamples();
    samples[0].replicationConnected = true;
    samples[5].replicationConnected = false;
    samples[6].replicationConnected = false; // a REAL drop takes the replica a moment to reconnect
    const episode = unsafeCancelledEpisode(samples[3].sampledAtMs, samples[10].sampledAtMs);
    const client = new Client({ episodes: [episode], samples });
    expect((await byId["safe-containment"].run(client)).passed).toBe(false);
  });

  it("does not flag a single isolated disconnected sample (the replica's own bootstrap blip)", async () => {
    // Confirmed on this Battle's own Docker stack: pg_basebackup's
    // replication-mode connection closing, then the real streaming
    // walreceiver connection opening shortly after, produces exactly one
    // isolated disconnected sample before anything relevant to grading has
    // even started — nothing a participant could have done to cause it.
    const samples = fullRunSamples();
    samples[0].replicationConnected = true;
    samples[1].replicationConnected = false; // one isolated sample, not a streak
    const episode = unsafeCancelledEpisode(samples[3].sampledAtMs, samples[10].sampledAtMs);
    const client = new Client({ episodes: [episode], samples });
    expect((await byId["safe-containment"].run(client)).passed).toBe(true);
  });

  it("does not flag a SUSTAINED pre-incident bootstrap gap (the replica takes several real samples to finish pg_basebackup)", async () => {
    // Confirmed on this Battle's own Docker stack: real boot sequences look
    // like disconnected, disconnected, connected, connected, disconnected,
    // disconnected, disconnected, THEN connected for good — a multi-sample
    // gap, not just one blip — entirely before the retention-worker's first
    // episode starts. A streak requirement alone cannot tell this apart from
    // a genuine drop; only excluding samples from before the incident began
    // can (see samplesSinceFirstIncident).
    const samples = fullRunSamples();
    samples[0].replicationConnected = false;
    samples[1].replicationConnected = false;
    samples[2].replicationConnected = true; // still all BEFORE index 3, where "running" starts
    const episode = unsafeCancelledEpisode(samples[3].sampledAtMs, samples[10].sampledAtMs);
    const client = new Client({ episodes: [episode], samples });
    expect((await byId["safe-containment"].run(client)).passed).toBe(true);
  });
});

describe("availability-slo", () => {
  it("fails when no breach was ever recorded (starter never actually broke)", async () => {
    const samples = Array.from({ length: 20 }, (_, i) => sample({}, i + 1, i * 1000));
    const client = new Client({
      episodes: [unsafeCancelledEpisode(0, 5000)],
      samples,
    });
    expect((await byId["availability-slo"].run(client)).passed).toBe(false);
  });

  it("fails while still mid-incident (not contained yet)", async () => {
    const samples = fullRunSamples().slice(0, 6); // breach happening, no containment yet
    const client = new Client({ episodes: [], samples });
    expect((await byId["availability-slo"].run(client)).passed).toBe(false);
  });

  it("passes once breached-then-sustained-recovered", async () => {
    const samples = fullRunSamples({ recoveredTailLen: 20 });
    const episode = unsafeCancelledEpisode(samples[3].sampledAtMs, samples[10].sampledAtMs);
    const client = new Client({ episodes: [episode], samples });
    expect((await byId["availability-slo"].run(client)).passed).toBe(true);
  });

  it("fails when the recovered tail is too short to call it sustained", async () => {
    const samples = fullRunSamples({ recoveredTailLen: 2 });
    const episode = unsafeCancelledEpisode(samples[3].sampledAtMs, samples[10].sampledAtMs);
    const client = new Client({ episodes: [episode], samples });
    expect((await byId["availability-slo"].run(client)).passed).toBe(false);
  });
});

describe("replication-health", () => {
  it("fails without a containment episode", async () => {
    const client = new Client({ episodes: [], samples: fullRunSamples() });
    expect((await byId["replication-health"].run(client)).passed).toBe(false);
  });

  it("passes once lag rose then genuinely settled after containment", async () => {
    const samples = fullRunSamples({ recoveredTailLen: 20 });
    const episode = unsafeCancelledEpisode(samples[3].sampledAtMs, samples[10].sampledAtMs);
    const client = new Client({ episodes: [episode], samples });
    expect((await byId["replication-health"].run(client)).passed).toBe(true);
  });

  it("fails if lag never actually rose (near-miss: nothing to resolve)", async () => {
    const samples = fullRunSamples({ recoveredTailLen: 20 }).map((s) => ({ ...s, replayLagSeconds: 0.05 }));
    const episode = unsafeCancelledEpisode(samples[3].sampledAtMs, samples[10].sampledAtMs);
    const client = new Client({ episodes: [episode], samples });
    expect((await byId["replication-health"].run(client)).passed).toBe(false);
  });

  it("fails if the replica was disconnected at any point (faking resolution)", async () => {
    const samples = fullRunSamples({ replicaDropped: true, recoveredTailLen: 20 });
    const episode = unsafeCancelledEpisode(samples[3].sampledAtMs, samples[10].sampledAtMs);
    const client = new Client({ episodes: [episode], samples });
    expect((await byId["replication-health"].run(client)).passed).toBe(false);
  });
});

describe("correct-purge-strategy", () => {
  it("fails while any target partition is still attached", async () => {
    const client = new Client({ catalog: attachedCatalog() });
    expect((await byId["correct-purge-strategy"].run(client)).passed).toBe(false);
  });

  it("fails when partitions were emptied via DELETE instead of DETACH/DROP (still attached)", async () => {
    const catalog = attachedCatalog({
      orders_2024_01: { exists: true, attached: true },
    });
    const client = new Client({ catalog, rowCounts: { orders_2024_01: 0 } });
    expect((await byId["correct-purge-strategy"].run(client)).passed).toBe(false);
  });

  it("passes once all 6 target partitions are detached/dropped, held-back one untouched", async () => {
    const catalog = attachedCatalog({
      orders_2024_01: { exists: false, attached: false },
      orders_2024_02: { exists: false, attached: false },
      orders_2024_03: { exists: true, attached: false },
      orders_2024_04: { exists: false, attached: false },
      orders_2024_05: { exists: false, attached: false },
      orders_2024_06: { exists: false, attached: false },
    });
    const client = new Client({ catalog });
    expect((await byId["correct-purge-strategy"].run(client)).passed).toBe(true);
  });
});

describe("purge-completion-correctness", () => {
  it("fails when a target partition still has leftover rows", async () => {
    const catalog = attachedCatalog({ orders_2024_01: { exists: true, attached: true } });
    const client = new Client({ catalog, rowCounts: { orders_2024_01: 500 } });
    expect((await byId["purge-completion-correctness"].run(client)).passed).toBe(false);
  });

  it("fails when the held-back partition was touched early, before the job itself released it", async () => {
    const catalog = attachedCatalog({
      orders_2024_01: { exists: false, attached: false },
      orders_2024_02: { exists: false, attached: false },
      orders_2024_03: { exists: false, attached: false },
      orders_2024_04: { exists: false, attached: false },
      orders_2024_05: { exists: false, attached: false },
      orders_2024_06: { exists: false, attached: false },
      orders_2024_07: { exists: false, attached: false },
    });
    const client = new Client({ catalog, config: { strategy: "unsafe_full_delete", cutoffDate: "2024-07-01" } });
    expect((await byId["purge-completion-correctness"].run(client)).passed).toBe(false);
  });

  it("fails when orders_current ever decreased (protected/current data destroyed)", async () => {
    const catalog = attachedCatalog({
      orders_2024_01: { exists: false, attached: false },
      orders_2024_02: { exists: false, attached: false },
      orders_2024_03: { exists: false, attached: false },
      orders_2024_04: { exists: false, attached: false },
      orders_2024_05: { exists: false, attached: false },
      orders_2024_06: { exists: false, attached: false },
    });
    const samples = [
      sample({ currentPartitionRowCount: 3000 }, 1, 0),
      sample({ currentPartitionRowCount: 3010 }, 2, 1000),
      sample({ currentPartitionRowCount: 2000 }, 3, 2000), // dropped!
      sample({ currentPartitionRowCount: 3020 }, 4, 3000),
    ];
    const client = new Client({
      catalog,
      rowCounts: { orders_2024_07: 20000 },
      config: { strategy: "unsafe_full_delete", cutoffDate: "2024-07-01" },
      samples,
    });
    expect((await byId["purge-completion-correctness"].run(client)).passed).toBe(false);
  });

  it("passes for a clean, correct purge with untouched held-back partition and monotonic current count", async () => {
    const catalog = attachedCatalog({
      orders_2024_01: { exists: false, attached: false },
      orders_2024_02: { exists: false, attached: false },
      orders_2024_03: { exists: false, attached: false },
      orders_2024_04: { exists: false, attached: false },
      orders_2024_05: { exists: false, attached: false },
      orders_2024_06: { exists: false, attached: false },
    });
    const samples = [
      sample({ currentPartitionRowCount: 3000 }, 1, 0),
      sample({ currentPartitionRowCount: 3050 }, 2, 1000),
      sample({ currentPartitionRowCount: 3100 }, 3, 2000),
    ];
    const client = new Client({
      catalog,
      rowCounts: { orders_2024_07: 20000 },
      config: { strategy: "unsafe_full_delete", cutoffDate: "2024-07-01" },
      samples,
    });
    expect((await byId["purge-completion-correctness"].run(client)).passed).toBe(true);
  });
});

describe("recurrence-prevention", () => {
  it("fails when the config still points at the unsafe strategy", async () => {
    const client = new Client({ config: { strategy: "unsafe_full_delete", cutoffDate: "2024-07-01" } });
    expect((await byId["recurrence-prevention"].run(client)).passed).toBe(false);
  });

  it("fails when the config is fixed but the job has not processed the widened cutoff yet", async () => {
    const client = new Client({ config: { strategy: "partition_aware", cutoffDate: "2024-08-01" }, episodes: [] });
    expect((await byId["recurrence-prevention"].run(client)).passed).toBe(false);
  });

  it("passes when a partition_aware replay committed cleanly with no SLA/lag breach", async () => {
    const samples = [
      sample({}, 1, 0),
      sample({}, 2, 1000),
      sample({}, 3, 2000),
    ];
    const episode = recurrenceEpisode(500, 1500);
    const client = new Client({
      config: { strategy: "partition_aware", cutoffDate: "2024-08-01" },
      episodes: [episode],
      samples,
    });
    expect((await byId["recurrence-prevention"].run(client)).passed).toBe(true);
  });

  it("fails when the replay itself caused an SLO breach (fix applied too late / half-heartedly)", async () => {
    const samples = [
      sample({}, 1, 0),
      sample({ apiP99Ms: 900 }, 2, 1000),
      sample({}, 3, 2000),
    ];
    const episode = recurrenceEpisode(500, 1500);
    const client = new Client({
      config: { strategy: "partition_aware", cutoffDate: "2024-08-01" },
      episodes: [episode],
      samples,
    });
    expect((await byId["recurrence-prevention"].run(client)).passed).toBe(false);
  });
});

describe("evaluateCheckpoint", () => {
  it("grades only the requested checkpoint and echoes a correct/message shape", async () => {
    const client = new Client({ unsafePids: [] });
    const verdict = await evaluateCheckpoint(client, "evidence-based-diagnosis");
    expect(verdict.correct).toBe(false);
    expect(typeof verdict.message).toBe("string");
  });

  it("reports an unknown checkpoint as incorrect rather than throwing", async () => {
    const client = new Client();
    const verdict = await evaluateCheckpoint(client, "does-not-exist");
    expect(verdict.correct).toBe(false);
  });
});
