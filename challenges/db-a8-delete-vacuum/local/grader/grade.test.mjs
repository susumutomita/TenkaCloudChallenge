/**
 * Unit tests for the db-a8-delete-vacuum grader.
 *
 * `bun test` — no live Postgres, no Docker, no network. The fakes model the
 * states a participant's database can actually be in (measured against a real
 * Postgres 16 instance while authoring this drill — 300,000 "old" rows,
 * 100,000 "recent" rows, a 300,000-row DELETE, then VACUUM); the grader's job
 * is to turn those states into a verdict, so the tests pin exactly that
 * mapping.
 */
import { describe, expect, it } from "bun:test";
import { CHECKS, evaluateCheckpoint, isKnownCheckpoint } from "./grade.mjs";

/** Build an audit.delete_log entry. */
function deleteLogEntry(rowsDeleted, backendPid = 200) {
  return {
    rowsDeleted,
    minCreatedAtMs: Date.parse("2022-01-01T00:00:00Z"),
    maxCreatedAtMs: Date.parse("2022-01-04T11:20:00Z"),
    backendPid,
    executedAtMs: Date.parse("2026-01-01T00:00:00Z"),
  };
}

/** The untouched starting state: seed.sql just ran, nothing has happened. */
class UntouchedClient {
  async rowCounts() {
    return { oldRemaining: 300_000, recentRemaining: 100_000 };
  }
  async eventStats() {
    return { nLiveTup: 400_000, nDeadTup: 0, nTupDel: 0 };
  }
  async deleteLog() {
    return [];
  }
}

/** The correct, real flow: DELETE every row older than the cutoff in one
 * statement (300,000 rows — logged once by the trigger), then VACUUM,
 * reclaiming every dead tuple it created. */
class GenuineFlowClient {
  async rowCounts() {
    return { oldRemaining: 0, recentRemaining: 100_000 };
  }
  async eventStats() {
    return { nLiveTup: 100_000, nDeadTup: 0, nTupDel: 300_000 };
  }
  async deleteLog() {
    return [deleteLogEntry(300_000)];
  }
}

/** The same real flow but split across 3 DELETE statements (e.g. batched by
 * created_at range) — still adds up to the full 300,000, still passes. */
class BatchedDeleteClient {
  async rowCounts() {
    return { oldRemaining: 0, recentRemaining: 100_000 };
  }
  async eventStats() {
    return { nLiveTup: 100_000, nDeadTup: 0, nTupDel: 300_000 };
  }
  async deleteLog() {
    return [deleteLogEntry(100_000, 200), deleteLogEntry(100_000, 200), deleteLogEntry(100_000, 200)];
  }
}

/** The delete happened and rows landed correctly, but VACUUM was never (re-)run
 * afterward — dead tuples are still sitting there. */
class NeverVacuumedClient {
  async rowCounts() {
    return { oldRemaining: 0, recentRemaining: 100_000 };
  }
  async eventStats() {
    return { nLiveTup: 100_000, nDeadTup: 300_000, nTupDel: 300_000 };
  }
  async deleteLog() {
    return [deleteLogEntry(300_000)];
  }
}

/** The shortcut this drill's whole anti-cheat exists to catch: the
 * participant runs VACUUM against the untouched, freshly seeded table without
 * ever deleting anything. n_dead_tup is trivially already 0. */
class VacuumOnlyNoDeleteClient extends UntouchedClient {}

/** Deleted everything (old AND recent rows) instead of only the old ones —
 * wrong target, even though the delete itself was large and VACUUM ran. */
class DeletedEverythingClient {
  async rowCounts() {
    return { oldRemaining: 0, recentRemaining: 0 };
  }
  async eventStats() {
    return { nLiveTup: 0, nDeadTup: 0, nTupDel: 400_000 };
  }
  async deleteLog() {
    return [deleteLogEntry(400_000)];
  }
}

/** Only a partial delete happened (below the anti-cheat floor) — some old rows
 * remain, and not enough churn to count as "the real bulk delete" either. */
class PartialDeleteClient {
  async rowCounts() {
    return { oldRemaining: 150_000, recentRemaining: 100_000 };
  }
  async eventStats() {
    return { nLiveTup: 250_000, nDeadTup: 150_000, nTupDel: 150_000 };
  }
  async deleteLog() {
    return [deleteLogEntry(150_000)];
  }
}

describe("CHECKS", () => {
  it("declares exactly the 3 checkpoints scoring.checks[] expects", () => {
    expect(CHECKS.map((c) => c.id)).toEqual([
      "old-rows-deleted-recent-intact",
      "bulk-delete-observed",
      "dead-tuples-reclaimed",
    ]);
  });

  it("isKnownCheckpoint recognises declared ids and rejects unknown ones", () => {
    for (const check of CHECKS) expect(isKnownCheckpoint(check.id)).toBe(true);
    expect(isKnownCheckpoint("not-a-real-checkpoint")).toBe(false);
  });
});

describe("old-rows-deleted-recent-intact", () => {
  it("fails on the untouched starting state (nothing deleted yet)", async () => {
    expect((await CHECKS[0].run(new UntouchedClient())).passed).toBe(false);
  });

  it("passes on the genuine flow", async () => {
    const result = await CHECKS[0].run(new GenuineFlowClient());
    expect(result.passed).toBe(true);
  });

  it("passes even before VACUUM runs (row counts already correct)", async () => {
    expect((await CHECKS[0].run(new NeverVacuumedClient())).passed).toBe(true);
  });

  it("fails when the recent (bystander) rows were deleted too", async () => {
    const result = await CHECKS[0].run(new DeletedEverythingClient());
    expect(result.passed).toBe(false);
    expect(result.detail).toContain("100000");
  });

  it("fails when old rows still remain (partial delete)", async () => {
    const result = await CHECKS[0].run(new PartialDeleteClient());
    expect(result.passed).toBe(false);
    expect(result.detail).toContain("150000");
  });
});

describe("bulk-delete-observed", () => {
  it("fails on the untouched starting state (empty audit log)", async () => {
    expect((await CHECKS[1].run(new UntouchedClient())).passed).toBe(false);
  });

  it("fails for the VACUUM-only shortcut (no delete ever happened)", async () => {
    expect((await CHECKS[1].run(new VacuumOnlyNoDeleteClient())).passed).toBe(false);
  });

  it("passes on the genuine flow (one 300,000-row DELETE)", async () => {
    const result = await CHECKS[1].run(new GenuineFlowClient());
    expect(result.passed).toBe(true);
    expect(result.detail).toContain("300000");
  });

  it("passes when the same total is split across several DELETE statements", async () => {
    expect((await CHECKS[1].run(new BatchedDeleteClient())).passed).toBe(true);
  });

  it("fails when only a partial delete happened (below the anti-cheat floor)", async () => {
    expect((await CHECKS[1].run(new PartialDeleteClient())).passed).toBe(false);
  });
});

describe("dead-tuples-reclaimed", () => {
  it("fails on the untouched starting state (no delete at all)", async () => {
    expect((await CHECKS[2].run(new UntouchedClient())).passed).toBe(false);
  });

  it("fails for the VACUUM-only shortcut — n_dead_tup is trivially 0, but n_tup_del is also 0", async () => {
    const result = await CHECKS[2].run(new VacuumOnlyNoDeleteClient());
    expect(result.passed).toBe(false);
    expect(result.detail).toContain("0");
  });

  it("fails when the delete happened but VACUUM was never (re-)run", async () => {
    const result = await CHECKS[2].run(new NeverVacuumedClient());
    expect(result.passed).toBe(false);
    expect(result.detail).toContain("300000");
  });

  it("passes once the real bulk delete happened and VACUUM reclaimed it", async () => {
    expect((await CHECKS[2].run(new GenuineFlowClient())).passed).toBe(true);
  });

  it("passes for the batched-delete flow too, once vacuumed", async () => {
    expect((await CHECKS[2].run(new BatchedDeleteClient())).passed).toBe(true);
  });
});

describe("evaluateCheckpoint", () => {
  it("grades only the requested checkpoint and echoes a correct/message shape", async () => {
    const verdict = await evaluateCheckpoint(new GenuineFlowClient(), "old-rows-deleted-recent-intact");
    expect(verdict.correct).toBe(true);
    expect(typeof verdict.message).toBe("string");
  });

  it("reports an unknown checkpoint as incorrect rather than throwing", async () => {
    const verdict = await evaluateCheckpoint(new GenuineFlowClient(), "does-not-exist");
    expect(verdict.correct).toBe(false);
  });

  it("the untouched starting state fails all 3 checkpoints", async () => {
    const client = new UntouchedClient();
    const verdicts = await Promise.all(CHECKS.map((c) => evaluateCheckpoint(client, c.id)));
    expect(verdicts.map((v) => v.correct)).toEqual([false, false, false]);
  });

  it("the VACUUM-only shortcut fails all 3 checkpoints (the anti-cheat this drill is built around)", async () => {
    const client = new VacuumOnlyNoDeleteClient();
    const verdicts = await Promise.all(CHECKS.map((c) => evaluateCheckpoint(client, c.id)));
    expect(verdicts.map((v) => v.correct)).toEqual([false, false, false]);
  });

  it("a fully solved, genuine flow passes all 3 checkpoints", async () => {
    const client = new GenuineFlowClient();
    for (const check of CHECKS) {
      const verdict = await evaluateCheckpoint(client, check.id);
      expect(verdict.correct).toBe(true);
    }
  });

  it("deleting everything (including the bystander rows) fails exactly the row-target checkpoint", async () => {
    const client = new DeletedEverythingClient();
    const verdicts = await Promise.all(CHECKS.map((c) => evaluateCheckpoint(client, c.id)));
    expect(verdicts.map((v) => v.correct)).toEqual([false, true, true]);
  });

  it("deleting but never vacuuming fails exactly the reclaim checkpoint", async () => {
    const client = new NeverVacuumedClient();
    const verdicts = await Promise.all(CHECKS.map((c) => evaluateCheckpoint(client, c.id)));
    expect(verdicts.map((v) => v.correct)).toEqual([true, true, false]);
  });
});
