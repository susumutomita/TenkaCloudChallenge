import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import {
  BUF_SIZE,
  GUARD_SIZE,
  HANDLER_OFFSET,
  HANDLER_MAGIC,
  REGION_SIZE,
  collectIcmpError,
  earnedByCopy,
  earnedByQuiz,
  flagFor,
  publicQuiz,
} from "./model.mjs";

// pxe-icmp-oob — the participant-facing "ICMP error collector" of the NetBoot lab.
// It mimics the EDK II PXE path that copies received ICMP error data into a fixed
// 504-byte buffer. The bug is reproduced in model.mjs. This surface never holds
// the flags as text: it derives a checkpoint flag from FLAG_SEED only once the lab
// mechanics for that checkpoint are solved. Bound to loopback by the compose file.
const FLAG_SEED = process.env.FLAG_SEED ?? "local-dev-seed";
const MAX_BODY = 64 * 1024;

function send(res, status, value) {
  res.writeHead(status, { "content-type": "application/json", "x-content-type-options": "nosniff" });
  res.end(JSON.stringify(value));
}

// Accept fragments as hex or base64 strings, or a single blob. Returns Buffer[].
function decodeFragments(body) {
  const encoding = body?.encoding === "base64" ? "base64" : "hex";
  const list = Array.isArray(body?.fragments)
    ? body.fragments
    : typeof body?.payload === "string"
      ? [body.payload]
      : null;
  if (!list || list.length === 0 || list.length > 64) return null;
  const fragments = [];
  for (const item of list) {
    if (typeof item !== "string" || item.length > 4096) return null;
    let buf;
    try {
      buf = Buffer.from(item, encoding);
    } catch {
      return null;
    }
    // Reject blobs that do not round-trip (malformed hex/base64) so feedback is honest.
    // Hex is compared case-insensitively; base64 ignores trailing padding '='.
    const round = buf.toString(encoding).replace(/=+$/, "");
    const given = (encoding === "hex" ? item.toLowerCase() : item).replace(/=+$/, "");
    if (round !== given || (encoding === "hex" && item.length % 2 !== 0)) return null;
    fragments.push(buf);
  }
  return fragments;
}

export const server = createServer(async (req, res) => {
  const url = req.url ?? "/";

  if (req.method === "GET" && url === "/healthz") return send(res, 200, { status: "ok" });

  if (req.method === "GET" && (url === "/" || url === "/index.html")) {
    try {
      const html = await readFile(new URL("./index.html", import.meta.url));
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "x-content-type-options": "nosniff" });
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

    if (url === "/quiz") {
      const checkpoint = earnedByQuiz(body?.quiz, body?.option);
      if (!checkpoint) return send(res, 200, { correct: false });
      return send(res, 200, { correct: true, checkpoint, flag: flagFor(checkpoint, FLAG_SEED) });
    }

    const fragments = decodeFragments(body);
    if (!fragments) return send(res, 400, { error: "invalid_fragments" });
    // Fresh per-request region; attacker bytes are never persisted.
    const analysis = collectIcmpError(fragments, FLAG_SEED);
    const checkpoint = earnedByCopy(analysis, fragments);
    return send(res, 200, {
      total: analysis.total,
      writes: analysis.writes,
      maxEnd: analysis.maxEnd,
      overflowedBuffer: analysis.overflow,
      guardIntact: analysis.guardIntact,
      handlerTag: analysis.handlerTag,
      ...(checkpoint ? { checkpoint, flag: flagFor(checkpoint, FLAG_SEED) } : {}),
    });
  }

  return send(res, 404, { error: "not_found" });
});

server.listen(Number(process.env.PORT ?? 8080), process.env.BIND ?? "127.0.0.1");
