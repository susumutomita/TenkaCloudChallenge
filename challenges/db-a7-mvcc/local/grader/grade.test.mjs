/**
 * Unit tests for the db-a7-mvcc grader.
 *
 * `bun test` — no live Postgres, no Docker, no network. The fakes model the
 * states a participant's database can actually be in (measured against a real
 * Postgres 16 instance while authoring this drill); the grader's job is to turn
 * those states into a verdict, so the tests pin exactly that mapping.
 */
import { describe, expect, it } from "bun:test";
import { CHECKS, evaluateCheckpoint, isKnownCheckpoint } from "./grade.mjs";

/** Build a churn log entry. `heldOpenMs` is how long, at logging time, the
 * concurrent long transaction (if any) had already been open. */
function entry(ticketId, backendPid, heldOpenMs) {
  const loggedAtMs = 1_000_000;
  return {
    ticketId,
    op: "update",
    backendPid,
    loggedAtMs,
    concurrentLongTxStartedAtMs: heldOpenMs === null ? null : loggedAtMs - heldOpenMs,
  };
}

/** The untouched starting state: nothing has happened yet. */
class UntouchedClient {
  async referenceNote() {
    return "do-not-touch";
  }
  async ticketStats() {
    return { nLiveTup: 5, nDeadTup: 0, nTupUpd: 0, nTupDel: 0 };
  }
  async churnLog() {
    return [];
  }
}

/** The correct, real flow: a long `repeatable read` transaction (pid 100) is
 * open (its snapshot pinned by an actual query) while a second session
 * (pid 200) churns 30 UPDATEs — all logged with a genuinely held-open long tx
 * (held for 2s+, well above the 300ms floor). The long tx is then closed and
 * VACUUM run, reclaiming everything. */
class GenuineFlowClient {
  async referenceNote() {
    return "do-not-touch";
  }
  async ticketStats() {
    return { nLiveTup: 5, nDeadTup: 0, nTupUpd: 30, nTupDel: 0 };
  }
  async churnLog() {
    return Array.from({ length: 30 }, (_, i) => entry((i % 5) + 1, 200, 2000));
  }
}

/** The shortcut: churn happened (right numbers, table ends up clean), but no
 * long transaction was ever open anywhere while it did — every entry has
 * concurrentLongTxStartedAtMs === null (this is what a plain, uneventful
 * UPDATE loop produces). Reaches a clean final table with no lesson learned. */
class ChurnWithNoLongTxClient {
  async referenceNote() {
    return "do-not-touch";
  }
  async ticketStats() {
    return { nLiveTup: 5, nDeadTup: 0, nTupUpd: 30, nTupDel: 0 };
  }
  async churnLog() {
    return Array.from({ length: 30 }, (_, i) => entry((i % 5) + 1, 200, null));
  }
}

/** Long tx was genuinely open and churn happened under it, but the participant
 * never closed the long tx and re-ran VACUUM afterward — dead tuples are still
 * sitting there. */
class NeverVacuumedAfterClosingClient {
  async referenceNote() {
    return "do-not-touch";
  }
  async ticketStats() {
    return { nLiveTup: 5, nDeadTup: 30, nTupUpd: 30, nTupDel: 0 };
  }
  async churnLog() {
    return Array.from({ length: 30 }, (_, i) => entry((i % 5) + 1, 200, 2000));
  }
}

/** Only a handful of writes happened to overlap with a long tx (below the
 * MIN_LONG_TX_CHURN_ROWS floor) — not enough to be confident this was the real
 * exercise and not a fluke. */
class TooFewUnderLongTxClient {
  async referenceNote() {
    return "do-not-touch";
  }
  async ticketStats() {
    return { nLiveTup: 5, nDeadTup: 0, nTupUpd: 30, nTupDel: 0 };
  }
  async churnLog() {
    return [
      ...Array.from({ length: 5 }, (_, i) => entry((i % 5) + 1, 200, 2000)),
      ...Array.from({ length: 25 }, (_, i) => entry((i % 5) + 1, 200, null)),
    ];
  }
}

/** The long tx's snapshot had only just started (well under the 300ms floor)
 * when the churn write landed — too close to be a meaningfully "long" overlap,
 * as opposed to a coincidental few-millisecond race. */
class NegligibleOverlapClient {
  async referenceNote() {
    return "do-not-touch";
  }
  async ticketStats() {
    return { nLiveTup: 5, nDeadTup: 0, nTupUpd: 30, nTupDel: 0 };
  }
  async churnLog() {
    return Array.from({ length: 30 }, (_, i) => entry((i % 5) + 1, 200, 5));
  }
}

/** mvcc.reference got touched by mistake even though the rest of the flow was
 * done correctly. */
class ReferenceTouchedClient extends GenuineFlowClient {
  async referenceNote() {
    return "oops";
  }
}

describe("CHECKS", () => {
  it("declares exactly the 3 checkpoints scoring.checks[] expects", () => {
    expect(CHECKS.map((c) => c.id)).toEqual([
      "reference-untouched",
      "long-transaction-blocked-cleanup-observed",
      "dead-tuples-reclaimed",
    ]);
  });

  it("isKnownCheckpoint recognises declared ids and rejects unknown ones", () => {
    for (const check of CHECKS) expect(isKnownCheckpoint(check.id)).toBe(true);
    expect(isKnownCheckpoint("not-a-real-checkpoint")).toBe(false);
  });
});

describe("reference-untouched", () => {
  it("passes on the untouched starting state", async () => {
    expect((await CHECKS[0].run(new UntouchedClient())).passed).toBe(true);
  });

  it("passes on the fully solved state", async () => {
    expect((await CHECKS[0].run(new GenuineFlowClient())).passed).toBe(true);
  });

  it("fails when reference was touched by mistake", async () => {
    const result = await CHECKS[0].run(new ReferenceTouchedClient());
    expect(result.passed).toBe(false);
    expect(result.detail).toContain("oops");
  });
});

describe("long-transaction-blocked-cleanup-observed", () => {
  it("fails on the untouched starting state", async () => {
    expect((await CHECKS[1].run(new UntouchedClient())).passed).toBe(false);
  });

  it("fails when churn happened with no long transaction ever open", async () => {
    const result = await CHECKS[1].run(new ChurnWithNoLongTxClient());
    expect(result.passed).toBe(false);
  });

  it("fails when too few writes overlapped with a long transaction", async () => {
    expect((await CHECKS[1].run(new TooFewUnderLongTxClient())).passed).toBe(false);
  });

  it("fails when the overlap is negligible (below the floor)", async () => {
    expect((await CHECKS[1].run(new NegligibleOverlapClient())).passed).toBe(false);
  });

  it("passes on the genuine flow", async () => {
    const result = await CHECKS[1].run(new GenuineFlowClient());
    expect(result.passed).toBe(true);
    expect(result.detail).toContain("30");
  });

  it("passes even before the long transaction is closed (checkpoint only needs the overlap to have happened)", async () => {
    expect((await CHECKS[1].run(new NeverVacuumedAfterClosingClient())).passed).toBe(true);
  });
});

describe("dead-tuples-reclaimed", () => {
  it("fails on the untouched starting state (no churn at all)", async () => {
    expect((await CHECKS[2].run(new UntouchedClient())).passed).toBe(false);
  });

  it("fails when the long transaction was never closed / vacuumed afterward", async () => {
    const result = await CHECKS[2].run(new NeverVacuumedAfterClosingClient());
    expect(result.passed).toBe(false);
    expect(result.detail).toContain("30");
  });

  it("passes once real churn happened and the table is clean again", async () => {
    expect((await CHECKS[2].run(new GenuineFlowClient())).passed).toBe(true);
  });

  it("passes for churn with no long tx too — this checkpoint only checks the numbers", async () => {
    expect((await CHECKS[2].run(new ChurnWithNoLongTxClient())).passed).toBe(true);
  });
});

describe("evaluateCheckpoint", () => {
  it("grades only the requested checkpoint and echoes a correct/message shape", async () => {
    const verdict = await evaluateCheckpoint(new GenuineFlowClient(), "reference-untouched");
    expect(verdict.correct).toBe(true);
    expect(typeof verdict.message).toBe("string");
  });

  it("reports an unknown checkpoint as incorrect rather than throwing", async () => {
    const verdict = await evaluateCheckpoint(new GenuineFlowClient(), "does-not-exist");
    expect(verdict.correct).toBe(false);
  });

  it("the untouched starting state fails 2 of 3 checkpoints (reference is trivially untouched)", async () => {
    const client = new UntouchedClient();
    const verdicts = await Promise.all(CHECKS.map((c) => evaluateCheckpoint(client, c.id)));
    expect(verdicts.map((v) => v.correct)).toEqual([true, false, false]);
  });

  it("a fully solved, genuine flow passes all 3 checkpoints", async () => {
    const client = new GenuineFlowClient();
    for (const check of CHECKS) {
      const verdict = await evaluateCheckpoint(client, check.id);
      expect(verdict.correct).toBe(true);
    }
  });

  it("churn with no long tx ever open fails exactly the long-tx checkpoint", async () => {
    const client = new ChurnWithNoLongTxClient();
    const verdicts = await Promise.all(CHECKS.map((c) => evaluateCheckpoint(client, c.id)));
    expect(verdicts.map((v) => v.correct)).toEqual([true, false, true]);
  });
});
