/**
 * Seed-derived facts about one run of the incident (Issue 470).
 *
 * ## Why a deterministic hash stream
 *
 * Same seed, same incident, on every machine — the same `rng(seed)` construction
 * `agent-approval-gameday` uses. That is what lets the reference solution, the mutation
 * fixtures and the solvability sweep all agree on what "the answer" is for a given seed
 * without sharing any mutable state.
 *
 * ## What varies, what never does
 *
 * The dependency's display name, the exact incident start tick, how long it stays sick
 * and the evidence id prefix all vary by seed. What never varies:
 *
 *   - exactly one dependency degrades (Variant A: a slow downstream call)
 *   - the degradation starts after `PHASE.calibrate` has already ended
 *   - the degradation is severe enough that the *default* (unbounded-ish retry, long
 *     timeout, no circuit breaker) resilience config amplifies it into pool exhaustion
 *   - a short timeout + small retry budget + circuit breaker keeps the shared pool
 *     from ever saturating
 *
 * `scripts/sre-incident-readiness.test.ts` checks the third and fourth points hold —
 * "starter fails, reference passes" for one concrete seed, and a sweep across many.
 */

import { createHash } from "node:crypto";

/** Deterministic per-seed stream, identical construction to agent-approval-gameday. */
export function rng(seed) {
  let counter = 0;
  return (label) => {
    const digest = createHash("sha256").update(`sre-incident:${seed}:${label}:${counter}`).digest();
    counter += 1;
    return digest.readUInt32BE(0) / 0x1_0000_0000;
  };
}

const pick = (next, list, label) => list[Math.floor(next(label) * list.length) % list.length];
const int = (next, label, min, max) => min + Math.floor(next(label) * (max - min + 1));

export const DEPENDENCY_NAMES = ["payment-gateway", "billing-service", "card-processor", "settlement-api"];

/**
 * The phase schedule, in ticks (1 tick = 1 simulated second).
 *
 * `90` matches the issue's default; `120` extends Build and Incident only, per the
 * issue's "要求する能力は変えない" note — Calibrate and Stabilize stay the same length.
 * Any of the four can be overridden by an env var for compressed manual verification
 * runs (see local/docker-compose.override.yml / README "Fast local verification").
 */
export function phaseSchedule(mode, overrides = {}) {
  const base =
    mode === "120"
      ? { build: 2400, calibrate: 600, incident: 3300, stabilize: 900 }
      : { build: 1500, calibrate: 600, incident: 2400, stabilize: 900 };
  const build = overrides.build ?? base.build;
  const calibrate = overrides.calibrate ?? base.calibrate;
  const incident = overrides.incident ?? base.incident;
  const stabilize = overrides.stabilize ?? base.stabilize;
  return {
    build,
    calibrate,
    incident,
    stabilize,
    buildEndsAt: build,
    calibrateEndsAt: build + calibrate,
    incidentEndsAt: build + calibrate + incident,
    stabilizeEndsAt: build + calibrate + incident + stabilize,
  };
}

/**
 * Variant A: a slow downstream dependency, amplified by however the participant chose
 * to call it. `startTick` and `healTick` are both relative to the whole run (tick 0 =
 * container start), inside the Incident phase with margin at both ends so a team that
 * declares immediately still has time to contain, and so natural healing always
 * finishes before Stabilize needs to confirm recovery.
 */
export function createIncidentPlan(seed, schedule) {
  const next = rng(seed);
  const dependency = pick(next, DEPENDENCY_NAMES, "dependency-name");
  const incidentSpan = schedule.incident;
  const startOffset = Math.floor(incidentSpan * (0.15 + next("start-offset") * 0.2)); // 15-35%
  const startTick = schedule.buildEndsAt + schedule.calibrate + startOffset;
  const healSpan = Math.floor(incidentSpan * (0.18 + next("heal-span") * 0.12)); // 18-30%
  const healTick = Math.min(startTick + healSpan, schedule.incidentEndsAt - Math.floor(incidentSpan * 0.15));
  return {
    dependency,
    // Deterministic, not probabilistic: every dependency call inside [startTick,
    // healTick) is fully stuck. `world.mjs` `step()` derives everything about how bad
    // that is purely from the participant's own resilience config (timeoutMs *
    // (1 + maxRetries) of shared-pool hold time per checkout), which is what makes the
    // starter-vs-reference gap reproduce exactly on every seed instead of only
    // "often".
    startTick,
    healTick,
    evidencePrefix: `EVT-${Math.floor(next("evidence-prefix") * 0xffff)
      .toString(16)
      .padStart(4, "0")}`,
    mechanism: "retry-amplification",
  };
}

/**
 * Benign Phase 2 events. None of these should ever breach customer SLO, and a
 * well-built alert should stay quiet through all of them — that is the whole point of
 * Calibrate. Ticks are relative to the run; all fall inside `[buildEndsAt,
 * calibrateEndsAt)`.
 */
export function createBenignEvents(seed, schedule) {
  const next = rng(seed);
  const span = schedule.calibrate;
  const at = (label, fraction) => schedule.buildEndsAt + Math.floor(span * fraction);
  return [
    {
      kind: "traffic-spike",
      tick: at("spike", 0.15 + next("spike-t") * 0.1),
      durationTicks: int(next, "spike-d", 20, 40),
    },
    {
      kind: "single-dependency-blip",
      tick: at("blip", 0.4 + next("blip-t") * 0.1),
      durationTicks: 1,
    },
    {
      kind: "deploy-marker",
      tick: at("deploy", 0.7 + next("deploy-t") * 0.15),
      durationTicks: 0,
    },
  ];
}

export function evidenceId(plan, sequence) {
  return `${plan.evidencePrefix}-${String(sequence).padStart(4, "0")}`;
}
