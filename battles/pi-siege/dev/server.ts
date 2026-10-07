import { applyOp, initialState, projectForTeam, validateOp } from "../game/reducer.ts";
import type { Op, State } from "../game/types.ts";
const here = new URL(".", import.meta.url).pathname;
const fresh = () => initialState({ eventId: "local-pi-siege", teamIds: ["alpha", "bravo"], teamNames: { alpha: "青チーム", bravo: "橙チーム" } });
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "cache-control": "no-store" } });

export function createHandler(initial: State = fresh()) {
  let state = initial;
  let bundle: string | undefined;
  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    if (request.headers.has("origin") && request.headers.get("origin") !== url.origin) return json({ error: "foreign_origin" }, 403);
    if (!["localhost", "127.0.0.1"].includes(url.hostname)) return json({ error: "foreign_host" }, 403);
    if (url.pathname.startsWith("/api/")) {
      const team = url.searchParams.get("team");
      if (url.pathname === "/api/reset") { if (request.method !== "POST") return json({ error: "method" }, 405); state = fresh(); return json({ ok: true }); }
      if (!team || !Object.hasOwn(state.teams, team)) return json({ kind: "unauthorized" });
      if (url.pathname === "/api/projection") return request.method === "GET" ? json({ kind: "ok", projection: projectForTeam(state, team) }) : json({ error: "method" }, 405);
      if (url.pathname === "/api/op") {
        if (request.method !== "POST") return json({ error: "method" }, 405);
        if (!(request.headers.get("content-type") ?? "").startsWith("application/json")) return json({ error: "content_type" }, 415);
        const reader = request.body?.getReader();
        if (!reader) return json({ error: "body" }, 400);
        const chunks: Uint8Array[] = []; let length = 0;
        while (true) { const part = await reader.read(); if (part.done) break; length += part.value.length; if (length > 8192) { await reader.cancel(); return json({ error: "body_too_large" }, 413); } chunks.push(part.value); }
        let op: unknown;
        try { const bytes = new Uint8Array(length); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; } op = JSON.parse(new TextDecoder().decode(bytes)); }
        catch { return json({ error: "invalid_json" }, 400); }
        // No await between validation and the write: concurrent requests observe one revision.
        const verdict = validateOp(state, team, op);
        if (!verdict.ok) return json({ kind: "rejected", error: verdict.error });
        state = applyOp(state, team, op as Op);
        return json({ kind: "ok", projection: projectForTeam(state, team) });
      }
      return json({ error: "not_found" }, 404);
    }
    if (request.method !== "GET") return json({ error: "method" }, 405);
    if (url.pathname === "/healthz") return json({ ok: true });
    if (url.pathname === "/style.css") return new Response(Bun.file(`${here}../portal/style.css`), { headers: { "content-type": "text/css" } });
    if (url.pathname === "/app.js") {
      if (bundle === undefined) {
        const built = await Bun.build({ entrypoints: [`${here}app.tsx`], target: "browser", minify: false });
        if (!built.success) return new Response(built.logs.map(String).join("\n"), { status: 500 });
        bundle = await built.outputs[0]!.text();
      }
      return new Response(bundle, { headers: { "content-type": "application/javascript" } });
    }
    if (url.pathname === "/") return new Response(Bun.file(`${here}index.html`), { headers: { "content-type": "text/html; charset=utf-8" } });
    return json({ error: "not_found" }, 404);
  };
}
if (import.meta.main) {
  const server = Bun.serve({ hostname: "127.0.0.1", port: Number(Bun.env.PORT ?? 5655), fetch: createHandler() });
  console.log(`π包囲戦: http://127.0.0.1:${server.port}/?team=alpha`);
  console.log(`相手席: http://127.0.0.1:${server.port}/?team=bravo — local, unauthenticated, in-memory prototype`);
}
