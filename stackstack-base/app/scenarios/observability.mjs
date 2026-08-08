import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { readOverride } from "../overrides.mjs";
import { allPosts } from "../board.mjs";
import { log, recentLines } from "../log.mjs";
import { posture } from "../posture.mjs";
import { gateToken } from "../secrets.mjs";

/**
 * The observability scenario: the board is losing writes downstream, the
 * dashboard is green, and the app is not saying anything about either.
 *
 * Everything this problem adds lives in this module. The shared base gives it
 * routes, gates, gate receipts and checkpoint handlers, and that is all it gets:
 * a metrics registry and a second health predicate that only one problem uses do
 * not belong in a board eight problems share.
 *
 * The model is small and deliberately honest about being a model. There is no
 * CloudWatch and no load balancer. What there is:
 *
 *   archive    a downstream store in four shards, exactly one of which is down
 *   relay      a background worker shipping each new board post to its shard
 *   /metrics   the numbers, in Prometheus text format
 *   /relay/healthz  a health check whose *condition* is written in a file the
 *                   participant owns — which is the whole point
 *   relay.json the participant's file: what the relay logs, what the health
 *              check looks at, and how much detail the log carries
 *
 * The lesson that has to survive the model is the split: **what is failing** is
 * a number, **why it is failing** is a log line, and **whether you are allowed to
 * hand that log line to somebody else** is a third question that only gets asked
 * if the first two were answered. An app that is silent is not an app that is
 * healthy, and a health check that has never gone red has not been proven — it
 * has only been proven to be pointed at something that never fails.
 */

const FLAG_SEED = process.env.FLAG_SEED ?? "local-dev-seed";

/**
 * Every unguessable value this scenario hands out, namespaced under
 * `observability:` so it can never collide with the board's own derivations in
 * `secrets.mjs` or with another scenario's.
 */
function obsDigest(namespace) {
  return createHash("sha256").update(`observability:${namespace}:${FLAG_SEED}`).digest("hex");
}

/** The four archive shards. Names are seed-derived, so no table survives a deploy. */
const SHARDS = [0, 1, 2, 3].map((index) => `AR-${obsDigest(`shard:${index}`).slice(0, 6)}`);

/**
 * The one shard that is down, and stays down.
 *
 * Derived rather than random: the same title fails the same way after a restart,
 * so a participant can prove to themselves that restarting fixes nothing — and a
 * restart still costs them, because the counters and the log go with it.
 */
const DOWN_SHARD = SHARDS[Number.parseInt(obsDigest("down").slice(0, 8), 16) % SHARDS.length];

/**
 * A reference code per shard, all four distinct.
 *
 * Every shard has one, so naming "the slice that is down" means correlating the
 * failing counter with the right code rather than copying the only code on the
 * page. A shard's code appears nowhere until that shard has actually been
 * written to, so the diagnosis comes out of the participant's own traffic.
 */
const SHARD_CODES = new Map(SHARDS.map((shard) => [shard, obsDigest(`code:${shard}`).slice(0, 8)]));

/** Written on every dropped-write log line, and on no other surface. */
const INCIDENT_ID = `INC-${obsDigest("incident").slice(0, 10)}`;

/**
 * Written on every relay log line while the log is carrying redacted detail.
 *
 * On *every* line, not on the first one after the switch: a one-shot value in a
 * bounded ring is a trap. A participant who makes the right change, generates
 * traffic and reads the log a minute later must still find it.
 */
const SAFE_LOG_TOKEN = obsDigest("safe-log").slice(0, 12);

/**
 * The credential the relay presents to the archive.
 *
 * Seed-derived and fake: it authenticates nothing, it is bound to loopback
 * inside a container, and getting it out of the log is one of this problem's
 * pass conditions. It is written into the log on purpose, because "the log
 * already had it in it" is the situation the participant is being taught to
 * find before somebody else does.
 */
const RELAY_CREDENTIAL = `rk_live_${obsDigest("credential").slice(0, 32)}`;

/** Matching on a prefix, so blanking the tail is not a redaction. */
const CREDENTIAL_PREFIX = RELAY_CREDENTIAL.slice(0, 12);

/** Which shard a title lands on. Deterministic, so a failure is reproducible. */
function shardFor(title) {
  const index = Number.parseInt(
    createHash("sha256").update(`observability:route:${FLAG_SEED}:${title}`).digest("hex").slice(0, 8),
    16,
  );
  return SHARDS[index % SHARDS.length];
}

// ---------------------------------------------------------------------------
// the relay's own configuration
// ---------------------------------------------------------------------------

const RELAY_CONFIG_PATH = process.env.RELAY_CONFIG ?? "/app/relay/relay.json";

/** この scenario の設定の上書き名 (置き場と挙動は `overrides.mjs`)。 */
const SETTINGS_NAME = "relay";

/**
 * 参加者向けの文中でこの設定を指す呼び名。 パスを既定にする方向は採らない — マウント元は
 * git 管理下で、 コンテナ内パスは参加者の機械に存在せず、 checkout パスは直接編集に誘導して
 * 解いた瞬間に作業ツリーを汚す。 変更は `PATCH /api/settings` (コンソールは `/docs`) へ誘導する。
 */
const RELAY_HINT =
  process.env.RELAY_HINT ?? "the relay settings (change them via PATCH /api/settings)";

/** The dependencies this relay has. The health check may be pointed at these. */
const DEPENDENCIES = ["config", "archive"];

const SETTINGS = {
  archiveLogging: { kind: "enum", values: ["off", "on"] },
  healthCheckProbes: { kind: "dependencies" },
  logDetail: { kind: "enum", values: ["full", "masked", "minimal", "safe"] },
};

/**
 * Read the relay's settings as they are on disk right now.
 *
 * Unknown keys, misspellings and wrong types are refused rather than ignored,
 * the same way `config.mjs` refuses an unknown board setting. A relay that
 * silently drops half of what its settings file says is how an operator "fixes"
 * something and changes nothing.
 *
 * @returns {{ ok: boolean, value: object | null, error: string | null }}
 */
function readRelayConfig(path = RELAY_CONFIG_PATH) {
  let text;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    return { ok: false, value: null, error: `cannot read ${RELAY_HINT}: ${error.code ?? error.message}` };
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
    // マウント元は出発点。 実行中に変えた分を重ねてから検証する (置き場は overrides.mjs)。
    if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
      parsed = { ...parsed, ...readOverride(SETTINGS_NAME) };
    }
  } catch (error) {
    return { ok: false, value: null, error: `${RELAY_HINT} is not valid JSON: ${error.message}` };
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, value: null, error: `${RELAY_HINT} must contain a JSON object` };
  }
  for (const key of Object.keys(parsed)) {
    if (!Object.hasOwn(SETTINGS, key)) {
      return { ok: false, value: null, error: `${key} is not a setting this relay reads` };
    }
  }
  const value = {};
  for (const [key, spec] of Object.entries(SETTINGS)) {
    if (!Object.hasOwn(parsed, key)) {
      return { ok: false, value: null, error: `${key} is missing` };
    }
    const raw = parsed[key];
    if (spec.kind === "enum") {
      if (typeof raw !== "string" || !spec.values.includes(raw)) {
        return {
          ok: false,
          value: null,
          error: `${key} must be one of ${spec.values.join("|")}, got ${JSON.stringify(raw)}`,
        };
      }
      value[key] = raw;
      continue;
    }
    if (!Array.isArray(raw)) {
      return { ok: false, value: null, error: `${key} must be an array of dependency names` };
    }
    for (const [index, entry] of raw.entries()) {
      if (typeof entry !== "string") {
        return { ok: false, value: null, error: `${key}[${index}] must be a string` };
      }
      // Deliberately does NOT list the legal names. The set of dependencies this
      // relay has is published on `/metrics`, which is the surface the
      // participant is meant to learn to read; an error message that enumerated
      // them would hand the answer over in exchange for a typo.
      if (!DEPENDENCIES.includes(entry)) {
        return {
          ok: false,
          value: null,
          error: `${key}[${index}] ${JSON.stringify(entry)} is not a dependency this relay has`,
        };
      }
    }
    value[key] = [...raw];
  }
  return { ok: true, value, error: null };
}

/**
 * The configuration epoch.
 *
 * Every relay log line is stamped with it, and it advances whenever the settings
 * file changes. Log lines are history: switching the log to redacted detail does
 * not un-write the lines that already carry the credential, and pretending
 * otherwise would teach that a config change cleans up a leak. So the checkpoint
 * that grades an absence grades it *at the current epoch* — the lines written
 * since the fix — while the old ones stay visible and stay leaked, which is why
 * a real incident ends with the credential being rotated rather than grepped
 * away.
 */
let epoch = 0;
let epochKey = null;

function relayConfig() {
  const result = readRelayConfig();
  const key = result.ok ? JSON.stringify(result.value) : `!${result.error}`;
  if (key !== epochKey) {
    epochKey = key;
    epoch += 1;
    log(
      result.ok ? "info" : "error",
      result.ok
        ? `relay config epoch=${epoch} archiveLogging=${result.value.archiveLogging} healthCheckProbes=[${result.value.healthCheckProbes.join(",")}] logDetail=${result.value.logDetail}`
        : `relay config epoch=${epoch} rejected: ${result.error}`,
    );
  }
  return result;
}

// ---------------------------------------------------------------------------
// the relay
// ---------------------------------------------------------------------------

/** Per-shard attempt counters. A shard appears only once it has been written to. */
const counters = new Map();

/** What actually reached the archive. */
const archive = [];

let droppedTotal = 0;

/**
 * The last board post the relay has considered.
 *
 * By id rather than by index: the board keeps at most 200 posts and splices the
 * oldest off the front, so an index would silently re-relay after a long session.
 */
let lastRelayedId = 0;

function bump(shard, result) {
  const current = counters.get(shard) ?? { archived: 0, dropped: 0 };
  current[result] += 1;
  counters.set(shard, current);
}

function totals() {
  let archived = 0;
  let dropped = 0;
  for (const entry of counters.values()) {
    archived += entry.archived;
    dropped += entry.dropped;
  }
  return { archived, dropped };
}

function relayLine(post, shard, delivered, settings) {
  const code = SHARD_CODES.get(shard);
  // Four settings, and only one of them is a redaction.
  //
  //   full     what the relay was shipped with
  //   masked   blank the tail, keep "just enough to correlate" — which leaves
  //            the front of the value in the line, and is why the absence check
  //            matches a prefix rather than the whole string
  //   minimal  cut the line down until nothing sensitive is left, and nothing
  //            useful either: the secret goes, and so does the investigation
  //   safe     replace the value, keep every field an investigation needs
  //
  // Two of the three wrong ones look like a fix from the outside. That is the
  // point: "I redacted the log" is a claim about a line nobody re-read.
  if (settings.logDetail === "minimal") {
    log(
      delivered ? "info" : "warn",
      `relay ${delivered ? "archived" : "drop"} epoch=${epoch} id=${post.id}`,
    );
    return;
  }
  const auth =
    settings.logDetail === "full"
      ? `auth=${RELAY_CREDENTIAL}`
      : settings.logDetail === "masked"
        ? `auth=${RELAY_CREDENTIAL.slice(0, 16)}…`
        : `auth=<redacted> safe-token=${SAFE_LOG_TOKEN}`;
  if (delivered) {
    log(
      "info",
      `relay archived id=${post.id} shard=${shard} code=${code} target=archive epoch=${epoch} ${auth}`,
    );
    return;
  }
  log(
    "warn",
    `relay drop id=${post.id} shard=${shard} code=${code} target=archive epoch=${epoch} reason=shard_unreachable incident=${INCIDENT_ID} ${auth}`,
  );
}

/**
 * Ship every board post the relay has not seen yet.
 *
 * Posts the board shipped with are skipped: the relay was switched on this
 * morning, so the archive holds what has gone through it since, and an untouched
 * container has genuinely measured nothing. A scenario that pre-counted its own
 * furniture would show a participant a diagnosis they did not produce.
 */
function pump() {
  const settings = relayConfig();
  for (const post of allPosts()) {
    if (post.seeded) continue;
    if (post.id <= lastRelayedId) continue;
    lastRelayedId = post.id;
    const shard = shardFor(post.title);
    const delivered = shard !== DOWN_SHARD;
    bump(shard, delivered ? "archived" : "dropped");
    if (delivered) {
      archive.push({ id: post.id, author: post.author, title: post.title, shard, at: post.at });
      if (archive.length > 500) archive.splice(0, archive.length - 500);
    } else {
      droppedTotal += 1;
    }
    // The data path does not depend on the log settings: a participant who
    // mistypes the settings file loses their signal, not their traffic.
    if (settings.ok && settings.value.archiveLogging === "on") {
      relayLine(post, shard, delivered, settings.value);
    }
  }
}

/**
 * A background drain, so the relay is a worker rather than something that only
 * runs when somebody looks at it. Unreferenced: the two listeners are what keep
 * this process alive, and a timer should not be the reason it will not exit.
 */
const drain = setInterval(() => {
  try {
    pump();
  } catch (error) {
    log("error", `relay pump failed: ${error.message}`);
  }
}, 1_000);
drain.unref?.();

// ---------------------------------------------------------------------------
// health
// ---------------------------------------------------------------------------

/** The relay asking the archive whether every shard answers. One does not. */
const archiveUp = () => SHARDS.every((shard) => shard !== DOWN_SHARD);

/**
 * The health verdict, as a pure function of a world and the probes the settings
 * file names.
 *
 * Pure on purpose: the gate and the checkpoint evaluate this same function in
 * three counterfactual worlds, and a version that logged or measured on the way
 * through would write three lines into the log every time `/posture` was read —
 * evicting the very evidence the other checkpoints depend on. The only place
 * that records anything is the route itself.
 */
function healthVerdict(world, probes) {
  const checks = {};
  for (const name of probes) checks[name] = world[name] === true;
  // A check that looks at nothing does not get to say "healthy". `every` over
  // an empty list is true, which would make an empty probe list the greenest
  // condition in the file; it is instead the one condition that can never go
  // green, which is what makes "just make it always 503" expressible here — and
  // refusable, by the third world below.
  return {
    ok: probes.length > 0 && probes.every((name) => world[name] === true),
    checks,
  };
}

/**
 * Is the condition the settings file describes actually a health check?
 *
 * Three worlds, not one, and each of them rules out a different real answer.
 * An empty probe list — "always unhealthy, then I can never miss an outage" —
 * passes the first two worlds and fails the third. A condition that watches only
 * the archive misses a broken settings file and fails the second. The shipped
 * condition, which watches only the settings file, misses the archive and fails
 * the first. Exactly one subset of this relay's dependencies answers all three
 * correctly, and it is not guessable from the settings file: the names live on
 * `/metrics`.
 */
function honestPredicate(probes) {
  return (
    healthVerdict({ config: true, archive: false }, probes).ok === false &&
    healthVerdict({ config: false, archive: true }, probes).ok === false &&
    healthVerdict({ config: true, archive: true }, probes).ok === true
  );
}

/**
 * The epoch at which `GET /relay/healthz` was last actually served.
 *
 * Recorded by the route and by nothing else, so "the condition is now correct"
 * and "somebody ran the corrected check" stay two separate facts. Reset in
 * effect by every settings change, because the epoch moves.
 */
let healthServedEpoch = 0;

// ---------------------------------------------------------------------------
// surfaces
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

function sendText(response, status, body) {
  response.writeHead(status, { "content-type": "text/plain; version=0.0.4; charset=utf-8" });
  response.end(body);
}

function sendHtml(response, status, body) {
  response.writeHead(status, { "content-type": "text/html; charset=utf-8" });
  response.end(body);
}

/**
 * The numbers, in Prometheus text format.
 *
 * A shard's series exist only once that shard has been written to. The dependency
 * gauges exist from boot, because "this app has an archive and it is not
 * answering" is the thing a participant is supposed to be able to see before
 * they have done anything — and *which* of the four slices is down is the thing
 * they are supposed to have to produce.
 */
function renderMetrics() {
  pump();
  const settings = relayConfig();
  const lines = [
    "# HELP relay_posts_total Board posts the relay has attempted to ship to the archive.",
    "# TYPE relay_posts_total counter",
  ];
  const attempted = SHARDS.filter((shard) => counters.has(shard));
  for (const shard of attempted) {
    const entry = counters.get(shard);
    lines.push(`relay_posts_total{result="archived",shard="${shard}"} ${entry.archived}`);
    lines.push(`relay_posts_total{result="dropped",shard="${shard}"} ${entry.dropped}`);
  }
  lines.push("# HELP relay_shard_up Whether an archive shard accepted the writes routed to it.");
  lines.push("# TYPE relay_shard_up gauge");
  for (const shard of attempted) {
    lines.push(
      `relay_shard_up{shard="${shard}",code="${SHARD_CODES.get(shard)}"} ${shard === DOWN_SHARD ? 0 : 1}`,
    );
  }
  lines.push("# HELP relay_dependency_up Dependencies this relay has, and whether each answers.");
  lines.push("# TYPE relay_dependency_up gauge");
  lines.push(`relay_dependency_up{name="config"} ${settings.ok ? 1 : 0}`);
  lines.push(`relay_dependency_up{name="archive"} ${archiveUp() ? 1 : 0}`);
  lines.push("# HELP relay_settings_ok Whether the relay's own settings file loads.");
  lines.push("# TYPE relay_settings_ok gauge");
  lines.push(`relay_settings_ok ${settings.ok ? 1 : 0}`);
  lines.push("# HELP relay_log_epoch The settings generation the newest log lines carry.");
  lines.push("# TYPE relay_log_epoch gauge");
  lines.push(`relay_log_epoch ${epoch}`);
  return `${lines.join("\n")}\n`;
}

/** The relay log lines written under the settings that are in force right now. */
function currentEpochLines() {
  const stamp = ` epoch=${epoch} `;
  return recentLines(500).filter(
    (line) =>
      (line.message.startsWith("relay archived ") || line.message.startsWith("relay drop ")) &&
      line.message.includes(stamp),
  );
}

/** The relay's own state, with no derived credential check in it (see below). */
function baseState() {
  pump();
  const settings = relayConfig();
  const probes = settings.ok ? settings.value.healthCheckProbes : [];
  const counted = totals();
  const lines = currentEpochLines();
  return {
    changeVia: "PATCH /api/settings (API console: /docs)",
    settings: settings.ok ? settings.value : null,
    settingsError: settings.error,
    epoch,
    dependencies: { config: settings.ok, archive: archiveUp() },
    health: {
      probes,
      ok: settings.ok ? healthVerdict({ config: settings.ok, archive: archiveUp() }, probes).ok : false,
      honest: settings.ok ? honestPredicate(probes) : false,
      checkedThisEpoch: healthServedEpoch === epoch,
    },
    archive: { archived: counted.archived, dropped: counted.dropped, held: archive.length },
    signal: {
      archivedLinesThisEpoch: lines.filter((line) => line.message.startsWith("relay archived ")).length,
      dropLinesThisEpoch: lines.filter((line) => line.message.startsWith("relay drop ")).length,
    },
  };
}

/**
 * Where the relay credential is currently visible.
 *
 * Prefix matching, not equality: the `masked` setting blanks the tail and leaves
 * the front of the value in the line, which is enough to be worth rotating over
 * and is therefore not a redaction.
 *
 * Only the log is scanned, because the log is the only place this value is ever
 * written — `/metrics` carries shard names and counts, and `/relay/state` carries
 * the participant's own settings, neither of which the credential can reach. The
 * problem's suite pins that separately rather than this function grading a
 * surface it can never see anything on. And the *history* of the log is
 * deliberately out of scope: lines written under older settings keep whatever
 * they were written with, which is exactly why the answer to a leak is to rotate
 * the credential rather than to edit the past.
 */
function credentialVisibleIn() {
  const leaking = currentEpochLines().some((line) => line.message.includes(CREDENTIAL_PREFIX));
  return leaking ? ["log"] : [];
}

function relayPage() {
  const state = baseState();
  const shardRows = SHARDS.filter((shard) => counters.has(shard))
    .map((shard) => {
      const entry = counters.get(shard);
      return `<tr><td><code>${escapeHtml(shard)}</code></td><td><code>${escapeHtml(SHARD_CODES.get(shard))}</code></td><td>${entry.archived}</td><td>${entry.dropped}</td></tr>`;
    })
    .join("\n");
  return `<!doctype html>
<html lang="ja"><head><meta name="color-scheme" content="light dark"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>relay</title></head>
<body style="font-family:system-ui;max-width:52rem;margin:2.5rem auto;line-height:1.7;padding:0 1rem">
<h1>archive relay</h1>
<p>板に書かれた投稿を、 下流の archive に 4 枚のシャードへ振り分けて送っています。 板そのものは無関係に動き続けます ── 投稿は板には残り、 archive に届かないことがあります。</p>
<p>seed 投稿は relay 導入前のものなので対象外です。 relay が扱うのはあなたが書いた投稿だけです。</p>

<h2>いまの状態</h2>
<table border="1" cellpadding="6" cellspacing="0">
<tr><th>settings</th><td><code>${escapeHtml(state.settingsError ?? "ok")}</code></td></tr>
<tr><th>epoch</th><td><code>${state.epoch}</code></td></tr>
<tr><th>archive に届いた / 届かなかった</th><td><code>${state.archive.archived}</code> / <code>${state.archive.dropped}</code></td></tr>
<tr><th>死活確認が見ているもの</th><td><code>[${escapeHtml(state.health.probes.join(", "))}]</code> → <code>${state.health.ok ? "ok" : "not ok"}</code></td></tr>
<tr><th>この epoch で <code>/relay/healthz</code> が叩かれたか</th><td><code>${state.health.checkedThisEpoch ? "yes" : "no"}</code></td></tr>
</table>

<h2>シャード別 (書き込みが 1 度でもあったものだけ)</h2>
<table border="1" cellpadding="6" cellspacing="0"><tr><th>shard</th><th>code</th><th>archived</th><th>dropped</th></tr>
${shardRows === "" ? '<tr><td colspan="4">まだ 1 件も流れていません</td></tr>' : shardRows}</table>

<h2>設定</h2>
<p>relay の設定は板の API コンソール (<a href="docs">docs</a>) から <code>PATCH /api/settings</code> で変えます。 リクエストごとに読み直すので、 送ればすぐ効きます (再起動は要りません)。 変更を捨てて初期状態に戻すのは <code>DELETE /api/settings</code> です。</p>
<pre>{
  "archiveLogging":    "off" | "on",      relay の 1 行ログを書くかどうか
  "healthCheckProbes": ["&lt;依存先の名前&gt;", ...],  死活確認が見る依存先
  "logDetail":         "full" | "masked" | "minimal" | "safe"   ログに載せる詳細の量
}</pre>
<p>ここに書いていないキー・打ち間違い・型違いは受け付けません (黙って無視はしません)。 この relay が持っている依存先の名前は <a href="metrics">/metrics</a> に出ています。</p>

<h2>この relay で見られるもの</h2>
<pre>GET metrics         数字 (Prometheus text format)
GET relay/state     いまの状態 (JSON)
GET relay/healthz   relay の死活確認
GET archive         archive に届いた投稿
GET api/logs        アプリのログ (板と共通)
GET docs            API コンソール ── 設定の変更もここから
GET/PATCH/DELETE api/settings   relay の設定を見る・変える・初期状態へ戻す</pre>
</body></html>`;
}

export const seedPosts = [
  {
    author: "cto",
    title: "検索に出てこない投稿があるらしい",
    body: "「書いたのに後から探せない」 という声が今週 3 件。 板を開くと投稿自体はある。 ダッシュボードは緑。 監視は一度も鳴っていない。 原因が分からないなら、 まず分かるようにしてください。",
    at: "2026-04-08T08:30:00.000Z",
  },
  {
    author: "sre-predecessor",
    title: "引き継ぎ: relay の設定は relay.json",
    body: "板から archive に流す relay を今朝入れました。 設定は relay.json 1 枚です。 ログはうるさいので出さないようにしてあります。 死活確認は設定ファイルが読めるかだけ見ています。 あとはよしなに。",
    at: "2026-04-08T08:45:00.000Z",
  },
];

export const routes = {
  "GET /relay": (request, response) => sendHtml(response, 200, relayPage()),

  "GET /relay/state": (request, response) =>
    sendJson(response, 200, { ...baseState(), credentialVisibleIn: credentialVisibleIn() }),

  /**
   * The relay's health check.
   *
   * Its condition is whatever the settings file names, which is the point: a
   * health check is only as honest as the list of things it looks at, and the
   * shipped list looks at the one dependency that cannot fail.
   */
  "GET /relay/healthz": (request, response) => {
    pump();
    const settings = relayConfig();
    healthServedEpoch = epoch;
    if (!settings.ok) {
      return sendJson(response, 503, {
        ok: false,
        error: "relay_settings_invalid",
        detail: settings.error,
        changeVia: "PATCH /api/settings (API console: /docs)",
      });
    }
    const probes = settings.value.healthCheckProbes;
    const verdict = healthVerdict({ config: true, archive: archiveUp() }, probes);
    return sendJson(response, verdict.ok ? 200 : 503, {
      ok: verdict.ok,
      probes,
      checks: verdict.checks,
    });
  },

  "GET /metrics": (request, response) => sendText(response, 200, renderMetrics()),

  "GET /archive": (request, response) => {
    pump();
    const counted = totals();
    return sendJson(response, 200, {
      archived: archive,
      count: archive.length,
      attempted: counted.archived + counted.dropped,
      missing: counted.dropped,
    });
  },
};

// ---------------------------------------------------------------------------
// posture
// ---------------------------------------------------------------------------

export const gateTokens = true;

export function postureContext() {
  const state = baseState();
  const settings = relayConfig();
  return {
    relay: {
      settingsOk: settings.ok,
      archiveLogging: settings.ok ? settings.value.archiveLogging : null,
      archived: state.archive.archived,
      dropped: state.archive.dropped,
      dropLines: state.signal.dropLinesThisEpoch,
      archivedLines: state.signal.archivedLinesThisEpoch,
      healthHonest: state.health.honest,
      healthChecked: state.health.checkedThisEpoch,
      credentialVisible: credentialVisibleIn().length > 0,
    },
  };
}

/**
 * Four gates, none of which is implied by another, so the conjunction says four
 * separate things rather than one thing four times.
 *
 * `credential_out_of_logs` deliberately carries `failures_logged`'s conjunction
 * inside it. An empty log contains no credential, and calling that clean is the
 * exact shape of vacuous pass this catalog has shipped before: the gate is about
 * a log that is being written and does not carry the value, not about a log that
 * is not being written.
 */
export const gates = {
  /** Both outcomes are really happening: enough traffic to diagnose, and not everything is down. */
  traffic_seen: (context) => context.relay.archived > 0 && context.relay.dropped > 0,
  /** The app is writing down the writes it is losing, under the settings in force now. */
  failures_logged: (context) =>
    context.relay.settingsOk === true &&
    context.relay.archiveLogging === "on" &&
    context.relay.dropLines > 0,
  /** The health condition is right in all three worlds, and somebody has run it since. */
  health_honest: (context) =>
    context.relay.healthHonest === true && context.relay.healthChecked === true,
  /** The log is being written, carries both outcomes, and does not carry the credential. */
  credential_out_of_logs: (context) =>
    context.relay.settingsOk === true &&
    context.relay.archiveLogging === "on" &&
    context.relay.dropLines > 0 &&
    context.relay.archivedLines > 0 &&
    context.relay.credentialVisible === false,
};

// ---------------------------------------------------------------------------
// checkpoints
// ---------------------------------------------------------------------------

/** Free-form answers are compared after trimming; nothing here is case-folded. */
const matches = (submission, expected) => submission.trim() === expected;

function gateState() {
  return posture({ gates, gateTokens: true }, postureContext());
}

/**
 * One handler per checkpoint. Each returns the verdict only — the platform owns
 * the points, and the container never sees them (AGENT.md §13).
 *
 * Every one of them re-measures the running app at the moment it is asked. None
 * of them writes anything, moves anything, or reads a request body: being scored
 * cannot break a participant's environment, and a retried verdict changes
 * nothing.
 */
export const checks = {
  /**
   * The incident id appears on the dropped-write log lines and on no other
   * surface. Reading it is not enough: the settings that produce those lines
   * have to still be in force, the lines have to still be there *carrying it*,
   * and both outcomes have to be really happening — a participant who turned the
   * relay's log back off after copying the value, or cut the lines down until
   * they no longer say anything, is back where they started.
   */
  "silent-failures": (submission) => {
    pump();
    const settings = relayConfig();
    if (!settings.ok || settings.value.archiveLogging !== "on") return false;
    // The line has to be a usable record, not merely a line: a log that says
    // "a write failed" and nothing else is what the app was already doing by
    // saying nothing at all. The incident reference is what makes it a record.
    const recorded = currentEpochLines().some(
      (line) => line.message.startsWith("relay drop ") && line.message.includes(`incident=${INCIDENT_ID}`),
    );
    if (!recorded) return false;
    const counted = totals();
    if (counted.archived === 0 || counted.dropped === 0) return false;
    return matches(submission, INCIDENT_ID);
  },

  /**
   * A receipt for a health condition that is right in three worlds and has
   * actually been run since it was written.
   *
   * The receipt comes from the boot secret rather than from `FLAG_SEED`, so it
   * cannot be derived, only earned — and it stops being emitted the moment the
   * condition is loosened again.
   */
  "honest-health": (submission) => {
    if (gateState().gates.health_honest !== true) return false;
    return matches(submission, gateToken("health_honest"));
  },

  /**
   * An absence, graded only after the thing whose absence is being graded has
   * been proven to work.
   *
   * A: the log is carrying both a dropped write and a delivered one right now.
   *    Both, and *present* rather than merely having happened once — an archived
   *    line at the current epoch is a write that reached the archive under these
   *    settings, so "switch the relay off and nothing leaks" fails here, and so
   *    does "stop writing to the archive at all".
   * B: those lines still name the shard, its code, the target and the epoch — a
   *    "redaction" that truncates the line loses the investigation along with
   *    the secret, and is not a redaction.
   * Only then: the credential is not in any line written under these settings.
   */
  "leak-shut": (submission) => {
    pump();
    const settings = relayConfig();
    if (!settings.ok || settings.value.archiveLogging !== "on") return false;
    const lines = currentEpochLines();
    const drop = lines.find((line) => line.message.startsWith("relay drop "));
    const delivered = lines.find((line) => line.message.startsWith("relay archived "));
    if (drop === undefined || delivered === undefined) return false;
    // Precondition B as one statement over one list. There is exactly one
    // reachable way to violate it — cutting the lines down until nothing
    // sensitive is left, which takes the investigation with it — so a longer
    // list of fields would only add clauses no reachable state could be the sole
    // cause of failing. That the dropped line still names its incident is graded
    // where it is load-bearing, by `silent-failures`.
    const required = ["shard=", "code=", "target=", ` epoch=${epoch} `];
    if (required.some((field) => !drop.message.includes(field) || !delivered.message.includes(field))) {
      return false;
    }
    if (credentialVisibleIn().length > 0) return false;
    return matches(submission, SAFE_LOG_TOKEN);
  },

  /**
   * Naming the slice that is down, from the participant's own traffic.
   *
   * All four shards carry a code and every one of them is printed once that
   * shard has been written to, so the answer is a correlation rather than the
   * only value on the page. It also has to be a *diagnosis*: the shard being
   * named has to have really refused a write here, and something else has to
   * have really accepted one, or "everything is broken" would score the same as
   * "this one slice is broken".
   */
  "root-cause": (submission) => {
    pump();
    if ((counters.get(DOWN_SHARD)?.dropped ?? 0) === 0) return false;
    const elsewhere = SHARDS.some(
      (shard) => shard !== DOWN_SHARD && (counters.get(shard)?.archived ?? 0) > 0,
    );
    if (!elsewhere) return false;
    return matches(submission, SHARD_CODES.get(DOWN_SHARD));
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
  summary: { ja: "リレー設定", en: "relay settings" },
  // Swagger の Try it out にそのまま入る例。 この relay が実際に受け付けるキーを使う —
  // 受け付けない例を置くと、 最初の 1 回が 400 で返る道具になってしまう。
  example: { archiveLogging: "on" },
  read: () => readRelayConfig(),
};
