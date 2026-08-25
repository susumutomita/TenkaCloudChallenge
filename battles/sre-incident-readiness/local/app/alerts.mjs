/**
 * Alert lifecycle: firing, resolved, and — the point of Phase 2 — noisy (Issue 470).
 *
 * ## Why there is no "is this rule well-written" check
 *
 * There is no static analyzer here for "always true" or "references a fake metric".
 * `config-store.mjs` closes off fake metrics structurally (a rule can only name one of
 * six real series), and "always true" or "too sensitive" are caught the same way a
 * real on-call rotation catches them: **the rule actually fires on real traffic that
 * was not the incident.** A rule is marked noisy the first time it fires before the
 * real incident starts (`world.incidentPlan.startTick`) — during Build, during
 * Calibrate's benign events, or during a stray moment of ordinary jitter. Readiness
 * credit (`scoring.mjs` `readiness-efficacy`) is withheld from any rule carrying that
 * mark, permanently, for the rest of the run. A rule that never sees real traffic
 * before the incident cannot prove it would have stayed quiet, so noise can only be
 * disproved by surviving Build + Calibrate, never asserted by the author.
 *
 * ## Why an alert can only see what observability already exposed
 *
 * `isMetricVisible` (config-store.mjs) is checked before every evaluation. A rule that
 * names `dependency_error_ratio` before `dependencyMetrics` is switched on has nothing
 * to read — evaluated as if that telemetry did not exist, which is exactly what "the
 * alert's query has to reference real, already-scraped telemetry" (Issue 470's own
 * "Alert" capability contract) means. This is not a cache: flipping the toggle off
 * makes a previously-working rule stop evaluating on the very next tick, and flipping
 * it on lets it start immediately — no capability, past or future, is ever assumed.
 *
 * ## Why `forTicks` on both sides
 *
 * A single bad tick should not flip an alert twice a minute. Firing requires the
 * breach to hold for the rule's own `forTicks`; resolving requires the same number of
 * clean ticks. Using one rule-chosen number for both keeps the knob singular — a
 * participant who sets `forTicks` too low both false-fires *and* flaps on resolve; the
 * cost is symmetric, so there is no way to tune around it by only weakening the side
 * that is measured.
 */

import { computeSeriesValue } from "./metrics.mjs";
import { isMetricVisible } from "./config-store.mjs";

function compare(value, op, threshold) {
  if (op === ">") return value > threshold;
  if (op === ">=") return value >= threshold;
  return false;
}

export function evaluateRules(world, tick) {
  const rules = world.config.alerts.rules;
  const activeIds = new Set(rules.map((rule) => rule.id));
  for (const id of Object.keys(world.alerts.states)) {
    if (!activeIds.has(id)) delete world.alerts.states[id];
  }

  for (const rule of rules) {
    const visible = isMetricVisible(world.config.observability, rule.metric, rule.route ?? undefined);
    const value = visible ? computeSeriesValue(world, rule.metric, rule.route ?? undefined) : null;
    const breach = value !== null && compare(value, rule.op, rule.threshold);
    const state =
      world.alerts.states[rule.id] ??
      (world.alerts.states[rule.id] = { firing: false, breachStreak: 0, okStreak: 0, noisy: false, firedAtLeastOnce: false });

    if (breach) {
      state.breachStreak += 1;
      state.okStreak = 0;
    } else {
      state.okStreak += 1;
      state.breachStreak = 0;
    }

    if (!state.firing && state.breachStreak >= rule.forTicks) {
      state.firing = true;
      state.firedAtLeastOnce = true;
      const beforeIncident = tick < world.incidentPlan.startTick;
      if (beforeIncident) state.noisy = true;
      world.alerts.events.push({ tick, ruleId: rule.id, kind: "firing", noisy: beforeIncident });
    } else if (state.firing && state.okStreak >= rule.forTicks) {
      state.firing = false;
      world.alerts.events.push({ tick, ruleId: rule.id, kind: "resolved" });
    }
  }
}

/** A rule "caught the incident" if it is firing, or has fired and not yet resolved,
 * within a reasonable window after the real onset — and was never marked noisy. */
export function alertCaughtIncident(world) {
  const plan = world.incidentPlan;
  for (const rule of world.config.alerts.rules) {
    const state = world.alerts.states[rule.id];
    if (!state || state.noisy) continue;
    const firstFiringAfterOnset = world.alerts.events.find(
      (event) => event.ruleId === rule.id && event.kind === "firing" && event.tick >= plan.startTick && !event.noisy,
    );
    if (firstFiringAfterOnset) {
      return { ruleId: rule.id, firedAtTick: firstFiringAfterOnset.tick, detectionDelayTicks: firstFiringAfterOnset.tick - plan.startTick };
    }
  }
  return null;
}

export function anyRuleNoisy(world) {
  return Object.values(world.alerts.states).some((state) => state.noisy);
}
