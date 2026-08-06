import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { addPost, allPosts, resetBoard, validatePost } from "./board.mjs";
import { applyConfigChange, CONFIG_FILE, readConfig, resetConfigChanges } from "./config.mjs";
import { log, recentLines } from "./log.mjs";
import { clearOverride, readOverride, saveOverride } from "./overrides.mjs";
import { observe, posture } from "./posture.mjs";
import { BOARD_SERIAL, BOOT_CHECK } from "./secrets.mjs";

/**
 * The StackStack base app — one small message board, shared by every problem in
 * the StackStack family. A problem selects a *scenario* (`SCENARIO=<name>`),
 * which supplies the board's seed posts, the posture gates, and the checkpoint
 * handlers `/verify` delegates to. The board itself is the same code every time,
 * so what a participant learns about it in one problem still holds in the next.
 *
 * Two servers run in one process (the local-play contract, AGENT.md §13):
 *   :8080  the app the participant uses
 *   :8081  the loopback `/verify` the platform delegates scoring to
 *
 * Both are bound to 127.0.0.1 by the compose file. Every unguessable value is
 * derived from the per-deploy `FLAG_SEED` inside the container, so no answer is
 * committed and the platform never learns one.
 */

const CHALLENGE_PORT = Number(process.env.CHALLENGE_PORT ?? 8080);
const VERIFY_PORT = Number(process.env.VERIFY_PORT ?? 8081);
const SCENARIO = process.env.SCENARIO ?? "onboarding";

/**
 * Where the config file sits in the *participant's checkout*. The app only ever
 * sees the mounted container path, which is not the path they need to open, so
 * the problem's compose file passes the checkout-relative one for display.
 */
const CONFIG_HINT = process.env.CONFIG_HINT ?? CONFIG_FILE;

// An unknown scenario is a wiring mistake in the problem, not a participant
// error: fail at boot rather than serving a board with no checkpoints behind it.
const scenario = await import(`./scenarios/${SCENARIO}.mjs`).catch((error) => {
  console.error(`unknown SCENARIO "${SCENARIO}": ${error.message}`);
  process.exit(1);
});

resetBoard(scenario.seedPosts ?? []);

function send(response, status, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(body);
}

function sendHtml(response, status, body) {
  response.writeHead(status, { "content-type": "text/html; charset=utf-8" });
  response.end(body);
}

const MAX_BODY_BYTES = 64 * 1024;

/**
 * Returned when the body exceeds {@link MAX_BODY_BYTES}. A symbol rather than a
 * marker string, so a request body that happens to *be* that string cannot be
 * mistaken for the signal.
 */
const TOO_LARGE = Symbol("too-large");

/**
 * @returns the parsed body, `null` for malformed JSON, or {@link TOO_LARGE} so
 * the caller can answer rather than reset the socket — a reset shows up as a
 * curl transport error with no explanation of what went wrong.
 */
function readJson(request) {
  return new Promise((resolve) => {
    const chunks = [];
    let bytes = 0;
    request.on("data", (chunk) => {
      bytes += chunk.length;
      if (bytes > MAX_BODY_BYTES) {
        request.pause();
        resolve(TOO_LARGE);
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

const escapeHtml = (text) =>
  text.replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character],
  );

/**
 * Every URL on this page is relative. The board is reached through a forwarded
 * port in Codespaces and through loopback locally, and a hard-coded
 * `http://127.0.0.1:...` would work in exactly one of those.
 */
function boardPage(config, posts) {
  const rows = posts
    .map(
      (post) => `<article>
      <h3>${escapeHtml(post.title)}</h3>
      <p class="meta">${escapeHtml(post.author)} — ${escapeHtml(post.at)}</p>
      <p>${escapeHtml(post.body)}</p>
    </article>`,
    )
    .join("\n");
  return `<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(config.boardTitle)}</title></head>
<body style="font-family:system-ui;max-width:44rem;margin:2.5rem auto;line-height:1.7;padding:0 1rem">
<h1>${escapeHtml(config.boardTitle)}</h1>
<p>board serial: <code>${BOARD_SERIAL}</code></p>
<p>投稿の受付: <strong>${config.acceptingPosts ? "開いています" : "閉じています"}</strong></p>
<h2>この板でできること</h2>
<p><a href="docs"><strong>API コンソールを開く</strong></a> — ここから設定を変えたり投稿したりできます。ファイルを探して編集する必要はありません。</p>
<pre>GET    api/board     板の状態と投稿一覧
GET    api/logs      アプリのログ
GET    posture       いまの状態の実測結果
GET    healthz       死活確認
POST   api/posts     投稿する  {"author":"...","title":"...","body":"..."}
GET    api/config    いまの設定
PATCH  api/config    設定を変える  {"acceptingPosts": true}
DELETE api/config    変えた設定を捨てて初期状態に戻す</pre>
<h2>投稿</h2>
${rows}
</body></html>`;
}

/**
 * scenario 固有の設定を読む・変える・捨てる。
 *
 * 板の `/api/config` と 1 本にまとめる方向は採らない — 板の設定は 8 問すべてに共通で、
 * scenario の設定は問題ごとに形が違う。 混ぜると、 どちらを直せばよいか参加者が判別できない。
 */
async function handleSettings(route, request, response) {
  const settings = scenario.editableSettings;
  if (route === "GET /api/settings") {
    const current = settings.read();
    return send(response, 200, {
      settings: current.value,
      ok: current.ok,
      error: current.error ?? null,
    });
  }
  if (route === "DELETE /api/settings") {
    clearOverride(settings.name);
    log("info", `${settings.name} changes discarded`);
    return send(response, 200, { settings: settings.read().value });
  }
  const body = await readJson(request);
  if (body === TOO_LARGE) {
    return send(response, 413, { error: `body must be at most ${MAX_BODY_BYTES} bytes` });
  }
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return send(response, 400, { error: "rejected", detail: ["the body must be a JSON object"] });
  }
  // 妥当性は scenario 自身の読み込み経路に判定させる。 ここに別の検査を置く方向は採らない —
  // 設定の形は問題ごとに違い、 二重に持てば片方だけ直された仕様がもう片方に残る。
  //
  // 事前に検証関数を呼ぶ方向も採らない — scenario によって検証は読み込みの中にあり、
  // 切り出せる形になっていない。 いったん書いて読み直し、 通らなければ元に戻す。
  // 上書きは /tmp の 1 ファイルなので、 巻き戻しは取りこぼしなく効く。
  const previous = readOverride(settings.name);
  const saved = saveOverride(settings.name, body);
  if (!saved.ok) return send(response, 500, { error: "rejected", detail: [saved.error] });
  const after = settings.read();
  if (!after.ok) {
    clearOverride(settings.name);
    if (Object.keys(previous).length > 0) saveOverride(settings.name, previous);
    return send(response, 400, { error: "rejected", detail: [after.error] });
  }
  log("info", `${settings.name} changed via API: ${Object.keys(body).join(", ")}`);
  return send(response, 200, { settings: settings.read().value });
}

/**
 * この板が話す API の仕様。 Swagger UI がこれを読んで「試す」画面を出す。
 *
 * 仕様書を別ファイルに置く方向は採らない — 実装と別々に古くなる。 ここが唯一の一覧で、
 * ルート表 (`BASE_ROUTES`) と突き合わせる test が両者のずれを落とす。
 *
 * `servers` は書かない。 loopback と Codespaces の転送ポートでは origin が違い、 書けば
 * どちらか一方でしか「試す」が通らなくなる。 省略すると Swagger UI は開いている URL を
 * 基準にするので、 両方で動く。
 */
function openApiDocument(scenarioName) {
  const json = (schema) => ({ content: { "application/json": { schema } } });
  const ok = (description) => ({ description, ...json({ type: "object" }) });
  const settings = {
    type: "object",
    properties: {
      boardTitle: { type: "string" },
      acceptingPosts: { type: "boolean" },
    },
  };
  return {
    openapi: "3.0.3",
    info: {
      title: `StackStack board (${scenarioName})`,
      version: "1.0.0",
      description:
        "この板の API です。 各項目の Try it out から実際に実行できます。 設定の変更もここから行い、 リポジトリのファイルは書き換えません。 コンテナを作り直せば変更は消えて元の状態に戻ります。",
    },
    paths: {
      "/api/board": {
        get: { summary: "板の状態と投稿一覧", responses: { 200: ok("板の状態") } },
      },
      "/api/config": {
        get: { summary: "いまの設定", responses: { 200: ok("設定") } },
        patch: {
          summary: "設定を変える",
          requestBody: {
            required: true,
            ...json({ ...settings, example: { acceptingPosts: true } }),
          },
          responses: { 200: ok("変更後の設定"), 400: ok("受け付けられない値") },
        },
        delete: {
          summary: "変えた設定を捨てて初期状態に戻す",
          responses: { 200: ok("戻した後の設定") },
        },
      },
      "/api/posts": {
        post: {
          summary: "投稿する",
          requestBody: {
            required: true,
            ...json({
              type: "object",
              required: ["author", "title", "body"],
              properties: {
                author: { type: "string" },
                title: { type: "string" },
                body: { type: "string" },
              },
              example: { author: "you", title: "はじめての投稿", body: "本文" },
            }),
          },
          responses: {
            201: ok("投稿できた"),
            409: ok("板が投稿を受け付けていない"),
            503: ok("設定が読めない"),
          },
        },
      },
      "/api/logs": { get: { summary: "アプリのログ", responses: { 200: ok("ログ") } } },
      "/posture": { get: { summary: "いまの状態の実測結果", responses: { 200: ok("実測") } } },
      "/healthz": { get: { summary: "死活確認", responses: { 200: ok("健康"), 503: ok("不調") } } },
      // scenario が設定を持つときだけ出す。 手で書き足す方向は採らない — 宣言と一覧が
      // 別々に古くなり、 Swagger に無い経路や、 経路の無い Swagger 項目が生まれる。
      ...(scenario.editableSettings
        ? {
            "/api/settings": {
              get: {
                summary: `${scenario.editableSettings.summary}をみる`,
                responses: { 200: ok("いまの設定") },
              },
              patch: {
                summary: `${scenario.editableSettings.summary}を変える`,
                requestBody: {
                  required: true,
                  ...json({ type: "object", example: scenario.editableSettings.example }),
                },
                responses: { 200: ok("変更後"), 400: ok("受け付けられない値") },
              },
              delete: {
                summary: `${scenario.editableSettings.summary}の変更を捨てて初期状態に戻す`,
                responses: { 200: ok("戻した後") },
              },
            },
          }
        : {}),
    },
  };
}

/**
 * Swagger UI を出す 1 枚。 資産はイメージに焼いてあるので外部へ出ない。
 *
 * `/api/docs` ではなく `/docs` に置く。 前者からの相対 `openapi.json` は
 * `/api/openapi.json` に解決してしまう。 板と同じ階層なら相対のまま両方の環境で動く。
 */
function docsPage() {
  return `<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>API コンソール</title>
<link rel="stylesheet" href="vendor/swagger/swagger-ui.css">
<style>body{margin:0}#note{font-family:system-ui;padding:.8rem 1.2rem;background:#eef4ff;line-height:1.6}</style>
</head><body>
<div id="note">この板の API をここから実行できます (各項目の <strong>Try it out</strong>)。
 設定の変更もここから行い、<strong>リポジトリのファイルは書き換えません</strong>。
 <a href="./">板に戻る</a></div>
<div id="ui"></div>
<script src="vendor/swagger/swagger-ui-bundle.js"></script>
<script>
SwaggerUIBundle({ url: "openapi.json", dom_id: "#ui", tryItOutEnabled: true, defaultModelsExpandDepth: -1 });
</script>
</body></html>`;
}

/**
 * Parse a request target without letting a malformed one end the process.
 *
 * `GET //` is a protocol-relative reference with no host, and `new URL` rejects
 * it. `guard` below would already catch the throw, but a browser pointed at a
 * doubled slash should see the board rather than a 400 — so leading slashes are
 * collapsed, which is what the client meant, and anything still unparseable
 * becomes a target the router will not match. Same helper, same wording, as the
 * rest of the catalog's local-play apps.
 */
function requestUrl(target, base) {
  try {
    return new URL(String(target ?? "/").replace(/^\/+/, "/"), base);
  } catch {
    return new URL("/__malformed_request__", base);
  }
}

/**
 * Swagger UI の実行に要る資産だけ。 ディレクトリを配る方向は採らない — 焼いた覚えの無い
 * ファイルまで配られる余地を残さない。
 */
const SWAGGER_ASSETS = new Map([
  ["/vendor/swagger/swagger-ui-bundle.js", ["vendor/swagger/swagger-ui-bundle.js", "text/javascript; charset=utf-8"]],
  ["/vendor/swagger/swagger-ui.css", ["vendor/swagger/swagger-ui.css", "text/css; charset=utf-8"]],
]);

function sendAsset(response, pathname) {
  const [file, type] = SWAGGER_ASSETS.get(pathname);
  let body;
  try {
    body = readFileSync(new URL(file, import.meta.url));
  } catch {
    return send(response, 404, { error: "not_found" });
  }
  response.writeHead(200, { "content-type": type, "cache-control": "no-store" });
  response.end(body);
}

/**
 * scenario が持つ設定を実行時に変えるための経路。
 *
 * scenario ごとに別のパス名を与える方向は採らない — Swagger の一覧で場所が毎回変わると、
 * 8 問を通した参加者が毎回探し直すことになる。 設定の中身は問題ごとに違っても、
 * 「ここが設定」 という位置は同じにする。
 */
const SETTINGS_ROUTES = ["GET /api/settings", "PATCH /api/settings", "DELETE /api/settings"];

/** The routes the board itself serves, whatever the scenario. */
const BASE_ROUTES = [
  "GET /",
  "GET /healthz",
  "GET /api/board",
  "GET /api/logs",
  "GET /posture",
  "POST /api/posts",
  "GET /api/config",
  "PATCH /api/config",
  "DELETE /api/config",
  ...(scenario.editableSettings ? SETTINGS_ROUTES : []),
  "GET /docs",
  "GET /openapi.json",
];

/**
 * A scenario's own routes, e.g. the search endpoint a participant implements or
 * the admin API another problem asks them to lock down.
 *
 * Declared rather than bolted onto this file, because every problem after
 * onboarding adds a surface of its own and the alternative is this module
 * growing a branch per problem — at which point the "shared board" is a
 * platform and no longer shared in any useful sense. A scenario route is
 * `"METHOD /path": (request, response, url) => ...`, and it is dispatched and
 * observed exactly like a base route.
 */
const scenarioRoutes = scenario.routes ?? {};

/** The board's whole surface. A route not in here is a 404. */
const ROUTES = new Set([...BASE_ROUTES, ...Object.keys(scenarioRoutes)]);

// A scenario silently shadowing `GET /healthz` would be a debugging nightmare
// for whoever hit it next, so it is a boot failure rather than a surprise.
for (const route of Object.keys(scenarioRoutes)) {
  if (BASE_ROUTES.includes(route)) {
    console.error(`scenario "${SCENARIO}" redeclares the base route ${route}`);
    process.exit(1);
  }
}

/**
 * Nothing a client can send may take the process down. Both servers live in one
 * process, so an unhandled throw in a request handler would take the board and
 * `/verify` with it and end the participant's session — and the cheapest way to
 * trigger one is a typo: `GET //` is a protocol-relative reference with no host,
 * which `new URL` rejects.
 */
function guard(handler) {
  return async (request, response) => {
    try {
      await handler(request, response);
    } catch (error) {
      log("error", `${request.method} ${request.url}: ${error.message}`);
      try {
        if (!response.headersSent) send(response, 400, { error: "bad_request" });
        else response.end();
      } catch (writeError) {
        // The socket is already gone. Reported rather than swallowed: if this
        // line starts appearing, the failure above is not being seen by anyone.
        log("error", `could not answer ${request.method} ${request.url}: ${writeError.message}`);
      }
    }
  };
}

/**
 * Last line of defence. `guard` covers the request handlers, but a rejection
 * raised anywhere else — a scenario's timer, a stream callback — would still end
 * the process by default and take the participant's session with it.
 *
 * Staying up is the right trade for a training container, but only if staying
 * up is not the same as pretending nothing happened. Each fault is logged at
 * error level, served on `/api/logs`, and counted on `/healthz`: an app that
 * has taken an uncaught fault says so when asked whether it is well.
 */
const faults = [];

function recordFault(kind, detail) {
  const entry = log("error", `${kind}: ${detail}`);
  faults.push({ kind, detail, at: entry.at });
  if (faults.length > 20) faults.splice(0, faults.length - 20);
}

process.on("unhandledRejection", (reason) => {
  recordFault("unhandled rejection", reason instanceof Error ? reason.message : String(reason));
});
process.on("uncaughtException", (error) => {
  recordFault("uncaught exception", error.message);
});

const challenge = createServer(guard(async (request, response) => {
  const url = requestUrl(request.url, "http://board.local");
  const route = `${request.method} ${url.pathname}`;
  // Only routes the app actually serves are recorded. Observing before the
  // match would let anyone grow the set without bound by walking made-up paths.
  if (ROUTES.has(route)) observe(route);

  if (route === "GET /") {
    const config = readConfig();
    return sendHtml(response, 200, boardPage(config.value, allPosts()));
  }

  // Swagger UI の資産。 名前は固定 2 つだけを配る — パスを受け取って読む形にすると、
  // 板のプロセスから任意のファイルを読ませる穴になる。
  if (request.method === "GET" && SWAGGER_ASSETS.has(url.pathname)) {
    return sendAsset(response, url.pathname);
  }

  if (route === "GET /docs") {
    return sendHtml(response, 200, docsPage());
  }

  if (route === "GET /openapi.json") {
    return send(response, 200, openApiDocument(SCENARIO));
  }

  if (route === "GET /api/config") {
    const config = readConfig();
    return send(response, 200, { settings: config.value, ok: config.ok, error: config.error });
  }

  if (route === "PATCH /api/config") {
    const body = await readJson(request);
    if (body === TOO_LARGE) {
      return send(response, 413, { error: `body must be at most ${MAX_BODY_BYTES} bytes` });
    }
    const result = applyConfigChange(body);
    if (!result.ok) return send(response, 400, { error: "rejected", detail: result.problems });
    return send(response, 200, { settings: result.value });
  }

  if (route === "DELETE /api/config") {
    return send(response, 200, { settings: resetConfigChanges().value });
  }

  if (scenario.editableSettings && SETTINGS_ROUTES.includes(route)) {
    return handleSettings(route, request, response);
  }

  if (route === "GET /healthz") {
    const config = readConfig();
    const well = config.ok && faults.length === 0;
    return send(response, well ? 200 : 503, {
      ok: well,
      configFile: CONFIG_FILE,
      configError: config.error,
      faults,
    });
  }

  if (route === "GET /api/board") {
    const config = readConfig();
    return send(response, 200, {
      title: config.value.boardTitle,
      serial: BOARD_SERIAL,
      acceptingPosts: config.value.acceptingPosts,
      posts: allPosts(),
    });
  }

  if (route === "GET /api/logs") {
    const limit = Number(url.searchParams.get("limit") ?? 100);
    return send(response, 200, {
      lines: recentLines(Number.isFinite(limit) ? limit : 100),
    });
  }

  if (route === "GET /posture") {
    return send(response, 200, posture(scenario, scenario.postureContext?.() ?? {}));
  }

  if (route === "POST /api/posts") {
    const config = readConfig();
    if (!config.ok) {
      // Do not blame the flag when the file itself will not load: the
      // participant would go and set a value that is already set.
      log("warn", `post rejected: ${config.error}`);
      return send(response, 503, { error: "config_unreadable", detail: config.error });
    }
    if (config.value.acceptingPosts !== true) {
      log("warn", "post rejected: the board is not accepting posts");
      return send(response, 409, {
        error: "board_closed",
        detail: `set acceptingPosts to true in ${CONFIG_HINT}`,
      });
    }
    const body = await readJson(request);
    if (body === TOO_LARGE) {
      return send(response, 413, { error: `body must be at most ${MAX_BODY_BYTES} bytes` });
    }
    const submitted = validatePost(body);
    if (!submitted.ok) return send(response, 400, { error: submitted.error });
    const post = addPost(submitted.post, new Date().toISOString());
    log("info", `post accepted id=${post.id} author=${post.author}`);
    return send(response, 201, { post });
  }

  const scenarioHandler = Object.hasOwn(scenarioRoutes, route) ? scenarioRoutes[route] : undefined;
  if (typeof scenarioHandler === "function") {
    return scenarioHandler(request, response, url);
  }

  return send(response, 404, { error: "not_found" });
}));

/**
 * `/verify` — the scorer delegate. The request carries a `checkpointId` the
 * response must echo back; the platform fails closed on a mismatch so a verdict
 * can never be credited to the wrong checkpoint.
 */
const verify = createServer(guard(async (request, response) => {
  if (request.method === "GET" && (request.url ?? "/") === "/healthz") {
    return send(response, 200, { status: "ok" });
  }
  if (request.method !== "POST" || (request.url ?? "/") !== "/verify") {
    return send(response, 404, { error: "not_found" });
  }
  const parsed = await readJson(request);
  const body = parsed === null || parsed === TOO_LARGE ? {} : parsed;
  const checkpointId = typeof body.checkpointId === "string" ? body.checkpointId : "";
  const submission = typeof body.submission === "string" ? body.submission : "";
  const declared = scenario.checks ?? {};
  // Own properties only. A plain object inherits `constructor`, `toString` and
  // friends, so a bare lookup would find a function for checkpoint ids nobody
  // declared and call it instead of failing closed.
  const handler = Object.hasOwn(declared, checkpointId) ? declared[checkpointId] : undefined;
  if (typeof handler !== "function") {
    return send(response, 400, { checkpointId, error: "unknown_checkpoint" });
  }
  let correct = false;
  try {
    correct = (await handler(submission)) === true;
  } catch (error) {
    log("error", `checkpoint ${checkpointId} failed to evaluate: ${error.message}`);
    correct = false;
  }
  return send(response, 200, {
    checkpointId,
    correct,
    message: correct ? "確認しました。" : "まだです。もう一度確かめてみてください。",
  });
}));

challenge.listen(CHALLENGE_PORT, "0.0.0.0", () => {
  log("info", `scenario=${SCENARIO} serial=${BOARD_SERIAL}`);
  log("info", `boot ok boot-check=${BOOT_CHECK}`);
  log("info", `board listening on :${CHALLENGE_PORT}`);
});
verify.listen(VERIFY_PORT, "0.0.0.0", () => log("info", `verify listening on :${VERIFY_PORT}`));
