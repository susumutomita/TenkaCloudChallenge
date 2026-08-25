/**
 * The participant's own build (Issue 470).
 *
 * ## Why config, not files
 *
 * The issue lists `observability/otel-collector.yaml`, `operations/runbooks/*.yaml` and
 * similar as *candidates* for what a participant edits, but its own "Fairness" section
 * is explicit that no particular product or file format is the one true answer — what
 * is graded is the capability contract, not the artifact. `stackstack-observability`
 * (#288) and `agent-approval-gameday` (#390) both resolve that the same way: an HTTP
 * API (and a plain-form Workbench in front of it) that mutates **in-memory,
 * per-session** state. That state never touches the repository, resets cleanly on
 * `/reset`, and needs no writable bind mount, no volume permissions and no per-session
 * directory cleanup — all real risk for a scaffold this size, none of it load-bearing
 * for the lesson.
 *
 * ## Why the shape is closed, not an open document
 *
 * A free-form JSON blob would let a participant invent a `requestId` metric label or an
 * unbounded set of custom dimensions — exactly the high-cardinality / PII-in-labels
 * failure the issue's mutation list calls out. Rather than build that footgun and then
 * build a detector for it, this store only exposes a small enum of pre-vetted toggles
 * and numeric knobs. A participant cannot create a bad label because there is no label
 * to create; they can only choose whether route/status/dependency breakdown — a fixed,
 * safe set — is switched on. The one place free-form content does reach the log
 * stream (`logs.includeAuthHeader`) is offered as a deliberately bad-sounding-good
 * option so the "no secrets in logs" lesson has a real lever (see `world.mjs`).
 *
 * ## What is genuinely load-bearing here vs. what is a reveal switch
 *
 * `resilience` changes real system dynamics: a shorter timeout, a smaller retry
 * budget and an enabled circuit breaker measurably change whether the shared worker
 * pool exhausts under a degraded dependency (see `world.mjs` `advanceTick`). That is
 * not a config toggle standing in for behavior — it *is* the behavior.
 *
 * `observability` and `alerts` mostly gate *visibility* into ground truth the platform
 * always computes. That is still meaningful because (a) the exposed numbers are cross-
 * checked against ground truth so nothing can be faked, and (b) evidence entries are
 * only recorded for the ticks where the relevant capability was already on — turning a
 * dimension on mid-incident does not retroactively produce the evidence it would have
 * captured (see `recordEvidence` in world.mjs). "Reveal what is real, and only from the
 * moment you reveal it" is the exact shape of real observability tooling.
 */

export function defaultResilience() {
  return {
    // The starter's own defect: a timeout long enough that a hung call ties up its
    // pool slot for most of a Build-phase tick budget, and enough retries that one
    // slow call can multiply into eight attempts before giving up.
    timeoutMs: 15000,
    maxRetries: 6,
    circuitBreaker: { enabled: false, failureThreshold: 5, cooldownMs: 8000 },
  };
}

export function defaultObservability() {
  return {
    redMetrics: { byRoute: false, byStatus: false },
    dependencyMetrics: false,
    saturation: { poolGauge: false },
    healthCheck: { mode: "liveness" }, // "liveness" | "synthetic"
    logs: { structured: false, includeRequestId: false, includeAuthHeader: false },
  };
}

export function defaultAlerts() {
  return { rules: [] };
}

const METRICS = new Set([
  "http_error_ratio",
  "http_latency_p99_seconds",
  "http_latency_p50_seconds",
  "dependency_error_ratio",
  "dependency_latency_p99_seconds",
  "worker_pool_saturation",
  "circuit_breaker_state",
]);

// eslint gate note: METRICS above is intentionally a Set literal, not derived from a
// wider config surface — the whole point is that this list is closed.

const OPS = new Set([">", ">="]);
const ROUTES = new Set(["checkout", "order-status"]);

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function validateResilience(input) {
  const errors = [];
  if (!isPlainObject(input)) return { errors: ["resilience config must be an object"] };
  const timeoutMs = input.timeoutMs;
  const maxRetries = input.maxRetries;
  if (typeof timeoutMs !== "number" || !Number.isFinite(timeoutMs) || timeoutMs < 200 || timeoutMs > 60000) {
    errors.push("timeoutMs must be a number between 200 and 60000");
  }
  if (!Number.isInteger(maxRetries) || maxRetries < 0 || maxRetries > 20) {
    errors.push("maxRetries must be an integer between 0 and 20");
  }
  const cb = input.circuitBreaker;
  if (!isPlainObject(cb)) {
    errors.push("circuitBreaker must be an object");
  } else {
    if (typeof cb.enabled !== "boolean") errors.push("circuitBreaker.enabled must be a boolean");
    if (!Number.isInteger(cb.failureThreshold) || cb.failureThreshold < 1 || cb.failureThreshold > 50) {
      errors.push("circuitBreaker.failureThreshold must be an integer between 1 and 50");
    }
    if (
      typeof cb.cooldownMs !== "number" ||
      !Number.isFinite(cb.cooldownMs) ||
      cb.cooldownMs < 1000 ||
      cb.cooldownMs > 120000
    ) {
      errors.push("circuitBreaker.cooldownMs must be a number between 1000 and 120000");
    }
  }
  if (errors.length > 0) return { errors };
  return {
    value: {
      timeoutMs,
      maxRetries,
      circuitBreaker: {
        enabled: cb.enabled,
        failureThreshold: cb.failureThreshold,
        cooldownMs: cb.cooldownMs,
      },
    },
  };
}

export function validateObservability(input) {
  const errors = [];
  if (!isPlainObject(input)) return { errors: ["observability config must be an object"] };
  const red = input.redMetrics;
  const sat = input.saturation;
  const health = input.healthCheck;
  const logs = input.logs;
  if (!isPlainObject(red) || typeof red.byRoute !== "boolean" || typeof red.byStatus !== "boolean") {
    errors.push("redMetrics.byRoute and redMetrics.byStatus must be booleans");
  }
  if (typeof input.dependencyMetrics !== "boolean") errors.push("dependencyMetrics must be a boolean");
  if (!isPlainObject(sat) || typeof sat.poolGauge !== "boolean") {
    errors.push("saturation.poolGauge must be a boolean");
  }
  if (!isPlainObject(health) || (health.mode !== "liveness" && health.mode !== "synthetic")) {
    errors.push("healthCheck.mode must be 'liveness' or 'synthetic'");
  }
  if (
    !isPlainObject(logs) ||
    typeof logs.structured !== "boolean" ||
    typeof logs.includeRequestId !== "boolean" ||
    typeof logs.includeAuthHeader !== "boolean"
  ) {
    errors.push("logs.structured, logs.includeRequestId and logs.includeAuthHeader must be booleans");
  }
  if (errors.length > 0) return { errors };
  return {
    value: {
      redMetrics: { byRoute: red.byRoute, byStatus: red.byStatus },
      dependencyMetrics: input.dependencyMetrics,
      saturation: { poolGauge: sat.poolGauge },
      healthCheck: { mode: health.mode },
      logs: {
        structured: logs.structured,
        includeRequestId: logs.includeRequestId,
        includeAuthHeader: logs.includeAuthHeader,
      },
    },
  };
}

/** One alert rule. Closed metric enum, closed operator set — see file header. */
export function validateAlertRule(rule) {
  const errors = [];
  if (!isPlainObject(rule)) return { errors: ["rule must be an object"] };
  const id = rule.id;
  if (typeof id !== "string" || !/^[a-z0-9][a-z0-9-]{0,39}$/.test(id)) {
    errors.push("id must be kebab-case, 1-40 chars");
  }
  if (typeof rule.metric !== "string" || !METRICS.has(rule.metric)) {
    errors.push(`metric must be one of: ${[...METRICS].join(", ")}`);
  }
  if (rule.route !== undefined && rule.route !== null && !ROUTES.has(rule.route)) {
    errors.push(`route must be one of: ${[...ROUTES].join(", ")} (or omitted)`);
  }
  if (typeof rule.op !== "string" || !OPS.has(rule.op)) {
    errors.push(`op must be one of: ${[...OPS].join(", ")}`);
  }
  if (typeof rule.threshold !== "number" || !Number.isFinite(rule.threshold)) {
    errors.push("threshold must be a finite number");
  }
  if (!Number.isInteger(rule.forTicks) || rule.forTicks < 1 || rule.forTicks > 300) {
    errors.push("forTicks must be an integer between 1 and 300");
  }
  if (errors.length > 0) return { errors };
  return {
    value: {
      id,
      metric: rule.metric,
      route: rule.route ?? null,
      op: rule.op,
      threshold: rule.threshold,
      forTicks: rule.forTicks,
    },
  };
}

export function validateAlerts(input) {
  if (!isPlainObject(input) || !Array.isArray(input.rules)) {
    return { errors: ["alerts config must be { rules: [] }"] };
  }
  if (input.rules.length > 10) return { errors: ["at most 10 rules"] };
  const value = [];
  const seen = new Set();
  for (const [index, rule] of input.rules.entries()) {
    const result = validateAlertRule(rule);
    if (result.errors) return { errors: result.errors.map((e) => `rules[${index}]: ${e}`) };
    if (seen.has(result.value.id)) return { errors: [`rules[${index}]: duplicate id ${result.value.id}`] };
    seen.add(result.value.id);
    value.push(result.value);
  }
  return { value: { rules: value } };
}

export const KNOWN_METRICS = METRICS;
export const KNOWN_ROUTES = ROUTES;

/**
 * Can an alert rule actually see this metric right now? This is the coupling that
 * keeps "build an alert" from being a shortcut around "build the visibility the alert
 * is supposed to be reading" — a rule naming `dependency_error_ratio` before
 * `dependencyMetrics` is switched on has nothing to evaluate, exactly as if that
 * telemetry had never been scraped. `alerts.mjs` calls this before every evaluation;
 * it is not a cache, so flipping the toggle on takes effect on the very next tick and
 * flipping it off makes the rule stop evaluating just as immediately — consistent
 * with `recordEvidence`'s "no retroactive backfill, no retroactive removal either".
 */
export function isMetricVisible(observability, metric, route) {
  if (metric === "dependency_error_ratio" || metric === "dependency_latency_p99_seconds" || metric === "circuit_breaker_state") {
    return observability.dependencyMetrics === true;
  }
  if (metric === "worker_pool_saturation") {
    return observability.saturation.poolGauge === true;
  }
  if (metric === "http_error_ratio" && (route === "checkout" || route === "order-status")) {
    return observability.redMetrics.byRoute === true;
  }
  // Aggregate http_error_ratio / http_latency_* are always on, matching the starter's
  // baseline aggregate-only surface (see file header, defaultObservability).
  return true;
}

export function createConfigStore() {
  return {
    resilience: defaultResilience(),
    observability: defaultObservability(),
    alerts: defaultAlerts(),
  };
}
