/**
 * The order service, as a tick-driven simulation (Issue 470, Variant A: slow
 * dependency -> retry storm).
 *
 * ## Why ticks, not wall-clock time
 *
 * A 90-minute Battle cannot be exercised by a test suite that waits 90 minutes. Every
 * other timed mechanic in this repository solves that by decoupling "when things
 * happen" from "how long the test waits" (`agent-approval-gameday`'s `tickPhases(session,
 * now)` takes an explicit clock). Here the decoupling goes one step further: **1 tick
 * is the unit of simulated time**, nominally 1 second. Production drives it with
 * `setInterval`; a test drives it by calling `step()` in a plain loop. Both paths run
 * the identical function, so nothing about "real Docker" behaves differently from what
 * the fast suite already checked — only the wall-clock pacing differs.
 *
 * ## The mechanism, in one paragraph
 *
 * `payment-gateway` (or whichever name this seed picked) gets completely stuck for
 * every call between `incidentPlan.startTick` and `healTick`. A client that gives up
 * quickly (`resilience.timeoutMs` small) and does not retry much (`maxRetries` small)
 * pays a bounded, short cost per checkout. A client that waits a long time and retries
 * many times ties up a shared capacity slot for `(1 + maxRetries) * timeoutTicks` per
 * checkout — long enough, at the default arrival rate, to fill the whole pool within a
 * few ticks. Once the pool is full, **every** route is rejected, including the
 * `order-status` reads that never touch the dependency at all. That one fact is the
 * whole "readiness actually matters" claim this problem exists to test: nothing about
 * *how* a participant fixes this matters except whether the pool stays under capacity.
 * A circuit breaker earns its keep by making the too-many-retries path close itself off
 * after `failureThreshold` consecutive failures, instead of one central "if you did the
 * right thing" check that a mutation could quietly bypass.
 *
 * ## What is ground truth vs. what the participant can see
 *
 * `world.history` is the ground truth: it is written every tick regardless of what
 * capability toggles are on, and the hidden verifier and the mutation suite trust it,
 * never the participant's own `/metrics`. `metrics.mjs` and `logs.mjs` render *views*
 * of this same history, gated by `world.config.observability`; `recordEvidence` below
 * additionally gates on **the capability having been on at the tick the event
 * happened**, which is what makes retroactive observability physically impossible
 * rather than merely discouraged (see the file header in `config-store.mjs`).
 */

import { createHash } from "node:crypto";
import { createBenignEvents, createIncidentPlan, evidenceId, phaseSchedule, rng } from "./fixtures.mjs";
import { createConfigStore, defaultAlerts, defaultObservability, defaultResilience } from "./config-store.mjs";
import { evaluateRules } from "./alerts.mjs";

export const POOL_SIZE = 30;
export const NORMAL_RATE = 10; // order-status arrivals/tick
export const CHECKOUT_RATE = 8; // checkout arrivals/tick
const HISTORY_LIMIT = 8000; // 120-min run is 7200 ticks; this covers the whole thing plus margin
const EVIDENCE_LIMIT = 500;
const LOG_LIMIT = 1500;
const IMPACT_BUDGET_START = 1000;

export const ROLES = ["ic", "ops", "comms", "scribe"];

function newHistoryEntry(tick) {
  return {
    tick,
    checkout: { success: 0, degraded: 0, error: 0, rejected: 0, latencyMsSum: 0, latencyCount: 0 },
    orderStatus: { success: 0, rejected: 0 },
    dependency: { success: 0, timeout: 0, circuitOpen: 0 },
    poolInFlight: 0,
    breakerState: "closed",
    saturated: false,
  };
}

export function createWorld(seed, options = {}) {
  const durationMode = options.durationMode === "120" ? "120" : "90";
  const schedule = phaseSchedule(durationMode, options.phaseOverrides ?? {});
  const incidentPlan = createIncidentPlan(seed, schedule);
  const benignEvents = createBenignEvents(seed, schedule);
  return {
    seed,
    durationMode,
    poolSize: POOL_SIZE,
    schedule,
    incidentPlan,
    benignEvents,
    tick: 0,
    pool: [],
    resilience: { consecutiveFailures: 0, breaker: { state: "closed", openedAtTick: 0, manualOverride: false } },
    config: createConfigStore(),
    history: [],
    evidence: [],
    logs: [],
    alerts: { states: {}, events: [] },
    evidenceSequence: 0,
    impactBudgetUsed: 0,
    penalties: [],
    overrides: { stopped: false },
    audit: [],
    incident: {
      declared: false,
      severity: null,
      declaredAtTick: null,
      roles: {},
      facts: [],
      hypotheses: [],
      actions: [],
      updates: [],
      withdrawals: [],
      resolved: false,
      resolvedAtTick: null,
      resolveRejections: [],
    },
    achievements: {},
  };
}

// --- phase -----------------------------------------------------------------

export function currentPhase(world, tick = world.tick) {
  const s = world.schedule;
  if (tick < s.buildEndsAt) return "build";
  if (tick < s.calibrateEndsAt) return "calibrate";
  if (tick < s.incidentEndsAt) return "incident";
  return "stabilize";
}

function activeBenignEvent(world, tick) {
  return world.benignEvents.find((event) => tick >= event.tick && tick < event.tick + Math.max(event.durationTicks, 1));
}

/** Is the dependency stuck this tick? True for the whole incident window, and for the
 * single Calibrate blip tick (see fixtures.mjs createBenignEvents). */
function isDependencyStuck(world, tick) {
  const { startTick, healTick } = world.incidentPlan;
  if (tick >= startTick && tick < healTick) return true;
  const blip = world.benignEvents.find((event) => event.kind === "single-dependency-blip");
  return blip !== undefined && tick === blip.tick;
}

function trafficMultiplier(world, tick) {
  const spike = world.benignEvents.find((event) => event.kind === "traffic-spike");
  if (spike && tick >= spike.tick && tick < spike.tick + spike.durationTicks) return 3;
  return 1;
}

// --- circuit breaker ---------------------------------------------------------

function breakerState(world, tick) {
  const cb = world.config.resilience.circuitBreaker;
  const r = world.resilience;
  if (r.breaker.manualOverride) return "open";
  if (!cb.enabled) return "closed";
  const cooldownTicks = Math.ceil(cb.cooldownMs / 1000);
  if (r.breaker.state === "open" && tick - r.breaker.openedAtTick >= cooldownTicks) {
    return "half-open";
  }
  return r.breaker.state;
}

function onDependencyOutcome(world, tick, success) {
  const cb = world.config.resilience.circuitBreaker;
  const r = world.resilience;
  if (success) {
    r.consecutiveFailures = 0;
    if (r.breaker.state === "half-open" && !r.breaker.manualOverride) r.breaker.state = "closed";
    return;
  }
  r.consecutiveFailures += 1;
  if (r.breaker.state === "half-open") {
    r.breaker.state = "open";
    r.breaker.openedAtTick = tick;
    return;
  }
  if (cb.enabled && r.breaker.state === "closed" && r.consecutiveFailures >= cb.failureThreshold) {
    r.breaker.state = "open";
    r.breaker.openedAtTick = tick;
  }
}

// --- the tick step -----------------------------------------------------------

/** Deterministic small jitter for realistic-looking (but not simulation-affecting)
 * reported latencies. Never used for pool/timeout math. */
function jitterMs(seed, tick, label, base, spread) {
  const next = rng(`${seed}:hist`);
  return base + Math.floor(next(`${tick}:${label}`) * spread);
}

export function step(world) {
  world.tick += 1;
  const tick = world.tick;
  world.pool = world.pool.filter((entry) => entry.finishAtTick > tick);

  const entry = newHistoryEntry(tick);
  entry.breakerState = breakerState(world, tick);
  world.resilience.breaker.state = entry.breakerState;

  // Checked once per tick (an admission-control interval), not once per request: if
  // the pool has room at all, this whole tick's arrivals are admitted, which can push
  // occupancy slightly past POOL_SIZE within the same tick. That is fine — the signal
  // that matters for every gate that reads `entry.saturated` is "was the pool at or
  // over capacity", not the exact overshoot.
  const saturated = world.pool.length >= POOL_SIZE;
  entry.saturated = saturated;
  entry.poolInFlight = world.pool.length;

  if (world.overrides.stopped) {
    entry.checkout.rejected = CHECKOUT_RATE;
    entry.orderStatus.rejected = NORMAL_RATE;
  } else {
    const normalCount = Math.round(NORMAL_RATE * trafficMultiplier(world, tick));
    for (let i = 0; i < normalCount; i += 1) {
      if (saturated) entry.orderStatus.rejected += 1;
      else entry.orderStatus.success += 1;
    }

    const stuck = isDependencyStuck(world, tick);
    let halfOpenTrialUsed = false;
    for (let i = 0; i < CHECKOUT_RATE; i += 1) {
      if (saturated) {
        entry.checkout.rejected += 1;
        continue;
      }
      if (!stuck) {
        entry.checkout.success += 1;
        entry.dependency.success += 1;
        entry.checkout.latencyMsSum += jitterMs(world.seed, tick, `ok:${i}`, 150, 150);
        entry.checkout.latencyCount += 1;
        onDependencyOutcome(world, tick, true);
        continue;
      }
      // Read live state, not the tick-start snapshot: a real breaker reacts within the
      // same instant its threshold is crossed, and re-checking per iteration keeps a
      // single very-high-arrival tick from pushing far more pool entries than the
      // threshold should ever allow through before tripping.
      const state = world.resilience.breaker.state;
      const allowThrough = state === "closed" || (state === "half-open" && !halfOpenTrialUsed);
      if (!allowThrough) {
        entry.checkout.degraded += 1;
        entry.dependency.circuitOpen += 1;
        entry.checkout.latencyMsSum += 30;
        entry.checkout.latencyCount += 1;
        continue;
      }
      if (state === "half-open") halfOpenTrialUsed = true;
      const timeoutTicks = Math.max(1, Math.ceil(world.config.resilience.timeoutMs / 1000));
      const attempts = 1 + world.config.resilience.maxRetries;
      const holdTicks = attempts * timeoutTicks;
      world.pool.push({ finishAtTick: tick + holdTicks, kind: "checkout-retry" });
      entry.checkout.error += 1;
      entry.dependency.timeout += attempts;
      entry.checkout.latencyMsSum += world.config.resilience.timeoutMs;
      entry.checkout.latencyCount += 1;
      onDependencyOutcome(world, tick, false);
      recordEvidence(world, tick, {
        kind: "dependency-timeout",
        dependency: world.incidentPlan.dependency,
        route: "checkout",
        message: `${world.incidentPlan.dependency} timed out after ${attempts} attempt(s)`,
      });
    }
  }

  recordLogs(world, tick, entry);
  world.history.push(entry);
  if (world.history.length > HISTORY_LIMIT) world.history.shift();

  updateImpactBudget(world, tick, entry);
  evaluateAlerts(world, tick);
  return entry;
}

// --- evidence (capability-gated, no retroactive backfill) --------------------

/** Only recorded when the relevant capability was already on *this tick*. A capability
 * flipped on after the fact never produces evidence for ticks before it was flipped —
 * there is no code path that walks `world.history` backwards to backfill `evidence`. */
export function recordEvidence(world, tick, payload) {
  const observability = world.config.observability;
  const capable = observability.dependencyMetrics || observability.logs.structured;
  if (!capable) return;
  world.evidenceSequence += 1;
  world.evidence.push({
    id: evidenceId(world.incidentPlan, world.evidenceSequence),
    tick,
    ...payload,
  });
  if (world.evidence.length > EVIDENCE_LIMIT) world.evidence.shift();
}

function recordLogs(world, tick, entry) {
  const logs = world.config.observability.logs;
  if (entry.checkout.error === 0 && entry.checkout.degraded === 0 && entry.orderStatus.rejected === 0) return;
  const base = {
    tick,
    service: "order-api",
    severity: entry.checkout.error > 0 ? "error" : "warn",
    route: entry.checkout.error > 0 ? "checkout" : "order-status",
    outcome: entry.checkout.error > 0 ? "dependency_timeout" : "rejected",
  };
  if (logs.structured) {
    const requestId = logs.includeRequestId
      ? createHash("sha256").update(`${world.seed}:req:${tick}`).digest("hex").slice(0, 12)
      : undefined;
    const authHeader = logs.includeAuthHeader ? "Authorization: Bearer sk_live_local_dev_do_not_use" : undefined;
    if (authHeader && !world.penalties.some((p) => p.reason === "secret_logged")) {
      // Flat, one-time penalty (Issue 470's mutation list: "秘密情報をlogへ出す: -100") — it
      // does not scale with how many lines leaked because the mistake is turning the
      // toggle on at all, not the line count.
      world.penalties.push({ tick, reason: "secret_logged", points: -100 });
    }
    world.logs.push({ ...base, requestId, authHeader, message: `${base.route} ${base.outcome}` });
  } else {
    world.logs.push({
      tick,
      raw: `[${tick}] ${base.service} something happened on ${base.route}`,
    });
  }
  if (world.logs.length > LOG_LIMIT) world.logs.shift();
}

// Share of the 1000-point budget that gets spent if a given failure mode were sustained
// at 100% for the entire incident window. Checkout hard failures and order-status
// collateral (a route that never even calls the dependency) are weighted to blow the
// budget within a modest fraction of the window; a clean circuit-open degrade is
// weighted small enough that even sustaining it for the *whole* window barely dents the
// budget — matching the issue's own "circuit breakerによるきれいなdegradeは小さく" framing.
const CHECKOUT_BAD_BUDGET_SHARE = 0.5;
const ORDER_BAD_BUDGET_SHARE = 0.5;
const DEGRADED_BUDGET_SHARE = 0.05;

function updateImpactBudget(world, tick, entry) {
  const phase = currentPhase(world, tick);
  if (phase !== "incident" && phase !== "stabilize") return;
  if (tick < world.incidentPlan.startTick) return;
  const checkoutTotal = entry.checkout.success + entry.checkout.degraded + entry.checkout.error + entry.checkout.rejected;
  const orderTotal = entry.orderStatus.success + entry.orderStatus.rejected;
  const checkoutBadFraction = checkoutTotal > 0 ? (entry.checkout.error + entry.checkout.rejected) / checkoutTotal : 0;
  const degradedFraction = checkoutTotal > 0 ? entry.checkout.degraded / checkoutTotal : 0;
  const orderBadFraction = orderTotal > 0 ? entry.orderStatus.rejected / orderTotal : 0;
  // Normalized by *this seed's own* incident length (not a fixed tick count), so the
  // same weights are meaningful whether the run is a 40-tick compressed test or the
  // real 90/120-minute schedule.
  const window = Math.max(1, world.incidentPlan.healTick - world.incidentPlan.startTick);
  const cost =
    (checkoutBadFraction * CHECKOUT_BAD_BUDGET_SHARE +
      orderBadFraction * ORDER_BAD_BUDGET_SHARE +
      degradedFraction * DEGRADED_BUDGET_SHARE) *
    (IMPACT_BUDGET_START / window);
  world.impactBudgetUsed = Math.min(IMPACT_BUDGET_START, world.impactBudgetUsed + cost);
}

export function impactBudgetRemaining(world) {
  return IMPACT_BUDGET_START - world.impactBudgetUsed;
}

/**
 * Ground truth for "the incident actually happened, and it is over": the whole
 * stuck-dependency window has been lived through (`healTick` reached, so every tick that
 * could ever charge the impact budget has been charged) *and* the run has moved on to
 * Stabilize, the phase whose entire job is confirming recovery. Neither half is visible
 * to the participant.
 *
 * Any gate that judges *the outcome of the incident* has to consult this rather than a
 * budget threshold alone. "The budget has not been spent yet" and "the budget survived
 * the incident" are the same number at tick 1 of Build and mean opposite things; without
 * this predicate a full-marks outcome gate is satisfied before there is anything to
 * have an outcome about.
 */
export function incidentWindowElapsed(world, tick = world.tick) {
  return tick >= world.incidentPlan.healTick && currentPhase(world, tick) === "stabilize";
}

// --- alerts -------------------------------------------------------------------

function evaluateAlerts(world, tick) {
  evaluateRules(world, tick);
}

// --- actions --------------------------------------------------------------

export function applyAction(world, tick, action) {
  const type = action?.type;
  if (type === "open-circuit-breaker") {
    world.resilience.breaker.manualOverride = true;
    world.resilience.breaker.state = "open";
    world.resilience.breaker.openedAtTick = tick;
    world.audit.push({ tick, event: "circuit_breaker_manual_open" });
    return { ok: true };
  }
  if (type === "close-circuit-breaker") {
    world.resilience.breaker.manualOverride = false;
    world.resilience.breaker.state = "closed";
    world.resilience.consecutiveFailures = 0;
    world.audit.push({ tick, event: "circuit_breaker_manual_close" });
    return { ok: true };
  }
  if (type === "restart-service") {
    // Clears the symptom, not the cause: the pool empties, but resilience config is
    // untouched, so if the dependency is still stuck, saturation recurs within a few
    // ticks of the very next arrivals. See scripts/sre-incident-readiness.test.ts
    // "restart-only remediation recurs".
    world.pool = [];
    world.resilience.consecutiveFailures = 0;
    world.audit.push({ tick, event: "restart_service" });
    return { ok: true };
  }
  if (type === "stop-service") {
    world.overrides.stopped = true;
    world.penalties.push({ tick, reason: "stop_service", points: -300 });
    world.audit.push({ tick, event: "stop_service" });
    return { ok: true };
  }
  if (type === "start-service") {
    world.overrides.stopped = false;
    world.audit.push({ tick, event: "start_service" });
    return { ok: true };
  }
  if (type === "stop-load-generator") {
    world.penalties.push({ tick, reason: "injector_reachability_attempt", points: -300 });
    world.audit.push({ tick, event: "stop_load_generator_denied" });
    return { ok: false, error: "injector_unreachable" };
  }
  return { ok: false, error: "unknown_action" };
}

export { defaultAlerts, defaultObservability, defaultResilience };
