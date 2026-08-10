/**
 * Unit tests for the db-a10-primary-replica grader.
 *
 * `bun test` — no live Postgres, no Docker, no network. The fakes model the
 * states a participant's 2-node topology can actually be in (measured
 * against a real, host-run PostgreSQL 16 primary+standby pair while
 * authoring this drill — pg_basebackup -R, a physical replication slot,
 * streaming replication, and recovery_min_apply_delay-free timing); the
 * grader's job is to turn those states into a verdict, so the tests pin
 * exactly that mapping.
 */
import { describe, expect, it } from "bun:test";
import { CHECKS, evaluateCheckpoint, isKnownCheckpoint } from "./grade.mjs";

function replicationRow(overrides = {}) {
  return {
    applicationName: "walreceiver",
    state: "streaming",
    syncState: "async",
    sentLsn: "0/300C358",
    replayLsn: "0/300C358",
    lagBytes: 0,
    ...overrides,
  };
}

/** The replica container has not finished bootstrapping yet (still running
 * pg_basebackup, or hasn't started) — no standby has ever connected. */
class NoReplicaYetClient {
  async replicationRows() {
    return [];
  }
  async replicaRecovery() {
    throw new Error("replica not reachable yet");
  }
  async ledgerCounts() {
    return { primary: { wave1: 0, wave2: 0 }, replica: { wave1: 0, wave2: 0 } };
  }
}

/** The topology is up (entrypoint finished on both sides) but the participant
 * has not written anything yet. */
class StreamingNoWritesClient {
  async replicationRows() {
    return [replicationRow()];
  }
  async replicaRecovery() {
    return { inRecovery: true, walReceiverStatus: "streaming", slotName: "db_a10_replica", senderHost: "primary" };
  }
  async ledgerCounts() {
    return { primary: { wave1: 0, wave2: 0 }, replica: { wave1: 0, wave2: 0 } };
  }
}

/** The correct, real flow: both waves written on primary, both reflected on
 * the replica, replica fully caught up. */
class GenuineFlowClient extends StreamingNoWritesClient {
  async ledgerCounts() {
    return { primary: { wave1: 3, wave2: 3 }, replica: { wave1: 3, wave2: 3 } };
  }
}

/** Only wave-1 has been written so far — the participant has not gotten to
 * the second, later write yet. */
class Wave1OnlyClient extends StreamingNoWritesClient {
  async ledgerCounts() {
    return { primary: { wave1: 3, wave2: 0 }, replica: { wave1: 3, wave2: 0 } };
  }
}

/** The near-miss this drill's design is built around: the replica reflects
 * wave-1 (a copy could explain this alone) but NOT wave-2, even though
 * wave-2 was written on the primary — i.e. whatever the participant is
 * looking at stopped following changes after the first write. Physically
 * impossible for a REAL streaming standby (which has no way to selectively
 * skip a later WAL record) but exactly what the grader must catch if
 * something upstream regresses (e.g. a broken replica that silently
 * disconnected between the two waves). */
class StoppedFollowingAfterWave1Client extends StreamingNoWritesClient {
  async ledgerCounts() {
    return { primary: { wave1: 3, wave2: 3 }, replica: { wave1: 3, wave2: 0 } };
  }
}

/** Both waves are present on the primary and replica, but the replica has
 * fallen behind on WAL it has already been sent (e.g. checked mid-catch-up). */
class LaggingReplicaClient extends StreamingNoWritesClient {
  async replicationRows() {
    return [replicationRow({ lagBytes: 50_000_000, replayLsn: "0/1000000", sentLsn: "0/4000000" })];
  }
  async ledgerCounts() {
    return { primary: { wave1: 3, wave2: 3 }, replica: { wave1: 3, wave2: 3 } };
  }
}

/** The walreceiver dropped (e.g. a network blip) — primary shows no
 * streaming row, replica reports itself still in recovery but with no active
 * receiver. */
class DisconnectedClient extends StreamingNoWritesClient {
  async replicationRows() {
    return [];
  }
  async replicaRecovery() {
    return { inRecovery: true, walReceiverStatus: null, slotName: null, senderHost: null };
  }
}

describe("CHECKS", () => {
  it("declares exactly the 3 checkpoints scoring.checks[] expects", () => {
    expect(CHECKS.map((c) => c.id)).toEqual([
      "streaming-replication-active",
      "writes-follow-to-replica",
      "replica-caught-up",
    ]);
  });

  it("isKnownCheckpoint recognises declared ids and rejects unknown ones", () => {
    for (const check of CHECKS) expect(isKnownCheckpoint(check.id)).toBe(true);
    expect(isKnownCheckpoint("not-a-real-checkpoint")).toBe(false);
  });
});

describe("streaming-replication-active", () => {
  it("fails before the replica has ever connected", async () => {
    expect((await CHECKS[0].run(new NoReplicaYetClient())).passed).toBe(false);
  });

  it("passes once the topology is up, even before any participant write", async () => {
    expect((await CHECKS[0].run(new StreamingNoWritesClient())).passed).toBe(true);
  });

  it("passes on the genuine flow", async () => {
    expect((await CHECKS[0].run(new GenuineFlowClient())).passed).toBe(true);
  });

  it("fails when the walreceiver has disconnected", async () => {
    const result = await CHECKS[0].run(new DisconnectedClient());
    expect(result.passed).toBe(false);
  });
});

describe("writes-follow-to-replica", () => {
  it("fails on the untouched starting state", async () => {
    expect((await CHECKS[1].run(new StreamingNoWritesClient())).passed).toBe(false);
  });

  it("fails after only wave-1 (not yet the second, later write)", async () => {
    const result = await CHECKS[1].run(new Wave1OnlyClient());
    expect(result.passed).toBe(false);
    expect(result.detail).toContain("wave-2");
  });

  it("fails when the replica stopped following after wave-1 (near-miss this drill guards against)", async () => {
    const result = await CHECKS[1].run(new StoppedFollowingAfterWave1Client());
    expect(result.passed).toBe(false);
  });

  it("passes once both waves are reflected on the replica", async () => {
    expect((await CHECKS[1].run(new GenuineFlowClient())).passed).toBe(true);
  });
});

describe("replica-caught-up", () => {
  it("fails before the replica has ever connected (no replication row at all)", async () => {
    expect((await CHECKS[2].run(new NoReplicaYetClient())).passed).toBe(false);
  });

  it("passes once streaming with ~0 lag", async () => {
    expect((await CHECKS[2].run(new StreamingNoWritesClient())).passed).toBe(true);
  });

  it("fails while the replica is meaningfully behind", async () => {
    const result = await CHECKS[2].run(new LaggingReplicaClient());
    expect(result.passed).toBe(false);
  });

  it("passes on the genuine flow", async () => {
    expect((await CHECKS[2].run(new GenuineFlowClient())).passed).toBe(true);
  });
});

describe("evaluateCheckpoint", () => {
  it("grades only the requested checkpoint and echoes a correct/message shape", async () => {
    const verdict = await evaluateCheckpoint(new GenuineFlowClient(), "streaming-replication-active");
    expect(verdict.correct).toBe(true);
    expect(typeof verdict.message).toBe("string");
  });

  it("reports an unknown checkpoint as incorrect rather than throwing", async () => {
    const verdict = await evaluateCheckpoint(new GenuineFlowClient(), "does-not-exist");
    expect(verdict.correct).toBe(false);
  });

  it("the untouched starting state fails writes-follow-to-replica but passes the 2 structural checks", async () => {
    const client = new StreamingNoWritesClient();
    const verdicts = await Promise.all(CHECKS.map((c) => evaluateCheckpoint(client, c.id)));
    expect(verdicts.map((v) => v.correct)).toEqual([true, false, true]);
  });

  it("a fully solved, genuine flow passes all 3 checkpoints", async () => {
    const client = new GenuineFlowClient();
    for (const check of CHECKS) {
      const verdict = await evaluateCheckpoint(client, check.id);
      expect(verdict.correct).toBe(true);
    }
  });

  it("before the replica ever connects, all 3 checkpoints fail", async () => {
    const client = new NoReplicaYetClient();
    const verdicts = await Promise.all(CHECKS.map((c) => evaluateCheckpoint(client, c.id)));
    expect(verdicts.map((v) => v.correct)).toEqual([false, false, false]);
  });
});
