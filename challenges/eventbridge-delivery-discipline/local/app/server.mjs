import { createServer } from "node:http";
import { POLICY_VOCABULARY, runStream, STARTER_POLICY } from "./engine.mjs";

const PORT = Number(process.env.PORT || 8080);
const HEADER_LIMIT = 8 * 1024;
const SECURITY_HEADERS = Object.freeze({
  "cache-control": "no-store",
  "content-security-policy":
    "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self' http://127.0.0.1:* http://localhost:* https://*.app.github.dev; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
});

const scenario = Object.freeze([
  { id: "created", deliveryId: "d-created", aggregateId: "order-42", version: 1, type: "OrderCreated", timestamp: "2026-01-01T00:00:01Z", data: { status: "created" } },
  { id: "paid", deliveryId: "d-paid-1", aggregateId: "order-42", version: 2, type: "PaymentCaptured", timestamp: "2026-01-01T00:00:02Z", data: { status: "paid", amount: 1200 } },
  { id: "paid", deliveryId: "d-paid-2", aggregateId: "order-42", version: 2, type: "PaymentCaptured", timestamp: "2026-01-01T00:00:03Z", data: { status: "paid", amount: 1200 } },
  { id: "old-created", deliveryId: "d-old", aggregateId: "order-42", version: 1, type: "OrderCreated", timestamp: "2026-01-01T00:00:04Z", data: { status: "created" } },
]);

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


/**
 * `POLICY_VOCABULARY` をそのまま画面の表にする (Issue 416)。
 *
 * ここで値をベタ書きし直さないのは、書き写した瞬間に validator とずれるからで、
 * ずれた表は「許容値が書かれていない」より悪い — 読んだ人が信じるぶん遠回りになる。
 */
function vocabularyRows() {
  const escape = (text) =>
    String(text).replace(/[&<>"]/g, (character) =>
      character === "&" ? "&amp;" : character === "<" ? "&lt;" : character === ">" ? "&gt;" : "&quot;",
    );
  const cell = (value) =>
    Array.isArray(value)
      ? value.map((item) => `<code>${escape(JSON.stringify(item))}</code>`).join(" / ")
      : escape(value);
  const rows = [];
  for (const [section, fields] of Object.entries(POLICY_VOCABULARY)) {
    if (Array.isArray(fields)) {
      rows.push(`<tr><td><code>${escape(section)}</code></td><td class="muted">(この語彙から重複なく選ぶ配列)</td><td>${cell(fields)}</td></tr>`);
      continue;
    }
    for (const [field, allowed] of Object.entries(fields)) {
      rows.push(`<tr><td><code>${escape(section)}</code></td><td><code>${escape(field)}</code></td><td>${cell(allowed)}</td></tr>`);
    }
  }
  return rows.join("");
}

const HOME = `<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>二度届いて、前後する — Browser Workbench</title><style>
:root{color-scheme:dark}body{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;max-width:1040px;margin:2rem auto;padding:0 1rem;line-height:1.55;background:#071019;color:#e7f3fb}
section{background:#0d2030;border:1px solid #29475c;border-radius:12px;padding:1rem;margin:1rem 0}textarea,pre{width:100%;box-sizing:border-box;background:#02070b;color:#d8eef9;border:1px solid #3a5f75;border-radius:8px;padding:.8rem;overflow:auto}textarea{min-height:31rem;tab-size:2}button{margin:.3rem;padding:.65rem 1rem;border-radius:8px;border:1px solid #71d6e5;background:#174b60;color:white;cursor:pointer}.muted{color:#abc2cf}.warn{color:#ffd07d}code{color:#8ee7f2}table{width:100%;border-collapse:collapse;margin-top:.6rem}th,td{border:1px solid #29475c;padding:.35rem .5rem;text-align:left;vertical-align:top;font-size:.9rem}th{color:#abc2cf}summary{cursor:pointer;color:#8ee7f2}
</style></head><body>
<h1>二度届いて、前後する</h1>
<p>EventBridge風の配送列を、event ID・aggregate version・bounded retry・DLQで扱う状態機械に直します。実AWS、credential、外向きnetworkは使いません。</p>
<section><h2>1. 壊れ方を観察</h2><p class="muted">到着順上書きconsumerで、重複課金とstate regressionを再現します。</p><button id="inspect">vulnerable streamを実行</button><pre id="observation">未実行</pre></section>
<section><h2>2. Delivery policyを修正</h2><p class="warn">timestamp sort、event IDだけ、versionだけでは全checkpointを満たせません。</p>
<details><summary>policy が受け付ける値 (7 セクション)</summary><p class="muted">どれを選ぶかがこの問題です。選択肢そのものは伏せません。<code>maxAttempts</code> 以外はすべてこの一覧の中から選びます。</p><table><thead><tr><th>セクション</th><th>フィールド</th><th>受け付ける値</th></tr></thead><tbody>${vocabularyRows()}</tbody></table></details><textarea id="policy"></textarea><button id="reset">starterへ戻す</button><button id="test">公開テスト</button><button id="prepare">提出値を作る</button><pre id="result">未実行</pre></section>
<section><h2>3. Participant Portalへ提出</h2><p class="muted">生成された値を6つのcheckpointへ同じまま提出します。graderは各checkpointを独立に再実行します。</p><pre id="submission">公開テスト成功後に生成されます。</pre></section>
<script src="/app.js"></script></body></html>`;

const APP = `const byId=(id)=>document.getElementById(id);
const starter=${JSON.stringify(STARTER_POLICY)};
function showStarter(){byId("policy").value=JSON.stringify(starter,null,2)}
function verifierOrigin(){const target=new URL(location.href);if(target.hostname==="127.0.0.1"||target.hostname==="localhost"){const port=Number(target.port);if(!Number.isInteger(port)||port<=0)throw new Error("Workbench port is missing");target.port=String(port+1);return target.origin}const match=target.hostname.match(/^(.*-)(\\d+)(\\.app\\.github\\.dev)$/);if(match){target.hostname=match[1]+String(Number(match[2])+1)+match[3];return target.origin}throw new Error("Unsupported Workbench origin")}
async function call(origin,path,body){const response=await fetch(origin+path,{method:body?"POST":"GET",headers:body?{"content-type":"application/json"}:{},body:body?JSON.stringify(body):undefined});const value=await response.json();if(!response.ok)throw new Error(value.error||String(response.status));return value}
function policy(){try{return JSON.parse(byId("policy").value)}catch{return null}}
byId("inspect").onclick=async()=>{try{byId("observation").textContent=JSON.stringify(await call("","/api/inspect"),null,2)}catch(error){byId("observation").textContent=String(error)}};
byId("reset").onclick=showStarter;
byId("test").onclick=async()=>{try{byId("result").textContent=JSON.stringify(await call(verifierOrigin(),"/public-test",{policy:policy()}),null,2)}catch(error){byId("result").textContent=String(error)}};
byId("prepare").onclick=async()=>{try{const value=await call(verifierOrigin(),"/prepare",{policy:policy()});byId("result").textContent=JSON.stringify(value.report,null,2);byId("submission").textContent=value.submission||"公開テストをすべて通してください。"}catch(error){byId("result").textContent=String(error)}};
showStarter();`;

const server = createServer({ maxHeaderSize: HEADER_LIMIT }, (request, response) => {
  const url = requestUrl(request.url);
  if (request.method === "GET" && url.pathname === "/healthz") return sendJson(response, 200, { status: "ok" });
  if (request.method === "GET" && url.pathname === "/") return send(response, 200, "text/html; charset=utf-8", HOME);
  if (request.method === "GET" && url.pathname === "/app.js") return send(response, 200, "text/javascript; charset=utf-8", APP);
  if (request.method === "GET" && url.pathname === "/api/inspect") {
    const state = runStream(STARTER_POLICY, scenario).state;
    return sendJson(response, 200, {
      inputOrder: scenario.map((item) => `${item.id}@v${item.version}`),
      outcomes: state.outcomes,
      finalState: state.aggregates["order-42"],
      sideEffects: state.sideEffects,
      observations: ["PaymentCaptured was charged twice", "late OrderCreated regressed the aggregate to version 1"],
    });
  }
  return sendJson(response, 404, { error: "not_found" });
});

server.requestTimeout = 10_000;
server.headersTimeout = 10_000;
server.listen(PORT, "0.0.0.0");
