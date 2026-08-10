/**
 * db-a3-query-plan — local-play container entrypoint (Node half).
 *
 * Two HTTP servers run in one process:
 *   :8080  a small info/status page (the portal's "challenge surface" link) — the
 *          actual work happens over psql in the embedded terminal, this page just
 *          confirms the drill is up and shows the live plans for both queries.
 *   :8081  the loopback `/verify` the TenkaCloud scorer delegates to, graded one
 *          checkpoint at a time (TenkaCloud#2252 multi-verify contract).
 *
 * There is no baseline capture step here (contrast with db-a2-index-tradeoff's
 * server.mjs) — every checkpoint reads CURRENT database state directly
 * (pg_stat_user_tables.last_analyze, and live EXPLAIN of two fixed queries), so
 * there is nothing that has to be captured once at a specific moment in the
 * container's life. See local/grader/grade.mjs for why that is still fully DB-state
 * grading rather than self-report.
 */
import { createServer } from "node:http";
import postgres from "postgres";
import { evaluateCheckpoint, isKnownCheckpoint } from "../grader/grade.mjs";
import { COMMON_VALUE, RARE_VALUE, createPgGraderClient } from "./pg-client.mjs";

/**
 * Parse a request target without letting a malformed one end the process. See the
 * identical helper in sqli-demo / rls-tenant-isolation for the rationale (GET // has
 * no host and new URL() throws on it).
 */
function requestUrl(target, base) {
  try {
    return new URL(String(target ?? "/").replace(/^\/+/, "/"), base);
  } catch {
    return new URL("/__malformed_request__", base);
  }
}

const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgres://postgres@127.0.0.1:5432/drill";

const sql = postgres(DATABASE_URL, { max: 4, onnotice: () => {} });
const client = createPgGraderClient(sql);

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
<title>db-a3-query-plan</title></head>
<body style="font-family:system-ui;max-width:34rem;margin:3rem auto;line-height:1.6">
<h1>Query Plan — planner は必ず index を選ぶわけではない</h1>
<p>このドリルは画面の上では完結しません。Portal のターミナルを開き、以下で接続してください。</p>
<pre>psql -U participant -d drill</pre>
<p>対象の 2 クエリ (同じ index つきの列、値の選択性だけが違う):</p>
<pre>select * from support.tickets where priority = '${RARE_VALUE}';  -- 希少値
select * from support.tickets where priority = '${COMMON_VALUE}';  -- 大多数を占める値</pre>
<p>現在の状態は <a href="/status">/status</a> で確認できます (採点はしません)。</p>
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
      const [statisticsCollected, rare, common] = await Promise.all([
        client.statisticsCollected(),
        client.explainRareQuery(),
        client.explainCommonQuery(),
      ]);
      return send(response, 200, {
        rareQuery: `select * from support.tickets where priority = '${RARE_VALUE}';`,
        commonQuery: `select * from support.tickets where priority = '${COMMON_VALUE}';`,
        statisticsCollected,
        rare: { nodeTypes: [...rare.nodeTypes], planRows: rare.planRows, actualRows: rare.actualRows },
        common: {
          nodeTypes: [...common.nodeTypes],
          planRows: common.planRows,
          actualRows: common.actualRows,
        },
      });
    } catch {
      return send(response, 503, { error: "database not ready yet" });
    }
  }
  return send(response, 404, { error: "not_found" });
});

const verify = createServer(async (request, response) => {
  if (request.method === "GET" && (request.url ?? "/") === "/healthz") {
    return send(response, 200, { status: "ok" });
  }
  if (request.method !== "POST" || (request.url ?? "/") !== "/verify") {
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
    return send(response, 200, {
      checkpointId,
      correct: verdict.correct,
      message: verdict.message,
    });
  } catch {
    return send(response, 200, {
      checkpointId,
      correct: false,
      message: "Grader could not evaluate the database (is it running?).",
    });
  }
});

info.listen(8080, "0.0.0.0", () => console.log("info on :8080"));
verify.listen(8081, "0.0.0.0", () => console.log("verify on :8081"));
