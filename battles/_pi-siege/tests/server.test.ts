import { expect, test } from "bun:test";
import { createHandler } from "../dev/server.ts";
const req = (path: string, body?: unknown) => new Request(`http://127.0.0.1:5655${path}`, body === undefined ? {} : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
test("local HTTP route, body and cross-origin boundaries", async () => {
  const handle = createHandler();
  expect((await handle(req("/healthz"))).status).toBe(200);
  expect(await (await handle(req("/api/projection?team=ghost"))).json()).toEqual({ kind: "unauthorized" });
  expect((await handle(req("/api/op?team=alpha"))).status).toBe(405);
  expect((await handle(new Request("http://127.0.0.1:5655/api/reset", { method: "POST", headers: { origin: "https://elsewhere.example" } }))).status).toBe(403);
  expect((await handle(new Request("http://elsewhere.example/api/reset", { method: "POST" }))).status).toBe(403);
  expect((await handle(new Request("http://127.0.0.1:5655/api/op?team=alpha", { method: "POST", headers: { "content-type": "application/json" }, body: "{" }))).status).toBe(400);
  expect((await handle(req("/api/op?team=alpha", { blob: "x".repeat(8200) }))).status).toBe(413);
});
test("two concurrent writes cannot both spend a stale revision; exact HTTP retries do not rescore", async () => {
  const handle = createHandler();
  const op = { kind: "ready", requestId: "first", revision: 0, round: 0 };
  const results = await Promise.all([handle(req("/api/op?team=alpha", op)), handle(req("/api/op?team=bravo", { ...op, requestId: "other" }))]);
  const [a, b] = await Promise.all(results.map(r => r.json()));
  expect(a.kind).toBe("ok"); expect(b).toEqual({ kind: "rejected", error: "stale_view" });
  const retried = await (await handle(req("/api/op?team=alpha", op))).json();
  expect(retried.projection.revision).toBe(1); expect(retried.projection.me.score).toBe(0);
});
test("the served participant bundle contains the real Portal component, not grader code", async () => {
  const handle = createHandler();
  const r = await handle(req("/app.js")); expect(r.status).toBe(200);
  const js = await r.text(); expect(js).toContain("自分の作業台"); expect(js).toContain("全項を覆う場合分け");
  expect(js).not.toContain("function minimumCost"); expect(js).not.toContain("function atanBounds"); expect(js).not.toContain("function validClaim");
});
