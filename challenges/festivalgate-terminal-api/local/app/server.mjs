import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { DatabaseSync } from "node:sqlite";

/**
 * festivalgate-terminal-api — a DELIBERATELY MIS-DESIGNED "terminal-facing" API
 * for TenkaCloud local play. It ships two real design flaws on purpose:
 *
 *   1. The "internal only" ops endpoint is gated by a CLIENT-CONTROLLED network
 *      signal (the X-Forwarded-For hop), so any caller can claim to be internal.
 *      Boundary trust is treated as authentication — it is not.
 *   2. The connection the entrance terminals use is over-broad: the same handle
 *      that serves ticket check-in can also read the operations/auth secrets and
 *      customer records. There is no per-purpose DB user and no data separation.
 *
 * Never expose it off loopback; the compose file binds it to 127.0.0.1 only.
 *
 * Two servers run in one process:
 *   :8080  the terminal API the participant audits
 *   :8081  the loopback `/verify` endpoint the TenkaCloud scorer delegates to
 *
 * The flag is derived from FLAG_SEED at runtime and lives only in the ops_secrets
 * store, so nothing secret is committed and each deploy is unique. The terminal
 * token is also seed-derived, so guessing credentials is NOT the intended path —
 * reaching an endpoint the terminal path should never expose is.
 */

const FLAG_SEED = process.env.FLAG_SEED ?? "local-dev-seed";
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const FLAG = `TC{festgate_${sha256(`flag:${FLAG_SEED}`).slice(0, 20)}}`;
// The credential the entrance terminals present. Public-ish (printed on the doc
// page) — it is a low-privilege terminal identity, not the way to the secret.
const TERMINAL_TOKEN = `term-${sha256(`terminal:${FLAG_SEED}`).slice(0, 16)}`;

/**
 * One in-memory DB with three logical stores. In a correctly separated design the
 * terminal connection would be a least-privilege user that can touch ONLY
 * `tickets`; `customers` and `ops_secrets` would live behind their own users /
 * databases. Here a single over-broad handle reads all three — that is the flaw
 * this problem makes you feel.
 */
const db = new DatabaseSync(":memory:");
db.exec(`
  CREATE TABLE tickets (code TEXT PRIMARY KEY, holder TEXT, checked_in INTEGER DEFAULT 0);
  CREATE TABLE customers (id INTEGER PRIMARY KEY, name TEXT, email TEXT, phone TEXT);
  CREATE TABLE ops_secrets (key TEXT PRIMARY KEY, value TEXT);
`);
const insertTicket = db.prepare("INSERT INTO tickets (code, holder) VALUES (?, ?)");
insertTicket.run("TG-1001", "Sato Haruki");
insertTicket.run("TG-1002", "Tanaka Mei");
insertTicket.run("TG-1003", "Yamada Ren");
const insertCustomer = db.prepare("INSERT INTO customers (id, name, email, phone) VALUES (?, ?, ?, ?)");
insertCustomer.run(1, "Sato Haruki", "haruki@example.com", "080-0000-1001");
insertCustomer.run(2, "Tanaka Mei", "mei@example.com", "080-0000-1002");
const insertSecret = db.prepare("INSERT INTO ops_secrets (key, value) VALUES (?, ?)");
insertSecret.run("gate_master_note", FLAG);
insertSecret.run("payments_api_key", `sk_live_${sha256(`pay:${FLAG_SEED}`).slice(0, 24)}`);
insertSecret.run("staff_reset_token", `reset-${sha256(`reset:${FLAG_SEED}`).slice(0, 12)}`);

const ticketByCode = db.prepare("SELECT * FROM tickets WHERE code = ?");
const checkInTicket = db.prepare("UPDATE tickets SET checked_in = 1 WHERE code = ?");
const allSecrets = db.prepare("SELECT key, value FROM ops_secrets");
const countCustomers = db.prepare("SELECT COUNT(*) AS n FROM customers");

function terminalToken(request) {
  return String(request.headers["x-terminal-token"] ?? "").trim();
}

/**
 * The flaw: "is this caller internal?" is answered from the X-Forwarded-For hop,
 * which the client fully controls. The app assumes the gateway only ever forwards
 * genuinely internal traffic here, so it trusts the header as if it were auth.
 */
function isPrivateIp(ip) {
  return (
    /^10\./.test(ip) ||
    /^192\.168\./.test(ip) ||
    /^127\./.test(ip) ||
    /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(ip)
  );
}
function isInternalRequest(request) {
  const firstHop = String(request.headers["x-forwarded-for"] ?? "").split(",")[0].trim();
  return isPrivateIp(firstHop);
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

function parseJson(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function send(response, status, contentType, body) {
  response.writeHead(status, { "content-type": contentType });
  response.end(body);
}
function sendJson(response, status, payload) {
  send(response, status, "application/json", JSON.stringify(payload));
}

const HOME = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>FestivalGate Terminal API</title></head>
<body style="font-family:system-ui;max-width:44rem;margin:3rem auto;line-height:1.6">
<h1>FestivalGate — Entrance Terminal API</h1>
<p>Entrance terminals at the venue call this API to look up and check in tickets.
Each terminal presents a terminal token.</p>
<p>Your terminal token is <code>${TERMINAL_TOKEN}</code>.</p>
<h2>Terminal endpoints (what the gate terminals use)</h2>
<pre>curl -H "X-Terminal-Token: ${TERMINAL_TOKEN}" http://127.0.0.1:18080/api/terminal/tickets/TG-1001
curl -X POST -H "X-Terminal-Token: ${TERMINAL_TOKEN}" -H "content-type: application/json" \\
  -d '{"code":"TG-1001"}' http://127.0.0.1:18080/api/terminal/checkin</pre>
<h2>Operations endpoint</h2>
<p><code>GET /internal/ops/summary</code> returns venue operations config. It is meant
for the <b>internal operations network only</b>, so callers from outside are refused.</p>
<p>You are auditing this service from the outside. Confirm whether that "internal only"
boundary actually holds.</p>
</body></html>`;

const challenge = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  const { method } = request;

  if (method === "GET" && url.pathname === "/healthz") {
    return sendJson(response, 200, { status: "ok" });
  }
  if (method === "GET" && url.pathname === "/") {
    return send(response, 200, "text/html; charset=utf-8", HOME);
  }

  // Terminal function: read a ticket's status. Requires the terminal token.
  const ticketMatch = url.pathname.match(/^\/api\/terminal\/tickets\/([A-Za-z0-9-]+)$/);
  if (method === "GET" && ticketMatch) {
    if (terminalToken(request) !== TERMINAL_TOKEN) {
      return sendJson(response, 401, { error: "unauthorized" });
    }
    const ticket = ticketByCode.get(ticketMatch[1]);
    if (!ticket) return sendJson(response, 404, { error: "not_found" });
    return sendJson(response, 200, {
      code: ticket.code,
      holder: ticket.holder,
      checkedIn: Boolean(ticket.checked_in),
    });
  }

  // Terminal function: check a ticket in.
  if (method === "POST" && url.pathname === "/api/terminal/checkin") {
    if (terminalToken(request) !== TERMINAL_TOKEN) {
      return sendJson(response, 401, { error: "unauthorized" });
    }
    const body = parseJson(await readBody(request));
    const code = String(body.code ?? "");
    const ticket = ticketByCode.get(code);
    if (!ticket) return sendJson(response, 404, { error: "not_found" });
    checkInTicket.run(code);
    return sendJson(response, 200, { code, holder: ticket.holder, checkedIn: true });
  }

  // "Internal only" ops endpoint. VULNERABLE: the boundary is enforced from the
  // client-controlled X-Forwarded-For hop, so any caller can claim to be internal.
  // And because the terminal path's DB access is over-broad, this endpoint hands
  // back the ops/auth secrets (incl. the flag) it should never be able to read.
  if (method === "GET" && url.pathname === "/internal/ops/summary") {
    if (!isInternalRequest(request)) {
      return sendJson(response, 403, {
        error: "forbidden",
        detail: "This endpoint is restricted to the internal operations network.",
      });
    }
    const secrets = {};
    for (const row of allSecrets.all()) secrets[row.key] = row.value;
    return sendJson(response, 200, {
      venue: "FestivalGate Main Hall",
      customersOnFile: countCustomers.get().n,
      opsSecrets: secrets,
    });
  }

  return sendJson(response, 404, { error: "not_found" });
});

const verify = createServer(async (request, response) => {
  if (request.method !== "POST" || (request.url ?? "/") !== "/verify") {
    return sendJson(response, 404, { error: "not_found" });
  }
  const submission = String(parseJson(await readBody(request)).submission ?? "");
  const correct = submission.trim() === FLAG;
  // The failure message must not leak the expected flag or scoring internals.
  sendJson(response, 200, {
    correct,
    message: correct ? "Flag accepted." : "That is not the flag for this challenge.",
  });
});

challenge.listen(8080, "0.0.0.0", () => console.log("challenge on :8080"));
verify.listen(8081, "0.0.0.0", () => console.log("verify on :8081"));
