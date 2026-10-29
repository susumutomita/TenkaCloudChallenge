import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { createContext, runInContext } from "node:vm";

/**
 * xss-demo — a DELIBERATELY VULNERABLE training target for TenkaCloud local
 * play. It is stored-XSS-injectable on purpose (IPA "安全なウェブサイトの作り方",
 * §1.5 クロスサイト・スクリプティング対策). Never expose it off loopback; the
 * compose file binds it to 127.0.0.1 only.
 *
 * Two servers run in one process:
 *   :8080  the challenge surface the participant attacks (bulletin board + admin review)
 *   :8081  the loopback `/verify` endpoint the TenkaCloud scorer delegates to
 *
 * The flag is derived from FLAG_SEED at runtime, so nothing secret is
 * committed and each deploy is unique.
 */

/**
 * Parse a request target without letting a malformed one end the process.
 *
 * `GET //` is a protocol-relative reference with no host, and `new URL` rejects
 * it. This app serves its challenge surface and its `/verify` scorer from one
 * process, so an unguarded parse in the handler takes both down over a stray
 * slash. Leading slashes are collapsed (which is what the client meant) and
 * anything still unparseable becomes a target the router will not match, so a
 * malformed request is a 404 rather than a crash.
 */
function requestUrl(target, base) {
  try {
    return new URL(String(target ?? "/").replace(/^\/+/, "/"), base);
  } catch {
    return new URL("/__malformed_request__", base);
  }
}

const FLAG_SEED = process.env.FLAG_SEED ?? "local-dev-seed";
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const FLAG = `TC{xss_${sha256(`flag:${FLAG_SEED}`).slice(0, 20)}}`;

/** @type {{ name: string, message: string }[]} */
const posts = [];

/**
 * The vulnerability: a stored post's `message` is spliced straight into the
 * HTML the reviewer renders, with no escaping. A `<script>` in a message runs
 * as if the reviewer had typed it themselves.
 */
function renderBoard() {
  const items = posts
    .map((p) => `<li><strong>${p.name}</strong>: ${p.message}</li>`)
    .join("\n");
  return `<!doctype html>
<html lang="ja"><head><meta name="color-scheme" content="light dark"><meta charset="utf-8"><title>スタッフ掲示板</title>
<style>
  body{font-family:system-ui,sans-serif;max-width:36rem;margin:2.5rem auto;padding:0 1rem;line-height:1.5}
  h1{font-size:1.4rem;margin-bottom:.4rem}
  .muted{color:#555;font-size:.95rem}
  .panel{border:1px solid #ccc;border-radius:8px;padding:1rem;margin:1.25rem 0;background:#fafafa}
  .panel h2{font-size:1.05rem;margin:0 0 .6rem}
  button{font:inherit;padding:.4rem .8rem;cursor:pointer}
  .note{font-size:.9rem;color:#333;margin:.4rem 0 .8rem}
  code{font-size:.9em}
</style>
</head>
<body>
<h1>Acme スタッフ掲示板</h1>
<p class="muted">チームへのメモを投稿できます。セキュリティ担当が新しい投稿を確認します。</p>
<form method="post" action="/post">
  <p><label>名前 <input name="name"></label></p>
  <p><label>メッセージ <input name="message" style="width:100%"></label></p>
  <p><button type="submit">投稿する</button></p>
</form>
<ul>
${items}
</ul>

<section class="panel" aria-labelledby="review-heading">
  <h2 id="review-heading">セキュリティ担当の巡回</h2>
  <p class="note">担当は自動では回りません。下のボタンで巡回を依頼してください。担当のブラウザは投稿の中の <code>&lt;script&gt;...&lt;/script&gt;</code> だけを実行し、その中で呼ばれた <code>fetch</code> の内容だけを受信ログに残します（他のタグやイベント属性は扱いません）。</p>
  <form method="post" action="/admin/report">
    <button type="submit">巡回を依頼</button>
  </form>
</section>

<section class="panel" aria-labelledby="captured-heading">
  <h2 id="captured-heading">受信ログ</h2>
  <p class="note">巡回中にスクリプトが送った <code>fetch</code> の記録です。合言葉は <code>TC{...}</code> の形です。ポータルの提出欄には <code>TC{...}</code> だけを入れてください。</p>
  <p><a href="/admin/captured">受信ログを開く</a></p>
</section>
</body></html>`;
}

/**
 * Captured "outbound" calls the sandboxed reviewer session made. Stands in
 * for the attacker's own listener server — since this is an offline drill
 * with no second origin to exfiltrate to, every simulated network call the
 * reviewed script makes is logged here instead.
 * @type {{ url: string, body: string | undefined }[]}
 */
const capturedRequests = [];

/**
 * Simulates a security reviewer opening the board. Any `<script>` content in
 * a stored post runs as if the reviewer's own browser had loaded it, with a
 * `document.cookie` holding the reviewer's session and a `fetch` that stands
 * in for the reviewer's real network access. A 200ms timeout bounds a
 * runaway/looping submission.
 */
function runReviewerSession() {
  const html = renderBoard();
  const scripts = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]);
  const sandbox = {
    document: { cookie: `session=${FLAG}` },
    fetch: (url, opts) => {
      capturedRequests.push({ url: String(url), body: opts?.body ? String(opts.body) : undefined });
      return Promise.resolve({ ok: true });
    },
    console: { log: () => {} },
  };
  // microtaskMode: "afterEvaluate" is required for the timeout below to bound
  // a microtask-recursion loop (e.g. `function spin(){Promise.resolve().then(spin)}`).
  // Without it, `timeout` only cuts off synchronous execution — a promise-based
  // loop returns immediately and then spins forever in the microtask queue,
  // starving the shared event loop (:8080 and :8081 run in one process).
  const context = createContext(sandbox, { microtaskMode: "afterEvaluate" });
  for (const script of scripts) {
    try {
      runInContext(script, context, { timeout: 200 });
    } catch {
      // A throwing/looping submission just fails to run — no crash, no leak.
    }
  }
  return scripts.length;
}

function readBody(request) {
  return new Promise((resolve) => {
    const chunks = [];
    let bytes = 0;
    request.on("data", (chunk) => {
      bytes += chunk.length;
      if (bytes > 64 * 1024) {
        request.destroy();
        resolve("");
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", () => resolve(""));
  });
}

function parsePost(contentType, raw) {
  if (contentType.includes("application/json")) {
    try {
      const body = JSON.parse(raw);
      return { name: String(body.name ?? ""), message: String(body.message ?? "") };
    } catch {
      return { name: "", message: "" };
    }
  }
  const params = new URLSearchParams(raw);
  return { name: params.get("name") ?? "", message: params.get("message") ?? "" };
}

function send(response, status, contentType, body) {
  response.writeHead(status, { "content-type": contentType });
  response.end(body);
}

/** Browser form navigations send Accept: text/html; curl/API clients usually prefer JSON. */
function wantsHtml(request) {
  const accept = String(request.headers.accept ?? "");
  return accept.includes("text/html");
}

const challenge = createServer(async (request, response) => {
  const url = requestUrl(request.url, "http://127.0.0.1");
  if (request.method === "GET" && url.pathname === "/healthz") {
    return send(response, 200, "application/json", JSON.stringify({ status: "ok" }));
  }
  if (request.method === "GET" && url.pathname === "/") {
    return send(response, 200, "text/html; charset=utf-8", renderBoard());
  }
  if (request.method === "POST" && url.pathname === "/post") {
    const raw = await readBody(request);
    const { name, message } = parsePost(request.headers["content-type"] ?? "", raw);
    if (!name || !message) {
      return send(response, 400, "application/json", JSON.stringify({ error: "invalid_post" }));
    }
    posts.push({ name, message });
    if (wantsHtml(request)) {
      response.writeHead(303, { location: "/" });
      return response.end();
    }
    return send(response, 200, "application/json", JSON.stringify({ ok: true }));
  }
  if (request.method === "POST" && url.pathname === "/admin/report") {
    const scriptCount = runReviewerSession();
    if (wantsHtml(request)) {
      const html = `<!doctype html><html lang="ja"><meta charset="utf-8"><title>巡回完了</title>
<body style="font-family:system-ui;max-width:36rem;margin:2rem auto;padding:0 1rem">
<h1>巡回完了</h1>
<p>実行された script 数: ${scriptCount}</p>
<p><a href="/admin/captured">受信ログを開く</a> · <a href="/">掲示板に戻る</a></p>
</body></html>`;
      return send(response, 200, "text/html; charset=utf-8", html);
    }
    return send(response, 200, "application/json", JSON.stringify({ ok: true, scriptCount }));
  }
  if (request.method === "GET" && url.pathname === "/admin/captured") {
    if (wantsHtml(request)) {
      const rows = capturedRequests.length === 0
        ? "<p>(まだ記録はありません。掲示板で巡回を依頼すると、スクリプトが呼んだ fetch がここに残ります。)</p>"
        : "<ol>" + capturedRequests.map((c) =>
            `<li><div>url: <code>${String(c.url).replaceAll("<","&lt;")}</code></div>` +
            `<div>body: <code>${String(c.body ?? "(なし)").replaceAll("<","&lt;")}</code></div></li>`
          ).join("") + "</ol>";
      const html = `<!doctype html><html lang="ja"><meta charset="utf-8"><title>受信ログ</title>
<body style="font-family:system-ui;max-width:36rem;margin:2rem auto;padding:0 1rem">
<h1>受信ログ</h1>
<p>合言葉は <code>TC{...}</code> の形です。ポータルにはその部分だけ提出してください。</p>
${rows}
<p><a href="/">掲示板に戻る</a></p>
</body></html>`;
      return send(response, 200, "text/html; charset=utf-8", html);
    }
    return send(response, 200, "application/json", JSON.stringify({ captured: capturedRequests }));
  }
  return send(response, 404, "application/json", JSON.stringify({ error: "not_found" }));
});

const verify = createServer(async (request, response) => {
  if (request.method !== "POST" || (request.url ?? "/") !== "/verify") {
    return send(response, 404, "application/json", JSON.stringify({ error: "not_found" }));
  }
  const raw = await readBody(request);
  let submission = "";
  try {
    submission = String(JSON.parse(raw).submission ?? "");
  } catch {
    submission = "";
  }
  let value = submission.trim();
  // Accept accidental key=/flag=/session= wrappers without revealing the answer.
  const prefixed = value.match(/^(?:key|flag|session)\s*=\s*(.+)$/i);
  if (prefixed) value = prefixed[1].trim();
  const correct = value === FLAG;
  // The failure message must not leak the expected flag or scoring internals.
  send(
    response,
    200,
    "application/json",
    JSON.stringify({
      correct,
      message: correct ? "Flag accepted." : "That is not the flag for this challenge.",
    }),
  );
});

challenge.listen(8080, "0.0.0.0", () => console.log("challenge on :8080"));
verify.listen(8081, "0.0.0.0", () => console.log("verify on :8081"));
