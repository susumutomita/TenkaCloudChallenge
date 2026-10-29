import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { decodeFragments, collectIcmpError, publicQuiz } from "../local/app/model.mjs";
import {
  earnedByCopy,
  earnedByQuiz,
  evaluate,
  flagFor,
  isCheckpoint,
} from "../local/verify/grading.mjs";

const local = new URL("../local/", import.meta.url);

test("participant image includes no grading authority or per-run seed", async () => {
  const docker = await readFile(new URL("Dockerfile", local), "utf8");
  const surface = docker.split(" AS surface\n")[1].split("\nFROM ")[0];
  const sources = await Promise.all(
    ["app/server.mjs", "app/model.mjs", "app/index.html"].map((p) =>
      readFile(new URL(p, local), "utf8"),
    ),
  );
  assert.equal(surface.match(/COPY[^\n]+/g)?.length, 1);
  assert.match(surface, /COPY app\/model.mjs app\/server.mjs app\/index.html/);
  assert.doesNotMatch(surface, /verify\/|grading|tests\//);
  for (const source of sources)
    assert.doesNotMatch(source, /FLAG_SEED|flagFor|earnedByCopy|earnedByQuiz|answer:\s*["']/);
  for (const q of Object.values(publicQuiz()))
    assert.deepEqual(Object.keys(q).sort(), ["options", "question"]);
  const compose = await readFile(new URL("docker-compose.yml", local), "utf8");
  const publicService = compose.split("  surface:\n")[1].split("  verifier:\n")[0];
  assert.doesNotMatch(publicService, /FLAG_SEED/);
  assert.match(publicService, /http:\/\/verifier:8082/);
  assert.doesNotMatch(compose, /127\.0\.0\.1:[^\n]*:8082/);
  assert.match(compose, /internal: true/);
});

test("empty fragments are rejected and cannot extend write extent or earn a checkpoint", () => {
  for (const body of [
    { fragments: [""] },
    { fragments: ["00", ""] },
    { encoding: "base64", fragments: [""] },
    { encoding: "base64", fragments: ["="] },
    { encoding: "base64", fragments: ["=="] },
  ]) {
    assert.equal(decodeFragments(body), null);
    assert.deepEqual(evaluate("icmp", body, "defensive-fixture"), {
      status: 400,
      value: { error: "invalid_fragments" },
    });
  }
  // No out-of-bounds bytes: the final fragment has zero length.
  const fragments = [Buffer.alloc(200), Buffer.alloc(200), Buffer.alloc(0)];
  const result = collectIcmpError(fragments, "defensive-fixture");
  assert.equal(result.maxEnd, 400);
  assert.equal(result.overflow, false);
  assert.equal(earnedByCopy(result, fragments), null);
  const empty = collectIcmpError([Buffer.alloc(0)], "defensive-fixture");
  assert.equal(empty.maxEnd, 0);
  assert.equal(empty.overflow, false);
});

test("ordinary malformed quiz identifiers and unknown own keys return invalid answers", () => {
  for (const id of [
    null,
    {},
    [],
    1,
    false,
    undefined,
    "unknown",
    "constructor",
    "toString",
    "__proto__",
  ]) {
    assert.equal(earnedByQuiz(id, "a"), null);
    assert.equal(flagFor(id, "defensive-fixture"), null);
    assert.equal(isCheckpoint(id), false);
    assert.deepEqual(evaluate("quiz", { quiz: id, option: "a" }, "defensive-fixture"), {
      status: 200,
      value: { correct: false },
    });
  }
  assert.equal(earnedByQuiz("boot-scope", {}), null);
  assert.equal(earnedByQuiz("boot-scope", "a"), null);
});

test("public transport forwards only raw input and fails closed on authority failure", async () => {
  const server = await readFile(new URL("app/server.mjs", local), "utf8");
  assert.match(server, /body: JSON\.stringify\(body\)/);
  assert.match(server, /AbortSignal\.timeout\(3000\)/);
  assert.match(server, /requestTimeout: 5000, headersTimeout: 5000/);
  assert.match(server, /503, \{ error: "evaluation_unavailable" \}/);
  const verify = await readFile(new URL("verify/server.mjs", local), "utf8");
  const publicListener = verify.split("// Separate internal-only listener:")[0];
  assert.doesNotMatch(publicListener, /evaluate\(req/);
  assert.match(verify, /if \(!FLAG_SEED\)\s+throw/);
  assert.equal((verify.match(/requestTimeout: 5000, headersTimeout: 5000/g) ?? []).length, 2);
});
