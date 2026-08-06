import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { readOverride } from "../overrides.mjs";
import { log } from "../log.mjs";
import { posture } from "../posture.mjs";
import { READY_TOKEN, gateToken } from "../secrets.mjs";

/**
 * The defend scenario: the board grew a drafts feature, the feature hands other
 * people's drafts to anyone who asks, and it has to stop doing that without a
 * single legitimate user losing access — while traffic keeps arriving.
 *
 * Everything this problem adds lives in this module. The shared base gives it
 * routes, gates, gate receipts and checkpoint handlers, and that is all it gets.
 *
 * ## Honest about the model
 *
 * There is no cloud, no WAF, no second host, and no separate attacker machine.
 * What there is:
 *
 *   desk        `/desk` — the drafts feature, four accounts, four tokens
 *   policy      a file in the participant's checkout that decides who may do
 *               what: DATA, not code. It is evaluated by the engine below and
 *               never imported, so nothing a participant writes runs in this
 *               process and nothing they write can reach the measurement.
 *   drill       a traffic generator inside this container that sends real HTTP
 *               to this container's own listener, every round, forever: traffic
 *               that must keep working and traffic that must be refused.
 *   posture     five gates over what the drill actually measured
 *
 * The drill is the reason "block everything" earns nothing. Real defensive work
 * is judged by two numbers at once, and one of them always goes the wrong way
 * when you reach for the blunt fix.
 *
 * ## What is deliberately NOT modelled
 *
 * Blocking by source address. Every probe here arrives on loopback from this
 * same process, so an address-based answer is not expressible and therefore not
 * tested. The knobs that stand in for the blunt real-world answers — turning the
 * feature off, and throttling it — are expressible, and both are measured
 * failing. The READMEs say this plainly rather than pretending otherwise.
 */

const FLAG_SEED = process.env.FLAG_SEED ?? "local-dev-seed";

/** Namespaced under `defend:` so it can never collide with the board's own derivations. */
function defendDigest(namespace) {
  return createHash("sha256").update(`defend:${namespace}:${FLAG_SEED}`).digest("hex");
}

/**
 * The string that must not be readable by the wrong person.
 *
 * It lives in exactly one draft's body and reaches HTTP through exactly one
 * route. Nothing publishes a draft body: publication carries the title and the
 * owner, never the text — so no public surface in this container can ever print
 * it, in the broken state or the fixed one. The problem's suite polls `/`,
 * `/api/board`, `/api/published`, `/api/drill` and `/posture` in both states and
 * asserts exactly that.
 *
 * Seed-derived rather than boot-random on purpose: a participant who restarts
 * the container must not lose a value they were about to submit. It is not the
 * secret half of this checkpoint — the latch below is (see `leakReproduced`).
 */
const LEAK_MARKER = `TC{leak_${defendDigest("leak").slice(0, 32)}}`;

/** Where the participant-owned access policy is mounted into the container. */
const POLICY_PATH = process.env.ACCESS_POLICY ?? "/app/policy/access.json";
/**
 * 参加者向けの文中でこの方針を指す呼び名。 パスを既定にする方向は採らない — マウント元は
 * git 管理下で、 コンテナ内パスは参加者の機械に存在せず、 checkout パスは直接編集に誘導して
 * 解いた瞬間に作業ツリーを汚す。 変更は `PATCH /api/settings` (コンソールは `/docs`) へ誘導する。
 */
const POLICY_HINT =
  process.env.POLICY_HINT ?? "the access policy (change it via PATCH /api/settings)";

/** この scenario の設定の上書き名 (置き場と挙動は `overrides.mjs`)。 */
const SETTINGS_NAME = "policy";

const CHALLENGE_PORT = Number(process.env.CHALLENGE_PORT ?? 8080);

/**
 * Requests the drill makes carry this header, so drill traffic can never stand
 * in for a participant's own reproduction of the leak.
 */
const DRILL_HEADER = "x-defend-drill";

function tuned(name, fallback, low, high) {
  const raw = Number(process.env[name]);
  if (!Number.isFinite(raw)) return fallback;
  return Math.min(high, Math.max(low, Math.trunc(raw)));
}

/**
 * The drill's cadence, its rolling window, and how long a good state has to
 * hold. All three are ordinary environment variables and all three are named in
 * the READMEs: this problem's own test suite turns minutes into seconds with
 * them, and a participant can do the same. What they change is how long you
 * wait, never what is required — the requirement is that no probe fails for the
 * whole hold.
 */
const INTERVAL_MS = tuned("DEFEND_INTERVAL_MS", 1_000, 5, 60_000);
const WINDOW_ROUNDS = tuned("DEFEND_WINDOW_ROUNDS", 20, 3, 500);
const HOLD_MS = tuned("DEFEND_HOLD_MS", 60_000, 50, 3_600_000);

/**
 * How often the drill mints a new draft.
 *
 * This is what makes a burned-in table of concrete ids a losing answer: the id
 * space is open, so any rule keyed on the ids that exist right now goes stale
 * inside one window while the rule that describes the *relationship* keeps
 * working untouched.
 */
const ROTATE_EVERY = Math.max(2, Math.round(WINDOW_ROUNDS / 3));

// ---------------------------------------------------------------------------
// who is on this board
// ---------------------------------------------------------------------------

/** Bearer tokens. Seed-derived, so nothing is committed and no two deploys share one. */
const tokenFor = (actorId) => defendDigest(`actor:${actorId}`).slice(0, 24);

const ACTORS = [
  { id: "u-guest", role: "viewer", label: "調査用の閲覧アカウント" },
  { id: "u-editor", role: "editor", label: "編集担当" },
  { id: "u-cto", role: "exec", label: "CTO" },
  { id: "u-mod", role: "moderator", label: "承認役 (モデレーター)" },
];

/**
 * The three tokens the desk prints.
 *
 * `u-cto`'s is withheld, and that is the whole reason the first checkpoint means
 * something: the only way to read the CTO's draft is as somebody who is not
 * supposed to be able to. The other three are debugging credentials, not
 * secrets — the drill uses them in the open, and a participant who cannot try
 * the moderator path by hand is left guessing at a rule they are graded on.
 */
const PUBLISHED_TOKEN_ACTORS = ["u-guest", "u-editor", "u-mod"];

const actorByToken = new Map(ACTORS.map((actor) => [tokenFor(actor.id), actor]));
const actorById = new Map(ACTORS.map((actor) => [actor.id, actor]));

// ---------------------------------------------------------------------------
// the drafts
// ---------------------------------------------------------------------------

const BOOT_AT = new Date("2026-04-09T08:00:00.000Z").toISOString();

const MARKER_OWNER = "u-cto";
const draftId = (key) => `d-${defendDigest(`draft:${key}`).slice(0, 8)}`;
const MARKER_DRAFT_ID = draftId(MARKER_OWNER);

/**
 * Four drafts to start with, one per account, and one of them carries the
 * marker. `origin` decides what the drill may retire: it mints and retires its
 * own, and never touches a draft the participant wrote.
 */
const drafts = [
  {
    id: draftId("u-guest"),
    ownerId: "u-guest",
    title: "調査メモ: 引き継ぎで分からなかったところ",
    body: "アカウントの権限まわりが引き継ぎ資料に無い。 週明けに確認する。",
    updatedAt: BOOT_AT,
    origin: "seed",
  },
  {
    id: draftId("u-editor"),
    ownerId: "u-editor",
    title: "社内報 4 月号のたたき台",
    body: "新入社員の紹介と、 社内掲示板が開いたお知らせ。 写真は後で差し替え。",
    updatedAt: BOOT_AT,
    origin: "seed",
  },
  {
    id: MARKER_DRAFT_ID,
    ownerId: MARKER_OWNER,
    title: "明日の全社発表 (未公開)",
    body: `まだ社内の誰にも見せていない。 発表資料の管理番号は ${LEAK_MARKER} で、 これが外に出たら発表そのものが飛ぶ。`,
    updatedAt: BOOT_AT,
    origin: "seed",
  },
  {
    id: draftId("u-mod"),
    ownerId: "u-mod",
    title: "承認待ちの棚卸し",
    body: "先月ぶんの承認待ちが 3 件残っている。 順番に片付ける。",
    updatedAt: BOOT_AT,
    origin: "seed",
  },
];

const MAX_DRILL_DRAFTS = 3;
const MAX_PARTICIPANT_DRAFTS = 12;

const draftById = (id) => drafts.find((draft) => draft.id === id) ?? null;

/**
 * The publication queue.
 *
 * Publishing carries `title` and `ownerId` and never `body`, so the marker
 * cannot reach a public surface however the policy is written. It is also this
 * scenario's own list rather than the shared board: the drill publishes several
 * times a minute, and letting that into the board would push the seeded
 * operations memo — the participant's only statement of the rule they are
 * graded on — out of a 200-post ring within the hour.
 */
const published = [];
const MAX_PUBLISHED = 60;
let publicationCounter = 0;

function publish(draft, actor, origin) {
  publicationCounter += 1;
  const entry = {
    publicationId: `p-${publicationCounter}`,
    draftId: draft.id,
    title: draft.title,
    ownerId: draft.ownerId,
    publishedBy: actor.id,
    at: new Date().toISOString(),
    origin,
  };
  published.push(entry);
  // Prune the drill's own entries only. A participant's publication is theirs.
  const mine = published.filter((item) => item.origin === "drill");
  if (mine.length > MAX_PUBLISHED) {
    const doomed = new Set(mine.slice(0, mine.length - MAX_PUBLISHED).map((i) => i.publicationId));
    for (let index = published.length - 1; index >= 0; index -= 1) {
      if (doomed.has(published[index].publicationId)) published.splice(index, 1);
    }
  }
  return entry;
}

// ---------------------------------------------------------------------------
// the rule this board is supposed to follow
// ---------------------------------------------------------------------------

/**
 * Ground truth, owned by the scenario and stated to the participant in the
 * seeded operations memo below.
 *
 * The drill judges every probe against this, so "what should have happened" is
 * never read out of the participant's own file — the file is the thing being
 * graded, and a grader that consults it would grade nothing at all.
 */
function intendedAllow(actor, action, draft) {
  if (action === "read") return actor.id === draft.ownerId || actor.role === "moderator";
  if (action === "publish") return actor.role === "moderator" && actor.id !== draft.ownerId;
  return false;
}

/** The draft ids an actor is supposed to see in a listing. */
const entitledIds = (actor) =>
  drafts.filter((draft) => intendedAllow(actor, "read", draft)).map((draft) => draft.id);

export const seedPosts = [
  {
    author: "cto",
    title: "下書き機能の運用ルール (前任者の置き土産)",
    body: "下書きを読めるのは本人と承認役だけ。 公開できるのは承認役だけで、 承認役でも自分の下書きは公開できない (4-eyes)。 このルールを満たしているかどうかは、 走っているアプリを継続して測って決める。",
    at: "2026-04-09T08:10:00.000Z",
  },
  {
    author: "cto",
    title: "広報から連絡: 外に出ていないはずの話が出ている",
    body: "明日の全社発表の下書きの中身を、 社外の知人が口にしたらしい。 止めるのは簡単だが、 止めたら誰も下書きを書けない。 動かしたまま直してほしい。",
    at: "2026-04-09T08:25:00.000Z",
  },
];

// ---------------------------------------------------------------------------
// the participant-owned access policy — data, evaluated, never imported
// ---------------------------------------------------------------------------

const ACTIONS = ["read", "publish"];
const EFFECTS = ["allow", "deny"];

function badRule(index, detail) {
  return `rules[${index}]: ${detail}`;
}

function checkActorMatcher(index, matcher) {
  if (matcher === "*") return null;
  if (matcher === null || typeof matcher !== "object" || Array.isArray(matcher)) {
    return badRule(index, 'actor must be "*" or an object like {"role":"moderator"}');
  }
  const keys = Object.keys(matcher);
  if (keys.length !== 1 || !["id", "role"].includes(keys[0])) {
    return badRule(index, 'actor object must have exactly one of "id" or "role"');
  }
  if (typeof matcher[keys[0]] !== "string" || matcher[keys[0]] === "") {
    return badRule(index, `actor.${keys[0]} must be a non-empty string`);
  }
  return null;
}

function checkResourceMatcher(index, matcher) {
  if (matcher === "*") return null;
  if (matcher === null || typeof matcher !== "object" || Array.isArray(matcher)) {
    return badRule(index, 'resource must be "*" or an object like {"ownerIs":"actor"}');
  }
  const keys = Object.keys(matcher);
  if (keys.length !== 1 || !["id", "ownerIs", "ownerIsNot"].includes(keys[0])) {
    return badRule(index, 'resource object must have exactly one of "id", "ownerIs", "ownerIsNot"');
  }
  const key = keys[0];
  if (key === "id") {
    if (typeof matcher.id !== "string" || matcher.id === "") {
      return badRule(index, "resource.id must be a non-empty string");
    }
    return null;
  }
  if (matcher[key] !== "actor") return badRule(index, `resource.${key} must be "actor"`);
  return null;
}

/**
 * Validate the policy strictly and report every problem.
 *
 * A malformed policy is NEVER quietly replaced by a working one, in either
 * direction: the drafts routes answer 503 and say why, the desk page says why,
 * `/api/policy` says why, and the log says why once. An app that keeps serving
 * on a policy nobody wrote is the failure this whole problem is about.
 */
function validatePolicy(raw) {
  const errors = [];
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return { errors: ["the policy file must contain a JSON object"], value: null };
  }
  for (const key of Object.keys(raw)) {
    if (!["enabled", "readsPerRound", "rules"].includes(key)) {
      errors.push(`"${key}" is not a setting this app reads`);
    }
  }
  if (typeof raw.enabled !== "boolean") errors.push("enabled must be boolean");
  if (!Number.isInteger(raw.readsPerRound) || raw.readsPerRound < 1) {
    errors.push("readsPerRound must be a positive integer");
  }
  if (!Array.isArray(raw.rules)) {
    errors.push("rules must be an array");
    return { errors, value: null };
  }
  const rules = [];
  raw.rules.forEach((rule, index) => {
    if (rule === null || typeof rule !== "object" || Array.isArray(rule)) {
      errors.push(badRule(index, "must be an object"));
      return;
    }
    for (const key of Object.keys(rule)) {
      if (!["effect", "actions", "actor", "resource"].includes(key)) {
        errors.push(badRule(index, `"${key}" is not a key this app reads`));
      }
    }
    if (!EFFECTS.includes(rule.effect)) errors.push(badRule(index, 'effect must be "allow" or "deny"'));
    if (
      !Array.isArray(rule.actions) ||
      rule.actions.length === 0 ||
      rule.actions.some((action) => !ACTIONS.includes(action))
    ) {
      errors.push(badRule(index, 'actions must be a non-empty subset of ["read","publish"]'));
    }
    const actorProblem = checkActorMatcher(index, rule.actor);
    if (actorProblem !== null) errors.push(actorProblem);
    const resourceProblem = checkResourceMatcher(index, rule.resource);
    if (resourceProblem !== null) errors.push(resourceProblem);
    rules.push(rule);
  });
  if (errors.length > 0) return { errors, value: null };
  return { errors: [], value: { enabled: raw.enabled, readsPerRound: raw.readsPerRound, rules } };
}

let lastPolicyError = null;

/**
 * Read the policy as it is on disk right now, exactly like the board reads its
 * config: a save takes effect on the next request, with no restart.
 */
function loadPolicy(path = POLICY_PATH) {
  let text;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    return reportPolicy(`cannot read ${path}: ${error.code ?? error.message}`);
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return reportPolicy(`${path} is not valid JSON: ${error.message}`);
  }
  // マウント元は出発点。 実行中に変えた分を重ねてから検証する (置き場は overrides.mjs)。
  if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
    parsed = { ...parsed, ...readOverride(SETTINGS_NAME) };
  }
  const { errors, value } = validatePolicy(parsed);
  if (errors.length > 0) return reportPolicy(errors.join("; "));
  if (lastPolicyError !== null) {
    lastPolicyError = null;
    log("info", "access policy reloaded cleanly");
  }
  return { ok: true, value, error: null };
}

/** Log a policy failure once per distinct message, so an editor's autosave cannot flood the ring. */
function reportPolicy(error) {
  if (lastPolicyError !== error) {
    lastPolicyError = error;
    log("error", `access policy error: ${error}`);
  }
  return { ok: false, value: null, error };
}

const actorMatches = (matcher, actor) => {
  if (matcher === "*") return true;
  if (typeof matcher.id === "string") return matcher.id === actor.id;
  return matcher.role === actor.role;
};

const resourceMatches = (matcher, actor, draft) => {
  if (matcher === "*") return true;
  if (typeof matcher.id === "string") return matcher.id === draft.id;
  if (matcher.ownerIs === "actor") return draft.ownerId === actor.id;
  return draft.ownerId !== actor.id;
};

/**
 * Default deny; an explicit `deny` beats any `allow`, whatever the order.
 *
 * The same shape as every real policy language a participant will meet next —
 * IAM, Cedar, a row-level-security predicate. What is *not* here is any way to
 * express "this request came from that address": every probe arrives on
 * loopback from this process, so an address answer would be a lie about what
 * had been tested.
 */
function decide(policy, actor, action, draft) {
  let allowed = false;
  for (const rule of policy.rules) {
    if (!rule.actions.includes(action)) continue;
    if (!actorMatches(rule.actor, actor)) continue;
    if (!resourceMatches(rule.resource, actor, draft)) continue;
    if (rule.effect === "deny") return false;
    allowed = true;
  }
  return allowed;
}

// ---------------------------------------------------------------------------
// the desk's own limits
// ---------------------------------------------------------------------------

/**
 * Reads are counted per account within the current measurement round, so the
 * limit means the same thing whatever cadence the drill is running at.
 *
 * It exists because "throttle it" is one of the two blunt answers this problem
 * has to disqualify, and an answer that cannot be expressed cannot be shown to
 * fail. Turning it down far enough to bite an attacker bites the four accounts
 * doing ordinary work first — they read more.
 */
const readsThisRound = new Map();

function chargeRead(actor, limit) {
  const used = readsThisRound.get(actor.id) ?? 0;
  if (used >= limit) return false;
  readsThisRound.set(actor.id, used + 1);
  return true;
}

// ---------------------------------------------------------------------------
// the exploit latch
// ---------------------------------------------------------------------------

/**
 * Set the first time a request the *intended* rule forbids reads the marker
 * draft and gets it — and only for a request the drill did not make.
 *
 * This is what stops the first checkpoint from being a digest a participant can
 * compute from `FLAG_SEED` without touching the app. The marker is the answer;
 * having actually made the app hand it to the wrong person is the ground truth,
 * and it lives here, outside the submission.
 *
 * Sticky on purpose. It survives the fix, so the participant is never punished
 * for repairing the board before submitting, and it can never be un-set by
 * anything they do afterwards.
 */
let leakReproduced = false;

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

function sendJson(response, status, payload) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload));
}

function sendHtml(response, status, body) {
  response.writeHead(status, { "content-type": "text/html; charset=utf-8" });
  response.end(body);
}

const escapeHtml = (text) =>
  String(text).replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character],
  );

const MAX_BODY_BYTES = 16 * 1024;

function readJson(request) {
  return new Promise((resolve) => {
    const chunks = [];
    let bytes = 0;
    request.on("data", (chunk) => {
      bytes += chunk.length;
      if (bytes > MAX_BODY_BYTES) {
        request.pause();
        resolve({ tooLarge: true });
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      try {
        resolve({ value: JSON.parse(Buffer.concat(chunks).toString("utf8")) });
      } catch {
        resolve({ value: null });
      }
    });
    request.on("error", () => resolve({ value: null }));
  });
}

function bearer(request) {
  const header = request.headers.authorization ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match === null ? null : (actorByToken.get(match[1].trim()) ?? null);
}

const isDrill = (request) => request.headers[DRILL_HEADER] !== undefined;

/**
 * Everything the drafts routes need before they can answer, in one place: who is
 * asking, whether the policy loads, and whether the feature is switched on.
 *
 * The order matters for scoring. A refusal that comes from the policy deciding
 * is a `403`; a refusal that comes from the feature being off or the policy not
 * loading is a `503`, and the drill counts those as broken rather than held. So
 * "turn it off" cannot masquerade as "it is defended".
 */
function gateRequest(request) {
  const actor = bearer(request);
  if (actor === null) return { error: { status: 401, body: { error: "unauthenticated" } } };
  const policy = loadPolicy();
  if (!policy.ok) {
    return { error: { status: 503, body: { error: "policy_unloadable", detail: policy.error } } };
  }
  if (policy.value.enabled !== true) {
    return {
      error: {
        status: 503,
        body: { error: "drafts_disabled", detail: `enabled is false in ${POLICY_HINT}` },
      },
    };
  }
  return { actor, policy: policy.value };
}

// ---------------------------------------------------------------------------
// routes
// ---------------------------------------------------------------------------

function deskPage() {
  const state = drillState();
  const accounts = ACTORS.map((actor) => {
    const token = PUBLISHED_TOKEN_ACTORS.includes(actor.id)
      ? `<code>${escapeHtml(tokenFor(actor.id))}</code>`
      : "<em>この端末には配られていません</em>";
    return `<tr><td><code>${escapeHtml(actor.id)}</code></td><td>${escapeHtml(actor.role)}</td><td>${escapeHtml(actor.label)}</td><td>${token}</td></tr>`;
  }).join("\n");
  const draftRows = drafts
    .map(
      (draft) =>
        `<tr><td><code>${escapeHtml(draft.id)}</code></td><td><code>${escapeHtml(draft.ownerId)}</code></td><td>${escapeHtml(draft.title)}</td></tr>`,
    )
    .join("\n");
  return `<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>下書きデスク</title></head>
<body style="font-family:system-ui;max-width:52rem;margin:2.5rem auto;line-height:1.7;padding:0 1rem">
<h1>下書きデスク</h1>
<p>アクセス方針は板の API コンソール (<a href="docs">docs</a>) から <code>PATCH /api/settings</code> で変えられます。
 変更を捨てて初期状態に戻すのは <code>DELETE /api/settings</code> です。${
    state.policyError === null
      ? " (いまの方針は読み込めています)"
      : ` <strong>いまの方針は読み込めていません: ${escapeHtml(state.policyError)}</strong>`
  }</p>
<h2>アカウント</h2>
<table border="1" cellpadding="6" style="border-collapse:collapse">
<tr><th>id</th><th>role</th><th>役割</th><th>Bearer token</th></tr>
${accounts}
</table>
<h2>いまある下書き</h2>
<table border="1" cellpadding="6" style="border-collapse:collapse">
<tr><th>id</th><th>owner</th><th>title</th></tr>
${draftRows}
</table>
<h2>この問題が足している経路</h2>
<pre>GET  api/drafts              自分に見えてよい下書きの一覧   (Authorization: Bearer ...)
GET  api/draft?id=...        下書き 1 件 (本文つき)
POST api/drafts              下書きを新しく書く              {"title":"...","body":"..."}
POST api/publish?id=...      下書きを公開キューへ載せる
GET  api/published           公開キュー (本文は載りません)
GET  api/policy              いま読み込まれている方針とその検証結果
GET/PATCH/DELETE api/settings  方針を見る・変える・初期状態へ戻す (docs から画面で実行できます)
GET  api/drill               走り続けている計測の内訳
GET  posture                 5 つの gate と受領証</pre>
<p>計測: ${state.roundsCompleted} ラウンド完了 / 直近 ${state.window.rounds} ラウンドを採点 / 連続良好 ${Math.round(state.cleanForMs / 1000)} 秒 (必要 ${Math.round(state.holdMs / 1000)} 秒)</p>
</body></html>`;
}

export const routes = {
  "GET /desk": (request, response) => sendHtml(response, 200, deskPage()),

  "GET /api/policy": (request, response) => {
    const policy = loadPolicy();
    return sendJson(response, 200, {
      changeVia: "PATCH /api/settings (API console: /docs)",
      ok: policy.ok,
      error: policy.error,
      policy: policy.value,
      // The vocabulary, not the answer: which shapes the engine understands.
      grammar: {
        effect: EFFECTS,
        actions: ACTIONS,
        actor: ['"*"', '{"id":"<actor id>"}', '{"role":"<role>"}'],
        resource: ['"*"', '{"id":"<draft id>"}', '{"ownerIs":"actor"}', '{"ownerIsNot":"actor"}'],
        evaluation: "default deny; an explicit deny beats any allow",
      },
    });
  },

  "GET /api/drafts": (request, response) => {
    const gated = gateRequest(request);
    if (gated.error !== undefined) return sendJson(response, gated.error.status, gated.error.body);
    const { actor, policy } = gated;
    if (!chargeRead(actor, policy.readsPerRound)) {
      return sendJson(response, 429, { error: "rate_limited", detail: "readsPerRound exceeded" });
    }
    const visible = drafts
      .filter((draft) => decide(policy, actor, "read", draft))
      .map((draft) => ({
        id: draft.id,
        ownerId: draft.ownerId,
        title: draft.title,
        updatedAt: draft.updatedAt,
      }));
    return sendJson(response, 200, { actor: { id: actor.id, role: actor.role }, drafts: visible });
  },

  "GET /api/draft": (request, response, url) => {
    const gated = gateRequest(request);
    if (gated.error !== undefined) return sendJson(response, gated.error.status, gated.error.body);
    const { actor, policy } = gated;
    if (!chargeRead(actor, policy.readsPerRound)) {
      return sendJson(response, 429, { error: "rate_limited", detail: "readsPerRound exceeded" });
    }
    const draft = draftById(url.searchParams.get("id") ?? "");
    if (draft === null) return sendJson(response, 404, { error: "not_found" });
    if (!decide(policy, actor, "read", draft)) {
      return sendJson(response, 403, { error: "forbidden", action: "read" });
    }
    // The latch: a read the *intended* rule forbids, made by somebody other than
    // the drill, that just handed over the one body that matters.
    if (
      !isDrill(request) &&
      draft.id === MARKER_DRAFT_ID &&
      !intendedAllow(actor, "read", draft) &&
      draft.body.includes(LEAK_MARKER)
    ) {
      if (!leakReproduced) log("warn", `draft ${draft.id} was read by ${actor.id}, who does not own it`);
      leakReproduced = true;
    }
    return sendJson(response, 200, {
      id: draft.id,
      ownerId: draft.ownerId,
      title: draft.title,
      body: draft.body,
      updatedAt: draft.updatedAt,
    });
  },

  "POST /api/drafts": async (request, response) => {
    const gated = gateRequest(request);
    if (gated.error !== undefined) {
      request.resume();
      return sendJson(response, gated.error.status, gated.error.body);
    }
    const { actor } = gated;
    const parsed = await readJson(request);
    if (parsed.tooLarge === true) {
      return sendJson(response, 413, { error: `body must be at most ${MAX_BODY_BYTES} bytes` });
    }
    const raw = parsed.value;
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
      return sendJson(response, 400, { error: "body must be a JSON object" });
    }
    if (typeof raw.title !== "string" || raw.title.trim() === "" || raw.title.length > 200) {
      return sendJson(response, 400, { error: "title is required (at most 200 characters)" });
    }
    if (raw.body !== undefined && (typeof raw.body !== "string" || raw.body.length > 2000)) {
      return sendJson(response, 400, { error: "body must be a string of at most 2000 characters" });
    }
    const mine = drafts.filter((draft) => draft.origin === "participant");
    if (mine.length >= MAX_PARTICIPANT_DRAFTS) {
      return sendJson(response, 409, { error: "too_many_drafts" });
    }
    const draft = {
      id: `d-${randomBytes(4).toString("hex")}`,
      ownerId: actor.id,
      title: raw.title.trim(),
      body: (raw.body ?? "").trim(),
      updatedAt: new Date().toISOString(),
      origin: "participant",
    };
    drafts.push(draft);
    return sendJson(response, 201, { draft: { ...draft } });
  },

  "POST /api/publish": (request, response, url) => {
    request.resume();
    const gated = gateRequest(request);
    if (gated.error !== undefined) return sendJson(response, gated.error.status, gated.error.body);
    const { actor, policy } = gated;
    const draft = draftById(url.searchParams.get("id") ?? "");
    if (draft === null) return sendJson(response, 404, { error: "not_found" });
    if (!decide(policy, actor, "publish", draft)) {
      return sendJson(response, 403, { error: "forbidden", action: "publish" });
    }
    const entry = publish(draft, actor, isDrill(request) ? "drill" : "participant");
    return sendJson(response, 201, { publication: entry });
  },

  "GET /api/published": (request, response) =>
    sendJson(response, 200, { publications: published.map((entry) => ({ ...entry })) }),

  "GET /api/drill": (request, response) => sendJson(response, 200, drillState()),
};

// ---------------------------------------------------------------------------
// the drill
// ---------------------------------------------------------------------------

/**
 * A boot nonce mixed into the probe schedule.
 *
 * Two containers started from the same `FLAG_SEED` do not walk the same order,
 * so a schedule read out of one run is not a schedule for the next.
 */
const SCHEDULE_NONCE = randomBytes(8).toString("hex");

function scheduleByte(round, slot) {
  const hex = createHash("sha256")
    .update(`defend:schedule:${FLAG_SEED}:${SCHEDULE_NONCE}:${round}:${slot}`)
    .digest("hex");
  return Number.parseInt(hex.slice(0, 8), 16);
}

const pick = (list, round, slot) => list[scheduleByte(round, slot) % list.length];

const emptyCounters = () => ({
  normal: {
    readTotal: 0,
    readServed: 0,
    listTotal: 0,
    listExact: 0,
    publishTotal: 0,
    publishServed: 0,
  },
  attack: {
    read: { total: 0, heldByPolicy: 0, leaked: 0, broken: 0 },
    publish: { total: 0, heldByPolicy: 0, leaked: 0, broken: 0 },
  },
  transportErrors: 0,
});

function addCounters(into, from) {
  into.normal.readTotal += from.normal.readTotal;
  into.normal.readServed += from.normal.readServed;
  into.normal.listTotal += from.normal.listTotal;
  into.normal.listExact += from.normal.listExact;
  into.normal.publishTotal += from.normal.publishTotal;
  into.normal.publishServed += from.normal.publishServed;
  for (const kind of ["read", "publish"]) {
    for (const key of ["total", "heldByPolicy", "leaked", "broken"]) {
      into.attack[kind][key] += from.attack[kind][key];
    }
  }
  into.transportErrors += from.transportErrors;
}

/** @type {{ counters: ReturnType<typeof emptyCounters>, bad: boolean }[]} */
const roundHistory = [];
const lifetime = emptyCounters();
let roundsCompleted = 0;
let cleanSince = null;
/** @type {{ at: string, probe: string, why: string }[]} */
let lastFailures = [];

function noteFailure(probe, why) {
  lastFailures.push({ at: new Date().toISOString(), probe, why });
  if (lastFailures.length > 12) lastFailures = lastFailures.slice(-12);
}

async function call(method, path, actor) {
  try {
    const response = await fetch(`http://127.0.0.1:${CHALLENGE_PORT}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${tokenFor(actor.id)}`,
        [DRILL_HEADER]: "1",
      },
    });
    const text = await response.text();
    let body = null;
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
    return { status: response.status, body };
  } catch {
    return null;
  }
}

/**
 * One round of traffic.
 *
 * Every probe is a real HTTP request to this container's own listener, so the
 * thing being measured is the route as it answers, not a data structure this
 * module could have inspected directly and agreed with itself about.
 *
 * The judgement is always against `intendedAllow`, never against the
 * participant's file.
 */
async function runRound(round) {
  const counters = emptyCounters();
  let bad = false;

  const fail = (probe, why) => {
    bad = true;
    noteFailure(probe, why);
  };

  // --- normal: each account lists what it is entitled to see, exactly.
  for (const actor of ACTORS) {
    const wanted = [...entitledIds(actor)].sort();
    const result = await call("GET", "/api/drafts", actor);
    if (result === null) {
      counters.transportErrors += 1;
      continue;
    }
    counters.normal.listTotal += 1;
    if (result.status !== 200 || !Array.isArray(result.body?.drafts)) {
      fail("normal-list", `${actor.id} の一覧が ${result.status} で返らなかった`);
      continue;
    }
    const got = result.body.drafts.map((draft) => draft.id).sort();
    if (got.length === wanted.length && got.every((id, index) => id === wanted[index])) {
      counters.normal.listExact += 1;
    } else if (got.length > wanted.length) {
      fail("normal-list", `${actor.id} の一覧に、 見えてはいけない下書きが ${got.length - wanted.length} 件並んでいる`);
    } else {
      fail("normal-list", `${actor.id} の一覧から、 見えるべき下書きが ${wanted.length - got.length} 件落ちている`);
    }
  }

  // --- normal: two reads that must succeed (an owner, and the moderator).
  const owners = drafts.filter((draft) => actorById.has(draft.ownerId));
  const ownRead = pick(owners, round, "own");
  const modRead = pick(drafts, round, "mod");
  const normalReads = [
    { actor: actorById.get(ownRead.ownerId), draft: ownRead },
    { actor: actorById.get("u-mod"), draft: modRead },
  ];
  for (const probe of normalReads) {
    const result = await call("GET", `/api/draft?id=${probe.draft.id}`, probe.actor);
    if (result === null) {
      counters.transportErrors += 1;
      continue;
    }
    counters.normal.readTotal += 1;
    if (result.status === 200 && result.body?.id === probe.draft.id) counters.normal.readServed += 1;
    else fail("normal-read", `${probe.actor.id} が読んでよい下書きが ${result.status} で止まった`);
  }

  // --- publishing, split by what the rule says rather than by a hand-written
  //     list of who attacks whom. Every (account, draft) pair is sorted into
  //     "must be allowed" and "must be refused" by `intendedAllow`, so the two
  //     halves of the publish rule are both measured and neither can quietly
  //     stop being probed.
  //
  //     The marker draft is excluded from publishing altogether: no publication
  //     carries a body, but keeping the one draft that matters out of the whole
  //     path removes the class rather than relying on the field list.
  const permittedPublishes = [];
  const forbiddenPublishes = [];
  for (const actor of ACTORS) {
    for (const draft of drafts) {
      if (draft.id === MARKER_DRAFT_ID) continue;
      const pair = { actor, draft };
      if (intendedAllow(actor, "publish", draft)) permittedPublishes.push(pair);
      else forbiddenPublishes.push(pair);
    }
  }

  // --- normal: every publish the rule permits, not a sample of them. A rule
  //     that stops one approver on one draft is exactly the failure this gate
  //     exists to see, and a sampled probe would find it one round in six.
  for (const probe of permittedPublishes) {
    const result = await call("POST", `/api/publish?id=${probe.draft.id}`, probe.actor);
    if (result === null) {
      counters.transportErrors += 1;
      continue;
    }
    counters.normal.publishTotal += 1;
    const id = result.body?.publication?.publicationId;
    // Not "it answered 201": the publication has to be in the queue afterwards,
    // so a route that says yes and drops the work on the floor is not credited.
    const landed =
      result.status === 201 &&
      result.body?.publication?.draftId === probe.draft.id &&
      published.some((entry) => entry.publicationId === id);
    if (landed) counters.normal.publishServed += 1;
    else if (result.status === 201) {
      fail("normal-publish", `${probe.actor.id} の公開が受け付けられたのに、 公開キューに載っていない`);
    } else fail("normal-publish", `${probe.actor.id} の公開が ${result.status} で止まった`);
  }

  // --- attack: reads the rule forbids. The marker draft is always one of them.
  const attackReads = [];
  const intruders = ACTORS.filter((actor) => actor.role !== "moderator" && actor.id !== MARKER_OWNER);
  attackReads.push({ actor: pick(intruders, round, "atk0"), draft: draftById(MARKER_DRAFT_ID) });
  for (let slot = 1; slot <= 2; slot += 1) {
    const actor = pick(ACTORS, round, `atkA${slot}`);
    const forbidden = drafts.filter((draft) => !intendedAllow(actor, "read", draft));
    if (forbidden.length > 0) {
      attackReads.push({ actor, draft: pick(forbidden, round, `atkD${slot}`) });
    }
  }
  for (const probe of attackReads) {
    if (probe.draft === null) continue;
    const result = await call("GET", `/api/draft?id=${probe.draft.id}`, probe.actor);
    if (result === null) {
      counters.transportErrors += 1;
      continue;
    }
    counters.attack.read.total += 1;
    if (result.status === 200) {
      counters.attack.read.leaked += 1;
      fail("attack-read", `${probe.actor.id} が、 自分のものではない下書き ${probe.draft.id} を読み出せた`);
    } else if (result.status === 403) {
      counters.attack.read.heldByPolicy += 1;
    } else {
      counters.attack.read.broken += 1;
      fail(
        "attack-read",
        `${probe.actor.id} の読み取りは通らなかったが、 止めたのは方針の判断ではなく ${result.status} だった`,
      );
    }
  }

  // --- attack: publishes the rule forbids.
  //
  //     Every self-publish the rule forbids is probed on every round, not
  //     sampled. There is exactly one account for which "may publish" and "may
  //     publish this one" differ, and a participant who writes only the first
  //     half of the publish rule fails on precisely that pair — a sampled probe
  //     would let them through nine windows out of ten. The cross-owner half is
  //     large and uniform, so one rotating pick is enough.
  const attackPublishes = forbiddenPublishes.filter(
    (pair) => pair.actor.id === pair.draft.ownerId,
  );
  const crossOwner = forbiddenPublishes.filter((pair) => pair.actor.id !== pair.draft.ownerId);
  if (crossOwner.length > 0) attackPublishes.push(pick(crossOwner, round, "apCross"));
  for (const probe of attackPublishes) {
    const result = await call("POST", `/api/publish?id=${probe.draft.id}`, probe.actor);
    if (result === null) {
      counters.transportErrors += 1;
      continue;
    }
    counters.attack.publish.total += 1;
    if (result.status === 201) {
      counters.attack.publish.leaked += 1;
      fail(
        "attack-publish",
        probe.actor.id === probe.draft.ownerId
          ? `${probe.actor.id} が自分の下書きを自分で公開できた`
          : `${probe.actor.id} が、 承認役ではないのに ${probe.draft.ownerId} の下書きを公開できた`,
      );
    } else if (result.status === 403) {
      counters.attack.publish.heldByPolicy += 1;
    } else {
      counters.attack.publish.broken += 1;
      fail(
        "attack-publish",
        `${probe.actor.id} の公開は通らなかったが、 止めたのは方針の判断ではなく ${result.status} だった`,
      );
    }
  }

  return { counters, bad };
}

/** Mint a fresh draft so a rule written against today's ids stops working tomorrow. */
function rotateDrafts(round) {
  const owner = pick(ACTORS, round, "rotate");
  drafts.push({
    id: `d-${randomBytes(4).toString("hex")}`,
    ownerId: owner.id,
    title: `作業メモ #${round}`,
    body: "定例の作業メモ。 中身は当たり障りのないもの。",
    updatedAt: new Date().toISOString(),
    origin: "drill",
  });
  const mine = drafts.filter((draft) => draft.origin === "drill");
  if (mine.length > MAX_DRILL_DRAFTS) {
    const doomed = new Set(mine.slice(0, mine.length - MAX_DRILL_DRAFTS).map((draft) => draft.id));
    for (let index = drafts.length - 1; index >= 0; index -= 1) {
      if (doomed.has(drafts[index].id)) drafts.splice(index, 1);
    }
  }
}

/**
 * Rounds never overlap: the next one is scheduled after the previous finishes,
 * so a slow machine stretches the wall clock rather than interleaving traffic
 * and inventing failures that never happened.
 */
async function tick() {
  try {
    readsThisRound.clear();
    const round = roundsCompleted + 1;
    if (round % ROTATE_EVERY === 0) rotateDrafts(round);
    const { counters, bad } = await runRound(round);
    roundHistory.push({ counters, bad });
    if (roundHistory.length > WINDOW_ROUNDS) roundHistory.splice(0, roundHistory.length - WINDOW_ROUNDS);
    addCounters(lifetime, counters);
    roundsCompleted = round;
    // A probe that got no answer at all is this machine being busy, not the
    // board misbehaving: it is reported on `/api/drill` as `transportErrors` and
    // it neither starts nor breaks the hold. A probe that DID answer, wrongly —
    // including a 503 or a 429 — is a failure and breaks it.
    if (bad) cleanSince = null;
    else if (counters.transportErrors === 0 && cleanSince === null) cleanSince = Date.now();
  } catch (error) {
    // A drill that dies quietly would leave every gate frozen at its last value
    // and the participant with no way to know. Say so, and keep going.
    log("error", `drill round failed: ${error.message}`);
    cleanSince = null;
  }
  setTimeout(tick, INTERVAL_MS).unref?.();
}

setTimeout(tick, Math.min(INTERVAL_MS, 100)).unref?.();

function windowCounters() {
  const total = emptyCounters();
  for (const entry of roundHistory) addCounters(total, entry.counters);
  return total;
}

/**
 * Everything the drill knows, and nothing else.
 *
 * No marker, no receipt, no token, no draft body. `lastFailures[].why` is a
 * symptom — what stopped working, or what got through — never the rule that
 * would fix it.
 */
function drillState() {
  const window = windowCounters();
  const policy = loadPolicy();
  const cleanForMs = cleanSince === null ? 0 : Date.now() - cleanSince;
  return {
    intervalMs: INTERVAL_MS,
    windowRounds: WINDOW_ROUNDS,
    roundsCompleted,
    holdMs: HOLD_MS,
    cleanForMs,
    holdSatisfied: cleanForMs >= HOLD_MS,
    policyError: policy.error,
    window: { rounds: roundHistory.length, ...window },
    lifetime,
    lastFailures,
  };
}

// ---------------------------------------------------------------------------
// posture
// ---------------------------------------------------------------------------

export const gateTokens = true;

export function postureContext() {
  const state = drillState();
  const full = state.window.rounds >= WINDOW_ROUNDS;
  const n = state.window.normal;
  const a = state.window.attack;
  return {
    defend: {
      policyLoaded: state.policyError === null,
      /**
       * The positive half, and the precondition every other scored fact hangs
       * off: four accounts see exactly what they are entitled to, every read
       * they are entitled to succeeds, and the moderator's publishes land.
       *
       * False in the untouched starter — the wildcard rule puts everybody's
       * drafts in everybody's listing — and false again for every blunt answer,
       * because all of them stop somebody who was working.
       */
      serviceIntact:
        full &&
        n.listTotal > 0 &&
        n.listExact === n.listTotal &&
        n.readTotal > 0 &&
        n.readServed === n.readTotal &&
        n.publishTotal > 0 &&
        n.publishServed === n.publishTotal,
      readsHeld:
        full && a.read.total > 0 && a.read.leaked === 0 && a.read.heldByPolicy === a.read.total,
      publishesHeld:
        full &&
        a.publish.total > 0 &&
        a.publish.leaked === 0 &&
        a.publish.heldByPolicy === a.publish.total,
      heldForLong: state.holdSatisfied,
    },
  };
}

export const gates = {
  /** The participant's policy file loads and every rule in it is well formed. */
  policy_loaded: (context) => context.defend.policyLoaded === true,
  /** Nobody legitimate has been stopped, and nobody sees more than they should. */
  service_intact: (context) => context.defend.serviceIntact === true,
  /** ...and every read the rule forbids was refused *by the rule*, not by an outage. */
  reads_held: (context) => context.defend.readsHeld === true,
  /** ...and the same for publishing, including the moderator's own drafts. */
  publishes_held: (context) => context.defend.publishesHeld === true,
  /** ...and it has been that way, without a single bad round, for the whole hold. */
  held_under_load: (context) => context.defend.heldForLong === true,
};

// ---------------------------------------------------------------------------
// checkpoints
// ---------------------------------------------------------------------------

const matches = (submission, expected) => submission.trim() === expected;

/** Re-measure everything at verdict time, rather than trusting a value seen earlier. */
function measure() {
  return posture({ gates, gateTokens: true }, postureContext());
}

/**
 * A receipt checkpoint.
 *
 * Two things are required and neither is the submission: the gate this receipt
 * belongs to must be true *now*, and `service_intact` must be true *now*. The
 * second is what stops an absence from being graded on its own — "nothing got
 * through" is worth nothing until the app is demonstrably still doing its job,
 * which is exactly the failure mode "block everything" produces.
 */
function receiptCheck(gate) {
  return (submission) => {
    const state = measure();
    if (state.gates.service_intact !== true) return false;
    if (state.gates[gate] !== true) return false;
    return matches(submission, gateToken(gate));
  };
}

export const checks = {
  /**
   * The marker, and proof it was obtained the only way it can honestly be
   * obtained.
   *
   * The string alone is not enough: it is derived from `FLAG_SEED`, which a
   * participant can read out of their own container, so a submission with no
   * measured state behind it would be a digest exercise. The latch requires that
   * a request this container served — not one the drill made — read the marker
   * draft as somebody the rule does not allow to read it, and got it.
   *
   * Reading it as the moderator is allowed by the rule, so it does not count.
   * That is the case the suite pins.
   */
  "read-the-leak": (submission) => leakReproduced && matches(submission, LEAK_MARKER),

  /** Nothing the rule forbids is being read — while everyone entitled still reads. */
  "stop-the-leak": receiptCheck("reads_held"),

  /**
   * The service half on its own. Its receipt appears only while all four
   * accounts see exactly their entitled set, every entitled read succeeds, and
   * the moderator's publishes land — so an over-permissive board fails it just
   * as hard as a shut one.
   */
  "keep-serving": receiptCheck("service_intact"),

  /** ...and the publish path is closed too, including for the moderator's own drafts. */
  "close-the-write-path": receiptCheck("publishes_held"),

  /**
   * The sign-off. `/posture` withholds `readyToken` until all five gates are
   * green, and this re-derives the whole conjunction at verdict time — including
   * the hold, which resets the moment any probe goes the wrong way. A token seen
   * once and then broken is not a sign-off.
   */
  signoff: (submission) => {
    const state = measure();
    return state.ready === true && matches(submission, READY_TOKEN);
  },
};


/**
 * 実行中に変えられる設定。 これを宣言すると `/api/settings` と Swagger の項目が生える。
 *
 * ファイルの場所を参加者に案内する方向は採らない — マウント元は git 管理下なので、
 * 直接編集させると解いた瞬間にリポジトリが汚れ、 作り直しても壊れた状態に戻らなくなる。
 */
export const editableSettings = {
  name: SETTINGS_NAME,
  summary: { ja: "アクセスポリシー", en: "access policy" },
  // Swagger の Try it out にそのまま入る例。 この policy が実際に受け付けるキーを使い、
  // 解答 (rules の絞り込み) はここに書かない — 例が答えになる例は例ではない。
  example: { readsPerRound: 100 },
  read: () => loadPolicy(),
};
