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
  world.audit.push({ tick, event: "incident_declared", severity });
  return { ok: true };
}

/**
 * Standing a declaration back down — the recovery path for having declared too early.
 *
 * A team that declares on Calibrate's benign wobble was wrong about *this* being an
 * incident; that is not the same as being unfit to run the real one, and the timing gate
 * in `scoring.mjs` must not treat one twitchy moment as a permanent forfeiture. `declare`
 * still refuses a second declaration while one is in force (`already_declared`) — an
 * incident is not something you silently overwrite — so standing down is a deliberate,
 * audited act rather than a side effect.
 *
 * No cap and no penalty, because there is nothing here to farm: only the declaration
 * *currently in force* is ever scored, and re-declaring can only move its timestamp
 * later, never earlier. Churning declarations strictly hurts the team doing it.
 */
export function withdrawDeclaration(world, tick) {
  const inc = world.incident;
  if (!inc.declared) return { ok: false, error: "not_declared" };
  if (inc.resolved) return { ok: false, error: "already_resolved" };
  const withdrawn = { declaredAtTick: inc.declaredAtTick, severity: inc.severity, withdrawnAtTick: tick };
  inc.withdrawals.push(withdrawn);
  inc.declared = false;
  inc.severity = null;
  inc.declaredAtTick = null;
  world.audit.push({ tick, event: "incident_declaration_withdrawn", declaredAtTick: withdrawn.declaredAtTick });
  return { ok: true, withdrawn };
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
  // In-window on *both* sides. `dependency-timeout` is emitted by every stuck call, and
  // Calibrate's single-tick benign blip is a stuck call too (`isDependencyStuck` in
  // world.mjs) — so a lower bound of `startTick` is what separates "evidence of the
  // incident" from "evidence of the harmless wobble the Calibrate phase exists to
  // produce". Without it a hypothesis could be accepted, and this checkpoint banked,
  // before the incident has begun.
  const hasRealDependencyEvidence = cited.some((id) => {
    const entry = byId.get(id);
    return (
      entry.kind === "dependency-timeout" &&
      entry.tick >= world.incidentPlan.startTick &&
      entry.tick < world.incidentPlan.healTick
    );
  });
  if (!hasRealDependencyEvidence) return { accepted: false, reason: "evidence_does_not_support_mechanism" };
  return { accepted: true };
}

/**
 * The two closed-enum answer fields are the whole enumerable surface of this checkpoint
 * (4 dependency names x 4 mechanisms). Getting one of them wrong is a guess at the
 * answer and has to cost something, or the dropdowns are a free search space.
 *
 * A malformed or unsupported citation (`no_evidence_cited`, `unknown_evidence`,
 * `evidence_does_not_support_mechanism`) is a mistake about the team's own evidence, not
 * a probe at the answer, and stays free — it reveals nothing the team did not already
 * hold.
 */
const GUESS_REJECTIONS = new Set(["wrong_dependency", "wrong_mechanism"]);

/**
 * Escalating, not flat, and recorded in the same `world.penalties` ledger `posture()`
 * already sums and the scoreboard already renders — no new scoring concept. One wrong
 * guess while reasoning costs 25 of 1000; sweeping all four dependency names costs
 * 25+50+75 = 150, exactly cancelling this checkpoint, and sweeping both fields costs
 * 525. A bounded attempt count was the alternative and was rejected: it would reintroduce
 * exactly the permanent-forfeiture cliff that `withdrawDeclaration` above exists to
 * remove.
 */
const WRONG_HYPOTHESIS_PENALTY_STEP = 25;

export function addHypothesis(world, tick, hypothesis) {
  const result = gradeHypothesis(world, hypothesis);
  // Read before pushing: "was this checkpoint already earned" must not include the
  // submission being graded right now.
  const alreadyAccepted = world.incident.hypotheses.some((entry) => entry.accepted === true);
  world.incident.hypotheses.push({ tick, hypothesis, ...result });
  let penaltyPoints = 0;
  if (!alreadyAccepted && !result.accepted && GUESS_REJECTIONS.has(result.reason)) {
    const priorWrongGuesses = world.penalties.filter((entry) => entry.reason === "wrong_hypothesis").length;
    penaltyPoints = -WRONG_HYPOTHESIS_PENALTY_STEP * (priorWrongGuesses + 1);
    world.penalties.push({ tick, reason: "wrong_hypothesis", points: penaltyPoints });
  }
  return { ok: true, accepted: result.accepted, reason: result.reason, penaltyPoints };
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

/**
 * How long after the dependency heals itself a declaration can still count as
 * *detection*: one SLO window — the same span `attemptResolve` below uses to decide
 * whether recovery is real. Inside it the incident's effects are still inside the live
 * measurement window, so a team can legitimately still be noticing them. Past it the
 * numbers have fully turned over and there is nothing left to detect; declaring then is
 * bookkeeping after the fact, not detection.
 *
 * Deriving it from the SLO window rather than a share of the incident keeps the deadline
 * meaningful at every schedule — a compressed 150-tick verification run has the same
 * absolute grace as the real 90-minute one, instead of a few ticks.
 */
export const DECLARATION_GRACE_TICKS = SLO_WINDOW_TICKS;

/** Last tick at which declaring still counts as having detected the incident. Ground
 * truth: `healTick` is never shown to the participant. */
export function declarationDeadline(world) {
  return world.incidentPlan.healTick + DECLARATION_GRACE_TICKS;
}

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
