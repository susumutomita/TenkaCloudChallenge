import { timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { pathToFileURL } from "node:url";
import { flagForSeed, readBody, send } from "./lab.mjs";

export function verifierServer(seed) {
  const expected = Buffer.from(flagForSeed(seed));
  const server = createServer(async (request, response) => {
    if (request.method === "GET" && request.url === "/healthz") return send(response, 200, "text/plain", "ok");
    if (request.method !== "POST" || request.url !== "/verify") return send(response, 404, "application/json", JSON.stringify({ error: "not_found" }));
    try {
      const value = JSON.parse(await readBody(request)).submission;
      const submitted = Buffer.from(typeof value === "string" && value.length < 128 ? value.trim() : "");
      const correct = submitted.length === expected.length && timingSafeEqual(submitted, expected);
      return send(response, 200, "application/json", JSON.stringify({ correct }));
    } catch { return send(response, 400, "application/json", JSON.stringify({ correct: false })); }
  });
  server.requestTimeout = 5000;
  server.headersTimeout = 5000;
  server.maxHeadersCount = 32;
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server = verifierServer(process.env.FLAG_SEED);
  delete process.env.FLAG_SEED;
  server.listen(8081, "0.0.0.0");
}
