/**
 * db-a4-transaction — local-play container entrypoint (Node half).
 *
 * Two HTTP servers run in one process:
 *   :8080  a small info/status page (the portal's "challenge surface" link) — the
 *          actual work happens over psql in the embedded terminal, this page just
 *          confirms the drill is up and shows the live account balances.
 *   :8081  the loopback `/verify` the TenkaCloud scorer delegates to, graded one
 *          checkpoint at a time (TenkaCloud#2252 multi-verify contract).
 *
 * There is no baseline capture step here (contrast with db-a2-index-tradeoff's
 * server.mjs) — bank.accounts starts from 3 FIXED rows (local/db/seed.sql), so the
 * "correct end state" is a compile-time constant, not something that has to be
 * measured once at boot. See local/grader/grade.mjs for the actual checkpoint logic.
 */
import { createServer } from "node:http";
import postgres from "postgres";
import { evaluateCheckpoint, isKnownCheckpoint } from "../grader/grade.mjs";
import { ALICE_ID, BOB_ID, CAROL_ID, createPgGraderClient } from "./pg-client.mjs";

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
<title>db-a4-transaction</title></head>
<body style="font-family:system-ui;max-width:34rem;margin:3rem auto;line-height:1.6">
<h1>Transaction — BEGIN / COMMIT / ROLLBACK と原子性</h1>
<p>このドリルは画面の上では完結しません。Portal のターミナルを開き、以下で接続してください。</p>
<pre>psql -U participant -d drill</pre>
<p>ゴール: alice (id ${ALICE_ID}) から bob (id ${BOB_ID}) へ 1000 cents を、1 つの原子的な操作として送金する。carol (id ${CAROL_ID}) は送金に一切関わらない。</p>
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
      const [total, balances, xmins] = await Promise.all([
        client.totalBalanceCents(),
        client.transferBalancesCents(),
        client.transferXmins(),
      ]);
      return send(response, 200, {
        totalBalanceCents: total,
        alice: { id: ALICE_ID, balanceCents: balances.alice, xmin: xmins.alice },
        bob: { id: BOB_ID, balanceCents: balances.bob, xmin: xmins.bob },
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
