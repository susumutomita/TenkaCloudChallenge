import { createHash, createHmac } from "node:crypto";
import { AUTH_FIELDS, LOG_FIELDS, compile } from "./policy.ts";
import type { Action, Checks, Context, Log, Op, Projection, State } from "./types.ts";

export const ROUND_MS = 180_000;
export const roles = (s: State) => ({
  defender: s.ids[(s.round - 1) % 2]!,
  attacker: s.ids[s.round % 2]!,
});
const opaque = (s: State, label: string) =>
  createHmac("sha256", s.secret)
    .update(JSON.stringify([s.eventId, s.round, label]))
    .digest("hex")
    .slice(0, 20);
const digest = (op: unknown) => createHash("sha256").update(JSON.stringify(op)).digest("hex");
const receiptKey = (team: string, id: string) => JSON.stringify([team, id]);
export function initialState(ctx: Context): State {
  if (
    ctx.teamIds.length !== 2 ||
    new Set(ctx.teamIds).size !== 2 ||
    ctx.teamIds.some((t) => !/^[a-zA-Z0-9_-]{1,80}$/.test(t))
  )
    throw new Error("Exactly two distinct team IDs are required");
  if (!ctx.matchSecret || !/^[a-f0-9]{64}$/.test(ctx.matchSecret))
    throw new Error("Server-generated matchSecret is required");
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(ctx.eventId))
    throw new Error("Bounded host event ID is required");
  if (
    ctx.teamIds.some(
      (id) =>
        ctx.teamNames?.[id] !== undefined &&
        (typeof ctx.teamNames[id] !== "string" || ctx.teamNames[id]!.length > 80),
    )
  )
    throw new Error("Host team names must fit 80 UTF-16 units");
  const ids = [...ctx.teamIds].sort();
  return {
    schema: 1,
    eventId: ctx.eventId,
    secret: ctx.matchSecret,
    ids,
    names: Object.fromEntries(ids.map((t) => [t, ctx.teamNames?.[t] ?? t])),
    ready: [],
    revision: 0,
    round: 1,
    phase: "waiting",
    now: 0,
    deadline: 0,
    scores: Object.fromEntries(ids.map((t) => [t, 0])),
    documents: [],
    authorize: "actor.active",
    detect: "false",
    tickets: 4,
    attempts: 0,
    previews: 0,
    baselineAttempted: false,
    damage: 0,
    damaged: [],
    attackFinished: false,
    checked: false,
    patched: false,
    logs: [],
    results: [],
    receipts: {},
  };
}
function openRound(s: State) {
  s.phase = "baseline";
  s.deadline = s.now + ROUND_MS;
  s.authorize = "actor.active";
  s.detect = "false";
  s.documents = [
    {
      id: opaque(s, "own"),
      tenant: "blue",
      title: "Blue notebook",
      delegated: false,
      reads: 0,
      edits: 0,
    },
    {
      id: opaque(s, "foreign"),
      tenant: "orange",
      title: "Orange notebook",
      delegated: false,
      reads: 0,
      edits: 0,
    },
    {
      id: opaque(s, "shared"),
      tenant: "orange",
      title: "Shared reading copy",
      delegated: s.round >= 3,
      reads: 0,
      edits: 0,
    },
  ];
  s.tickets = 4;
  s.attempts = 0;
  s.previews = 0;
  s.baselineAttempted = false;
  s.damage = 0;
  s.damaged = [];
  s.attackFinished = false;
  s.checked = false;
  s.patched = false;
  delete s.checks;
  delete s.preview;
}
function values(
  tenant: string,
  role: string,
  active: boolean,
  documentTenant: string,
  action: Action,
  grant: boolean,
  claim: string,
) {
  return {
    "actor.active": active,
    "actor.tenant": tenant,
    "actor.role": role,
    "document.tenant": documentTenant,
    action,
    "grant.valid": grant,
    "request.tenant": claim,
  };
}
function logValues(
  log: Pick<Log, "allowed" | "actorTenant" | "documentTenant" | "action" | "grantValid">,
) {
  return {
    "event.allowed": log.allowed,
    "event.actorTenant": log.actorTenant,
    "event.documentTenant": log.documentTenant,
    "event.action": log.action,
    "event.grantValid": log.grantValid,
  };
}
export function assess(s: State): Checks {
  const authorize = compile(s.authorize, AUTH_FIELDS),
    detect = compile(s.detect, LOG_FIELDS);
  const checks: Checks = {
    safe: 0,
    safeTotal: 0,
    work: 0,
    workTotal: 0,
    detect: 0,
    detectTotal: 0,
    failures: [],
  };
  const failures = new Set<string>();
  // IDs and tenant names vary per server run. None of these cases enter the Portal bundle.
  const tenantNames = [opaque(s, "case-a"), opaque(s, "case-b")];
  for (const active of [false, true])
    for (const same of [false, true])
      for (const role of ["reader", "editor"])
        for (const action of ["read", "edit"] as const)
          for (const grant of [false, true])
            for (const forged of [false, true]) {
              const tenant = tenantNames[0]!,
                target = tenantNames[same ? 0 : 1]!;
              const validGrant = grant && action === "read";
              const expected =
                active &&
                ((same && (action === "read" || role === "editor")) ||
                  (action === "read" && validGrant));
              const allowed = authorize(
                values(tenant, role, active, target, action, validGrant, forged ? target : tenant),
              );
              if (expected) {
                checks.workTotal++;
                if (allowed) checks.work++;
                else failures.add("legitimate_work");
              } else {
                checks.safeTotal++;
                if (!allowed) checks.safe++;
                else failures.add(active ? "tenant_or_role_boundary" : "inactive_actor");
              }
              // Detection is evaluated on both allowed and denied historical events, independently of today's patch.
              for (const historicAllowed of [false, true]) {
                const expectedAlert =
                  historicAllowed && !same && !(action === "read" && validGrant);
                checks.detectTotal++;
                if (
                  detect(
                    logValues({
                      allowed: historicAllowed,
                      actorTenant: tenant,
                      documentTenant: target,
                      action,
                      grantValid: validGrant,
                    }),
                  ) === expectedAlert
                )
                  checks.detect++;
                else failures.add(expectedAlert ? "missed_cross_tenant_success" : "false_alert");
              }
            }
  checks.failures = [...failures];
  return checks;
}
export function publicTests(authorizeSource: string, detectSource: string) {
  const authorize = compile(authorizeSource, AUTH_FIELDS),
    detect = compile(detectSource, LOG_FIELDS);
  const cases: [string, Record<string, string | boolean>, boolean][] = [
    [
      "active reader blue → blue read",
      values("blue", "reader", true, "blue", "read", false, "orange"),
      true,
    ],
    [
      "active reader blue → orange read, no grant",
      values("blue", "reader", true, "orange", "read", false, "orange"),
      false,
    ],
    [
      "active editor blue → blue edit",
      values("blue", "editor", true, "blue", "edit", false, "blue"),
      true,
    ],
    [
      "inactive editor blue → blue read",
      values("blue", "editor", false, "blue", "read", false, "blue"),
      false,
    ],
    [
      "active reader blue → orange read, valid grant",
      values("blue", "reader", true, "orange", "read", true, "blue"),
      true,
    ],
  ];
  return [
    ...cases.map(([label, input, expected]) => ({ label, passed: authorize(input) === expected })),
    {
      label: "allowed cross-tenant read, no grant → alert",
      passed: detect(
        logValues({
          allowed: true,
          actorTenant: "blue",
          documentTenant: "orange",
          action: "read",
          grantValid: false,
        }),
      ),
    },
    {
      label: "denied cross-tenant read → no alert",
      passed: !detect(
        logValues({
          allowed: false,
          actorTenant: "blue",
          documentTenant: "orange",
          action: "read",
          grantValid: false,
        }),
      ),
    },
  ];
}
function settle(s: State) {
  const { attacker, defender } = roles(s);
  const completed =
    s.baselineAttempted && s.patched && s.checked && s.attackFinished && s.attempts > 0;
  const c = s.checks;
  const defensePoints =
    completed && c
      ? Math.max(
          0,
          Math.floor(
            (40 * c.safe) / c.safeTotal +
              (40 * c.work) / c.workTotal +
              (20 * c.detect) / c.detectTotal,
          ) - s.damage,
        )
      : 0;
  const attackPoints = s.damage;
  s.scores[attacker]! += attackPoints;
  s.scores[defender]! += defensePoints;
  s.results.push({
    round: s.round,
    attacker,
    defender,
    attackPoints,
    defensePoints,
    damage: s.damage,
    completed,
    ...(c ? { checks: c } : {}),
    authorize: s.authorize,
    detect: s.detect,
  });
  if (s.round === 4) {
    s.phase = "finished";
    s.deadline = 0;
  } else {
    s.round++;
    openRound(s);
  }
}
export function tick(state: State, now: number): State {
  if (!Number.isSafeInteger(now) || now < 0 || now <= state.now) return state;
  const s = structuredClone(state);
  s.now = now;
  if (!["waiting", "finished"].includes(s.phase) && now >= s.deadline) {
    if (s.phase === "baseline") {
      s.phase = "patch";
      s.deadline = now + ROUND_MS;
    } else if (s.phase === "patch") {
      s.phase = "retest";
      s.deadline = now + ROUND_MS;
      s.damage = 0;
      s.damaged = [];
      s.tickets = 4;
      s.attempts = 0;
    } else settle(s);
    s.revision++;
  }
  return s;
}
export function validateOp(
  s: State,
  team: string,
  input: unknown,
): { ok: true } | { ok: false; error: string } {
  const fail = (error: string) => ({ ok: false as const, error });
  if (!s.ids.includes(team)) return fail("unknown_team");
  if (!input || typeof input !== "object" || Array.isArray(input)) return fail("invalid_op");
  const op = input as Record<string, unknown>;
  const keys: Record<string, string[]> = {
    ready: [],
    try: ["documentId", "action", "requestTenant"],
    finish: [],
    patch: ["authorize", "detect"],
    preview: ["authorize", "detect"],
    check: [],
  };
  if (
    typeof op.kind !== "string" ||
    !Object.hasOwn(keys, op.kind) ||
    Object.keys(op).some(
      (k) => !["id", "revision", "kind", ...keys[op.kind as string]!].includes(k),
    )
  )
    return fail("invalid_fields");
  if (
    typeof op.id !== "string" ||
    !/^[a-zA-Z0-9_-]{1,64}$/.test(op.id) ||
    !Number.isSafeInteger(op.revision)
  )
    return fail("invalid_request");
  const prior = s.receipts[receiptKey(team, op.id)];
  if (prior) return prior === digest(input) ? { ok: true } : fail("request_id_reused");
  if (Object.keys(s.receipts).length >= 128) return fail("receipt_limit");
  if (s.phase === "finished") return fail("match_finished");
  if (op.revision !== s.revision) return fail("stale_revision");
  const { attacker, defender } = roles(s);
  if (op.kind === "ready")
    return s.phase === "waiting" && !s.ready.includes(team) ? { ok: true } : fail("not_waiting");
  if (op.kind === "patch" || op.kind === "preview") {
    if (s.phase !== "patch" || team !== defender) return fail("not_defender_turn");
    if (op.kind === "preview" && s.previews >= 8) return fail("preview_limit");
    if (typeof op.authorize !== "string" || typeof op.detect !== "string")
      return fail("invalid_code");
    try {
      compile(op.authorize, AUTH_FIELDS);
      compile(op.detect, LOG_FIELDS);
    } catch (e) {
      return fail(e instanceof Error ? e.message : "invalid_code");
    }
    return { ok: true };
  }
  if (op.kind === "check")
    return s.phase === "retest" && team === defender && !s.checked
      ? { ok: true }
      : fail("not_check_turn");
  if (team !== attacker || !["baseline", "retest"].includes(s.phase) || s.attackFinished)
    return fail("not_attacker_turn");
  if (op.kind === "finish") return s.attempts > 0 ? { ok: true } : fail("try_first");
  if (s.tickets <= 0) return fail("no_tickets");
  if (
    typeof op.documentId !== "string" ||
    !s.documents.some((d) => d.id === op.documentId) ||
    !["read", "edit"].includes(op.action as string) ||
    !["blue", "orange"].includes(op.requestTenant as string)
  )
    return fail("invalid_attempt");
  return { ok: true };
}
export function applyOp(state: State, team: string, op: Op): State {
  const verdict = validateOp(state, team, op);
  if (!verdict.ok) throw new Error(verdict.error);
  const key = receiptKey(team, op.id);
  if (state.receipts[key]) return state;
  const s = structuredClone(state);
  s.receipts[key] = digest(op);
  s.revision++;
  if (op.kind === "ready") {
    s.ready.push(team);
    if (s.ready.length === 2) openRound(s);
  }
  if (op.kind === "try") {
    const doc = s.documents.find((d) => d.id === op.documentId)!;
    const grantValid = doc.delegated && op.action === "read";
    const allowed = compile(
      s.authorize,
      AUTH_FIELDS,
    )(values("blue", "reader", true, doc.tenant, op.action, grantValid, op.requestTenant));
    const unauthorized = (doc.tenant !== "blue" && !grantValid) || op.action === "edit";
    const damageKey = JSON.stringify([doc.id, op.action]);
    const damage = allowed && unauthorized && !s.damaged.includes(damageKey) ? 25 : 0;
    const entry: Log = {
      round: s.round,
      phase: s.phase,
      actorTenant: "blue",
      documentTenant: doc.tenant,
      action: op.action,
      requestTenant: op.requestTenant,
      allowed,
      grantValid,
      alert: false,
      damage,
    };
    entry.alert = compile(s.detect, LOG_FIELDS)(logValues(entry));
    s.logs.push(entry);
    s.tickets--;
    s.attempts++;
    if (allowed) {
      if (op.action === "read") doc.reads++;
      else doc.edits++;
    }
    if (damage) s.damaged.push(damageKey);
    if (s.phase === "baseline") s.baselineAttempted = true;
    else s.damage += damage;
  }
  if (op.kind === "finish") {
    if (s.phase === "baseline") {
      s.phase = "patch";
      s.deadline = s.now + ROUND_MS;
    } else {
      s.attackFinished = true;
      if (s.checked) settle(s);
    }
  }
  if (op.kind === "patch") {
    s.authorize = op.authorize;
    s.detect = op.detect;
    s.patched = true;
    s.phase = "retest";
    s.deadline = s.now + ROUND_MS;
    s.damage = 0;
    s.damaged = [];
    s.tickets = 4;
    s.attempts = 0;
    s.documents.forEach((d) => {
      d.reads = 0;
      d.edits = 0;
    });
  }
  if (op.kind === "preview") {
    s.preview = publicTests(op.authorize, op.detect);
    s.previews++;
  }
  if (op.kind === "check") {
    s.checks = assess(s);
    s.checked = true;
    if (s.attackFinished) settle(s);
  }
  return s;
}
export function projectForTeam(s: State, me: string): Projection {
  if (!s.ids.includes(me)) throw new Error("unknown_team");
  return structuredClone({
    revision: s.revision,
    round: s.round,
    phase: s.phase,
    now: s.now,
    deadline: s.deadline,
    me,
    role: roles(s).attacker === me ? "attacker" : "defender",
    names: s.names,
    scores: s.scores,
    ready: s.ready,
    documents: s.documents,
    actor: { tenant: "blue", role: "reader", active: true },
    authorize: s.authorize,
    detect: s.detect,
    tickets: s.tickets,
    attempts: s.attempts,
    previews: s.previews,
    damage: s.damage,
    attackFinished: s.attackFinished,
    checked: s.checked,
    ...(s.checks ? { checks: s.checks } : {}),
    ...(s.preview ? { preview: s.preview } : {}),
    logs: s.logs,
    results: s.results,
  });
}
export const teamScores = (s: State) => ({ ...s.scores });
