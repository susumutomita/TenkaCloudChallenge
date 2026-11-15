import { createServer } from "node:http";
import { createChecks } from "./checks.mjs";

/**
 * php-attachment-viewer-lab -- the loopback /verify scorer (port 8081).
 *
 * TenkaCloud delegates every submission here as
 *   POST /verify {"checkpointId": "...", "submission": "..."}
 * and this server answers {"checkpointId", "correct", "message"}, echoing the
 * checkpointId back (AGENTS.md #13). The message never carries the expected
 * value, the seed or hint content (AGENTS.md #15).
 */

const seed = process.env.FLAG_SEED ?? "";
if (seed === "") throw new Error("FLAG_SEED is required (per-run secret; docker-compose.yml injects it)");
const surfaceUrl = (process.env.SURFACE_URL ?? "http://surface:8080").replace(/\/+$/, "");
const checks = createChecks({ surfaceUrl, seed });

function send(res, status, body) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

export const server = createServer(async (req, res) => {
  const url = req.url ?? "/";
  if (req.method === "GET" && url === "/healthz") return send(res, 200, { status: "ok" });
  if (req.method !== "POST" || url !== "/verify") return send(res, 404, { error: "not_found" });
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 16 * 1024) return send(res, 413, { correct: false, message: "Submission too large." });
  }
  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    return send(res, 400, { correct: false, message: "Body must be JSON." });
  }
  const checkpointId = typeof body?.checkpointId === "string" ? body.checkpointId : "";
  const submission = typeof body?.submission === "string" ? body.submission : "";
  const handler = Object.hasOwn(checks, checkpointId) ? checks[checkpointId] : undefined;
  if (!handler) return send(res, 400, { checkpointId, correct: false, error: "unknown_checkpoint" });
  let correct = false;
  try {
    correct = (await handler(submission)) === true;
  } catch {
    correct = false;
  }
  send(res, 200, {
    checkpointId,
    correct,
    message: correct ? "Confirmed." : "Not yet. Re-check the live portal, or open a hint.",
  });
});

server.listen(Number(process.env.PORT ?? 8081), process.env.BIND ?? "127.0.0.1", () => {
  console.log(`[verify] listening on ${JSON.stringify(server.address())}; surface=${surfaceUrl}`);
});
