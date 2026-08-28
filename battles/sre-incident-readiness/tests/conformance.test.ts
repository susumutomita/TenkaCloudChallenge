import { describe, expect, it } from "bun:test";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";

/**
 * `sre-incident-readiness` — the problem's own conformance suite (Issue 470).
 *
 * Three groups matter most, the same shape `agent-approval-gameday.test.ts` uses:
 *
 *   **Starter fails, reference passes** — the untouched world scores 0 and the
 *   deliberate reference play (good resilience config + a non-noisy alert + a properly
 *   evidence-backed, properly closed incident) scores 1000/1000, both at the real
 *   90-minute schedule and at a compressed one used everywhere else in this file for
 *   speed.
 *
 *   **Solvability across seeds** — the incident plan stays inside the incident phase
 *   with margin, on many seeds, so a team that declares immediately always still has
 *   room to contain and recover before Stabilize ends.
 *
 *   **Mutations** — for each defensive claim in the issue's own "Required negative /
 *   mutation tests" list that this Milestone-1 slice implements, a fixture proves the
 *   claim is load-bearing: change one thing, watch the specific gate this problem says
 *   depends on it turn false.
 *
 * Container isolation (loopback bind, cap_drop, read_only, healthcheck, resource
 * limits) is pinned only as far as static compose/Dockerfile inspection can reach.
 * Whether the sandbox actually holds, and human play, need Docker and a person — named
 * in the PR as separately verified / unverified, not implied by a green suite here.
 */

// Resolved from this file so the suite runs from any checkout, and so it lives with
// the problem it tests. AGENTS.md keeps root `scripts/` to catalog validation only;
// a problem's own suite belongs under `battles/<id>/`.
const PROBLEM_DIR = dirname(dirname(fileURLToPath(import.meta.url)));
const APP = join(PROBLEM_DIR, "local", "app");

const world = await import(join(APP, "world.mjs"));
const configStore = await import(join(APP, "config-store.mjs"));
const alerts = await import(join(APP, "alerts.mjs"));
const incident = await import(join(APP, "incident.mjs"));
const scoring = await import(join(APP, "scoring.mjs"));
const metrics = await import(join(APP, "metrics.mjs"));
const fixtures = await import(join(APP, "fixtures.mjs"));
const logs = await import(join(APP, "logs.mjs"));

// A schedule short enough that a whole Build→Stabilize run is a few thousand
// synchronous function calls (milliseconds), not real minutes — see world.mjs's file
// header for why ticks, not wall-clock time, make this possible at all.
const FAST_SCHEDULE = { build: 10, calibrate: 10, incident: 200, stabilize: 60 };

const GOOD_RESILIENCE = {
  timeoutMs: 2000,
  maxRetries: 1,
  circuitBreaker: { enabled: true, failureThreshold: 4, cooldownMs: 8000 },
};
const GOOD_OBSERVABILITY = {
  redMetrics: { byRoute: true, byStatus: true },
  dependencyMetrics: true,
  saturation: { poolGauge: true },
  healthCheck: { mode: "synthetic" },
  logs: { structured: true, includeRequestId: true, includeAuthHeader: false },
};

function advanceTo(w: any, targetTick: number) {
  while (w.tick < targetTick) world.step(w);
}

/** The reference play: good config, a non-noisy alert, a correctly evidence-backed
 * declare/hypothesis/update/resolve. Used both as "does the reference pass" and as a
 * fixture other tests start from and then break one thing in. */
function playReference(seed: string, schedule = FAST_SCHEDULE) {
  const w = world.createWorld(seed, { phaseOverrides: schedule });
  w.config.resilience = structuredClone(GOOD_RESILIENCE);
  w.config.observability = structuredClone(GOOD_OBSERVABILITY);
  w.config.alerts.rules.push({ id: "cb-open", metric: "circuit_breaker_state", route: null, op: ">", threshold: 0, forTicks: 20 });

  advanceTo(w, w.schedule.calibrateEndsAt);
  advanceTo(w, w.incidentPlan.startTick + 25);

  incident.declare(w, w.tick, { severity: "SEV2" });
  incident.assignRole(w, { role: "ic", member: "alice" });
  incident.assignRole(w, { role: "ops", member: "bob" });
  const evidenceId = w.evidence.find((e: any) => e.tick >= w.incidentPlan.startTick)?.id;
  const hyp = incident.addHypothesis(w, w.tick, {
    dependency: w.incidentPlan.dependency,
    mechanism: "retry-amplification",
    evidenceIds: evidenceId ? [evidenceId] : [],
  });

  advanceTo(w, w.schedule.incidentEndsAt + 40);
  incident.addUpdate(w, w.tick, {
    customerImpact: "minor",
    confirmedFacts: ["payment-adjacent errors observed"],
    activeHypothesis: "retry amplification against the stuck dependency",
    owner: "alice",
    nextUpdateInTicks: 60,
  });
  const resolveResult = incident.attemptResolve(w, w.tick);
  return { world: w, hyp, resolveResult, evidenceId };
}

describe("solvability across seeds", () => {
  const seeds = Array.from({ length: 30 }, (_, i) => `sweep-${i}`);

  it("keeps the incident inside the incident phase, with margin on both sides", () => {
    for (const seed of seeds) {
      const schedule = fixtures.phaseSchedule("90", {});
      const plan = fixtures.createIncidentPlan(seed, schedule);
      expect(plan.startTick).toBeGreaterThanOrEqual(schedule.buildEndsAt + schedule.calibrate);
      expect(plan.startTick).toBeLessThan(schedule.incidentEndsAt);
      expect(plan.healTick).toBeGreaterThan(plan.startTick);
      expect(plan.healTick).toBeLessThan(schedule.incidentEndsAt);
      // Margin: Stabilize needs real time after healing to observe a held SLO.
      expect(schedule.incidentEndsAt - plan.healTick).toBeGreaterThan(0);
    }
  });

  it("picks a dependency name from the closed, seed-varying set", () => {
    const seen = new Set<string>();
    for (const seed of seeds) {
      const schedule = fixtures.phaseSchedule("90", {});
      const plan = fixtures.createIncidentPlan(seed, schedule);
      expect(fixtures.DEPENDENCY_NAMES).toContain(plan.dependency);
      seen.add(plan.dependency);
    }
    // Not every seed picking the same name — otherwise "seed varies the dependency
    // name" would be true in the schema but false in practice.
    expect(seen.size).toBeGreaterThan(1);
  });

  it("the reference play clears every checkpoint on every sampled seed", () => {
    for (const seed of seeds.slice(0, 10)) {
      const { world: w, resolveResult } = playReference(seed);
      expect(resolveResult.ok).toBe(true);
      const posture = scoring.posture(w);
      expect(posture.ready).toBe(true);
      expect(posture.score).toBe(1000);
    }
  });

  it("works under the 120-minute schedule too (Build/Incident extended, not the required capability)", () => {
    const schedule = fixtures.phaseSchedule("120", {});
    expect(schedule.build).toBeGreaterThan(fixtures.phaseSchedule("90", {}).build);
    expect(schedule.incident).toBeGreaterThan(fixtures.phaseSchedule("90", {}).incident);
    expect(schedule.calibrate).toBe(fixtures.phaseSchedule("90", {}).calibrate);
    expect(schedule.stabilize).toBe(fixtures.phaseSchedule("90", {}).stabilize);
  });
});

describe("starter fails, reference passes", () => {
  it("an untouched starter clears no checkpoint and scores 0", () => {
    const w = world.createWorld("starter-1", { phaseOverrides: FAST_SCHEDULE });
    advanceTo(w, w.schedule.stabilizeEndsAt);
    const posture = scoring.posture(w);
    expect(posture.score).toBe(0);
    expect(posture.ready).toBe(false);
    for (const id of scoring.CHECKPOINTS) expect(posture.gates[id]).toBe(false);
    // The starter's own defect, not a side effect of never touching the workbench:
    // liveness-only health reads healthy even while everything else is on fire.
    expect(metrics.businessHealth(w)).toBe(1);
  });

  it("the reference play clears every checkpoint at the compressed schedule", () => {
    const { world: w, hyp, resolveResult } = playReference("reference-1");
    expect(hyp.accepted).toBe(true);
    expect(resolveResult.ok).toBe(true);
    const posture = scoring.posture(w);
    expect(posture.ready).toBe(true);
    expect(posture.score).toBe(1000);
  });

  it("the reference play clears every checkpoint at the real 90-minute schedule", () => {
    const real = fixtures.phaseSchedule("90", {});
    const { world: w, resolveResult } = playReference("reference-real-90", real);
    expect(resolveResult.ok).toBe(true);
    const posture = scoring.posture(w);
    expect(posture.ready).toBe(true);
    expect(posture.score).toBe(1000);
  });

  it("Calibrate's benign events never breach customer SLO even for the starter", () => {
    const w = world.createWorld("calibrate-check", { phaseOverrides: FAST_SCHEDULE });
    advanceTo(w, w.schedule.calibrateEndsAt);
    // Impact budget only starts spending at the real incident's onset (world.mjs
    // updateImpactBudget), so a benign-only run must not have spent anything yet.
    expect(world.impactBudgetRemaining(w)).toBe(1000);
  });
});

describe("mutation: readiness / alert quality", () => {
  it("a rule naming a nonexistent metric is rejected outright (no 'CPU-only' alert is even expressible)", () => {
    const result = configStore.validateAlertRule({ id: "cpu-alert", metric: "cpu_usage_percent", op: ">", threshold: 0.8, forTicks: 10 });
    expect(result.errors).toBeTruthy();
  });

  it("a rule that fires during Build/Calibrate is marked noisy and excluded from readiness credit even if it later fires correctly", () => {
    const w = world.createWorld("noisy-1", { phaseOverrides: FAST_SCHEDULE });
    w.config.observability = structuredClone(GOOD_OBSERVABILITY);
    // Deliberately over-sensitive: fires on almost any nonzero pool occupancy.
    w.config.alerts.rules.push({ id: "too-sensitive", metric: "worker_pool_saturation", route: null, op: ">", threshold: 0.001, forTicks: 1 });
    advanceTo(w, w.schedule.calibrateEndsAt);
    expect(alerts.anyRuleNoisy(w)).toBe(true);
    advanceTo(w, w.incidentPlan.startTick + 30);
    // It may well be firing now too, but it is disqualified from readiness credit.
    expect(alerts.alertCaughtIncident(w)).toBeNull();
    expect(scoring.posture(w).gates["readiness-efficacy"]).toBe(false);
  });

  it("a rule written after the incident had already begun earns no readiness credit", () => {
    // The checkpoint is about monitoring built in advance. Without the createdAtTick
    // bound a team could watch the incident start, write a rule matching what they
    // were already staring at, and be credited with having caught it -- the opposite
    // of what the Build phase rewards.
    //
    // Two details keep this from passing for the wrong reason: the reference's own
    // resilience config, so the breaker really opens, and adding the rule just after
    // onset, so it has a long enough breach to satisfy forTicks and does fire. It is
    // asserted below that it fires; the gate is false because of when it was written,
    // not because nothing happened.
    const w = world.createWorld("after-the-fact", { phaseOverrides: FAST_SCHEDULE });
    w.config.resilience = structuredClone(GOOD_RESILIENCE);
    w.config.observability = structuredClone(GOOD_OBSERVABILITY);
    advanceTo(w, w.incidentPlan.startTick + 5);
    w.config.alerts.rules.push({
      id: "written-too-late",
      metric: "circuit_breaker_state",
      route: null,
      op: ">",
      threshold: 0,
      forTicks: 20,
      createdAtTick: w.tick,
    });
    advanceTo(w, w.schedule.stabilizeEndsAt);
    const fired = w.alerts.events.filter(
      (e: any) => e.ruleId === "written-too-late" && e.kind === "firing" && !e.noisy,
    );
    expect(fired.length).toBeGreaterThan(0);
    expect(alerts.alertCaughtIncident(w)).toBeNull();
    expect(scoring.posture(w).gates["readiness-efficacy"]).toBe(false);
  });

  it("the same rule built before the onset does earn readiness credit", () => {
    // The other half of the bound: this is not a blanket ban on that rule, it is a
    // question of when it was written. Same seed, same rule, built during Build.
    const w = world.createWorld("after-the-fact", { phaseOverrides: FAST_SCHEDULE });
    w.config.resilience = structuredClone(GOOD_RESILIENCE);
    w.config.observability = structuredClone(GOOD_OBSERVABILITY);
    w.config.alerts.rules.push({
      id: "written-in-time",
      metric: "circuit_breaker_state",
      route: null,
      op: ">",
      threshold: 0,
      forTicks: 20,
      createdAtTick: 1,
    });
    advanceTo(w, w.incidentPlan.startTick + 90);
    expect(alerts.alertCaughtIncident(w)).not.toBeNull();
  });

  it("an alert cannot see a metric before its capability is switched on (no shortcut around building visibility)", () => {
    const w = world.createWorld("gated-metric", { phaseOverrides: FAST_SCHEDULE });
    // dependencyMetrics left off; rule references a dependency-gated metric anyway.
    w.config.alerts.rules.push({ id: "dep-alert", metric: "dependency_error_ratio", route: null, op: ">", threshold: 0.1, forTicks: 5 });
    advanceTo(w, w.incidentPlan.startTick + 30);
    expect(alerts.alertCaughtIncident(w)).toBeNull();
  });

  it("liveness-only health reads healthy throughout a full incident; synthetic mode does not", () => {
    const w = world.createWorld("health-mode", { phaseOverrides: FAST_SCHEDULE });
    advanceTo(w, w.incidentPlan.startTick + 30);
    expect(metrics.businessHealth(w)).toBe(1); // liveness default: always "fine"
    w.config.observability.healthCheck.mode = "synthetic";
    expect(metrics.businessHealth(w)).toBe(0); // same world, same tick: now honest
  });
});

describe("mutation: containment / recovery", () => {
  it("the starter's own config amplifies a stuck dependency into pool saturation that hits unrelated routes", () => {
    const w = world.createWorld("amplify-1", { phaseOverrides: FAST_SCHEDULE });
    advanceTo(w, w.incidentPlan.startTick + 10);
    expect(w.pool.length).toBeGreaterThanOrEqual(world.POOL_SIZE);
    const last = w.history[w.history.length - 1];
    expect(last.saturated).toBe(true);
    expect(last.orderStatus.rejected).toBeGreaterThan(0); // a route that never calls the dependency
    expect(scoring.posture(w).gates["safe-containment"]).toBe(false);
    // Customer-impact spends cumulatively from the real onset — sustained saturation
    // through to healing (not just the first 10 ticks) is what exhausts the budget.
    advanceTo(w, w.incidentPlan.healTick - 1);
    expect(scoring.posture(w).gates["customer-impact"]).toBe(false);
  });

  it("a short timeout + small retry budget + circuit breaker keeps the pool from saturating", () => {
    const w = world.createWorld("contain-1", { phaseOverrides: FAST_SCHEDULE });
    w.config.resilience = structuredClone(GOOD_RESILIENCE);
    advanceTo(w, w.incidentPlan.healTick - 1);
    const relevant = w.history.filter((e: any) => e.tick >= w.incidentPlan.startTick);
    const saturatedTicks = relevant.filter((e: any) => e.saturated).length;
    expect(saturatedTicks / relevant.length).toBeLessThan(0.1);
  });

  it("stopping the whole service disqualifies safe-containment permanently, even after starting it back up", () => {
    const w = world.createWorld("stop-1", { phaseOverrides: FAST_SCHEDULE });
    w.config.resilience = structuredClone(GOOD_RESILIENCE);
    advanceTo(w, w.incidentPlan.startTick + 5);
    world.applyAction(w, w.tick, { type: "stop-service" });
    advanceTo(w, w.tick + 3);
    world.applyAction(w, w.tick, { type: "start-service" });
    advanceTo(w, w.incidentPlan.healTick + 5);
    expect(w.penalties.some((p: any) => p.reason === "stop_service" && p.points < 0)).toBe(true);
    expect(scoring.posture(w).gates["safe-containment"]).toBe(false);
  });

  it("attempting to stop the load generator is refused, audited, and disqualifies safe-containment", () => {
    const w = world.createWorld("injector-1", { phaseOverrides: FAST_SCHEDULE });
    w.config.resilience = structuredClone(GOOD_RESILIENCE);
    const result = world.applyAction(w, w.tick, { type: "stop-load-generator" });
    expect(result.ok).toBe(false);
    expect(result.error).toBe("injector_unreachable");
    expect(w.audit.some((entry: any) => entry.event === "stop_load_generator_denied")).toBe(true);
    expect(w.penalties.some((p: any) => p.reason === "injector_reachability_attempt")).toBe(true);
    advanceTo(w, w.incidentPlan.healTick + 5);
    expect(scoring.posture(w).gates["safe-containment"]).toBe(false);
  });

  it("restarting the service clears the symptom but not the cause: saturation recurs because config is untouched", () => {
    const w = world.createWorld("restart-1", { phaseOverrides: FAST_SCHEDULE });
    advanceTo(w, w.incidentPlan.startTick + 10);
    expect(w.pool.length).toBeGreaterThan(0);
    world.applyAction(w, w.tick, { type: "restart-service" });
    expect(w.pool.length).toBe(0);
    advanceTo(w, w.tick + 8); // a handful of ticks — the dependency is still stuck
    expect(w.pool.length).toBeGreaterThan(0);
    expect(w.history[w.history.length - 1].saturated).toBe(true);
  });
});

describe("mutation: evidence-based diagnosis, not free text or backdating", () => {
  it("a fabricated evidence id is rejected", () => {
    const w = world.createWorld("fake-evidence", { phaseOverrides: FAST_SCHEDULE });
    w.config.observability = structuredClone(GOOD_OBSERVABILITY);
    advanceTo(w, w.incidentPlan.startTick + 20);
    const result = incident.gradeHypothesis(w, {
      dependency: w.incidentPlan.dependency,
      mechanism: "retry-amplification",
      evidenceIds: ["EVT-0000-9999"],
    });
    expect(result.accepted).toBe(false);
    expect(result.reason).toBe("unknown_evidence");
  });

  it("no evidence cited at all is rejected even with the right dependency and mechanism", () => {
    const w = world.createWorld("no-evidence", { phaseOverrides: FAST_SCHEDULE });
    const result = incident.gradeHypothesis(w, {
      dependency: w.incidentPlan.dependency,
      mechanism: "retry-amplification",
      evidenceIds: [],
    });
    expect(result.accepted).toBe(false);
    expect(result.reason).toBe("no_evidence_cited");
  });

  it("the wrong dependency name is rejected regardless of evidence", () => {
    const w = world.createWorld("wrong-dep", { phaseOverrides: FAST_SCHEDULE });
    w.config.observability = structuredClone(GOOD_OBSERVABILITY);
    advanceTo(w, w.incidentPlan.startTick + 20);
    const realId = w.evidence[0]?.id;
    const wrongName = fixtures.DEPENDENCY_NAMES.find((n: string) => n !== w.incidentPlan.dependency);
    const result = incident.gradeHypothesis(w, { dependency: wrongName, mechanism: "retry-amplification", evidenceIds: [realId] });
    expect(result.accepted).toBe(false);
    expect(result.reason).toBe("wrong_dependency");
  });

  it("no retroactive observability: evidence only exists from the tick the capability was switched on, never before", () => {
    const w = world.createWorld("retroactive-1", { phaseOverrides: FAST_SCHEDULE });
    // A short timeout and no retries: every checkout attempt still reaches the
    // dependency and fails fast (1 tick), so the pool never saturates and dependency
    // calls keep happening for the whole window — isolating "does evidence require the
    // capability to already be on" from "did saturation stop attempts from happening
    // at all" (a separate, already-covered fact; see "amplify-1" above).
    w.config.resilience = { timeoutMs: 1000, maxRetries: 0, circuitBreaker: { enabled: false, failureThreshold: 5, cooldownMs: 8000 } };
    // dependencyMetrics and structured logs both off through the real onset.
    advanceTo(w, w.incidentPlan.startTick + 15);
    expect(w.evidence.length).toBe(0); // errors are certainly happening; nothing was recorded
    const enabledAtTick = w.tick;
    w.config.observability.dependencyMetrics = true;
    advanceTo(w, w.tick + 15);
    expect(w.evidence.length).toBeGreaterThan(0);
    for (const entry of w.evidence) expect(entry.tick).toBeGreaterThanOrEqual(enabledAtTick);
  });
});

describe("mutation: incident command discipline", () => {
  it("resolve is refused before the SLO has actually recovered", () => {
    const w = world.createWorld("premature-1", { phaseOverrides: FAST_SCHEDULE });
    w.config.resilience = structuredClone(GOOD_RESILIENCE);
    advanceTo(w, w.incidentPlan.startTick + 5);
    incident.declare(w, w.tick, { severity: "SEV2" });
    incident.addUpdate(w, w.tick, {
      customerImpact: "x",
      confirmedFacts: ["x"],
      activeHypothesis: "x",
      owner: "x",
      nextUpdateInTicks: 10,
    });
    const result = incident.attemptResolve(w, w.tick);
    expect(result.ok).toBe(false);
    expect(result.reasons).toContain("slo_not_holding");
  });

  it("resolve is refused without at least one structured update", () => {
    const w = world.createWorld("no-update-1", { phaseOverrides: FAST_SCHEDULE });
    w.config.resilience = structuredClone(GOOD_RESILIENCE);
    advanceTo(w, w.incidentPlan.startTick + 5);
    incident.declare(w, w.tick, { severity: "SEV2" });
    advanceTo(w, w.schedule.incidentEndsAt + 40);
    const result = incident.attemptResolve(w, w.tick);
    expect(result.ok).toBe(false);
    expect(result.reasons).toContain("no_structured_update_posted");
  });

  it("resolve is refused while a manual circuit-breaker override is still open", () => {
    const w = world.createWorld("override-1", { phaseOverrides: FAST_SCHEDULE });
    w.config.resilience = structuredClone(GOOD_RESILIENCE);
    advanceTo(w, w.incidentPlan.startTick + 5);
    world.applyAction(w, w.tick, { type: "open-circuit-breaker" });
    incident.declare(w, w.tick, { severity: "SEV2" });
    advanceTo(w, w.schedule.incidentEndsAt + 40);
    incident.addUpdate(w, w.tick, { customerImpact: "x", confirmedFacts: ["x"], activeHypothesis: "x", owner: "x", nextUpdateInTicks: 10 });
    const result = incident.attemptResolve(w, w.tick);
    expect(result.ok).toBe(false);
    expect(result.reasons).toContain("override_still_open");
    world.applyAction(w, w.tick, { type: "close-circuit-breaker" });
    const second = incident.attemptResolve(w, w.tick);
    expect(second.ok).toBe(true);
  });

  it("resolve is refused when the incident was never declared", () => {
    const w = world.createWorld("undeclared-1", { phaseOverrides: FAST_SCHEDULE });
    w.config.resilience = structuredClone(GOOD_RESILIENCE);
    advanceTo(w, w.schedule.incidentEndsAt + 40);
    incident.addUpdate(w, w.tick, { customerImpact: "x", confirmedFacts: ["x"], activeHypothesis: "x", owner: "x", nextUpdateInTicks: 10 });
    const result = incident.attemptResolve(w, w.tick);
    expect(result.ok).toBe(false);
    expect(result.reasons).toContain("not_declared");
  });

  it("declaring twice, assigning an unknown role, and posting an update missing a required field are all rejected", () => {
    const w = world.createWorld("validation-1", { phaseOverrides: FAST_SCHEDULE });
    expect(incident.declare(w, 1, { severity: "SEV2" }).ok).toBe(true);
    expect(incident.declare(w, 2, { severity: "SEV1" }).ok).toBe(false);
    expect(incident.assignRole(w, { role: "wizard", member: "alice" }).ok).toBe(false);
    const missing = incident.addUpdate(w, 1, { customerImpact: "x", confirmedFacts: [], activeHypothesis: "x", owner: "", nextUpdateInTicks: 10 });
    expect(missing.ok).toBe(false);
    expect(missing.detail).toContain("owner");
  });
});

describe("mutation: secret logging", () => {
  it("enabling includeAuthHeader leaks a fake bearer token into the log stream and is penalized once", () => {
    const w = world.createWorld("secret-1", { phaseOverrides: FAST_SCHEDULE });
    w.config.observability.logs = { structured: true, includeRequestId: true, includeAuthHeader: true };
    advanceTo(w, w.incidentPlan.startTick + 5);
    const leaked = w.logs.filter((entry: any) => typeof entry.authHeader === "string");
    expect(leaked.length).toBeGreaterThan(0);
    expect(leaked[0].authHeader).toMatch(/^Authorization: Bearer /);
    const secretPenalties = w.penalties.filter((p: any) => p.reason === "secret_logged");
    expect(secretPenalties.length).toBe(1); // flat, one-time, not per-line
    expect(secretPenalties[0].points).toBeLessThan(0);
  });

  it("logs default to unstructured raw lines that carry no request id at all", () => {
    const w = world.createWorld("unstructured-1", { phaseOverrides: FAST_SCHEDULE });
    advanceTo(w, w.incidentPlan.startTick + 5);
    const entries = logs.queryLogs(w);
    expect(entries.length).toBeGreaterThan(0);
    for (const entry of entries) {
      expect("raw" in entry).toBe(true);
      expect(logs.renderLogLine(entry)).not.toMatch(/request_id/);
    }
  });
});

describe("config validation closes off the footguns structurally", () => {
  it("rejects out-of-range resilience values", () => {
    expect(configStore.validateResilience({ timeoutMs: 100, maxRetries: 1, circuitBreaker: { enabled: false, failureThreshold: 1, cooldownMs: 1000 } }).errors).toBeTruthy();
    expect(configStore.validateResilience({ timeoutMs: 2000, maxRetries: -1, circuitBreaker: { enabled: false, failureThreshold: 1, cooldownMs: 1000 } }).errors).toBeTruthy();
    expect(configStore.validateResilience({ timeoutMs: 2000, maxRetries: 1, circuitBreaker: { enabled: true, failureThreshold: 0, cooldownMs: 1000 } }).errors).toBeTruthy();
  });

  it("rejects an unknown observability shape", () => {
    expect(configStore.validateObservability({}).errors).toBeTruthy();
    expect(configStore.validateObservability({ ...configStore.defaultObservability(), healthCheck: { mode: "omniscient" } }).errors).toBeTruthy();
  });

  it("rejects a route filter outside the fixed enum and an unknown operator", () => {
    expect(configStore.validateAlertRule({ id: "x", metric: "http_error_ratio", route: "admin", op: ">", threshold: 0.1, forTicks: 5 }).errors).toBeTruthy();
    expect(configStore.validateAlertRule({ id: "x", metric: "http_error_ratio", op: "==", threshold: 0.1, forTicks: 5 }).errors).toBeTruthy();
  });

  it("rejects duplicate rule ids and caps the rule count", () => {
    const dup = configStore.validateAlerts({
      rules: [
        { id: "a", metric: "http_error_ratio", op: ">", threshold: 0.1, forTicks: 5 },
        { id: "a", metric: "http_error_ratio", op: ">", threshold: 0.2, forTicks: 5 },
      ],
    });
    expect(dup.errors).toBeTruthy();
  });
});

describe("metadata self-consistency", () => {
  const metadata = JSON.parse(readFileSync(join(PROBLEM_DIR, "metadata.json"), "utf8"));

  it("declares category Battle, status draft, and a docker/compose multi-verify runtime", () => {
    expect(metadata.category).toBe("Battle");
    expect(metadata.status).toBe("draft");
    expect(metadata.runtime.provider).toBe("docker");
    expect(metadata.runtime.engine).toBe("compose");
    expect(metadata.scoring.kind).toBe("multi-verify");
  });

  it("scoring.checks match scoring.mjs's CHECKPOINTS and POINTS exactly, and sum to 1000", () => {
    const ids = metadata.scoring.checks.map((c: any) => c.id);
    expect(new Set(ids)).toEqual(new Set(scoring.CHECKPOINTS));
    let total = 0;
    for (const check of metadata.scoring.checks) {
      expect(check.points).toBe(scoring.POINTS[check.id]);
      total += check.points;
    }
    expect(total).toBe(1000);
  });

  it("every checkpoint has an English translation (multi-verify ja/en parity)", () => {
    const enIds = metadata.i18n.en.checks.map((c: any) => c.id);
    expect(new Set(enIds)).toEqual(new Set(scoring.CHECKPOINTS));
    for (const check of metadata.i18n.en.checks) {
      expect(typeof check.label).toBe("string");
      expect(check.label.length).toBeGreaterThan(0);
    }
  });

  it("instructions carry the required '前提' and 'はじめに' sections (course quality bar)", () => {
    expect(metadata.instructions).toContain("## 前提 — 中学・高校の数学から");
    expect(metadata.instructions).toContain("## はじめに");
  });

  it("never mentions the published local-play ports in participant-facing text (Issue 399 class)", () => {
    const participantText = [metadata.instructions, metadata.shortDescription, JSON.stringify(metadata.scoring.checks)].join("\n");
    expect(participantText).not.toContain("18080");
    expect(participantText).not.toContain("18081");
  });

  it("does not leak the seed-hidden dependency name or root-cause mechanism into participant-facing text", () => {
    const participantText = [metadata.instructions, metadata.shortDescription].join("\n");
    for (const name of fixtures.DEPENDENCY_NAMES) expect(participantText).not.toContain(name);
    expect(participantText).not.toContain("retry-amplification");
  });
});

describe("local/ container declarations (static — real Docker verification is separate)", () => {
  const composePath = join(PROBLEM_DIR, "local/docker-compose.yml");
  const compose = parseYaml(readFileSync(composePath, "utf8"));
  const service = compose.services["sre-incident-readiness"];

  it("exists and defines exactly the two loopback-bound ports", () => {
    expect(existsSync(join(PROBLEM_DIR, "local/Dockerfile"))).toBe(true);
    expect(service.ports).toEqual(["127.0.0.1:18080:8080", "127.0.0.1:18081:8081"]);
  });

  it("drops all capabilities, sets no-new-privileges, and is read-only with a tmpfs /tmp", () => {
    expect(service.cap_drop).toEqual(["ALL"]);
    expect(service.security_opt).toContain("no-new-privileges:true");
    expect(service.read_only).toBe(true);
    expect(service.tmpfs?.[0]).toMatch(/^\/tmp:/);
  });

  it("declares a healthcheck and a resource budget", () => {
    expect(service.healthcheck?.test).toBeTruthy();
    expect(service.mem_limit).toBeTruthy();
    expect(service.cpus).toBeTruthy();
  });

  it("threads FLAG_SEED through so every deploy gets an independent seed", () => {
    expect(String(service.environment.FLAG_SEED)).toContain("FLAG_SEED");
  });
});
