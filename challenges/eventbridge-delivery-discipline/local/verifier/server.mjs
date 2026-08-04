import { createServer } from "node:http";
import { decodeSubmission, encodeSubmission } from "../app/engine.mjs";
import { gradeAll, gradeCheckpoint } from "./grader.mjs";
import { runPublicCases } from "./public-cases.mjs";

const BODY_LIMIT = 16 * 1024;
const HEADER_LIMIT = 8 * 1024;
const PORT = Number(process.env.PORT || 8081);
const HEADERS = Object.freeze({
  "cache-control": "no-store",
  "content-type": "application/json; charset=utf-8",
  "x-content-type-options": "nosniff",
});

function requestUrl(target) {
  try {
    return new URL(String(target ?? "/"), "http://127.0.0.1");
  } catch {
    return new URL("http://127.0.0.1/__malformed_request__");
  }
}

function isAllowedWorkbenchOrigin(originText, hostText) {
  let origin;
  try {
    origin = new URL(originText);
  } catch {
    return false;
  }
  const host = String(hostText ?? "").toLowerCase();
  if (
    origin.protocol === "http:" &&
    ["127.0.0.1", "localhost"].includes(origin.hostname) &&
    ["127.0.0.1", "localhost"].includes(host.split(":", 1)[0])
  ) {
    const originPort = Number(origin.port);
    const verifierPort = Number(host.slice(host.lastIndexOf(":") + 1));
    return Number.isInteger(originPort) && verifierPort === originPort + 1;
  }
  if (origin.protocol !== "https:") return false;
  const originMatch = origin.hostname.match(/^(.*-)(\d+)(\.app\.github\.dev)$/);
  const hostMatch = host.match(/^(.*-)(\d+)(\.app\.github\.dev)$/);
  return Boolean(
    originMatch &&
      hostMatch &&
      originMatch[1] === hostMatch[1] &&
      originMatch[3] === hostMatch[3] &&
      Number(hostMatch[2]) === Number(originMatch[2]) + 1,
  );
}

function corsHeaders(request) {
  const origin = typeof request.headers.origin === "string" ? request.headers.origin : "";
  if (!isAllowedWorkbenchOrigin(origin, request.headers.host)) return null;
  return { "access-control-allow-origin": origin, vary: "Origin" };
}

function send(response, status, payload, extra = {}) {
  const body = JSON.stringify(payload);
  response.writeHead(status, { ...HEADERS, "content-length": Buffer.byteLength(body), ...extra });
  response.end(body);
}

function preflight(response, cors) {
  response.writeHead(204, {
    ...cors,
    "access-control-allow-headers": "content-type",
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-max-age": "600",
    "cache-control": "no-store",
    "content-length": "0",
    "x-content-type-options": "nosniff",
  });
  response.end();
}

function readJson(request) {
  return new Promise((resolve) => {
    const declared = Number(request.headers["content-length"] ?? 0);
    if (!Number.isInteger(declared) || declared <= 0 || declared > BODY_LIMIT) {
      request.resume();
      resolve(null);
      return;
    }
    const chunks = [];
    let size = 0;
    let settled = false;
    const finish = (value) => {
      if (!settled) {
        settled = true;
        resolve(value);
      }
    };
    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > BODY_LIMIT) {
        request.destroy();
        finish(null);
      } else chunks.push(chunk);
    });
    request.on("end", () => {
      if (settled || size !== declared) return finish(null);
      try {
        const value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        finish(value && typeof value === "object" && !Array.isArray(value) ? value : null);
      } catch {
        finish(null);
      }
    });
    request.on("error", () => finish(null));
  });
}

const server = createServer({ maxHeaderSize: HEADER_LIMIT }, async (request, response) => {
  const url = requestUrl(request.url);
  if (request.method === "GET" && url.pathname === "/healthz") return send(response, 200, { status: "ok" });
  if (request.method === "OPTIONS" && ["/public-test", "/prepare"].includes(url.pathname)) {
    const cors = corsHeaders(request);
    if (!cors) return send(response, 403, { error: "origin_not_allowed" });
    return preflight(response, cors);
  }
  if (request.method === "POST" && ["/public-test", "/prepare"].includes(url.pathname)) {
    const cors = corsHeaders(request);
    if (!cors) return send(response, 403, { error: "origin_not_allowed" });
    const body = await readJson(request);
    if (!body) return send(response, 400, { error: "invalid_json" }, cors);
    const report = runPublicCases(body.policy);
    const payload = { report };
    if (url.pathname === "/prepare" && report.correct) payload.submission = encodeSubmission(body.policy);
    return send(response, 200, payload, cors);
  }
  if (request.method !== "POST" || url.pathname !== "/verify") return send(response, 404, { error: "not_found" });
  const body = await readJson(request);
  if (!body) return send(response, 400, { error: "invalid_json" });
  const policy = decodeSubmission(body.submission);
  const report = policy ? gradeCheckpoint(policy, body.checkpointId) : { checkpointId: body.checkpointId, correct: false, errors: ["invalid submission"] };
  return send(response, 200, {
    checkpointId: typeof body.checkpointId === "string" ? body.checkpointId : "",
    correct: report.correct === true,
    message: report.correct ? "Delivery invariant accepted." : "The checkpoint still has a counterexample.",
  });
});

server.requestTimeout = 10_000;
server.headersTimeout = 10_000;
server.listen(PORT, "0.0.0.0");

export { gradeAll };
