/**
 * Unit tests for the db-a11-replication-lag grader.
 *
 * `bun test` — no live Postgres, no Docker, no network. The fakes model the
 * sample histories a participant's 2-node topology can actually produce
 * (measured against a real, host-run PostgreSQL 16 primary+standby pair
 * while authoring this drill — `recovery_min_apply_delay` genuinely holds
 * back apply, `pg_stat_replication.replay_lag` genuinely spikes to the delay
 * value the instant the held-back record finally applies, and genuinely
 * settles back near 0 once the delay is reset and a further write commits);
 * the grader's job is to turn a sample history into a verdict, so the tests
 * pin exactly that mapping.
 */
import { describe, expect, it } from "bun:test";
import { CHECKS, evaluateCheckpoint, isKnownCheckpoint } from "./grade.mjs";

function sample(replayLagSeconds, sampleId) {
  return { sampleId, sampledAtMs: 1_800_000_000_000 + sampleId * 1000, replayLagSeconds };
}

/** Build an ascending sample series from a plain array of lag values (or
 * null for "no replica connected yet" gaps). */
function series(values) {
  return values.map((v, i) => sample(v, i + 1));
}

class Client {
  constructor({ rows = [], recovery = { inRecovery: true, walReceiverStatus: "streaming" }, samples = [] } = {}) {
    this._rows = rows;
    this._recovery = recovery;
    this._samples = samples;
  }
  async replicationRows() {
    return this._rows;
  }
  async replicaRecovery() {
    if (this._recovery instanceof Error) throw this._recovery;
    return this._recovery;
  }
  async lagSamples() {
    return this._samples;
  }
}

const STREAMING_ROW = [{ applicationName: "walreceiver", state: "streaming", syncState: "async" }];

describe("CHECKS", () => {
  it("declares exactly the 3 checkpoints scoring.checks[] expects", () => {
    expect(CHECKS.map((c) => c.id)).toEqual([
      "streaming-replication-topology-active",
      "lag-induced",
      "lag-resolved",
    ]);
  });

  it("isKnownCheckpoint recognises declared ids and rejects unknown ones", () => {
    for (const check of CHECKS) expect(isKnownCheckpoint(check.id)).toBe(true);
    expect(isKnownCheckpoint("not-a-real-checkpoint")).toBe(false);
  });
});

describe("streaming-replication-topology-active", () => {
  it("fails before the replica has ever connected", async () => {
    const client = new Client({ rows: [], recovery: new Error("unreachable") });
    expect((await CHECKS[0].run(client)).passed).toBe(false);
  });

  it("passes once the topology is up", async () => {
    const client = new Client({ rows: STREAMING_ROW });
    expect((await CHECKS[0].run(client)).passed).toBe(true);
  });
});

describe("lag-induced", () => {
  it("fails on an empty history", async () => {
    const client = new Client({ samples: [] });
    expect((await CHECKS[1].run(client)).passed).toBe(false);
  });

  it("fails when lag stayed low the entire time (replica never throttled)", async () => {
    const client = new Client({ samples: series([0, 0.01, 0.02, 0.01, 0, 0.03]) });
    expect((await CHECKS[1].run(client)).passed).toBe(false);
  });

  it("fails when lag rose but stayed under the threshold", async () => {
    const client = new Client({ samples: series([0, 0.5, 1.2, 2.9, 1.0]) });
    expect((await CHECKS[1].run(client)).passed).toBe(false);
  });

  it("passes once a sample reaches the induce threshold", async () => {
    const client = new Client({ samples: series([0, 0.1, 4.8, 0.1]) });
    const result = await CHECKS[1].run(client);
    expect(result.passed).toBe(true);
    expect(result.detail).toContain("4.80");
  });

  it("ignores null samples (no replica connected at that moment) without crashing", async () => {
    const client = new Client({ samples: series([null, null, 5.0, null]) });
    expect((await CHECKS[1].run(client)).passed).toBe(true);
  });
});

describe("lag-resolved", () => {
  it("fails when there is not enough history yet", async () => {
    const client = new Client({ samples: series([0, 0.1]) });
    const result = await CHECKS[2].run(client);
    expect(result.passed).toBe(false);
    expect(result.detail).toContain("2");
  });

  it("fails when it was never induced (always low) — the near-miss this drill guards against", async () => {
    const client = new Client({ samples: series([0, 0.01, 0.02, 0.01, 0, 0.02, 0.01, 0]) });
    const result = await CHECKS[2].run(client);
    expect(result.passed).toBe(false);
    expect(result.detail).toContain("何も発生させていない");
  });

  it("fails while still lagging (induced but not yet resolved)", async () => {
    const client = new Client({ samples: series([0, 0.1, 8.0, 8.0, 8.0, 8.0, 8.0]) });
    expect((await CHECKS[2].run(client)).passed).toBe(false);
  });

  it("fails on a single low sample right after a spike (not sustained)", async () => {
    // The delayed record just applied (spike), then only ONE fresh low
    // sample so far — not the full RESOLVED_WINDOW_SIZE of sustained low.
    const client = new Client({ samples: series([0, 0.1, 8.0, 0.05]) });
    expect((await CHECKS[2].run(client)).passed).toBe(false);
  });

  it("passes once resolved: an earlier spike, then a sustained low tail", async () => {
    const client = new Client({
      samples: series([0, 0.1, 8.0, 8.0, 0.02, 0.01, 0.03, 0.02, 0.01]),
    });
    const result = await CHECKS[2].run(client);
    expect(result.passed).toBe(true);
  });

  it("passes for a second induce/resolve cycle too (spike, dip, spike again, resolve again)", async () => {
    const client = new Client({
      samples: series([0, 5.0, 0.02, 0.01, 6.0, 6.0, 0.03, 0.02, 0.01, 0.02, 0.01]),
    });
    expect((await CHECKS[2].run(client)).passed).toBe(true);
  });
});

describe("evaluateCheckpoint", () => {
  it("grades only the requested checkpoint and echoes a correct/message shape", async () => {
    const client = new Client({ rows: STREAMING_ROW });
    const verdict = await evaluateCheckpoint(client, "streaming-replication-topology-active");
    expect(verdict.correct).toBe(true);
    expect(typeof verdict.message).toBe("string");
  });

  it("reports an unknown checkpoint as incorrect rather than throwing", async () => {
    const client = new Client({ rows: STREAMING_ROW });
    const verdict = await evaluateCheckpoint(client, "does-not-exist");
    expect(verdict.correct).toBe(false);
  });

  it("the untouched starting state fails lag-induced and lag-resolved but may pass the topology check", async () => {
    const client = new Client({ rows: STREAMING_ROW, samples: series([0, 0.01, 0.02, 0.01, 0.02]) });
    const verdicts = await Promise.all(CHECKS.map((c) => evaluateCheckpoint(client, c.id)));
    expect(verdicts.map((v) => v.correct)).toEqual([true, false, false]);
  });

  it("a fully solved, genuine induce-then-resolve flow passes all 3 checkpoints", async () => {
    const client = new Client({
      rows: STREAMING_ROW,
      samples: series([0, 0.1, 7.5, 7.5, 0.02, 0.01, 0.03, 0.02, 0.01]),
    });
    for (const check of CHECKS) {
      const verdict = await evaluateCheckpoint(client, check.id);
      expect(verdict.correct).toBe(true);
    }
  });
});
