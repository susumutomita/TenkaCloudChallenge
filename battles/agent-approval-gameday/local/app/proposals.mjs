/**
 * propose → preview → approve → execute, and why it is four steps (Issue 390).
 *
 * A write tool that just does the thing is the failure this problem is about. The
 * order here exists so that between "the agent suggested it" and "the world changed"
 * there is a point where a human sees **what would actually be touched**, resolved
 * against the world as it is now, and has to say yes to that exact content.
 *
 * ## The digest, and what it defends against
 *
 * `preview_change` resolves the selector and returns an `approvalDigest` computed over
 * the resolved target list and action. `execute_change` requires that digest back.
 *
 * The point is not authentication — the participant is the only actor. It is
 * time-of-check to time-of-use: a selector like `tag:suspicious=true` resolves to a
 * different set as the world changes, so a preview approved five minutes ago can no
 * longer describe what the same proposal would do now. Sending the stale digest is
 * refused and audited rather than silently re-resolved, because "I approved this" has
 * to mean "I approved these resources", not "I approved this sentence".
 *
 * ## Selectors
 *
 * `exact` names resource ids. `tag` and `name` are the broad forms — the ones a vague
 * instruction produces. Broad selectors are not blocked: they are previewable, and the
 * preview shows the collateral. Blocking them would remove the decision the problem
 * exists to teach.
 */

import { createHash } from "node:crypto";
import { findResource, protectedIds } from "./world.mjs";

const sha256 = (value) => createHash("sha256").update(value).digest("hex");

export const ACTIONS = ["isolate", "stop", "delete", "disable"];
export const SELECTOR_KINDS = ["exact", "tag", "name"];

/** A selector's reach, resolved against the world **now**. */
export function resolveSelector(world, selector) {
  if (!selector || typeof selector !== "object") return [];
  if (selector.kind === "exact") {
    const wanted = Array.isArray(selector.resourceIds) ? selector.resourceIds : [];
    return world.resources.filter((resource) => wanted.includes(resource.id));
  }
  if (selector.kind === "tag") {
    return world.resources.filter((resource) => resource.tags[selector.tag] === selector.value);
  }
  if (selector.kind === "name") {
    const needle = String(selector.contains ?? "");
    return needle.length === 0
      ? []
      : world.resources.filter((resource) => resource.name.includes(needle));
  }
  return [];
}

export const isBroad = (selector) => selector?.kind === "tag" || selector?.kind === "name";

const nextState = (action) =>
  action === "delete" ? "deleted" : action === "disable" ? "disabled" : "isolated";

/**
 * An immutable proposal.
 *
 * Immutable matters: the audit record has to be able to say what was approved. Editing
 * a proposal produces a new one, so an approval can never end up attached to content
 * that has since changed.
 */
export function createProposal(store, input) {
  const errors = [];
  if (!ACTIONS.includes(input.action)) errors.push(`action must be one of ${ACTIONS.join(", ")}`);
  if (!SELECTOR_KINDS.includes(input.selector?.kind)) {
    errors.push(`selector.kind must be one of ${SELECTOR_KINDS.join(", ")}`);
  }
  if (!Array.isArray(input.evidenceIds) || input.evidenceIds.length === 0) {
    errors.push("evidenceIds must name at least one piece of evidence");
  }
  if (!Array.isArray(input.expectedPostConditions) || input.expectedPostConditions.length === 0) {
    errors.push("expectedPostConditions must state what should be true afterwards");
  }
  if (typeof input.rollbackAction !== "string" || input.rollbackAction.length === 0) {
    errors.push("rollbackAction must say how to undo this");
  }
  if (errors.length > 0) return { errors };

  const proposal = Object.freeze({
    id: `prp-${sha256(`${store.seed}:${store.proposals.length}`).slice(0, 12)}`,
    action: input.action,
    selector: Object.freeze({ ...input.selector }),
    evidenceIds: Object.freeze([...input.evidenceIds]),
    expectedPostConditions: Object.freeze([...input.expectedPostConditions]),
    protectedResources: Object.freeze([...(input.protectedResources ?? [])]),
    rollbackAction: input.rollbackAction,
  });
  store.proposals.push(proposal);
  return { proposal };
}

export const findProposal = (store, proposalId) =>
  store.proposals.find((proposal) => proposal.id === proposalId) ?? null;

/**
 * What this proposal would do to the world as it stands.
 *
 * `collateral` is the part worth reading: resources the selector reaches that are
 * neither the compromised worker nor a throwaway canary. The preview names them
 * plainly — the participant's job is to notice, not to decode.
 */
export function previewProposal(world, store, proposalId) {
  const proposal = findProposal(store, proposalId);
  if (!proposal) return { error: "unknown_proposal" };

  const targets = resolveSelector(world, proposal.selector);
  const protectedSet = new Set(protectedIds(world));
  const to = nextState(proposal.action);
  const changes = targets.map((resource) => ({
    resourceId: resource.id,
    name: resource.name,
    kind: resource.kind,
    from: resource.state,
    to,
  }));
  const collateral = targets
    .filter((resource) => resource.id !== world.compromisedId && resource.kind !== "canary")
    .map((resource) => ({
      resourceId: resource.id,
      name: resource.name,
      kind: resource.kind,
      protected: protectedSet.has(resource.id),
    }));
  // 依存で巻き添えになるもの。「1 つしか止めていない」のに本番が落ちる経路がここ。
  const targetIds = new Set(targets.map((resource) => resource.id));
  const dependents = world.resources
    .filter(
      (resource) =>
        !targetIds.has(resource.id) &&
        resource.dependsOn.some((dependency) => targetIds.has(dependency)),
    )
    .map((resource) => ({ resourceId: resource.id, name: resource.name, kind: resource.kind }));

  const digest = approvalDigest(proposal, changes);
  store.previews.set(proposal.id, digest);
  return {
    proposalId: proposal.id,
    action: proposal.action,
    broadSelector: isBroad(proposal.selector),
    changes,
    collateral,
    dependents,
    reversible: proposal.action !== "delete",
    approvalDigest: digest,
  };
}

/** Over the resolved content, never over the proposal text alone. */
export function approvalDigest(proposal, changes) {
  const canonical = JSON.stringify({
    id: proposal.id,
    action: proposal.action,
    changes: changes
      .map((change) => `${change.resourceId}:${change.from}->${change.to}`)
      .sort((a, b) => a.localeCompare(b)),
  });
  return sha256(canonical).slice(0, 32);
}

/**
 * Apply a previewed, approved proposal.
 *
 * Refusals are recorded, not swallowed. "Executed with no preview" and "executed with
 * a digest that no longer describes the world" are both things the incident review
 * needs to see, and both are scored.
 */
export function executeProposal(world, store, proposalId, submittedDigest) {
  const proposal = findProposal(store, proposalId);
  if (!proposal) return { error: "unknown_proposal" };

  const targets = resolveSelector(world, proposal.selector);
  const to = nextState(proposal.action);
  const changes = targets.map((resource) => ({
    resourceId: resource.id,
    name: resource.name,
    kind: resource.kind,
    from: resource.state,
    to,
  }));
  const current = approvalDigest(proposal, changes);

  if (!store.previews.has(proposal.id)) {
    store.audit.push({ event: "execute_refused", proposalId, reason: "never_previewed" });
    store.executedWithoutPreview += 1;
    return { error: "not_previewed", refused: true };
  }
  if (submittedDigest !== current) {
    store.audit.push({
      event: "execute_refused",
      proposalId,
      reason: submittedDigest === store.previews.get(proposal.id) ? "world_moved" : "digest_mismatch",
    });
    store.staleDigestAttempts += 1;
    return { error: "stale_digest", refused: true, expected: current };
  }

  const undo = [];
  for (const resource of targets) {
    undo.push({ resourceId: resource.id, from: resource.state });
    resource.state = to;
  }
  store.executions.push({ proposalId: proposal.id, undo, action: proposal.action });
  store.audit.push({
    event: "executed",
    proposalId,
    action: proposal.action,
    resourceIds: targets.map((resource) => resource.id),
  });
  return { proposalId, applied: changes };
}

/**
 * Undo an execution.
 *
 * `delete` is deliberately not undoable. A problem where every mistake rewinds teaches
 * that approval is cheap. The penalty and the audit record for a lost evidence store
 * stay whatever the participant does afterwards — that is the point of the checkpoint
 * about protecting evidence.
 */
export function rollbackProposal(world, store, proposalId) {
  const execution = store.executions.find((entry) => entry.proposalId === proposalId);
  if (!execution) return { error: "not_executed" };
  if (execution.action === "delete") {
    store.audit.push({ event: "rollback_refused", proposalId, reason: "delete_is_terminal" });
    return { error: "not_reversible", refused: true };
  }
  for (const entry of execution.undo) {
    const resource = findResource(world, entry.resourceId);
    if (resource) resource.state = entry.from;
  }
  store.audit.push({ event: "rolled_back", proposalId });
  return { proposalId, rolledBack: execution.undo.length };
}

export function createProposalStore(seed) {
  return {
    seed,
    proposals: [],
    previews: new Map(),
    executions: [],
    /** Append-only from the participant's side: the surface offers no way to edit it. */
    audit: [],
    executedWithoutPreview: 0,
    staleDigestAttempts: 0,
    /** Phase 1's structured hypothesis, once it has been graded correct. */
    hypothesisAccepted: false,
    /** Availability probe ticks during which the production API did not answer. */
    outageTicks: 0,
  };
}
