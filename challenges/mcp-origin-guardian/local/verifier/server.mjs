import { createServer } from "node:http";
import { decodeSubmission } from "../app/policy.mjs";
import { gradePolicy } from "./grader.mjs";

const BODY_LIMIT = 32 * 1024;
const PORT = Number(process.env.PORT || 8081);
const HEADERS = Object.freeze({
  "cache-control": "no-store",
  "content-type": "application/json; charset=utf-8",
  "x-content-type-options": "nosniff",
});

function send(response, status, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(status, { ...HEADERS, "content-length": Buffer.byteLength(body) });
  response.end(body);
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
      } else {
        chunks.push(chunk);
      }
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

const server = createServer(async (request, response) => {
  if (request.method === "GET" && request.url === "/healthz") {
    return send(response, 200, { status: "ok" });
  }
  if (request.method !== "POST" || request.url !== "/verify") {
    return send(response, 404, { error: "not_found" });
  }
  const body = await readJson(request);
  if (!body) return send(response, 400, { error: "invalid_json" });

  const policy = decodeSubmission(body.submission);
  const report = policy ? gradePolicy(policy) : { correct: false };
  return send(response, 200, {
    checkpointId: typeof body.checkpointId === "string" ? body.checkpointId : "",
    correct: report.correct === true,
    message: report.correct
      ? "Canonical authority policy accepted."
      : "The policy still trusts an unsafe authority.",
  });
});

server.requestTimeout = 10_000;
server.headersTimeout = 10_000;
server.listen(PORT, "0.0.0.0");
