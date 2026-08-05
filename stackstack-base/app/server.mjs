import { createServer } from "node:http";
import { addPost, allPosts, resetBoard, validatePost } from "./board.mjs";
import { applyConfigChange, CONFIG_FILE, readConfig, resetConfigChanges } from "./config.mjs";
import { log, recentLines } from "./log.mjs";
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
<p><a href="console"><strong>API コンソールを開く</strong></a> — ここから設定を変えたり投稿したりできます。ファイルを探して編集する必要はありません。</p>
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
 * 実行できる API 一覧。 板の説明に並んでいた行を、 そのまま押せる形にしたもの。
 *
 * Swagger UI や Redoc を CDN から読む方向は採らない — この板は loopback と Codespaces の
 * 転送ポートの両方から開かれ、 どちらもコンテナの外へ出られる保証が無い。 外部を引いた
 * 瞬間、 「動く環境と動かない環境がある」 という一番手間のかかる不具合になる。
 *
 * OpenAPI 文書を置いて別 UI に描かせる方向も採らない — この板の API は 8 本で、
 * 仕様書と実装が別々に old くなる余地を作るほうが高くつく。 ここが唯一の一覧。
 *
 * URL はすべて相対で、 この面は `/console` に置く。 `/api/console` に置く方向は採らない —
 * そこからの `api/board` は `/api/api/board` に解決してしまう。 先頭 `/` を付ける方向も
 * 採らない: Codespaces の転送も loopback もアプリを root に置くので今は動くが、 前段に
 * パスを足した瞬間に全部外れる。 板と同じ階層に置いておけば、 相対のまま両方で動く。
 */
function consolePage() {
  const calls = [
    { method: "GET", path: "api/board", note: "板の状態と投稿一覧" },
    { method: "GET", path: "api/config", note: "いまの設定" },
    {
      method: "PATCH",
      path: "api/config",
      note: "設定を変える",
      body: '{\n  "acceptingPosts": true\n}',
    },
    { method: "DELETE", path: "api/config", note: "変えた設定を捨てて初期状態に戻す" },
    {
      method: "POST",
      path: "api/posts",
      note: "投稿する",
      body: '{\n  "author": "you",\n  "title": "はじめての投稿",\n  "body": "本文"\n}',
    },
    { method: "GET", path: "posture", note: "いまの状態の実測結果" },
    { method: "GET", path: "api/logs", note: "アプリのログ" },
    { method: "GET", path: "healthz", note: "死活確認" },
  ];
  const cards = calls
    .map((call, index) => {
      const body =
        call.body === undefined
          ? ""
          : `<textarea id="b${index}" rows="${call.body.split("\n").length}" spellcheck="false">${escapeHtml(call.body)}</textarea>`;
      return `<article>
  <h3><code>${call.method}</code> <code>${escapeHtml(call.path)}</code></h3>
  <p>${escapeHtml(call.note)}</p>
  ${body}
  <p><button type="button" data-call="${index}">実行</button></p>
  <pre id="r${index}" class="out" aria-live="polite"></pre>
</article>`;
    })
    .join("\n");
  return `<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>API コンソール</title>
<style>
 body{font-family:system-ui;max-width:44rem;margin:2.5rem auto;line-height:1.7;padding:0 1rem}
 article{border:1px solid #ccd;border-radius:.5rem;padding:.75rem 1rem;margin:1rem 0}
 h3{margin:.2rem 0}
 textarea{width:100%;font-family:ui-monospace,monospace;font-size:.9rem}
 .out{background:#f4f6f8;padding:.6rem;border-radius:.4rem;white-space:pre-wrap;min-height:1.2rem;overflow-x:auto}
 button{font-size:1rem;padding:.35rem 1rem}
</style></head>
<body>
<h1>API コンソール</h1>
<p>この板の API をここから実行できます。設定の変更もここから行います
 — <strong>リポジトリのファイルは書き換えません</strong>。コンテナを作り直せば元に戻ります。</p>
<p><a href="./">板に戻る</a></p>
${cards}
<script>
const CALLS = ${JSON.stringify(calls.map(({ method, path, body }) => ({ method, path, hasBody: body !== undefined })))};
for (const button of document.querySelectorAll("button[data-call]")) {
  button.addEventListener("click", async () => {
    const index = Number(button.dataset.call);
    const call = CALLS[index];
    const out = document.querySelector("#r" + index);
    out.textContent = "…";
    const init = { method: call.method };
    if (call.hasBody) {
      init.headers = { "content-type": "application/json" };
      init.body = document.querySelector("#b" + index).value;
    }
    try {
      const response = await fetch(call.path, init);
      const text = await response.text();
      let shown = text;
      try { shown = JSON.stringify(JSON.parse(text), null, 2); } catch {}
      out.textContent = response.status + " " + response.statusText + "\\n" + shown;
    } catch (error) {
      out.textContent = "リクエストが届きませんでした: " + error;
    }
  });
}
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
  "GET /console",
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

  if (route === "GET /console") {
    return sendHtml(response, 200, consolePage());
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
