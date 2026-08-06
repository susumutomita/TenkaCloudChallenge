import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { log } from "../log.mjs";
import { readOverride } from "../overrides.mjs";
import { posture } from "../posture.mjs";
import { READY_TOKEN, gateToken } from "../secrets.mjs";

/**
 * The ship scenario: the board runs, and nothing outside the ops console can
 * reach it.
 *
 * Everything this problem adds lives in this module. The shared base gives it
 * routes, gates, gate receipts and checkpoint handlers, and that is all it gets:
 * a release plane that only one problem uses does not belong in a board eight
 * problems share.
 *
 * The model is deliberately small and deliberately honest about being a model.
 * There is no cloud account and no public URL. What there is:
 *
 *   registry   one artifact, built before the participant arrived
 *   manifest   a file in the participant's checkout that says what to deploy
 *   pipeline   six named stages, each of which can refuse and say why
 *   store      a versioned signing key whose value never leaves this process
 *   site       `/site` — the published surface, served only while a release is
 *              live and its signing key is one the platform still accepts
 *
 * The lesson that has to survive the model is the binding: a release that holds
 * a *copy* of the signing key keeps working right up until the key is rotated,
 * and a release that holds a *reference* to it does not care. That is the
 * difference between pasting a secret into an environment variable and pointing
 * a task definition at a secret store, and it is measured here the same way it
 * would be measured there — by asking what happens at the next rotation.
 */

const FLAG_SEED = process.env.FLAG_SEED ?? "local-dev-seed";

/**
 * Every unguessable value this scenario hands out, namespaced under `ship:` so
 * it can never collide with the board's own derivations in `secrets.mjs`.
 */
function shipDigest(namespace) {
  return createHash("sha256").update(`ship:${namespace}:${FLAG_SEED}`).digest("hex");
}

/** The artifact the predecessor's build already produced. 12 hex. */
const ARTIFACT_ID = `board-${shipDigest("artifact").slice(0, 12)}`;

/**
 * Printed by the published site and nowhere else in this container — not on the
 * board, not on the console, not in the log. Its own digest namespace, so the
 * board's `SS-` serial is no help.
 */
const PUBLIC_SERIAL = `SSX-${shipDigest("public").slice(0, 8)}`;

/** Written to the deploy log when — and only when — a promote stage runs. */
function receiptFor(releaseId, artifact, generation) {
  return shipDigest(`receipt:${releaseId}:${artifact}:${generation}`).slice(0, 12);
}

const SECRET_NAME = "board-signing-key";

/**
 * The signing key store. Versions are deterministic so CI is reproducible, and
 * the values are never served on any surface: what a participant can see is a
 * name and a version number, which is what a real secret store shows too.
 */
const secretStore = new Map([[SECRET_NAME, { version: 1, rotatedAt: new Date().toISOString() }]]);

function secretValue(name, version) {
  return shipDigest(`secret:${name}:${version}`).slice(0, 32);
}

const currentSecret = (name) => secretValue(name, secretStore.get(name).version);

/**
 * The value the store *would* hold after one more rotation, computed without
 * moving the store.
 *
 * Scoring must never break a participant's environment to find out whether it
 * would break: an incorrect guess that rotates the real key would punish them
 * for being scored, and a retried verdict would rotate twice. So the rotation
 * question is answered against this probe epoch instead, and the participant
 * keeps the real rotation as their own drill.
 */
const probeSecret = (name) => secretValue(name, secretStore.get(name).version + 1);

const MANIFEST_PATH = process.env.RELEASE_MANIFEST ?? "/app/release/release.json";
const SETTINGS_NAME = "release";

/**
 * Where the manifest sits in the *participant's* checkout, which is not the path
 * this process reads. Display only, exactly like `CONFIG_HINT`.
 */
const RELEASE_HINT = process.env.RELEASE_HINT ?? MANIFEST_PATH;
const SETTINGS_LABEL = "/api/settings";

/**
 * The title the manifest ships with. A release that still carries it has not
 * been through the participant's hands, so `published-title` does not credit it.
 * The same string is in `local/release/release.json`; the problem's test suite
 * asserts the two have not drifted.
 */
const LAPTOP_TITLE = "board (built on a laptop)";

export const seedPosts = [
  {
    author: "cto",
    title: "掲示板、 今日じゅうに外から見えるところまで",
    body: "社内の運用コンソール越しではなく、 公開側の入口から見える状態にしてください。 リンクを貼れる形で。",
    at: "2026-04-07T08:40:00.000Z",
  },
  {
    author: "sre-predecessor",
    title: "引き継ぎ: リリースは release.json 1 枚",
    body: "デプロイに要るのは release.json だけです。 中身は自分のノート PC でビルドしたときのまま。 Shipyard に投げれば動くはず。",
    at: "2026-04-07T08:55:00.000Z",
  },
];

// ---------------------------------------------------------------------------
// the release plane
// ---------------------------------------------------------------------------

const BOOT_AT = new Date().toISOString();

/** The build already happened. Nothing is serving it — that is the point. */
const artifacts = [
  { id: ARTIFACT_ID, builtAt: BOOT_AT, sizeBytes: 1_482_240, stage: "built" },
];

/**
 * The predecessor's abandoned attempt, present from boot.
 *
 * Without it a participant who reads the registry before their first deploy
 * lands on exactly one release record and has nothing to clean up, so the
 * cutover checkpoint would grade tidiness nobody had to do. With it, every path
 * through this problem ends with at least one dead record to remove.
 */
const releases = [
  {
    id: "rel-0",
    artifact: "board-2f9c81ae",
    state: "failed",
    createdAt: "2026-04-06T22:14:03.000Z",
    generation: 0,
    keyBinding: null,
    title: null,
    receipt: null,
    failure: {
      stage: "resolve-artifact",
      reason: "unknown_artifact",
      detail: "board-2f9c81ae is not in this registry",
    },
  },
];

const transcripts = new Map([
  [
    "rel-0",
    [
      { stage: "read-manifest", status: "ok", detail: "manifest read" },
      {
        stage: "resolve-artifact",
        status: "failed",
        detail: "board-2f9c81ae is not in this registry",
      },
      { stage: "resolve-config", status: "skipped", detail: "" },
      { stage: "start", status: "skipped", detail: "" },
      { stage: "health-gate", status: "skipped", detail: "" },
      { stage: "promote", status: "skipped", detail: "" },
    ],
  ],
]);

/**
 * Literal signing keys, held here rather than on the release record.
 *
 * A record is serialised onto `/shipyard/releases` and onto the console; a key
 * value that lived on it would be published by the surface whose whole job is to
 * show what is deployed.
 */
const literalKeys = new Map();

/** Every receipt this container has ever issued, one per promote that ran. */
const issuedReceipts = new Set();

let generation = 0;
let liveId = null;
let releaseCounter = 0;

/**
 * The last time the published site actually answered 200, and for which release.
 *
 * A pure function over plane state can say "a live release exists and its key
 * resolves" while nothing is listening. The gate wants the stronger fact — the
 * site was asked and answered — so it is recorded by the site's own handler when
 * it serves, and the scorer's probes are excluded from it (see `probeSite`).
 */
let lastServedOk = null;

const liveRelease = () => releases.find((release) => release.id === liveId) ?? null;

function signaturePayload(release) {
  return `${PUBLIC_SERIAL}|${release.id}|${release.generation}`;
}

function sign(key, release) {
  return createHmac("sha256", key).update(signaturePayload(release)).digest("hex");
}

function sameSignature(left, right) {
  const a = Buffer.from(left, "utf8");
  const b = Buffer.from(right, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * What the site answers, evaluated against one epoch of the signing key store.
 *
 * The key has a job: the site signs what it publishes with the key its release
 * resolved, and the platform accepts the response only if that signature
 * verifies under the key the store holds *now*. A release that resolves by
 * reference re-resolves and keeps verifying across a rotation; a release holding
 * a copy signs with a key the platform has moved past, and its signature is
 * rejected. The 503 is the outcome of a verification that really ran, not a
 * string comparison standing in for one.
 *
 * @param epochKey the store's key at the epoch being asked about
 */
function verdictForEpoch(epochKey) {
  const release = liveRelease();
  if (release === null) {
    return {
      status: 503,
      body: { error: "no_live_release", detail: "nothing is deployed at the moment" },
    };
  }
  const resolved = release.keyBinding === "reference" ? epochKey : literalKeys.get(release.id);
  const published = sign(resolved ?? "", release);
  const accepted = sign(epochKey, release);
  if (!sameSignature(published, accepted)) {
    return {
      status: 503,
      body: {
        error: "signature_rejected",
        releaseId: release.id,
        detail: `${release.id} signed its response with a key this platform no longer accepts`,
      },
    };
  }
  return {
    status: 200,
    body: {
      status: "ok",
      releaseId: release.id,
      artifact: release.artifact,
      generation: release.generation,
      keyVersion: secretStore.get(SECRET_NAME).version,
      publicSerial: PUBLIC_SERIAL,
      title: release.title,
      signature: published,
    },
  };
}

const siteVerdict = () => verdictForEpoch(currentSecret(SECRET_NAME));

/**
 * Would the live release still be accepted after the next rotation?
 *
 * True only for a release that resolves its key from the store per request. A
 * literal fails however freshly it was copied, because the probe epoch is one
 * version ahead of anything the participant could have pasted.
 */
const wouldSurviveRotation = () => verdictForEpoch(probeSecret(SECRET_NAME)).status === 200;

const servedCurrent = () => {
  const release = liveRelease();
  if (release === null || lastServedOk === null) return false;
  return lastServedOk.releaseId === release.id && lastServedOk.generation === release.generation;
};

// ---------------------------------------------------------------------------
// the deploy pipeline
// ---------------------------------------------------------------------------

const STAGES = [
  "read-manifest",
  "resolve-artifact",
  "resolve-config",
  "start",
  "health-gate",
  "promote",
];

/** The manifest as it is on disk right now — re-read per deploy, never cached. */
function readManifest() {
  let text;
  try {
    text = readFileSync(MANIFEST_PATH, "utf8");
  } catch (error) {
    return { ok: false, reason: "manifest_unreadable", detail: `cannot read ${RELEASE_HINT}: ${error.code ?? error.message}` };
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return { ok: false, reason: "manifest_invalid", detail: `${RELEASE_HINT} is not valid JSON: ${error.message}` };
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, reason: "manifest_invalid", detail: `${RELEASE_HINT} must contain a JSON object` };
  }
  parsed = { ...parsed, ...readOverride(SETTINGS_NAME) };
  if (typeof parsed.artifact !== "string" || parsed.artifact.trim() === "") {
    return { ok: false, reason: "manifest_invalid", detail: "artifact must be a non-empty string" };
  }
  if (parsed.env === undefined || parsed.env === null || typeof parsed.env !== "object" || Array.isArray(parsed.env)) {
    return { ok: false, reason: "manifest_invalid", detail: "env must be an object" };
  }
  for (const key of Object.keys(parsed)) {
    if (key !== "artifact" && key !== "env") {
      return { ok: false, reason: "manifest_invalid", detail: `${key} is not a field this release plane reads` };
    }
  }
  return { ok: true, value: { artifact: parsed.artifact.trim(), env: parsed.env } };
}

export const editableSettings = {
  name: SETTINGS_NAME,
  summary: { ja: "リリース manifest", en: "release manifest" },
  example: { artifact: "board-…", env: { BOARD_TITLE: "StackStack" } },
  read: () => {
    const manifest = readManifest();
    return manifest.ok
      ? { ok: true, value: manifest.value, error: null }
      : { ok: false, value: null, error: manifest.detail };
  },
};

/**
 * The environment a release must carry, and nothing else.
 *
 * Unknown keys are refused rather than ignored, the same way `config.mjs`
 * refuses an unknown setting: a manifest that silently drops half of what it
 * declares is how a deploy "succeeds" and serves the wrong thing. There is no
 * health-path field and no gate field — the health gate belongs to the platform,
 * not to the release, so there is nothing here a release could relax.
 */
function resolveConfig(env) {
  for (const key of Object.keys(env)) {
    if (key !== "BOARD_PUBLIC_TITLE" && key !== "BOARD_SIGNING_KEY") {
      return { ok: false, reason: "unknown_env_key", detail: `${key} is not a setting this app reads` };
    }
  }
  const title = env.BOARD_PUBLIC_TITLE;
  if (title === undefined) {
    return { ok: false, reason: "missing_required_env", detail: "BOARD_PUBLIC_TITLE is required: the app has no title to publish without it" };
  }
  if (typeof title !== "string" || title.trim() === "") {
    return { ok: false, reason: "bad_env_value", detail: "BOARD_PUBLIC_TITLE must be a non-empty string" };
  }
  const key = env.BOARD_SIGNING_KEY;
  if (key === undefined) {
    return { ok: false, reason: "missing_required_env", detail: "BOARD_SIGNING_KEY is required: the app will not start without the key it signs responses with" };
  }
  if (typeof key === "string") {
    if (key.trim() === "") {
      return { ok: false, reason: "bad_env_value", detail: "BOARD_SIGNING_KEY must not be empty" };
    }
    return { ok: true, value: { title: title.trim(), keyBinding: "literal", key: key.trim() } };
  }
  if (key !== null && typeof key === "object" && !Array.isArray(key) && typeof key.fromSecret === "string") {
    if (Object.keys(key).length !== 1) {
      return { ok: false, reason: "bad_env_value", detail: "a secret reference carries fromSecret and nothing else" };
    }
    if (!secretStore.has(key.fromSecret)) {
      return { ok: false, reason: "unknown_secret", detail: `${key.fromSecret} is not in this platform's secret store` };
    }
    return { ok: true, value: { title: title.trim(), keyBinding: "reference", key: null } };
  }
  return { ok: false, reason: "bad_env_value", detail: "BOARD_SIGNING_KEY must be the key itself, or a reference to an entry in the platform's secret store" };
}

/** Write the stage-by-stage transcript out, so a failure is readable in the log. */
function recordTranscript(release, transcript) {
  transcripts.set(release.id, transcript);
  for (const step of transcript) {
    if (step.status === "skipped") continue;
    const receipt = step.stage === "promote" && step.status === "ok" ? ` receipt=${release.receipt}` : "";
    log(
      step.status === "ok" ? "info" : "warn",
      `deploy ${release.id} stage=${step.stage} status=${step.status}${receipt}${step.detail === "" ? "" : ` detail=${step.detail}`}`,
    );
  }
}

function failedAt(release, stage, reason, detail) {
  const transcript = STAGES.map((name) => {
    if (STAGES.indexOf(name) < STAGES.indexOf(stage)) {
      return { stage: name, status: "ok", detail: "" };
    }
    if (name === stage) return { stage: name, status: "failed", detail };
    return { stage: name, status: "skipped", detail: "" };
  });
  release.state = "failed";
  release.failure = { stage, reason, detail };
  releases.push(release);
  recordTranscript(release, transcript);
  return { status: 422, body: { release: publicRelease(release), transcript } };
}

/**
 * Run the pipeline against the manifest as it is on disk right now.
 *
 * A refused deploy is a normal outcome and answers 422 with the stage that
 * refused: a 5xx would say the platform broke when what happened is that the
 * release was wrong. The previous live release keeps serving throughout; only a
 * promote that completes replaces it.
 */
function deploy() {
  releaseCounter += 1;
  const release = {
    id: `rel-${releaseCounter}`,
    artifact: null,
    state: "failed",
    createdAt: new Date().toISOString(),
    generation: 0,
    keyBinding: null,
    title: null,
    receipt: null,
    failure: null,
  };

  const manifest = readManifest();
  if (!manifest.ok) return failedAt(release, "read-manifest", manifest.reason, manifest.detail);
  release.artifact = manifest.value.artifact;

  if (!artifacts.some((entry) => entry.id === manifest.value.artifact)) {
    return failedAt(release, "resolve-artifact", "unknown_artifact", `${manifest.value.artifact} is not in this registry`);
  }

  const config = resolveConfig(manifest.value.env);
  if (!config.ok) return failedAt(release, "resolve-config", config.reason, config.detail);
  release.keyBinding = config.value.keyBinding;
  release.title = config.value.title;
  if (config.value.keyBinding === "literal") literalKeys.set(release.id, config.value.key);

  // start: the release becomes a candidate, at the generation it would take.
  release.generation = generation + 1;

  // health-gate: the platform checks the candidate itself, with the store as it
  // is now. A freshly copied key passes here — which is exactly why the failure
  // it causes arrives later, and why this problem exists.
  const candidateKey = release.keyBinding === "reference" ? currentSecret(SECRET_NAME) : literalKeys.get(release.id);
  if (!sameSignature(sign(candidateKey ?? "", release), sign(currentSecret(SECRET_NAME), release))) {
    literalKeys.delete(release.id);
    return failedAt(release, "health-gate", "signature_rejected", `${release.id} could not sign a response this platform accepts`);
  }

  // promote
  const previous = liveRelease();
  if (previous !== null) previous.state = "superseded";
  generation = release.generation;
  release.state = "live";
  release.receipt = receiptFor(release.id, release.artifact, release.generation);
  issuedReceipts.add(release.receipt);
  liveId = release.id;
  releases.push(release);
  recordTranscript(
    release,
    STAGES.map((name) => ({ stage: name, status: "ok", detail: "" })),
  );
  return { status: 201, body: { release: publicRelease(release), transcript: transcripts.get(release.id) } };
}

/** A release record as every surface serves it. Never carries a key value. */
function publicRelease(release) {
  return {
    id: release.id,
    artifact: release.artifact,
    state: release.state,
    createdAt: release.createdAt,
    generation: release.generation,
    keyBinding: release.keyBinding,
    title: release.title,
    receipt: release.receipt,
    failure: release.failure,
  };
}

function removeRelease(id) {
  const index = releases.findIndex((release) => release.id === id);
  if (index === -1) return null;
  const [removed] = releases.splice(index, 1);
  literalKeys.delete(id);
  transcripts.delete(id);
  if (liveId === id) {
    // Deleting what is serving is permitted on purpose. The platform does not
    // decide for the participant; it shows them the outage and lets them fix it.
    liveId = null;
    lastServedOk = null;
    log("warn", `site down: no live release (removed ${id})`);
  }
  log("info", `release removed id=${id}`);
  return removed;
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

/**
 * Every URL on these pages is relative, like the board's own. Both surfaces are
 * reached through a forwarded port in Codespaces and through loopback locally,
 * and a hard-coded `http://127.0.0.1:...` would work in exactly one of those.
 */
function shipyardPage() {
  const verdict = siteVerdict();
  const rows = releases
    .map(
      (release) => `<tr><td><code>${escapeHtml(release.id)}</code></td>
    <td>${escapeHtml(release.state)}${release.id === liveId ? " ←" : ""}</td>
    <td><code>${escapeHtml(release.artifact ?? "-")}</code></td>
    <td>${escapeHtml(release.keyBinding ?? "-")}</td>
    <td>${escapeHtml(release.title ?? "-")}</td>
    <td><code>${escapeHtml(release.receipt ?? "-")}</code></td>
    <td>${escapeHtml(release.failure === null ? "-" : `${release.failure.stage}: ${release.failure.reason}`)}</td></tr>`,
    )
    .join("\n");
  const artifactRows = artifacts
    .map(
      (artifact) =>
        `<tr><td><code>${escapeHtml(artifact.id)}</code></td><td>${escapeHtml(artifact.stage)}</td><td>${escapeHtml(artifact.builtAt)}</td></tr>`,
    )
    .join("\n");
  return `<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Shipyard</title></head>
<body style="font-family:system-ui;max-width:56rem;margin:2.5rem auto;line-height:1.7;padding:0 1rem">
<h1>Shipyard</h1>
<p>リリース基盤の運用コンソールです。 公開側の入口は <a href="site">/site</a>。</p>

<h2>artifacts (ビルド済み)</h2>
<table border="1" cellpadding="6" cellspacing="0"><tr><th>id</th><th>stage</th><th>builtAt</th></tr>
${artifactRows}</table>

<h2>releases</h2>
<table border="1" cellpadding="6" cellspacing="0"><tr><th>id</th><th>state</th><th>artifact</th><th>key</th><th>title</th><th>receipt</th><th>failure</th></tr>
${rows}</table>
<p>live: <code>${escapeHtml(liveId ?? "none")}</code> / generation: <code>${generation}</code></p>

<h2>published site</h2>
<p>verdict: <code>${verdict.status}</code>${verdict.status === 200 ? "" : ` <code>${escapeHtml(verdict.body.error)}</code>`}</p>
<p>いまの live release に対して <code>/site</code> が 200 を返した実績: <strong>${servedCurrent() ? "あり" : "まだ"}</strong></p>

<h2>secrets</h2>
<p><code>${escapeHtml(SECRET_NAME)}</code> version <code>${secretStore.get(SECRET_NAME).version}</code></p>
<p>中身は <code>GET /shipyard/secrets/value?name=...</code> で読めます (読んだことはログに残ります)。 入れ替えは <code>POST /shipyard/secrets/rotate</code>。</p>

<h2>manifest</h2>
<p><a href="../docs"><code>${SETTINGS_LABEL}</code> を API コンソールで変更</a>します。 リポジトリのファイルは書き換えません。</p>
<pre>{
  "artifact": "&lt;registry にある artifact の id&gt;",
  "env": {
    "BOARD_PUBLIC_TITLE": "&lt;公開側に出す見出し&gt;",
    "BOARD_SIGNING_KEY":  "&lt;鍵そのもの&gt;"   または   { "fromSecret": "&lt;secret store の名前&gt;" }
  }
}</pre>
<p>ここに書いていないキーは受け付けません。</p>

<h2>この基盤でできること</h2>
<pre>GET    shipyard/artifacts        ビルド済み artifact の一覧
GET    shipyard/releases         リリース記録の一覧
GET    shipyard/release?id=rel-1 1 件と、 stage ごとの経過
POST   shipyard/releases         いまの manifest でデプロイする
DELETE shipyard/release?id=rel-1 リリース記録を消す
GET    shipyard/secrets          secret の名前と version
GET    shipyard/secrets/value    secret の中身を読む (読んだことはログに残ります)
POST   shipyard/secrets/rotate   secret を 1 つ入れ替える
GET    shipyard/state            いまの状態のまとめ
GET    site                      公開側の入口
GET    site/healthz              公開側のヘルスチェック</pre>
</body></html>`;
}

function sitePage(verdict) {
  if (verdict.status !== 200) {
    return `<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><title>service unavailable</title></head>
<body style="font-family:system-ui;max-width:40rem;margin:3rem auto;padding:0 1rem">
<h1>503</h1><p><code>${escapeHtml(verdict.body.error)}</code></p>
<p>${escapeHtml(verdict.body.detail ?? "")}</p>
</body></html>`;
  }
  return `<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(verdict.body.title)}</title></head>
<body style="font-family:system-ui;max-width:40rem;margin:3rem auto;line-height:1.7;padding:0 1rem">
<h1>${escapeHtml(verdict.body.title)}</h1>
<p>public serial: <code>${escapeHtml(verdict.body.publicSerial)}</code></p>
<p>release <code>${escapeHtml(verdict.body.releaseId)}</code> / generation <code>${verdict.body.generation}</code></p>
<p><a href="site/healthz">healthz</a></p>
</body></html>`;
}

/** Requests the scorer makes are excluded from the "it really served" record. */
const SCORER_HEADER = "x-shipyard-scorer";

function noteServed(request, verdict) {
  if (verdict.status !== 200) return;
  if (request.headers[SCORER_HEADER] !== undefined) return;
  const release = liveRelease();
  if (release === null) return;
  lastServedOk = { releaseId: release.id, generation: release.generation };
}

export const routes = {
  "GET /shipyard": (request, response) => sendHtml(response, 200, shipyardPage()),

  "GET /shipyard/artifacts": (request, response) => sendJson(response, 200, { artifacts }),

  "GET /shipyard/releases": (request, response) =>
    sendJson(response, 200, {
      live: liveId,
      generation,
      releases: releases.map(publicRelease),
    }),

  "GET /shipyard/release": (request, response, url) => {
    const id = url.searchParams.get("id") ?? "";
    const release = releases.find((entry) => entry.id === id);
    if (release === undefined) return sendJson(response, 404, { error: "unknown_release", id });
    return sendJson(response, 200, {
      release: publicRelease(release),
      transcript: transcripts.get(id) ?? [],
    });
  },

  "POST /shipyard/releases": (request, response) => {
    // Drained rather than read: the manifest comes from the file, never from the
    // request, and an unread body leaves the socket waiting on a client that has
    // already finished talking.
    request.resume();
    const result = deploy();
    return sendJson(response, result.status, result.body);
  },

  "DELETE /shipyard/release": (request, response, url) => {
    const id = url.searchParams.get("id") ?? "";
    const removed = removeRelease(id);
    if (removed === null) return sendJson(response, 404, { error: "unknown_release", id });
    return sendJson(response, 200, { removed: publicRelease(removed), live: liveId });
  },

  "GET /shipyard/secrets": (request, response) =>
    sendJson(response, 200, {
      secrets: [...secretStore.entries()].map(([name, entry]) => ({
        name,
        version: entry.version,
        rotatedAt: entry.rotatedAt,
      })),
    }),

  /**
   * Reading a secret's value out of the store.
   *
   * Deliberately available, and deliberately logged. An operator with access to
   * a secret store can always read what is in it — that is how a value ends up
   * pasted into a deployment in the first place. A model that made the shortcut
   * impossible would not be modelling anything; the shortcut has to be within
   * reach, and it has to cost something later.
   */
  "GET /shipyard/secrets/value": (request, response, url) => {
    const name = url.searchParams.get("name") ?? SECRET_NAME;
    const entry = secretStore.get(name);
    if (entry === undefined) return sendJson(response, 404, { error: "unknown_secret", name });
    log("warn", `secret value read name=${name} version=${entry.version}`);
    return sendJson(response, 200, {
      name,
      version: entry.version,
      value: secretValue(name, entry.version),
    });
  },

  "POST /shipyard/secrets/rotate": (request, response, url) => {
    request.resume();
    const name = url.searchParams.get("name") ?? SECRET_NAME;
    const entry = secretStore.get(name);
    if (entry === undefined) return sendJson(response, 404, { error: "unknown_secret", name });
    entry.version += 1;
    entry.rotatedAt = new Date().toISOString();
    log("info", `secret rotated name=${name} version=${entry.version}`);
    const after = siteVerdict();
    if (after.status !== 200) log("warn", `site degraded after rotation: ${after.body.error}`);
    return sendJson(response, 200, { name, version: entry.version, site: after.status });
  },

  "GET /shipyard/state": (request, response) => {
    const verdict = siteVerdict();
    return sendJson(response, 200, {
      manifestPath: SETTINGS_LABEL,
      live: liveId,
      generation,
      releaseCount: releases.length,
      secret: { name: SECRET_NAME, version: secretStore.get(SECRET_NAME).version },
      site: {
        status: verdict.status,
        error: verdict.status === 200 ? null : verdict.body.error,
        answeredForCurrentRelease: servedCurrent(),
      },
      // The origin re-verifying what the site publishes, against the store as it
      // is now. This is the check the 503 comes from, shown rather than implied.
      signature: {
        published: verdict.status === 200 ? verdict.body.signature.slice(0, 16) : null,
        accepted: verdict.status === 200,
      },
    });
  },

  "GET /site": (request, response) => {
    const verdict = siteVerdict();
    noteServed(request, verdict);
    return sendHtml(response, verdict.status, sitePage(verdict));
  },

  "GET /site/healthz": (request, response) => {
    const verdict = siteVerdict();
    noteServed(request, verdict);
    return sendJson(response, verdict.status, verdict.body);
  },
};

// ---------------------------------------------------------------------------
// posture
// ---------------------------------------------------------------------------

export const gateTokens = true;

export function postureContext() {
  return {
    ship: {
      siteStatus: siteVerdict().status,
      wouldSurvive: wouldSurviveRotation(),
      servedCurrent: servedCurrent(),
      onlyLiveRemains:
        releases.length === 1 && liveId !== null && releases[0].id === liveId,
    },
  };
}

/**
 * Three gates, each of which can be true while the other two are false, so the
 * sign-off conjunction says three separate things rather than one thing three
 * times. A gate that is implied by another is a gate that cannot be raised on
 * its own in a test, and a sign-off nobody can decompose is a sign-off nobody
 * can trust.
 */
export const gates = {
  /** The published site was asked, by somebody other than the scorer, and answered 200. */
  site_serving: (context) => context.ship.siteStatus === 200 && context.ship.servedCurrent === true,
  /** ...and it will still be answering after the next key rotation. */
  survives_key_rotation: (context) =>
    context.ship.siteStatus === 200 && context.ship.wouldSurvive === true,
  /**
   * ...and exactly one release record is left in the plane, and it is the one
   * that is live.
   *
   * Not merely `length === 1`: the plane ships with one record already in it,
   * the predecessor's abandoned attempt, so counting alone would be true before
   * the participant did anything and false only in the middle. Requiring the
   * survivor to be the live one also means the shortest path to "one release" —
   * delete them all — cannot satisfy it, and neither can deleting everything
   * except a dead record.
   */
  single_release: (context) => context.ship.onlyLiveRemains === true,
};

// ---------------------------------------------------------------------------
// checkpoints
// ---------------------------------------------------------------------------

const SITE_PORT = Number(process.env.CHALLENGE_PORT ?? 8080);

/**
 * Ask the published site over real HTTP, from inside this process.
 *
 * A checkpoint that read `siteVerdict()` directly would grade a data structure:
 * it would say the site is healthy while nothing was listening on the route at
 * all. This sends an actual request to the actual listener, on the port the app
 * was told to listen on rather than a constant that would be wrong the moment
 * anything ran it on another port.
 *
 * It is a GET, so it destroys nothing, and it carries the scorer header so
 * answering a checkpoint cannot raise the `site_serving` gate on the
 * participant's behalf.
 */
async function probeSite() {
  try {
    const response = await fetch(`http://127.0.0.1:${SITE_PORT}/site/healthz`, {
      headers: { [SCORER_HEADER]: "1" },
    });
    const text = await response.text();
    let body = {};
    try {
      body = JSON.parse(text);
    } catch {
      body = {};
    }
    return { status: response.status, body };
  } catch {
    return null;
  }
}

/** The site is answering, now, with the serial only it can produce. */
async function siteIsAnswering() {
  const probe = await probeSite();
  return probe !== null && probe.status === 200 && probe.body.publicSerial === PUBLIC_SERIAL;
}

const matches = (submission, expected) => submission.trim() === expected;

function gateState() {
  return posture({ gates, gateTokens: true }, postureContext());
}

export const checks = {
  /**
   * What is there to ship. The registry is asked; the id is seed-derived and
   * appears in no committed file, and the id the manifest ships with belongs to
   * a build that happened on somebody else's machine.
   */
  "built-artifact": (submission) => matches(submission, ARTIFACT_ID),

  /**
   * A receipt exists only because a promote stage ran. Graded against every
   * receipt this container has issued rather than only the live one: the
   * expected play is several deploys, and a participant who reads the right
   * value off an earlier promote line has still done the thing being measured.
   */
  "release-receipt": (submission) => {
    const wanted = submission.trim();
    return wanted !== "" && issuedReceipts.has(wanted);
  },

  /**
   * The published site's heading comes from the live release's environment, not
   * from `config/app.json` — so this passes only if a deploy carried the value
   * there. The site is asked over HTTP for what it is actually serving; the
   * title the manifest shipped with is not credited, because a release still
   * carrying it has not been through the participant's hands.
   */
  "published-title": async (submission) => {
    const wanted = submission.trim();
    if (wanted === "" || wanted === LAPTOP_TITLE) return false;
    const probe = await probeSite();
    if (probe === null || probe.status !== 200) return false;
    if (probe.body.publicSerial !== PUBLIC_SERIAL) return false;
    return probe.body.title === wanted;
  },

  /**
   * Two facts, measured in order, and a receipt for the second.
   *
   * First the site must actually be answering — a release that is missing,
   * deleted or already rejected fails here, so "take the feature out and nothing
   * can go stale" cannot pass. Then the live release must still resolve a key
   * the platform accepts one rotation from now, which is only true of a release
   * that resolves by reference.
   *
   * Nothing here rotates anything. The store moves only when the participant
   * moves it, so being scored can neither break their site nor be replayed into
   * a second rotation by a retried request.
   */
  "rotation-survives": async (submission) => {
    if (!(await siteIsAnswering())) return false;
    const state = gateState();
    if (state.gates.survives_key_rotation !== true) return false;
    return matches(submission, gateToken("survives_key_rotation"));
  },

  /**
   * The cutover sign-off. `/posture` withholds `readyToken` until all three
   * gates are green, and this re-derives the whole conjunction plus its own live
   * probe rather than trusting a token the participant saw earlier: deleting
   * every release makes "one release" false rather than trivially true, and
   * takes the site down, which the probe sees.
   */
  "clean-cutover": async (submission) => {
    if (!(await siteIsAnswering())) return false;
    const state = gateState();
    return state.ready === true && matches(submission, READY_TOKEN);
  },
};
