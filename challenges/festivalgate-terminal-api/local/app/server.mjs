import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { DatabaseSync } from "node:sqlite";

/**
 * A deliberately mis-designed venue-terminal API with four independent audit
 * findings and one stateful remediation checkpoint:
 *
 * 1. client-controlled X-Forwarded-For is trusted as an identity boundary;
 * 2. the internal summary returns substantially more data than its purpose needs;
 * 3. a terminal identity can read customer records outside ticket check-in;
 * 4. a short staff PIN can be tried without throttling.
 *
 * The owner security page models authorized configuration changes. The verifier
 * holds per-checkpoint passphrases and inspects the final control state. Docker
 * publishes both listeners on loopback only.
 */

const FLAG_SEED = process.env.FLAG_SEED ?? "local-dev-seed";
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const flagFor = (checkpointId, prefix) =>
  `TC{${prefix}_${sha256(`flag:${checkpointId}:${FLAG_SEED}`).slice(0, 20)}}`;

const FLAGS = {
  "proxy-boundary": flagFor("proxy-boundary", "festproxy"),
  "response-scope": flagFor("response-scope", "festresponse"),
  "terminal-data-scope": flagFor("terminal-data-scope", "festdata"),
  "attempt-throttling": flagFor("attempt-throttling", "festlimit"),
};
const TERMINAL_TOKEN = `term-${sha256(`terminal:${FLAG_SEED}`).slice(0, 16)}`;
const STAFF_PIN = String(Number.parseInt(sha256(`pin:${FLAG_SEED}`).slice(0, 8), 16) % 1000).padStart(
  3,
  "0",
);

const controls = {
  trustClientProxyHeader: true,
  verboseOpsResponse: true,
  terminalCustomerAccess: true,
  staffPinThrottle: false,
  secretsSeparated: false,
};
let pinFailures = 0;
let pinBlockedUntil = 0;

const db = new DatabaseSync(":memory:");
db.exec(`
  CREATE TABLE tickets (
    code TEXT PRIMARY KEY,
    holder TEXT NOT NULL,
    checked_in INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE customers (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    phone TEXT NOT NULL,
    audit_note TEXT
  );
  CREATE TABLE ops_secrets (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`);

const insertTicket = db.prepare("INSERT INTO tickets (code, holder) VALUES (?, ?)");
insertTicket.run("TG-1001", "Sato Haruki");
insertTicket.run("TG-1002", "Tanaka Mei");
insertTicket.run("TG-1003", "Yamada Ren");

const insertCustomer = db.prepare(
  "INSERT INTO customers (id, name, email, phone, audit_note) VALUES (?, ?, ?, ?, ?)",
);
insertCustomer.run(1, "Sato Haruki", "haruki@example.test", "080-0000-1001", null);
insertCustomer.run(2, "Tanaka Mei", "mei@example.test", "080-0000-1002", null);
insertCustomer.run(
  3,
  "System Audit",
  "audit@tenkacloud.example",
  "000-0000-0000",
  FLAGS["terminal-data-scope"],
);

const insertSecret = db.prepare("INSERT INTO ops_secrets (key, value) VALUES (?, ?)");
insertSecret.run("payments_api_key", `sk_live_${sha256(`pay:${FLAG_SEED}`).slice(0, 24)}`);
insertSecret.run("staff_reset_token", `reset-${sha256(`reset:${FLAG_SEED}`).slice(0, 12)}`);
insertSecret.run("response_audit_marker", FLAGS["response-scope"]);

const ticketByCode = db.prepare("SELECT * FROM tickets WHERE code = ?");
const checkInTicket = db.prepare("UPDATE tickets SET checked_in = 1 WHERE code = ?");
const customerById = db.prepare("SELECT * FROM customers WHERE id = ?");
const allSecrets = db.prepare("SELECT key, value FROM ops_secrets");
const countCustomers = db.prepare("SELECT COUNT(*) AS n FROM customers");

function send(response, status, contentType, body) {
  response.writeHead(status, {
    "content-type": contentType,
    "x-content-type-options": "nosniff",
  });
  response.end(body);
}

function sendJson(response, status, payload) {
  send(response, status, "application/json; charset=utf-8", JSON.stringify(payload));
}

async function readJson(request) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > 64 * 1024) return undefined;
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return undefined;
  }
}

function terminalToken(request) {
  return String(request.headers["x-terminal-token"] ?? "").trim();
}

function isPrivateIp(ip) {
  return (
    /^10\./.test(ip) ||
    /^192\.168\./.test(ip) ||
    /^127\./.test(ip) ||
    /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(ip)
  );
}

function isInternalRequest(request) {
  if (!controls.trustClientProxyHeader) return false;
  const firstHop = String(request.headers["x-forwarded-for"] ?? "").split(",")[0].trim();
  return isPrivateIp(firstHop);
}

function requireTerminal(request, response) {
  if (terminalToken(request) === TERMINAL_TOKEN) return true;
  sendJson(response, 401, { error: "unauthorized" });
  return false;
}

const HOME = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>FestivalGate Terminal API</title></head>
<body style="font-family:system-ui;max-width:52rem;margin:3rem auto;line-height:1.6">
<h1>FestivalGate — Entrance Terminal API</h1>
<p>Venue terminals use this API for ticket lookup and check-in. Your assigned
low-privilege terminal token is <code>${TERMINAL_TOKEN}</code>.</p>
<h2>Documented terminal endpoints</h2>
<pre>curl -H "X-Terminal-Token: ${TERMINAL_TOKEN}" http://127.0.0.1:18080/api/terminal/tickets/TG-1001
curl -X POST -H "X-Terminal-Token: ${TERMINAL_TOKEN}" -H "content-type: application/json" \\
  -d '{"code":"TG-1001"}' http://127.0.0.1:18080/api/terminal/checkin</pre>
<h2>Operations endpoints</h2>
<p><code>/internal/ops/status</code> and <code>/internal/ops/summary</code> are
described as internal-only. Test what evidence the server uses to trust that claim,
then inspect whether each response is limited to its purpose.</p>
<h2>Support workflow</h2>
<p>Gate staff can call <code>/api/terminal/staff-unlock?pin=000</code> with the
terminal token. The PIN is three digits. Check whether repeated attempts are controlled.</p>
<p>After collecting evidence, use the authorized <a href="/owner/security">owner
security settings</a> to correct the design.</p>
</body></html>`;

function ownerSecurityPage() {
  const row = (label, vulnerable, action, button) =>
    `<tr><td>${label}</td><td>${vulnerable ? "要対応" : "対応済み"}</td><td>${
      vulnerable
        ? `<form method="post" action="${action}"><button>${button}</button></form>`
        : "—"
    }</td></tr>`;
  return `<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><title>FestivalGate Owner Security</title></head>
<body style="font-family:system-ui;max-width:56rem;margin:2rem auto;line-height:1.7">
<h1>運営所有者のsecurity設定</h1>
<p>ここは診断担当者が所有者権限で使える正規の設定面です。4つの証跡を先に集めてください。</p>
<table border="1" cellpadding="8"><tr><th>control</th><th>状態</th><th>操作</th></tr>
${row("client指定proxy headerをidentityとして信頼", controls.trustClientProxyHeader, "/owner/security/stop-header-trust", "header trustを停止")}
${row("運営summaryの過剰response", controls.verboseOpsResponse, "/owner/security/minimize-response", "responseを最小化")}
${row("端末identityからcustomer dataへ到達", controls.terminalCustomerAccess, "/owner/security/restrict-terminal-data", "端末権限を限定")}
${row("staff PINの無制限試行", !controls.staffPinThrottle, "/owner/security/enable-pin-throttle", "試行制御を有効化")}
${row("運営secretと端末serviceのdata接続を共有", !controls.secretsSeparated, "/owner/security/separate-secrets", "secret storeを分離")}
</table>
<p>すべて対応後、Portalの「防御設定の再検証」に <code>VERIFY</code> を提出します。</p>
</body></html>`;
}

function internalDenied(response) {
  return sendJson(response, 403, {
    error: "forbidden",
    detail: "This endpoint is restricted to the internal operations network.",
  });
}

const challenge = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  const { method } = request;

  if (method === "GET" && url.pathname === "/healthz") {
    return sendJson(response, 200, { status: "ok" });
  }
  if (method === "GET" && url.pathname === "/") {
    return send(response, 200, "text/html; charset=utf-8", HOME);
  }

  const ticketMatch = url.pathname.match(/^\/api\/terminal\/tickets\/([A-Za-z0-9-]+)$/);
  if (method === "GET" && ticketMatch) {
    if (!requireTerminal(request, response)) return;
    const ticket = ticketByCode.get(ticketMatch[1]);
    if (!ticket) return sendJson(response, 404, { error: "not_found" });
    return sendJson(response, 200, {
      code: ticket.code,
      holder: ticket.holder,
      checkedIn: Boolean(ticket.checked_in),
    });
  }

  if (method === "POST" && url.pathname === "/api/terminal/checkin") {
    if (!requireTerminal(request, response)) return;
    const body = await readJson(request);
    if (!body) return sendJson(response, 400, { error: "invalid_json" });
    const code = String(body.code ?? "");
    const ticket = ticketByCode.get(code);
    if (!ticket) return sendJson(response, 404, { error: "not_found" });
    checkInTicket.run(code);
    return sendJson(response, 200, { code, holder: ticket.holder, checkedIn: true });
  }

  const customerMatch = url.pathname.match(/^\/api\/terminal\/customers\/([0-9]+)$/);
  if (method === "GET" && customerMatch) {
    if (!requireTerminal(request, response)) return;
    if (!controls.terminalCustomerAccess) {
      return sendJson(response, 403, { error: "outside_terminal_scope" });
    }
    const customer = customerById.get(Number(customerMatch[1]));
    if (!customer) return sendJson(response, 404, { error: "not_found" });
    return sendJson(response, 200, customer);
  }

  if (method === "GET" && url.pathname === "/api/terminal/staff-unlock") {
    if (!requireTerminal(request, response)) return;
    const now = Date.now();
    if (pinBlockedUntil > 0 && now >= pinBlockedUntil) {
      pinFailures = 0;
      pinBlockedUntil = 0;
    }
    if (controls.staffPinThrottle && now < pinBlockedUntil) {
      return sendJson(response, 429, {
        error: "too_many_attempts",
        retryAfterSeconds: Math.ceil((pinBlockedUntil - now) / 1000),
      });
    }
    if (url.searchParams.get("pin") !== STAFF_PIN) {
      pinFailures += 1;
      if (controls.staffPinThrottle && pinFailures >= 3) {
        pinBlockedUntil = now + 60_000;
      }
      return sendJson(response, 401, { error: "invalid_pin" });
    }
    pinFailures = 0;
    pinBlockedUntil = 0;
    return sendJson(response, 200, {
      unlocked: true,
      auditMarker: FLAGS["attempt-throttling"],
    });
  }

  if (method === "GET" && url.pathname === "/internal/ops/status") {
    if (!isInternalRequest(request)) return internalDenied(response);
    return sendJson(response, 200, {
      venue: "FestivalGate Main Hall",
      service: "gate-terminal",
      boundaryAuditMarker: FLAGS["proxy-boundary"],
    });
  }

  if (method === "GET" && url.pathname === "/internal/ops/summary") {
    if (!isInternalRequest(request)) return internalDenied(response);
    const payload = { venue: "FestivalGate Main Hall" };
    if (controls.verboseOpsResponse) payload.customersOnFile = countCustomers.get().n;
    if (!controls.secretsSeparated) {
      const secrets = {};
      for (const row of allSecrets.all()) secrets[row.key] = row.value;
      payload.opsSecrets = secrets;
    }
    return sendJson(response, 200, payload);
  }

  if (method === "GET" && url.pathname === "/owner/security") {
    return send(response, 200, "text/html; charset=utf-8", ownerSecurityPage());
  }
  if (method === "POST" && url.pathname === "/owner/security/stop-header-trust") {
    controls.trustClientProxyHeader = false;
    return send(response, 200, "text/html; charset=utf-8", ownerSecurityPage());
  }
  if (method === "POST" && url.pathname === "/owner/security/minimize-response") {
    controls.verboseOpsResponse = false;
    return send(response, 200, "text/html; charset=utf-8", ownerSecurityPage());
  }
  if (method === "POST" && url.pathname === "/owner/security/restrict-terminal-data") {
    controls.terminalCustomerAccess = false;
    return send(response, 200, "text/html; charset=utf-8", ownerSecurityPage());
  }
  if (method === "POST" && url.pathname === "/owner/security/enable-pin-throttle") {
    controls.staffPinThrottle = true;
    pinFailures = 0;
    pinBlockedUntil = 0;
    return send(response, 200, "text/html; charset=utf-8", ownerSecurityPage());
  }
  if (method === "POST" && url.pathname === "/owner/security/separate-secrets") {
    controls.secretsSeparated = true;
    return send(response, 200, "text/html; charset=utf-8", ownerSecurityPage());
  }

  return sendJson(response, 404, { error: "not_found" });
});

const verify = createServer(async (request, response) => {
  if (request.method === "GET" && (request.url ?? "/") === "/healthz") {
    return sendJson(response, 200, { status: "ok" });
  }
  if (request.method !== "POST" || (request.url ?? "/") !== "/verify") {
    return sendJson(response, 404, { error: "not_found" });
  }

  const body = await readJson(request);
  if (!body) return sendJson(response, 400, { error: "invalid_json" });
  const checkpointId = typeof body.checkpointId === "string" ? body.checkpointId : "";
  const known = [...Object.keys(FLAGS), "security-remediation"];
  if (!known.includes(checkpointId)) {
    return sendJson(response, 400, { error: "unknown_checkpoint" });
  }
  const submission = typeof body.submission === "string" ? body.submission.trim() : "";
  if (submission.length < 1 || submission.length > 200) {
    return sendJson(response, 400, { checkpointId, error: "invalid_submission" });
  }

  const remediated =
    !controls.trustClientProxyHeader &&
    !controls.verboseOpsResponse &&
    !controls.terminalCustomerAccess &&
    controls.staffPinThrottle &&
    controls.secretsSeparated;
  const correct =
    checkpointId === "security-remediation"
      ? submission.toUpperCase() === "VERIFY" && remediated
      : submission === FLAGS[checkpointId];
  return sendJson(response, 200, {
    checkpointId,
    correct,
    message: correct
      ? "Checkpoint cleared."
      : checkpointId === "security-remediation"
        ? "The security controls are not fully remediated yet."
        : "That is not the passphrase for this checkpoint.",
  });
});

challenge.listen(8080, "0.0.0.0", () => console.log("challenge on :8080"));
verify.listen(8081, "0.0.0.0", () => console.log("verify on :8081"));
