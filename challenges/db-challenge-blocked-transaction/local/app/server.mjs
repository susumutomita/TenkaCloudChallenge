/**
 * db-challenge-blocked-transaction — local-play container entrypoint (Node half).
 *
 * Two HTTP servers run in one process:
 *   :8080  a small info/status page (the portal's "challenge surface" link) —
 *          the actual diagnostic work happens over psql in the embedded
 *          terminal, this page only confirms the Challenge is up and shows
 *          whether the stuck write has completed yet (it does NOT say why it
 *          was stuck — see metadata.json's instructions for the same
 *          non-spoiler framing).
 *   :8081  the loopback `/verify` the TenkaCloud scorer delegates to, graded
 *          one checkpoint at a time (TenkaCloud#2252 multi-verify contract).
 *
 * Before either server starts listening, `maybeStartIncident` decides
 * whether the incident (leaked blocker + harmless decoy + retrying waiter)
 * still needs to run. It is driven entirely by app.accounts' CURRENT
 * balance rather than a separate "have we started" flag: if the balance is
 * still the untouched seed value, nothing has been resolved yet (whether
 * this is the very first boot, or a container restart mid-incident — either
 * way the previous boot's connections are gone with the old container, so
 * the incident has to be started fresh); if the balance has already moved,
 * the participant already solved it, and restarting must not re-break it.
 */
import { createServer } from "node:http";
import postgres from "postgres";
import { evaluateCheckpoint, isKnownCheckpoint } from "../grader/grade.mjs";
import {
  ACCOUNT_ID,
  BLOCKER_DEBIT_CENTS,
  SEED_BALANCE_CENTS,
  WAITER_DEBIT_CENTS,
  createPgGraderClient,
} from "./pg-client.mjs";

/**
 * Parse a request target without letting a malformed one end the process. See
 * the identical helper in sqli-demo / db-a2-index-tradeoff for the rationale
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
const APP_SERVICE_DATABASE_URL =
  process.env.APP_SERVICE_DATABASE_URL ?? "postgres://app_service@127.0.0.1:5432/drill";

const RETRY_DELAY_MS = 2000;

const sql = postgres(DATABASE_URL, { max: 4, onnotice: () => {} });
const appSql = postgres(APP_SERVICE_DATABASE_URL, { max: 8, onnotice: () => {} });
const client = createPgGraderClient(sql);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function logIncident(event, backendPid = null) {
  await sql`insert into audit.incident_log (event, backend_pid) values (${event}, ${backendPid})`;
}

/**
 * Open the leaked blocking connection: BEGIN, debit the account, and
 * deliberately never COMMIT or ROLLBACK — "a previous deploy left a
 * connection open mid-transaction." The reserved connection is intentionally
 * never released; it just sits there (`idle in transaction`, holding the row
 * lock on account 1) until something external ends it — in practice, only
 * the participant calling `pg_terminate_backend()` after identifying it via
 * `pg_blocking_pids()`.
 */
async function openLeakedBlocker() {
  const conn = await appSql.reserve();
  await conn.unsafe("begin");
  const [{ pid }] = await conn`select pg_backend_pid() as pid`;
  await conn`
    update app.accounts
    set balance_cents = balance_cents - ${BLOCKER_DEBIT_CENTS}
    where id = ${ACCOUNT_ID}
  `;
  await logIncident("blocker-opened", pid);
  console.log(
    `[db-challenge-blocked-transaction] leaked blocker backend pid=${pid} opened, never committed`,
  );
}

/**
 * Open a harmless decoy connection: also app_service, also visible in
 * pg_stat_activity, but holds no transaction and no lock (a single query,
 * then idle). A participant who just "terminates the other app_service
 * connection" without checking `pg_blocking_pids()` first has no guarantee
 * of picking the real blocker — this one does nothing when terminated.
 */
async function openHarmlessDecoy() {
  const conn = await appSql.reserve();
  await conn`select 1`;
  console.log(
    "[db-challenge-blocked-transaction] harmless decoy connection opened (no transaction, no lock)",
  );
}

/**
 * The application's own retry loop for the one write that matters. Blocks on
 * the leaked transaction's row lock until it is resolved from outside this
 * process (the participant terminating the blocker), then completes. If ITS
 * OWN backend is terminated by mistake (e.g. the participant picks the wrong
 * pid), the pending query rejects and this loop simply tries again on a
 * fresh connection after a short delay — a wrong guess is not a dead end.
 */
async function runWaiterLoop() {
  for (;;) {
    const current = await client.accountBalanceCents();
    if (current !== SEED_BALANCE_CENTS) return; // already resolved
    await logIncident("waiter-attempt-started");
    try {
      await appSql`
        update app.accounts
        set balance_cents = balance_cents - ${WAITER_DEBIT_CENTS}
        where id = ${ACCOUNT_ID}
      `;
      await logIncident("waiter-attempt-completed");
      console.log("[db-challenge-blocked-transaction] waiter write completed");
      return;
    } catch (err) {
      console.log(
        `[db-challenge-blocked-transaction] waiter attempt failed (${err?.message ?? err}), retrying`,
      );
      await sleep(RETRY_DELAY_MS);
    }
  }
}

async function maybeStartIncident() {
  const balance = await client.accountBalanceCents();
  if (balance !== SEED_BALANCE_CENTS) {
    console.log(
      "[db-challenge-blocked-transaction] account already resolved — not restarting the incident",
    );
    return;
  }
  await openLeakedBlocker();
  await openHarmlessDecoy();
  // Intentionally not awaited: this must not block the HTTP servers from
  // starting up. It resolves on its own once the incident is resolved.
  runWaiterLoop();
}

await maybeStartIncident();

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
<title>db-challenge-blocked-transaction</title></head>
<body style="font-family:system-ui;max-width:34rem;margin:3rem auto;line-height:1.6">
<h1>支払いの書き込みが止まったまま返ってこない</h1>
<p>このチャレンジは画面の上では完結しません。Portal のターミナルを開き、以下で接続してください。</p>
<pre>psql -U participant -d drill</pre>
<p>account 1 (griffin holdings) への出金処理がアプリ側で保留のまま止まっている。</p>
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
    // Deliberately minimal — an operational dashboard a real on-call
    // engineer might glance at, NOT a diagnostic tool. It does not name the
    // blocking pid or any lock state; finding that is the point of the
    // Challenge, done over psql with the tools A6 taught.
    try {
      const balance = await client.accountBalanceCents();
      return send(response, 200, {
        accountId: ACCOUNT_ID,
        currentBalanceCents: balance,
        pendingWriteCompleted: balance !== SEED_BALANCE_CENTS,
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
