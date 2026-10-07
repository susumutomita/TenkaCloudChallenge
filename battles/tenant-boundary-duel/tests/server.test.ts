import { expect, test } from "bun:test";
import { createLab } from "../dev/server.ts";
test("harness separates seat authentication and blocks cross-origin, malformed and oversized submissions", async () => {
  const lab = createLab({ clock: () => 0 });
  const call = (path: string, init?: RequestInit) =>
    lab.handler(new Request(`http://127.0.0.1:5678${path}`, init));
  expect((await call("/api/projection")).status).toBe(401);
  expect(
    (await call("/api/projection", { headers: { authorization: "Seat synthetic-reader" } })).status,
  ).toBe(401);
  const headers = { authorization: `Seat ${lab.seats.alpha}`, "content-type": "application/json" };
  expect(
    (await call("/api/projection", { headers: { ...headers, origin: "https://example.com" } }))
      .status,
  ).toBe(403);
  expect((await call("/api/op", { method: "POST", headers, body: "x".repeat(8193) })).status).toBe(
    413,
  );
  expect((await call("/api/op", { method: "POST", headers, body: "{" })).status).toBe(400);
  const ready = { kind: "ready", id: "one", revision: 0 };
  const accepted = await (
    await call("/api/op", { method: "POST", headers, body: JSON.stringify(ready) })
  ).json();
  expect(accepted).toMatchObject({
    kind: "ok",
    projection: { ready: ["alpha"], scores: { alpha: 0, bravo: 0 } },
  });
  expect(
    await (await call("/api/op", { method: "POST", headers, body: JSON.stringify(ready) })).json(),
  ).toEqual(accepted);
  const bundle = await (await call("/app.js")).text();
  expect(bundle).toContain("Tenant Boundary Duel");
  for (const secret of [
    "matchSecret",
    "createHmac",
    "case-a",
    "safeTotal++",
    "function assess",
    "Server-generated matchSecret",
  ])
    expect(bundle).not.toContain(secret);
});
