import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { log } from "../log.mjs";
import { readOverride } from "../overrides.mjs";
import { posture } from "../posture.mjs";
import { READY_TOKEN, gateToken } from "../secrets.mjs";

/**
 * The safe-exposure scenario: the same board, now being handed to a customer,
 * with an access document nobody ever wrote.
 *
 * Everything this problem adds lives in this module. The shared base gives it
 * routes, gates, gate receipts, `postureContext` and checkpoint handlers, and
 * that is all it gets — an authorization engine that only one problem uses does
 * not belong in a board eight problems share.
 *
 * What is modelled, and what is not:
 *
 *   accounts   four `Authorization: Bearer sk_...` keys, derived from FLAG_SEED.
 *              A bearer key is not Cognito and not an ALB authenticator; what is
 *              the same is the property being graded — a request with no valid
 *              principal never reaches an admin object.
 *   drafts     four seeded documents, each carrying an owner, a tenant and a
 *              visibility, so a decision can depend on the *object* and not only
 *              on the caller.
 *   access     one JSON document in the participant's checkout, re-read on every
 *              request. Ordered rules, an effect, a path and a set of
 *              requirements — deliberately IAM-shaped, deliberately small.
 *   /portal    the surface the document governs. The board's own routes are NOT
 *              governed: this module cannot redeclare them, and the READMEs say
 *              so rather than implying a policy reaches further than it does.
 *
 * Two rules hold everywhere below:
 *
 *   - Gate evaluation is SYNCHRONOUS from end to end. It creates and removes a
 *     probe draft, and JavaScript being single-threaded is what guarantees no
 *     other request can ever observe that intermediate state. Nothing the
 *     participant owns is written or deleted by it.
 *   - The gates and the checkpoints measure through ONE implementation,
 *     `handle()`. A gate calls it in-process; the board's dispatcher calls it
 *     over the socket. There is no second, synthesized decision path that could
 *     drift away from what a real request gets.
 */

const FLAG_SEED = process.env.FLAG_SEED ?? "local-dev-seed";

/** Namespaced under `expose:` so nothing here can collide with `secrets.mjs`. */
function exposeDigest(namespace) {
  return createHash("sha256").update(`expose:${namespace}:${FLAG_SEED}`).digest("hex");
}

// ---------------------------------------------------------------------------
// identities
// ---------------------------------------------------------------------------

/**
 * The cast. Two colleagues in the same tenant, the customer the CTO just
 * onboarded in another one, and one admin.
 *
 * More than one member on purpose: a policy pinned to a single known-good
 * subject is a real thing people write, and it has to be demonstrably wrong
 * rather than hypothetically wrong.
 */
export const accounts = [
  { subject: "sre-anzu", tenant: "tenka", role: "member" },
  { subject: "pm-kenji", tenant: "tenka", role: "member" },
  { subject: "mika-hoshino", tenant: "hoshino", role: "member" },
  { subject: "cto-daichi", tenant: "tenka", role: "admin" },
];

const apiKey = (subject) => `sk_${exposeDigest(`key:${subject}`).slice(0, 20)}`;

/**
 * Syntactically a key, resolves to nobody. Used by the probes that have to tell
 * "presented no credential" apart from "presented one this app does not know",
 * which are the same 401 to a client and two different facts to an operator.
 */
const UNKNOWN_KEY = `sk_${"0".repeat(20)}`;

const byKey = new Map(accounts.map((account) => [apiKey(account.subject), account]));

/** `Authorization: Bearer sk_...` → an account, or null. Never throws. */
function resolvePrincipal(authorization) {
  if (typeof authorization !== "string") return null;
  const match = /^Bearer\s+(\S+)$/i.exec(authorization.trim());
  if (match === null) return null;
  return byKey.get(match[1]) ?? null;
}

// ---------------------------------------------------------------------------
// the documents
// ---------------------------------------------------------------------------

/** Seed-derived, so no id in this repository is ever the right one. */
const draftId = (slug) => `d-${exposeDigest(`draft:${slug}`).slice(0, 10)}`;

/** The marker inside the customer's private document, and nowhere else. */
const EXPOSED_MARK = `TC{exposed_${exposeDigest("exposed").slice(0, 16)}}`;

/** The marker inside the predecessor's handover note, served on the admin surface only. */
const HANDOVER_MARK = `TC{handover_${exposeDigest("handover").slice(0, 16)}}`;

const SEED_SLUGS = ["anzu-private", "kenji-private", "team-runbook", "hoshino-contract"];

/** Slug → id, so `/portal/review` can name an object without printing its id. */
const ID = Object.fromEntries(SEED_SLUGS.map((slug) => [slug, draftId(slug)]));

/**
 * The four documents the review is about.
 *
 * The set is chosen so that three plausible near-misses each fail on a
 * different one of them:
 *
 *   kenji-private     same tenant, private  → defeats "scope it to the tenant"
 *   team-runbook      another owner, shared → defeats "lock it to the owner"
 *   hoshino-contract  another tenant        → carries the marker
 *   anzu-private      the caller's own      → the baseline that must keep working
 */
function seedDrafts() {
  return [
    {
      id: ID["anzu-private"],
      owner: "sre-anzu",
      tenant: "tenka",
      visibility: "private",
      title: "移行の段取り (自分用メモ)",
      body: "来週の切り替え手順。まだ人に見せる段階ではない。",
      updatedAt: "2026-04-08T09:10:00.000Z",
    },
    {
      id: ID["kenji-private"],
      owner: "pm-kenji",
      tenant: "tenka",
      visibility: "private",
      title: "見積り改定 v3 (社外秘)",
      body: "値引き幅の上限と、こちらの原価。社内でも共有前。",
      updatedAt: "2026-04-08T09:25:00.000Z",
    },
    {
      id: ID["team-runbook"],
      owner: "pm-kenji",
      tenant: "tenka",
      visibility: "team",
      title: "運用手順: 障害時の連絡経路",
      body: "一次受けと連絡順。チームの誰でも読めるようにしてある。",
      updatedAt: "2026-04-08T09:40:00.000Z",
    },
    {
      id: ID["hoshino-contract"],
      owner: "mika-hoshino",
      tenant: "hoshino",
      visibility: "private",
      title: "星野デザイン: 契約更新の下書き",
      body: `先方社内でまだ詰めている条件です。管理番号 ${EXPOSED_MARK} で追跡しています。`,
      updatedAt: "2026-04-08T10:05:00.000Z",
    },
  ];
}

/** @type {ReturnType<typeof seedDrafts>} */
const drafts = seedDrafts();

const allDrafts = () => drafts.map((draft) => ({ ...draft }));
const findDraft = (id) => drafts.find((draft) => draft.id === id) ?? null;

let draftCounter = 0;

function insertDraft({ owner, tenant, visibility, title, body }) {
  draftCounter += 1;
  const draft = {
    id: `d-${exposeDigest(`created:${draftCounter}:${Date.now()}`).slice(0, 10)}`,
    owner,
    tenant,
    visibility,
    title,
    body,
    updatedAt: new Date().toISOString(),
  };
  drafts.push(draft);
  return { ...draft };
}

function removeDraft(id) {
  const index = drafts.findIndex((draft) => draft.id === id);
  if (index === -1) return null;
  const [removed] = drafts.splice(index, 1);
  return removed;
}

const HANDOVER_NOTE = [
  "引き継ぎ (SRE 前任者)",
  "",
  "公開範囲は access.json 1 枚で決まります。いまは何も書いていません。あとで締めます。",
  `この控えの管理番号: ${HANDOVER_MARK}`,
].join("\n");

// ---------------------------------------------------------------------------
// the access document
// ---------------------------------------------------------------------------

const POLICY_PATH = process.env.ACCESS_POLICY ?? "/app/access/access.json";

/**
 * 参加者向けの文中でこの document を指す呼び名。 パスを既定にする方向は採らない — マウント元は
 * git 管理下で、 コンテナ内パスは参加者の機械に存在せず、 checkout パスは直接編集に誘導して
 * 解いた瞬間に作業ツリーを汚す。 変更は `PATCH /api/settings` (コンソールは `/docs`) へ誘導する。
 */
const ACCESS_HINT =
  process.env.ACCESS_HINT ?? "the access document (change it via PATCH /api/settings)";

/** この scenario の設定の上書き名 (置き場と挙動は `overrides.mjs`)。 */
const SETTINGS_NAME = "access";

const EFFECTS = new Set(["allow", "deny"]);
const RULE_KEYS = new Set(["id", "effect", "methods", "path", "require"]);

/** The requirement vocabulary, in the order the console prints it. */
const REQUIREMENTS = [
  ["anonymous", "the caller presented no key this app recognises"],
  ["authenticated", "the caller presented a key this app recognises"],
  ["role:<role>", "that key's role — `member` or `admin`"],
  ["subject:<id>", "that key belongs to exactly this one person"],
  ["owner", "the object's `owner` is the caller"],
  ["tenant", "the object's `tenant` is the caller's tenant"],
  ["shared", "the object's `visibility` is `team`"],
];

/**
 * Refused by name rather than silently ignored.
 *
 * Every request reaches this app through a published port, so the address it
 * sees belongs to the proxy in front of it and not to the caller. A source
 * address condition here would decide nothing and would look like it decided
 * something, which is worse than not having one — so the document refuses it and
 * says why, and the refusal is an outage the panel reports.
 */
const REFUSED_REQUIREMENTS = [
  [
    /^client-ip:/,
    "source-address conditions are not available here: every request arrives through a published port, so the address this app sees is the proxy's and not the caller's",
  ],
  [
    /^ip:/,
    "source-address conditions are not available here: every request arrives through a published port, so the address this app sees is the proxy's and not the caller's",
  ],
];

function requirementProblem(requirement) {
  if (typeof requirement !== "string" || requirement.trim() === "") {
    return "a requirement must be a non-empty string";
  }
  for (const [pattern, why] of REFUSED_REQUIREMENTS) {
    if (pattern.test(requirement)) return `"${requirement}" is not a requirement this policy has — ${why}`;
  }
  if (requirement === "anonymous") return null;
  if (requirement === "authenticated") return null;
  if (requirement === "owner") return null;
  if (requirement === "tenant") return null;
  if (requirement === "shared") return null;
  if (/^role:(member|admin)$/.test(requirement)) return null;
  if (/^subject:[a-z0-9-]+$/.test(requirement)) return null;
  const known = REQUIREMENTS.map(([name]) => name).join(", ");
  return `unknown requirement "${requirement}" — this policy knows: ${known}`;
}

/**
 * Parse and check the document. Nothing is adopted partially: a document with a
 * problem in it does not load at all, because half a policy is the failure mode
 * where a rule silently stops applying.
 *
 * @returns {{ ok: boolean, policy: object|null, problems: string[] }}
 */
export function validatePolicy(raw) {
  const problems = [];
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, policy: null, problems: ["the access document must be a JSON object"] };
  }
  for (const key of Object.keys(raw)) {
    if (key !== "defaultEffect" && key !== "rules") {
      problems.push(`"${key}" is not a field this access document has (defaultEffect, rules)`);
    }
  }
  if (!EFFECTS.has(raw.defaultEffect)) {
    problems.push(`defaultEffect must be "allow" or "deny", got ${JSON.stringify(raw.defaultEffect)}`);
  }
  if (!Array.isArray(raw.rules)) {
    problems.push("rules must be an array");
    return { ok: false, policy: null, problems };
  }
  const rules = [];
  raw.rules.forEach((rule, index) => {
    const where = `rules[${index}]`;
    if (rule === null || typeof rule !== "object" || Array.isArray(rule)) {
      problems.push(`${where} must be an object`);
      return;
    }
    for (const key of Object.keys(rule)) {
      if (!RULE_KEYS.has(key)) problems.push(`${where}.${key} is not a field a rule has (id, effect, methods, path, require)`);
    }
    if (!EFFECTS.has(rule.effect)) {
      problems.push(`${where}.effect must be "allow" or "deny", got ${JSON.stringify(rule.effect)}`);
    }
    if (!Array.isArray(rule.methods) || rule.methods.length === 0 || rule.methods.some((m) => typeof m !== "string")) {
      problems.push(`${where}.methods must be a non-empty array of strings, e.g. ["GET"] or ["*"]`);
    }
    if (typeof rule.path !== "string" || rule.path.trim() === "") {
      problems.push(`${where}.path must be a non-empty string`);
    } else if (rule.path.includes("*") && !(rule.path === "*" || rule.path.endsWith("/*"))) {
      problems.push(`${where}.path may use "*" only as the whole path or as a trailing "/*"`);
    }
    const require = rule.require ?? [];
    if (!Array.isArray(require)) {
      problems.push(`${where}.require must be an array (an empty one means "no requirement")`);
    } else {
      for (const requirement of require) {
        const problem = requirementProblem(requirement);
        if (problem !== null) problems.push(`${where}.require: ${problem}`);
      }
    }
    if (rule.id !== undefined && typeof rule.id !== "string") problems.push(`${where}.id must be a string`);
    rules.push({
      id: typeof rule.id === "string" && rule.id !== "" ? rule.id : where,
      effect: rule.effect,
      methods: Array.isArray(rule.methods) ? rule.methods : [],
      path: typeof rule.path === "string" ? rule.path : "",
      require: Array.isArray(require) ? require : [],
    });
  });
  if (problems.length > 0) return { ok: false, policy: null, problems };
  return { ok: true, policy: { defaultEffect: raw.defaultEffect, rules }, problems: [] };
}

let lastPolicyError = null;

/** Read the access document as it is on disk right now. Never cached. */
export function readPolicy(path = POLICY_PATH) {
  let text;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    return reportPolicy([`cannot read ${ACCESS_HINT}: ${error.code ?? error.message}`]);
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return reportPolicy([`${ACCESS_HINT} is not valid JSON: ${error.message}`]);
  }
  // マウント元は出発点。 実行中に変えた分を重ねてから検証する (置き場は overrides.mjs)。
  if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
    parsed = { ...parsed, ...readOverride(SETTINGS_NAME) };
  }
  const checked = validatePolicy(parsed);
  if (!checked.ok) return reportPolicy(checked.problems);
  if (lastPolicyError !== null) {
    lastPolicyError = null;
    log("info", "access policy reloaded cleanly");
  }
  return { ok: true, policy: checked.policy, problems: [] };
}

/** Log a policy failure once per distinct message, so a reload loop cannot flood the ring. */
function reportPolicy(problems) {
  const summary = problems.join("; ");
  if (lastPolicyError !== summary) {
    lastPolicyError = summary;
    log("error", `access policy error: ${summary}`);
  }
  return { ok: false, policy: null, problems };
}

// ---------------------------------------------------------------------------
// the decision
// ---------------------------------------------------------------------------

/**
 * `X/*` matches paths strictly longer than `X/`, and never `X` itself. Written
 * down here and printed on the console, because "does /portal/admin/* cover
 * /portal/admin" is the kind of unstated semantic that decides whether most
 * participants succeed.
 */
function pathMatches(pattern, path) {
  if (pattern === "*") return true;
  if (pattern.endsWith("/*")) {
    const prefix = pattern.slice(0, -1);
    return path.startsWith(prefix) && path.length > prefix.length;
  }
  return pattern === path;
}

const methodMatches = (rule, method) => rule.methods.includes("*") || rule.methods.includes(method);

/**
 * With no object, `owner` / `tenant` / `shared` are FALSE — a decision that
 * needs an attribute of a thing that is not there fails closed rather than
 * quietly succeeding.
 */
function satisfies(requirement, principal, object) {
  if (requirement === "anonymous") return principal === null;
  if (requirement === "authenticated") return principal !== null;
  if (requirement === "owner") return object !== null && principal !== null && object.owner === principal.subject;
  if (requirement === "tenant") return object !== null && principal !== null && object.tenant === principal.tenant;
  if (requirement === "shared") return object !== null && object.visibility === "team";
  if (requirement.startsWith("role:")) return principal !== null && principal.role === requirement.slice(5);
  if (requirement.startsWith("subject:")) return principal !== null && principal.subject === requirement.slice(8);
  return false;
}

/**
 * First rule whose method, path and every requirement hold decides. A rule that
 * matches the path but whose requirements do not hold is not a match, so
 * evaluation continues — which is what lets two rules on the same path express
 * "owner, or shared with the tenant".
 */
export function decide(policy, { method, path, principal, object }) {
  for (const rule of policy.rules) {
    if (!methodMatches(rule, method)) continue;
    if (!pathMatches(rule.path, path)) continue;
    if (!rule.require.every((requirement) => satisfies(requirement, principal, object))) continue;
    return { effect: rule.effect, ruleId: rule.id };
  }
  return { effect: policy.defaultEffect, ruleId: "default" };
}

// ---------------------------------------------------------------------------
// the audit ring
// ---------------------------------------------------------------------------

const RING_MAX = 400;
const ring = [];
let ringSeq = 1;

function recordDecision(entry) {
  ring.push({ seq: ringSeq++, at: new Date().toISOString(), ...entry });
  if (ring.length > RING_MAX) ring.splice(0, ring.length - RING_MAX);
}

// ---------------------------------------------------------------------------
// the one implementation
// ---------------------------------------------------------------------------

/**
 * Which routes the access document governs, and what object each one decides
 * about. `/portal` and `/portal/review` are deliberately absent: the instrument
 * panel is never governed, so a policy can never lock a participant out of the
 * thing that would tell them why.
 */
const GOVERNED = {
  "GET /portal/healthz": "none",
  "GET /portal/me": "none",
  "GET /portal/drafts": "none",
  "POST /portal/drafts": "prospective",
  "GET /portal/draft": "byId",
  "DELETE /portal/draft": "byId",
  "GET /portal/admin/handover": "none",
  "GET /portal/admin/audit": "none",
  "GET /portal/admin/drafts": "none",
  "DELETE /portal/admin/draft": "byId",
};

const MAX_TITLE = 200;
const MAX_BODY = 2000;

/**
 * One request, from the socket or from a gate, answered by the same code.
 *
 * Order, written once so it cannot be two things in two places:
 *   resolve the principal → load the object (may be null) → decide →
 *   deny ⇒ 401/403 → allow and the object is missing ⇒ 404 → do the work.
 *
 * Deciding before answering 404 is what keeps a denied caller from using the
 * response to enumerate ids: for them a document that does not exist and one
 * they may not read are the same answer.
 */
export function handle({ method, path, id = null, authorization, body = null, policy, record = true }) {
  const route = `${method} ${path}`;
  const objectKind = Object.hasOwn(GOVERNED, route) ? GOVERNED[route] : undefined;
  if (objectKind === undefined) return { status: 404, body: { error: "not_found" }, decision: null };

  const principal = resolvePrincipal(authorization);
  const presented = typeof authorization === "string" && authorization.trim() !== "";
  const loaded = policy ?? readPolicy();
  if (!loaded.ok) {
    const answer = {
      status: 503,
      body: { error: "policy_error", detail: loaded.problems, changeVia: "PATCH /api/settings (API console: /docs)" },
      decision: { effect: "deny", ruleId: "policy-error" },
    };
    if (record) {
      recordDecision({
        subject: principal?.subject ?? null,
        method,
        path,
        effect: "deny",
        ruleId: "policy-error",
        status: 503,
      });
    }
    return answer;
  }

  let object = null;
  if (objectKind === "byId") object = findDraft(id);
  if (objectKind === "prospective") {
    object =
      principal === null
        ? null
        : {
            owner: principal.subject,
            tenant: principal.tenant,
            visibility: body !== null && body.visibility === "team" ? "team" : "private",
          };
  }

  const decision = decide(loaded.policy, { method, path, principal, object });
  const answer = { decision };
  if (decision.effect !== "allow") {
    answer.status = principal === null ? 401 : 403;
    answer.body = {
      error: principal === null ? "unauthenticated" : "forbidden",
      decidedBy: decision.ruleId,
      ...(principal === null && presented ? { detail: "the key presented is not one this app knows" } : {}),
    };
  } else if (objectKind === "byId" && object === null) {
    answer.status = 404;
    answer.body = { error: "not_found" };
  } else {
    Object.assign(answer, work(route, { principal, object, body, policy: loaded.policy }));
  }

  if (record) {
    recordDecision({
      subject: principal?.subject ?? null,
      method,
      path,
      effect: decision.effect,
      ruleId: decision.ruleId,
      status: answer.status,
    });
  }
  return answer;
}

/** What an allowed request actually does. Never reached while a decision is deny. */
function work(route, { principal, object, body, policy }) {
  if (route === "GET /portal/healthz") {
    return { status: 200, body: { ok: true, policy: "loaded" } };
  }
  if (route === "GET /portal/me") {
    return { status: 200, body: { principal: principal === null ? null : { ...principal } } };
  }
  if (route === "GET /portal/drafts") {
    // The collection is filtered by the SAME decision the object route makes, on
    // the same loaded document, so one policy decides both and a list can never
    // disagree with a read.
    const visible = allDrafts().filter(
      (draft) =>
        decide(policy, { method: "GET", path: "/portal/draft", principal, object: draft }).effect === "allow",
    );
    return { status: 200, body: { drafts: visible } };
  }
  if (route === "POST /portal/drafts") {
    if (principal === null) {
      return { status: 422, body: { error: "no_owner", detail: "a draft is created for the key that asked for it" } };
    }
    if (body === null || typeof body !== "object" || Array.isArray(body)) {
      return { status: 400, body: { error: "body must be a JSON object" } };
    }
    if (typeof body.title !== "string" || body.title.trim() === "" || body.title.length > MAX_TITLE) {
      return { status: 400, body: { error: `title is required and must be at most ${MAX_TITLE} characters` } };
    }
    const text = body.body ?? "";
    if (typeof text !== "string" || text.length > MAX_BODY) {
      return { status: 400, body: { error: `body must be a string of at most ${MAX_BODY} characters` } };
    }
    if (body.visibility !== undefined && body.visibility !== "private" && body.visibility !== "team") {
      return { status: 400, body: { error: 'visibility must be "private" or "team"' } };
    }
    // owner and tenant come from the key, never from the request body.
    const draft = insertDraft({
      owner: principal.subject,
      tenant: principal.tenant,
      visibility: body.visibility === "team" ? "team" : "private",
      title: body.title.trim(),
      body: text.trim(),
    });
    return { status: 201, body: { draft } };
  }
  if (route === "GET /portal/draft") return { status: 200, body: { draft: { ...object } } };
  if (route === "DELETE /portal/draft" || route === "DELETE /portal/admin/draft") {
    removeDraft(object.id);
    return { status: 200, body: { removed: object.id } };
  }
  if (route === "GET /portal/admin/handover") return { status: 200, body: { note: HANDOVER_NOTE } };
  if (route === "GET /portal/admin/audit") {
    return { status: 200, body: { decisions: ring.map((entry) => ({ ...entry })), nextSeq: ringSeq } };
  }
  if (route === "GET /portal/admin/drafts") return { status: 200, body: { drafts: allDrafts() } };
  // Unreachable: GOVERNED and this switch are edited together, and the problem's
  // suite asserts every governed route answers. Loud rather than undefined.
  return { status: 500, body: { error: "unrouted", route } };
}

// ---------------------------------------------------------------------------
// probes — the gates and the checkpoints measure through these
// ---------------------------------------------------------------------------

let probeCounter = 0;
const probeNonce = () => `${(probeCounter += 1)}-${exposeDigest(`probe:${probeCounter}`).slice(0, 6)}`;

/**
 * Run one probe in-process and compare it with what was expected.
 *
 * `raw` carries the response body so a later probe in the same group can use an
 * id that did not exist a moment ago; it is stripped before anything is served.
 */
function runProbe(policy, created, { name, method, path, as = null, object = null, id = null, body = null, expect, verify = null }) {
  const key = as === null ? undefined : as === "unknown" ? UNKNOWN_KEY : apiKey(as);
  const answer = handle({
    method,
    path,
    id,
    authorization: key === undefined ? undefined : `Bearer ${key}`,
    body,
    policy,
    record: false,
  });
  if (method === "POST" && answer.status === 201) created.push(answer.body.draft.id);
  let ok = answer.status === expect;
  let got = String(answer.status);
  if (ok && verify !== null) {
    const detail = verify(answer.body);
    if (detail !== null) {
      ok = false;
      got = `${answer.status} (${detail})`;
    }
  }
  return {
    name,
    object,
    expected: String(expect),
    got,
    ok,
    decidedBy: answer.decision?.ruleId ?? "none",
    raw: answer.body,
  };
}

const hasId = (list, id) => Array.isArray(list) && list.some((draft) => draft.id === id);

/** A probe that could not run because the one before it did not. Never a pass. */
const blocked = (name, why) => ({ name, object: null, expected: "a working step before it", got: why, ok: false, decidedBy: "none", raw: null });

function groupServiceIntact(run) {
  const probes = [
    run({
      name: "the monitor reaches the health path with no key at all",
      method: "GET",
      path: "/portal/healthz",
      as: null,
      expect: 200,
    }),
  ];
  for (const account of accounts) {
    probes.push(
      run({
        name: `${account.subject} can find out which identity their key is`,
        method: "GET",
        path: "/portal/me",
        as: account.subject,
        expect: 200,
        verify: (body) => (body.principal?.subject === account.subject ? null : "answered for somebody else"),
      }),
    );
  }
  probes.push(
    run({
      name: "sre-anzu reads the draft sre-anzu wrote",
      method: "GET",
      path: "/portal/draft",
      as: "sre-anzu",
      object: "anzu-private",
      id: ID["anzu-private"],
      expect: 200,
    }),
    run({
      name: "pm-kenji reads the draft pm-kenji wrote",
      method: "GET",
      path: "/portal/draft",
      as: "pm-kenji",
      object: "kenji-private",
      id: ID["kenji-private"],
      expect: 200,
    }),
    run({
      name: "mika-hoshino reads the draft mika-hoshino wrote",
      method: "GET",
      path: "/portal/draft",
      as: "mika-hoshino",
      object: "hoshino-contract",
      id: ID["hoshino-contract"],
      expect: 200,
    }),
    run({
      name: "sre-anzu reads the runbook pm-kenji shared with the team",
      method: "GET",
      path: "/portal/draft",
      as: "sre-anzu",
      object: "team-runbook",
      id: ID["team-runbook"],
      expect: 200,
    }),
  );
  return probes;
}

function groupDraftsUsable(run) {
  const probes = [];
  for (const account of ["sre-anzu", "mika-hoshino"]) {
    const created = run({
      name: `${account} writes a new draft`,
      method: "POST",
      path: "/portal/drafts",
      as: account,
      body: { title: `exposure review probe ${probeNonce()}`, body: "", visibility: "private" },
      expect: 201,
    });
    probes.push(created);
    const fresh = created.ok ? created.raw.draft.id : null;
    if (fresh === null) {
      probes.push(blocked(`${account} reads back the draft they just wrote`, "the write before it did not go through"));
      probes.push(blocked(`${account} removes the draft they just wrote`, "the write before it did not go through"));
      continue;
    }
    probes.push(
      run({
        name: `${account} reads back the draft they just wrote`,
        method: "GET",
        path: "/portal/draft",
        as: account,
        object: "a draft that did not exist a moment ago",
        id: fresh,
        expect: 200,
      }),
      run({
        name: `${account} removes the draft they just wrote`,
        method: "DELETE",
        path: "/portal/draft",
        as: account,
        object: "a draft that did not exist a moment ago",
        id: fresh,
        expect: 200,
      }),
    );
  }
  probes.push(
    run({
      name: "sre-anzu's list still carries their own draft and the team runbook",
      method: "GET",
      path: "/portal/drafts",
      as: "sre-anzu",
      expect: 200,
      verify: (body) =>
        hasId(body.drafts, ID["anzu-private"]) && hasId(body.drafts, ID["team-runbook"])
          ? null
          : "the list is missing something sre-anzu is meant to see",
    }),
    run({
      name: "mika-hoshino's list still carries their own draft",
      method: "GET",
      path: "/portal/drafts",
      as: "mika-hoshino",
      expect: 200,
      verify: (body) => (hasId(body.drafts, ID["hoshino-contract"]) ? null : "the customer cannot see their own work"),
    }),
  );
  return probes;
}

function groupDraftsScoped(run) {
  const probes = [
    run({
      name: "no key at all reads sre-anzu's draft",
      method: "GET",
      path: "/portal/draft",
      as: null,
      object: "anzu-private",
      id: ID["anzu-private"],
      expect: 401,
    }),
    run({
      name: "a key this app does not know reads sre-anzu's draft",
      method: "GET",
      path: "/portal/draft",
      as: "unknown",
      object: "anzu-private",
      id: ID["anzu-private"],
      expect: 401,
    }),
    run({
      name: "sre-anzu reads pm-kenji's private draft (same tenant)",
      method: "GET",
      path: "/portal/draft",
      as: "sre-anzu",
      object: "kenji-private",
      id: ID["kenji-private"],
      expect: 403,
    }),
    run({
      name: "sre-anzu reads the customer's private draft",
      method: "GET",
      path: "/portal/draft",
      as: "sre-anzu",
      object: "hoshino-contract",
      id: ID["hoshino-contract"],
      expect: 403,
    }),
    run({
      name: "mika-hoshino reads sre-anzu's private draft",
      method: "GET",
      path: "/portal/draft",
      as: "mika-hoshino",
      object: "anzu-private",
      id: ID["anzu-private"],
      expect: 403,
    }),
    run({
      name: "mika-hoshino reads the runbook shared inside the other tenant",
      method: "GET",
      path: "/portal/draft",
      as: "mika-hoshino",
      object: "team-runbook",
      id: ID["team-runbook"],
      expect: 403,
    }),
    run({
      name: "sre-anzu's list carries nothing belonging to anybody else",
      method: "GET",
      path: "/portal/drafts",
      as: "sre-anzu",
      expect: 200,
      verify: (body) => {
        const leaked = (body.drafts ?? []).filter(
          (draft) => draft.owner !== "sre-anzu" && !(draft.tenant === "tenka" && draft.visibility === "team"),
        );
        return leaked.length === 0 ? null : `the list carries ${leaked.length} document(s) that are not sre-anzu's to see`;
      },
    }),
    run({
      name: "mika-hoshino's list carries nothing from another tenant",
      method: "GET",
      path: "/portal/drafts",
      as: "mika-hoshino",
      expect: 200,
      verify: (body) => {
        const leaked = (body.drafts ?? []).filter((draft) => draft.tenant !== "hoshino");
        return leaked.length === 0 ? null : `the customer's list carries ${leaked.length} document(s) from another tenant`;
      },
    }),
    run({
      name: "no key at all removes a draft",
      method: "DELETE",
      path: "/portal/draft",
      as: null,
      object: "a document that has never existed",
      id: `d-${probeNonce()}`,
      expect: 401,
    }),
  ];

  // The one destructive negative that has to name a real object. It is created
  // for the probe and owned by pm-kenji, so a policy that wrongly allows the
  // delete destroys the probe's own document and nothing of the participant's.
  const decoy = run({
    name: "pm-kenji writes a draft for the next step to try to remove",
    method: "POST",
    path: "/portal/drafts",
    as: "pm-kenji",
    body: { title: `exposure review probe ${probeNonce()}`, body: "", visibility: "private" },
    expect: 201,
  });
  if (!decoy.ok) {
    probes.push(blocked("sre-anzu removes a draft pm-kenji wrote", "the draft it needed could not be written"));
  } else {
    probes.push(
      run({
        name: "sre-anzu removes a draft pm-kenji wrote",
        method: "DELETE",
        path: "/portal/draft",
        as: "sre-anzu",
        object: "a draft pm-kenji wrote a moment ago",
        id: decoy.raw.draft.id,
        expect: 403,
      }),
    );
  }
  return probes;
}

const ADMIN_READS = ["/portal/admin/handover", "/portal/admin/audit", "/portal/admin/drafts"];

function groupAdminAvailable(run) {
  const probes = [
    run({
      name: "cto-daichi reads the predecessor's handover note",
      method: "GET",
      path: "/portal/admin/handover",
      as: "cto-daichi",
      expect: 200,
      verify: (body) => (typeof body.note === "string" && body.note.includes(HANDOVER_MARK) ? null : "the note came back without its reference"),
    }),
    run({
      name: "cto-daichi reads the record of who reached what",
      method: "GET",
      path: "/portal/admin/audit",
      as: "cto-daichi",
      expect: 200,
      verify: (body) => (Array.isArray(body.decisions) && Number.isInteger(body.nextSeq) ? null : "the record came back in a shape nothing can read"),
    }),
    run({
      name: "cto-daichi can still see every document the business holds",
      method: "GET",
      path: "/portal/admin/drafts",
      as: "cto-daichi",
      expect: 200,
      verify: (body) => {
        const missing = SEED_SLUGS.filter((slug) => !hasId(body.drafts, ID[slug]));
        return missing.length === 0 ? null : `${missing.length} of the business's own documents are gone`;
      },
    }),
  ];
  const disposable = run({
    name: "sre-anzu writes a draft for the admin route to remove",
    method: "POST",
    path: "/portal/drafts",
    as: "sre-anzu",
    body: { title: `exposure review probe ${probeNonce()}`, body: "", visibility: "private" },
    expect: 201,
  });
  if (!disposable.ok) {
    probes.push(blocked("cto-daichi removes a document through the admin route", "the draft it needed could not be written"));
  } else {
    probes.push(
      run({
        name: "cto-daichi removes a document through the admin route",
        method: "DELETE",
        path: "/portal/admin/draft",
        as: "cto-daichi",
        object: "a draft written a moment ago",
        id: disposable.raw.draft.id,
        expect: 200,
      }),
    );
  }
  return probes;
}

function groupAdminSealed(run) {
  const probes = [];
  const callers = [
    [null, 401, "no key at all"],
    ["unknown", 401, "a key this app does not know"],
    ["sre-anzu", 403, "sre-anzu"],
    ["pm-kenji", 403, "pm-kenji"],
    ["mika-hoshino", 403, "mika-hoshino"],
  ];
  for (const path of ADMIN_READS) {
    for (const [as, expect, who] of callers) {
      probes.push(run({ name: `${who} reads ${path}`, method: "GET", path, as, expect }));
    }
  }
  for (const [as, expect, who] of callers) {
    probes.push(
      run({
        name: `${who} removes a document through the admin route`,
        method: "DELETE",
        path: "/portal/admin/draft",
        as,
        object: "a document that has never existed",
        // Never a real id: a policy that wrongly allows this must answer 404 and
        // fail the probe rather than destroy something.
        id: `d-${probeNonce()}`,
        expect,
      }),
    );
  }
  return probes;
}

const GROUPS = {
  service_intact: groupServiceIntact,
  drafts_usable: groupDraftsUsable,
  drafts_scoped: groupDraftsScoped,
  admin_available: groupAdminAvailable,
  admin_sealed: groupAdminSealed,
};

/**
 * Run every probe group against the document as it is on disk right now.
 *
 * Synchronous from top to bottom, on purpose. It writes probe drafts and removes
 * them again, and being synchronous is what makes that invisible: no other
 * request can run between the write and the removal, so nothing a participant
 * sees ever contains one, and nothing they own is touched.
 */
export function evaluateGroups() {
  // Passed on whether or not it loaded. `handle()` answers 503 from a `!ok`
  // result by itself, and its `policy ?? readPolicy()` fallback meant handing it
  // `null` made every probe in every group re-read and re-validate the same
  // broken file — dozens of reads per `/posture`, in precisely the state a
  // participant refreshes hardest. It also gives the whole sweep one snapshot,
  // as the loaded path already had, so a document edited mid-`/posture` cannot
  // be half of one policy and half of another.
  const loaded = readPolicy();
  const created = [];
  const groups = {};
  try {
    for (const [name, build] of Object.entries(GROUPS)) {
      const probes = build((spec) => runProbe(loaded, created, spec));
      groups[name] = { ok: probes.every((probe) => probe.ok), probes };
    }
  } finally {
    // Whatever the policy did to the probes, the store goes back to the way it
    // was. A probe that could not clean itself up would leave a participant
    // debugging documents they never wrote.
    for (const id of created) removeDraft(id);
  }
  return {
    policy: {
      loaded: loaded.ok,
      changeVia: "PATCH /api/settings (API console: /docs)",
      problems: loaded.problems,
      defaultEffect: loaded.ok ? loaded.policy.defaultEffect : null,
      ruleCount: loaded.ok ? loaded.policy.rules.length : 0,
    },
    groups,
  };
}

// ---------------------------------------------------------------------------
// posture
// ---------------------------------------------------------------------------

export const gateTokens = true;

export function postureContext() {
  const evaluated = evaluateGroups();
  return {
    exposure: Object.fromEntries(Object.entries(evaluated.groups).map(([name, group]) => [name, group.ok])),
  };
}

/**
 * Five gates, each the verdict of one probe group, so the panel and the
 * checkpoints cannot say different things about the same policy.
 *
 * Two of them are about closure and three are about the service still working.
 * They are separate gates rather than one because a policy that fails is
 * normally failing exactly one of them, and "something is wrong" is not a
 * next action.
 */
export const gates = {
  /** Monitoring, identity, and everyone reading what is theirs. */
  service_intact: (context) => context.exposure.service_intact === true,
  /** Writing, reading back, removing, and a list that still lists. */
  drafts_usable: (context) => context.exposure.drafts_usable === true,
  /** ...and nothing in it belongs to anybody else. */
  drafts_scoped: (context) => context.exposure.drafts_scoped === true,
  /** The admin surface still answers the admin. */
  admin_available: (context) => context.exposure.admin_available === true,
  /** ...and nobody else. */
  admin_sealed: (context) => context.exposure.admin_sealed === true,
};

const gateState = () => posture({ gates, gateTokens: true }, postureContext());

// ---------------------------------------------------------------------------
// routes
// ---------------------------------------------------------------------------

const escapeHtml = (text) =>
  String(text).replace(
    /[&<>"']/g,
    (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character],
  );

function sendJson(response, status, payload) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload));
}

function sendHtml(response, status, body) {
  response.writeHead(status, { "content-type": "text/html; charset=utf-8" });
  response.end(body);
}

const MAX_REQUEST_BYTES = 64 * 1024;

/** @returns the parsed body, or `null` for malformed JSON or an oversize one. */
function readJsonBody(request) {
  return new Promise((resolve) => {
    const chunks = [];
    let bytes = 0;
    request.on("data", (chunk) => {
      bytes += chunk.length;
      if (bytes > MAX_REQUEST_BYTES) {
        request.pause();
        resolve(null);
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        resolve(null);
      }
    });
    request.on("error", () => resolve(null));
  });
}

/** Wrap one governed route so the socket and the gates share `handle()`. */
function governed(method, path, { withBody = false } = {}) {
  return async (request, response, url) => {
    const body = withBody ? await readJsonBody(request) : null;
    if (!withBody) request.resume();
    const answer = handle({
      method,
      path,
      id: url.searchParams.get("id"),
      authorization: request.headers.authorization,
      body,
    });
    return sendJson(response, answer.status, answer.body);
  };
}

/**
 * Every URL on this page is relative. The console is reached through a forwarded
 * port in Codespaces and through loopback locally, and a hard-coded
 * `http://127.0.0.1:...` would work in exactly one of those.
 */
function consolePage() {
  const evaluated = evaluateGroups();
  const gateRows = Object.entries(evaluated.groups)
    .map(([name, group]) => {
      const failing = group.probes.filter((probe) => !probe.ok);
      const first = failing[0];
      return `<tr><td><code>${escapeHtml(name)}</code></td>
    <td>${group.ok ? "緑" : "赤"}</td>
    <td>${group.probes.length - failing.length} / ${group.probes.length}</td>
    <td>${first === undefined ? "-" : `${escapeHtml(first.name)} → ${escapeHtml(first.got)} (expected ${escapeHtml(first.expected)}, decided by <code>${escapeHtml(first.decidedBy)}</code>)`}</td></tr>`;
    })
    .join("\n");
  const keyRows = accounts
    .map(
      (account) =>
        `<tr><td>${escapeHtml(account.subject)}</td><td>${escapeHtml(account.tenant)}</td><td>${escapeHtml(account.role)}</td><td><code>${escapeHtml(apiKey(account.subject))}</code></td></tr>`,
    )
    .join("\n");
  const requirementRows = REQUIREMENTS.map(
    ([name, meaning]) => `<tr><td><code>${escapeHtml(name)}</code></td><td>${escapeHtml(meaning)}</td></tr>`,
  ).join("\n");
  const problems = evaluated.policy.loaded
    ? ""
    : `<p><strong>この access.json は読み込めていません。</strong> 読み込めない間、 governed なルートは全部 <code>503 policy_error</code> です。</p>
<ul>${evaluated.policy.problems.map((problem) => `<li><code>${escapeHtml(problem)}</code></li>`).join("")}</ul>`;

  return `<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>公開範囲レビュー</title></head>
<body style="font-family:system-ui;max-width:60rem;margin:2.5rem auto;line-height:1.7;padding:0 1rem">
<h1>公開範囲レビュー</h1>
<p>この画面と <a href="portal/review">portal/review</a> は access.json の管轄外です。 締めすぎて自分が締め出されても、 ここだけは必ず開きます。</p>

<h2>いまの状態</h2>
<p>defaultEffect <code>${escapeHtml(String(evaluated.policy.defaultEffect))}</code> /
 rule ${evaluated.policy.ruleCount} 件。
 いまの内容は <code>GET /api/settings</code> が返し、 変更は板の API コンソール (<a href="docs">docs</a>) から
 <code>PATCH /api/settings</code> で送ります (呼ぶたびに読み直します)。
 変更を捨てて初期状態に戻すのは <code>DELETE /api/settings</code> です。</p>
${problems}
<table border="1" cellpadding="6" cellspacing="0"><tr><th>gate</th><th>状態</th><th>通った probe</th><th>最初に落ちている probe</th></tr>
${gateRows}</table>
<p>probe 1 本ずつの内訳は <a href="portal/review">portal/review</a>、 受領証は <a href="posture">posture</a>。</p>

<h2>access.json の書き方</h2>
<p>access.json はこの板が読む文書の名前で、 中身は丸ごと <code>PATCH /api/settings</code> で送って変えます
 (<code>rules</code> は配列ごと)。 リポジトリのファイルを直接編集する経路はありません。</p>
<pre>{
  "defaultEffect": "allow" | "deny",
  "rules": [
    {
      "id":      "人が読むための名前 (任意)",
      "effect":  "allow" | "deny",
      "methods": ["GET", "POST", "DELETE"]  /  ["*"],
      "path":    "/portal/draft"  /  "/portal/admin/*",
      "require": []
    }
  ]
}</pre>
<ul>
<li>上から順に見て、 <strong>method と path と require が全部そろった最初の rule</strong> が決めます。 path は合うが require が足りない rule は 「合致しない」 ので、 次の rule に進みます。</li>
<li>どの rule も合致しなければ <code>defaultEffect</code>。</li>
<li><code>path</code> は完全一致。 末尾 <code>/*</code> だけワイルドカードで、 <code>/portal/admin/*</code> は <code>/portal/admin/</code> より長いパスにだけ合致します (<code>/portal/admin</code> 自身には合致しません)。</li>
<li><code>require: []</code> は 「条件なし」。 対象の無いルート (一覧・作成・admin) では <code>owner</code> / <code>tenant</code> / <code>shared</code> は必ず false です。</li>
</ul>
<table border="1" cellpadding="6" cellspacing="0"><tr><th>require</th><th>意味</th></tr>
${requirementRows}</table>

<h2>この板のルート</h2>
<pre>GET    portal                    この画面 (access.json の管轄外)
GET    portal/review             probe 1 本ずつの内訳 (access.json の管轄外)

GET    portal/healthz            死活確認。 監視はここを鍵なしで叩きます
GET    portal/me                 その鍵が誰か
GET    portal/drafts             下書き一覧 (1 件ずつ portal/draft と同じ判定で絞られます)
POST   portal/drafts             下書きを書く  {"title":"...","body":"...","visibility":"private"|"team"}
GET    portal/draft?id=d-...     下書き 1 件
DELETE portal/draft?id=d-...     下書きを消す
GET    portal/admin/handover     前任者の引き継ぎ
GET    portal/admin/audit        この板が下した判定の記録
GET    portal/admin/drafts       全テナントの下書き
DELETE portal/admin/draft?id=    管理者として下書きを消す</pre>
<p>板そのもの (<a href=".">板のトップ</a> · <code>api/board</code> · <code>api/logs</code> · <code>healthz</code> · <code>posture</code> · <code>api/posts</code>) は access.json の管轄外です。 この問題が扱うのは <code>portal</code> 以下だけ。</p>

<h2>ステージング用の鍵</h2>
<p>この画面に鍵が出ているのは、 このコンテナが 1 人用の練習環境で、 ネットワークに他の誰もいないからです。 本番ならこの画面自体が認証の内側にあります。 採点は鍵の秘密性に一切依存しません ── 落とすべき probe はすべて 「正しい鍵を持った誰か」 が叩いています。</p>
<table border="1" cellpadding="6" cellspacing="0"><tr><th>subject</th><th>tenant</th><th>role</th><th>Authorization: Bearer …</th></tr>
${keyRows}</table>
</body></html>`;
}

export const routes = {
  "GET /portal": (request, response) => {
    request.resume();
    return sendHtml(response, 200, consolePage());
  },

  /**
   * The diagnostic surface: every probe, what was expected, what came back, and
   * which rule decided it.
   *
   * It reports state and never the rule to write. Hiding it would turn a policy
   * problem into guesswork, which is the complaint this catalog has already
   * recorded once.
   */
  "GET /portal/review": (request, response) => {
    request.resume();
    const evaluated = evaluateGroups();
    return sendJson(response, 200, {
      policy: evaluated.policy,
      groups: Object.fromEntries(
        Object.entries(evaluated.groups).map(([name, group]) => [
          name,
          {
            ok: group.ok,
            probes: group.probes.map(({ name: probeName, object, expected, got, ok, decidedBy }) => ({
              name: probeName,
              object,
              expected,
              got,
              ok,
              decidedBy,
            })),
          },
        ]),
      ),
    });
  },

  "GET /portal/healthz": governed("GET", "/portal/healthz"),
  "GET /portal/me": governed("GET", "/portal/me"),
  "GET /portal/drafts": governed("GET", "/portal/drafts"),
  "POST /portal/drafts": governed("POST", "/portal/drafts", { withBody: true }),
  "GET /portal/draft": governed("GET", "/portal/draft"),
  "DELETE /portal/draft": governed("DELETE", "/portal/draft"),
  "GET /portal/admin/handover": governed("GET", "/portal/admin/handover"),
  "GET /portal/admin/audit": governed("GET", "/portal/admin/audit"),
  "GET /portal/admin/drafts": governed("GET", "/portal/admin/drafts"),
  "DELETE /portal/admin/draft": governed("DELETE", "/portal/admin/draft"),
};

export const seedPosts = [
  {
    author: "cto",
    title: "掲示板、 星野デザインにも開けます",
    body: "先方にも同じ板を使ってもらいます。 下書き機能ごと。 管理画面と各自の下書きは外に出さないこと。 監視は止めないこと ── 「安全にするために全部閉じました」 は無しです。",
    at: "2026-04-08T08:30:00.000Z",
  },
  {
    author: "sre-predecessor",
    title: "引き継ぎ: 公開範囲は access.json",
    body: "誰が何を読めるかは access.json 1 枚で決まります。 書き換えたら次のリクエストから反映されます。 まだ何も書いていません。 あとで締めます。",
    at: "2026-04-08T08:45:00.000Z",
  },
];

// ---------------------------------------------------------------------------
// checkpoints
// ---------------------------------------------------------------------------

const CHALLENGE_PORT = Number(process.env.CHALLENGE_PORT ?? 8080);

/**
 * How long a probe waits on this app's own listener before giving up.
 *
 * Without a deadline a wedged listener hangs `/verify` for the platform
 * default, and `exposure-signoff` chains three surfaces of these.
 *
 * The floor on the number is self-inflicted: `evaluateGroups()` is synchronous
 * by design, so a `/posture` arriving while a probe is in flight blocks the
 * event loop — and the listener the probe is waiting on is this same process. A
 * deadline shorter than the longest such block would abort a probe that was
 * about to succeed and score a correct answer wrong. A full `/posture` runs in
 * single-digit milliseconds, so five seconds leaves three orders of magnitude
 * of headroom while still being far below the platform default.
 *
 * Not covered by a test: wedging this app's own listener is not reachable from
 * outside the process, so there is no way to make the timeout fire on demand.
 */
const PROBE_TIMEOUT_MS = 5_000;

/**
 * Ask this app over real HTTP, from inside this process.
 *
 * The gates already exercise `handle()`; what they cannot see is whether the
 * routes are mounted and the board's dispatcher reaches them. So every
 * checkpoint sends real requests to the real listener, on the port the app was
 * told to listen on rather than a constant that would be wrong the moment
 * anything ran it elsewhere.
 *
 * Every probe below is a GET. Nothing a checkpoint sends can create or remove
 * anything, so being scored — right answer, wrong answer, or a retry — cannot
 * change a participant's environment.
 */
async function ask(path, as = null) {
  const headers = {};
  const key = as === null ? null : as === "unknown" ? UNKNOWN_KEY : apiKey(as);
  if (key !== null) headers.authorization = `Bearer ${key}`;
  try {
    const response = await fetch(`http://127.0.0.1:${CHALLENGE_PORT}${path}`, {
      headers,
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    const text = await response.text();
    let body = null;
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
    return { status: response.status, body, text };
  } catch {
    return null;
  }
}

/**
 * The admin surface, over the socket: it answers the admin, refuses everyone
 * else, and its record really is this app's record of its own decisions.
 *
 * The last part is why the record is read twice with a refusal in between: an
 * empty array would satisfy "an array came back", and a downstream problem is
 * going to read this ring expecting the app's own history to be in it.
 */
async function adminSurfaceAnswers() {
  const before = await ask("/portal/admin/audit", "cto-daichi");
  if (before === null || before.status !== 200 || !Number.isInteger(before.body?.nextSeq)) return false;
  const since = before.body.nextSeq;

  const refused = await ask("/portal/admin/audit", null);
  if (refused === null || refused.status !== 401) return false;

  const after = await ask("/portal/admin/audit", "cto-daichi");
  if (after === null || after.status !== 200 || !Array.isArray(after.body?.decisions)) return false;
  const recorded = after.body.decisions.some(
    (entry) =>
      entry.seq >= since &&
      entry.method === "GET" &&
      entry.path === "/portal/admin/audit" &&
      entry.subject === null &&
      entry.effect === "deny",
  );
  if (!recorded) return false;

  const note = await ask("/portal/admin/handover", "cto-daichi");
  return note !== null && note.status === 200 && typeof note.body?.note === "string" && note.body.note.includes(HANDOVER_MARK);
}

/** The draft surface, over the socket: usable, and scoped, at the same instant. */
async function draftSurfaceAnswers() {
  const list = await ask("/portal/drafts", "sre-anzu");
  if (list === null || list.status !== 200 || !hasId(list.body?.drafts, ID["anzu-private"])) return false;

  const anonymous = await ask(`/portal/draft?id=${ID["anzu-private"]}`, null);
  if (anonymous === null || anonymous.status !== 401) return false;

  const other = await ask(`/portal/draft?id=${ID["kenji-private"]}`, "sre-anzu");
  if (other === null || other.status !== 403) return false;

  const customer = await ask(`/portal/draft?id=${ID["hoshino-contract"]}`, "sre-anzu");
  if (customer === null || customer.status !== 403 || customer.text.includes(EXPOSED_MARK)) return false;

  const shared = await ask(`/portal/draft?id=${ID["team-runbook"]}`, "sre-anzu");
  if (shared === null || shared.status !== 200) return false;

  const own = await ask(`/portal/draft?id=${ID["hoshino-contract"]}`, "mika-hoshino");
  return own !== null && own.status === 200;
}

/** The monitor's path, over the socket, with no credential at all. */
async function healthAnswers() {
  const health = await ask("/portal/healthz", null);
  return health !== null && health.status === 200 && health.body?.ok === true;
}

const matches = (submission, expected) => submission.trim() === expected;

export const checks = {
  /**
   * What was actually reachable. The value lives in the body of the customer's
   * private draft and in no committed file, so it cannot be produced by a
   * participant who has not read that document through this app — which, in the
   * state it ships in, anybody can, and that reach is the finding.
   *
   * It stays answerable after the fix: `GET /portal/admin/drafts` reaches the
   * same document with the admin key, so closing the door first does not lock
   * the discovery away.
   */
  "exposed-record": (submission) => matches(submission, EXPOSED_MARK),

  /**
   * The admin surface, both halves at once.
   *
   * The closure half alone would be satisfied by a policy that denies the admin
   * routes to everybody — which is why `admin_available` is required first, and
   * why the receipt is compared last. A participant who reads the receipt while
   * only half of it is true is holding a value the handler will not accept.
   */
  "admin-sealed": async (submission) => {
    if (!(await adminSurfaceAnswers())) return false;
    const state = gateState();
    if (state.gates.admin_available !== true) return false;
    if (state.gates.admin_sealed !== true) return false;
    return matches(submission, gateToken("admin_sealed"));
  },

  /**
   * The drafts, both halves at once, for the same reason.
   *
   * `service_intact` is in here as well: locking every draft to its owner closes
   * the leak and breaks the runbook pm-kenji deliberately shared, and security
   * that breaks a documented business requirement is not a pass.
   */
  "drafts-sealed": async (submission) => {
    if (!(await draftSurfaceAnswers())) return false;
    const state = gateState();
    for (const gate of ["service_intact", "drafts_usable", "drafts_scoped"]) {
      if (state.gates[gate] !== true) return false;
    }
    return matches(submission, gateToken("drafts_scoped"));
  },

  /**
   * The sign-off. Every property, measured at the moment it is answered.
   *
   * Deliberately not redundant with the two seals: a participant can earn one
   * with an admin lockdown and the other by loosening it again, at different
   * moments. This one requires all five gates and all three live surfaces to
   * hold at the same instant, so fixing, copying the token and reverting does
   * not pass.
   */
  "exposure-signoff": async (submission) => {
    if (!(await healthAnswers())) return false;
    if (!(await adminSurfaceAnswers())) return false;
    if (!(await draftSurfaceAnswers())) return false;
    const state = gateState();
    return state.ready === true && matches(submission, READY_TOKEN);
  },
};

// ---------------------------------------------------------------------------
// boot
// ---------------------------------------------------------------------------

// Exactly four lines, emitted at import so they land in the log's pinned
// prologue ahead of the board's own four. The prologue holds eight, so nothing
// later — including a config error the participant then fixes — is pinned there
// forever, and the keys survive however much request traffic follows.
log("info", `safe-exposure staging keys: ${accounts.map((a) => `${a.subject}=${apiKey(a.subject)}`).join(" ")}`);
log("info", "safe-exposure access document: change it via PATCH /api/settings (re-read on every request)");
log("info", `safe-exposure governed routes: ${Object.keys(GOVERNED).length} under /portal (the console and /portal/review are not governed)`);
log(
  "info",
  "safe-exposure note: the keys above are printed because this container is a single-player training environment; scoring never depends on them being secret",
);

/**
 * 実行中に変えられる設定。 これを宣言すると `/api/settings` と Swagger の項目が生える。
 *
 * ファイルの場所を参加者に案内する方向は採らない — マウント元は git 管理下なので、
 * 直接編集させると解いた瞬間にリポジトリが汚れ、 作り直しても壊れた状態に戻らなくなる。
 */
export const editableSettings = {
  name: SETTINGS_NAME,
  summary: { ja: "アクセス文書 (access.json)", en: "the access document (access.json)" },
  // Swagger の Try it out にそのまま入る例。 starter が最初から持っている公開 healthz の
  // rule をそのまま送り返す形 — 妥当で、 何も先回りしない。 rules は配列ごと送る。
  example: {
    rules: [
      { id: "monitoring-is-public", effect: "allow", methods: ["GET"], path: "/portal/healthz", require: [] },
    ],
  },
  read: () => {
    const loaded = readPolicy();
    return {
      ok: loaded.ok,
      value: loaded.policy,
      error: loaded.problems.length > 0 ? loaded.problems.join("; ") : null,
    };
  },
};
