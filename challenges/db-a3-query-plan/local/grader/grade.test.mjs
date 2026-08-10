/**
 * Unit tests for the db-a3-query-plan grader.
 *
 * `bun test` — no live Postgres, no Docker, no network. The fakes model the states
 * a participant's database can actually be in (measured against a real Postgres 16
 * instance while authoring this drill — see README "Numbers behind the
 * thresholds"); the grader's job is to turn those states into a verdict, so the
 * tests pin exactly that mapping.
 */
import { describe, expect, it } from "bun:test";
import { CHECKS, evaluateCheckpoint, isKnownCheckpoint } from "./grade.mjs";

/** Real numbers measured pre-ANALYZE on a freshly seeded 300,000-row table: the
 * planner has no per-value statistics, so it estimates the SAME row count (938) for
 * both the rare and the common literal, and — because that guess still looks
 * "selective enough" — picks a Bitmap Heap Scan (which uses the index) for both,
 * including the common value where that is the wrong call. */
class NeverAnalyzedClient {
  async statisticsCollected() {
    return false;
  }
  async explainRareQuery() {
    return { nodeTypes: new Set(["Bitmap Heap Scan", "Bitmap Index Scan"]), planRows: 938, actualRows: 50 };
  }
  async explainCommonQuery() {
    return {
      nodeTypes: new Set(["Bitmap Heap Scan", "Bitmap Index Scan"]),
      planRows: 938,
      actualRows: 299950,
    };
  }
}

/** Real numbers measured right after `analyze support.tickets;`: the planner's
 * estimate tracks reality closely for both queries, and it picks a plain Index Scan
 * for the rare value and a plain Seq Scan for the common one. */
class AnalyzedClient {
  async statisticsCollected() {
    return true;
  }
  async explainRareQuery() {
    return { nodeTypes: new Set(["Index Scan"]), planRows: 60, actualRows: 50 };
  }
  async explainCommonQuery() {
    return { nodeTypes: new Set(["Seq Scan"]), planRows: 299940, actualRows: 299950 };
  }
}

/** ANALYZE was run, but only after the participant somehow broke the differentiation
 * (e.g. dropped the index and rebuilt statistics without it) — both queries fall
 * back to Seq Scan. Stats are fine; the index-usage checkpoint must still fail. */
class AnalyzedButNoIndexClient {
  async statisticsCollected() {
    return true;
  }
  async explainRareQuery() {
    return { nodeTypes: new Set(["Seq Scan"]), planRows: 52, actualRows: 50 };
  }
  async explainCommonQuery() {
    return { nodeTypes: new Set(["Seq Scan"]), planRows: 299945, actualRows: 299950 };
  }
}

describe("CHECKS", () => {
  it("declares exactly the 3 checkpoints scoring.checks[] expects", () => {
    expect(CHECKS.map((c) => c.id)).toEqual([
      "table-statistics-collected",
      "row-estimates-match-reality",
      "scan-strategy-matches-selectivity",
    ]);
  });

  it("isKnownCheckpoint recognises declared ids and rejects unknown ones", () => {
    for (const check of CHECKS) expect(isKnownCheckpoint(check.id)).toBe(true);
    expect(isKnownCheckpoint("not-a-real-checkpoint")).toBe(false);
  });
});

describe("table-statistics-collected", () => {
  it("fails before ANALYZE has ever run", async () => {
    expect((await CHECKS[0].run(new NeverAnalyzedClient())).passed).toBe(false);
  });
  it("passes once ANALYZE has run", async () => {
    expect((await CHECKS[0].run(new AnalyzedClient())).passed).toBe(true);
  });
});

describe("row-estimates-match-reality", () => {
  it("fails when the planner has never seen real statistics (estimate 938 vs 50/299950)", async () => {
    const result = await CHECKS[1].run(new NeverAnalyzedClient());
    expect(result.passed).toBe(false);
  });

  it("passes once ANALYZE has brought the estimate close to reality", async () => {
    const result = await CHECKS[1].run(new AnalyzedClient());
    expect(result.passed).toBe(true);
  });

  it("fails if only ONE of the two queries has an accurate estimate", async () => {
    class HalfAccurateClient extends AnalyzedClient {
      async explainCommonQuery() {
        return { nodeTypes: new Set(["Seq Scan"]), planRows: 938, actualRows: 299950 };
      }
    }
    const result = await CHECKS[1].run(new HalfAccurateClient());
    expect(result.passed).toBe(false);
  });
});

describe("scan-strategy-matches-selectivity", () => {
  it("fails before ANALYZE — the common query wrongly uses an index-based plan", async () => {
    const result = await CHECKS[2].run(new NeverAnalyzedClient());
    expect(result.passed).toBe(false);
  });

  it("fails when both queries fall back to Seq Scan (no differentiation at all)", async () => {
    const result = await CHECKS[2].run(new AnalyzedButNoIndexClient());
    expect(result.passed).toBe(false);
  });

  it("passes once the plans differ correctly: rare -> index, common -> Seq Scan", async () => {
    const result = await CHECKS[2].run(new AnalyzedClient());
    expect(result.passed).toBe(true);
  });

  it("still fails if the rare query wrongly Seq Scans even though the common one is correct", async () => {
    class RareRegressedClient extends AnalyzedClient {
      async explainRareQuery() {
        return { nodeTypes: new Set(["Seq Scan"]), planRows: 60, actualRows: 50 };
      }
    }
    const result = await CHECKS[2].run(new RareRegressedClient());
    expect(result.passed).toBe(false);
  });
});

describe("evaluateCheckpoint", () => {
  it("grades only the requested checkpoint and echoes a correct/message shape", async () => {
    const verdict = await evaluateCheckpoint(new AnalyzedClient(), "table-statistics-collected");
    expect(verdict.correct).toBe(true);
    expect(typeof verdict.message).toBe("string");
  });

  it("reports an unknown checkpoint as incorrect rather than throwing", async () => {
    const verdict = await evaluateCheckpoint(new AnalyzedClient(), "does-not-exist");
    expect(verdict.correct).toBe(false);
  });

  it("a never-analyzed database fails all 3 checkpoints", async () => {
    const client = new NeverAnalyzedClient();
    for (const check of CHECKS) {
      const verdict = await evaluateCheckpoint(client, check.id);
      expect(verdict.correct).toBe(false);
    }
  });

  it("a properly analyzed database passes all 3 checkpoints", async () => {
    const client = new AnalyzedClient();
    for (const check of CHECKS) {
      const verdict = await evaluateCheckpoint(client, check.id);
      expect(verdict.correct).toBe(true);
    }
  });
});
