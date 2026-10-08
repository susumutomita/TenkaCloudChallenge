/** Local practice adapter. Authoritative logic is the unmodified coordination plugin.
 * No remote binding, arbitrary filesystem routes, official ranking, or native reset.
 */
import { randomBytes, timingSafeEqual } from "node:crypto";
import plugin from "../coordination/plugin.ts";
import type { State } from "../game/index.ts";

const HERE = new URL(".", import.meta.url).pathname;
const LIMIT = 16_384;
type Seat = { id: string; token: string; state: State; resetReceipts: Map<string, string> };
const secureHeaders = {
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "cross-origin-resource-policy": "same-origin",
  "content-security-policy": "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
};
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...secureHeaders, "content-type": "application/json; charset=utf-8" } });
}
function freshState(id: string, generation: number): State {
  return plugin.initialState({ eventId: `practice-${crypto.randomUUID()}`, teamIds: [id], matchSecret: randomBytes(32).toString("hex") }, { generation });
}
function safeEqual(left: string, right: string) {
  const a = Buffer.from(left); const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}
async function boundedJson(request: Request): Promise<unknown> {
  if (request.headers.get("content-type")?.toLowerCase().split(";")[0]?.trim() !== "application/json") throw new Error("content-type");
  const declared = request.headers.get("content-length");
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > LIMIT)) throw new Error("too-large");
  const reader = request.body?.getReader();
  if (!reader) throw new Error("json");
  let size = 0; const chunks: Uint8Array[] = [];
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    size += part.value.byteLength;
    if (size > LIMIT) { await reader.cancel(); throw new Error("too-large"); }
    chunks.push(part.value);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
export async function startHarness(options: { port?: number; seatIds?: string[] } = {}) {
  const seatIds = options.seatIds ?? ["analyst-a", "analyst-b"];
  if (!seatIds.length || seatIds.length > 10 || new Set(seatIds).size !== seatIds.length || seatIds.some((id) => !/^[a-z][a-z0-9-]{0,31}$/.test(id))) throw new Error("Invalid practice seats");
  const seats: Seat[] = seatIds.map((id) => ({ id, token: randomBytes(32).toString("hex"), state: freshState(id, 1), resetReceipts: new Map() }));
  const built = await Bun.build({ entrypoints: [`${HERE}app.tsx`], target: "browser", format: "esm", minify: true, sourcemap: "none" });
  if (!built.success || built.outputs.length !== 1 || !built.outputs[0]) throw new Error(`Practice bundle failed: ${built.logs.join("\n")}`);
  const bundle = await built.outputs[0].text();
  const html = await Bun.file(`${HERE}index.html`).text();
  const server = Bun.serve({
    hostname: "127.0.0.1", port: options.port ?? 5668, maxRequestBodySize: LIMIT,
    async fetch(request) {
      const url = new URL(request.url);
      const origin = `http://127.0.0.1:${server.port}`;
      if (url.origin !== origin || request.headers.get("host") !== `127.0.0.1:${server.port}`) return json({ error: "Unexpected host" }, 403);
      const requestOrigin = request.headers.get("origin");
      if ((requestOrigin && requestOrigin !== origin) || request.headers.get("sec-fetch-site") === "cross-site") return json({ error: "Same-origin requests only" }, 403);
      if (url.pathname.startsWith("/api/")) {
        if (url.search) return json({ error: "Query parameters are not supported" }, 400);
        const authorization = request.headers.get("authorization");
        const token = authorization?.startsWith("Bearer ") ? authorization.slice(7) : "";
        const seat = seats.find((candidate) => safeEqual(candidate.token, token));
        if (!seat) return json({ kind: "unauthorized" }, 401);
        if (request.method === "GET" && url.pathname === "/api/session") return json({ seat: seat.id, generation: seat.state.generation, mode: "local-practice" });
        if (request.method === "GET" && url.pathname === "/api/projection") return json({ kind: "ok", projection: plugin.projectForTeam(seat.state, seat.id) });
        if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
        if (requestOrigin !== origin) return json({ error: "An exact Origin is required" }, 403);
        if (url.pathname !== "/api/op" && url.pathname !== "/api/practice-reset") return json({ error: "Not found" }, 404);
        let body: unknown;
        try { body = await boundedJson(request); } catch (error) { return json({ kind: "rejected", error: "Invalid or oversized JSON" }, error instanceof Error && error.message === "too-large" ? 413 : 400); }
        if (url.pathname === "/api/practice-reset") {
          if (!body || typeof body !== "object" || Array.isArray(body)) return json({ error: "Explicit reset confirmation required" }, 400);
          const b = body as Record<string, unknown>;
          if (Object.keys(b).sort().join(",") !== "confirmation,generation,id" || b.confirmation !== "RESET MY PRACTICE" || typeof b.id !== "string" || !/^[a-zA-Z0-9-]{8,80}$/.test(b.id) || !Number.isSafeInteger(b.generation)) return json({ error: "Explicit reset confirmation required" }, 400);
          const digest = JSON.stringify({ generation: b.generation, confirmation: b.confirmation });
          const receipt = seat.resetReceipts.get(b.id);
          if (receipt && receipt !== digest) return json({ error: "Reset ID already used" }, 409);
          if (!receipt) {
            if (b.generation !== seat.state.generation) return json({ error: "Practice generation changed" }, 409);
            seat.state = freshState(seat.id, seat.state.generation + 1);
            seat.resetReceipts.set(b.id, digest);
            if (seat.resetReceipts.size > 100) seat.resetReceipts.delete(seat.resetReceipts.keys().next().value!);
          }
          return json({ seat: seat.id, generation: seat.state.generation, mode: "local-practice" });
        }
        try {
          const verdict = plugin.validateOp(seat.state, seat.id, body);
          if (!verdict.ok) return json({ kind: "rejected", error: verdict.error }, 400);
          seat.state = plugin.applyOp(seat.state, seat.id, body);
          return json({ kind: "ok", projection: plugin.projectForTeam(seat.state, seat.id) });
        } catch (error) { console.error("Practice plugin failure", error); return json({ kind: "unavailable" }, 500); }
      }
      if (request.method !== "GET" && request.method !== "HEAD") return json({ error: "Method not allowed" }, 405);
      if (url.pathname === "/" && !url.search) return new Response(request.method === "HEAD" ? null : html, { headers: { ...secureHeaders, "content-type": "text/html; charset=utf-8" } });
      if (url.pathname === "/app.js" && !url.search) return new Response(request.method === "HEAD" ? null : bundle, { headers: { ...secureHeaders, "content-type": "text/javascript; charset=utf-8" } });
      if (url.pathname === "/favicon.ico") return new Response(null, { status: 204, headers: secureHeaders });
      return json({ error: "Not found" }, 404);
    },
  });
  const origin = `http://127.0.0.1:${server.port}`;
  return { server, origin, seats: seats.map(({ id, token }) => ({ id, token, url: `${origin}/#seat=${id}&token=${token}` })) };
}
if (import.meta.main) {
  const harness = await startHarness({ port: Number(Bun.env.PORT ?? 5668) });
  console.log("Forensic Casebook: LOCAL PRACTICE ONLY. Scores are not competition records.");
  console.log("These generated seat links are credentials. Keep them on this computer.");
  for (const seat of harness.seats) console.log(`${seat.id}: ${seat.url}`);
}
