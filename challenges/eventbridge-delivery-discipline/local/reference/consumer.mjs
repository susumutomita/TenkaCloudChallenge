function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function stablePayload(event) {
  const payload = {};
  for (const key of Object.keys(event).sort()) {
    if (key !== "id") payload[key] = event[key];
  }
  return JSON.stringify(payload);
}

function validEvent(event) {
  return (
    isRecord(event) &&
    typeof event.id === "string" &&
    event.id.length > 0 &&
    typeof event.aggregateId === "string" &&
    event.aggregateId.length > 0 &&
    Number.isSafeInteger(event.version) &&
    event.version > 0 &&
    typeof event.type === "string" &&
    event.type.length > 0
  );
}

export function createLedger() {
  return {
    aggregates: {},
    processedEventIds: {},
    versionPayloads: {},
    sideEffects: [],
  };
}

export function deliver(ledger, event) {
  if (!isRecord(ledger) || !validEvent(event)) {
    return { outcome: "invalid" };
  }

  if (ledger.processedEventIds[event.id] === true) {
    return { outcome: "duplicate" };
  }

  const current = ledger.aggregates[event.aggregateId];
  const currentVersion = current?.version ?? 0;
  const versionKey = `${event.aggregateId}#${event.version}`;
  const fingerprint = stablePayload(event);

  if (event.version <= currentVersion) {
    const recorded = ledger.versionPayloads[versionKey];
    if (event.version === currentVersion && recorded !== undefined && recorded !== fingerprint) {
      return { outcome: "conflict" };
    }
    return { outcome: "stale" };
  }

  if (event.version !== currentVersion + 1) {
    return { outcome: "version_gap" };
  }

  const next = {
    ...(current ?? {}),
    aggregateId: event.aggregateId,
    version: event.version,
    type: event.type,
  };
  if (event.amount !== undefined) next.amount = event.amount;

  ledger.aggregates[event.aggregateId] = next;
  ledger.processedEventIds[event.id] = true;
  ledger.versionPayloads[versionKey] = fingerprint;

  if (event.type === "PaymentCaptured" && Number.isFinite(event.amount)) {
    ledger.sideEffects.push({ kind: "capture", amount: event.amount });
  }

  return { outcome: "applied" };
}

export async function runWithRetryBudget({ event, maxAttempts, invoke }) {
  if (!validEvent(event) || !Number.isSafeInteger(maxAttempts) || maxAttempts < 1) {
    return { outcome: "invalid", dlq: null };
  }
  if (typeof invoke !== "function") {
    return { outcome: "invalid", dlq: null };
  }

  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const value = await invoke(event, attempt);
      return { outcome: "delivered", attempts: attempt, value, dlq: null };
    } catch (error) {
      lastError = error;
    }
  }

  const errorMessage =
    lastError instanceof Error ? lastError.message : String(lastError ?? "unknown delivery failure");
  return {
    outcome: "retry_exhausted",
    attempts: maxAttempts,
    dlq: {
      event: structuredClone(event),
      attempts: maxAttempts,
      errorCode: "DELIVERY_FAILED",
      errorMessage,
      exhaustedCondition: "MaximumRetryAttempts",
    },
  };
}
