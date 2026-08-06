import { createHash, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { readOverride } from "../overrides.mjs";
import { posix } from "node:path";
import { addPost, validatePost } from "../board.mjs";
import { readConfig } from "../config.mjs";
import { log } from "../log.mjs";
import { gateToken } from "../secrets.mjs";

/**
 * The recover scenario: last night's hardening landed, and this morning the
 * board is unreachable and a scheduled job has stopped writing.
 *
 * Everything this problem adds lives in this module. The shared base gives it
 * routes, gates, gate receipts and checkpoint handlers, and that is all it gets;
 * the board itself is untouched, which is why a participant who learned it in
 * onboarding still knows it here.
 *
 * The model is small and honest about being a model. There is no load balancer,
 * no IAM, and no cloud account. What there is:
 *
 *   edge      `/edge/*` — the public entrance in front of the board. The auth
 *             rule from last night's deploy is applied here, in front of every
 *             path it covers, including the health path.
 *   watchdog  the thing that decides whether the edge sends traffic to the
 *             board at all. It asks `/edge/healthz` over real loopback HTTP and
 *             drains the board's public paths while that answer is not 200.
 *   ops       `/ops/*` — the control plane. Separate from the edge on purpose
 *             (an operator does not lose the console when the public entrance
 *             stops answering), so a participant is never locked out.
 *   digest    a scheduled job that writes one file, and refuses to write
 *             outside the prefixes the policy declares it may write to.
 *   policy    `policy.json` in the participant's checkout — the file last
 *             night's deploy edited, re-read on every request.
 *
 * The two chains the problem is about, and what each one is standing in for:
 *
 *   auth covers the health path  ->  the watchdog fails      ->  traffic drains
 *       (an ALB health check hitting a route that now demands a token, and the
 *        target group taking the target out of service.)
 *
 *   write permission narrowed    ->  a required job cannot write its output
 *       (an IAM policy tightened to the wrong prefix. Modelled as a declarative
 *        allow-list the app itself checks before writing, because there is no
 *        IAM here and file mode bits are meaningless to a root CI runner. The
 *        refusal is a real refusal, the permitted write is a real
 *        `writeFileSync`, and widening the allow-list is caught the same way a
 *        review would catch it.)
 *
 * Restarting the worker does not help: the policy is read from disk every time,
 * so a restart replays exactly the same failure — and the restart ledger keeps
 * the evidence that it was tried.
 */

const FLAG_SEED = process.env.FLAG_SEED ?? "local-dev-seed";

/**
 * Every unguessable value this scenario mints, namespaced under `recover:` so it
 * can never collide with the board's own derivations in `secrets.mjs` or with
 * another scenario's.
 */
function recoverDigest(namespace) {
  return createHash("sha256").update(`recover:${namespace}:${FLAG_SEED}`).digest("hex");
}

/** The port the board is listening on — never a constant, or a test run on another port breaks. */
const PORT = Number(process.env.CHALLENGE_PORT ?? 8080);

/** The policy file this scenario owns, and the path of it in the participant's checkout. */
const POLICY_PATH = process.env.RECOVER_POLICY ?? "/app/policy/policy.json";

/** この scenario の設定の上書き名 (置き場と挙動は `overrides.mjs`)。 */
const SETTINGS_NAME = "policy";
const POLICY_HINT = process.env.RECOVER_POLICY_HINT ?? POLICY_PATH;
const SETTINGS_LABEL = "/api/settings";

/** Where the app is allowed to write, if the policy lets it. */
const STATE_DIR = normalizePath(process.env.RECOVER_STATE_DIR ?? "/app/state");
/**
 * Where the state directory shows up in the *participant's checkout*, which is
 * not the path the app writes to or the path the policy has to name. Display
 * only, exactly like `CONFIG_HINT` on the board.
 */
const STATE_HINT = process.env.RECOVER_STATE_HINT ?? STATE_DIR;
const DIGEST_DIR = `${STATE_DIR}/digest`;
const DIGEST_FILE = `${DIGEST_DIR}/latest.json`;

/**
 * Paths the digest job never needs and must never be permitted to write.
 *
 * They are the width assertion behind `scope_narrow`: a policy wide enough to
 * admit any of them is wider than the job needs, whatever else it also admits.
 * Three of the four names are seed-derived so a solution cannot be written
 * against a literal read out of this repository, and the fourth walks back out
 * of the digest directory with `..` so the check has to normalise before it
 * compares — a prefix test that does not would admit it.
 */
const CANARIES = [
  "/app/config/app.json",
  `${STATE_DIR}/quarantine/${recoverDigest("canary-quarantine").slice(0, 8)}.bin`,
  `${STATE_DIR}/${recoverDigest("canary-credentials").slice(0, 8)}-credentials.json`,
  `${DIGEST_DIR}/../${recoverDigest("canary-escape").slice(0, 8)}-escape.txt`,
];

/**
 * The subsystems the ops plane reports on, and the only names the signature
 * oracle accepts. Listed on the console and in the oracle's own 400 response.
 */
const SUBSYSTEMS = [
  "digest-job",
  "edge-auth",
  "health-probe",
  "policy-loader",
  "public-read",
  "public-write",
];

/** A request the scorer or the watchdog made, so a probe cannot pass for participant traffic. */
const PROBE_HEADER = "x-recover-probe";

/**
 * The authors the probe writes under. Seed-derived, so a policy or a patched
 * app cannot allow-list the values this scenario probes with.
 */
const PROBE_ANON_AUTHOR = `probe-anon-${recoverDigest("probe-anon").slice(0, 8)}`;
const PROBE_AUTH_AUTHOR = `probe-auth-${recoverDigest("probe-auth").slice(0, 8)}`;

/** How long the recovery clock is reported against. Feedback, never a pass condition. */
const RECOVERY_BUDGET_SECONDS = Number(process.env.RECOVER_BUDGET_SECONDS ?? 900);

/** The one automatic probe, so the failure reproduces with nobody touching anything. */
const BOOT_PROBE_MS = Number(process.env.RECOVER_BOOT_PROBE_MS ?? 250);

/** The token last night's deploy set. Anything shorter or this literal is not a token. */
const MIN_TOKEN_LENGTH = 8;
const PLACEHOLDER_TOKEN = "change-me";

export const seedPosts = [
  {
    author: "cto",
    title: "昨夜のデプロイ、 戻さないで直してください",
    body: "投稿に認証を付けて、 アプリの書き込み権限を絞りました。 今朝から掲示板が開きません。 昨夜の対策を外して開けるのは復旧に数えません。 なぜ止まったのかを朝会で説明できる形にしておいてください。",
    at: "2026-04-08T09:12:00.000Z",
  },
  {
    author: "sre-predecessor",
    title: "引き継ぎ: 昨夜の変更は policy.json 1 枚",
    body: "認証の適用範囲と、 アプリが書いてよい場所は policy.json に書きました。 反映は再起動不要、 呼ぶたびに読み直します。 運用面 (/ops) は公開側とは別系統なので、 公開側が落ちても触れます。",
    at: "2026-04-08T08:05:00.000Z",
  },
];

// ---------------------------------------------------------------------------
// paths
// ---------------------------------------------------------------------------

/** Resolve `.`/`..`, collapse repeats, drop a trailing slash. `/` stays `/`. */
function normalizePath(path) {
  const resolved = posix.normalize(`/${String(path)}`).replace(/\/+$/, "");
  return resolved === "" ? "/" : resolved;
}

/**
 * Does an allow-list of prefixes permit writing this path?
 *
 * The exact prefix itself counts, so declaring the directory the job writes to
 * admits that directory. Anything else has to be a strict descendant, and both
 * sides are normalised first so `dir/../elsewhere` is compared as `elsewhere`.
 */
function admits(prefixes, path) {
  const target = normalizePath(path);
  return prefixes.some((entry) => {
    const prefix = normalizePath(entry);
    return prefix === "/" || target === prefix || target.startsWith(`${prefix}/`);
  });
}

// ---------------------------------------------------------------------------
// the policy file
// ---------------------------------------------------------------------------

/**
 * A stable fingerprint of what the policy *says*, not of how it is typed.
 *
 * Reformatting the file, reordering its keys, or reordering the entries of a
 * list must not rotate the revision: several things here are keyed on "the
 * policy has not changed since", and an editor's format-on-save silently
 * invalidating a participant's restart would be an invisible trap.
 */
function canonical(value) {
  if (Array.isArray(value)) return [...value.map(canonical)].sort(compareCanonical);
  if (value !== null && typeof value === "object") {
    const out = {};
    for (const key of Object.keys(value).sort()) out[key] = canonical(value[key]);
    return out;
  }
  return value;
}

const compareCanonical = (left, right) =>
  JSON.stringify(left) < JSON.stringify(right) ? -1 : 1;

function revisionOf(value) {
  return createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex").slice(0, 12);
}

const POLICY_FALLBACK = {
  auth: { requireToken: false, token: "", protect: [] },
  storage: { writable: [] },
  digest: { enabled: false },
};

function stringList(raw, where, problems) {
  if (!Array.isArray(raw)) {
    problems.push(`${where} must be an array of strings`);
    return null;
  }
  for (const entry of raw) {
    if (typeof entry !== "string" || entry.trim() === "") {
      problems.push(`${where} must contain non-empty strings only`);
      return null;
    }
  }
  return raw.map((entry) => entry.trim());
}

/**
 * Read and validate the policy as it is on disk right now.
 *
 * Unknown keys are refused rather than ignored, exactly the way `config.mjs`
 * refuses an unknown setting: a policy that silently drops half of what it
 * declares is how a deploy "succeeds" and protects nothing.
 */
function readPolicy(path = POLICY_PATH) {
  let text;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    return policyError(`cannot read ${POLICY_HINT}: ${error.code ?? error.message}`);
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
    // マウント元は出発点。 実行中に変えた分を重ねてから検証する (置き場は overrides.mjs)。
    if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
      parsed = { ...parsed, ...readOverride(SETTINGS_NAME) };
    }
  } catch (error) {
    return policyError(`${POLICY_HINT} is not valid JSON: ${error.message}`);
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return policyError(`${POLICY_HINT} must contain a JSON object`);
  }

  const problems = [];
  for (const key of Object.keys(parsed)) {
    if (!["auth", "storage", "digest"].includes(key)) {
      problems.push(`${key} is not a section this app reads`);
    }
  }
  const auth = parsed.auth;
  const storage = parsed.storage;
  const digest = parsed.digest;
  for (const [name, section] of [
    ["auth", auth],
    ["storage", storage],
    ["digest", digest],
  ]) {
    if (section === null || typeof section !== "object" || Array.isArray(section)) {
      problems.push(`${name} must be an object`);
    }
  }
  if (problems.length > 0) return policyError(problems.join("; "));

  for (const [section, allowed] of [
    [auth, ["requireToken", "token", "protect"]],
    [storage, ["writable"]],
    [digest, ["enabled"]],
  ]) {
    for (const key of Object.keys(section)) {
      if (!allowed.includes(key)) problems.push(`${key} is not a setting this app reads`);
    }
  }
  if (typeof auth.requireToken !== "boolean") problems.push("auth.requireToken must be boolean");
  if (typeof auth.token !== "string") problems.push("auth.token must be a string");
  if (typeof digest.enabled !== "boolean") problems.push("digest.enabled must be boolean");
  const protect = stringList(auth.protect, "auth.protect", problems);
  const writable = stringList(storage.writable, "storage.writable", problems);
  if (problems.length > 0) return policyError(problems.join("; "));

  const value = {
    auth: { requireToken: auth.requireToken, token: auth.token, protect },
    storage: { writable },
    digest: { enabled: digest.enabled },
  };
  if (lastPolicyError !== null) {
    lastPolicyError = null;
    log("info", "policy reloaded cleanly");
  }
  return { ok: true, value, error: null, revision: revisionOf(value) };
}

let lastPolicyError = null;

/** Log a policy failure once per distinct message, so a reload loop cannot flood the ring. */
function policyError(error) {
  if (lastPolicyError !== error) {
    lastPolicyError = error;
    log("error", `policy error: ${error}`);
  }
  return { ok: false, value: POLICY_FALLBACK, error, revision: "unreadable" };
}

const currentRevision = () => readPolicy().revision;

// ---------------------------------------------------------------------------
// the edge
// ---------------------------------------------------------------------------

/** The watchdog's view of the board. Cleared by a restart, never by an edit. */
const watchdog = { shedding: false, consecutiveFailures: 0, lastStatus: null, lastAt: null };

/**
 * Probe writes, kept here instead of on the board.
 *
 * Everything that decides whether the write is *allowed* — draining, the auth
 * rule, whether the board is accepting posts, and the board's own field
 * validation — is the same code path a participant's write takes; only the
 * final destination differs, so a probe every time somebody asks for status
 * cannot bury the board's posts or pollute `participantPosts()`.
 */
const probeLedger = [];
const PROBE_LEDGER_MAX = 5;
let probeLedgerId = 0;

function pathIsProtected(policy, pathname) {
  if (policy.auth.requireToken !== true) return false;
  const target = normalizePath(pathname);
  return policy.auth.protect.some((entry) => {
    const prefix = normalizePath(entry);
    return prefix === "/" || target === prefix || target.startsWith(`${prefix}/`);
  });
}

function presentedToken(request) {
  const authorization = request.headers.authorization;
  if (typeof authorization === "string" && authorization.startsWith("Bearer ")) {
    return authorization.slice("Bearer ".length).trim();
  }
  const header = request.headers["x-board-token"];
  return typeof header === "string" ? header.trim() : "";
}

function sameToken(left, right) {
  const a = Buffer.from(left, "utf8");
  const b = Buffer.from(right, "utf8");
  return a.length === b.length && a.length > 0 && timingSafeEqual(a, b);
}

/**
 * The one auth decision, applied in front of every path the policy covers.
 *
 * There is no carve-out for the health path and none for the read path. Adding
 * one is the participant's job, and doing it in the policy rather than in the
 * app is the point: an exception compiled into the edge is an exception nobody
 * reviews.
 */
function authorize(request, policy, pathname) {
  if (!pathIsProtected(policy, pathname)) return { ok: true };
  if (sameToken(presentedToken(request), policy.auth.token)) return { ok: true };
  return { ok: false };
}

function sendJson(response, status, payload) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload));
}

function sendHtml(response, status, body) {
  response.writeHead(status, { "content-type": "text/html; charset=utf-8" });
  response.end(body);
}

const MAX_BODY_BYTES = 64 * 1024;

function readJson(request) {
  return new Promise((resolve) => {
    const chunks = [];
    let bytes = 0;
    request.on("data", (chunk) => {
      bytes += chunk.length;
      if (bytes > MAX_BODY_BYTES) {
        request.pause();
        resolve(undefined);
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

/** One loopback request against this same process, over real HTTP. */
async function sample(method, path, { body, token, probe = false } = {}) {
  const headers = {};
  if (body !== undefined) headers["content-type"] = "application/json";
  if (token !== undefined) headers.authorization = `Bearer ${token}`;
  if (probe) headers[PROBE_HEADER] = "1";
  try {
    const response = await fetch(`http://127.0.0.1:${PORT}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    let parsed = null;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null;
    }
    return { status: response.status, body: parsed };
  } catch (error) {
    // Nothing listening, or the socket died. Reported as its own status rather
    // than thrown: "the entrance did not answer at all" is a measurement.
    return { status: 0, body: null, detail: String(error?.message ?? error) };
  }
}

// ---------------------------------------------------------------------------
// the scheduled job
// ---------------------------------------------------------------------------

/** The last run, and every run this container has attempted. */
const digest = { lastRun: null, runs: 0 };

/**
 * Run the digest job once, against the policy as it is on disk right now.
 *
 * Refusing to write outside the declared prefixes happens here, before the
 * write, and the refusal names the path and the setting — the same shape as an
 * `AccessDenied` in a job log, which is where a real version of this is found.
 */
function runDigest() {
  digest.runs += 1;
  const policy = readPolicy();
  const at = new Date().toISOString();
  if (!policy.ok) {
    digest.lastRun = { ok: false, at, revision: policy.revision, error: `policy_unreadable: ${policy.error}` };
    log("warn", `digest denied: the policy will not load (${policy.error})`);
    return digest.lastRun;
  }
  if (policy.value.digest.enabled !== true) {
    digest.lastRun = { ok: false, at, revision: policy.revision, error: "digest_disabled" };
    log("warn", "digest skipped: digest.enabled is false");
    return digest.lastRun;
  }
  if (!admits(policy.value.storage.writable, DIGEST_DIR)) {
    digest.lastRun = {
      ok: false,
      at,
      revision: policy.revision,
      error: `write_denied: ${DIGEST_DIR} is outside storage.writable`,
    };
    log("warn", `digest denied: ${DIGEST_DIR} is outside storage.writable`);
    return digest.lastRun;
  }
  try {
    mkdirSync(DIGEST_DIR, { recursive: true });
    writeFileSync(
      DIGEST_FILE,
      `${JSON.stringify({ generatedAt: at, revision: policy.revision, run: digest.runs }, null, 2)}\n`,
    );
  } catch (error) {
    digest.lastRun = { ok: false, at, revision: policy.revision, error: `write_failed: ${error.code ?? error.message}` };
    log("error", `digest failed: ${error.code ?? error.message}`);
    return digest.lastRun;
  }
  digest.lastRun = { ok: true, at, revision: policy.revision, error: null };
  log("info", `digest wrote ${DIGEST_FILE} revision=${policy.revision}`);
  return digest.lastRun;
}

/** The output as it is on disk, re-read rather than remembered. */
function digestOutput() {
  if (!existsSync(DIGEST_FILE)) return null;
  try {
    return JSON.parse(readFileSync(DIGEST_FILE, "utf8"));
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// incidents
// ---------------------------------------------------------------------------

/**
 * An incident opens the first time a probe finds anything down and closes when
 * a probe finds nothing down, so a container that breaks twice records two of
 * them. The set is snapshotted when the incident opens: it is the answer to
 * "what stopped", and partially fixing things afterwards must not rewrite it.
 */
const incidents = [];
let openIncident = null;

function signatureFor(subsystems) {
  const set = [...new Set(subsystems)].sort();
  return recoverDigest(`incident:${set.join(",")}`).slice(0, 12);
}

function openOrCloseIncident(down, observations, revision) {
  const at = new Date().toISOString();
  if (down.length > 0) {
    if (openIncident !== null) return;
    openIncident = {
      id: `inc-${incidents.length + 1}`,
      openedAt: at,
      openedAtMs: Date.now(),
      revisionAtOpen: revision,
      subsystems: [...down].sort(),
      signature: signatureFor(down),
      evidence: observations,
      closedAt: null,
      recoveredAfterSeconds: null,
    };
    incidents.push(openIncident);
    log("error", `incident opened id=${openIncident.id} down=${openIncident.subsystems.join(",")}`);
    return;
  }
  if (openIncident === null) return;
  openIncident.closedAt = at;
  openIncident.recoveredAfterSeconds = Math.round((Date.now() - openIncident.openedAtMs) / 1000);
  log("info", `incident closed id=${openIncident.id} afterSeconds=${openIncident.recoveredAfterSeconds}`);
  openIncident = null;
}

// ---------------------------------------------------------------------------
// the probe
// ---------------------------------------------------------------------------

/** The last probe's raw measurements, and the revision they were taken at. */
let lastProbe = null;

/**
 * Ask this app, over real HTTP, what a user and a monitor would each see.
 *
 * Nothing here is destructive: the reads are reads, and both writes carry the
 * probe header so they land in the probe ledger instead of on the board. The
 * health sample comes first because the watchdog's verdict decides whether the
 * board's public paths are being served at all, so measuring them before it
 * would report a state that no longer holds by the end of the same probe.
 */
async function runProbe() {
  const policy = readPolicy();
  const revision = policy.revision;

  const health = await sample("GET", "/edge/healthz");
  watchdog.lastStatus = health.status;
  watchdog.lastAt = new Date().toISOString();
  if (health.status === 200) {
    watchdog.consecutiveFailures = 0;
    if (watchdog.shedding) {
      watchdog.shedding = false;
      log("info", "watchdog: /edge/healthz answered 200 — the board is back in service");
    }
  } else {
    watchdog.consecutiveFailures += 1;
    if (!watchdog.shedding) {
      watchdog.shedding = true;
      log("warn", `watchdog: /edge/healthz answered ${health.status} — draining traffic from the board`);
    }
  }

  const read = await sample("GET", "/edge/board");
  const anonWrite = await sample("POST", "/edge/posts", {
    probe: true,
    body: { author: PROBE_ANON_AUTHOR, title: "anonymous write probe", body: "" },
  });
  const tokenWrite = await sample("POST", "/edge/posts", {
    probe: true,
    token: policy.value.auth.token,
    body: { author: PROBE_AUTH_AUTHOR, title: "authorised write probe", body: "" },
  });
  const landed =
    tokenWrite.status === 201 &&
    typeof tokenWrite.body?.entry?.id === "number" &&
    probeLedger.some((entry) => entry.id === tokenWrite.body.entry.id);

  const down = [];
  const observations = [];
  const note = (name, ok, detail) => {
    if (!ok) down.push(name);
    observations.push(`${name} ${ok ? "ok" : "DOWN"} (${detail})`);
  };
  note("health-probe", health.status === 200, `GET /edge/healthz -> ${health.status}`);
  note("public-read", read.status === 200, `GET /edge/board -> ${read.status}`);
  note("public-write", landed, `authorised POST /edge/posts -> ${tokenWrite.status}${landed ? "" : ", not stored"}`);
  note(
    "edge-auth",
    anonWrite.status < 200 || anonWrite.status >= 300,
    `anonymous POST /edge/posts -> ${anonWrite.status}`,
  );
  note(
    "digest-job",
    digest.lastRun !== null && digest.lastRun.ok === true && digest.lastRun.revision === revision,
    digest.lastRun === null ? "never run" : (digest.lastRun.error ?? `last run at revision ${digest.lastRun.revision}`),
  );
  note("policy-loader", policy.ok, policy.ok ? `revision ${revision}` : policy.error);

  for (const line of observations) log(line.includes(" DOWN ") ? "warn" : "info", `probe: ${line}`);

  lastProbe = {
    at: new Date().toISOString(),
    revision,
    shedding: watchdog.shedding,
    edgeHealthz: health.status,
    edgeRead: read.status,
    anonWrite: anonWrite.status,
    tokenWrite: tokenWrite.status,
    tokenWriteLanded: landed,
    policyOk: policy.ok,
    down: [...down].sort(),
  };
  openOrCloseIncident(down, observations, revision);
  return lastProbe;
}

/** The boot sequence: run the job once, then look. */
let bootRun = null;

async function bootSequence() {
  const deadline = Date.now() + 5_000;
  for (;;) {
    const alive = await sample("GET", "/healthz");
    if (alive.status !== 0) break;
    if (Date.now() > deadline) break;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  runDigest();
  await runProbe();
}

/**
 * Start the boot sequence once, and never let it reject.
 *
 * The timer below is outside every request, so a rejection escaping it would be
 * recorded as an uncaught fault and `/healthz` would answer 503 for the rest of
 * the session — the app declaring itself unwell because *scoring* stumbled.
 */
function startBoot() {
  if (bootRun === null) {
    bootRun = bootSequence().catch((error) => {
      log("error", `boot sequence failed: ${error?.message ?? error}`);
    });
  }
  return bootRun;
}

/** Probe if nothing has looked yet, so a checkpoint never grades an unmeasured app. */
function ensureProbed() {
  return lastProbe === null ? startBoot() : Promise.resolve();
}

// The one automatic action in this scenario. Without it the failure would only
// exist once somebody went looking, and "it reproduces on its own" would be a
// claim rather than something the container's own stdout shows.
const bootTimer = setTimeout(startBoot, BOOT_PROBE_MS);
bootTimer.unref?.();

// ---------------------------------------------------------------------------
// restarts
// ---------------------------------------------------------------------------

/**
 * Every worker restart this container has performed.
 *
 * A restart clears the subsystem counters and the probe history — the things a
 * restart really does clear — and clears nothing else. The incident and its
 * clock survive, because a restart is not a fix and the record of having tried
 * one is exactly what this problem is about.
 */
const ledger = [];

async function restartWorker() {
  watchdog.shedding = false;
  watchdog.consecutiveFailures = 0;
  watchdog.lastStatus = null;
  watchdog.lastAt = null;
  lastProbe = null;
  digest.lastRun = null;
  probeLedger.length = 0;

  runDigest();
  await runProbe();
  const state = snapshot();
  const entry = {
    n: ledger.length + 1,
    at: new Date().toISOString(),
    revision: currentRevision(),
    afterOk: state.serviceRestored && state.authEnforced && state.digestOk,
  };
  ledger.push(entry);
  log(
    entry.afterOk ? "info" : "warn",
    `restart: worker restarted (#${entry.n}) revision=${entry.revision} healthyAfter=${entry.afterOk}`,
  );
  return entry;
}

// ---------------------------------------------------------------------------
// measured state
// ---------------------------------------------------------------------------

function tokenLooksReal(token) {
  const value = token.trim();
  return value.length >= MIN_TOKEN_LENGTH && value !== PLACEHOLDER_TOKEN;
}

/**
 * Everything the gates read, computed from the last probe plus what is on disk
 * right now.
 *
 * Probe-derived facts are only counted while the probe was taken at the policy
 * revision in force now: an edit makes every measurement about the old policy,
 * and reporting it as current would be the oldest lie in operations.
 */
function snapshot() {
  const policy = readPolicy();
  const revision = policy.revision;
  const fresh = lastProbe !== null && lastProbe.revision === revision;
  const output = digestOutput();

  const digestOk =
    digest.lastRun !== null &&
    digest.lastRun.ok === true &&
    digest.lastRun.revision === revision &&
    output !== null &&
    output.revision === revision;

  const canariesAdmitted = policy.ok
    ? CANARIES.filter((path) => admits(policy.value.storage.writable, path)).length
    : CANARIES.length;

  const scopeNarrow =
    policy.ok && admits(policy.value.storage.writable, DIGEST_DIR) && canariesAdmitted === 0;

  const serviceRestored =
    fresh &&
    policy.ok &&
    lastProbe.shedding === false &&
    lastProbe.edgeHealthz === 200 &&
    lastProbe.edgeRead === 200;

  const authEnforced =
    fresh &&
    policy.ok &&
    policy.value.auth.requireToken === true &&
    tokenLooksReal(policy.value.auth.token) &&
    (lastProbe.anonWrite === 401 || lastProbe.anonWrite === 403) &&
    lastProbe.tokenWrite === 201 &&
    lastProbe.tokenWriteLanded === true;

  const survivedRestart =
    ledger.length > 0 &&
    ledger[ledger.length - 1].revision === revision &&
    ledger.some((entry) => entry.revision === revision && entry.afterOk === true);

  return {
    revision,
    fresh,
    policyOk: policy.ok,
    policyError: policy.error,
    canariesAdmitted,
    digestOk,
    scopeNarrow,
    serviceRestored,
    authEnforced,
    survivedRestart,
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

/** Every URL on this page is relative, like the board's own, so a forwarded origin works. */
function opsPage() {
  const state = snapshot();
  const gateRows = Object.entries({
    service_restored: state.serviceRestored,
    auth_enforced: state.authEnforced,
    digest_ok: state.digestOk,
    scope_narrow: state.scopeNarrow,
    survived_restart: state.survivedRestart,
  })
    .map(([name, ok]) => `<tr><td><code>${name}</code></td><td>${ok ? "true" : "false"}</td></tr>`)
    .join("\n");
  return `<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>ops</title></head>
<body style="font-family:system-ui;max-width:56rem;margin:2.5rem auto;line-height:1.7;padding:0 1rem">
<h1>ops</h1>
<p>公開側の入口とは別系統の運用面です。 公開側が落ちていてもここは答えます。</p>

<h2>いまの状態</h2>
<table border="1" cellpadding="6" cellspacing="0"><tr><th>gate</th><th>value</th></tr>
${gateRows}</table>
<p>policy revision: <code>${escapeHtml(state.revision)}</code> / 実測の詳細は <a href="ops/status">ops/status</a>。</p>

<h2>subsystem の名前</h2>
<p>この運用面が状態を持っている subsystem は次の 6 つです。</p>
<pre>${SUBSYSTEMS.join("\n")}</pre>
<p>集合から署名を計算させるには <code>GET ops/signature?subsystems=a,b</code>。 順不同・重複可。</p>

<h2>設定</h2>
<p>昨夜のデプロイが変えた policy は <a href="../docs"><code>${SETTINGS_LABEL}</code> を API コンソールで変更</a>します。 リポジトリのファイルは書き換えません。</p>
<pre>{
  "auth": {
    "requireToken": true,
    "token": "&lt;書き込みに要るトークン&gt;",
    "protect": ["&lt;前方一致で認証を要求するパス&gt;", "..."]
  },
  "storage": { "writable": ["&lt;アプリが書いてよいディレクトリ&gt;", "..."] },
  "digest": { "enabled": true }
}</pre>
<p>ここに書いていないキーは受け付けません。</p>
<p>定期処理の出力先は動かせません。 アプリが書く先 (= <code>storage.writable</code> に書く値と同じ体系) は
 <code>${escapeHtml(DIGEST_FILE)}</code>、 それが参加者のチェックアウトに現れる場所は
 <code>${escapeHtml(`${STATE_HINT}/digest/latest.json`)}</code> です。</p>

<h2>この運用面でできること</h2>
<pre>GET  ops/status              実測した状態のまとめ (呼ぶと 1 周プローブします)
GET  ops/incident?id=inc-1   その incident を開いたときの観測
GET  ops/signature?subsystems=a,b  subsystem 集合の署名
GET  ops/digest              定期処理の直近の実行
POST ops/probe               いますぐ 1 周プローブする
POST ops/digest/run          定期処理をいますぐ 1 回走らせる
POST ops/restart             ワーカーを再起動する (設定はディスクから読み直します)</pre>

<h2>公開側の入口</h2>
<pre>GET  edge/healthz            監視が叩く経路
GET  edge/board              公開側の読み取り
POST edge/posts              公開側の書き込み</pre>
</body></html>`;
}

function statusPayload() {
  const state = snapshot();
  const policy = readPolicy();
  const first = incidents[0] ?? null;
  const output = digestOutput();
  return {
    policy: {
      path: SETTINGS_LABEL,
      ok: policy.ok,
      error: policy.error,
      revision: state.revision,
      auth: {
        requireToken: policy.value.auth.requireToken,
        protect: policy.value.auth.protect,
        tokenLooksReal: tokenLooksReal(policy.value.auth.token),
      },
      storage: { writable: policy.value.storage.writable },
      digest: { enabled: policy.value.digest.enabled },
    },
    watchdog: {
      shedding: watchdog.shedding,
      consecutiveFailures: watchdog.consecutiveFailures,
      lastStatus: watchdog.lastStatus,
      lastAt: watchdog.lastAt,
    },
    probe:
      lastProbe === null
        ? null
        : {
            at: lastProbe.at,
            revision: lastProbe.revision,
            stale: lastProbe.revision !== state.revision,
            edgeHealthz: lastProbe.edgeHealthz,
            edgeRead: lastProbe.edgeRead,
            anonymousWrite: lastProbe.anonWrite,
            authorisedWrite: lastProbe.tokenWrite,
            authorisedWriteStored: lastProbe.tokenWriteLanded,
          },
    subsystems: Object.fromEntries(
      SUBSYSTEMS.map((name) => [
        name,
        lastProbe === null ? "unknown" : lastProbe.down.includes(name) ? "down" : "ok",
      ]),
    ),
    digest: {
      enabled: policy.value.digest.enabled,
      runs: digest.runs,
      lastRun: digest.lastRun,
      // The path the app writes, which is the path `storage.writable` is
      // compared against — and, separately, where that file turns up in the
      // participant's checkout. Printing only the second would have them write
      // a path this policy can never match.
      outputPath: DIGEST_FILE,
      outputPathInCheckout: `${STATE_HINT}/digest/latest.json`,
      outputRevision: output === null ? null : (output.revision ?? null),
    },
    storage: {
      // The count, not the paths: the width assertion is not an allow-list to
      // route around, and naming them would make it one.
      declared: policy.value.storage.writable,
      admitsDigestDirectory: policy.ok
        ? admits(policy.value.storage.writable, DIGEST_DIR)
        : false,
      forbiddenPathsAdmitted: state.canariesAdmitted,
      forbiddenPathsChecked: CANARIES.length,
    },
    incident: {
      open: openIncident === null ? null : openIncident.id,
      count: incidents.length,
      first:
        first === null
          ? null
          : {
              id: first.id,
              openedAt: first.openedAt,
              closedAt: first.closedAt,
              revisionAtOpen: first.revisionAtOpen,
            },
    },
    recovery: {
      // Reported, never a pass condition: a clock a container restart resets is
      // feedback about a rehearsal, not a measurement of one.
      budgetSeconds: RECOVERY_BUDGET_SECONDS,
      elapsedSeconds:
        openIncident === null ? null : Math.round((Date.now() - openIncident.openedAtMs) / 1000),
      recoveredAfterSeconds: first === null ? null : first.recoveredAfterSeconds,
      withinBudget:
        first === null || first.recoveredAfterSeconds === null
          ? null
          : first.recoveredAfterSeconds <= RECOVERY_BUDGET_SECONDS,
    },
    restarts: ledger,
    gates: {
      service_restored: state.serviceRestored,
      auth_enforced: state.authEnforced,
      digest_ok: state.digestOk,
      scope_narrow: state.scopeNarrow,
      survived_restart: state.survivedRestart,
    },
  };
}

/**
 * The write path, shared by participant traffic and by the probe.
 *
 * Draining, the auth rule, whether the board is accepting posts, and the
 * board's field validation are decided here for both; only where the accepted
 * write is stored depends on who asked.
 */
async function edgeWrite(request, response) {
  // Drained first, so a request that is about to be refused for any reason
  // still leaves the socket in a state the client can read an answer off.
  const body = await readJson(request);
  const policy = readPolicy();
  if (watchdog.shedding) {
    return sendJson(response, 503, {
      error: "draining",
      detail: "the watchdog has taken the board out of service — see GET /ops/status",
    });
  }
  if (!policy.ok) {
    return sendJson(response, 503, { error: "policy_unreadable", detail: policy.error });
  }
  if (!authorize(request, policy.value, "/edge/posts").ok) {
    return sendJson(response, 401, {
      error: "unauthorized",
      detail: `this path is covered by auth.protect in ${SETTINGS_LABEL}`,
    });
  }
  const config = readConfig();
  if (!config.ok) {
    return sendJson(response, 503, { error: "config_unreadable", detail: config.error });
  }
  if (config.value.acceptingPosts !== true) {
    return sendJson(response, 409, { error: "board_closed", detail: "acceptingPosts is not true" });
  }
  if (body === undefined) return sendJson(response, 413, { error: "body too large" });
  const submitted = validatePost(body);
  if (!submitted.ok) return sendJson(response, 400, { error: submitted.error });

  const at = new Date().toISOString();
  if (request.headers[PROBE_HEADER] !== undefined) {
    probeLedgerId += 1;
    const entry = { id: probeLedgerId, author: submitted.post.author, at };
    probeLedger.push(entry);
    if (probeLedger.length > PROBE_LEDGER_MAX) {
      probeLedger.splice(0, probeLedger.length - PROBE_LEDGER_MAX);
    }
    return sendJson(response, 201, { entry, store: "probe-ledger" });
  }
  const post = addPost(submitted.post, at);
  return sendJson(response, 201, { entry: { id: post.id }, post, store: "board" });
}

export const routes = {
  "GET /ops": (request, response) => sendHtml(response, 200, opsPage()),

  /**
   * Measure, then report. A status page that returns the last thing it happened
   * to remember is how an operator ends up debugging a state that stopped being
   * true ten minutes ago; probing here is four loopback GETs and two probe
   * writes, none of which touch the board or the participant's files.
   */
  "GET /ops/status": async (request, response) => {
    await runProbe();
    return sendJson(response, 200, statusPayload());
  },

  "POST /ops/probe": async (request, response) => {
    request.resume();
    await runProbe();
    return sendJson(response, 200, statusPayload());
  },

  "GET /ops/incident": (request, response, url) => {
    const id = url.searchParams.get("id") ?? "";
    const incident = incidents.find((entry) => entry.id === id);
    if (incident === undefined) {
      return sendJson(response, 404, {
        error: "unknown_incident",
        known: incidents.map((entry) => entry.id),
      });
    }
    return sendJson(response, 200, {
      id: incident.id,
      openedAt: incident.openedAt,
      closedAt: incident.closedAt,
      revisionAtOpen: incident.revisionAtOpen,
      recoveredAfterSeconds: incident.recoveredAfterSeconds,
      // What the probe saw when this incident opened, one line per subsystem.
      // The signature itself is not here: turning an observed set into it is
      // what `GET /ops/signature` is for.
      observations: incident.evidence,
    });
  },

  /**
   * The oracle: a set of subsystem names in, that set's signature out.
   *
   * It answers for any set, including sets that were never down, and it never
   * says which set actually was — that is the question, and this is the
   * calculator.
   */
  "GET /ops/signature": (request, response, url) => {
    const raw = url.searchParams.get("subsystems") ?? "";
    const names = raw
      .split(",")
      .map((name) => name.trim())
      .filter((name) => name !== "");
    if (names.length === 0) {
      return sendJson(response, 400, { error: "no_subsystems", valid: SUBSYSTEMS });
    }
    const unknown = names.filter((name) => !SUBSYSTEMS.includes(name));
    if (unknown.length > 0) {
      return sendJson(response, 400, { error: "unknown_subsystem", unknown, valid: SUBSYSTEMS });
    }
    const set = [...new Set(names)].sort();
    return sendJson(response, 200, { subsystems: set, signature: signatureFor(set) });
  },

  "GET /ops/digest": (request, response) =>
    sendJson(response, 200, {
      enabled: readPolicy().value.digest.enabled,
      runs: digest.runs,
      lastRun: digest.lastRun,
      outputPath: DIGEST_FILE,
      outputPathInCheckout: `${STATE_HINT}/digest/latest.json`,
    }),

  "POST /ops/digest/run": (request, response) => {
    request.resume();
    return sendJson(response, 200, { lastRun: runDigest() });
  },

  "POST /ops/restart": async (request, response) => {
    request.resume();
    const entry = await restartWorker();
    return sendJson(response, 200, { restart: entry, restarts: ledger.length });
  },

  "GET /edge/healthz": async (request, response) => {
    const policy = readPolicy();
    if (!policy.ok) {
      return sendJson(response, 503, { error: "policy_unreadable", detail: policy.error });
    }
    // Never drained: draining the path that decides draining is how a target
    // that went out of service never comes back.
    if (!authorize(request, policy.value, "/edge/healthz").ok) {
      return sendJson(response, 401, {
        error: "unauthorized",
        detail: `this path is covered by auth.protect in ${SETTINGS_LABEL}`,
      });
    }
    const origin = await sample("GET", "/healthz");
    return sendJson(response, origin.status === 200 ? 200 : 503, {
      ok: origin.status === 200,
      origin: origin.status,
    });
  },

  "GET /edge/board": async (request, response) => {
    const policy = readPolicy();
    if (watchdog.shedding) {
      return sendJson(response, 503, {
        error: "draining",
        detail: "the watchdog has taken the board out of service — see GET /ops/status",
      });
    }
    if (!policy.ok) {
      return sendJson(response, 503, { error: "policy_unreadable", detail: policy.error });
    }
    if (!authorize(request, policy.value, "/edge/board").ok) {
      return sendJson(response, 401, {
        error: "unauthorized",
        detail: `this path is covered by auth.protect in ${SETTINGS_LABEL}`,
      });
    }
    const origin = await sample("GET", "/api/board");
    if (origin.status !== 200) {
      return sendJson(response, 502, { error: "origin_unavailable", origin: origin.status });
    }
    return sendJson(response, 200, origin.body);
  },

  "POST /edge/posts": edgeWrite,
};

// ---------------------------------------------------------------------------
// posture
// ---------------------------------------------------------------------------

export const gateTokens = true;

export function postureContext() {
  return { recover: snapshot() };
}

/**
 * Five gates, each of which can be true while the others are false.
 *
 * A gate that is implied by another cannot be raised on its own in a test, and
 * a sign-off nobody can decompose is a sign-off nobody can trust. The paths that
 * separate them are real policies: covering only the read path leaves auth
 * enforced while the public entrance is dark, and turning the job off leaves the
 * write scope narrow while nothing is being written.
 */
export const gates = {
  /** The public entrance answers, and the watchdog is sending it traffic. */
  service_restored: (context) => context.recover.serviceRestored,
  /** An anonymous write is refused and an authorised one is accepted and stored. */
  auth_enforced: (context) => context.recover.authEnforced,
  /** The scheduled job ran under the policy in force now, and its output is on disk. */
  digest_ok: (context) => context.recover.digestOk,
  /** The write allow-list covers the job's directory and nothing it must never touch. */
  scope_narrow: (context) => context.recover.scopeNarrow,
  /** A restart under this policy came back healthy, and nothing has been edited since. */
  survived_restart: (context) => context.recover.survivedRestart,
};

// ---------------------------------------------------------------------------
// checkpoints
// ---------------------------------------------------------------------------

const matches = (submission, expected) => submission.trim() === expected;

export const checks = {
  /**
   * What stopped. The answer is the signature of the set of subsystems that were
   * down when this container's *first* incident opened — snapshotted then, so
   * fixing things afterwards neither changes it nor destroys it.
   *
   * An untouched starter fails: the value is seed-derived, appears in no
   * committed file and on no surface, and the oracle only computes it for
   * somebody who already knows which six names to hand it.
   */
  "incident-scope": async (submission) => {
    await ensureProbed();
    const first = incidents[0];
    return first !== undefined && matches(submission, first.signature);
  },

  /**
   * The board is publicly readable again *and* last night's rule still holds.
   *
   * Both halves are re-measured over real HTTP at the moment this is answered,
   * so a receipt collected while it was true is not a receipt for now: taking
   * the auth rule back out to make something else easier drops the gate and the
   * same submission stops being accepted.
   */
  "board-back": async (submission) => {
    await runProbe();
    const state = snapshot();
    if (!state.serviceRestored || !state.authEnforced) return false;
    return matches(submission, gateToken("auth_enforced"));
  },

  /**
   * The scheduled job writes again — proved by running it, at the policy in
   * force now, and reading its output back off disk.
   *
   * Silencing the job rather than fixing what it hit fails here: a run that did
   * not happen leaves no output, and an output left over from an earlier policy
   * carries the earlier revision.
   */
  "job-restored": async (submission) => {
    runDigest();
    if (!snapshot().digestOk) return false;
    return matches(submission, gateToken("digest_ok"));
  },

  /**
   * ...and it was given the room it needs and no more.
   *
   * The width assertion is second on purpose. On its own it is satisfied by an
   * app that writes nothing at all, so the run above has to succeed first —
   * "nothing was over-permitted" is only worth anything once the thing the
   * permission is for demonstrably works.
   */
  "least-privilege-held": async (submission) => {
    runDigest();
    const state = snapshot();
    if (!state.digestOk) return false;
    if (!state.scopeNarrow) return false;
    return matches(submission, gateToken("scope_narrow"));
  },

  /**
   * It stays fixed across a restart.
   *
   * All five gates, re-measured, plus a ledger entry proving a restart under
   * this exact policy revision came back healthy — and that nothing has been
   * edited since. A restart taken before the fix carries a different revision
   * and does not count, which is what makes "I restarted it and it went away"
   * unable to answer this.
   */
  "no-recurrence": async (submission) => {
    runDigest();
    await runProbe();
    const state = snapshot();
    if (
      !state.serviceRestored ||
      !state.authEnforced ||
      !state.digestOk ||
      !state.scopeNarrow ||
      !state.survivedRestart
    ) {
      return false;
    }
    return matches(submission, gateToken("survived_restart"));
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
  summary: { ja: "復旧ポリシー", en: "recovery policy" },
  example: {"enabled": true},
  read: () => readPolicy(),
};
