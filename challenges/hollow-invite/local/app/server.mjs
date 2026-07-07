import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, normalize } from "node:path";

/**
 * Operation "Hollow Invite" — isolated IR GameDay mock for TenkaCloud local play.
 *
 * This is NOT a vulnerable app to exploit. It is the investigation tenant for a
 * multi-layer social-engineering incident: a hijacked / re-registered company
 * domain sends an SPF/DKIM/DMARC-passing lure to a fake "Vela Meet" page whose
 * funnel targets wallets / credentials / device control.
 *
 * SAFETY INVARIANTS (also checked by local/safety-check.mjs):
 *   - Only reserved names are used: *.example and *.tenka.local.
 *   - No external egress; every served URL is same-origin or an in-tenant marker.
 *   - The "download" endpoint never returns a binary/installer/EICAR — only a URL
 *     to the in-tenant benign marker, or nothing (payload "none") for a
 *     non-matching client OS.
 *
 * Two servers run in one process:
 *   :8080  the investigation surface (artifacts + mock RDAP / meeting APIs + clone)
 *   :8081  the loopback /verify endpoint the TenkaCloud scorer delegates to
 *          (multi-verify: request carries a checkpointId, response echoes it)
 *
 * FLAG-1 (the sender domain's registration date) is derived from FLAG_SEED, so
 * it is unique per deploy and can only be read from the mock RDAP, not memorized.
 * FLAG-2/3/4 are structural facts recovered by analysing the committed evidence.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const FLAG_SEED = process.env.FLAG_SEED ?? "local-dev-seed";
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const seedInt = (label) => parseInt(sha256(`${label}:${FLAG_SEED}`).slice(0, 12), 16);

// ----- Scenario constants (fictional; reserved TLDs only) --------------------
const SENDER_DOMAIN = "northgate-cowork.example"; // hijacked / re-registered
const LURE_DOMAIN = "velameet-07.example"; // attacker funnel
const VICTIM_DOMAIN = "kestrel-dyn.example"; // the defending org (established)
const DKIM_DOMAIN = SENDER_DOMAIN; // DKIM d= in the .eml → FLAG-2
const IMPERSONATOR = "Daniel Whitmore"; // claimed Northgate co-founder → FLAG-4
const ROOM_ID = "qrt-mkbd-zol";
const DOWNLOAD_PATH_PATTERN = "/meetings/{id}/download"; // FLAG-3

// Per-deploy registration dates. northgate is registered only a few months
// before the email (2026-07-06) despite the company claiming to be established
// — that contradiction is OBJ-1. FLAG-1 is northgate's registration date.
function isoDate(baseYear, baseMonth, baseDay, addDays) {
  const d = new Date(Date.UTC(baseYear, baseMonth - 1, baseDay));
  d.setUTCDate(d.getUTCDate() + addDays);
  return d.toISOString().slice(0, 10); // YYYY-MM-DD
}
const NORTHGATE_REG_DATE = isoDate(2026, 3, 15, seedInt("northgate-reg") % 46); // ~Mar–Apr 2026
const LURE_REG_DATE = isoDate(2026, 6, 20, seedInt("lure-reg") % 10); // ~late Jun 2026
const VICTIM_REG_DATE = isoDate(2018, 5, 9, 0); // years old (contrast)
const FLAG1_DATE = NORTHGATE_REG_DATE;

// ----- Evidence files (served read-only) -------------------------------------
function readArtifact(rel) {
  const full = normalize(join(HERE, rel));
  if (!full.startsWith(HERE)) return null; // no traversal
  try {
    return readFileSync(full);
  } catch {
    return null;
  }
}

const CONTENT_TYPES = {
  ".eml": "message/rfc822; charset=utf-8",
  ".jsonl": "application/x-ndjson; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};
const extOf = (p) => (p.match(/\.[a-z]+$/i) || [""])[0].toLowerCase();

// ----- RDAP mock -------------------------------------------------------------
const RDAP_DB = {
  [SENDER_DOMAIN]: { reg: NORTHGATE_REG_DATE, changed: "2026-06-30", status: ["active"] },
  [LURE_DOMAIN]: { reg: LURE_REG_DATE, changed: LURE_REG_DATE, status: ["active", "client hold"] },
  [VICTIM_DOMAIN]: { reg: VICTIM_REG_DATE, changed: "2025-11-02", status: ["active"] },
};
function rdapFor(name) {
  const row = RDAP_DB[name.toLowerCase()];
  if (!row) return null;
  return {
    objectClassName: "domain",
    ldhName: name.toLowerCase(),
    status: row.status,
    events: [
      { eventAction: "registration", eventDate: `${row.reg}T00:00:00Z` },
      { eventAction: "last changed", eventDate: `${row.changed}T00:00:00Z` },
    ],
    entities: [
      {
        objectClassName: "entity",
        roles: ["registrant"],
        vcardArray: ["vcard", [["fn", {}, "text", "REDACTED FOR PRIVACY"]]],
      },
    ],
    notices: [
      {
        title: "Isolated exercise data",
        description: ["Mock RDAP for the Hollow Invite GameDay. Reserved TLD only."],
      },
    ],
  };
}

// ----- helpers ---------------------------------------------------------------
function send(response, status, contentType, body) {
  response.writeHead(status, { "content-type": contentType, "cache-control": "no-store" });
  response.end(body);
}
function json(response, status, obj) {
  send(response, status, "application/json; charset=utf-8", JSON.stringify(obj));
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

const INDEX_PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Hollow Invite — evidence tenant</title>
<style>body{font-family:system-ui;max-width:46rem;margin:3rem auto;line-height:1.6;color:#1b2733}
code{background:#eef1f5;padding:.1rem .35rem;border-radius:4px}h2{margin-top:1.6rem}</style></head>
<body>
<h1>Hollow Invite — isolated evidence tenant</h1>
<p>You are the Kestrel Dynamics response team. Everything below stays inside this
box; there is no external network. Reserved names only (<code>*.example</code>,
<code>*.tenka.local</code>).</p>
<h2>Distributed evidence</h2>
<ul>
  <li><a href="/artifacts/hollow-invite.eml">hollow-invite.eml</a> — the reported message (raw, with headers)</li>
  <li><a href="/clone/">clone/</a> — captured, sanitized copy of the fake meeting page (read <a href="/clone/app.js">app.js</a>)</li>
  <li><a href="/artifacts/proxylog.jsonl">proxylog.jsonl</a> — network observation log (released at T+45)</li>
</ul>
<h2>Mock lookups &amp; endpoints</h2>
<ul>
  <li><code>GET /rdap/domain/{name}</code> — domain registration data (try the sender and the meeting domain)</li>
  <li><code>GET /api/meetings/{id}</code> — meeting metadata</li>
  <li><code>POST /meetings/{id}/download</code> — the page's dynamic "helper" issuance (in-tenant marker only)</li>
  <li><code>POST /api/heartbeat</code> — the page's presence beacon</li>
</ul>
<p>Submit each finding as a flag in the portal. Stuck? Open a hint (they cost points).</p>
</body></html>`;

// ----- challenge / investigation surface (:8080) -----------------------------
const challenge = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  const p = url.pathname;
  const method = request.method ?? "GET";

  if (method === "GET" && p === "/healthz") return json(response, 200, { status: "ok" });
  if (method === "GET" && (p === "/" || p === "/index.html")) {
    return send(response, 200, "text/html; charset=utf-8", INDEX_PAGE);
  }

  // Evidence files.
  if (method === "GET" && p.startsWith("/artifacts/")) {
    const name = p.slice("/artifacts/".length);
    if (!/^[a-z0-9._-]+$/i.test(name)) return json(response, 404, { error: "not_found" });
    const body = readArtifact(join("artifacts", name));
    if (!body) return json(response, 404, { error: "not_found" });
    return send(response, 200, CONTENT_TYPES[extOf(name)] ?? "application/octet-stream", body);
  }
  if (method === "GET" && (p === "/clone" || p === "/clone/")) {
    return send(response, 200, "text/html; charset=utf-8", readArtifact("clone/index.html"));
  }
  if (method === "GET" && p.startsWith("/clone/")) {
    const name = p.slice("/clone/".length);
    if (!/^[a-z0-9._-]+$/i.test(name)) return json(response, 404, { error: "not_found" });
    const body = readArtifact(join("clone", name));
    if (!body) return json(response, 404, { error: "not_found" });
    return send(response, 200, CONTENT_TYPES[extOf(name)] ?? "application/octet-stream", body);
  }

  // Mock RDAP.
  const rdap = p.match(/^\/rdap\/domain\/([a-z0-9.-]+)$/i);
  if (method === "GET" && rdap) {
    const data = rdapFor(rdap[1]);
    if (!data) return json(response, 404, { errorCode: 404, title: "Not Found" });
    return send(response, 200, "application/rdap+json; charset=utf-8", JSON.stringify(data, null, 2));
  }

  // Meeting metadata (the fabricated meeting).
  const meeting = p.match(/^\/api\/meetings\/([a-z0-9-]+)$/i);
  if (method === "GET" && meeting) {
    return json(response, 200, {
      id: meeting[1],
      title: "Technical Architecture Review",
      organizer: { name: IMPERSONATOR, org: "Northgate Cowork", email: `general@${SENDER_DOMAIN}` },
      joinUrl: `https://${LURE_DOMAIN}/room/${meeting[1]}`,
      tool: "Vela Meet",
    });
  }

  // OS-differentiated dynamic download issuance. Never a binary — only a URL to
  // the in-tenant marker (for a "matched" OS) or nothing (payload "none").
  const download = p.match(/^\/meetings\/([a-z0-9-]+)\/download$/i);
  if (method === "POST" && download) {
    const raw = await readBody(request);
    let os = "other";
    try {
      os = String(JSON.parse(raw).os ?? "other").toLowerCase();
    } catch {
      os = "other";
    }
    const matched = os === "windows" || os === "macos";
    return json(response, 200, {
      room: download[1],
      // Dynamic issuance: the client never had this URL until now.
      artifactUrl: matched ? "/artifacts/benign-marker.txt" : null,
      // "none" means "no build for THIS client" — not "safe". (BONUS-3b)
      payload: matched ? "training-marker" : "none",
    });
  }

  // Presence beacon.
  if (method === "POST" && p === "/api/heartbeat") {
    response.writeHead(204, { "cache-control": "no-store" });
    return response.end();
  }

  return json(response, 404, { error: "not_found" });
});

// ----- multi-verify grading (:8081) ------------------------------------------
const stripWrapper = (s) => s.trim().replace(/^(?:flag|tc)\s*\{(.*)\}$/i, "$1").trim();
const normDownloadPath = (s) =>
  stripWrapper(s)
    .replace(/^(?:post|get)\s+/i, "")
    .replace(/^https?:\/\/[^/]+/i, "")
    .replace(/\/meetings\/[a-z0-9-]+\/download/i, "/meetings/{id}/download")
    .trim();
const normName = (s) => stripWrapper(s).replace(/[_\s]+/g, " ").trim().toLowerCase();

// checkpointId -> grader(submission) => boolean
const GRADERS = {
  "domain-age": (s) => stripWrapper(s) === FLAG1_DATE,
  "dkim-domain": (s) => stripWrapper(s).toLowerCase() === DKIM_DOMAIN,
  "download-path": (s) => normDownloadPath(s) === DOWNLOAD_PATH_PATTERN,
  impersonator: (s) => normName(s) === IMPERSONATOR.toLowerCase(),
};

const verify = createServer(async (request, response) => {
  if (request.method === "GET" && (request.url ?? "/") === "/healthz") {
    return json(response, 200, { status: "ok" });
  }
  if (request.method !== "POST" || (request.url ?? "/") !== "/verify") {
    return json(response, 404, { error: "not_found" });
  }
  const raw = await readBody(request);
  let checkpointId = "";
  let submission = "";
  try {
    const body = JSON.parse(raw);
    checkpointId = String(body.checkpointId ?? "");
    submission = String(body.submission ?? "");
  } catch {
    checkpointId = "";
    submission = "";
  }
  const grader = GRADERS[checkpointId];
  const correct = typeof grader === "function" ? grader(submission) : false;
  // Fail closed on an unknown checkpoint, and ALWAYS echo checkpointId so the
  // platform never mis-credits another checkpoint (AGENT.md §13).
  return json(response, 200, {
    checkpointId,
    correct,
    message: correct
      ? "Correct — finding accepted."
      : "That does not match the expected finding for this checkpoint.",
  });
});

challenge.listen(8080, "0.0.0.0", () => console.log("investigation surface on :8080"));
verify.listen(8081, "0.0.0.0", () => console.log("verify on :8081"));
