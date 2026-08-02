import { createServer } from "node:http";
import {
  decodeSubmission,
  encodeSubmission,
  evaluateRequest,
  gradePolicy,
} from "./policy.mjs";

const LIMIT = 32 * 1024;

function requestUrl(target, base) {
  try {
    return new URL(String(target ?? "/").replace(/^\\/+/, "/"), base);
  } catch {
    return new URL("/__malformed_request__", base);
  }
}
const headers = {
  "cache-control": "no-store",
  "content-security-policy":
    "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'",
  "x-content-type-options": "nosniff",
};

function send(response, status, type, body, extra = {}) {
  response.writeHead(status, { ...headers, "content-type": type, ...extra });
  response.end(body);
}

function readJson(request) {
  return new Promise((resolve) => {
    const chunks = [];
    let size = 0;
    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > LIMIT) {
        request.destroy();
        resolve(null);
      } else {
        chunks.push(chunk);
      }
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

const HOME = `<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>Origin Guardian</title><style>
body{font-family:system-ui;max-width:880px;margin:2rem auto;padding:0 1rem;line-height:1.6;background:#07131d;color:#e9f4fa}
section{background:#102331;border:1px solid #294455;border-radius:12px;padding:1rem;margin:1rem 0}
textarea,pre{width:100%;box-sizing:border-box;background:#03090d;color:#d8f0f7;border:1px solid #385767;border-radius:8px;padding:.8rem}
textarea{min-height:9rem}button{margin:.3rem;padding:.6rem 1rem;border-radius:8px;border:1px solid #66cddd;background:#164458;color:white}
code{color:#ffd27a} .muted{color:#a9bec9}
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
async function call(path,body){const r=await fetch(path,{method:body?"POST":"GET",headers:body?{"content-type":"application/json"}:{},body:body?JSON.stringify(body):undefined});return r.json()}
function policy(){try{return JSON.parse(byId("policy").value)}catch{return null}}
byId("inspect").onclick=async()=>{byId("observation").textContent=JSON.stringify(await call("/api/inspect"),null,2)};
byId("test").onclick=async()=>{byId("result").textContent=JSON.stringify(await call("/api/test",{policy:policy()}),null,2)};
byId("prepare").onclick=async()=>{const r=await call("/api/prepare",{policy:policy()});byId("result").textContent=JSON.stringify(r.report,null,2);byId("submission").textContent=r.submission||"公開ケースをすべて通してください。"};
`;

const challenge = createServer(async (request, response) => {
  const url = requestUrl(request.url, "http://127.0.0.1");
  if (request.method === "GET" && url.pathname === "/healthz") {
    return send(response, 200, "application/json", JSON.stringify({ status: "ok" }));
  }
  if (request.method === "GET" && url.pathname === "/") {
    return send(response, 200, "text/html; charset=utf-8", HOME);
  }
  if (request.method === "GET" && url.pathname === "/app.js") {
    return send(response, 200, "text/javascript; charset=utf-8", APP);
  }
  if (request.method === "GET" && url.pathname === "/api/inspect") {
    const attackerHost = "attacker.example";
    return send(
      response,
      200,
      "application/json",
      JSON.stringify({
        request: { host: attackerHost, origin: "https://attacker.example" },
        vulnerable: {
          allowedHost: attackerHost,
          resource: `https://${attackerHost}`,
          explanation: "both values came from the same untrusted request",
        },
      }),
    );
  }
  if (request.method === "POST" && ["/api/test", "/api/prepare"].includes(url.pathname)) {
    const body = await readJson(request);
    if (!body) return send(response, 400, "application/json", JSON.stringify({ error: "invalid_json" }));
    const report = gradePolicy(body.policy);
    const payload = { report };
    if (url.pathname === "/api/prepare" && report.correct) {
      payload.submission = encodeSubmission(body.policy);
    }
    return send(response, 200, "application/json", JSON.stringify(payload));
  }

  if (request.method === "GET" && url.pathname === "/.well-known/oauth-protected-resource") {
    const policy = {
      canonicalOrigin: "https://mcp.example.test",
      developmentOrigin: "http://127.0.0.1:18110",
    };
    const result = evaluateRequest(policy, {
      environment:
        String(request.headers.host ?? "").toLowerCase() === "127.0.0.1:18110"
          ? "development"
          : "production",
      host: request.headers.host,
      origin: request.headers.origin,
      forwardedHost: request.headers["x-forwarded-host"],
    });
    if (!result.accepted) {
      return send(
        response,
        403,
        "application/json",
        JSON.stringify({ error: result.reason }),
        {
          "www-authenticate":
            'Bearer resource_metadata="https://mcp.example.test/.well-known/oauth-protected-resource"',
        },
      );
    }
    return send(
      response,
      200,
      "application/json",
      JSON.stringify({
        resource: result.metadataResource,
        authorization_servers: ["https://auth.example.test"],
      }),
    );
  }
  return send(response, 404, "application/json", JSON.stringify({ error: "not_found" }));
});

const verify = createServer(async (request, response) => {
  if (request.method !== "POST" || request.url !== "/verify") {
    return send(response, 404, "application/json", JSON.stringify({ error: "not_found" }));
  }
  const body = await readJson(request);
  const policy = decodeSubmission(body?.submission);
  const report = policy ? gradePolicy(policy) : { correct: false };
  return send(
    response,
    200,
    "application/json",
    JSON.stringify({
      correct: report.correct === true,
      message: report.correct ? "Canonical authority policy accepted." : "The policy still trusts an unsafe authority.",
    }),
  );
});

challenge.listen(8080, "0.0.0.0");
verify.listen(8081, "0.0.0.0");
