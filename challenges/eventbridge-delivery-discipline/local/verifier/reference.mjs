export const REFERENCE_POLICY = Object.freeze({
  diagnosis: [
    "duplicate_side_effect",
    "state_regression",
    "same_version_conflict",
    "silent_retry_drop",
  ],
  idempotency: {
    key: "eventId",
    duplicateOutcome: "duplicate",
    atomic: true,
  },
  ordering: {
    key: "version",
    staleOutcome: "stale",
    gapOutcome: "version_gap",
  },
  conflict: {
    fingerprint: "canonical_payload",
    sameVersion: "conflict",
  },
  retry: {
    maxAttempts: 3,
    retryable: ["transient"],
    backoff: "exponential",
  },
  dlq: {
    enabled: true,
    include: [
      "event",
      "reason",
      "attempts",
      "firstFailureAt",
      "lastFailureAt",
      "ruleArn",
      "targetArn",
      "errorCode",
      "exhaustedRetryCondition",
    ],
  },
  replay: {
    persistLedger: true,
    deterministic: true,
  },
});
