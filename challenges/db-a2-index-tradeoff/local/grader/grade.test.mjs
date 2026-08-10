/**
 * Unit tests for the db-a2-index-tradeoff grader.
 *
 * `bun test` — no live Postgres, no Docker, no network. The fakes model the
 * states a participant's database can actually be in; the grader's job is to
 * turn those states into a verdict, so the tests pin exactly that mapping.
 */
import { describe, expect, it } from "bun:test";
import { CHECKS, evaluateCheckpoint, isKnownCheckpoint } from "./grade.mjs";

const BASELINE = 4651; // representative of the real Seq Scan baseline (see README)

/** The starting state: no index beyond the primary key on id. */
class NoIndexClient {
  async orderNumberIndexExists() {
    return false;
  }
  async explainTargetQuery() {
    return { nodeTypes: new Set(["Gather", "Seq Scan"]), buffers: BASELINE };
  }
  async baselineBuffers() {
    return BASELINE;
  }
}

/** An index exists, but on the wrong column (a common near-miss). */
class WrongColumnIndexClient {
  async orderNumberIndexExists() {
    return false; // the client only reports true for an index that mentions order_number
  }
  async explainTargetQuery() {
    return { nodeTypes: new Set(["Seq Scan"]), buffers: BASELINE };
  }
  async baselineBuffers() {
    return BASELINE;
  }
}

/** The index exists, but the participant forgot to ANALYZE — stale planner
 *  stats can leave the planner still choosing Seq Scan. */
class StaleStatsClient {
  async orderNumberIndexExists() {
    return true;
  }
  async explainTargetQuery() {
    return { nodeTypes: new Set(["Seq Scan"]), buffers: BASELINE };
  }
  async baselineBuffers() {
    return BASELINE;
  }
}

/** The correct state: index exists, planner uses it, buffers collapsed. */
class SolvedClient {
  async orderNumberIndexExists() {
    return true;
  }
  async explainTargetQuery() {
    return { nodeTypes: new Set(["Index Scan"]), buffers: 4 };
  }
  async baselineBuffers() {
    return BASELINE;
  }
}

/** A plan that uses a bitmap index path (also a legitimate "uses the index" shape). */
class BitmapPlanClient {
  async orderNumberIndexExists() {
    return true;
  }
  async explainTargetQuery() {
    return { nodeTypes: new Set(["Bitmap Heap Scan", "Bitmap Index Scan"]), buffers: 12 };
  }
  async baselineBuffers() {
    return BASELINE;
  }
}

/** Baseline was never captured (should not happen in practice, but must not throw). */
class NoBaselineClient {
  async orderNumberIndexExists() {
    return true;
  }
  async explainTargetQuery() {
    return { nodeTypes: new Set(["Index Scan"]), buffers: 4 };
  }
  async baselineBuffers() {
    return null;
  }
}

describe("CHECKS", () => {
  it("declares exactly the 3 checkpoints scoring.checks[] expects", () => {
    expect(CHECKS.map((c) => c.id)).toEqual([
      "order-number-index-exists",
      "query-plan-avoids-seq-scan",
      "buffers-dramatically-reduced",
    ]);
  });

  it("isKnownCheckpoint recognises declared ids and rejects unknown ones", () => {
    for (const check of CHECKS) expect(isKnownCheckpoint(check.id)).toBe(true);
    expect(isKnownCheckpoint("not-a-real-checkpoint")).toBe(false);
  });
});

describe("order-number-index-exists", () => {
  it("fails with no index", async () => {
    expect((await CHECKS[0].run(new NoIndexClient())).passed).toBe(false);
  });
  it("passes once an index on order_number exists", async () => {
    expect((await CHECKS[0].run(new SolvedClient())).passed).toBe(true);
  });
});

describe("query-plan-avoids-seq-scan", () => {
  it("fails while the plan is a Seq Scan", async () => {
    expect((await CHECKS[1].run(new NoIndexClient())).passed).toBe(false);
  });

  it("fails when the index exists but stale stats still produce a Seq Scan", async () => {
    const result = await CHECKS[1].run(new StaleStatsClient());
    expect(result.passed).toBe(false);
  });

  it("passes for a plain Index Scan", async () => {
    expect((await CHECKS[1].run(new SolvedClient())).passed).toBe(true);
  });

  it("passes for a Bitmap Heap Scan / Bitmap Index Scan pair (no Seq Scan present)", async () => {
    expect((await CHECKS[1].run(new BitmapPlanClient())).passed).toBe(true);
  });
});

describe("buffers-dramatically-reduced", () => {
  it("fails when buffers have not meaningfully dropped (still Seq Scan)", async () => {
    expect((await CHECKS[2].run(new NoIndexClient())).passed).toBe(false);
  });

  it("fails gracefully (not throw) when the baseline was never captured", async () => {
    const result = await CHECKS[2].run(new NoBaselineClient());
    expect(result.passed).toBe(false);
  });

  it("passes once buffers collapse well below the baseline threshold", async () => {
    const result = await CHECKS[2].run(new SolvedClient());
    expect(result.passed).toBe(true);
    expect(result.detail).toContain(String(BASELINE));
  });

  it("does not pass a half-hearted improvement that stays above 10% of baseline", async () => {
    class BarelyImprovedClient extends SolvedClient {
      async explainTargetQuery() {
        return { nodeTypes: new Set(["Index Scan"]), buffers: Math.ceil(BASELINE * 0.5) };
      }
    }
    const result = await CHECKS[2].run(new BarelyImprovedClient());
    expect(result.passed).toBe(false);
  });
});

describe("evaluateCheckpoint", () => {
  it("grades only the requested checkpoint and echoes a correct/message shape", async () => {
    const verdict = await evaluateCheckpoint(new SolvedClient(), "order-number-index-exists");
    expect(verdict.correct).toBe(true);
    expect(typeof verdict.message).toBe("string");
  });

  it("reports an unknown checkpoint as incorrect rather than throwing", async () => {
    const verdict = await evaluateCheckpoint(new SolvedClient(), "does-not-exist");
    expect(verdict.correct).toBe(false);
  });

  it("an index on the wrong column fails all 3 checkpoints", async () => {
    const client = new WrongColumnIndexClient();
    for (const check of CHECKS) {
      const verdict = await evaluateCheckpoint(client, check.id);
      expect(verdict.correct).toBe(false);
    }
  });
});
