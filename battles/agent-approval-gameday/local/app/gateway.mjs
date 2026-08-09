/**
 * The phase-aware tool gateway (Issue 390).
 *
 * ## What "an AI agent's capability" means here
 *
 * Not how well it writes. What tools it can call, with what credential, over what
 * scope. The three phases change exactly that and nothing else:
 *
 *   1  no tools at all — the operator reads the incident themselves
 *   2  read-only tools — the agent can investigate, and can change nothing
 *   3  write tools — and only through propose → preview → approve → execute
 *
 * ## Why the token is bound to a phase
 *
 * A token minted in phase 2 stays a phase-2 token after phase 3 opens. Without that,
 * "read-only" means "read-only until the clock moves", and a long-lived agent session
 * silently gains write access nobody granted it. The check is server side and fails
 * closed: the gateway never trusts a phase the caller claims.
 *
 * ## What this deliberately does not do
 *
 * It does not try to detect whether the participant used an AI outside the platform.
 * That is unenforceable and not the lesson. What is enforced is access to *the
 * problem's own tools*; whether an event bans outside AI is the organizer's rule.
 */

import { createHash } from "node:crypto";

/** Tools by the phase that first exposes them. Higher phases include lower ones. */
export const TOOLS_BY_PHASE = {
  1: [],
  2: [
    "list_resources",
    "describe_resource",
    "read_logs",
    "show_dependencies",
    "read_local_runbook",
    "evaluate_plan",
  ],
  3: [
    "propose_change",
    "preview_change",
    "execute_change",
    "rollback_change",
    "verify_post_conditions",
    "revoke_operator_capability",
  ],
};

export const READ_ONLY_TOOLS = TOOLS_BY_PHASE[2];
export const WRITE_TOOLS = TOOLS_BY_PHASE[3];

/** Every tool this gateway will ever expose, in the phase it becomes available. */
export function toolsForPhase(phase) {
  const tools = [];
  for (let level = 1; level <= phase; level += 1) tools.push(...(TOOLS_BY_PHASE[level] ?? []));
  return tools;
}

const sha256 = (value) => createHash("sha256").update(value).digest("hex");

export function createGateway(seed, { now = () => Date.now(), tokenTtlMs = 15 * 60_000 } = {}) {
  return {
    seed,
    now,
    tokenTtlMs,
    phase: 1,
    tokens: new Map(),
    audit: [],
    /** Set once `revoke_operator_capability` runs; phase-3 tokens stop working. */
    operatorRevoked: false,
  };
}

/** The problem's own clock advances phases. A caller can never claim a phase. */
export function advancePhase(gateway, phase) {
  if (phase <= gateway.phase) return gateway.phase;
  gateway.phase = Math.min(3, phase);
  gateway.audit.push({ event: "phase_opened", phase: gateway.phase, at: gateway.now() });
  return gateway.phase;
}

/**
 * Mint a capability token for the phase that is open right now.
 *
 * Scope is fixed at mint time from the phase, not requested by the caller: a caller
 * that could ask for a scope would ask for all of it.
 */
export function issueToken(gateway, sessionId) {
  const phase = gateway.phase;
  const value = `cap-${sha256(`${gateway.seed}:${sessionId}:${phase}:${gateway.tokens.size}`).slice(0, 24)}`;
  const token = {
    value,
    sessionId,
    phase,
    // 失効後に新しく取り直しても write は戻らない。戻るなら失効の意味がない。
    tools: toolsForPhase(phase).filter(
      (tool) => !(gateway.operatorRevoked && WRITE_TOOLS.includes(tool)),
    ),
    expiresAt: gateway.now() + gateway.tokenTtlMs,
  };
  gateway.tokens.set(value, token);
  gateway.audit.push({ event: "token_issued", sessionId, phase, at: gateway.now() });
  return token;
}

/**
 * May this token call this tool, right now?
 *
 * Fails closed on every axis: unknown token, expired token, a tool the token's own
 * phase never granted, a tool the *current* phase has not opened yet, a write tool
 * after the operator capability was revoked, and a session mismatch.
 */
export function authorize(gateway, tokenValue, tool, sessionId) {
  const token = gateway.tokens.get(tokenValue);
  if (!token) return deny(gateway, tool, "unknown_token");
  if (token.expiresAt <= gateway.now()) return deny(gateway, tool, "token_expired");
  if (sessionId !== undefined && token.sessionId !== sessionId) {
    return deny(gateway, tool, "session_mismatch");
  }
  if (!toolsForPhase(3).includes(tool)) return deny(gateway, tool, "unknown_tool");
  // 失効を先に見る。後ろに置くと、失効済みの token が `phase_locked_token` として断られ、
  // 「まだ権限が開いていない」と読める。実際は「渡した権限を返してもらった後」であり、
  // 監査を読む人にとって別の出来事なので、理由をすり替えない。
  if (gateway.operatorRevoked && WRITE_TOOLS.includes(tool)) {
    return deny(gateway, tool, "capability_revoked");
  }
  // token 自身の phase が持たない tool。phase が進んでも古い token は昇格しない。
  if (!token.tools.includes(tool)) return deny(gateway, tool, "phase_locked_token", token.phase);
  // token は持っているが、いまその phase が開いていない (時計は戻らないので実質防御的)。
  if (!toolsForPhase(gateway.phase).includes(tool)) return deny(gateway, tool, "phase_locked");
  gateway.audit.push({ event: "tool_call", tool, phase: gateway.phase, at: gateway.now() });
  return { allowed: true, token };
}

function deny(gateway, tool, reason, tokenPhase) {
  gateway.audit.push({
    event: "tool_denied",
    tool,
    reason,
    phase: gateway.phase,
    tokenPhase,
    at: gateway.now(),
  });
  return { allowed: false, reason };
}

/**
 * End the incident: the temporary write capability goes away.
 *
 * Leaving it in place is the quiet version of the same mistake the whole problem is
 * about — the change window closed, the credential did not.
 */
export function revokeOperatorCapability(gateway) {
  gateway.operatorRevoked = true;
  // 既存 token の `tools` は書き換えない。失効の判定は `operatorRevoked` 一箇所だけにして、
  // 同じことを 2 つの仕組みで表現しない — 片方だけ直したときに食い違うのはそこから始まる。
  gateway.audit.push({ event: "operator_capability_revoked", at: gateway.now() });
  return { revoked: true };
}

/**
 * The tool list a client sees.
 *
 * Phase 1 returns an empty list rather than a list of locked tools: a client that is
 * shown names it cannot call will try them, and the resulting denials say nothing
 * about the incident.
 */
export function listTools(gateway) {
  const available = toolsForPhase(gateway.phase).filter(
    (tool) => !(gateway.operatorRevoked && WRITE_TOOLS.includes(tool)),
  );
  return { phase: gateway.phase, tools: available };
}
