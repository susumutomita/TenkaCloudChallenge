import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { challengeServer, flagForSeed, interpret, labEnvironment, safeGreeting, vulnerableGreeting } from "../app/lab.mjs";
import { verifierServer } from "../app/verifier.mjs";

const seed = "a".repeat(64); // Test fixture only; never copied into either image.
const environment = labEnvironment(seed);
const payload = '");print(env["FLAG"]);print("';

test("ordinary names and the visible language examples work", () => {
  assert.equal(vulnerableGreeting("Ada", environment), "Hello, Ada!");
  assert.equal(interpret('print("red" + " blue");', environment), "red blue");
  assert.equal(interpret('print(env["COLOR"]);', environment), "blue");
  assert.equal(interpret('print("a\\\"b");', environment), 'a"b');
});

test("data-to-code concatenation reveals only this instance's fictional environment value", () => {
  assert.equal(vulnerableGreeting(payload, environment), `Hello, \n${environment.FLAG}\n!`);
  assert.notEqual(flagForSeed(seed), flagForSeed("b".repeat(64)));
  assert.ok(Object.isFrozen(environment));
  assert.deepEqual(Object.keys(environment).sort(), ["COLOR", "FLAG"]);
});

test("the repair treats the same payload as data, without invoking the interpreter", () => {
  assert.equal(safeGreeting(payload), `Hello, ${payload}!`);
  assert.ok(!safeGreeting(payload).includes(environment.FLAG));
  assert.equal(safeGreeting("Ada"), "Hello, Ada!");
});

for (const program of [
  'print(process.env.FLAG);', 'print(env["PATH"]);', 'print(env["FLAG_SEED"]);',
  'print(env["AWS_SECRET_ACCESS_KEY"]);', 'print(env["__proto__"]);',
  'print(env["constructor"]);', 'print(env["FLAG"].constructor);',
  'print(globalThis);', 'print(require("node:fs"));', 'import("node:fs");',
  'print(fetch("https://example.invalid"));', 'print(readFile("/etc/passwd"));',
  'while(true){}', 'eval("1");', 'print(env[env["COLOR"]]);',
  'print("a"); // comment', 'print("unterminated);', 'print(1);',
]) test(`reject unsupported syntax/capability: ${program}`, () => {
  assert.throws(() => interpret(program, environment), /^Error: Invalid lab program\.$/);
});

test("input, statement, atom and output bounds are enforced", () => {
  assert.throws(() => vulnerableGreeting("x".repeat(513), environment));
  assert.throws(() => safeGreeting("x".repeat(513)));
  assert.throws(() => interpret("x".repeat(2049), environment));
  assert.throws(() => interpret('print("x");'.repeat(17), environment));
  assert.throws(() => interpret(`print(${Array(65).fill('"x"').join("+")});`, environment));
  assert.throws(() => interpret(`print(${Array(33).fill('env["COLOR"]').join("+")});`, { COLOR: "x".repeat(256) }));
});

test("missing or invalid per-run seeds fail instead of using a committed fallback", () => {
  for (const value of [undefined, "", "local-dev-seed", "a".repeat(63), "z".repeat(64)]) {
    assert.throws(() => flagForSeed(value));
  }
});

async function withServer(server, run) {
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  try { return await run(`http://127.0.0.1:${server.address().port}`); }
  finally { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); }
}

test("participant HTTP surface: visible route solves, verifier/files/real APIs stay absent, HTML is escaped", async () => {
  await withServer(challengeServer(environment), async (origin) => {
    const initial = await fetch(origin);
    const page = await initial.text();
    assert.equal(initial.status, 200);
    assert.ok(page.includes('print(env["COLOR"])'));
    assert.ok(!page.includes(environment.FLAG));
    const solve = await fetch(`${origin}/greet`, { method: "POST", body: new URLSearchParams({ name: payload }) });
    assert.ok((await solve.text()).includes(environment.FLAG));
    for (const path of ["/verify", "/app/verifier.mjs", "/etc/passwd", "/proc/self/environ", "/source"]) {
      assert.equal((await fetch(`${origin}${path}`)).status, 404);
    }
    const escaped = await fetch(`${origin}/greet`, { method: "POST", body: new URLSearchParams({ name: "<script>alert(1)</script>" }) });
    const html = await escaped.text();
    assert.ok(!html.includes("<script>"));
    assert.ok(html.includes("&lt;script&gt;"));
    assert.ok(escaped.headers.get("content-security-policy").includes("default-src 'none'"));
    const malformed = await fetch(`${origin}/greet`, { method: "POST", body: new URLSearchParams({ name: '");print(process.env.FLAG);print("' }) });
    const rejected = await malformed.text();
    assert.ok(rejected.includes("Invalid lab program."));
    assert.ok(!rejected.includes(environment.FLAG));
    assert.equal((await fetch(`${origin}/greet`, { method: "POST", body: "x".repeat(5000) })).status, 413);
  });
});

test("private verifier accepts the solved flag, rejects wrong/cross-instance/malformed values without feedback", async () => {
  await withServer(verifierServer(seed), async (origin) => {
    for (const [submission, correct] of [[environment.FLAG, true], ["wrong", false], [flagForSeed("b".repeat(64)), false], [null, false], [{}, false]]) {
      const result = await fetch(`${origin}/verify`, { method: "POST", body: JSON.stringify({ submission }) });
      assert.deepEqual(await result.json(), { correct });
    }
    for (const body of ["{", "null", "x".repeat(5000)]) {
      const result = await fetch(`${origin}/verify`, { method: "POST", body });
      assert.deepEqual(await result.json(), { correct: false });
      assert.equal(result.status, 400);
    }
    assert.equal((await fetch(`${origin}/verify`)).status, 404);
    assert.equal((await fetch(`${origin}/`)).status, 404);
  });
});

test("packaging separates judge authority and excludes answers/tests from the participant image", () => {
  const compose = readFileSync(new URL("../docker-compose.yml", import.meta.url), "utf8");
  const dockerfile = readFileSync(new URL("../Dockerfile", import.meta.url), "utf8");
  assert.ok(compose.includes('127.0.0.1:18080:8080'));
  assert.ok(compose.includes('127.0.0.1:18081:8081'));
  assert.equal((compose.match(/internal: true/g) ?? []).length, 2);
  assert.ok(!compose.includes("volumes:"));
  assert.ok(!compose.includes("privileged:"));
  assert.ok(!compose.includes("network_mode: host"));
  const participant = dockerfile.split("FROM base AS challenge")[1].split("FROM base AS verifier")[0];
  assert.ok(participant.includes("app/lab.mjs"));
  for (const forbidden of ["verifier.mjs", "ingress.mjs", "tests", "README", "metadata.json", "COPY ."]) assert.ok(!participant.includes(forbidden));
});
