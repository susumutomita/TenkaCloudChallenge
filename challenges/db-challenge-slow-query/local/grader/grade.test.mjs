/**
 * Unit tests for the db-challenge-slow-query grader.
 *
 * `bun test` — no live Postgres, no Docker, no network. The fakes model the
 * states a participant's database can actually be in (measured against a real
 * Postgres 16 instance while authoring this Challenge); the grader's job is
 * to turn those states into a verdict, so the tests pin exactly that mapping.
 *
 * Extra emphasis vs. db-a2-index-tradeoff's tests: this Challenge starts with
 * a pre-existing (wrong) index that Postgres can — and does — genuinely pick
 * for the target query (avoiding a literal Seq Scan) without that being a
 * real fix, so several fakes specifically model that near-miss.
 */
import { describe, expect, it } from "bun:test";
import { CHECKS, evaluateCheckpoint, isKnownCheckpoint } from "./grade.mjs";

const BASELINE = 386; // measured: red herring alone, before any participant fix (see README)

/** The untouched starting state: only the red-herring index
 * (status, customer_id) exists. Verified against a live Postgres 16
 * instance: the planner actually chooses this index for the target query
 * (walking it end-to-end and checking customer_id per index tuple is
 * cheaper than walking the heap), so there is NO Seq Scan node — but the
 * index it used does not lead with customer_id, so it is not a real fix. */
class RedHerringOnlyClient {
  async ordersCustomerIdLeadsAnIndex() {
    return false;
  }
  async customerIdLeadingIndexNames() {
    return new Set(); // (status, customer_id) does not open with customer_id
  }
  async explainTargetQuery() {
    return {
      nodeTypes: new Set(["Limit", "Sort", "Index Scan"]),
      seqScanRelations: new Set(),
      indexNamesUsed: new Set(["idx_orders_status_customer"]),
      buffers: BASELINE,
    };
  }
  async baselineBuffers() {
    return BASELINE;
  }
}

/** The shallow "just add any index" shortcut: participant creates an index on
 * an unrelated column (say `total_cents` alone). The planner keeps using the
 * red herring for this query exactly as before — the new index changes
 * nothing about it. */
class UnrelatedIndexClient {
  async ordersCustomerIdLeadsAnIndex() {
    return false;
  }
  async customerIdLeadingIndexNames() {
    return new Set();
  }
  async explainTargetQuery() {
    return {
      nodeTypes: new Set(["Limit", "Sort", "Index Scan"]),
      seqScanRelations: new Set(),
      indexNamesUsed: new Set(["idx_orders_status_customer"]),
      buffers: BASELINE,
    };
  }
  async baselineBuffers() {
    return BASELINE;
  }
}

/** A closer near-miss: participant adds ANOTHER index that still does not
 * open with customer_id (e.g. `(created_at desc, customer_id)` — a
 * plausible-looking attempt that matches the ORDER BY but still puts the
 * wrong column first). Measured on a live Postgres 16 instance: the planner
 * can pick this one instead of the red herring, but it performs WORSE (has
 * to walk deep into a differently-ordered index looking for a specific
 * customer), not better. */
class WrongLeadingColumnAlternativeClient {
  async ordersCustomerIdLeadsAnIndex() {
    return false;
  }
  async customerIdLeadingIndexNames() {
    return new Set(); // this index doesn't open with customer_id either
  }
  async explainTargetQuery() {
    return {
      nodeTypes: new Set(["Limit", "Index Scan"]),
      seqScanRelations: new Set(),
      indexNamesUsed: new Set(["idx_orders_created_customer"]),
      buffers: 396, // measured: slightly WORSE than the red herring alone
    };
  }
  async baselineBuffers() {
    return BASELINE;
  }
}

/** The index exists and leads with customer_id, but the participant forgot to
 * ANALYZE — stale planner stats can leave the planner still choosing the red
 * herring even though a usable index now exists (same lesson as
 * db-a3-query-plan). */
class StaleStatsClient {
  async ordersCustomerIdLeadsAnIndex() {
    return true;
  }
  async customerIdLeadingIndexNames() {
    return new Set(["idx_orders_customer_id"]);
  }
  async explainTargetQuery() {
    return {
      nodeTypes: new Set(["Limit", "Sort", "Index Scan"]),
      seqScanRelations: new Set(),
      indexNamesUsed: new Set(["idx_orders_status_customer"]), // still picked the OLD one
      buffers: BASELINE,
    };
  }
  async baselineBuffers() {
    return BASELINE;
  }
}

/** The correct, minimal fix: a plain single-column index on customer_id.
 * Measured on a live Postgres 16 instance: 65 buffers, well under the
 * threshold, via a Bitmap Heap Scan + Bitmap Index Scan pair. */
class MinimalFixClient {
  async ordersCustomerIdLeadsAnIndex() {
    return true;
  }
  async customerIdLeadingIndexNames() {
    return new Set(["idx_orders_customer_id"]);
  }
  async explainTargetQuery() {
    return {
      nodeTypes: new Set(["Limit", "Sort", "Bitmap Heap Scan", "Bitmap Index Scan"]),
      seqScanRelations: new Set(),
      indexNamesUsed: new Set(["idx_orders_customer_id"]),
      buffers: 65,
    };
  }
  async baselineBuffers() {
    return BASELINE;
  }
}

/** The best fix: a composite (customer_id, created_at desc) index that also
 * satisfies the ORDER BY, avoiding an explicit Sort entirely. Measured: 26
 * buffers. */
class CompositeFixClient {
  async ordersCustomerIdLeadsAnIndex() {
    return true;
  }
  async customerIdLeadingIndexNames() {
    return new Set(["idx_orders_customer_created"]);
  }
  async explainTargetQuery() {
    return {
      nodeTypes: new Set(["Limit", "Index Scan"]),
      seqScanRelations: new Set(),
      indexNamesUsed: new Set(["idx_orders_customer_created"]),
      buffers: 26,
    };
  }
  async baselineBuffers() {
    return BASELINE;
  }
}

/** Baseline was never captured (should not happen in practice, but must not throw). */
class NoBaselineClient {
  async ordersCustomerIdLeadsAnIndex() {
    return true;
  }
  async customerIdLeadingIndexNames() {
    return new Set(["idx_orders_customer_id"]);
  }
  async explainTargetQuery() {
    return {
      nodeTypes: new Set(["Index Scan"]),
      seqScanRelations: new Set(),
      indexNamesUsed: new Set(["idx_orders_customer_id"]),
      buffers: 65,
    };
  }
  async baselineBuffers() {
    return null;
  }
}

describe("CHECKS", () => {
  it("declares exactly the 3 checkpoints scoring.checks[] expects", () => {
    expect(CHECKS.map((c) => c.id)).toEqual([
      "orders-customer-id-leads-an-index",
      "target-query-uses-customer-id-led-index",
      "buffers-dramatically-reduced",
    ]);
  });

  it("isKnownCheckpoint recognises declared ids and rejects unknown ones", () => {
    for (const check of CHECKS) expect(isKnownCheckpoint(check.id)).toBe(true);
    expect(isKnownCheckpoint("not-a-real-checkpoint")).toBe(false);
  });
});

describe("orders-customer-id-leads-an-index", () => {
  it("fails on the untouched starting state (red herring only)", async () => {
    expect((await CHECKS[0].run(new RedHerringOnlyClient())).passed).toBe(false);
  });

  it("fails when the participant adds an index on an unrelated column", async () => {
    expect((await CHECKS[0].run(new UnrelatedIndexClient())).passed).toBe(false);
  });

  it("fails when a new index still doesn't lead with customer_id", async () => {
    expect((await CHECKS[0].run(new WrongLeadingColumnAlternativeClient())).passed).toBe(false);
  });

  it("passes once an index led by customer_id exists", async () => {
    expect((await CHECKS[0].run(new MinimalFixClient())).passed).toBe(true);
  });
});

describe("target-query-uses-customer-id-led-index", () => {
  it("fails on the untouched starting state, EVEN THOUGH the plan has no Seq Scan (the red herring gets chosen)", async () => {
    const result = await CHECKS[1].run(new RedHerringOnlyClient());
    expect(result.passed).toBe(false);
  });

  it("fails for the unrelated-index shortcut", async () => {
    expect((await CHECKS[1].run(new UnrelatedIndexClient())).passed).toBe(false);
  });

  it("fails when the planner picks a DIFFERENT index that still doesn't lead with customer_id", async () => {
    expect((await CHECKS[1].run(new WrongLeadingColumnAlternativeClient())).passed).toBe(false);
  });

  it("fails when the index exists but stale stats leave the planner on the red herring", async () => {
    expect((await CHECKS[1].run(new StaleStatsClient())).passed).toBe(false);
  });

  it("passes for a plain single-column index actually chosen by the planner", async () => {
    expect((await CHECKS[1].run(new MinimalFixClient())).passed).toBe(true);
  });

  it("passes for a composite index actually chosen by the planner", async () => {
    expect((await CHECKS[1].run(new CompositeFixClient())).passed).toBe(true);
  });
});

describe("buffers-dramatically-reduced", () => {
  it("fails on the untouched starting state (red herring's partial help isn't enough)", async () => {
    expect((await CHECKS[2].run(new RedHerringOnlyClient())).passed).toBe(false);
  });

  it("fails for the wrong-leading-column alternative (measured slightly WORSE than the red herring)", async () => {
    expect((await CHECKS[2].run(new WrongLeadingColumnAlternativeClient())).passed).toBe(false);
  });

  it("fails gracefully (not throw) when the baseline was never captured", async () => {
    const result = await CHECKS[2].run(new NoBaselineClient());
    expect(result.passed).toBe(false);
  });

  it("passes for the minimal correct fix", async () => {
    const result = await CHECKS[2].run(new MinimalFixClient());
    expect(result.passed).toBe(true);
    expect(result.detail).toContain(String(BASELINE));
  });

  it("passes for the composite fix", async () => {
    expect((await CHECKS[2].run(new CompositeFixClient())).passed).toBe(true);
  });
});

describe("evaluateCheckpoint", () => {
  it("grades only the requested checkpoint and echoes a correct/message shape", async () => {
    const verdict = await evaluateCheckpoint(new MinimalFixClient(), "orders-customer-id-leads-an-index");
    expect(verdict.correct).toBe(true);
    expect(typeof verdict.message).toBe("string");
  });

  it("reports an unknown checkpoint as incorrect rather than throwing", async () => {
    const verdict = await evaluateCheckpoint(new MinimalFixClient(), "does-not-exist");
    expect(verdict.correct).toBe(false);
  });

  it("the red-herring-only starting state fails all 3 checkpoints", async () => {
    const client = new RedHerringOnlyClient();
    for (const check of CHECKS) {
      const verdict = await evaluateCheckpoint(client, check.id);
      expect(verdict.correct).toBe(false);
    }
  });

  it("the unrelated-index shortcut fails all 3 checkpoints", async () => {
    const client = new UnrelatedIndexClient();
    for (const check of CHECKS) {
      const verdict = await evaluateCheckpoint(client, check.id);
      expect(verdict.correct).toBe(false);
    }
  });

  it("the wrong-leading-column alternative index fails all 3 checkpoints", async () => {
    const client = new WrongLeadingColumnAlternativeClient();
    for (const check of CHECKS) {
      const verdict = await evaluateCheckpoint(client, check.id);
      expect(verdict.correct).toBe(false);
    }
  });

  it("the minimal correct fix passes all 3 checkpoints", async () => {
    const client = new MinimalFixClient();
    for (const check of CHECKS) {
      const verdict = await evaluateCheckpoint(client, check.id);
      expect(verdict.correct).toBe(true);
    }
  });

  it("the composite fix passes all 3 checkpoints", async () => {
    const client = new CompositeFixClient();
    for (const check of CHECKS) {
      const verdict = await evaluateCheckpoint(client, check.id);
      expect(verdict.correct).toBe(true);
    }
  });
});
