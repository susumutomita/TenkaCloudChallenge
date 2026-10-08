import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { startHarness } from "../dev/server.ts";

let app: Awaited<ReturnType<typeof startHarness>>;
beforeAll(async () => { app = await startHarness({ port: 0 }); });
afterAll(() => { app?.server.stop(true); });
function get(path: string, seat = 0, extra: Record<string, string> = {}) {
  return fetch(`${app.origin}${path}`, { headers: { authorization: `Bearer ${app.seats[seat]!.token}`, ...extra } });
}
function post(path: string, body: unknown, seat = 0, extra: Record<string, string> = {}) {
  return fetch(`${app.origin}${path}`, { method: "POST", headers: { authorization: `Bearer ${app.seats[seat]!.token}`, origin: app.origin, "content-type": "application/json", ...extra }, body: JSON.stringify(body) });
}
describe("local practice security boundary", () => {
  test("binds only loopback, requires generated seat credentials, and never exposes secrets", async () => {
    expect(app.server.hostname).toBe("127.0.0.1");
    expect(app.seats[0]!.token).not.toBe(app.seats[1]!.token);
    expect((await fetch(`${app.origin}/api/projection`)).status).toBe(401);
    expect((await get("/api/projection", 0, { authorization: "Bearer wrong" })).status).toBe(401);
    const result = await (await get("/api/projection")).json();
    expect(result.projection.teamId).toBe(app.seats[0]!.id);
    expect(result.projection.score).toBe(0);
    const serialized = JSON.stringify(result);
    for (const key of ["matchSecret", "expected", "receipts", "privateAnswers"]) expect(Object.keys(result.projection)).not.toContain(key);
    expect(serialized).not.toContain(app.seats[0]!.token);
    expect(JSON.stringify(result.projection.cases[0].questions)).not.toContain("explanation");
    expect(result.projection.cases[0].questions[0].hints).toEqual([]);
  });
  test("enforces origin and Host, rejects unsupported paths and query-based team switching", async () => {
    expect((await post("/api/op", {}, 0, { origin: "https://attacker.example" })).status).toBe(403);
    expect((await get("/api/projection", 0, { origin: "https://attacker.example" })).status).toBe(403);
    expect((await get("/api/projection", 0, { host: "attacker.example" })).status).toBe(403);
    expect((await get("/api/projection", 0, { "sec-fetch-site": "cross-site" })).status).toBe(403);
    const missingOrigin = await fetch(`${app.origin}/api/op`, { method: "POST", headers: { authorization: `Bearer ${app.seats[0]!.token}`, "content-type": "application/json" }, body: "{}" });
    expect(missingOrigin.status).toBe(403);
    expect((await get("/api/projection?team=analyst-b")).status).toBe(400);
    for (const path of ["/game/fixtures.ts", "/game/index.ts", "/coordination/plugin.ts", "/dev/server.ts", "/package.json", "/.env", "/app.js.map", "/api/reset", "/api/session?seat=analyst-b"]) {
      expect([400, 404, 405]).toContain((await get(path)).status);
    }
    const bundle = await (await get("/app.js")).text();
    for (const privateName of ["matchSecret", "buildCases", "createHmac", "SERVER ONLY", "sourceMappingURL"]) expect(bundle).not.toContain(privateName);
    const headers = (await get("/")).headers;
    expect(headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    expect(headers.get("access-control-allow-origin")).toBeNull();
  });
  test("bounds JSON and rejects malformed or spoofed operations", async () => {
    expect((await post("/api/op", {}, 0, { "content-type": "text/plain" })).status).toBe(400);
    expect((await post("/api/op", {}, 0, { "content-type": "application/jsonp" })).status).toBe(400);
    expect((await post("/api/op", { answer: "x".repeat(18000) })).status).toBe(413);
    const malformed = await fetch(`${app.origin}/api/op`, { method: "POST", headers: { authorization: `Bearer ${app.seats[0]!.token}`, origin: app.origin, "content-type": "application/json" }, body: "{" });
    expect(malformed.status).toBe(400);
    const op = { kind: "hint", id: crypto.randomUUID(), generation: 1, revision: 0, caseId: "identity", questionId: "account", rung: 1 };
    expect((await post("/api/op", { ...op, teamId: app.seats[1]!.id })).status).toBe(400);
    expect((await post("/api/op", { kind: "reset", id: crypto.randomUUID(), generation: 1, revision: 0 })).status).toBe(400);
  });
  test("same request is idempotent and each credential sees only its seat", async () => {
    const op = { kind: "answer", id: crypto.randomUUID(), generation: 1, revision: 0, caseId: "identity", questionId: "account", answer: "deliberately-wrong", evidenceIds: ["I-IDP", "I-CLOUD"] };
    const first = await (await post("/api/op", op)).json();
    const duplicate = await (await post("/api/op", op)).json();
    expect(first.kind).toBe("ok");
    expect(first.projection.lastResult.status).toBe("incorrect");
    expect(duplicate.projection.revision).toBe(first.projection.revision);
    expect(duplicate.projection.cases[0].questions[0].attempts).toBe(1);
    expect((await post("/api/op", { ...op, answer: "different" })).status).toBe(400);
    const other = await (await get("/api/projection", 1)).json();
    expect(other.projection.revision).toBe(0);
    expect(other.projection.cases[0].questions[0].attempts).toBe(0);
    expect(other.projection.cases[0].evidence[0].content).not.toBe(first.projection.cases[0].evidence[0].content);
  });
  test("practice reset requires exact explicit confirmation and freshens only its seat", async () => {
    const before = await (await get("/api/projection")).json();
    const otherBefore = await (await get("/api/projection", 1)).json();
    const reset = { id: crypto.randomUUID(), generation: before.projection.generation, confirmation: "RESET MY PRACTICE" };
    expect((await post("/api/practice-reset", { ...reset, confirmation: "yes" })).status).toBe(400);
    expect((await post("/api/practice-reset", { ...reset, extra: true })).status).toBe(400);
    expect((await post("/api/practice-reset", { ...reset, generation: -1 })).status).toBe(409);
    const first = await (await post("/api/practice-reset", reset)).json();
    const retry = await (await post("/api/practice-reset", reset)).json();
    expect(first.generation).toBe(before.projection.generation + 1);
    expect(retry.generation).toBe(first.generation);
    const after = await (await get("/api/projection")).json();
    expect(after.projection.revision).toBe(0);
    expect(after.projection.score).toBe(0);
    const staleHint = { kind: "hint", id: crypto.randomUUID(), generation: before.projection.generation, revision: 0, caseId: "identity", questionId: "account", rung: 1 };
    expect((await post("/api/op", staleHint)).status).toBe(400);
    const unchanged = await (await get("/api/projection")).json();
    expect(unchanged.projection.revision).toBe(0);
    expect(unchanged.projection.cases[0].questions[0].unlockedHints).toBe(0);
    expect(after.projection.cases[0].evidence[0].content).not.toBe(before.projection.cases[0].evidence[0].content);
    expect(await (await get("/api/projection", 1)).json()).toEqual(otherBefore);
  });
});
