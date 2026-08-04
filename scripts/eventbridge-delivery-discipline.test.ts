import { describe, expect, it } from "bun:test";
import {
  createLedger,
  deliver,
  runWithRetryBudget,
} from "../challenges/eventbridge-delivery-discipline/local/reference/consumer.mjs";

type Event = {
  id: string;
  aggregateId: string;
  version: number;
  type: string;
  amount?: number;
};

const created: Event = {
  id: "evt-created",
  aggregateId: "order-42",
  version: 1,
  type: "OrderCreated",
};
const paid: Event = {
  id: "evt-paid",
  aggregateId: "order-42",
  version: 2,
  type: "PaymentCaptured",
  amount: 4200,
};

describe("EventBridge delivery discipline reference contract", () => {
  it("applies a delivery once and classifies the same event id as a side-effect-free duplicate", () => {
    const ledger = createLedger();
    expect(deliver(ledger, created).outcome).toBe("applied");
    expect(deliver(ledger, paid).outcome).toBe("applied");

    const beforeReplay = structuredClone(ledger);
    expect(deliver(ledger, paid).outcome).toBe("duplicate");
    expect(ledger).toEqual(beforeReplay);
    expect(ledger.sideEffects).toEqual([{ kind: "capture", amount: 4200 }]);
  });

  it("keeps aggregate versions monotonic when an older event arrives late", () => {
    const ledger = createLedger();
    deliver(ledger, created);
    deliver(ledger, paid);

    const stale = { ...created, id: "evt-created-late" };
    expect(deliver(ledger, stale).outcome).toBe("stale");
    expect(ledger.aggregates["order-42"]?.version).toBe(2);
    expect(ledger.sideEffects).toHaveLength(1);
  });

  it("fails closed when the same aggregate version carries a different payload", () => {
    const ledger = createLedger();
    deliver(ledger, created);
    deliver(ledger, paid);

    const conflicting = {
      ...paid,
      id: "evt-paid-conflict",
      amount: 9900,
    };
    expect(deliver(ledger, conflicting).outcome).toBe("conflict");
    expect(ledger.aggregates["order-42"]?.amount).toBe(4200);
    expect(ledger.sideEffects).toEqual([{ kind: "capture", amount: 4200 }]);
  });

  it("rejects a future version gap instead of inventing missing business state", () => {
    const ledger = createLedger();
    deliver(ledger, created);

    const gap = {
      id: "evt-shipped",
      aggregateId: "order-42",
      version: 3,
      type: "OrderShipped",
    };
    expect(deliver(ledger, gap).outcome).toBe("version_gap");
    expect(ledger.aggregates["order-42"]?.version).toBe(1);
  });

  it("replaying an interleaved stream does not change state or side-effect counts", () => {
    const ledger = createLedger();
    const otherCreated = { ...created, id: "evt-other-created", aggregateId: "order-7" };
    const otherPaid = { ...paid, id: "evt-other-paid", aggregateId: "order-7", amount: 700 };
    const stream = [created, otherCreated, paid, otherPaid];

    for (const event of stream) deliver(ledger, event);
    const afterFirstRun = structuredClone(ledger);
    const replayOutcomes = stream.map((event) => deliver(ledger, event).outcome);

    expect(replayOutcomes).toEqual(["duplicate", "duplicate", "duplicate", "duplicate"]);
    expect(ledger).toEqual(afterFirstRun);
    expect(ledger.sideEffects).toHaveLength(2);
  });

  it("bounds retries and preserves a complete DLQ receipt when attempts are exhausted", async () => {
    const poison: Event = {
      id: "evt-poison",
      aggregateId: "order-13",
      version: 1,
      type: "PoisonEvent",
    };
    let calls = 0;
    const result = await runWithRetryBudget({
      event: poison,
      maxAttempts: 3,
      invoke: async () => {
        calls += 1;
        throw new Error("synthetic downstream timeout");
      },
    });

    expect(calls).toBe(3);
    expect(result.outcome).toBe("retry_exhausted");
    expect(result.dlq).toMatchObject({
      event: poison,
      attempts: 3,
      errorCode: "DELIVERY_FAILED",
      exhaustedCondition: "MaximumRetryAttempts",
    });
    expect(result.dlq?.errorMessage).toContain("synthetic downstream timeout");
  });
});
