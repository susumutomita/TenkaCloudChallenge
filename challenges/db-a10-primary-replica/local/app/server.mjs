/**
 * db-a10-primary-replica — local-play container entrypoint (Node half, primary side).
 *
 * Two HTTP servers run in one process, exactly like every prior Database Track
 * drill:
 *   :8080  a small info/status page (the portal's "challenge surface" link) — the
 *          actual work happens over psql in the embedded terminal, this page just
 *          confirms the drill is up and shows live replication statistics.
 *   :8081  the loopback `/verify` the TenkaCloud scorer delegates to, graded one
 *          checkpoint at a time (TenkaCloud#2252 multi-verify contract).
 *
 * New for this drill: TWO Postgres connections. `sqlPrimary` is the usual
 * loopback connection into this same container's Postgres; `sqlReplica` is a
 * TCP connection out to the OTHER container over the compose network, at the
 * service name `replica` (see local/entrypoint-primary.sh's
 * REPLICA_DATABASE_URL). Both are lazy (the `postgres` driver connects on
 * first query), so this process can start and serve /healthz even before the
 * replica container exists — which matters, because compose starts `replica`
 * only once THIS service is healthy (see local/docker-compose.yml).
 */
import { createServer } from "node:http";
import postgres from "postgres";
import { evaluateCheckpoint, isKnownCheckpoint } from "../grader/grade.mjs";
import { createPgGraderClient } from "./pg-client.mjs";

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

const DATABASE_URL = process.env.DATABASE_URL ?? "postgres://postgres@127.0.0.1:5432/drill";
const REPLICA_DATABASE_URL =
  process.env.REPLICA_DATABASE_URL ?? "postgres://postgres@replica:5432/drill";

const sqlPrimary = postgres(DATABASE_URL, { max: 4, onnotice: () => {} });
const sqlReplica = postgres(REPLICA_DATABASE_URL, { max: 2, onnotice: () => {}, connect_timeout: 5 });
const client = createPgGraderClient(sqlPrimary, sqlReplica);

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
<title>db-a10-primary-replica</title></head>
<body style="font-family:system-ui;max-width:34rem;margin:3rem auto;line-height:1.6">
<h1>Primary / Replica ── 複製は何を追いかけているか</h1>
<p>このドリルは画面の上では完結しません。Portal のターミナルを開き (primary に入ります)、
以下で primary に接続してください。</p>
<pre>psql -U participant -d drill</pre>
<p>同じターミナルから <code>psql -h replica -U participant -d drill</code> で replica にも直接
つなげます。ゴール: primary への書き込みが、時間差のある 2 回とも replica へ届くことを自分の目で
確認し、それが「一度きりのコピー」ではなく「継続的に追いかけている」ことの証拠だと理解する。</p>
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
      const [replicationRows, ledgerCounts] = await Promise.all([
        client.replicationRows(),
        client.ledgerCounts(),
      ]);
      let replicaRecovery = null;
      try {
        replicaRecovery = await client.replicaRecovery();
      } catch {
        replicaRecovery = { error: "replica not reachable yet" };
      }
      return send(response, 200, { replicationRows, replicaRecovery, ledgerCounts });
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
      message: "Grader could not evaluate the database (is the replica up yet?).",
    });
  }
});

info.listen(8080, "0.0.0.0", () => console.log("info on :8080"));
verify.listen(8081, "0.0.0.0", () => console.log("verify on :8081"));
