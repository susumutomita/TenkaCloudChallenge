import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import Ajv from "ajv";
import addFormats from "ajv-formats";

const root = fileURLToPath(new URL("../../", import.meta.url));
const ajv = new Ajv({ strict: false });
addFormats(ajv);
async function unusedPort() {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = server.address().port;
  await new Promise((done) => server.close(done));
  return port;
}
async function fixture(t, scenario = "first-request") {
  const dir = await mkdtemp(resolve(tmpdir(), "first-request-"));
  const port = await unusedPort();
  const verifyPort = await unusedPort();
  const child = spawn(process.execPath, [resolve(root, "runtimes/stackstack/app/server.mjs")], {
    cwd: dir,
    env: { ...process.env, SCENARIO: scenario, CHALLENGE_PORT: String(port), VERIFY_PORT: String(verifyPort),
      APP_CONFIG: resolve(root, "challenges/stackstack-first-request/local/config/app.json"),
      APP_OVERRIDE_DIR: dir, FLAG_SEED: randomBytes(32).toString("hex") },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (data) => { output += data; });
  child.stderr.on("data", (data) => { output += data; });
  t.after(async () => {
    const stopped = once(child, "exit");
    if (child.exitCode === null) { child.kill(); await stopped; }
    await rm(dir, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${port}`;
  for (let n = 0; n < 100; n++) {
    if (child.exitCode !== null) throw new Error(output);
    try { await fetch(`${base}/openapi.json`); break; } catch {
      if (n === 99) throw new Error(`App did not start: ${output}`);
      await new Promise((done) => setTimeout(done, 20));
    }
  }
  return { base, verify: async (checkpointId, submission) => {
    const r = await fetch(`http://127.0.0.1:${verifyPort}/verify`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ checkpointId, submission }),
    });
    const body = await r.json();
    assert.equal(r.status, 200); assert.equal(body.checkpointId, checkpointId);
    return body.correct;
  } };
}

test("exercise HTTP responses match Swagger and all four checkpoints grade per instance", async (t) => {
  const first = await fixture(t);
  const second = await fixture(t);
  const docs = await (await fetch(`${first.base}/openapi.json?lang=en`)).json();
  async function ask(path, method = "GET", body) {
    const r = await fetch(first.base + path, { method, ...(body === undefined ? {} : {
      headers: { "content-type": "application/json" }, body,
    }) });
    const value = await r.json();
    const operation = docs.paths[path.split("?")[0]][method.toLowerCase()];
    const schema = operation.responses[r.status]?.content["application/json"].schema;
    assert.ok(schema, `${method} ${path}: undocumented ${r.status}`);
    assert.ok(ajv.validate(schema, value), JSON.stringify(ajv.errors));
    return { status: r.status, value };
  }
  const initial = (await ask("/posture")).value;
  assert.deepEqual(initial.gates, { postcard_read: false, door_opened: false, message_left: false });
  assert.equal(initial.readyToken, null);
  assert.equal(docs.paths["/api/door"].get.parameters[0].required, false);
  for (const query of ["", "?key=", "?key=%20", "?key=wrong"]) {
    const r = await ask(`/api/door${query}`);
    assert.equal(r.status, 400); assert.match(r.value.detail, /postcard/);
  }
  const postcard = (await ask("/api/postcard")).value;
  assert.match(postcard.message, /door/);
  assert.equal((await ask("/posture")).value.readyToken, null);
  const door = await ask(`/api/door?key=${encodeURIComponent(` ${postcard.token} `)}`);
  assert.equal(door.status, 200);
  for (const body of ["", "{", "null", "[]", "42", "{}", '{"name":" ","message":"hi"}',
    JSON.stringify({ name: "x".repeat(201), message: "hi" }),
    JSON.stringify({ name: "😀".repeat(101), message: "hi" }),
    JSON.stringify({ name: "you", message: " " }),
    JSON.stringify({ name: "you", message: "x".repeat(2001) })]) {
    const r = await ask("/api/guestbook", "POST", body);
    assert.equal(r.status, 400); assert.ok(r.value.detail);
  }
  assert.equal((await ask("/api/guestbook", "POST", "x".repeat(16385))).status, 413);
  assert.equal((await ask("/posture")).value.gates.message_left, false);
  const posted = await ask("/api/guestbook", "POST", JSON.stringify({ name: " you ", message: " hello ", extra: true }));
  assert.equal(posted.status, 201);
  assert.equal(posted.value.entry.name, "you"); assert.equal(posted.value.entry.message, "hello");
  assert.equal(posted.value.total, 1);
  assert.deepEqual((await ask("/api/guestbook")).value.entries, [posted.value.entry]);
  const complete = (await ask("/posture")).value;
  assert.deepEqual(complete.gates, { postcard_read: true, door_opened: true, message_left: true });
  assert.equal(complete.ready, true);
  const answers = { postcard: postcard.token, "locked-door": door.value.token,
    guestbook: posted.value.receipt, "round-trip": complete.readyToken };
  for (const [id, answer] of Object.entries(answers)) {
    assert.equal(await first.verify(id, "wrong"), false);
    assert.equal(await second.verify(id, answer), false);
    assert.equal(await first.verify(id, answer), true);
    assert.equal(JSON.stringify(docs).includes(answer), false);
  }
  const other = await (await fetch(`${second.base}/api/postcard`)).json();
  assert.notEqual(other.token, postcard.token);
});

// The only shared change is /docs and the optional scenario OpenAPI extension.
for (const scenario of ["first-request", "onboarding", "safe-exposure", "vibe-build", "recover", "ship", "secrets", "observability", "defend", "gameday"]) {
  test(`${scenario}: shared Swagger stays available in both languages`, async (t) => {
    const { base } = await fixture(t, scenario);
    for (const lang of ["ja", "en"]) {
      const html = await (await fetch(`${base}/docs?lang=${lang}`)).text();
      assert.match(html, /SwaggerUIBundle/);
      assert.doesNotMatch(html, /request-workbench|request-send|Try any API|任意の API/);
      const spec = await (await fetch(`${base}/openapi.json?lang=${lang}`)).json();
      for (const path of ["/api/board", "/api/config", "/api/posts", "/api/logs", "/posture", "/healthz"]) assert.ok(spec.paths[path]);
      assert.equal(Boolean(spec.paths["/api/settings"]), ["recover", "observability", "defend", "secrets", "ship", "safe-exposure"].includes(scenario));
      assert.equal(Boolean(spec.paths["/api/source"]), scenario === "vibe-build");
      assert.equal(Boolean(spec.paths["/api/postcard"]), scenario === "first-request");
      assert.equal(spec.servers, undefined);
    }
  });
}
