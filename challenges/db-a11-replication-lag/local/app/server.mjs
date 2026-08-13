/**
 * db-a11-replication-lag — local-play container entrypoint (Node half, primary side).
 *
 * Same 2-server shape as every prior Database Track drill (:8080 info,
 * :8081 loopback /verify) and the same 2-connection shape as
 * db-a10-primary-replica's server.mjs (a loopback connection to this
 * container's own Postgres, and a TCP connection out to the `replica`
 * service over the compose network).
 *
 * New for this drill: a background lag sampler (see
 * local/app/pg-client.mjs's startLagSampler) starts as soon as the primary
 * connection is up, and keeps writing to audit.lag_samples for the whole
 * process lifetime — not just while /verify happens to be called. See
 * grade.mjs's file banner for why that continuous history, not a single live
 * query, is what this drill's checkpoints actually need.
 */
import { createServer } from "node:http";
import postgres from "postgres";
import { evaluateCheckpoint, isKnownCheckpoint } from "../grader/grade.mjs";
import { createPgGraderClient, startLagSampler } from "./pg-client.mjs";

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

startLagSampler(sqlPrimary, 1000);

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
<title>db-a11-replication-lag</title></head>
<body style="font-family:system-ui;max-width:34rem;margin:3rem auto;line-height:1.6">
<h1>Replication Lag ── 発生させ、観測し、解消する</h1>
<p>このドリルは画面の上では完結しません。Portal のターミナルを開き (primary に入ります)、
以下で primary に接続してください。</p>
<pre>psql -U participant -d drill</pre>
<p>同じターミナルから <code>psql -h replica -U participant -d drill</code> で replica にも直接
つなげます。ゴール: replica の apply を意図的に遅らせて (<code>recovery_min_apply_delay</code>)
replication lag を発生させ、<code>pg_stat_replication.replay_lag</code> で実測し、その後
delay を戻して lag が縮小することも実測する。</p>
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
      const [replicationRows, lagSamples] = await Promise.all([
        client.replicationRows(),
        client.lagSamples(),
      ]);
      let replicaRecovery = null;
      try {
        replicaRecovery = await client.replicaRecovery();
      } catch {
        replicaRecovery = { error: "replica not reachable yet" };
      }
      const recentSamples = lagSamples.slice(-20);
      return send(response, 200, {
        replicationRows,
        replicaRecovery,
        sampleCount: lagSamples.length,
        recentSamples,
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
      message: "Grader could not evaluate the database (is the replica up yet?).",
    });
  }
});

info.listen(8080, "0.0.0.0", () => console.log("info on :8080"));
verify.listen(8081, "0.0.0.0", () => console.log("verify on :8081"));
