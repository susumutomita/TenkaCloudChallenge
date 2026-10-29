import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import {
  BUF_SIZE,
  GUARD_SIZE,
  HANDLER_OFFSET,
  HANDLER_MAGIC,
  REGION_SIZE,
  publicQuiz,
} from "./model.mjs";

// pxe-icmp-oob — the participant-facing "ICMP error collector" of the NetBoot lab.
// Public requests are evaluated from raw input by a private authority.
// This process has no grading module, seed, answer keys or flag derivation.
const EVALUATOR_URL = process.env.EVALUATOR_URL ?? "http://127.0.0.1:8082";
const MAX_BODY = 64 * 1024;

function send(res, status, value) {
  res.writeHead(status, {
    "content-type": "application/json",
    "x-content-type-options": "nosniff",
  });
  res.end(JSON.stringify(value));
}

async function handle(req, res) {
  const url = req.url ?? "/";

  if (req.method === "GET" && url === "/healthz") return send(res, 200, { status: "ok" });

  if (req.method === "GET" && (url === "/" || url === "/index.html")) {
    try {
      const html = await readFile(new URL("./index.html", import.meta.url));
      res.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "x-content-type-options": "nosniff",
      });
      return res.end(html);
    } catch {
      res.writeHead(500);
      return res.end("file unavailable");
    }
  }

  // Lab brief: the struct shape. Teaches the 504-byte limit and the adjacent fields.
  if (req.method === "GET" && url === "/spec") {
    return send(res, 200, {
      struct: "Mode.IcmpError (EDK-toy)",
      icmpErrorSize: BUF_SIZE,
      guardCookieSize: GUARD_SIZE,
      handlerTagOffset: HANDLER_OFFSET,
      handlerTagValues: ["idle.", HANDLER_MAGIC],
      regionSize: REGION_SIZE,
      note:
        "Submit fragments to POST /icmp (hex by default, or {encoding:'base64'}). " +
        "A single fragment of exactly icmpErrorSize bytes fills the buffer without overflow.",
    });
  }

  if (req.method === "GET" && url === "/quiz") {
    return send(res, 200, { quiz: publicQuiz() });
  }

  if (req.method === "POST" && (url === "/icmp" || url === "/quiz")) {
    const chunks = [];
    let bytes = 0;
    for await (const chunk of req) {
      bytes += chunk.length;
      if (bytes > MAX_BODY) {
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

    try {
      const evaluated = await fetch(`${EVALUATOR_URL}/${url === "/quiz" ? "quiz" : "icmp"}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(3000),
      });
      return send(res, evaluated.status, await evaluated.json());
    } catch {
      return send(res, 503, { error: "evaluation_unavailable" });
    }
  }

  return send(res, 404, { error: "not_found" });
}

export const server = createServer({ requestTimeout: 5000, headersTimeout: 5000 }, (req, res) => {
  void handle(req, res).catch(() => {
    if (!res.headersSent) send(res, 400, { error: "invalid_request" });
    else res.end();
  });
});
server.listen(Number(process.env.PORT ?? 8080), process.env.BIND ?? "127.0.0.1");
