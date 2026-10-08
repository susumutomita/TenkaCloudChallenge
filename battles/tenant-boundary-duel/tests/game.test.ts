import { expect, test } from "bun:test";
import {
  applyOp,
  assess,
  initialState,
  projectForTeam,
  publicTests,
  roles,
  tick,
  validateOp,
} from "../game/reducer.ts";
import { AUTH_FIELDS, LOG_FIELDS, compile } from "../game/policy.ts";
import type { Op, State } from "../game/types.ts";

// Instructor/reference source stays in server-side tests, never in the Portal.
const repair =
  'actor.active && ((actor.tenant == document.tenant && (action == "read" || actor.role == "editor")) || (action == "read" && grant.valid))';
const detector =
  'event.allowed && event.actorTenant != event.documentTenant && !(event.action == "read" && event.grantValid)';
const fresh = (secret = "a".repeat(64)) =>
  initialState({ eventId: "lab", teamIds: ["alpha", "bravo"], matchSecret: secret });
function move(s: State, team: string, payload: Record<string, unknown>, id = `op_${s.revision}`) {
  return applyOp(s, team, { ...payload, id, revision: s.revision } as Op);
}
function start(s = fresh()) {
  return move(move(s, s.ids[0]!, { kind: "ready" }), s.ids[1]!, { kind: "ready" });
}
function patch(s: State, authorize = repair, detect = detector) {
  const r = roles(s);
  s = move(s, r.attacker, {
    kind: "try",
    documentId: s.documents[1]!.id,
    action: "read",
    requestTenant: "orange",
  });
  s = move(s, r.attacker, { kind: "finish" });
  return move(s, r.defender, { kind: "patch", authorize, detect });
}
function finish(s: State) {
  const r = roles(s);
  s = move(s, r.attacker, {
    kind: "try",
    documentId: s.documents[1]!.id,
    action: "read",
    requestTenant: "orange",
  });
  s = move(s, r.defender, { kind: "check" });
  return move(s, r.attacker, { kind: "finish" });
}
test("bounded interpreter evaluates typed expressions and rejects executable code and excessive input", () => {
  const f = compile(
    "actor.active && (actor.tenant == document.tenant || grant.valid)",
    AUTH_FIELDS,
  );
  expect(
    f({
      "actor.active": true,
      "actor.tenant": "blue",
      "document.tenant": "orange",
      "grant.valid": false,
    }),
  ).toBe(false);
  expect(
    f({
      "actor.active": true,
      "actor.tenant": "blue",
      "document.tenant": "orange",
      "grant.valid": true,
    }),
  ).toBe(true);
  for (const source of [
    'fetch("https://example.com")',
    "process.env.SECRET",
    "actor.active = true",
    "true; false",
    "actor.tenant",
    'actor.active == "true"',
    "actor.tenant && true",
    "!actor.tenant",
    "(".repeat(20) + "true" + ")".repeat(20),
    "true".padEnd(1025),
    "true ".repeat(130),
    "__proto__",
  ])
    expect(() => compile(source, AUTH_FIELDS)).toThrow();
  expect(() => compile("event.allowed", AUTH_FIELDS)).toThrow("unknown_field");
  expect(() => compile('request.tenant == "blue"', LOG_FIELDS)).toThrow("unknown_field");
});
test("baseline changes a real dummy record; server identity cannot be replaced by client claims", () => {
  let s = start();
  expect(s.scores).toEqual({ alpha: 0, bravo: 0 });
  expect(
    validateOp(s, "alpha", {
      kind: "try",
      id: "wrong-seat",
      revision: s.revision,
      documentId: s.documents[1]!.id,
      action: "read",
      requestTenant: "blue",
    }),
  ).toEqual({ ok: false, error: "not_attacker_turn" });
  expect(
    validateOp(s, "foreign", { kind: "ready", id: "foreign-seat", revision: s.revision }),
  ).toEqual({ ok: false, error: "unknown_team" });
  s = move(s, "bravo", {
    kind: "try",
    documentId: s.documents[1]!.id,
    action: "edit",
    requestTenant: "orange",
  });
  expect(s.documents[1]!.edits).toBe(1);
  expect(s.logs[0]).toMatchObject({
    allowed: true,
    actorTenant: "blue",
    documentTenant: "orange",
    requestTenant: "orange",
    damage: 25,
    alert: false,
  });
  expect(s.scores).toEqual({ alpha: 0, bravo: 0 });
  expect(
    validateOp(s, "bravo", {
      kind: "try",
      id: "fake",
      revision: s.revision,
      actor: { tenant: "orange" },
    }),
  ).toEqual({ ok: false, error: "invalid_fields" });
});
test("two teams implement, retest four rounds and preserve legitimate delegated reading", () => {
  let s = start();
  for (let round = 1; round <= 4; round++) {
    s = patch(s);
    if (round === 3) {
      s = move(s, roles(s).attacker, {
        kind: "try",
        documentId: s.documents[2]!.id,
        action: "read",
        requestTenant: "orange",
      });
      expect(s.logs.at(-1)).toMatchObject({
        allowed: true,
        grantValid: true,
        alert: false,
        damage: 0,
      });
      s = move(s, roles(s).attacker, {
        kind: "try",
        documentId: s.documents[2]!.id,
        action: "edit",
        requestTenant: "orange",
      });
      expect(s.logs.at(-1)).toMatchObject({
        allowed: false,
        grantValid: false,
        alert: false,
        damage: 0,
      });
    }
    s = finish(s);
    expect(s.results.at(-1)).toMatchObject({
      round,
      defensePoints: 100,
      attackPoints: 0,
      completed: true,
    });
  }
  expect(s.phase).toBe("finished");
  expect(s.scores).toEqual({ alpha: 200, bravo: 200 });
  expect(JSON.parse(JSON.stringify(s)).results).toEqual(s.results);
});
test("deny-all, client claims, hardcoded tenants, missing roles and inactive-actor exceptions fail meaningful checks", () => {
  for (const code of [
    "false",
    "request.tenant == document.tenant",
    'actor.tenant == "blue"',
    "actor.active && actor.tenant == document.tenant",
    "(actor.active && actor.tenant == document.tenant) || grant.valid",
  ]) {
    const s = patch(start(), code);
    const c = assess(s);
    expect(c.failures.length).toBeGreaterThan(0);
    expect(c.safe === c.safeTotal && c.work === c.workTotal).toBe(false);
  }
  const correct = assess(patch(start()));
  expect(correct).toEqual({
    safe: 48,
    safeTotal: 48,
    work: 16,
    workTotal: 16,
    detect: 128,
    detectTotal: 128,
    failures: [],
  });
  const alerted = assess(patch(start(), repair, "true"));
  expect(alerted.failures).toEqual(["false_alert"]);
  const silent = assess(patch(start(), repair, "false"));
  expect(silent.failures).toEqual(["missed_cross_tenant_success"]);
});
test("public tests support observation and improvement without awarding score", () => {
  const baseline = publicTests("actor.active", "false");
  expect(baseline.map((c) => c.passed)).toEqual([true, false, true, true, true, false, true]);
  expect(publicTests(repair, detector).map((c) => c.passed)).toEqual([
    true,
    true,
    true,
    true,
    true,
    true,
    true,
  ]);
});
test("damage is once per resource/action, no idle score and duplicate retries cannot score twice", () => {
  let s = patch(start(), "actor.active", "false");
  const target = s.documents[1]!.id;
  const op = {
    kind: "try",
    id: "retry",
    revision: s.revision,
    documentId: target,
    action: "read",
    requestTenant: "blue",
  } as const;
  s = applyOp(s, "bravo", op);
  expect(applyOp(JSON.parse(JSON.stringify(s)), "bravo", op)).toEqual(s);
  expect(validateOp(s, "bravo", { ...op, action: "edit" })).toEqual({
    ok: false,
    error: "request_id_reused",
  });
  s = move(s, "bravo", {
    kind: "try",
    documentId: target,
    action: "read",
    requestTenant: "orange",
  });
  expect(s.damage).toBe(25);
  expect(s.documents[1]!.reads).toBe(2);
  s = move(s, "alpha", { kind: "check" });
  s = move(s, "bravo", { kind: "finish" });
  expect(s.results[0]).toMatchObject({ attackPoints: 25, defensePoints: 57 });
  let idle = start();
  for (let i = 1; i <= 12; i++) idle = tick(idle, i * 180_000);
  expect(idle.phase).toBe("finished");
  expect(idle.scores).toEqual({ alpha: 0, bravo: 0 });
});
test("private state, fixtures and secrets are absent from team projections; state stays within declared budget", () => {
  let s = start(
    initialState({
      eventId: "e".repeat(80),
      teamIds: ["a".repeat(80), "b".repeat(80)],
      teamNames: { ["a".repeat(80)]: "界".repeat(80), ["b".repeat(80)]: "語".repeat(80) },
      matchSecret: "c".repeat(64),
    }),
  );
  const code = "false".padEnd(1024, "\u3000");
  function maximumMove(team: string, payload: Record<string, unknown>) {
    s = move(s, team, payload, `max_${s.revision}`.padEnd(64, "x"));
  }
  for (let round = 1; round <= 4; round++) {
    const r = roles(s);
    for (let i = 0; i < 4; i++)
      maximumMove(r.attacker, {
        kind: "try",
        documentId: s.documents[1]!.id,
        action: "read",
        requestTenant: "orange",
      });
    maximumMove(r.attacker, { kind: "finish" });
    for (let i = 0; i < 8; i++)
      maximumMove(r.defender, { kind: "preview", authorize: code, detect: code });
    expect(
      validateOp(s, r.defender, {
        kind: "preview",
        id: `excess_${round}`,
        revision: s.revision,
        authorize: code,
        detect: code,
      }),
    ).toEqual({ ok: false, error: "preview_limit" });
    maximumMove(r.defender, { kind: "patch", authorize: code, detect: code });
    for (let i = 0; i < 4; i++)
      maximumMove(r.attacker, {
        kind: "try",
        documentId: s.documents[1]!.id,
        action: "edit",
        requestTenant: "orange",
      });
    maximumMove(r.defender, { kind: "check" });
    maximumMove(r.attacker, { kind: "finish" });
  }
  expect(s.phase).toBe("finished");
  expect(Object.keys(s.receipts)).toHaveLength(82);
  const bytes = Buffer.byteLength(JSON.stringify(s));
  expect(bytes).toBeLessThanOrEqual(131072);
  const p = projectForTeam(s, s.ids[0]!);
  expect(p.results).toHaveLength(4);
  expect(p.scores[s.ids[0]!]).toBe(112);
  const visible = JSON.stringify(p);
  expect(visible).not.toContain(s.secret);
  expect(visible).not.toContain("case-a");
  expect(Object.keys(p)).not.toContain("receipts");
  expect(start(fresh("b".repeat(64))).documents[0]!.id).not.toBe(start().documents[0]!.id);
});
