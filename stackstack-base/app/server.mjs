import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { addPost, allPosts, resetBoard, validatePost } from "./board.mjs";
import { applyConfigChange, CONFIG_FILE, readConfig, resetConfigChanges } from "./config.mjs";
import { log, recentLines } from "./log.mjs";
import {
  clearOverride,
  clearSource,
  readOverride,
  readSource,
  saveOverride,
  saveSource,
} from "./overrides.mjs";
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
 * この 1 リクエストで使う言語。
 *
 * cookie や localStorage で覚える方向は採らない — この板はサーバが 1 枚ずつ描く静的な
 * ページで、 リンクに `?lang=` を持たせれば選択はページからページへ運べる。 状態を 2 箇所
 * (ブラウザとリンク) に持つと、 どちらが勝つかという新しい問いが生まれるだけで得が無い。
 */
function pickLang(url, request) {
  const asked = url.searchParams.get("lang");
  if (asked === "ja" || asked === "en") return asked;
  const header = String(request.headers["accept-language"] ?? "");
  return header.trim().toLowerCase().startsWith("en") ? "en" : "ja";
}

/** 対訳を 1 組ずつ並べ、 その言語の側を返す。 辞書ファイルを別に持つほどの量ではない。 */
function bi(lang, ja, en) {
  return lang === "en" ? en : ja;
}

/**
 * Every URL on this page is relative. The board is reached through a forwarded
 * port in Codespaces and through loopback locally, and a hard-coded
 * `http://127.0.0.1:...` would work in exactly one of those.
 */
function boardPage(config, posts, lang) {
  const rows = posts
    .map(
      (post) => `<article>
      <h3>${escapeHtml(post.title)}</h3>
      <p class="meta">${escapeHtml(post.author)} — ${escapeHtml(post.at)}</p>
      <p>${escapeHtml(post.body)}</p>
    </article>`,
    )
    .join("\n");
  const api = [
    ["GET   ", "api/board", "板の状態と投稿一覧", "board state and every post"],
    ["GET   ", "api/logs", "アプリのログ", "the app's log"],
    ["GET   ", "posture", "いまの状態の実測結果", "the measured state, live"],
    ["GET   ", "healthz", "死活確認", "liveness"],
    ["POST  ", "api/posts", '投稿する  {"author":"...","title":"...","body":"..."}',
      'write a post  {"author":"...","title":"...","body":"..."}'],
    ["GET   ", "api/config", "いまの設定", "current settings"],
    ["PATCH ", "api/config", '設定を変える  {"acceptingPosts": true}',
      'change a setting  {"acceptingPosts": true}'],
    ["DELETE", "api/config", "変えた設定を捨てて初期状態に戻す",
      "discard changes and return to the initial state"],
  ]
    .map(([m, path, ja, en]) => `${m} ${path.padEnd(12)} ${bi(lang, ja, en)}`)
    .join("\n");
  const other = lang === "en" ? "ja" : "en";
  return `<!doctype html>
<html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(config.boardTitle)}</title></head>
<body style="font-family:system-ui;max-width:44rem;margin:2.5rem auto;line-height:1.7;padding:0 1rem">
<p style="text-align:right"><a href="?lang=${other}">${bi(lang, "English", "日本語")}</a></p>
<h1>${escapeHtml(config.boardTitle)}</h1>
<p>board serial: <code>${BOARD_SERIAL}</code></p>
<p>${bi(lang, "投稿の受付", "Accepting posts")}: <strong>${
    config.acceptingPosts
      ? bi(lang, "開いています", "open")
      : bi(lang, "閉じています", "closed")
  }</strong></p>
<h2>${bi(lang, "この板でできること", "What this board answers")}</h2>
<p><a href="docs?lang=${lang}"><strong>${bi(lang, "API コンソールを開く", "Open the API console")}</strong></a>
 — ${bi(
   lang,
   "ここから設定を変えたり投稿したりできます。ファイルを探して編集する必要はありません。",
   "Change settings and post from there. No file hunting required.",
 )}</p>
<pre>${api}</pre>
<h2>${bi(lang, "投稿", "Posts")}</h2>
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

/** scenario 固有の source を checkout に触れず、 実行中だけ差し替える。 */
async function handleSource(route, request, response) {
  const source = scenario.editableSource;
  if (route === "GET /api/source") {
    return send(response, 200, { source: readSource(source.name, source.basePath) });
  }
  if (route === "DELETE /api/source") {
    clearSource(source.name);
    log("info", `${source.name} source changes discarded`);
    return send(response, 200, { source: readSource(source.name, source.basePath) });
  }
  const body = await readJson(request);
  if (body === TOO_LARGE) {
    return send(response, 413, { error: `body must be at most ${MAX_BODY_BYTES} bytes` });
  }
  if (
    body === null ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    typeof body.source !== "string"
  ) {
    return send(response, 400, {
      error: "rejected",
      detail: ["the body must be a JSON object with a string source field"],
    });
  }
  const saved = saveSource(source.name, body.source);
  if (!saved.ok) return send(response, 500, { error: "rejected", detail: [saved.error] });
  log("info", `${source.name} source changed via API`);
  return send(response, 200, { source: readSource(source.name, source.basePath) });
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
function openApiDocument(scenarioName, lang) {
  const L = (ja, en) => bi(lang, ja, en);
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
        L(
        "この板の API です。 各項目の Try it out から実際に実行できます。 設定の変更もここから行い、 リポジトリのファイルは書き換えません。 コンテナを作り直せば変更は消えて元の状態に戻ります。",
        "The board's API. Run any entry with Try it out. Settings are changed from here too — no repository file is ever written. Rebuild the container and every change is gone.",
      ),
    },
    paths: {
      "/api/board": {
        get: { summary: L("板の状態と投稿一覧", "board state and every post"), responses: { 200: ok(L("板の状態", "board state")) } },
      },
      "/api/config": {
        get: { summary: L("いまの設定", "current settings"), responses: { 200: ok(L("設定", "settings")) } },
        patch: {
          summary: L("設定を変える", "change a setting"),
          requestBody: {
            required: true,
            ...json({ ...settings, example: { acceptingPosts: true } }),
          },
          responses: { 200: ok(L("変更後の設定", "settings after the change")), 400: ok(L("受け付けられない値", "a value the app refuses")) },
        },
        delete: {
          summary: L("変えた設定を捨てて初期状態に戻す", "discard changes and return to the initial state"),
          responses: { 200: ok(L("戻した後の設定", "settings after the reset")) },
        },
      },
      "/api/posts": {
        post: {
          summary: L("投稿する", "write a post"),
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
              example: { author: "you", title: L("はじめての投稿", "first post"), body: L("本文", "body") },
            }),
          },
          responses: {
            201: ok(L("投稿できた", "posted")),
            409: ok(L("板が投稿を受け付けていない", "the board is not accepting posts")),
            503: ok(L("設定が読めない", "the config cannot be read")),
          },
        },
      },
      "/api/logs": { get: { summary: L("アプリのログ", "the app's log"), responses: { 200: ok(L("ログ", "log lines")) } } },
      "/posture": { get: { summary: L("いまの状態の実測結果", "the measured state, live"), responses: { 200: ok(L("実測", "measurements")) } } },
      "/healthz": { get: { summary: L("死活確認", "liveness"), responses: { 200: ok(L("健康", "healthy")), 503: ok(L("不調", "unwell")) } } },
      // scenario が設定を持つときだけ出す。 手で書き足す方向は採らない — 宣言と一覧が
      // 別々に古くなり、 Swagger に無い経路や、 経路の無い Swagger 項目が生まれる。
      ...(scenario.editableSettings
        ? {
            "/api/settings": {
              get: {
                summary: L(`${scenario.editableSettings.summary.ja}をみる`, `view the ${scenario.editableSettings.summary.en}`),
                responses: { 200: ok(L("いまの設定", "current values")) },
              },
              patch: {
                summary: L(`${scenario.editableSettings.summary.ja}を変える`, `change the ${scenario.editableSettings.summary.en}`),
                requestBody: {
                  required: true,
                  ...json({ type: "object", example: scenario.editableSettings.example }),
                },
                responses: { 200: ok(L("変更後", "after the change")), 400: ok(L("受け付けられない値", "a value the scenario refuses")) },
              },
              delete: {
                summary: L(`${scenario.editableSettings.summary.ja}の変更を捨てて初期状態に戻す`, `discard ${scenario.editableSettings.summary.en} changes and return to the initial state`),
                responses: { 200: ok(L("戻した後", "after the reset")) },
              },
            },
          }
        : {}),
      ...(scenario.editableSource
        ? {
            "/api/source": {
              get: {
                summary: L(
                  `${scenario.editableSource.summary.ja}をみる`,
                  `view the ${scenario.editableSource.summary.en}`,
                ),
                responses: { 200: ok(L("いまの source", "current source")) },
              },
              put: {
                summary: L(
                  `${scenario.editableSource.summary.ja}を置き換える`,
                  `replace the ${scenario.editableSource.summary.en}`,
                ),
                requestBody: {
                  required: true,
                  ...json({
                    type: "object",
                    required: ["source"],
                    properties: { source: { type: "string" } },
                    example: { source: scenario.editableSource.example },
                  }),
                },
                responses: { 200: ok(L("変更後", "after the change")), 400: ok(L("不正な要求", "invalid request")) },
              },
              delete: {
                summary: L(
                  `${scenario.editableSource.summary.ja}の変更を捨てて初期状態に戻す`,
                  `discard ${scenario.editableSource.summary.en} changes and return to the initial state`,
                ),
                responses: { 200: ok(L("戻した後", "after the reset")) },
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
function docsPage(lang) {
  const other = lang === "en" ? "ja" : "en";
  return `<!doctype html>
<html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${bi(lang, "API コンソール", "API console")}</title>
<link rel="stylesheet" href="vendor/swagger/swagger-ui.css">
<style>
:root{color-scheme:light}
body{margin:0;background:#fff;color:#0f141a}#note{font-family:system-ui;padding:.8rem 1.2rem;background:#eef4ff;line-height:1.6}
#request-workbench{font-family:system-ui;margin:1rem;padding:1rem;border:1px solid #ccd5e1;border-radius:.5rem}
#request-workbench label{display:block;font-weight:600;margin-top:.7rem}
#request-workbench input,#request-workbench select,#request-workbench textarea{box-sizing:border-box;width:100%;padding:.55rem;font:inherit}
#request-workbench textarea{min-height:5rem;font-family:ui-monospace,monospace}
#request-send{margin-top:.8rem;padding:.6rem 1rem;font:inherit}
#request-response{white-space:pre-wrap;overflow-wrap:anywhere;background:#111827;color:#f9fafb;padding:.8rem;min-height:3rem}
</style>
</head><body>
<div id="note">${bi(
    lang,
    "この板の API をここから実行できます (各項目の <strong>Try it out</strong>)。 設定の変更もここから行い、<strong>リポジトリのファイルは書き換えません</strong>。",
    "Run this board's API from here (<strong>Try it out</strong> on any entry). Settings are changed from here too — <strong>no repository file is ever written</strong>.",
  )}
 <a href="./?lang=${lang}">${bi(lang, "板に戻る", "Back to the board")}</a> ·
 <a href="docs?lang=${other}">${bi(lang, "English", "日本語")}</a></div>
<section id="request-workbench">
<h2>${bi(lang, "任意の API を試す", "Try any API")}</h2>
<p>${bi(
    lang,
    "下の一覧にない問題固有の API も、ここから同じブラウザ内で実行できます。ターミナルは要りません。",
    "Run scenario-specific APIs here even when they are not listed below. No terminal is required.",
  )}</p>
<label for="request-method">${bi(lang, "メソッド", "Method")}</label>
<select id="request-method"><option>GET</option><option>POST</option><option>PATCH</option><option>PUT</option><option>DELETE</option></select>
<label for="request-path">${bi(lang, "パス (query を含められます)", "Path (query allowed)")}</label>
<input id="request-path" value="/posture" spellcheck="false">
<label for="request-headers">${bi(lang, "ヘッダー (JSON)", "Headers (JSON)")}</label>
<textarea id="request-headers" spellcheck="false">{}</textarea>
<label for="request-body">${bi(lang, "body (必要なときだけ)", "Body (only when needed)")}</label>
<textarea id="request-body" spellcheck="false"></textarea>
<button id="request-send" type="button">${bi(lang, "実行", "Send")}</button>
<pre id="request-response" aria-live="polite"></pre>
</section>
<div id="ui"></div>
<script src="vendor/swagger/swagger-ui-bundle.js"></script>
<script>
SwaggerUIBundle({ url: "openapi.json?lang=${lang}", dom_id: "#ui", tryItOutEnabled: true, defaultModelsExpandDepth: -1 });
document.getElementById("request-send").addEventListener("click", async () => {
  const output = document.getElementById("request-response");
  output.textContent = ${JSON.stringify(bi(lang, "実行中…", "Sending…"))};
  try {
    const method = document.getElementById("request-method").value;
    const asked = document.getElementById("request-path").value.trim();
    const path = asked.startsWith("/") ? asked : "/" + asked;
    const target = new URL(path, window.location.origin);
    if (target.origin !== window.location.origin) throw new Error(${JSON.stringify(
      bi(lang, "同じアプリ内のパスを入力してください", "Enter a path inside this app"),
    )});
    const headers = JSON.parse(document.getElementById("request-headers").value || "{}");
    const body = document.getElementById("request-body").value;
    const options = { method, headers };
    if (body !== "" && method !== "GET" && method !== "HEAD") options.body = body;
    const response = await fetch(target.pathname + target.search, options);
    const text = await response.text();
    output.textContent = response.status + " " + response.statusText + ${JSON.stringify("\n\n")} + text;
  } catch (error) {
    output.textContent = ${JSON.stringify(bi(lang, "実行できません: ", "Could not send: "))} + error.message;
  }
});
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
const SOURCE_ROUTES = ["GET /api/source", "PUT /api/source", "DELETE /api/source"];

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
  ...(scenario.editableSource ? SOURCE_ROUTES : []),
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
    return sendHtml(response, 200, boardPage(config.value, allPosts(), pickLang(url, request)));
  }

  // Swagger UI の資産。 名前は固定 2 つだけを配る — パスを受け取って読む形にすると、
  // 板のプロセスから任意のファイルを読ませる穴になる。
  if (request.method === "GET" && SWAGGER_ASSETS.has(url.pathname)) {
    return sendAsset(response, url.pathname);
  }

  if (route === "GET /docs") {
    return sendHtml(response, 200, docsPage(pickLang(url, request)));
  }

  if (route === "GET /openapi.json") {
    return send(response, 200, openApiDocument(SCENARIO, pickLang(url, request)));
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

  if (scenario.editableSource && SOURCE_ROUTES.includes(route)) {
    return handleSource(route, request, response);
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
        detail: 'send {"acceptingPosts": true} to PATCH /api/config — the API console at /docs does it from the screen',
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
