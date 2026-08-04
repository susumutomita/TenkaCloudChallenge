const OUTCOMES = new Set([
  "applied",
  "duplicate",
  "stale",
  "conflict",
  "version_gap",
  "retry_exhausted",
  "non_retryable",
]);

const DLQ_FIELDS = new Set([
  "event",
  "reason",
  "attempts",
  "firstFailureAt",
  "lastFailureAt",
  "ruleArn",
  "targetArn",
  "errorCode",
  "exhaustedRetryCondition",
]);

export const STARTER_POLICY = Object.freeze({
  diagnosis: [],
  idempotency: {
    key: "deliveryId",
    duplicateOutcome: "applied",
    atomic: false,
  },
  ordering: {
    key: "arrival",
    staleOutcome: "applied",
    gapOutcome: "applied",
  },
  conflict: {
    fingerprint: "none",
    sameVersion: "last_write_wins",
  },
  retry: {
    maxAttempts: 2,
    retryable: ["transient", "permanent"],
    backoff: "none",
  },
  dlq: {
    enabled: false,
    include: [],
  },
  replay: {
    persistLedger: false,
    deterministic: false,
  },
});

function isRecord(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function exactKeys(value, keys) {
  return isRecord(value) && Object.keys(value).sort().join("|") === [...keys].sort().join("|");
}

function oneOf(value, values) {
  return typeof value === "string" && values.includes(value);
}

function stringArray(value, allowed, maxLength = 16) {
  return (
    Array.isArray(value) &&
    value.length <= maxLength &&
    new Set(value).size === value.length &&
    value.every((item) => typeof item === "string" && allowed.has(item))
  );
}

export function validatePolicy(policy) {
  if (!exactKeys(policy, ["diagnosis", "idempotency", "ordering", "conflict", "retry", "dlq", "replay"])) {
    return ["policy must contain exactly the seven documented sections"];
  }

  const errors = [];
  if (
    !stringArray(
      policy.diagnosis,
      new Set(["duplicate_side_effect", "state_regression", "silent_retry_drop", "same_version_conflict"]),
      4,
    )
  ) {
    errors.push("diagnosis must be a unique list of documented observations");
  }
  if (!exactKeys(policy.idempotency, ["key", "duplicateOutcome", "atomic"])) {
    errors.push("idempotency has an invalid shape");
  } else {
    if (!oneOf(policy.idempotency.key, ["deliveryId", "eventId"])) errors.push("invalid idempotency key");
    if (!oneOf(policy.idempotency.duplicateOutcome, ["applied", "duplicate"])) errors.push("invalid duplicate outcome");
    if (typeof policy.idempotency.atomic !== "boolean") errors.push("idempotency.atomic must be boolean");
  }
  if (!exactKeys(policy.ordering, ["key", "staleOutcome", "gapOutcome"])) {
    errors.push("ordering has an invalid shape");
  } else {
    if (!oneOf(policy.ordering.key, ["arrival", "timestamp", "version"])) errors.push("invalid ordering key");
    if (!oneOf(policy.ordering.staleOutcome, ["applied", "stale"])) errors.push("invalid stale outcome");
    if (!oneOf(policy.ordering.gapOutcome, ["applied", "version_gap"])) errors.push("invalid gap outcome");
  }
  if (!exactKeys(policy.conflict, ["fingerprint", "sameVersion"])) {
    errors.push("conflict has an invalid shape");
  } else {
    if (!oneOf(policy.conflict.fingerprint, ["none", "canonical_payload"])) errors.push("invalid conflict fingerprint");
    if (!oneOf(policy.conflict.sameVersion, ["last_write_wins", "conflict"])) errors.push("invalid same-version outcome");
  }
  if (!exactKeys(policy.retry, ["maxAttempts", "retryable", "backoff"])) {
    errors.push("retry has an invalid shape");
  } else {
    if (!Number.isInteger(policy.retry.maxAttempts) || policy.retry.maxAttempts < 1 || policy.retry.maxAttempts > 10) {
      errors.push("retry.maxAttempts must be between 1 and 10");
    }
    if (!stringArray(policy.retry.retryable, new Set(["transient", "permanent"]), 2)) errors.push("invalid retryable list");
    if (!oneOf(policy.retry.backoff, ["none", "linear", "exponential"])) errors.push("invalid retry backoff");
  }
  if (!exactKeys(policy.dlq, ["enabled", "include"])) {
    errors.push("dlq has an invalid shape");
  } else {
    if (typeof policy.dlq.enabled !== "boolean") errors.push("dlq.enabled must be boolean");
    if (!stringArray(policy.dlq.include, DLQ_FIELDS, DLQ_FIELDS.size)) errors.push("invalid DLQ receipt fields");
  }
  if (!exactKeys(policy.replay, ["persistLedger", "deterministic"])) {
    errors.push("replay has an invalid shape");
  } else if (
    typeof policy.replay.persistLedger !== "boolean" ||
    typeof policy.replay.deterministic !== "boolean"
  ) {
    errors.push("replay settings must be boolean");
  }
  return errors;
}

function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stable(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function emptyState() {
  return {
    aggregates: {},
    processed: {},
    versions: {},
    outcomes: [],
    sideEffects: 0,
    dlq: [],
    clock: 0,
  };
}

function normalizeState(input, persistLedger) {
  const state = input ? clone(input) : emptyState();
  state.outcomes = [];
  if (!persistLedger) state.processed = {};
  return state;
}

function mark(state, event, outcome, extra = {}) {
  const record = { eventId: event.id, aggregateId: event.aggregateId, outcome, ...extra };
  state.outcomes.push(record);
  return record;
}

function dlqReceipt(policy, event, reason, attempts, backoffMs, tick) {
  const complete = {
    event: clone(event),
    reason,
    attempts,
    firstFailureAt: `tick-${tick}-attempt-1`,
    lastFailureAt: `tick-${tick}-attempt-${attempts}`,
    ruleArn: "arn:aws:events:local:000000000000:rule/order-events",
    targetArn: "arn:aws:lambda:local:000000000000:function:order-consumer",
    errorCode: reason === "retry_exhausted" ? "THROTTLING" : "INVALID_PARAMETER",
    exhaustedRetryCondition: reason === "retry_exhausted" ? "MaximumRetryAttempts" : "NonRetryable",
    backoffMs,
  };
  return Object.fromEntries(policy.dlq.include.map((field) => [field, complete[field]]));
}

function failureResult(policy, state, event, tick) {
  const failure = event.failure;
  if (!isRecord(failure)) return null;
  const type = String(failure.type ?? "permanent");
  if (type === "after_side_effect") return null;
  const retryable = policy.retry.retryable.includes(type);
  const succeedsOnAttempt = Number.isInteger(failure.succeedsOnAttempt) ? failure.succeedsOnAttempt : Number.POSITIVE_INFINITY;
  const limit = retryable ? policy.retry.maxAttempts : 1;
  const backoffMs = [];
  for (let attempt = 1; attempt <= limit; attempt += 1) {
    if (attempt >= succeedsOnAttempt) return { attempts: attempt, backoffMs };
    if (attempt < limit) {
      backoffMs.push(
        policy.retry.backoff === "exponential" ? 100 * 2 ** (attempt - 1) : policy.retry.backoff === "linear" ? 100 * attempt : 0,
      );
    }
  }
  const reason = retryable ? "retry_exhausted" : "non_retryable";
  if (policy.dlq.enabled) state.dlq.push(dlqReceipt(policy, event, reason, limit, backoffMs, tick));
  state.processed[event.id] = reason;
  mark(state, event, reason, { attempts: limit, backoffMs });
  return { terminal: true };
}

function applyEvent(policy, state, event, attempts = 1, backoffMs = []) {
  const current = state.aggregates[event.aggregateId] ?? { version: 0, status: "missing", charged: 0 };
  const fingerprint = stable({ type: event.type, data: event.data });
  const versionKey = `${event.aggregateId}:${event.version}`;
  const previousFingerprint = state.versions[versionKey];

  if (policy.idempotency.key === "eventId" && state.processed[event.id]) {
    return mark(state, event, policy.idempotency.duplicateOutcome);
  }

  if (policy.ordering.key === "version") {
    if (event.version === current.version && previousFingerprint === fingerprint) {
      state.processed[event.id] = "duplicate";
      return mark(state, event, "duplicate");
    }
    if (event.version === current.version && previousFingerprint && previousFingerprint !== fingerprint) {
      if (policy.conflict.fingerprint === "canonical_payload" && policy.conflict.sameVersion === "conflict") {
        state.processed[event.id] = "conflict";
        return mark(state, event, "conflict");
      }
    }
    if (event.version < current.version && policy.ordering.staleOutcome === "stale") {
      state.processed[event.id] = "stale";
      return mark(state, event, "stale");
    }
    if (event.version > current.version + 1 && policy.ordering.gapOutcome === "version_gap") {
      state.processed[event.id] = "version_gap";
      return mark(state, event, "version_gap");
    }
  }

  const next = clone(current);
  next.version = Number(event.version);
  next.status = String(event.data?.status ?? event.type);
  if (event.type === "PaymentCaptured") {
    next.charged += Number(event.data?.amount ?? 0);
    state.sideEffects += 1;
  }
  state.aggregates[event.aggregateId] = next;
  state.versions[versionKey] = policy.conflict.fingerprint === "canonical_payload" ? fingerprint : String(state.clock);
  state.processed[event.id] = "applied";
  return mark(state, event, "applied", { attempts, backoffMs });
}

export function runStream(policy, events, priorState) {
  const errors = validatePolicy(policy);
  if (errors.length > 0) return { correct: false, errors, state: emptyState() };
  const state = normalizeState(priorState, policy.replay.persistLedger);
  for (const eventValue of events) {
    const event = clone(eventValue);
    state.clock += 1;
    if (
      !event ||
      typeof event.id !== "string" ||
      typeof event.aggregateId !== "string" ||
      !Number.isInteger(event.version) ||
      event.version < 1 ||
      !isRecord(event.data)
    ) {
      state.outcomes.push({ eventId: String(event?.id ?? "malformed"), outcome: "invalid" });
      continue;
    }
    if (policy.idempotency.key === "eventId" && state.processed[event.id]) {
      mark(state, event, policy.idempotency.duplicateOutcome);
      continue;
    }

    if (event.failure?.type === "after_side_effect" && !policy.idempotency.atomic && event.type === "PaymentCaptured") {
      state.sideEffects += 1;
    }
    const delivery = failureResult(policy, state, event, state.clock);
    if (delivery?.terminal) continue;
    applyEvent(policy, state, event, delivery?.attempts ?? 1, delivery?.backoffMs ?? []);
  }
  if (!policy.replay.deterministic) state.replayNonce = state.clock;
  else delete state.replayNonce;
  return { correct: true, errors: [], state };
}

export function snapshot(state) {
  return stable({
    aggregates: state.aggregates,
    processed: state.processed,
    versions: state.versions,
    sideEffects: state.sideEffects,
    dlq: state.dlq,
  });
}

export function encodeSubmission(policy) {
  return Buffer.from(JSON.stringify(policy), "utf8").toString("base64url");
}

export function decodeSubmission(value) {
  if (typeof value !== "string" || value.length < 16 || value.length > 8192) return null;
  try {
    const decoded = Buffer.from(value, "base64url").toString("utf8");
    if (Buffer.from(decoded, "utf8").toString("base64url") !== value.replace(/=+$/, "")) return null;
    const parsed = JSON.parse(decoded);
    return validatePolicy(parsed).length === 0 ? parsed : null;
  } catch {
    return null;
  }
}

export function outcomeNames(result) {
  return result.state.outcomes.map((item) => item.outcome).filter((item) => OUTCOMES.has(item));
}
