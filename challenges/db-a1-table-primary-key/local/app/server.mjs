/**
 * db-a1-table-primary-key — local-play container entrypoint (Node half).
 *
 * Two HTTP servers run in one process:
 *   :8080  a small info/status page (the portal's "challenge surface" link) —
 *          the actual work happens over psql in the embedded terminal, this
 *          page just confirms the drill is up and shows live counts.
 *   :8081  the loopback `/verify` the TenkaCloud scorer delegates to, graded
 *          one checkpoint at a time (TenkaCloud#2252 multi-verify contract).
 *
 * There is no flag and no FLAG_SEED-derived secret: every checkpoint is a fact
 * about live Postgres state (grade.mjs + pg-client.mjs), so `/verify` never
 * looks at the submission body beyond echoing the requested checkpointId.
 */
import { createServer } from "node:http";
import postgres from "postgres";
import { evaluateCheckpoint, isKnownCheckpoint } from "../grader/grade.mjs";
import { createPgGraderClient } from "./pg-client.mjs";

/**
 * Parse a request target without letting a malformed one end the process. See
 * the identical helper in sqli-demo / rls-tenant-isolation for the rationale
 * (GET // has no host and new URL() throws on it).
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
<title>db-a1-table-primary-key</title></head>
<body style="font-family:system-ui;max-width:34rem;margin:3rem auto;line-height:1.6">
<h1>Table / Row / Primary Key</h1>
<p>このドリルは画面の上では完結しません。Portal のターミナルを開き、以下で接続してください。</p>
<pre>psql -U participant -d drill</pre>
<p><code>training.members_unkeyed</code> を観察してから、<code>email</code> を PRIMARY KEY とする
<code>training.members</code> を自分で作ってください。</p>
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
      const [unkeyedCount, distinctCount, membersCount, pk] = await Promise.all([
        sql`select count(*)::int as n from training.members_unkeyed`.then((r) => r[0].n),
        client.unkeyedDistinctEmailCount(),
        client.membersRowCount(),
        client.membersPrimaryKeyColumns(),
      ]);
      return send(response, 200, {
        "training.members_unkeyed": { rows: unkeyedCount, distinctEmails: distinctCount },
        "training.members": { rows: membersCount, primaryKey: pk },
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
