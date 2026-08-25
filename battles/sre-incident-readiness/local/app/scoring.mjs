/**
 * The six checkpoints, mapped 1:1 onto Issue 470's own scoring table (Issue 470).
 *
 * The issue proposes six weighted categories (Readiness efficacy 150 / Detection-
 * declaration 150 / Evidence-based diagnosis 150 / Customer impact 250 / Safe
 * containment 200 / Incident command 100 = 1000). This file is that table, each row
 * turned into one externally-observable gate. None of them are graded from anything
 * the participant asserts about themselves — see each gate function for what it reads
 * instead.
 */

import { createHash } from "node:crypto";
import { alertCaughtIncident } from "./alerts.mjs";
import { impactBudgetRemaining } from "./world.mjs";

const sha256 = (value) => createHash("sha256").update(value).digest("hex");

export const CHECKPOINTS = [
  "readiness-efficacy",
  "detection-declaration",
  "evidence-based-diagnosis",
  "customer-impact",
  "safe-containment",
  "incident-command-closure",
];

export const POINTS = {
  "readiness-efficacy": 150,
  "detection-declaration": 150,
  "evidence-based-diagnosis": 150,
  "customer-impact": 250,
  "safe-containment": 200,
  "incident-command-closure": 100,
};

export const tokenFor = (seed, checkpointId) =>
  `SRE{${checkpointId.replace(/-/g, "")}_${sha256(`gate:${checkpointId}:${seed}`).slice(0, 16)}}`;

/** A rule the participant wrote caught the real onset without ever having been
 * flagged noisy. "Built it, and it worked when it mattered" — not "built something". */
function gateReadinessEfficacy(world) {
  return alertCaughtIncident(world) !== null;
}

/** Explicit declaration, at or after the real onset, with more than one role staffed. */
function gateDetectionDeclaration(world) {
  const inc = world.incident;
  if (!inc.declared || inc.declaredAtTick === null) return false;
  if (inc.declaredAtTick < world.incidentPlan.startTick) return false;
  return Object.keys(inc.roles).length >= 2;
}

function gateEvidenceBasedDiagnosis(world) {
  return world.incident.hypotheses.some((entry) => entry.accepted === true);
}

/** Cumulative customer-impact budget: monotonically spent from the real onset onward,
 * never restored. See `world.mjs` `updateImpactBudget`. */
function gateCustomerImpact(world) {
  return impactBudgetRemaining(world) >= 700;
}

/**
 * Contained, not just quiet. Fails immediately and permanently if `stop-service` or a
 * `stop-load-generator` attempt was ever recorded (see `world.mjs` `applyAction`);
 * otherwise reads the incident-window slice of `world.history` for two independent
 * facts: the `order-status` route (never calls the dependency) stayed almost entirely
 * healthy, and the shared pool spent only a small fraction of the window fully
 * saturated. Neither can be faked by a participant's own `/metrics` — both come
 * straight out of ground truth.
 */
function gateSafeContainment(world) {
  const disqualified = world.penalties.some(
    (entry) => entry.reason === "stop_service" || entry.reason === "injector_reachability_attempt",
  );
  if (disqualified) return false;
  const relevant = world.history.filter(
    (entry) => entry.tick >= world.incidentPlan.startTick && entry.tick < world.incidentPlan.healTick,
  );
  if (relevant.length === 0) return false;
  const orderTotal = relevant.reduce((sum, e) => sum + e.orderStatus.success + e.orderStatus.rejected, 0);
  const orderBad = relevant.reduce((sum, e) => sum + e.orderStatus.rejected, 0);
  const orderStatusOk = orderTotal === 0 || orderBad / orderTotal < 0.05;
  const saturatedTicks = relevant.filter((e) => e.saturated).length;
  const saturationOk = saturatedTicks / relevant.length < 0.1;
  return orderStatusOk && saturationOk;
}

/** `attemptResolve` in incident.mjs already enforces: declared, override reverted, a
 * structured update posted, and the SLO actually holding. This gate just reads whether
 * that succeeded. */
function gateIncidentCommandClosure(world) {
  return world.incident.resolved === true;
}

const GATE_FNS = {
  "readiness-efficacy": gateReadinessEfficacy,
  "detection-declaration": gateDetectionDeclaration,
  "evidence-based-diagnosis": gateEvidenceBasedDiagnosis,
  "customer-impact": gateCustomerImpact,
  "safe-containment": gateSafeContainment,
  "incident-command-closure": gateIncidentCommandClosure,
};

export function evaluateGates(world) {
  const gates = {};
  for (const id of CHECKPOINTS) gates[id] = GATE_FNS[id](world);
  return gates;
}

export function posture(world) {
  const gates = evaluateGates(world);
  const tokens = {};
  for (const id of CHECKPOINTS) tokens[id] = gates[id] ? tokenFor(world.seed, id) : null;
  const earned = CHECKPOINTS.filter((id) => gates[id]).reduce((total, id) => total + POINTS[id], 0);
  const penaltyPoints = world.penalties.reduce((total, entry) => total + entry.points, 0);
  return {
    tick: world.tick,
    gates,
    tokens,
    points: POINTS,
    penalties: world.penalties,
    score: Math.max(0, earned + penaltyPoints),
    maxScore: CHECKPOINTS.reduce((total, id) => total + POINTS[id], 0),
    ready: CHECKPOINTS.every((id) => gates[id]),
    impactBudgetRemaining: impactBudgetRemaining(world),
  };
}
