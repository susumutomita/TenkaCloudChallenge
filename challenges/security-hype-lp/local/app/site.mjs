import { createServer } from "node:http";
import { pathToFileURL } from "node:url";

// This participant process receives rendered public artifacts only. It never owns a
// scenario, fixture seed, answer mapping, or grading implementation.
const PUBLIC_PATHS = new Set([
  "/", "/company", "/ir", "/evidence", "/evidence/", "/evidence/mail.eml",
  "/evidence/chat-log.txt", "/evidence/registry.html", "/evidence/whois.txt",
]);
const MAX_SURFACE_BYTES = 64 * 1024;
const RECEIPT = '<!doctype html><html lang="ja"><meta charset="utf-8"><title>(訓練) 送信を受け付けませんでした</title><main><h1>訓練用の架空サイトです</h1><p>実在する ID・パスワード・個人情報は入力しないでください。</p><p>入力内容は保存も転送もしていません。</p><p><a href="/">LP へ戻る</a></p></main></html>';

function send(response, status, type, body) {
  response.writeHead(status, {
    "content-type": type, "cache-control": "no-store",
    "x-content-type-options": "nosniff", "referrer-policy": "no-referrer",
  });
  response.end(body);
}

async function discardBody(request) {
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > 16 * 1024) throw new Error("too_large");
  }
}

async function readSurface(response) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of response.body) {
    bytes += chunk.length;
    if (bytes > MAX_SURFACE_BYTES) throw new Error("surface_too_large");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export function siteServer(verifierOrigin) {
  const origin = new URL(verifierOrigin);
  if (origin.protocol !== "http:" || origin.username || origin.password || origin.pathname !== "/" || origin.search || origin.hash) {
    throw new Error("VERIFIER_ORIGIN must be a plain internal HTTP origin");
  }
  const server = createServer(async (request, response) => {
    // Do not normalize attacker-controlled paths into permitted routes or accept full URLs.
    const path = typeof request.url === "string" ? request.url.split("?")[0] : "";
    const text = "text/plain; charset=utf-8";
    if (request.method === "POST" && path === "/diagnosis") {
      try { await discardBody(request); } catch { return send(response, 413, text, "request too large"); }
      return send(response, 200, "text/html; charset=utf-8", RECEIPT);
    }
    if (request.method !== "GET" && request.method !== "HEAD") return send(response, 405, text, "method not allowed");
    if (path !== "/healthz" && !PUBLIC_PATHS.has(path) && !/^\/assets\/stock\/\d{4}\.svg$/.test(path)) {
      return send(response, 404, text, "not found");
    }
    const upstream = new URL(path === "/healthz" ? "/healthz" : "/surface", origin);
    if (path !== "/healthz") upstream.searchParams.set("path", path);
    try {
      // No participant headers or body, no redirects, fixed origin, finite response budget.
      const result = await fetch(upstream, { redirect: "error", signal: AbortSignal.timeout(3000) });
      if (result.status === 404) return send(response, 404, text, "not found");
      if (result.status !== 200) throw new Error("surface_unavailable");
      const body = await readSurface(result);
      return send(response, 200, result.headers.get("content-type") || text, request.method === "HEAD" ? "" : body);
    } catch {
      return send(response, 503, text, "training surface unavailable");
    }
  });
  server.requestTimeout = 5000;
  server.headersTimeout = 5000;
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server = siteServer(process.env.VERIFIER_ORIGIN);
  server.listen(8080, "0.0.0.0", () => console.log("site on :8080"));
}
