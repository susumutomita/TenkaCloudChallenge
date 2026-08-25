/**
 * Views over `world.history` — ground truth in, a gated projection out (Issue 470).
 *
 * `computeSeriesValue` is the single source both the alert engine and `/metrics` read
 * from. That matters: an alert rule is graded on whether *this exact number*, the one a
 * participant could have seen, crossed their threshold — never on some separate
 * "real" number the renderer does not use. There is nothing to desync.
 *
 * `renderPrometheus` is the only place capability gating happens for metrics. The
 * counters underneath are always the real ones; what changes with
 * `redMetrics.byRoute` / `byStatus` is only whether the series carries that label at
 * all. Collapsing to `route="_all"` rather than omitting the series is deliberate — a
 * participant who never turned dimensions on still sees *a* number, just not one that
 * can answer "which route".
 */

const WINDOW_TICKS = 10;

function recentWindow(world) {
  const n = world.history.length;
  return world.history.slice(Math.max(0, n - WINDOW_TICKS));
}

function ratio(numerator, denominator) {
  return denominator > 0 ? numerator / denominator : 0;
}

/** The one number an alert rule (or /metrics) reads for a given metric+route, over the
 * last WINDOW_TICKS. Returns null when the metric name is unrecognized. */
export function computeSeriesValue(world, metric, route) {
  const window = recentWindow(world);
  if (window.length === 0) return metric === "worker_pool_saturation" ? 0 : null;

  if (metric === "worker_pool_saturation") {
    const last = window[window.length - 1];
    return ratio(last.poolInFlight, world.poolSize);
  }

  const totals = window.reduce(
    (acc, entry) => {
      acc.checkoutTotal +=
        entry.checkout.success + entry.checkout.degraded + entry.checkout.error + entry.checkout.rejected;
      acc.checkoutBad += entry.checkout.error + entry.checkout.rejected;
      acc.orderTotal += entry.orderStatus.success + entry.orderStatus.rejected;
      acc.orderBad += entry.orderStatus.rejected;
      acc.latencySum += entry.checkout.latencyMsSum;
      acc.latencyCount += entry.checkout.latencyCount;
      acc.depTotal += entry.dependency.success + entry.dependency.timeout + entry.dependency.circuitOpen;
      acc.depBad += entry.dependency.timeout;
      return acc;
    },
    { checkoutTotal: 0, checkoutBad: 0, orderTotal: 0, orderBad: 0, latencySum: 0, latencyCount: 0, depTotal: 0, depBad: 0 },
  );

  if (metric === "http_error_ratio") {
    if (route === "order-status") return ratio(totals.orderBad, totals.orderTotal);
    return ratio(totals.checkoutBad, totals.checkoutTotal);
  }
  if (metric === "http_latency_p99_seconds" || metric === "http_latency_p50_seconds") {
    // A window-average stands in for a percentile here: this simulation does not keep
    // raw per-request samples, only per-tick aggregates. p99 and p50 therefore read the
    // same value; both are exposed because a participant's rule can reasonably name
    // either, and neither is misleading about direction (up = worse) even if the exact
    // number is an approximation. Noted as a simplification in README "Design notes".
    return ratio(totals.latencySum, totals.latencyCount) / 1000;
  }
  if (metric === "dependency_error_ratio") {
    return ratio(totals.depBad, totals.depTotal);
  }
  if (metric === "dependency_latency_p99_seconds") {
    return ratio(totals.latencySum, totals.latencyCount) / 1000;
  }
  if (metric === "circuit_breaker_state") {
    return { closed: 0, "half-open": 1, open: 2 }[world.resilience.breaker.state] ?? 0;
  }
  return null;
}

const escapeLabel = (value) => String(value).replace(/["\\]/g, (c) => `\\${c}`);

/** Prometheus text exposition, gated by `observability`. Values always come from
 * `computeSeriesValue` / raw totals — gating only ever removes a label dimension, never
 * changes a number. */
export function renderPrometheus(world) {
  const obs = world.config.observability;
  const lines = [];
  const routes = obs.redMetrics.byRoute ? ["checkout", "order-status"] : ["_all"];

  lines.push("# HELP http_requests_total Total HTTP requests handled by order-api.");
  lines.push("# TYPE http_requests_total counter");
  for (const route of routes) {
    const totals = aggregateRouteTotals(world, route === "_all" ? null : route);
    if (obs.redMetrics.byStatus) {
      lines.push(`http_requests_total{route="${escapeLabel(route)}",status_class="2xx"} ${totals.ok}`);
      lines.push(`http_requests_total{route="${escapeLabel(route)}",status_class="5xx"} ${totals.bad}`);
    } else {
      lines.push(`http_requests_total{route="${escapeLabel(route)}"} ${totals.ok + totals.bad}`);
    }
  }

  lines.push("# HELP http_error_ratio Rolling error ratio over the last 10s.");
  lines.push("# TYPE http_error_ratio gauge");
  for (const route of routes) {
    const value = computeSeriesValue(world, "http_error_ratio", route === "_all" ? undefined : route);
    lines.push(`http_error_ratio{route="${escapeLabel(route)}"} ${(value ?? 0).toFixed(4)}`);
  }

  lines.push("# HELP http_latency_seconds Rolling average checkout latency over the last 10s.");
  lines.push("# TYPE http_latency_seconds gauge");
  lines.push(`http_latency_p50_seconds ${(computeSeriesValue(world, "http_latency_p50_seconds") ?? 0).toFixed(4)}`);
  lines.push(`http_latency_p99_seconds ${(computeSeriesValue(world, "http_latency_p99_seconds") ?? 0).toFixed(4)}`);

  if (obs.dependencyMetrics) {
    lines.push("# HELP dependency_error_ratio Rolling downstream call error ratio.");
    lines.push("# TYPE dependency_error_ratio gauge");
    lines.push(`dependency_error_ratio{dependency="payment"} ${(computeSeriesValue(world, "dependency_error_ratio") ?? 0).toFixed(4)}`);
    lines.push("# HELP dependency_latency_p99_seconds Rolling downstream call p99 latency.");
    lines.push("# TYPE dependency_latency_p99_seconds gauge");
    lines.push(
      `dependency_latency_p99_seconds{dependency="payment"} ${(computeSeriesValue(world, "dependency_latency_p99_seconds") ?? 0).toFixed(4)}`,
    );
    lines.push("# HELP circuit_breaker_state 0=closed 1=half-open 2=open.");
    lines.push("# TYPE circuit_breaker_state gauge");
    const stateValue = { closed: 0, "half-open": 1, open: 2 }[world.resilience.breaker.state] ?? 0;
    lines.push(`circuit_breaker_state{dependency="payment"} ${stateValue}`);
  }

  if (obs.saturation.poolGauge) {
    lines.push("# HELP worker_pool_saturation In-flight / capacity, most recent tick.");
    lines.push("# TYPE worker_pool_saturation gauge");
    lines.push(`worker_pool_saturation ${(computeSeriesValue(world, "worker_pool_saturation") ?? 0).toFixed(4)}`);
  }

  lines.push("# HELP business_health 1 when the synthetic checkout journey is passing, 0 otherwise.");
  lines.push("# TYPE business_health gauge");
  lines.push(`business_health ${businessHealth(world)}`);

  return `${lines.join("\n")}\n`;
}

function aggregateRouteTotals(world, route) {
  const window = recentWindow(world);
  let ok = 0;
  let bad = 0;
  for (const entry of window) {
    if (route === null || route === "checkout") {
      ok += entry.checkout.success + entry.checkout.degraded;
      bad += entry.checkout.error + entry.checkout.rejected;
    }
    if (route === null || route === "order-status") {
      ok += entry.orderStatus.success;
      bad += entry.orderStatus.rejected;
    }
  }
  return { ok, bad };
}

/**
 * `healthCheck.mode`. "liveness" always answers 1 (the starter's own defect: it only
 * knows the process is alive). "synthetic" reflects whether the checkout journey has
 * actually been succeeding recently — the upgrade Phase 1 is asking for.
 */
export function businessHealth(world) {
  if (world.config.observability.healthCheck.mode === "liveness") return 1;
  const window = recentWindow(world);
  if (window.length === 0) return 1;
  const totals = window.reduce(
    (acc, entry) => {
      acc.ok += entry.checkout.success + entry.checkout.degraded;
      acc.total += entry.checkout.success + entry.checkout.degraded + entry.checkout.error + entry.checkout.rejected;
      return acc;
    },
    { ok: 0, total: 0 },
  );
  if (totals.total === 0) return 1;
  return totals.ok / totals.total >= 0.9 ? 1 : 0;
}
