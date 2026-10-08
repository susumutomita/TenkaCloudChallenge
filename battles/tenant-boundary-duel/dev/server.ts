import { randomBytes } from "node:crypto";
import plugin from "../coordination/tenant-boundary-duel.ts";
import type { Op, State } from "../game/types.ts";
const here = new URL(".", import.meta.url).pathname;
const json = (body: unknown, status = 200) =>
  Response.json(body, {
    status,
    headers: {
      "cache-control": "no-store",
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff",
    },
  });
export function createLab({
  initial,
  clock = Date.now,
}: {
  initial?: State;
  clock?: () => number;
} = {}) {
  let state =
    initial ??
    plugin.initialState({
      eventId: "local-tenant-boundary-duel",
      teamIds: ["alpha", "bravo"],
      teamNames: { alpha: "青チーム", bravo: "橙チーム" },
      matchSecret: randomBytes(32).toString("hex"),
    });
  const started = clock();
  let bundle: string | undefined;
  // Harness seats are separate from fictional application sessions and never use cookies.
  const seats = Object.fromEntries(
    state.ids.map((id) => [id, `dev_seat_${randomBytes(24).toString("hex")}`]),
  );
  const handler = async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    if (!["127.0.0.1", "localhost"].includes(url.hostname))
      return json({ error: "foreign_host" }, 403);
    if (request.headers.has("origin") && request.headers.get("origin") !== url.origin)
      return json({ error: "foreign_origin" }, 403);
    if (url.pathname.startsWith("/api/")) {
      const team = state.ids.find(
        (id) => request.headers.get("authorization") === `Seat ${seats[id]}`,
      );
      if (!team) return json({ kind: "unauthorized" }, 401);
      if (url.pathname === "/api/projection" && request.method === "GET") {
        state = plugin.tick(state, Math.max(0, clock() - started));
        return json({ kind: "ok", projection: plugin.projectForTeam(state, team) });
      }
      if (url.pathname !== "/api/op") return json({ error: "not_found" }, 404);
      if (request.method !== "POST") return json({ error: "method" }, 405);
      if (!/^application\/json(?:;|$)/.test(request.headers.get("content-type") ?? ""))
        return json({ error: "content_type" }, 415);
      const reader = request.body?.getReader();
      if (!reader) return json({ error: "body" }, 400);
      const chunks: Uint8Array[] = [];
      let length = 0;
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        length += part.value.length;
        if (length > 8192) {
          await reader.cancel();
          return json({ error: "body_too_large" }, 413);
        }
        chunks.push(part.value);
      }
      let op: unknown;
      try {
        const bytes = new Uint8Array(length);
        let offset = 0;
        for (const chunk of chunks) {
          bytes.set(chunk, offset);
          offset += chunk.length;
        }
        op = JSON.parse(new TextDecoder().decode(bytes));
      } catch {
        return json({ error: "invalid_json" }, 400);
      }
      // No await between tick/validate/apply, so concurrent HTTP submissions serialize here.
      state = plugin.tick(state, Math.max(0, clock() - started));
      const verdict = plugin.validateOp(state, team, op);
      if (!verdict.ok) return json({ kind: "rejected", error: verdict.error });
      state = plugin.applyOp(state, team, op as Op);
      return json({ kind: "ok", projection: plugin.projectForTeam(state, team) });
    }
    if (request.method !== "GET") return json({ error: "method" }, 405);
    if (url.pathname === "/healthz") return json({ ok: true });
    if (url.pathname === "/")
      return new Response(Bun.file(`${here}index.html`), {
        headers: {
          "content-type": "text/html; charset=utf-8",
          "referrer-policy": "no-referrer",
          "content-security-policy":
            "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self'; frame-ancestors 'none'",
        },
      });
    if (url.pathname === "/style.css")
      return new Response(Bun.file(`${here}../portal/style.css`), {
        headers: { "content-type": "text/css" },
      });
    if (url.pathname === "/app.js") {
      if (!bundle) {
        const built = await Bun.build({ entrypoints: [`${here}app.tsx`], target: "browser" });
        if (!built.success) return new Response(built.logs.map(String).join("\n"), { status: 500 });
        bundle = await built.outputs.find((x) => x.path.endsWith(".js"))!.text();
      }
      return new Response(bundle, { headers: { "content-type": "text/javascript" } });
    }
    return json({ error: "not_found" }, 404);
  };
  return { handler, seats };
}
if (import.meta.main) {
  const lab = createLab();
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: Number(Bun.env.PORT ?? 5678),
    fetch: lab.handler,
  });
  for (const [id, seat] of Object.entries(lab.seats))
    console.log(`${id}: http://127.0.0.1:${server.port}/#seat=${seat}`);
  console.log(
    "Local synthetic lab only; in-memory state; no official scoring. Ctrl-C discards this lab.",
  );
}
