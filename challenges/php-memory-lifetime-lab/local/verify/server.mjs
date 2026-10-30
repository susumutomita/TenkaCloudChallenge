import { createServer } from "node:http";
import { pathToFileURL } from "node:url";
import { timingSafeEqual } from "node:crypto";
import { CHECKPOINTS, assertSeed, flagFor } from "../app/flags.mjs";

function send(res, status, value) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(value));
}

async function readBody(req) {
  let body = "";
  let bytes = 0;
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > 8192) throw new Error("too_large");
    body += chunk;
  }
  return body;
}

export function verifierServer(seed) {
  assertSeed(seed);
  const server = createServer(async (req, res) => {
    if (req.method === "GET" && (req.url ?? "/") === "/healthz") {
      return send(res, 200, { status: "ok" });
    }
    if (req.method !== "POST" || (req.url ?? "/") !== "/verify") {
      return send(res, 404, { error: "not_found" });
    }
    try {
      const body = JSON.parse(await readBody(req));
      const checkpointId = typeof body?.checkpointId === "string" ? body.checkpointId : "";
      if (!CHECKPOINTS.includes(checkpointId)) {
        return send(res, 400, { error: "unknown_checkpoint" });
      }
      const submission = typeof body?.submission === "string" ? body.submission.trim() : "";
      if (submission.length < 1 || submission.length > 128) {
        return send(res, 400, { checkpointId, correct: false, message: "Invalid submission." });
      }
      const expected = Buffer.from(flagFor(checkpointId, seed));
      const got = Buffer.from(submission);
      const correct = got.length === expected.length && timingSafeEqual(got, expected);
      return send(res, 200, {
        checkpointId,
        correct,
        message: correct ? "Checkpoint cleared." : "That is not the flag for this checkpoint.",
      });
    } catch {
      return send(res, 400, { correct: false, error: "invalid_request" });
    }
  });
  server.requestTimeout = 5000;
  server.headersTimeout = 5000;
  server.maxHeadersCount = 32;
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const seed = process.env.FLAG_SEED;
  const server = verifierServer(seed);
  delete process.env.FLAG_SEED;
  server.listen(Number(process.env.PORT ?? 8081), process.env.BIND ?? "0.0.0.0");
}
