import { createServer } from "node:http";
import { evaluateRequest } from "./policy.mjs";

const HEADER_LIMIT = 8 * 1024;
const PORT = Number(process.env.PORT || 8080);
const RUNTIME_POLICY = Object.freeze({
  canonicalOrigin: "https://mcp.example.test",
  developmentOrigin: "http://127.0.0.1:18110",
});
const SECURITY_HEADERS = Object.freeze({
  "cache-control": "no-store",
  "content-security-policy":
    "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self' http://127.0.0.1:18111 http://localhost:18111; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
});

function requestUrl(target) {
  try {
    return new URL(String(target ?? "/").replace(/^\/+/, "/"), "http://127.0.0.1");
  } catch {
    return new URL("http://127.0.0.1/__malformed_request__");
  }
}

function send(response, status, contentType, body, extra = {}) {
  response.writeHead(status, {
    ...SECURITY_HEADERS,
    "content-type": contentType,
    "content-length": Buffer.byteLength(body),
    ...extra,
  });
  response.end(body);
}

function sendJson(response, status, payload, extra = {}) {
  send(response, status, "application/json; charset=utf-8", JSON.stringify(payload), extra);
}

const HOME = `<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>Origin Guardian</title><style>
body{font-family:system-ui;max-width:880px;margin:2rem auto;padding:0 1rem;line-height:1.6;background:#07131d;color:#e9f4fa}
section{background:#102331;border:1px solid #294455;border-radius:12px;padding:1rem;margin:1rem 0}
textarea,pre{width:100%;box-sizing:border-box;background:#03090d;color:#d8f0f7;border:1px solid #385767;border-radius:8px;padding:.8rem}
textarea{min-height:9rem}button{margin:.3rem;padding:.6rem 1rem;border-radius:8px;border:1px solid #66cddd;background:#164458;color:white}
code{color:#ffd27a}.muted{color:#a9bec9}
</style></head><body>
<h1>MCP Origin Guardian</h1>
<p>受信したHostをそのまま信頼済みoriginにしているresource serverを監査します。実credentialや外部networkは使いません。</p>
<section><h2>1. 観察</h2><button id="inspect">脆弱な応答を比較</button><pre id="observation">未実行</pre></section>
<section><h2>2. Policy</h2><p class="muted">運用者が承認したproduction originを固定し、development例外を分離してください。</p>
<textarea id="policy">{
  "canonicalOrigin": "$request",
  "developmentOrigin": "$request"
}</textarea>
<button id="test">公開ケースを実行</button><button id="prepare">提出値を作る</button><pre id="result">未実行</pre></section>
<section><h2>3. Portalへ提出</h2><pre id="submission">公開ケース成功後に生成されます。</pre></section>
<script src="/app.js"></script></body></html>`;

const APP = `const byId=(id)=>document.getElementById(id);
const verifierOrigin=location.hostname==="localhost"?"http://localhost:18111":"http://127.0.0.1:18111";
async function call(origin,path,body){const r=await fetch(origin+path,{method:body?"POST":"GET",headers:body?{"content-type":"application/json"}:{},body:body?JSON.stringify(body):undefined});const value=await r.json();if(!r.ok)throw new Error(value.error||String(r.status));return value}
function policy(){try{return JSON.parse(byId("policy").value)}catch{return null}}
byId("inspect").onclick=async()=>{try{byId("observation").textContent=JSON.stringify(await call("","/api/inspect"),null,2)}catch(error){byId("observation").textContent=String(error)}};
byId("test").onclick=async()=>{try{byId("result").textContent=JSON.stringify(await call(verifierOrigin,"/public-test",{policy:policy()}),null,2)}catch(error){byId("result").textContent=String(error)}};
byId("prepare").onclick=async()=>{try{const r=await call(verifierOrigin,"/prepare",{policy:policy()});byId("result").textContent=JSON.stringify(r.report,null,2);byId("submission").textContent=r.submission||"公開ケースをすべて通してください。"}catch(error){byId("result").textContent=String(error)}};
`;

const server = createServer({ maxHeaderSize: HEADER_LIMIT }, (request, response) => {
  const url = requestUrl(request.url);
  if (request.method === "GET" && url.pathname === "/healthz") {
    return sendJson(response, 200, { status: "ok" });
  }
  if (request.method === "GET" && url.pathname === "/") {
    return send(response, 200, "text/html; charset=utf-8", HOME);
  }
  if (request.method === "GET" && url.pathname === "/app.js") {
    return send(response, 200, "text/javascript; charset=utf-8", APP);
  }
  if (request.method === "GET" && url.pathname === "/api/inspect") {
    const attackerHost = "attacker.example";
    return sendJson(response, 200, {
      request: { host: attackerHost, origin: "https://attacker.example" },
      vulnerable: {
        allowedHost: attackerHost,
        resource: `https://${attackerHost}`,
        explanation: "both values came from the same untrusted request",
      },
    });
  }

  if (request.method === "GET" && url.pathname === "/.well-known/oauth-protected-resource") {
    const host = String(request.headers.host ?? "").toLowerCase();
    const result = evaluateRequest(RUNTIME_POLICY, {
      environment:
        host === "127.0.0.1:18110" || host === "localhost:18110"
          ? "development"
          : "production",
      host,
      origin: request.headers.origin,
      forwardedHost: request.headers["x-forwarded-host"],
    });
    if (!result.accepted) {
      return sendJson(
        response,
        403,
        { error: result.reason },
        {
          "www-authenticate":
            'Bearer resource_metadata="https://mcp.example.test/.well-known/oauth-protected-resource"',
        },
      );
    }
    return sendJson(response, 200, {
      resource: result.metadataResource,
      authorization_servers: ["https://auth.example.test"],
    });
  }
  return sendJson(response, 404, { error: "not_found" });
});

server.requestTimeout = 10_000;
server.headersTimeout = 10_000;
server.listen(PORT, "0.0.0.0");
