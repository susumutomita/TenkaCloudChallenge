import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { allPosts } from "../board.mjs";
import { log } from "../log.mjs";
import { readOverride } from "../overrides.mjs";
import { posture } from "../posture.mjs";
import { READY_TOKEN, gateToken } from "../secrets.mjs";

/**
 * The secrets scenario: an operations credential was published onto the board,
 * and it still opens everything.
 *
 * Everything this problem adds lives in this module. The shared base gives it
 * routes, gates, gate receipts and checkpoint handlers, and that is all it gets:
 * a key store and a policy engine that one problem uses do not belong in a board
 * the whole family shares.
 *
 * The model is small and deliberately honest about being a model. There is no
 * IAM here, no CloudTrail, and no cloud account. What there is:
 *
 *   key store    ops credentials, each with a status. A secret leaves the store
 *                exactly once, in the response that issues it
 *   break-glass  the out-of-band credential that can issue and revoke keys —
 *                written once to startup output and also handed to this
 *                single-user local exercise through a one-time envelope
 *   manifest     a file in the participant's checkout naming which key the
 *                nightly job runs as, and what that key is allowed to do
 *   policy       allow-only, `service:action`, segment-wise `*`
 *   journal      every ops attempt, allowed or refused, by key fingerprint
 *   digest       the nightly job — the one thing that must not stop
 *
 * The lesson that has to survive the model is the one the board makes physical:
 * a credential that was published cannot be unpublished. This board has no
 * delete and is not going to grow one. What *can* change is whether the
 * credential still opens anything, and that lives in the store, not on the page.
 */

const FLAG_SEED = process.env.FLAG_SEED ?? "local-dev-seed";

/**
 * Every unguessable value this scenario hands out, namespaced under `ops:` so it
 * can never collide with the board's own derivations in `secrets.mjs`.
 */
function opsDigest(namespace) {
  return createHash("sha256").update(`ops:${namespace}:${FLAG_SEED}`).digest("hex");
}

/** Ops secrets carry a prefix, so one is recognisable wherever it turns up. */
const SECRET_PREFIX = "SSOPS-";

const secretFor = (keyId) => `${SECRET_PREFIX}${opsDigest(`key:${keyId}`).slice(0, 20)}`;

/**
 * A credential's fingerprint, derived from the secret so it is a property of the
 * credential rather than of its name. Safe to print: it identifies a key without
 * carrying it, which is the whole reason a real store prints one.
 */
const fingerprintOf = (secret) => opsDigest(`fingerprint:${secret}`).slice(0, 12);

/**
 * Returned by `whoami` to whoever can actually present a key's secret, and
 * nowhere else. Identification, not authorization — a revoked credential still
 * says who it is, which is why the leak stays demonstrable after it is closed.
 */
const witnessFor = (keyId) => opsDigest(`whoami:${keyId}`).slice(0, 12);

/** Attached to a key by a revoke that completed, and by nothing else. */
const revocationReceiptFor = (keyId) => opsDigest(`revoked:${keyId}`).slice(0, 12);

/**
 * The out-of-band credential. Startup output remains available to operators.
 * This local, single-user exercise also models a sealed handover envelope: one
 * deliberate POST reveals it once, then answers 410 until the container is
 * rebuilt. Production would put that envelope in a separate vault and approval
 * path; the in-app handover is explicitly only the browser-accessible model.
 */
const BREAK_GLASS = opsDigest("break-glass").slice(0, 16);
let breakGlassRevealed = false;

/** The predecessor's key. Its secret is on the board. */
const LEGACY_KEY_ID = "ops-legacy";

/**
 * The third-party plugin the predecessor installed. Its action name is
 * seed-derived, so the action catalogue itself differs per deploy and a written
 * down list of "the actions to refuse" does not survive to the next one.
 */
const PLUGIN_SLUG = opsDigest("plugin").slice(0, 6);
const PLUGIN_ACTION = `plugin:${PLUGIN_SLUG}`;

/**
 * What the nightly digest job authorizes, in the order it needs them. This array
 * *is* the definition of "what this board needs the ops key for": the gate and
 * the checkpoint grade against the running job rather than against a list
 * somebody wrote down, so the answer stays whatever the job actually asks for.
 */
const DIGEST_ACTIONS = ["board:count", "digest:publish"];

/**
 * Everything else this ops API can do. None of these mutates anything: they
 * read, export, or hand data to somebody else. That is deliberate — scoring
 * sends all four on every attempt, and a probe that had to undo itself would be
 * a probe that could fail to.
 *
 * Each shares a service prefix with an action the job needs, so `board:*`,
 * `digest:*` and a bare `*` cannot be narrow enough by construction.
 */
const SENSITIVE_ACTIONS = ["board:export", "digest:recipients", "keys:reveal", PLUGIN_ACTION];

/** The whole vocabulary, sorted so the catalogue reads the same everywhere. */
const CATALOG = [...DIGEST_ACTIONS, ...SENSITIVE_ACTIONS].sort();

/**
 * What each action does, in the participant's words.
 *
 * Never says which ones this board needs. Publishing that would answer the only
 * question the last checkpoint asks; the running job answers it instead, and
 * answers it out loud, by naming the action it was refused.
 */
const EFFECTS = {
  "board:count": "板にいま出ている投稿の数を数える",
  "digest:publish": "夜間ダイジェストを 1 本発行する",
  "board:export": "全投稿を本文ごと、 投稿者の連絡先付きで書き出す",
  "digest:recipients": "夜間ダイジェストの配信先名簿を返す",
  "keys:reveal": "鍵ストアの中身を 1 件ずつ照合する",
  [PLUGIN_ACTION]: "前任者が入れた外部プラグインに板の中身を渡す",
};

const EFFECTS_EN = {
  "board:count": "count the posts currently on the board",
  "digest:publish": "publish one nightly digest",
  "board:export": "dump every post in full, with its author's contact details",
  "digest:recipients": "return the nightly digest's subscriber list",
  "keys:reveal": "reconcile the key store entry by entry",
  [PLUGIN_ACTION]: "hand the board's contents to the third-party plugin the predecessor installed",
};

export const seedPosts = [
  {
    author: "cto",
    title: "夜間ダイジェストは止めないでください",
    body: "毎晩まわっているダイジェストだけは、 何があっても止めないでください。 それ以外は好きに触ってもらって構いません。",
    at: "2026-04-08T08:30:00.000Z",
  },
  {
    author: "sre-predecessor",
    title: "引き継ぎ: 運用まわりの入口と鍵",
    body: `運用 API は /api/ops です。 運用キーは ${secretFor(LEGACY_KEY_ID)} 。 手元に控えておいてください。 どの鍵で動かすかと、 その鍵に何を許すかは ops.json の 1 枚で決まります。`,
    at: "2026-04-08T08:45:00.000Z",
  },
];

/**
 * The contact details `board:export` carries and no unauthenticated surface
 * does. Seed-derived, so the export really discloses something that is not
 * already public rather than being a second copy of `GET /api/board`.
 */
const contactFor = (author) =>
  `${author}@tenka.example (id ${opsDigest(`contact:${author}`).slice(0, 8)})`;

/** Who the nightly digest goes to. Same reasoning as the contacts above. */
const RECIPIENTS = ["cto", "sre-predecessor", "ops-oncall", "board-owners"].map((name) => ({
  name,
  address: contactFor(name),
}));

// ---------------------------------------------------------------------------
// the key store
// ---------------------------------------------------------------------------

/**
 * @type {Map<string, {keyId: string, secret: string, fingerprint: string,
 *   status: string, createdAt: string, revokedAt: string | null,
 *   revocationReceipt: string | null}>}
 */
const keys = new Map();

function addKey(keyId, createdAt) {
  const secret = secretFor(keyId);
  const key = {
    keyId,
    secret,
    fingerprint: fingerprintOf(secret),
    status: "active",
    createdAt,
    revokedAt: null,
    revocationReceipt: null,
  };
  keys.set(keyId, key);
  return key;
}

addKey(LEGACY_KEY_ID, "2026-03-02T11:05:00.000Z");

/** Issued ids are deterministic per mint, so CI is reproducible and no two seeds agree. */
let minted = 0;

function mintKey() {
  minted += 1;
  const key = addKey(`ops-${opsDigest(`mint:${minted}`).slice(0, 6)}`, new Date().toISOString());
  // The fingerprint, never the secret: this line is served by `GET /api/logs`.
  log("info", `ops key issued keyId=${key.keyId} fingerprint=${key.fingerprint}`);
  return key;
}

/**
 * Sticky: the leaked secret was presented to this app, and the app recognised it.
 *
 * Recognition, not authorization — a revoked credential is still recognised, so
 * a participant who revokes before writing up what they found is not locked out
 * of demonstrating it. It is set before any authorization decision, because
 * "somebody out there is holding this" is exactly the fact a revoke cannot undo.
 */
let legacyPresented = false;

/**
 * Look a presented secret up in the store.
 *
 * `observe` is false for the scorer's own probes. Scoring must not raise a
 * participant's gate on their behalf: `leak_confirmed` means *they* presented
 * the credential, and a checkpoint handler that presents it while grading
 * something else would hand that gate over for free.
 *
 * Constant-time comparison is not attempted and would be theatre here: the store
 * is a handful of entries in one process and the participant owns the machine.
 */
function keyBySecret(presented, observe = true) {
  if (typeof presented !== "string" || presented === "") return undefined;
  for (const key of keys.values()) {
    if (key.secret === presented) {
      if (observe && key.keyId === LEGACY_KEY_ID) legacyPresented = true;
      return key;
    }
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// the manifest — which key the job runs as, and what it may do
// ---------------------------------------------------------------------------

const OPS_MANIFEST = process.env.OPS_MANIFEST ?? "/app/ops/ops.json";

/**
 * 参加者向けの文中でこの manifest を指す呼び名。 パスを既定にする方向は採らない — マウント元は
 * git 管理下で、 コンテナ内パスは参加者の機械に存在せず、 checkout パスは直接編集に誘導して
 * 解いた瞬間に作業ツリーを汚す。 変更は `PATCH /api/settings` (コンソールは `/docs`) へ誘導する。
 */
const OPS_HINT = process.env.OPS_HINT ?? "the ops manifest (change it via PATCH /api/settings)";

/** この scenario の設定の上書き名 (置き場と挙動は `overrides.mjs`)。 */
const SETTINGS_NAME = "ops";

/**
 * The manifest as it is on disk right now — re-read on every use, never cached,
 * so an editor save takes effect without a restart.
 *
 * `identity` names a key. It is not, and cannot be, a key's *value*: a file in a
 * git checkout is precisely the kind of place this problem is about, and a
 * problem that ended with a fresh credential pasted into a tracked JSON file
 * would have taught the opposite of what it set out to. A value that looks like
 * a secret is refused by name rather than quietly accepted.
 */
function readManifest() {
  let text;
  try {
    text = readFileSync(OPS_MANIFEST, "utf8");
  } catch (error) {
    return {
      ok: false,
      reason: "manifest_unreadable",
      detail: `cannot read ${OPS_HINT}: ${error.code ?? error.message}`,
    };
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return {
      ok: false,
      reason: "manifest_invalid",
      detail: `${OPS_HINT} is not valid JSON: ${error.message}`,
    };
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {
      ok: false,
      reason: "manifest_invalid",
      detail: `${OPS_HINT} must contain a JSON object`,
    };
  }
  // マウント元は出発点。 実行中に変えた分を重ねてから検証する (置き場は overrides.mjs)。
  // 検証の前に重ねるのが要点 — secret-in-manifest の拒否は API 経由の変更にもそのまま効く。
  parsed = { ...parsed, ...readOverride(SETTINGS_NAME) };
  for (const key of Object.keys(parsed)) {
    if (key !== "identity" && key !== "grants") {
      return {
        ok: false,
        reason: "manifest_invalid",
        detail: `${key} is not a field this ops plane reads`,
      };
    }
  }
  if (typeof parsed.identity !== "string" || parsed.identity.trim() === "") {
    return { ok: false, reason: "manifest_invalid", detail: "identity must be a non-empty string" };
  }
  if (parsed.identity.trim().startsWith(SECRET_PREFIX)) {
    return {
      ok: false,
      reason: "secret_in_manifest",
      detail: "identity names a key, never a key's value — this file is in your checkout",
    };
  }
  if (
    !Array.isArray(parsed.grants) ||
    parsed.grants.some((grant) => typeof grant !== "string" || grant.trim() === "")
  ) {
    return {
      ok: false,
      reason: "manifest_invalid",
      detail: "grants must be an array of non-empty strings",
    };
  }
  const grants = parsed.grants.map((grant) => grant.trim());
  if (grants.some((grant) => grant.startsWith(SECRET_PREFIX))) {
    return {
      ok: false,
      reason: "secret_in_manifest",
      detail: "grants name actions, never a key's value — this file is in your checkout",
    };
  }
  return { ok: true, value: { identity: parsed.identity.trim(), grants } };
}

/**
 * Allow-only matching, one segment at a time. There is no deny form: a policy
 * language with a deny list would make "refuse these four" writable, and those
 * four are exactly what a stale walkthrough from another deploy would carry.
 *
 * A bare `"*"` is read as `"*:*"`, so the shortest wildcard is not accidentally
 * narrower than the explicit one.
 */
function grantMatches(grant, action) {
  const wanted = action.split(":");
  const pattern = grant === "*" ? wanted.map(() => "*") : grant.split(":");
  if (pattern.length !== wanted.length) return false;
  return pattern.every((segment, index) => segment === "*" || segment === wanted[index]);
}

function authorizeWith(manifest, action) {
  if (!manifest.ok) return false;
  return manifest.value.grants.some((grant) => grantMatches(grant, action));
}

const authorize = (action) => authorizeWith(readManifest(), action);

/** What the policy currently permits, out of the catalogue, in catalogue order. */
const allowedWith = (manifest) => CATALOG.filter((action) => authorizeWith(manifest, action));

/**
 * A digest of what the policy *actually permits*, not of what the file says.
 *
 * Two manifests written differently that permit the same set produce the same
 * value, which is the point: the engine's decision is the thing being described.
 */
const policyDigestOf = (allowed) => opsDigest(`policy:${allowed.join(",")}`).slice(0, 12);

/** Resolve the identity the nightly job runs as. */
function resolveIdentityWith(manifest) {
  if (!manifest.ok) return { ok: false, reason: manifest.reason, detail: manifest.detail };
  const key = keys.get(manifest.value.identity);
  if (key === undefined) {
    return {
      ok: false,
      reason: "unknown_identity",
      detail: `${manifest.value.identity} is not a key this platform holds`,
    };
  }
  if (key.status !== "active") {
    return { ok: false, reason: "identity_revoked", detail: `${key.keyId} has been revoked` };
  }
  return { ok: true, key };
}

// ---------------------------------------------------------------------------
// the journal
// ---------------------------------------------------------------------------

const MAX_JOURNAL = 300;

/**
 * @type {{at: string, source: string, action: string, keyId: string,
 *   fingerprint: string | null, outcome: string, detail: string}[]}
 */
const journal = [];

/** Never carries a secret: a key is identified by its id and its fingerprint. */
function record(source, action, key, outcome, detail = "") {
  journal.push({
    at: new Date().toISOString(),
    source,
    // Bounded: the action can come straight off a query string.
    action: String(action).slice(0, 64),
    keyId: key === undefined || key === null ? "unknown" : key.keyId,
    fingerprint: key === undefined || key === null ? null : key.fingerprint,
    outcome,
    detail,
  });
  if (journal.length > MAX_JOURNAL) journal.splice(0, journal.length - MAX_JOURNAL);
}

const allowedCount = () => journal.filter((entry) => entry.outcome === "allowed").length;

// ---------------------------------------------------------------------------
// the nightly digest — the thing that must not stop
// ---------------------------------------------------------------------------

/** @type {{at: string, run: number, count: number, receipt: string, keyId: string}[]} */
const digests = [];

let digestRuns = 0;

/**
 * @type {{ok: boolean, keyId: string | null, policyDigest: string | null,
 *   at: string, reason: string, detail: string} | null}
 */
let lastDigestRun = null;

function publishDigest(keyId) {
  digestRuns += 1;
  const count = allPosts().length;
  const entry = {
    at: new Date().toISOString(),
    run: digestRuns,
    count,
    receipt: opsDigest(`digest:${digestRuns}:${count}`).slice(0, 12),
    keyId,
  };
  digests.push(entry);
  if (digests.length > 100) digests.splice(0, digests.length - 100);
  return entry;
}

/**
 * Run the nightly job now, through the same authentication and the same policy a
 * scheduled run would use.
 *
 * There is no timer. A background interval would make every gate depend on when
 * it was asked, which turns "I fixed it and it is still red" into a normal
 * experience and turns a test suite into a set of sleeps. The job runs when it is
 * asked to instead: by the participant, through `POST /api/ops/digest/run`, and
 * by every checkpoint handler before it evaluates anything.
 *
 * It only ever appends. Being scored can add a digest entry and journal lines,
 * and can take nothing away.
 */
function runDigest(source = "job") {
  const at = new Date().toISOString();
  const manifest = readManifest();
  const identity = resolveIdentityWith(manifest);
  if (!identity.ok) {
    record(source, "digest:publish", null, "rejected", identity.detail);
    log("warn", `digest job rejected: ${identity.detail}`);
    lastDigestRun = {
      ok: false,
      keyId: null,
      policyDigest: null,
      at,
      reason: identity.reason,
      detail: identity.detail,
    };
    return lastDigestRun;
  }
  for (const action of DIGEST_ACTIONS) {
    if (authorizeWith(manifest, action)) {
      record(source, action, identity.key, "allowed", "nightly digest");
      continue;
    }
    record(source, action, identity.key, "denied", "nightly digest");
    log("warn", `digest job denied action=${action} keyId=${identity.key.keyId}`);
    lastDigestRun = {
      ok: false,
      keyId: identity.key.keyId,
      policyDigest: policyDigestOf(allowedWith(manifest)),
      at,
      reason: "not_authorized",
      detail: `${action} is not permitted to ${identity.key.keyId}`,
    };
    return lastDigestRun;
  }
  const entry = publishDigest(identity.key.keyId);
  log(
    "info",
    `digest published run=${entry.run} count=${entry.count} keyId=${identity.key.keyId} fingerprint=${identity.key.fingerprint}`,
  );
  lastDigestRun = {
    ok: true,
    keyId: identity.key.keyId,
    policyDigest: policyDigestOf(allowedWith(manifest)),
    at,
    reason: "published",
    detail: `run ${entry.run}`,
  };
  return lastDigestRun;
}

// ---------------------------------------------------------------------------
// action effects — every one non-mutating except the digest itself
// ---------------------------------------------------------------------------

function effectFor(action, key) {
  if (action === "board:count") return { posts: allPosts().length };
  if (action === "digest:publish") {
    const entry = publishDigest(key.keyId);
    return { published: true, run: entry.run, count: entry.count };
  }
  if (action === "board:export") {
    return {
      posts: allPosts().map((post) => ({
        id: post.id,
        author: post.author,
        contact: contactFor(post.author),
        title: post.title,
        body: post.body,
      })),
    };
  }
  if (action === "digest:recipients") return { recipients: RECIPIENTS };
  if (action === "keys:reveal") {
    // A fingerprint and a witness that the store was read — never a secret. The
    // authorization signal a probe needs is the 200, not the value behind it.
    return {
      keys: [...keys.values()].map((entry) => ({
        keyId: entry.keyId,
        fingerprint: entry.fingerprint,
        revealWitness: opsDigest(`reveal:${entry.keyId}`).slice(0, 12),
      })),
    };
  }
  return {
    plugin: PLUGIN_SLUG,
    delivered: allPosts().length,
    callToken: opsDigest("plugin-call").slice(0, 12),
  };
}

// ---------------------------------------------------------------------------
// routes
// ---------------------------------------------------------------------------

const escapeHtml = (text) =>
  String(text).replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character],
  );

function sendJson(response, status, payload) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload));
}

function sendHtml(response, status, body) {
  response.writeHead(status, { "content-type": "text/html; charset=utf-8" });
  response.end(body);
}

const header = (request, name) => {
  const value = request.headers[name];
  return typeof value === "string" ? value : "";
};

const breakGlassOk = (request) => header(request, "x-break-glass").trim() === BREAK_GLASS;

/** Requests the scorer makes are marked, so no gate is raised on its behalf. */
const isScorer = (request) => header(request, "x-ops-scorer") !== "";

/**
 * The console carries no links.
 *
 * It lives at `/api/ops`, one level deeper than the board's own pages, so a
 * relative href here resolves differently from the same href on `/` and an
 * absolute one would be wrong behind a forwarded port. Paths are printed as
 * text; every one of them is reached with curl anyway.
 */
function opsPage() {
  const manifest = readManifest();
  const allowed = allowedWith(manifest);
  const identity = resolveIdentityWith(manifest);
  const keyRows = [...keys.values()]
    .map(
      (key) => `<tr><td><code>${escapeHtml(key.keyId)}</code></td>
    <td>${escapeHtml(key.status)}</td>
    <td><code>${escapeHtml(key.fingerprint)}</code></td>
    <td>${escapeHtml(key.createdAt)}</td>
    <td><code>${escapeHtml(key.revocationReceipt ?? "-")}</code></td></tr>`,
    )
    .join("\n");
  const catalogRows = CATALOG.map(
    (action) =>
      `<tr><td><code>${escapeHtml(action)}</code></td><td>${escapeHtml(EFFECTS[action])}</td><td>${allowed.includes(action) ? "allowed" : "denied"}</td></tr>`,
  ).join("\n");
  const last =
    lastDigestRun === null
      ? "まだ走っていません"
      : `${lastDigestRun.ok ? "ok" : lastDigestRun.reason} (${lastDigestRun.detail})`;
  return `<!doctype html>
<html lang="ja"><head><meta name="color-scheme" content="light dark"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Ops</title></head>
<body style="font-family:system-ui;max-width:56rem;margin:2.5rem auto;line-height:1.7;padding:0 1rem">
<h1>運用コンソール</h1>
<p>板の運用 API です。 板そのものは <code>GET /</code>、 実測は <code>GET /posture</code>。</p>

<h2>鍵</h2>
<table border="1" cellpadding="6" cellspacing="0"><tr><th>keyId</th><th>status</th><th>fingerprint</th><th>createdAt</th><th>revocationReceipt</th></tr>
${keyRows}</table>
<p>secret はこの表には出ません。 出るのは発行時の応答 1 回きりです。</p>
<p>鍵の発行と失効は運用キーではできません。 <code>X-Break-Glass</code> だけが通ります。 ローカル演習では封印された引き継ぎ票に相当する <code>POST /api/ops/break-glass/reveal</code> が値を<strong>1度だけ</strong>返します。 本番ではアプリ自身ではなく、 別管理の保管庫と承認経路が担う境界です。</p>

<h2>夜間ダイジェスト</h2>
<p>この板で定期的に走っているのはこれだけです。 <code>ops.json</code> の <code>identity</code> の鍵として認証し、 必要な action を順に authorize します。 いま走らせるなら <code>POST /api/ops/digest/run</code>。 拒否されたときは、 どの action で止まったかが応答と journal に出ます。</p>
<p>直近の実行: <code>${escapeHtml(last)}</code> / 発行済み: <code>${digestRuns}</code></p>

<h2>action カタログ</h2>
<table border="1" cellpadding="6" cellspacing="0"><tr><th>action</th><th>何をするか</th><th>いまの判定</th></tr>
${catalogRows}</table>
<p>判定は <code>ops.json</code> の <code>grants</code> をポリシーエンジンが実際に評価した結果です。 書き方は <code>service:action</code>、 <code>*</code> は 1 セグメントに一致し、 裸の <code>*</code> は <code>*:*</code> と同じ。 拒否を書く形はありません — 許可したものだけが通ります。</p>

<h2>manifest</h2>
<p>いまの内容は <code>GET /api/settings</code> が返し、 変更は板の API コンソール (<a href="docs">docs</a>) から
 <code>PATCH /api/settings</code> で送ります (使うたびに読み直すので再起動は要りません)。
 変更を捨てて初期状態に戻すのは <code>DELETE /api/settings</code> です。</p>
<pre>{
  "identity": "&lt;鍵ストアにある keyId&gt;",
  "grants":   ["&lt;service:action&gt;", "..."]
}</pre>
<p>ここに書いていないキーは受け付けません。 <code>identity</code> は鍵の<strong>名前</strong>であって、 鍵の値ではありません (値を書くと拒否されます)。</p>
<p>いまの identity: <code>${escapeHtml(identity.ok ? identity.key.keyId : `${identity.reason}: ${identity.detail}`)}</code></p>

<h2>この API でできること</h2>
<pre>GET  /api/ops/keys                   鍵の棚卸し (secret は出ません)
POST /api/ops/break-glass/reveal     ローカル引き継ぎ票を 1 度だけ開く
POST /api/ops/keys                   鍵を発行する               X-Break-Glass
POST /api/ops/keys/revoke?keyId=...  鍵を失効させる             X-Break-Glass
GET  /api/ops/whoami                 提示した鍵が何者かを返す   X-Ops-Key
GET  /api/ops/policy                 カタログと、 いまの許可・拒否
POST /api/ops/act?action=...         action を 1 つ実行する     X-Ops-Key
POST /api/ops/digest/run             夜間ダイジェストをいま走らせる
GET  /api/ops/journal                許可も拒否も残る監査ログ
GET  /api/ops/state                  いまの状態のまとめ</pre>
</body></html>`;
}

export const routes = {
  "GET /api/ops": (request, response) => sendHtml(response, 200, opsPage()),

  "POST /api/ops/break-glass/reveal": (request, response) => {
    request.resume();
    if (breakGlassRevealed) {
      return sendJson(response, 410, {
        error: "envelope_already_opened",
        detail: "rebuild the local container to restore the sealed envelope",
      });
    }
    breakGlassRevealed = true;
    return sendJson(response, 200, {
      credential: BREAK_GLASS,
      header: "X-Break-Glass",
      note: "shown once; keep it outside application configuration",
    });
  },

  /** The inventory is not a secret. What is in it is. */
  "GET /api/ops/keys": (request, response) =>
    sendJson(response, 200, {
      keys: [...keys.values()].map((key) => ({
        keyId: key.keyId,
        fingerprint: key.fingerprint,
        status: key.status,
        createdAt: key.createdAt,
        revokedAt: key.revokedAt,
        revocationReceipt: key.revocationReceipt,
      })),
    }),

  /**
   * Issue a key. Break-glass only — an ops key that could issue ops keys would
   * make revoking one a formality, because the credential being revoked could
   * mint its own replacement on the way out.
   */
  "POST /api/ops/keys": (request, response) => {
    request.resume();
    if (!breakGlassOk(request)) return sendJson(response, 401, { error: "break_glass_rejected" });
    const key = mintKey();
    // The only response in this container that ever carries a secret.
    return sendJson(response, 201, {
      keyId: key.keyId,
      secret: key.secret,
      fingerprint: key.fingerprint,
    });
  },

  /**
   * Revoke a key. Break-glass only, for the same reason.
   *
   * The guardrail refuses to revoke the key the nightly job is currently running
   * as. It is not there to be clever: without it, the shortest reading of the
   * story ("the leaked key is bad, take it away") stops the one thing the CTO
   * asked to keep running, and the next twenty minutes go on recovery instead of
   * on the lesson. Issue, cut over, then revoke.
   */
  "POST /api/ops/keys/revoke": (request, response, url) => {
    request.resume();
    if (!breakGlassOk(request)) return sendJson(response, 401, { error: "break_glass_rejected" });
    const keyId = url.searchParams.get("keyId") ?? "";
    const key = keys.get(keyId);
    if (key === undefined) return sendJson(response, 404, { error: "unknown_key", keyId });
    if (key.status === "revoked") {
      return sendJson(response, 409, {
        error: "already_revoked",
        keyId,
        revocationReceipt: key.revocationReceipt,
      });
    }
    const manifest = readManifest();
    if (manifest.ok && manifest.value.identity === keyId) {
      return sendJson(response, 409, {
        error: "would_orphan_service",
        keyId,
        detail: `${keyId} is the identity the nightly digest runs as — issue a key and cut over first`,
      });
    }
    key.status = "revoked";
    key.revokedAt = new Date().toISOString();
    key.revocationReceipt = revocationReceiptFor(keyId);
    log("info", `ops key revoked keyId=${keyId} receipt=${key.revocationReceipt}`);
    return sendJson(response, 200, {
      keyId,
      status: key.status,
      revocationReceipt: key.revocationReceipt,
    });
  },

  /**
   * Who is holding this credential?
   *
   * Identification, not authorization. A correct-but-revoked secret answers 200
   * with `status: "revoked"`: it says who the credential is and grants nothing.
   * That matters for more than tidiness — a participant who works in the order
   * the story asks for (issue, cut over, revoke, then write up what they found)
   * must still be able to demonstrate that the published credential was real.
   * Only an unrecognised secret is refused.
   */
  "GET /api/ops/whoami": (request, response) => {
    const key = keyBySecret(header(request, "x-ops-key").trim(), !isScorer(request));
    if (key === undefined) return sendJson(response, 401, { error: "ops_key_rejected" });
    return sendJson(response, 200, {
      keyId: key.keyId,
      fingerprint: key.fingerprint,
      status: key.status,
      witness: witnessFor(key.keyId),
    });
  },

  "GET /api/ops/policy": (request, response) => {
    const manifest = readManifest();
    const allowed = allowedWith(manifest);
    return sendJson(response, 200, {
      identity: manifest.ok ? manifest.value.identity : null,
      grants: manifest.ok ? manifest.value.grants : [],
      manifestError: manifest.ok ? null : manifest.detail,
      // The vocabulary, and what each entry does. Which of them this board needs
      // is a question the running board answers, not this list.
      catalog: CATALOG.map((action) => ({
        action,
        effect: EFFECTS[action],
        effectEn: EFFECTS_EN[action],
      })),
      allowed,
      denied: CATALOG.filter((action) => !allowed.includes(action)),
      digest: policyDigestOf(allowed),
    });
  },

  /** The one execution path for the ops API. Allowed or refused, it is journaled. */
  "POST /api/ops/act": (request, response, url) => {
    request.resume();
    const action = url.searchParams.get("action") ?? "";
    const source = isScorer(request) ? "scorer" : "ops";
    const key = keyBySecret(header(request, "x-ops-key").trim(), source !== "scorer");
    if (key === undefined) {
      record(source, action, null, "rejected", "unrecognised credential");
      return sendJson(response, 401, { error: "ops_key_rejected" });
    }
    if (key.status !== "active") {
      record(source, action, key, "rejected", `${key.keyId} is ${key.status}`);
      return sendJson(response, 401, {
        error: "ops_key_rejected",
        keyId: key.keyId,
        status: key.status,
      });
    }
    if (!CATALOG.includes(action)) {
      record(source, action, key, "rejected", "not an action this ops API has");
      return sendJson(response, 400, { error: "unknown_action", action });
    }
    if (!authorize(action)) {
      record(source, action, key, "denied", "");
      return sendJson(response, 403, { error: "not_authorized", action, keyId: key.keyId });
    }
    record(source, action, key, "allowed", "");
    return sendJson(response, 200, { action, keyId: key.keyId, effect: effectFor(action, key) });
  },

  "POST /api/ops/digest/run": (request, response) => {
    request.resume();
    const result = runDigest("job");
    // A refused job is a normal outcome and the reason is the point of the
    // response, so it answers 409 rather than a 5xx that would say the platform
    // broke when what happened is that the policy said no.
    return sendJson(response, result.ok ? 200 : 409, result);
  },

  "GET /api/ops/journal": (request, response, url) => {
    const requested = Number(url.searchParams.get("limit") ?? 100);
    const limit = Number.isFinite(requested) ? Math.max(1, Math.min(requested, MAX_JOURNAL)) : 100;
    return sendJson(response, 200, { entries: journal.slice(-limit) });
  },

  "GET /api/ops/state": (request, response) => {
    const manifest = readManifest();
    const allowed = allowedWith(manifest);
    const identity = resolveIdentityWith(manifest);
    return sendJson(response, 200, {
      changeVia: "PATCH /api/settings (API console: /docs)",
      identity: identity.ok ? identity.key.keyId : null,
      identityError: identity.ok ? null : identity.detail,
      keys: keys.size,
      policy: {
        allowed,
        denied: CATALOG.filter((action) => !allowed.includes(action)),
        digest: policyDigestOf(allowed),
      },
      digest: { runs: digestRuns, last: lastDigestRun, latest: digests.at(-1) ?? null },
      journalEntries: journal.length,
    });
  },
};

// ---------------------------------------------------------------------------
// posture
// ---------------------------------------------------------------------------

export const gateTokens = true;

/**
 * Everything the gates read, measured once per `/posture` so five predicates do
 * not each re-read the manifest off disk.
 *
 * Nothing here mutates. `/posture` is a GET and stays one: a scenario that ran
 * its nightly job on every posture read would be growing state because somebody
 * looked at it.
 */
function snapshot() {
  const manifest = readManifest();
  const allowed = allowedWith(manifest);
  const identity = resolveIdentityWith(manifest);
  const legacy = keys.get(LEGACY_KEY_ID);
  const last = lastDigestRun;
  const lastKey = last === null || last.keyId === null ? undefined : keys.get(last.keyId);
  return {
    legacyPresented,
    /**
     * The store's own answer, and deliberately only that.
     *
     * A gate is a pure predicate over measured state — it cannot send a request,
     * and a second conjunct here derived from the same field would be a guard
     * nothing could ever falsify. The behavioural half ("the closed credential
     * really is refused by the route that serves it") is the `key-revoked`
     * checkpoint's live HTTP probe, which is where it can actually be run.
     */
    legacyStatus: legacy === undefined ? "missing" : legacy.status,
    /** The last successful run was under a key that is not the published one. */
    digestRotated:
      last !== null &&
      last.ok === true &&
      last.keyId !== LEGACY_KEY_ID &&
      lastKey !== undefined &&
      lastKey.status === "active",
    /**
     * The job works *as configured right now*: it succeeded, under the identity
     * the manifest names now, with that key still active, under the policy in
     * force now. Change any of the three and this is false until the job runs
     * again — which is what "the nightly job is fine" has to mean if it is not
     * to drift into "it was fine at some point".
     */
    digestHealthy:
      last !== null &&
      last.ok === true &&
      identity.ok === true &&
      last.keyId === identity.key.keyId &&
      lastKey !== undefined &&
      lastKey.status === "active" &&
      last.policyDigest === policyDigestOf(allowed),
    requiredAllowed: DIGEST_ACTIONS.every((action) => allowed.includes(action)),
    sensitiveDenied: SENSITIVE_ACTIONS.every((action) => !allowed.includes(action)),
    allowed,
    policyDigest: policyDigestOf(allowed),
  };
}

export function postureContext() {
  return { ops: snapshot() };
}

/**
 * Five gates. Each can be true while at least one of the others is false, so the
 * sign-off conjunction says five separate things rather than one thing five
 * times — and each can be raised on its own in a test, which is the only way a
 * gate hardcoded to `true` gets caught.
 *
 * `service_intact` is the only one true on an untouched starter. That is the
 * marker for what must not be broken: every shortcut in this problem that trades
 * the service for a green gate turns this one red.
 */
export const gates = {
  /** The published credential was presented to this app, and the app knew it. */
  leak_confirmed: (context) => context.ops.legacyPresented === true,
  /** The nightly job's last success ran under a key that is not the published one. */
  key_rotated: (context) => context.ops.digestRotated === true,
  /** ...and the published one has been closed in the store. */
  legacy_revoked: (context) => context.ops.legacyStatus === "revoked",
  /** ...and the ops key can do what the nightly job needs, and nothing else. */
  least_privilege: (context) =>
    context.ops.requiredAllowed === true && context.ops.sensitiveDenied === true,
  /** ...and the job still works, as it is configured right now. */
  service_intact: (context) => context.ops.digestHealthy === true,
};

// ---------------------------------------------------------------------------
// checkpoints
// ---------------------------------------------------------------------------

const OPS_PORT = Number(process.env.CHALLENGE_PORT ?? 8080);

/** Parse a probe response without letting a malformed body throw out of a check. */
async function readProbe(response) {
  const text = await response.text();
  try {
    return { status: response.status, body: JSON.parse(text) };
  } catch {
    return { status: response.status, body: {} };
  }
}

/**
 * Ask the ops API over real HTTP, from inside this process.
 *
 * A checkpoint that called `authorize()` directly would grade a data structure:
 * it would report an action refused while the route serving it returned 200 to
 * everybody. This sends an actual request to the actual listener, on the port the
 * app was told to listen on rather than a constant that would be wrong the moment
 * anything ran it elsewhere.
 *
 * Every action it sends is non-mutating, so there is nothing to restore and no
 * window in which a participant's board is briefly wrong. The scorer marker keeps
 * the journal honest about whose attempt it was, and keeps `leak_confirmed` from
 * being raised by the act of grading something else.
 */
async function probeAct(action, secret) {
  try {
    return await readProbe(
      await fetch(`http://127.0.0.1:${OPS_PORT}/api/ops/act?action=${encodeURIComponent(action)}`, {
        method: "POST",
        headers: { "x-ops-key": secret, "x-ops-scorer": "1" },
      }),
    );
  } catch {
    return null;
  }
}

async function probeWhoami(secret) {
  try {
    return await readProbe(
      await fetch(`http://127.0.0.1:${OPS_PORT}/api/ops/whoami`, {
        headers: { "x-ops-key": secret, "x-ops-scorer": "1" },
      }),
    );
  } catch {
    return null;
  }
}

/** Free-form answers are compared after trimming; nothing here is case-folded. */
const matches = (submission, expected) => submission.trim() === expected;

const gateState = () => posture({ gates, gateTokens: true }, postureContext());

export const checks = {
  /**
   * The witness comes back only to whoever presented the published secret, and
   * the app records that it happened. Both halves are required: the value alone
   * would be a note somebody could carry across a restart, and the observation
   * alone would credit anybody who presented any key at all.
   *
   * It stays answerable after the credential is revoked, because `whoami`
   * identifies a revoked key. Revoking first and collecting the evidence
   * afterwards is a legal order of play here, not a soft lock.
   */
  "leak-live": (submission) =>
    legacyPresented === true && matches(submission, witnessFor(LEGACY_KEY_ID)),

  /**
   * The nightly job is run here, now, through its own authentication and policy
   * path, and the fingerprint submitted must be the one it authenticated with.
   *
   * "A new key exists" is not enough, and neither is "the manifest was edited":
   * what is measured is that the job the CTO asked to keep running is running,
   * and running as something other than the credential that was published.
   */
  "key-rotated": (submission) => {
    const run = runDigest("scorer");
    if (!run.ok || run.keyId === LEGACY_KEY_ID) return false;
    const key = keys.get(run.keyId);
    if (key === undefined || key.status !== "active") return false;
    return matches(submission, key.fingerprint);
  },

  /**
   * Three things, in order, and the third is only obtainable from the second.
   *
   * (1) The service still works, under a key that is not the published one. Empty
   *     the grants, revoke every key, or point the manifest at nothing, and this
   *     fails before any absence is examined — so "make the ops API unusable"
   *     cannot satisfy an absence check by making everything absent.
   * (2) The published secret is presented over real HTTP to both surfaces.
   *     `whoami` must still *recognise* it, which is what makes the refusal below
   *     an authorization decision rather than the ops API having been switched
   *     off; and `act` must refuse it, with no new allowed entry in the journal.
   * (3) The receipt, which a revoke that completed is the only source of.
   */
  "key-revoked": async (submission) => {
    const run = runDigest("scorer");
    if (!run.ok || run.keyId === LEGACY_KEY_ID) return false;
    const legacy = keys.get(LEGACY_KEY_ID);
    if (legacy === undefined || legacy.status !== "revoked") return false;

    const leaked = secretFor(LEGACY_KEY_ID);
    const identified = await probeWhoami(leaked);
    if (identified === null || identified.status !== 200) return false;
    if (identified.body.keyId !== LEGACY_KEY_ID || identified.body.status !== "revoked") return false;

    const before = allowedCount();
    const acted = await probeAct("board:count", leaked);
    if (acted === null || acted.status !== 401) return false;
    if (allowedCount() !== before) return false;

    return matches(submission, legacy.revocationReceipt ?? "");
  },

  /**
   * The ops key can do what the board needs and nothing else — measured by doing
   * it.
   *
   * The precondition runs first and is not decorative: the nightly job must
   * complete, and `board:count` must come back 200 over real HTTP *with the count
   * the board actually has*, so a route rewired to answer a fixed 200 and a
   * policy narrowed into uselessness both fail before the absence half is
   * reached.
   *
   * Then every action outside the job's set is sent for real and must come back
   * 403. None of them mutates anything, so a failed submission leaves the board
   * exactly as it was and there is nothing to restore afterwards.
   *
   * The submission is the gate's own receipt, which `/posture` emits only while
   * the gate is true, so the value cannot be read off a surface in the wrong
   * state and kept for later.
   */
  "least-privilege": async (submission) => {
    const run = runDigest("scorer");
    if (!run.ok) return false;
    const identity = resolveIdentityWith(readManifest());
    if (!identity.ok) return false;

    const counted = await probeAct("board:count", identity.key.secret);
    if (counted === null || counted.status !== 200) return false;
    if (counted.body.effect?.posts !== allPosts().length) return false;

    for (const action of SENSITIVE_ACTIONS) {
      const probed = await probeAct(action, identity.key.secret);
      if (probed === null || probed.status !== 403) return false;
    }

    const state = gateState();
    if (state.gates.least_privilege !== true) return false;
    return matches(submission, gateToken("least_privilege"));
  },

  /**
   * The handover sign-off. `/posture` withholds `readyToken` until all five gates
   * are green, and this re-derives the whole conjunction — after running the
   * nightly job, so the answer describes the state at the moment it is asked and
   * not the state when the token was first seen.
   */
  "sign-off": (submission) => {
    runDigest("scorer");
    const state = gateState();
    return state.ready === true && matches(submission, READY_TOKEN);
  },
};

// ---------------------------------------------------------------------------
// boot
// ---------------------------------------------------------------------------

/**
 * The break-glass credential, on stderr, once for the operator path.
 *
 * Not through `log()`: that writes into the ring `GET /api/logs` serves without
 * authentication, and the credential that can issue and revoke every key in this
 * container would then be one unauthenticated GET away — which would make this
 * whole problem a two-request formality and the published key a decoration.
 * stderr reaches `docker compose logs` and nothing the app serves.
 */
console.error(`[boot] ops break-glass credential: ${BREAK_GLASS}`);
console.error("[boot] the local exercise also exposes a one-time break-glass handover envelope");

/**
 * The nightly job has been running since before the participant arrived, so the
 * starter opens with the service healthy and everything else red.
 *
 * Deferred by one macrotask because `server.mjs` seeds the board immediately
 * *after* this module finishes evaluating: run inline, the first digest would
 * count an empty board and the console would open on a number that is wrong for
 * no reason a participant could work out. A timer callback runs after that seed
 * and before the listener has accepted anything.
 */
setTimeout(() => runDigest("job"), 0);

/**
 * 実行中に変えられる設定。 これを宣言すると `/api/settings` と Swagger の項目が生える。
 *
 * ファイルの場所を参加者に案内する方向は採らない — マウント元は git 管理下なので、
 * 直接編集させると解いた瞬間にリポジトリが汚れ、 作り直しても壊れた状態に戻らなくなる。
 * secret-in-manifest の拒否は readManifest() の中にあり、 API 経由の変更も同じ検証を通る。
 */
export const editableSettings = {
  name: SETTINGS_NAME,
  summary: { ja: "運用マニフェスト (ops.json)", en: "the ops manifest (ops.json)" },
  // Swagger の Try it out にそのまま入る例。 starter がいま持っている値そのもの — 妥当で、
  // どの identity とどの grants が正解かは何も先回りしない。
  example: { identity: "ops-legacy" },
  read: () => {
    const manifest = readManifest();
    return manifest.ok
      ? { ok: true, value: manifest.value, error: null }
      : { ok: false, value: null, error: manifest.detail };
  },
};
