/**
 * Incident Command: declare, assign, fact, hypothesis, update, resolve (Issue 470).
 *
 * ## Why declaring is a separate act from an alert firing
 *
 * The issue's inspiration is the bystander effect at scale — an alert that nobody
 * responds to is not an incident, it is a notification. `world.mjs` never sets
 * `incident.declared` on its own; only `declare()` does, called from a human action.
 * `detection-declaration` in `scoring.mjs` measures the gap between the real onset
 * (`incidentPlan.startTick`, never shown to the participant) and this call.
 *
 * ## Why hypotheses and updates are structured, not prose
 *
 * `gradeHypothesis` never reads free text. It checks three closed facts: does the named
 * dependency match the one that is actually stuck, does the named mechanism match the
 * one actually happening, and does at least one cited evidence id resolve to a real,
 * in-window `dependency-timeout` entry. A fluent wrong guess and a terse right one
 * score identically to how fluent and terse they are — which is to say, not at all.
 * `addUpdate` is the same idea at the shape level: it only requires the five fields the
 * issue's own "structured update" section names, never grades their content.
 */

export const MECHANISMS = ["retry-amplification"];

export function declare(world, tick, { severity }) {
  if (world.incident.declared) return { ok: false, error: "already_declared" };
  const validSeverity = typeof severity === "string" && /^SEV[1-4]$/.test(severity);
  if (!validSeverity) return { ok: false, error: "invalid_severity" };
  world.incident.declared = true;
  world.incident.severity = severity;
  world.incident.declaredAtTick = tick;
  return { ok: true };
}

export function assignRole(world, { role, member }) {
  const ROLES = ["ic", "ops", "comms", "scribe"];
  if (!ROLES.includes(role)) return { ok: false, error: "unknown_role" };
  if (typeof member !== "string" || member.trim().length === 0) return { ok: false, error: "member_required" };
  world.incident.roles[role] = member.trim();
  return { ok: true };
}

export function addFact(world, tick, { text, evidenceIds }) {
  if (typeof text !== "string" || text.trim().length === 0) return { ok: false, error: "text_required" };
  const ids = Array.isArray(evidenceIds) ? evidenceIds : [];
  const real = new Set(world.evidence.map((e) => e.id));
  const unknown = ids.filter((id) => !real.has(id));
  if (unknown.length > 0) return { ok: false, error: "unknown_evidence", detail: unknown };
  world.incident.facts.push({ tick, text: text.trim(), evidenceIds: ids });
  return { ok: true };
}

/**
 * Structural grading only — see file header. Returns `{ ok, accepted, reason }`
 * regardless of correctness so the Workbench can explain a wrong submission without a
 * human (or an LLM) reading prose.
 */
export function gradeHypothesis(world, hypothesis) {
  if (hypothesis?.dependency !== world.incidentPlan.dependency) {
    return { accepted: false, reason: "wrong_dependency" };
  }
  if (hypothesis?.mechanism !== world.incidentPlan.mechanism) {
    return { accepted: false, reason: "wrong_mechanism" };
  }
  const cited = Array.isArray(hypothesis?.evidenceIds) ? hypothesis.evidenceIds : [];
  if (cited.length === 0) return { accepted: false, reason: "no_evidence_cited" };
  const byId = new Map(world.evidence.map((e) => [e.id, e]));
  const unknown = cited.filter((id) => !byId.has(id));
  if (unknown.length > 0) return { accepted: false, reason: "unknown_evidence", detail: unknown };
  const hasRealDependencyEvidence = cited.some((id) => {
    const entry = byId.get(id);
    return entry.kind === "dependency-timeout" && entry.tick < world.incidentPlan.healTick;
  });
  if (!hasRealDependencyEvidence) return { accepted: false, reason: "evidence_does_not_support_mechanism" };
  return { accepted: true };
}

export function addHypothesis(world, tick, hypothesis) {
  const result = gradeHypothesis(world, hypothesis);
  world.incident.hypotheses.push({ tick, hypothesis, ...result });
  return { ok: true, accepted: result.accepted, reason: result.reason };
}

const REQUIRED_UPDATE_FIELDS = ["customerImpact", "confirmedFacts", "activeHypothesis", "owner", "nextUpdateInTicks"];

export function addUpdate(world, tick, update) {
  const missing = REQUIRED_UPDATE_FIELDS.filter((field) => {
    const value = update?.[field];
    if (field === "confirmedFacts") return !Array.isArray(value);
    if (field === "nextUpdateInTicks") return !Number.isFinite(value) || value <= 0;
    return typeof value !== "string" || value.trim().length === 0;
  });
  if (missing.length > 0) return { ok: false, error: "missing_fields", detail: missing };
  world.incident.updates.push({ tick, ...update });
  return { ok: true };
}

function recentFraction(world, ticks, pick) {
  const window = world.history.slice(Math.max(0, world.history.length - ticks));
  if (window.length === 0) return 1;
  let ok = 0;
  let total = 0;
  for (const entry of window) {
    const [okDelta, totalDelta] = pick(entry);
    ok += okDelta;
    total += totalDelta;
  }
  return total > 0 ? ok / total : 1;
}

const SLO_WINDOW_TICKS = 30;

export function slowHoldFractions(world) {
  return {
    checkoutFullSuccess: recentFraction(world, SLO_WINDOW_TICKS, (e) => [e.checkout.success, e.checkout.success + e.checkout.degraded + e.checkout.error + e.checkout.rejected]),
    orderStatusSuccess: recentFraction(world, SLO_WINDOW_TICKS, (e) => [e.orderStatus.success, e.orderStatus.success + e.orderStatus.rejected]),
  };
}

export function attemptResolve(world, tick) {
  const reasons = [];
  if (!world.incident.declared) reasons.push("not_declared");
  if (world.resilience.breaker.manualOverride) reasons.push("override_still_open");
  if (world.incident.updates.length === 0) reasons.push("no_structured_update_posted");
  const holds = slowHoldFractions(world);
  if (holds.checkoutFullSuccess < 0.95 || holds.orderStatusSuccess < 0.98) reasons.push("slo_not_holding");
  if (reasons.length > 0) {
    world.incident.resolveRejections.push({ tick, reasons });
    return { ok: false, reasons };
  }
  world.incident.resolved = true;
  world.incident.resolvedAtTick = tick;
  return { ok: true };
}
