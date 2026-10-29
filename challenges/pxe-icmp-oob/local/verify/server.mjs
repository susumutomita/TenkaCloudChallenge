import { createServer } from "node:http";
import { flagFor, isCheckpoint, evaluate } from "./grading.mjs";

/**
 * pxe-icmp-oob — the loopback `/verify` the TenkaCloud scorer delegates to.
 *
 * Multi-checkpoint problem (TenkaCloud#2252). The scorer forwards a submission
 * together with the `checkpointId` it is asking about; this service derives the
 * checkpoint flag from its private FLAG_SEED (the participant surface only
 * forwards raw input to the separate internal evaluator) and
 * judges that one checkpoint.
 *
 * Contract (platform side: scripts/local-play/verify-client.ts):
 *   request  { checkpointId, submission, context }
 *   response { checkpointId, correct, message }
 * The response MUST echo the requested checkpointId, MUST NOT return `points`
 * (the platform holds the points for multi-verify), and the message must never
 * leak the flag, the expected value, the seed, or a stack trace. Bound to
 * 127.0.0.1 only by the compose file.
 */
const FLAG_SEED = process.env.FLAG_SEED;
if (!FLAG_SEED) throw new Error("FLAG_SEED is required for the private authority");

function send(res, status, value) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(value));
}

async function handle(req, res) {
  if (req.method === "GET" && (req.url ?? "/") === "/healthz")
    return send(res, 200, { status: "ok" });
  if (req.method !== "POST" || (req.url ?? "/") !== "/verify")
    return send(res, 404, { error: "not_found" });

  const chunks = [];
  let bytes = 0;
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > 64 * 1024) {
      return send(res, 413, { error: "too_large" });
    }
    chunks.push(chunk);
  }

  let body;
  try {
    body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return send(res, 400, { error: "invalid_json" });
  }

  const checkpointId = typeof body?.checkpointId === "string" ? body.checkpointId : "";
  if (!isCheckpoint(checkpointId)) return send(res, 400, { error: "unknown_checkpoint" });

  const submission = typeof body?.submission === "string" ? body.submission : "";
  if (submission.length < 1 || submission.length > 200) {
    return send(res, 400, { checkpointId, error: "invalid_submission" });
  }

  const correct = submission.trim() === flagFor(checkpointId, FLAG_SEED);
  send(res, 200, {
    checkpointId,
    correct,
    message: correct ? "Checkpoint cleared." : "That is not the flag for this checkpoint.",
  });
}

export const server = createServer({ requestTimeout: 5000, headersTimeout: 5000 }, (req, res) => {
  void handle(req, res).catch(() => {
    if (!res.headersSent) send(res, 400, { error: "invalid_request" });
    else res.end();
  });
});
server.listen(Number(process.env.PORT ?? 8081), process.env.BIND ?? "127.0.0.1");

// Separate internal-only listener: the published /verify port cannot issue flags.
export const evaluator = createServer(
  { requestTimeout: 5000, headersTimeout: 5000 },
  async (req, res) => {
    if (req.method !== "POST" || !["/icmp", "/quiz"].includes(req.url))
      return send(res, 404, { error: "not_found" });
    try {
      const chunks = [];
      let bytes = 0;
      for await (const chunk of req) {
        bytes += chunk.length;
        if (bytes > 64 * 1024) return send(res, 413, { error: "too_large" });
        chunks.push(chunk);
      }
      let body;
      try {
        body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      } catch {
        return send(res, 400, { error: "invalid_json" });
      }
      const result = evaluate(req.url.slice(1), body, FLAG_SEED);
      send(res, result.status, result.value);
    } catch {
      send(res, 400, { error: "invalid_request" });
    }
  },
);
evaluator.listen(Number(process.env.EVALUATOR_PORT ?? 8082), process.env.BIND ?? "127.0.0.1");
