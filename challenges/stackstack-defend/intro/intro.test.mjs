import { test } from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import http from "node:http";
import { createIntro } from "./server.mjs";
import {
  validatePolicy,
  decide,
} from "../../../runtimes/stackstack/app/access-policy.mjs";
async function fixture(options = {}) {
  const socket = net.createServer();
  await new Promise((r) => socket.listen(0, "127.0.0.1", r));
  const port = socket.address().port;
  await new Promise((r) => socket.close(r));
  const origin = `http://127.0.0.1:${port}`;
  const app = createIntro({ origin, max: 2, ...options });
  await new Promise((r) => app.server.listen(port, "127.0.0.1", r));
  async function call(path, method = "GET", body, cookie = "", headers = {}) {
    const res = await fetch(origin + path, {
      method,
      headers: {
        origin,
        "x-intro": "1",
        "content-type": "application/json",
        cookie,
        ...headers,
      },
      ...(body === undefined
        ? {}
        : { body: typeof body === "string" ? body : JSON.stringify(body) }),
    });
    return {
      status: res.status,
      body: await res.json(),
      cookie: res.headers.get("set-cookie")?.split(";")[0],
    };
  }
  return { ...app, call, origin };
}
async function released(f) {
  for (let i = 0; i < 100 && f.stats().workers; i++)
    await new Promise((r) => setTimeout(r, 10));
  assert.equal(f.stats().workers, 0);
}

test("shared Defend policy: default deny, owner match, deny precedence, strict validation", () => {
  const rule = {
    effect: "allow",
    actions: ["read"],
    actor: "*",
    resource: { ownerIs: "actor" },
  };
  const policy = { enabled: true, readsPerRound: 200, rules: [rule] };
  assert.deepEqual(validatePolicy(policy).errors, []);
  assert.equal(
    decide(policy, { id: "a" }, "read", { id: "old", ownerId: "a" }),
    true,
  );
  assert.equal(
    decide(policy, { id: "a" }, "read", { id: "fresh", ownerId: "b" }),
    false,
  );
  assert.equal(
    decide(policy, { id: "b" }, "read", { id: "fresh", ownerId: "b" }),
    true,
  );
  assert.equal(
    decide(
      { ...policy, rules: [rule, { ...rule, effect: "deny", resource: "*" }] },
      { id: "a" },
      "read",
      { ownerId: "a" },
    ),
    false,
  );
  for (const bad of [
    null,
    [],
    { ...policy, code: "process.exit()" },
    {
      ...policy,
      rules: [{ ...rule, resource: { url: "https://example.invalid" } }],
    },
  ])
    assert.ok(validatePolicy(bad).errors.length);
});

test("real HTTP flow, both directions, fresh IDs, false repairs and session isolation", async (t) => {
  const f = await fixture();
  t.after(() => f.close());
  const a = await f.call("/api/start", "POST");
  assert.equal(a.status, 201);
  assert.ok(a.cookie);
  const b = await f.call("/api/start", "POST");
  assert.equal(b.status, 201);
  assert.equal(
    (await f.call("/api/start", "POST", undefined, a.cookie)).status,
    200,
  );
  assert.equal((await f.call("/api/start", "POST")).status, 503);
  assert.deepEqual(f.stats(), { workers: 2, sessions: 2 });
  const read = async (target, cookie = a.cookie) =>
    (await f.call("/api/read", "POST", { target }, cookie)).body;
  const self = await read("self"),
    other = await read("other");
  assert.equal(self.status, 200);
  assert.equal(other.status, 200);
  assert.notEqual(self.body.ownerId, other.body.ownerId);
  assert.match(other.body.contact, /example.invalid$/);
  assert.notEqual(self.request, other.request);
  assert.equal(
    (await f.call("/api/verify", "POST", undefined, a.cookie)).body.passed,
    false,
  );
  for (const scope of ["deny", "off", "throttle", "observed"]) {
    assert.equal(
      (await f.call("/api/policy", "POST", { scope }, a.cookie)).status,
      200,
    );
    const result = (await f.call("/api/verify", "POST", undefined, a.cookie))
      .body;
    assert.equal(result.passed, false, scope);
    assert.ok(
      result.checks.some((c) => !c.ok),
      scope,
    );
  }
  await f.call("/api/policy", "POST", { scope: "owner" }, a.cookie);
  assert.equal((await read("self")).status, 200);
  assert.equal((await read("other")).status, 403);
  const result = (await f.call("/api/verify", "POST", undefined, a.cookie))
    .body;
  assert.equal(result.passed, true);
  assert.equal(result.checks.length, 8);
  assert.equal(result.checks.filter((c) => c.fresh).length, 4);
  assert.ok(result.checks.every((c) => c.ok));
  assert.equal((await read("other", b.cookie)).status, 200);
  assert.equal(
    (await f.call("/api/state", "GET", undefined, b.cookie)).body.passed,
    false,
  );
  assert.equal(
    (
      await f.call(
        "/api/read",
        "POST",
        { target: "other", session: b.cookie },
        a.cookie,
      )
    ).status,
    400,
  );
  for (const path of [
    "/verify",
    "/admin",
    "/reset",
    "/api/settings",
    "/profile",
    "/api/state?session=" + b.cookie,
  ])
    assert.equal((await f.call(path, "POST", {}, a.cookie)).status, 404);
  assert.equal(
    (await f.call("/api/session", "DELETE", undefined, a.cookie)).status,
    200,
  );
  assert.equal(
    (await f.call("/api/state", "GET", undefined, a.cookie)).status,
    401,
  );
  await f.call("/api/session", "DELETE", undefined, b.cookie);
  await released(f);
  const next = await f.call("/api/start", "POST");
  assert.notEqual(next.cookie, a.cookie);
  assert.equal(
    (await f.call("/api/policy", "POST", { scope: "owner" }, a.cookie)).status,
    401,
  );
  const fresh = await read("other", next.cookie);
  assert.equal(fresh.status, 200);
  assert.notEqual(fresh.body.id, other.body.id);
  assert.equal(
    (await f.call("/api/verify", "POST", undefined, next.cookie)).body.passed,
    false,
  );
});

test("TTL invalidates old control and score credentials, releases fixed capacity", async (t) => {
  const f = await fixture({ ttl: 1200, max: 1 });
  t.after(() => f.close());
  const a = await f.call("/api/start", "POST");
  assert.equal(a.status, 201);
  await new Promise((r) => setTimeout(r, 1300));
  await released(f);
  for (const [path, method, body] of [
    ["/api/state", "GET"],
    ["/api/policy", "POST", { scope: "owner" }],
    ["/api/verify", "POST"],
    ["/api/session", "DELETE"],
  ])
    assert.equal((await f.call(path, method, body, a.cookie)).status, 401);
  const b = await f.call("/api/start", "POST");
  assert.equal(b.status, 201);
  assert.notEqual(b.cookie, a.cookie);
});

test("CSRF, bad input, oversized bodies, route allowlist, parallel starts and shutdown", async (t) => {
  const f = await fixture();
  t.after(() => f.close());
  assert.equal(
    (
      await f.call("/api/start", "POST", undefined, "", {
        origin: "https://evil.invalid",
      })
    ).status,
    403,
  );
  assert.equal(
    (await f.call("/api/start", "POST", undefined, "", { "x-intro": "" }))
      .status,
    403,
  );
  const results = await Promise.all(
    Array.from({ length: 6 }, () => f.call("/api/start", "POST")),
  );
  assert.equal(results.filter((r) => r.status === 201).length, 2);
  assert.ok(f.stats().workers <= 2);
  const a = results.find((r) => r.status === 201);
  for (const body of [
    "{",
    "null",
    "[]",
    '"hello"',
    "x".repeat(2048),
    { scope: "owner", code: "anything" },
    { scope: "https://example.invalid" },
    { scope: {} },
  ])
    assert.equal(
      (await f.call("/api/policy", "POST", body, a.cookie)).status,
      400,
    );
  assert.equal(
    (await f.call("/api/read", "POST", { target: "../admin" }, a.cookie))
      .status,
    400,
  );
  assert.equal(
    (
      await f.call("/api/policy", "POST", { scope: "owner" }, a.cookie, {
        "content-type": "text/plain",
      })
    ).status,
    400,
  );
  const hostStatus = await new Promise((resolve) => {
    http.get(
      f.origin + "/healthz",
      { headers: { host: "evil.invalid" } },
      (res) => {
        res.resume();
        resolve(res.statusCode);
      },
    );
  });
  assert.equal(hostStatus, 400);
  const page = await fetch(f.origin);
  assert.match(
    page.headers.get("content-security-policy"),
    /frame-ancestors 'none'/,
  );
  assert.equal(page.headers.get("referrer-policy"), "no-referrer");
  const burst = await Promise.all(
    Array.from({ length: 12 }, () =>
      f.call("/api/verify", "POST", undefined, a.cookie),
    ),
  );
  assert.ok(burst.some((r) => r.status === 429));
  assert.ok(burst.every((r) => [200, 429].includes(r.status)));
});

test("global rate limit is bounded without per-address growing maps", async (t) => {
  const f = await fixture();
  t.after(() => f.close());
  for (let i = 0; i < 300; i++) await f.call("/healthz");
  assert.equal((await f.call("/healthz")).status, 429);
  assert.deepEqual(f.stats(), { workers: 0, sessions: 0 });
});

test("stop during verification revokes state and allows no late score or policy access", async (t) => {
  const f = await fixture({ max: 1 });
  t.after(() => f.close());
  const a = await f.call("/api/start", "POST");
  const pending = f.call("/api/verify", "POST", undefined, a.cookie);
  const stopped = await f.call("/api/session", "DELETE", undefined, a.cookie);
  assert.equal(stopped.status, 200);
  assert.ok([200, 401, 502].includes((await pending).status));
  assert.equal(
    (await f.call("/api/state", "GET", undefined, a.cookie)).status,
    401,
  );
  await released(f);
  const next = await f.call("/api/start", "POST");
  assert.equal(next.status, 201);
  assert.equal(
    (await f.call("/api/verify", "POST", undefined, a.cookie)).status,
    401,
  );
  assert.equal(
    (await f.call("/api/state", "GET", undefined, next.cookie)).body.passed,
    false,
  );
});

test("end remains available after global rate exhaustion", async (t) => {
  const f = await fixture({ max: 1 });
  t.after(() => f.close());
  const a = await f.call("/api/start", "POST");
  for (let i = 0; i < 300; i++) await f.call("/healthz");
  assert.equal(
    (await f.call("/api/session", "DELETE", undefined, a.cookie)).status,
    200,
  );
  await released(f);
});
