/**
 * db-battle-slow-apparently — local-play container entrypoint (Node half, primary side).
 *
 * Same 2-server shape as every Database Track drill/Challenge (:8080 info,
 * :8081 loopback /verify) plus one addition this Battle needs: :8081 also
 * serves POST /diagnosis, the Phase 1 structured-evidence submission (see
 * local/grader/grade.mjs's file banner for why it's structured fields, not
 * free text). The background metrics sampler (local/app/pg-client.mjs)
 * starts as soon as the primary connection is up and runs for the whole
 * container lifetime.
 */
import { createServer } from "node:http";
import postgres from "postgres";
import { evaluateCheckpoint, isDiagnosisCorrect, isKnownCheckpoint } from "../grader/grade.mjs";
import { createPgGraderClient, recordDiagnosisSubmission, startMetricsSampler } from "./pg-client.mjs";

function requestUrl(target, base) {
  try {
    return new URL(String(target ?? "/").replace(/^\/+/, "/"), base);
  } catch {
    return new URL("/__malformed_request__", base);
  }
}

const DATABASE_URL = process.env.DATABASE_URL ?? "postgres://postgres@127.0.0.1:5432/incident";
const REPLICA_DATABASE_URL = process.env.REPLICA_DATABASE_URL ?? "postgres://postgres@replica:5432/incident";
const API_METRICS_URL = process.env.API_METRICS_URL ?? "http://api:3000/metrics";

const sqlPrimary = postgres(DATABASE_URL, { max: 4, onnotice: () => {} });
const sqlReplica = postgres(REPLICA_DATABASE_URL, { max: 2, onnotice: () => {}, connect_timeout: 5 });
const client = createPgGraderClient(sqlPrimary, sqlReplica);

startMetricsSampler(sqlPrimary, sqlReplica, API_METRICS_URL, 1000);

function send(response, status, body, contentType = "application/json") {
  response.writeHead(status, { "content-type": contentType });
  response.end(contentType === "application/json" ? JSON.stringify(body) : body);
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

const INFO_PAGE = `<!doctype html>
<html lang="ja"><head><meta name="color-scheme" content="light dark"><meta charset="utf-8">
<title>db-battle-slow-apparently</title></head>
<body style="font-family:system-ui;max-width:38rem;margin:3rem auto;line-height:1.6">
<h1>03:00 頃から注文 API の p99 latency が SLO を超えています</h1>
<p>一部ユーザーから「更新した内容がすぐ表示されない」という報告もあります。production traffic は
止められません。原因を特定し、サービスを正常状態へ戻してください。</p>
<p style="opacity:.8">運用メモ: DB CPU が高いようです。サイズ不足かもしれないので scale-up を
検討してください。</p>
<p>Portal のターミナルを開き (調査用の workstation コンテナに入ります)、
<code>psql -U participant -d incident</code> で接続して調査を始めてください。</p>
<p>現在の観測値は <a href="/status">/status</a> で確認できます (採点はしません)。</p>
</body></html>`;

const info = createServer(async (request, response) => {
  const url = requestUrl(request.url, "http://127.0.0.1");
  if (request.method === "GET" && url.pathname === "/healthz") {
    return send(response, 200, { status: "ok" });
  }
  if (request.method === "GET" && url.pathname === "/") {
    return send(response, 200, INFO_PAGE, "text/html; charset=utf-8");
  }
  if (request.method === "GET" && url.pathname === "/status") {
    try {
      const [samples, episodes, config] = await Promise.all([
        client.metricsSamples(),
        client.incidentEpisodes(),
        client.retentionConfig(),
      ]);
      return send(response, 200, {
        recentSamples: samples.slice(-20),
        episodes,
        retentionConfig: config,
      });
    } catch {
      return send(response, 503, { error: "database not ready yet" });
    }
  }
  return send(response, 404, { error: "not_found" });
});

const VALID_MECHANISMS = ["cpu-starvation", "bulk-delete-transaction", "disk-full", "network-partition", "application-bug"];
const VALID_TRIGGERS = ["manual-admin-action", "scheduled-retention-job", "traffic-spike", "unknown"];
const VALID_FIRST_ACTIONS = ["restart-primary", "stop-replica", "terminate-application-writes", "cancel-offending-transaction"];

async function handleDiagnosis(request, response) {
  const raw = await readBody(request);
  let body;
  try {
    body = JSON.parse(raw || "{}");
  } catch {
    return send(response, 400, { error: "invalid_json" });
  }
  const submission = {
    offendingPid: Number.isInteger(body.offendingPid) ? body.offendingPid : null,
    mechanism: VALID_MECHANISMS.includes(body.mechanism) ? body.mechanism : null,
    triggerSource: VALID_TRIGGERS.includes(body.triggerSource) ? body.triggerSource : null,
    firstAction: VALID_FIRST_ACTIONS.includes(body.firstAction) ? body.firstAction : null,
  };
  try {
    const validPids = await client.unsafePids();
    const correct = isDiagnosisCorrect(submission, validPids);
    await recordDiagnosisSubmission(sqlPrimary, { ...submission, correct });
    return send(response, 200, {
      correct,
      message: correct
        ? "記録された。evidence-based-diagnosis チェックポイントを再スキャンしよう。"
        : "まだ揃っていない。pid・mechanism・trigger・最初の一手のどれかが合っていない。",
    });
  } catch (err) {
    return send(response, 503, { error: "database not ready yet", detail: String(err?.message ?? err) });
  }
}

const verify = createServer(async (request, response) => {
  const url = requestUrl(request.url, "http://127.0.0.1");
  if (request.method === "GET" && url.pathname === "/healthz") {
    return send(response, 200, { status: "ok" });
  }
  if (request.method === "POST" && url.pathname === "/diagnosis") {
    return handleDiagnosis(request, response);
  }
  if (request.method !== "POST" || url.pathname !== "/verify") {
    return send(response, 404, { error: "not_found" });
  }
  const raw = await readBody(request);
  let body;
  try {
    body = JSON.parse(raw || "{}");
  } catch {
    return send(response, 400, { error: "invalid_json" });
  }
  const checkpointId = typeof body?.checkpointId === "string" ? body.checkpointId : "";
  if (!isKnownCheckpoint(checkpointId)) {
    return send(response, 400, { error: "unknown_checkpoint" });
  }
  try {
    const verdict = await evaluateCheckpoint(client, checkpointId);
    return send(response, 200, { checkpointId, correct: verdict.correct, message: verdict.message });
  } catch (err) {
    return send(response, 200, {
      checkpointId,
      correct: false,
      message: `Grader could not evaluate the database yet: ${String(err?.message ?? err)}`,
    });
  }
});

info.listen(8080, "0.0.0.0", () => console.log("info on :8080"));
verify.listen(8081, "0.0.0.0", () => console.log("verify+diagnosis on :8081"));
