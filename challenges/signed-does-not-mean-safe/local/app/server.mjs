import { createServer } from "node:http";
import { inspectStarter, PUBLIC_FIXTURES, STARTER_TRIAGE } from "./engine.mjs";

const PORT = Number(process.env.PORT || 8080);
const HEADER_LIMIT = 8 * 1024;
const SECURITY_HEADERS = Object.freeze({
  "cache-control": "no-store",
  "content-security-policy":
    "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self' http://127.0.0.1:* http://localhost:* https://*.app.github.dev; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
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

function send(response, status, contentType, body) {
  response.writeHead(status, {
    ...SECURITY_HEADERS,
    "content-type": contentType,
    "content-length": Buffer.byteLength(body),
  });
  response.end(body);
}

function sendJson(response, status, payload) {
  send(response, status, "application/json; charset=utf-8", JSON.stringify(payload));
}

const HOME = `<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>署名済みなら、安全？ — Browser Workbench</title><style>
:root{color-scheme:dark}body{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;max-width:1060px;margin:2rem auto;padding:0 1rem;line-height:1.55;background:#0b1020;color:#eef4ff}
section{background:#131b31;border:1px solid #35507a;border-radius:12px;padding:1rem;margin:1rem 0}textarea,pre{width:100%;box-sizing:border-box;background:#050912;color:#dcecff;border:1px solid #45638f;border-radius:8px;padding:.8rem;overflow:auto}textarea{min-height:26rem;tab-size:2}button{margin:.3rem;padding:.65rem 1rem;border-radius:8px;border:1px solid #8fb8ff;background:#1b3f6e;color:white;cursor:pointer}.muted{color:#b0c4e0}.warn{color:#ffd27f}code{color:#9cc8ff}
</style></head><body>
<h1>署名済みなら、安全？</h1>
<p>上流 registry の乗っ取りで、provenance 付きの改ざん版が正規 pipeline から公開されました。attestation・lockfile・tarball inventory・host evidence を観察し、triage policy を修正します。実 package・実 credential・悪性 code・外向き network は使いません。</p>
<section><h2>1. fixture と starter の見落としを観察</h2><p class="muted">attestation は「どこで・誰が・どの source から build したか」を束縛します。starter policy は valid な attestation を安全と同一視し、known-bad-name の denylist だけを見ています。</p><button id="fixtures">fixture を表示</button><button id="inspect">starter の盲点を表示</button><pre id="observation">未実行</pre></section>
<section><h2>2. triage policy を修正</h2><p class="warn">valid な attestation は source が無害であることを保証しません。lockfile の解決結果・tarball の差分・lifecycle script・実行 evidence を、それぞれ独立した判定として宣言します。</p><textarea id="triage"></textarea><button id="reset">starter へ戻す</button><button id="test">公開テスト</button><button id="prepare">提出値を作る</button><pre id="result">未実行</pre></section>
<section><h2>3. Participant Portal へ提出</h2><p class="muted">生成値を 6 checkpoint へ同じまま提出します。hidden matrix は依存 graph を並べ替え、無関係な script を足し、clean な package を混ぜて再評価します。</p><pre id="submission">公開テスト成功後に生成されます。</pre></section>
<script src="/app.js"></script></body></html>`;

const APP = `const byId=(id)=>document.getElementById(id);
const starter=${JSON.stringify(STARTER_TRIAGE)};
function showStarter(){byId("triage").value=JSON.stringify(starter,null,2)}
function verifierOrigin(){const target=new URL(location.href);if(target.hostname==="127.0.0.1"||target.hostname==="localhost"){const port=Number(target.port);if(!Number.isInteger(port)||port<=0)throw new Error("Workbench port is missing");target.port=String(port+1);return target.origin}const match=target.hostname.match(/^(.*-)(\\d+)(\\.app\\.github\\.dev)$/);if(match){target.hostname=match[1]+String(Number(match[2])+1)+match[3];return target.origin}throw new Error("Unsupported Workbench origin")}
async function call(origin,path,body){const response=await fetch(origin+path,{method:body?"POST":"GET",headers:body?{"content-type":"application/json"}:{},body:body?JSON.stringify(body):undefined});const value=await response.json();if(!response.ok)throw new Error(value.error||String(response.status));return value}
function triage(){try{return JSON.parse(byId("triage").value)}catch{return null}}
byId("fixtures").onclick=async()=>{try{byId("observation").textContent=JSON.stringify(await call("","/api/fixtures"),null,2)}catch(error){byId("observation").textContent=String(error)}};
byId("inspect").onclick=async()=>{try{byId("observation").textContent=JSON.stringify(await call("","/api/inspect"),null,2)}catch(error){byId("observation").textContent=String(error)}};
byId("reset").onclick=showStarter;
byId("test").onclick=async()=>{try{byId("result").textContent=JSON.stringify(await call(verifierOrigin(),"/public-test",{triage:triage()}),null,2)}catch(error){byId("result").textContent=String(error)}};
byId("prepare").onclick=async()=>{try{const value=await call(verifierOrigin(),"/prepare",{triage:triage()});byId("result").textContent=JSON.stringify(value.report,null,2);byId("submission").textContent=value.submission||"公開テストをすべて通してください。"}catch(error){byId("result").textContent=String(error)}};
showStarter();`;

const server = createServer({ maxHeaderSize: HEADER_LIMIT }, (request, response) => {
  const url = requestUrl(request.url);
  if (request.method === "GET" && url.pathname === "/healthz") return sendJson(response, 200, { status: "ok" });
  if (request.method === "GET" && url.pathname === "/") return send(response, 200, "text/html; charset=utf-8", HOME);
  if (request.method === "GET" && url.pathname === "/app.js") return send(response, 200, "text/javascript; charset=utf-8", APP);
  if (request.method === "GET" && url.pathname === "/api/inspect") return sendJson(response, 200, inspectStarter());
  if (request.method === "GET" && url.pathname === "/api/fixtures") return sendJson(response, 200, PUBLIC_FIXTURES);
  return sendJson(response, 404, { error: "not_found" });
});

server.requestTimeout = 10_000;
server.headersTimeout = 10_000;
server.listen(PORT, "0.0.0.0");
