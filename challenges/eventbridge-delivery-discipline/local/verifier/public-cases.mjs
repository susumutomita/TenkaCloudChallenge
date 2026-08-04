import { runStream, validatePolicy } from "../app/engine.mjs";

const base = (id, version, type, data = {}) => ({
  id,
  deliveryId: `delivery-${id}`,
  aggregateId: "order-42",
  version,
  type,
  timestamp: `2026-01-01T00:00:0${version}Z`,
  data,
});

export function runPublicCases(policy) {
  const errors = validatePolicy(policy);
  if (errors.length > 0) return { correct: false, errors, cases: [] };

  const duplicate = runStream(policy, [
    base("created", 1, "OrderCreated", { status: "created" }),
    base("paid", 2, "PaymentCaptured", { status: "paid", amount: 1200 }),
    { ...base("paid", 2, "PaymentCaptured", { status: "paid", amount: 1200 }), deliveryId: "delivery-paid-retry" },
  ]).state;
  const stale = runStream(policy, [
    base("created", 1, "OrderCreated", { status: "created" }),
    base("paid", 2, "PaymentCaptured", { status: "paid", amount: 1200 }),
    base("old-created", 1, "OrderCreated", { status: "created" }),
  ]).state;
  const conflict = runStream(policy, [
    base("created", 1, "OrderCreated", { status: "created" }),
    base("changed", 1, "OrderCreated", { status: "cancelled" }),
  ]).state;
  const exhausted = runStream(policy, [
    { ...base("poison", 1, "OrderCreated", { status: "created" }), failure: { type: "transient", succeedsOnAttempt: 99 } },
  ]).state;

  const cases = [
    { name: "duplicate delivery has one side effect", passed: duplicate.sideEffects === 1 && duplicate.outcomes.at(-1)?.outcome === "duplicate" },
    { name: "stale delivery cannot regress aggregate state", passed: stale.aggregates["order-42"]?.version === 2 && stale.outcomes.at(-1)?.outcome === "stale" },
    { name: "same version with a different payload is a conflict", passed: conflict.aggregates["order-42"]?.status === "created" && conflict.outcomes.at(-1)?.outcome === "conflict" },
    { name: "retry exhaustion leaves a replayable DLQ receipt", passed: exhausted.outcomes.at(-1)?.outcome === "retry_exhausted" && exhausted.dlq.length === 1 },
  ];
  return {
    correct: cases.every((item) => item.passed),
    errors: cases.every((item) => item.passed) ? [] : ["one or more public delivery cases failed"],
    cases,
  };
}
