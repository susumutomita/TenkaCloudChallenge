import { createHash } from "node:crypto";
import { createServer } from "node:http";

/**
 * wp-exposed-backup — the loopback `/verify` the TenkaCloud scorer delegates to.
 * It holds the flag, derived from FLAG_SEED exactly as the WordPress container's
 * seed-and-start.sh derives it, so nothing secret is committed and each deploy is
 * unique. Bound to 127.0.0.1 only by the compose file.
 */

const FLAG_SEED = process.env.FLAG_SEED ?? "local-dev-seed";
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const FLAG = `TC{wpbackup_${sha256(`flag:${FLAG_SEED}`).slice(0, 20)}}`;

function send(response, status, payload) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(payload));
}

const verify = createServer(async (request, response) => {
  if (request.method === "GET" && (request.url ?? "/") === "/healthz") {
    return send(response, 200, { status: "ok" });
  }
  if (request.method !== "POST" || (request.url ?? "/") !== "/verify") {
    return send(response, 404, { error: "not_found" });
  }
  const chunks = [];
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > 64 * 1024) {
      request.destroy();
      return send(response, 413, { error: "too_large" });
    }
    chunks.push(chunk);
  }
  let submission = "";
  try {
    submission = String(JSON.parse(Buffer.concat(chunks).toString("utf8")).submission ?? "");
  } catch {
    submission = "";
  }
  const correct = submission.trim() === FLAG;
  // The failure message must not leak the expected flag or scoring internals.
  send(response, 200, {
    correct,
    message: correct ? "Flag accepted." : "That is not the flag for this challenge.",
  });
});

verify.listen(8081, "0.0.0.0", () => console.log("verify on :8081"));
