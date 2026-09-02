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
 * All four graded answers are derived from FLAG_SEED (AGENTS.md §13), so none
 * of them is a fixed value a participant could carry in from a writeup:
 *   FLAG-1 (sender domain registration date) — only readable via the mock RDAP.
 *   FLAG-2 (DKIM signing domain)             — only readable via the .eml's
 *                                               DKIM-Signature header.
 *   FLAG-3 (download endpoint path)          — only readable via static
 *                                               analysis of clone/app.js.
 *   FLAG-4 (impersonated person)             — readable via the .eml and the
 *                                               meeting API.
 */

/**
 * Parse a request target without letting a malformed one end the process.
 *
 * `GET //` is a protocol-relative reference with no host, and `new URL` rejects
 * it. This app serves its challenge surface and its `/verify` scorer from one
 * process, so an unguarded parse in the handler takes both down over a stray
 * slash. Leading slashes are collapsed (which is what the client meant) and
 * anything still unparseable becomes a target the router will not match, so a
 * malformed request is a 404 rather than a crash.
 */
function requestUrl(target, base) {
  try {
    return new URL(String(target ?? "/").replace(/^\/+/, "/"), base);
  } catch {
    return new URL("/__malformed_request__", base);
  }
}

const HERE = dirname(fileURLToPath(import.meta.url));
const FLAG_SEED = process.env.FLAG_SEED ?? "local-dev-seed";
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const seedInt = (label) => parseInt(sha256(`${label}:${FLAG_SEED}`).slice(0, 12), 16);

// ----- Scenario constants (fictional; reserved TLDs only) --------------------
const SENDER_DOMAIN = "northgate-cowork.example"; // hijacked / re-registered
const LURE_DOMAIN = "velameet-07.example"; // attacker funnel
const VICTIM_DOMAIN = "kestrel-dyn.example"; // the defending org (established)
const ROOM_ID = "qrt-mkbd-zol";

// FLAG-2/3/4 pools. Each is picked from a small fixed list by seedInt(), the
// same per-deploy derivation FLAG-1 already uses, so none of the four graded
// answers is a constant a participant could carry in from a writeup.
const IMPERSONATOR_NAMES = [
  "Daniel Whitmore", "Marcus Reyes", "Evan Sinclair", "Nathaniel Cross",
  "Julian Ashford", "Gregory Holt", "Owen Kessler", "Adrian Voss",
  "Lucas Bramwell", "Trevor Lindqvist", "Miles Sutherland", "Connor Hargrove",
  "Derek Fenwick", "Nolan Ashcroft", "Peter Callahan", "Simon Wexford",
];
const DKIM_RELAY_WORDS = [
  "swiftpost", "brightwave", "cobalt", "summit", "lucent", "vertex",
  "meridian", "outrigger", "tidewater", "fernwood", "granite", "cascade",
  "amberlink", "graypine", "stonebridge", "alderbrook",
];
const DOWNLOAD_SUFFIX_WORDS = [
  "helper", "install", "deploy", "launcher", "package", "bundle", "assets",
  "setup", "retrieve", "obtain", "provision", "dist", "client", "grab",
  "fetch", "agent",
];

const IMPERSONATOR = // claimed Northgate co-founder → FLAG-4
  IMPERSONATOR_NAMES[seedInt("impersonator") % IMPERSONATOR_NAMES.length];
const IMPERSONATOR_FIRST = IMPERSONATOR.split(" ")[0]; // for the .eml's quoted first-name reference
// DKIM d= names a bulk-relay domain distinct from the sender/From domain —
// realistic (many senders sign under their ESP/relay, not their own domain)
// and it keeps this value from being readable off the sender or organizer
// email domain → FLAG-2. DMARC still passes on SPF alignment alone.
const DKIM_DOMAIN = `mail-relay-${DKIM_RELAY_WORDS[seedInt("dkim-relay") % DKIM_RELAY_WORDS.length]}.example`;
const DOWNLOAD_SUFFIX = // last path segment, discoverable only in clone/app.js
  DOWNLOAD_SUFFIX_WORDS[seedInt("download-suffix") % DOWNLOAD_SUFFIX_WORDS.length];
const DOWNLOAD_PATH_PATTERN = `/meetings/{id}/${DOWNLOAD_SUFFIX}`; // FLAG-3
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const DOWNLOAD_ROUTE_RE = new RegExp(`^/meetings/([a-z0-9-]+)/${escapeRe(DOWNLOAD_SUFFIX)}$`, "i");

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

// ----- Evidence files (served read-only, template-substituted) --------------
// The committed fixtures hold literal placeholders (__IMPERSONATOR__,
// __IMPERSONATOR_FIRST__, __DKIM_DOMAIN__, __DOWNLOAD_SUFFIX__) instead of the
// per-deploy secrets, so nothing seed-derived is ever committed — only
// server.mjs combines the two, at read time, for every artifact/clone file it
// serves.
function applyTemplate(text) {
  return text
    .replaceAll("__IMPERSONATOR_FIRST__", IMPERSONATOR_FIRST)
    .replaceAll("__IMPERSONATOR__", IMPERSONATOR)
    .replaceAll("__DKIM_DOMAIN__", DKIM_DOMAIN)
    .replaceAll("__DOWNLOAD_SUFFIX__", DOWNLOAD_SUFFIX);
}
function readArtifact(rel) {
  const full = normalize(join(HERE, rel));
  if (!full.startsWith(HERE)) return null; // no traversal
  try {
    return Buffer.from(applyTemplate(readFileSync(full, "utf8")), "utf8");
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
<html lang="en"><head><meta name="color-scheme" content="light"><meta charset="utf-8"><title>Hollow Invite — evidence tenant</title>
<style>body{font-family:system-ui;max-width:46rem;margin:3rem auto;line-height:1.6;background:#fff;color:#1b2733}
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
  <li><code>POST /meetings/{id}/…</code> — the page's dynamic "helper" issuance (in-tenant marker only; exact path is only in <code>clone/app.js</code>)</li>
  <li><code>POST /api/heartbeat</code> — the page's presence beacon</li>
</ul>
<p>Submit each finding as a flag in the portal. Stuck? Open a hint (they cost points).</p>
</body></html>`;

// ----- challenge / investigation surface (:8080) -----------------------------
const challenge = createServer(async (request, response) => {
  const url = requestUrl(request.url, "http://127.0.0.1");
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
  const download = p.match(DOWNLOAD_ROUTE_RE);
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
    .replace(
      new RegExp(`/meetings/[a-z0-9-]+/${escapeRe(DOWNLOAD_SUFFIX)}`, "i"),
      `/meetings/{id}/${DOWNLOAD_SUFFIX}`,
    )
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
  // platform never mis-credits another checkpoint (AGENTS.md §13).
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
