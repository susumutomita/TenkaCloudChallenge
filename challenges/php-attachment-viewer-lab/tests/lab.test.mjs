import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { cpSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CLIMB_VARIANTS, deriveSecrets } from "../local/verify/checks.mjs";

/**
 * End-to-end test of the lab without Docker: the real PHP portal (php -S) and
 * the real verifier (node) run as child processes on free loopback ports.
 * Needs `php` on PATH (the container uses the official php:8 image).
 *
 * Stage 1 must succeed against the starting state, stage 2 must make the same
 * reproduction fail, /verify must echo checkpointId, and no failure message
 * may contain the seed, the flag or the console token.
 */

const SEED = "lab-test-seed-0123456789abcdef";
const secrets = deriveSecrets(SEED);
const local = new URL("../local/", import.meta.url);
let labRoot;
let php;
let verifier;
let BASE;
let VERIFY;

async function freePort() {
  const srv = createServer();
  srv.listen(0, "127.0.0.1");
  await once(srv, "listening");
  const { port } = srv.address();
  srv.close();
  await once(srv, "close");
  return port;
}

async function waitFor(url, child, label) {
  const deadline = Date.now() + 10_000;
  let lastError = "";
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`${label} exited early (code ${child.exitCode})`);
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch (error) {
      lastError = String(error);
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`${label} did not become healthy at ${url}: ${lastError}`);
}

before(async () => {
  const phpVersion = spawnSync("php", ["--version"], { encoding: "utf8" });
  assert.equal(phpVersion.status, 0, "php must be on PATH to run this test");

  labRoot = mkdtempSync(join(tmpdir(), "php-attachment-viewer-lab-"));
  cpSync(new URL("app/attachments/", local), join(labRoot, "attachments"), { recursive: true });
  const env = { ...process.env, FLAG_SEED: SEED, LAB_ROOT: labRoot };

  const bootstrap = spawnSync("php", [new URL("app/bin/bootstrap.php", local).pathname], { env, encoding: "utf8" });
  assert.equal(bootstrap.status, 0, bootstrap.stderr);
  assert.match(readFileSync(join(labRoot, "private", "config.ini"), "utf8"), /audit_token = "TC\{escape_[0-9a-f]{20}\}"/);

  const phpPort = await freePort();
  php = spawn("php", ["-S", `127.0.0.1:${phpPort}`, new URL("app/public/index.php", local).pathname], { env, stdio: ["ignore", "pipe", "pipe"] });
  BASE = `http://127.0.0.1:${phpPort}`;
  await waitFor(`${BASE}/healthz`, php, "php surface");

  const verifyPort = await freePort();
  verifier = spawn(process.execPath, [new URL("verify/server.mjs", local).pathname], {
    env: { ...process.env, FLAG_SEED: SEED, SURFACE_URL: BASE, PORT: String(verifyPort), BIND: "127.0.0.1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  VERIFY = `http://127.0.0.1:${verifyPort}`;
  await waitFor(`${VERIFY}/healthz`, verifier, "verifier");
});

after(async () => {
  for (const child of [php, verifier]) {
    if (child && child.exitCode === null) {
      child.kill();
      await once(child, "exit");
    }
  }
  if (labRoot) rmSync(labRoot, { recursive: true, force: true });
});

const viewer = (name) => fetch(`${BASE}/attachment?file=${encodeURIComponent(name)}`);
const consoleHeaders = { authorization: `Bearer ${secrets.consoleToken}`, "content-type": "application/json" };
const action = (body) => fetch(`${BASE}/admin/action`, { method: "POST", headers: consoleHeaders, body: JSON.stringify(body) });
async function verify(checkpointId, submission = "done") {
  const res = await fetch(`${VERIFY}/verify`, { method: "POST", body: JSON.stringify({ checkpointId, submission }) });
  return { status: res.status, json: await res.json() };
}
function assertNoLeak(json) {
  const text = JSON.stringify(json);
  assert.ok(!text.includes(SEED), "message leaks the seed");
  assert.ok(!text.includes(secrets.flagRead), "message leaks the flag");
  assert.ok(!text.includes(secrets.consoleToken), "message leaks the console token");
  assert.ok(!/TC\{/.test(text), "message contains a flag-shaped value");
}

test("stage 1: the viewer serves the shelf, and the starting state lets a climbing name read the private file", async () => {
  const manual = await viewer("manual.txt");
  assert.equal(manual.status, 200);
  assert.match(await manual.text(), /Document shelf/);

  const leak = await viewer("../private/config.ini");
  assert.equal(leak.status, 200);
  const body = await leak.text();
  assert.match(body, /audit_token = "TC\{escape_/);
  assert.ok(body.includes(secrets.flagRead), "the leaked token is the stage-1 flag");

  const internal = await fetch(`${BASE}/internal/audit?token=${encodeURIComponent(secrets.flagRead)}`);
  assert.equal(internal.status, 200);
  assert.ok((await internal.json()).accounts.some((a) => a.username === "svc-backup"));
});

test("/verify echoes checkpointId, accepts the real flag, and rejects wrong flags without revealing anything", async () => {
  const ok = await verify("read-outside", secrets.flagRead);
  assert.equal(ok.status, 200);
  assert.deepEqual({ checkpointId: ok.json.checkpointId, correct: ok.json.correct }, { checkpointId: "read-outside", correct: true });
  const prefixed = await verify("read-outside", `flag = ${secrets.flagRead}`);
  assert.equal(prefixed.json.correct, true);

  const wrong = await verify("read-outside", "TC{escape_00000000000000000000}");
  assert.equal(wrong.json.checkpointId, "read-outside");
  assert.equal(wrong.json.correct, false);
  assertNoLeak(wrong.json);

  const unknown = await verify("no-such-checkpoint", "x");
  assert.equal(unknown.status, 400);
  assert.equal(unknown.json.checkpointId, "no-such-checkpoint");
  assert.equal(unknown.json.correct, false);

  const tooBig = await fetch(`${VERIFY}/verify`, { method: "POST", body: "x".repeat(20_000) });
  assert.equal(tooBig.status, 413);
  const notJson = await fetch(`${VERIFY}/verify`, { method: "POST", body: "{" });
  assert.equal(notJson.status, 400);
});

test("stage 2 checkpoints are all false in the starting state", async () => {
  for (const id of ["fix-viewer", "cleanup-leftover", "rotate-token"]) {
    const r = await verify(id);
    assert.equal(r.json.checkpointId, id);
    assert.equal(r.json.correct, false, id);
    assertNoLeak(r.json);
  }
  assert.equal((await verify("site-healthy")).json.correct, true, "the broken portal is still a working portal");
});

test("the tempting strip-dotdot patch is beaten by another spelling, so fix-viewer stays false", async () => {
  assert.equal((await action({ action: "set-config", pathPolicy: "strip-dotdot" })).status, 200);
  assert.notEqual((await viewer("../private/config.ini")).status, 200, "the plain spelling is now refused");
  const bypass = await viewer("....//private/config.ini");
  assert.equal(bypass.status, 200);
  assert.match(await bypass.text(), /audit_token = /);
  const r = await verify("fix-viewer");
  assert.equal(r.json.correct, false);
  assertNoLeak(r.json);
});

test("the realpath policy refuses every climbing spelling, keeps the shelf working, and passes fix-viewer", async () => {
  const bad = await action({ action: "set-config", pathPolicy: "not-a-policy" });
  assert.equal(bad.status, 400);
  assert.equal((await action({ action: "set-config", pathPolicy: "realpath" })).status, 200);
  for (const name of CLIMB_VARIANTS) {
    const r = await viewer(name);
    assert.ok(r.status === 403 || r.status === 404, `${name} -> ${r.status}`);
    assert.doesNotMatch(await r.text(), /audit_token/);
  }
  const manual = await viewer("manual.txt");
  assert.equal(manual.status, 200);
  assert.match(await manual.text(), /Document shelf/);
  assert.equal((await verify("fix-viewer")).json.correct, true);
  assert.equal((await verify("site-healthy")).json.correct, true);
});

test("cleanup and rotation are judged on the live state; the leaked token stops working", async () => {
  assert.equal((await verify("cleanup-leftover")).json.correct, false);
  assert.equal((await action({ action: "remove-leftover-account" })).status, 200);
  assert.equal((await verify("cleanup-leftover")).json.correct, true);

  assert.equal((await verify("rotate-token")).json.correct, false);
  const rotated = await (await action({ action: "rotate-audit-token" })).json();
  assert.equal(rotated.auditTokenVersion, 1);
  assert.equal(rotated.newToken, secrets.auditToken(1));
  assert.equal((await fetch(`${BASE}/internal/audit?token=${encodeURIComponent(secrets.flagRead)}`)).status, 401);
  assert.equal((await fetch(`${BASE}/internal/audit?token=${rotated.newToken}`)).status, 200);
  assert.equal((await verify("rotate-token")).json.correct, true);
  assert.match(readFileSync(join(labRoot, "private", "config.ini"), "utf8"), new RegExp(`audit_token = "${rotated.newToken}"`));

  // The stage-1 flag is still the stage-1 flag after rotation: the submission
  // proves the participant read the file, not that the token still works.
  assert.equal((await verify("read-outside", secrets.flagRead)).json.correct, true);
});

test("console endpoints require the bearer token", async () => {
  assert.equal((await fetch(`${BASE}/admin/audit`)).status, 401);
  assert.equal((await fetch(`${BASE}/admin/action`, { method: "POST", body: "{}" })).status, 401);
  const unknownAction = await action({ action: "format-disk" });
  assert.equal(unknownAction.status, 400);
  assert.equal((await fetch(`${BASE}/nope`)).status, 404);
});
