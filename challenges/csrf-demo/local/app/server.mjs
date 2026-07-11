import { createHash } from "node:crypto";
import { createServer } from "node:http";

/**
 * csrf-demo — a DELIBERATELY VULNERABLE training target for TenkaCloud local
 * play. It is CSRF-injectable on purpose (IPA "安全なウェブサイトの作り方",
 * §1.6 クロスサイト・リクエスト・フォージェリ対策). Never expose it off
 * loopback; the compose file binds it to 127.0.0.1 only.
 *
 * Two servers run in one process:
 *   :8080  the challenge surface the participant attacks (link-report form + admin review)
 *   :8081  the loopback `/verify` endpoint the TenkaCloud scorer delegates to
 *
 * The flag is derived from FLAG_SEED at runtime, so nothing secret is
 * committed and each deploy is unique.
 */

const FLAG_SEED = process.env.FLAG_SEED ?? "local-dev-seed";
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const FLAG = `TC{csrf_${sha256(`flag:${FLAG_SEED}`).slice(0, 20)}}`;
// The admin's session token. Never exposed by any route in this app — a
// direct call to the settings endpoint can never succeed, so the flag is
// reachable only by getting the admin's own (simulated) browser to submit
// the forged request on the participant's behalf.
const ADMIN_SESSION = sha256(`session:${FLAG_SEED}`);

let notificationEmail = "admin@acme.example";
let changedViaForgery = false;

/** Reported "pages" (raw HTML strings) awaiting the security reviewer's pass. */
const reports = [];

function extractAttr(tag, name) {
  const match = new RegExp(`${name}\\s*=\\s*["']([^"']*)["']`, "i").exec(tag);
  return match ? match[1] : undefined;
}

/**
 * The vulnerability's counterpart: a plain, dependency-free extraction of the
 * first <form>'s action/method and its <input name=.. value=..> pairs. No
 * script execution is needed for CSRF — a classic auto-submitting form (or
 * even a bare <img>) is already enough, which is the whole point.
 */
function extractFirstForm(html) {
  const formMatch = /<form([^>]*)>([\s\S]*?)<\/form>/i.exec(html);
  if (!formMatch) return undefined;
  const action = extractAttr(formMatch[1], "action");
  const method = (extractAttr(formMatch[1], "method") ?? "GET").toUpperCase();
  if (!action) return undefined;
  const params = {};
  const inputRe = /<input([^>]*)>/gi;
  let inputMatch = inputRe.exec(formMatch[2]);
  while (inputMatch) {
    const name = extractAttr(inputMatch[1], "name");
    if (name) params[name] = extractAttr(inputMatch[1], "value") ?? "";
    inputMatch = inputRe.exec(formMatch[2]);
  }
  return { action, method, params };
}

/**
 * Simulates the security reviewer (already signed in as admin elsewhere)
 * opening every reported page. Their browser silently submits whatever form
 * it finds, attaching their ambient session — the same as a real browser
 * would. If that form targets this app's settings-change action, the change
 * goes through: nothing here ever checks that the request actually
 * originated from this app's own page (no CSRF token, no Origin check).
 */
function runReviewerSession() {
  let triggered = 0;
  for (const html of reports) {
    const form = extractFirstForm(html);
    if (!form) continue;
    if (form.action !== "/settings/email" || form.method !== "POST") continue;
    notificationEmail = form.params.email ?? "";
    changedViaForgery = true;
    triggered++;
  }
  return triggered;
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

function parseReport(contentType, raw) {
  if (contentType.includes("application/json")) {
    try {
      return { html: String(JSON.parse(raw).html ?? "") };
    } catch {
      return { html: "" };
    }
  }
  const params = new URLSearchParams(raw);
  return { html: params.get("html") ?? "" };
}

function parseSettingsChange(contentType, raw) {
  if (contentType.includes("application/json")) {
    try {
      const body = JSON.parse(raw);
      return { session: String(body.session ?? ""), email: String(body.email ?? "") };
    } catch {
      return { session: "", email: "" };
    }
  }
  const params = new URLSearchParams(raw);
  return { session: params.get("session") ?? "", email: params.get("email") ?? "" };
}

const REPORT_PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Acme Security - Report a Page</title></head>
<body style="font-family:system-ui;max-width:32rem;margin:3rem auto">
<h1>Acme Security — Report a Suspicious Page</h1>
<p>Paste the HTML of a page you would like our reviewer to check. The reviewer
checks new reports periodically while signed in to their own account.</p>
<form method="post" action="/report">
  <p><textarea name="html" rows="10" cols="60"></textarea></p>
  <p><button type="submit">Report</button></p>
</form>
</body></html>`;

function send(response, status, contentType, body) {
  response.writeHead(status, { "content-type": contentType });
  response.end(body);
}

const challenge = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  if (request.method === "GET" && url.pathname === "/healthz") {
    return send(response, 200, "application/json", JSON.stringify({ status: "ok" }));
  }
  if (request.method === "GET" && url.pathname === "/") {
    return send(response, 200, "text/html; charset=utf-8", REPORT_PAGE);
  }
  if (request.method === "POST" && url.pathname === "/report") {
    const raw = await readBody(request);
    const { html } = parseReport(request.headers["content-type"] ?? "", raw);
    if (!html) {
      return send(response, 400, "application/json", JSON.stringify({ error: "invalid_report" }));
    }
    reports.push(html);
    return send(response, 200, "application/json", JSON.stringify({ ok: true }));
  }
  if (request.method === "POST" && url.pathname === "/settings/email") {
    // The endpoint IS session-gated — this is not a missing-auth bug. The
    // vulnerability is that a valid session is all it checks: it never
    // verifies the request itself was intentionally submitted from this
    // app's own page (a CSRF token, a SameSite cookie, an Origin check).
    const raw = await readBody(request);
    const { session, email } = parseSettingsChange(request.headers["content-type"] ?? "", raw);
    if (session !== ADMIN_SESSION) {
      return send(response, 401, "application/json", JSON.stringify({ error: "unauthorized" }));
    }
    notificationEmail = email;
    return send(response, 200, "application/json", JSON.stringify({ ok: true }));
  }
  if (request.method === "POST" && url.pathname === "/admin/review-reports") {
    const triggered = runReviewerSession();
    return send(response, 200, "application/json", JSON.stringify({ ok: true, triggered }));
  }
  if (request.method === "GET" && url.pathname === "/admin/notification-status") {
    return send(
      response,
      200,
      "application/json",
      JSON.stringify({
        email: notificationEmail,
        ...(changedViaForgery ? { flag: FLAG } : {}),
      }),
    );
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
