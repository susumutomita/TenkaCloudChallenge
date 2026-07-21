import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { DatabaseSync } from "node:sqlite";
import { listProfilesFor, profileOf } from "./authorization.mjs";

/**
 * api-idor-demo — a DELIBERATELY VULNERABLE profile API for TenkaCloud local
 * play. It has a Broken Object Level Authorization flaw (IDOR, OWASP
 * API1:2023) on purpose. Never expose it off loopback; the compose file binds
 * it to 127.0.0.1 only.
 *
 * Two servers run in one process:
 *   :8080  the profile API the participant attacks
 *   :8081  the loopback `/verify` endpoint the TenkaCloud scorer delegates to
 *
 * The flag is derived from FLAG_SEED at runtime and lives only in the admin
 * (id 1) record's private note, so nothing secret is committed and each deploy
 * is unique. The admin's token is also seed-derived (unknowable), so signing in
 * as admin is NOT the intended path — reading their object by id is.
 */

const FLAG_SEED = process.env.FLAG_SEED ?? "local-dev-seed";
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const FLAG = `TC{idor_${sha256(`flag:${FLAG_SEED}`).slice(0, 20)}}`;
// Unknowable → you cannot just authenticate as the admin.
const ADMIN_TOKEN = `token-${sha256(`admin:${FLAG_SEED}`).slice(0, 16)}`;

const db = new DatabaseSync(":memory:");
db.exec(
  "CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT, token TEXT, role TEXT, secret_note TEXT)",
);
const seed = db.prepare(
  "INSERT INTO users (id, username, token, role, secret_note) VALUES (?, ?, ?, ?, ?)",
);
seed.run(1, "root", ADMIN_TOKEN, "admin", FLAG);
seed.run(2, "alice", "token-alice", "user", "Reminder: rotate the staging keys on Monday.");
// id 3 (guest) is the account handed to the participant.
seed.run(3, "guest", "token-guest", "user", "Welcome! This is your demo account.");

const userByToken = db.prepare("SELECT * FROM users WHERE token = ?");
const userById = db.prepare("SELECT * FROM users WHERE id = ?");
const allUsers = db.prepare("SELECT * FROM users");

function bearer(request) {
  const header = request.headers.authorization ?? "";
  return header.startsWith("Bearer ") ? header.slice(7).trim() : "";
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

function send(response, status, contentType, body) {
  response.writeHead(status, { "content-type": contentType });
  response.end(body);
}

const HOME = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Acme Profile API</title></head>
<body style="font-family:system-ui;max-width:40rem;margin:3rem auto;line-height:1.6">
<h1>Acme Profile API</h1>
<p>You are signed in as <code>guest</code>. Your API token is <code>token-guest</code>.</p>
<h2>Read your profile</h2>
<pre>curl -H "Authorization: Bearer token-guest" http://127.0.0.1:18080/api/profile
curl -H "Authorization: Bearer token-guest" http://127.0.0.1:18080/api/profiles
curl -H "Authorization: Bearer token-guest" http://127.0.0.1:18080/api/profile/3</pre>
<p><code>/api/profiles</code> lists the profiles you are authorized to see — as a
guest, just your own. Notice the shape: <code>id</code> is a small integer.</p>
<p>The administrator is <b>user id 1</b> (<code>root</code>), and the flag lives in
their <i>private note</i>. You do <b>not</b> know the admin's token, so you cannot
sign in as them. Find another way to read their object.</p>
</body></html>`;

const challenge = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  const { method } = request;

  if (method === "GET" && url.pathname === "/healthz") {
    return send(response, 200, "application/json", JSON.stringify({ status: "ok" }));
  }
  if (method === "GET" && url.pathname === "/") {
    return send(response, 200, "text/html; charset=utf-8", HOME);
  }

  // Intended endpoint: read *your own* profile, identified by your token.
  if (method === "GET" && url.pathname === "/api/profile") {
    const me = userByToken.get(bearer(request));
    if (!me) {
      return send(response, 401, "application/json", JSON.stringify({ error: "unauthorized" }));
    }
    return send(response, 200, "application/json", JSON.stringify(profileOf(me)));
  }

  // Intended discovery endpoint: list the profiles you are authorized to see.
  // Unlike /api/profile/:id below, this one enforces both an ownership/role
  // check AND a least-privilege response shape (see authorization.mjs) — a
  // guest only ever sees their own {id, username, role}, never secret_note.
  // It exists so recon looks like a real API walk (see the shape, notice `id`
  // is a small integer) rather than a blind guess at id=1.
  if (method === "GET" && url.pathname === "/api/profiles") {
    const me = userByToken.get(bearer(request));
    if (!me) {
      return send(response, 401, "application/json", JSON.stringify({ error: "unauthorized" }));
    }
    const profiles = listProfilesFor(allUsers.all(), me);
    return send(response, 200, "application/json", JSON.stringify({ profiles }));
  }

  // VULNERABLE: read any profile by id. It requires a valid token, but never
  // checks that the requested id is your own — classic IDOR / broken object
  // level authorization. So a guest can read the admin's private note (the flag).
  const match = url.pathname.match(/^\/api\/profile\/(\d+)$/);
  if (method === "GET" && match) {
    const me = userByToken.get(bearer(request));
    if (!me) {
      return send(response, 401, "application/json", JSON.stringify({ error: "unauthorized" }));
    }
    const target = userById.get(Number(match[1]));
    if (!target) {
      return send(response, 404, "application/json", JSON.stringify({ error: "not_found" }));
    }
    return send(response, 200, "application/json", JSON.stringify(profileOf(target)));
  }

  return send(response, 404, "application/json", JSON.stringify({ error: "not_found" }));
});

const verify = createServer(async (request, response) => {
  if (request.method !== "POST" || (request.url ?? "/") !== "/verify") {
    return send(response, 404, "application/json", JSON.stringify({ error: "not_found" }));
  }
  const raw = await readBody(request);
  let submission = "";
  try {
    submission = String(JSON.parse(raw).submission ?? "");
  } catch {
    submission = "";
  }
  const correct = submission.trim() === FLAG;
  // The failure message must not leak the expected flag or scoring internals.
  send(
    response,
    200,
    "application/json",
    JSON.stringify({
      correct,
      message: correct ? "Flag accepted." : "That is not the flag for this challenge.",
    }),
  );
});

challenge.listen(8080, "0.0.0.0", () => console.log("challenge on :8080"));
verify.listen(8081, "0.0.0.0", () => console.log("verify on :8081"));
