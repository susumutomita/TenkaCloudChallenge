import { createServer } from "node:http";
import { pathToFileURL } from "node:url";
import { expectedAnswers, scenarioFor } from "./scenario.mjs";

/**
 * security-hype-lp — the `/verify` the TenkaCloud scorer delegates to (:8081).
 *
 * multi-verify contract (platform side: scripts/local-play/verify-client.ts):
 *   request  { checkpointId, submission, context }
 *   response { checkpointId, correct, message }
 * The response echoes checkpointId, never returns points, and its message never carries
 * the expected value, the seed or a reason that narrows the answer (AGENTS.md §15).
 * It runs in its own container; the participant image does not contain this file.
 */

/** Turn a participant's free-form answer into the comparison form for one checkpoint. */
export function normalize(checkpointId, submission) {
  const value = submission.normalize("NFKC").trim().toLowerCase();
  switch (checkpointId) {
    case "campaign-timer": {
      // "23", "23分", "23 minutes" or a clock reading such as "00:23:00" / "23:00".
      const clock = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(value);
      if (clock) {
        const [, a, b, c] = clock;
        // Two parts: "23:00" (minutes:seconds) or "00:23" (hours:minutes).
        if (c === undefined) return b === "00" ? String(Number(a)) : Number(a) === 0 ? String(Number(b)) : "";
        return c === "00" ? String(Number(a) * 60 + Number(b)) : "";
      }
      const minutes = /^(\d{1,3})\s*(?:分|分間|min|mins|minutes?)?$/.exec(value);
      return minutes ? String(Number(minutes[1])) : "";
    }
    case "customer-count": {
      const count = /^([\d,]{1,7})\s*(?:社|companies|customers)?$/.exec(value);
      return count ? String(Number(count[1].replace(/,/g, ""))) : "";
    }
    case "cert-badges":
      return value.toUpperCase().replace(/[^A-Z0-9]/g, "");
    case "customer-voices": {
      const id = /(\d{4})(?:\.svg)?$/.exec(value);
      return id ? id[1] : "";
    }
    case "support-line":
      return value.replace(/\D/g, "");
    case "mail-sender":
      return value
        .replace(/^[a-z]+:\/\//, "")
        .replace(/^[^@/]*@/, "")
        .replace(/[/?#].*$/, "")
        .replace(/\.$/, "");
    default:
      return "";
  }
}

export function judge(scenario, checkpointId, submission) {
  const expected = expectedAnswers(scenario)[checkpointId];
  const got = normalize(checkpointId, submission);
  if (!got) return false;
  // The lookalike domain may be written with the subdomain the email links to.
  if (checkpointId === "mail-sender") return got === expected || got.endsWith(`.${expected}`);
  return got === expected;
}

function send(response, status, payload) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(payload));
}

async function readJson(request) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > 64 * 1024) throw new Error("too_large");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

export function verifierServer(seed) {
  const scenario = scenarioFor(seed);
  const known = new Set(Object.keys(expectedAnswers(scenario)));
  const server = createServer(async (request, response) => {
    if (request.method === "GET" && request.url === "/healthz") return send(response, 200, { status: "ok" });
    if (request.method !== "POST" || request.url !== "/verify") return send(response, 404, { error: "not_found" });
    let body;
    try {
      body = await readJson(request);
    } catch {
      return send(response, 400, { error: "invalid_json" });
    }
    const checkpointId = typeof body?.checkpointId === "string" ? body.checkpointId : "";
    if (!known.has(checkpointId)) return send(response, 400, { error: "unknown_checkpoint" });
    const submission = typeof body?.submission === "string" ? body.submission : "";
    if (submission.length < 1 || submission.length > 200) {
      return send(response, 400, { checkpointId, error: "invalid_submission" });
    }
    const correct = judge(scenario, checkpointId, submission);
    return send(response, 200, {
      checkpointId,
      correct,
      message: correct ? "Checkpoint cleared." : "That is not the answer for this checkpoint.",
    });
  });
  server.requestTimeout = 5000;
  server.headersTimeout = 5000;
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server = verifierServer(process.env.FLAG_SEED);
  delete process.env.FLAG_SEED;
  server.listen(8081, "0.0.0.0", () => console.log("verify on :8081"));
}
