/**
 * db-battle-slow-apparently — order API.
 *
 * A minimal "production order service": `POST /orders` writes to the
 * primary, `GET /orders/recent` reads from EITHER the primary or the
 * replica (chosen at random per request, 1-in-3 odds of a replica read) so
 * that replication lag shows up as a genuine, observable read-after-write
 * staleness proxy — not just a lag NUMBER, but an actual API-visible symptom
 * ("an update I just made isn't showing up yet"), matching the parent
 * Issue's player-facing report.
 *
 * `GET /metrics` exposes rolling p50/p95/p99 + error rate, computed from
 * REAL request timings over a sliding window — nothing here is synthesized.
 * This is what the primary container's background sampler polls into
 * `audit.metrics_samples` (see local/app/pg-client.mjs).
 *
 * Connects as `app_service`: INSERT + SELECT only, no DELETE/DDL — the same
 * least-privilege posture a real app tier runs under (see local/db/schema.sql).
 */
import { createServer } from "node:http";
import postgres from "postgres";

const PRIMARY_URL = process.env.DATABASE_URL ?? "postgres://app_service@primary:5432/incident";
const REPLICA_URL = process.env.REPLICA_DATABASE_URL ?? "postgres://app_service@replica:5432/incident";
const PORT = Number(process.env.PORT ?? 3000);
// Sliding window: keep the most recent N request timings for percentile math.
// 100 samples at ~12 req/s is roughly the last 8 seconds — short enough that
// a resolved incident's elevated latencies actually age out of /metrics
// quickly (confirmed on this Battle's own Docker stack: a 400-sample window
// took ~30s to fully flush a spike, which made "sustained recovery" grading
// unnecessarily slow to observe).
const WINDOW_SIZE = 100;

const sqlPrimary = postgres(PRIMARY_URL, { max: 8, onnotice: () => {}, connect_timeout: 5 });
const sqlReplica = postgres(REPLICA_URL, { max: 4, onnotice: () => {}, connect_timeout: 5 });

/** @type {{ ok: boolean, ms: number }[]} */
let samples = [];
let replicaStalenessMsMax = null;

function recordSample(ok, ms) {
  samples.push({ ok, ms });
  if (samples.length > WINDOW_SIZE) samples = samples.slice(-WINDOW_SIZE);
}

function percentile(sorted, p) {
  if (sorted.length === 0) return null;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

function currentMetrics() {
  const okTimings = samples.filter((s) => s.ok).map((s) => s.ms).sort((a, b) => a - b);
  const total = samples.length;
  const errors = samples.filter((s) => !s.ok).length;
  return {
    requestCount: total,
    p50Ms: percentile(okTimings, 50),
    p95Ms: percentile(okTimings, 95),
    p99Ms: percentile(okTimings, 99),
    errorRate: total > 0 ? errors / total : 0,
    replicaStalenessMsMax,
  };
}

function send(res, status, body) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", () => resolve(""));
  });
}

async function handleCreateOrder(req, res) {
  const start = performance.now();
  try {
    const raw = await readBody(req);
    let body = {};
    try {
      body = JSON.parse(raw || "{}");
    } catch {
      body = {};
    }
    const customerId = Number.isInteger(body.customerId) ? body.customerId : 1000 + Math.floor(Math.random() * 500);
    const totalCents = Number.isInteger(body.totalCents) ? body.totalCents : 500 + Math.floor(Math.random() * 9500);
    const rows = await sqlPrimary`
      insert into commerce.orders (created_at, customer_id, total_cents, status)
      values (now(), ${customerId}, ${totalCents}, 'placed')
      returning id, created_at
    `;
    const ms = performance.now() - start;
    recordSample(true, ms);
    send(res, 201, { id: Number(rows[0].id), createdAt: rows[0].created_at });
  } catch (err) {
    const ms = performance.now() - start;
    recordSample(false, ms);
    send(res, 503, { error: "write_failed", detail: String(err?.message ?? err) });
  }
}

async function handleRecentOrders(req, res) {
  const start = performance.now();
  const fromReplica = Math.random() < (1 / 3);
  const sql = fromReplica ? sqlReplica : sqlPrimary;
  try {
    const rows = await sql`
      select id, created_at, customer_id, total_cents, status
      from commerce.orders
      order by created_at desc
      limit 20
    `;
    const ms = performance.now() - start;
    recordSample(true, ms);
    if (fromReplica && rows.length > 0) {
      const [{ maxSeen }] = await sqlPrimary`select max(created_at) as "maxSeen" from commerce.orders_current`;
      if (maxSeen) {
        const stalenessMs = new Date(maxSeen).getTime() - new Date(rows[0].created_at).getTime();
        replicaStalenessMsMax = replicaStalenessMsMax === null
          ? stalenessMs
          : Math.max(replicaStalenessMsMax * 0.9, stalenessMs); // decays, not sticky forever
      }
    }
    send(res, 200, { source: fromReplica ? "replica" : "primary", orders: rows });
  } catch (err) {
    const ms = performance.now() - start;
    recordSample(false, ms);
    send(res, 503, { error: "read_failed", detail: String(err?.message ?? err), source: fromReplica ? "replica" : "primary" });
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  if (req.method === "GET" && url.pathname === "/healthz") return send(res, 200, { status: "ok" });
  if (req.method === "GET" && url.pathname === "/metrics") return send(res, 200, currentMetrics());
  if (req.method === "POST" && url.pathname === "/orders") return handleCreateOrder(req, res);
  if (req.method === "GET" && url.pathname === "/orders/recent") return handleRecentOrders(req, res);
  return send(res, 404, { error: "not_found" });
});

server.listen(PORT, "0.0.0.0", () => console.log(`order api on :${PORT}`));
