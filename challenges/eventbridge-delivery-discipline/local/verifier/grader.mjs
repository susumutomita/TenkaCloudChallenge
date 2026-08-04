import { runStream, snapshot, validatePolicy } from "../app/engine.mjs";
import { REFERENCE_POLICY } from "./reference.mjs";

export const CHECKPOINT_IDS = Object.freeze([
  "observe",
  "idempotency",
  "ordering",
  "conflict",
  "retry-dlq",
  "replay",
]);

const completeReceipt = [
  "event",
  "reason",
  "attempts",
  "firstFailureAt",
  "lastFailureAt",
  "ruleArn",
  "targetArn",
  "errorCode",
  "exhaustedRetryCondition",
];

const event = (aggregateId, id, version, type, data = {}) => ({
  id,
  deliveryId: `delivery-${id}`,
  aggregateId,
  version,
  type,
  timestamp: `2026-02-03T04:05:${String(version).padStart(2, "0")}Z`,
  data,
});

function exactOutcomes(state, expected) {
  return state.outcomes.map((item) => item.outcome).join("|") === expected.join("|");
}

function projected(policy, sections) {
  const value = JSON.parse(JSON.stringify(REFERENCE_POLICY));
  for (const section of sections) value[section] = JSON.parse(JSON.stringify(policy[section]));
  return value;
}

function gradeObserve(policy) {
  return ["duplicate_side_effect", "same_version_conflict", "silent_retry_drop", "state_regression"].every((item) =>
    policy.diagnosis.includes(item),
  );
}

function gradeIdempotency(policy) {
  policy = projected(policy, ["idempotency"]);
  policy.ordering = {
    key: "arrival",
    staleOutcome: "applied",
    gapOutcome: "applied",
  };
  policy.conflict = {
    fingerprint: "none",
    sameVersion: "last_write_wins",
  };
  const paid = event("a", "paid-a", 2, "PaymentCaptured", { status: "paid", amount: 500 });
  const result = runStream(policy, [
    event("a", "created-a", 1, "OrderCreated", { status: "created" }),
    { ...paid, failure: { type: "after_side_effect", succeedsOnAttempt: 2 } },
    { ...paid, deliveryId: "delivery-paid-a-again" },
  ]).state;
  return result.sideEffects === 1 && result.outcomes.at(-1)?.outcome === "duplicate";
}

function gradeOrdering(policy) {
  policy = projected(policy, ["ordering"]);
  const result = runStream(policy, [
    event("a", "created-a", 1, "OrderCreated", { status: "created" }),
    event("a", "gap-a", 3, "OrderShipped", { status: "shipped" }),
    event("a", "paid-a", 2, "PaymentCaptured", { status: "paid", amount: 500 }),
    event("a", "stale-a", 1, "OrderCreated", { status: "created" }),
  ]).state;
  return result.aggregates.a?.version === 2 && exactOutcomes(result, ["applied", "version_gap", "applied", "stale"]);
}

function gradeConflict(policy) {
  policy = projected(policy, ["conflict"]);
  const result = runStream(policy, [
    event("a", "created-a", 1, "OrderCreated", { status: "created", customer: "c1" }),
    event("a", "same-a", 1, "OrderCreated", { customer: "c1", status: "created" }),
    event("a", "collision-a", 1, "OrderCreated", { status: "cancelled", customer: "c1" }),
  ]).state;
  return result.aggregates.a?.status === "created" && exactOutcomes(result, ["applied", "duplicate", "conflict"]);
}

function gradeRetryDlq(policy) {
  policy = projected(policy, ["retry", "dlq"]);
  const recovered = runStream(policy, [
    { ...event("a", "recover-a", 1, "OrderCreated", { status: "created" }), failure: { type: "transient", succeedsOnAttempt: 2 } },
  ]).state;
  const failed = runStream(policy, [
    { ...event("b", "exhaust-b", 1, "OrderCreated", { status: "created" }), failure: { type: "transient", succeedsOnAttempt: 99 } },
    { ...event("c", "invalid-c", 1, "OrderCreated", { status: "created" }), failure: { type: "permanent" } },
  ]).state;
  const receiptKeys = failed.dlq.map((item) => Object.keys(item).sort().join("|"));
  const wanted = [...completeReceipt].sort().join("|");
  return (
    recovered.outcomes[0]?.outcome === "applied" &&
    recovered.outcomes[0]?.attempts === 2 &&
    recovered.outcomes[0]?.backoffMs?.join("|") === "100" &&
    exactOutcomes(failed, ["retry_exhausted", "non_retryable"]) &&
    failed.dlq.length === 2 &&
    receiptKeys.every((keys) => keys === wanted) &&
    failed.dlq[0].attempts === 3 &&
    failed.dlq[0].exhaustedRetryCondition === "MaximumRetryAttempts"
  );
}

function gradeReplay(policy) {
  policy = projected(policy, ["replay"]);
  const stream = [
    event("a", "created-a", 1, "OrderCreated", { status: "created" }),
    event("b", "created-b", 1, "OrderCreated", { status: "created" }),
    event("a", "paid-a", 2, "PaymentCaptured", { status: "paid", amount: 500 }),
    { ...event("b", "poison-b", 2, "PaymentCaptured", { status: "paid", amount: 700 }), failure: { type: "transient", succeedsOnAttempt: 99 } },
    event("a", "old-a", 1, "OrderCreated", { status: "created" }),
  ];
  const first = runStream(policy, stream).state;
  const beforeReplay = snapshot(first);
  const replayed = runStream(policy, stream, first).state;
  const afterReplay = snapshot(replayed);
  const interleaved = runStream(policy, [stream[1], stream[0], stream[2], stream[4], stream[3]]).state;
  return (
    policy.replay.deterministic === true &&
    beforeReplay === afterReplay &&
    interleaved.sideEffects === first.sideEffects &&
    interleaved.aggregates.a?.version === first.aggregates.a?.version &&
    interleaved.dlq.length === first.dlq.length
  );
}

const graders = Object.freeze({
  observe: gradeObserve,
  idempotency: gradeIdempotency,
  ordering: gradeOrdering,
  conflict: gradeConflict,
  "retry-dlq": gradeRetryDlq,
  replay: gradeReplay,
});

export function gradeCheckpoint(policy, checkpointId) {
  const errors = validatePolicy(policy);
  if (errors.length > 0 || !CHECKPOINT_IDS.includes(checkpointId)) {
    return { checkpointId, correct: false, errors: errors.length ? errors : ["unknown checkpoint"] };
  }
  const correct = graders[checkpointId](policy) === true;
  return {
    checkpointId,
    correct,
    errors: correct ? [] : [`${checkpointId} invariants are not satisfied`],
  };
}

export function gradeAll(policy) {
  const checks = CHECKPOINT_IDS.map((checkpointId) => gradeCheckpoint(policy, checkpointId));
  return { correct: checks.every((item) => item.correct), checks };
}
