import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";

async function start(entry, env = {}) {
  const url = new URL(entry, import.meta.url).href;
  const child = spawn(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `const {server,evaluator}=await import(${JSON.stringify(url)});await Promise.all([server,evaluator].filter(Boolean).map(s=>s.listening?Promise.resolve():new Promise(r=>s.once('listening',r))));console.log(JSON.stringify({port:server.address().port,evaluatorPort:evaluator?.address().port}));`,
    ],
    {
      env: { ...process.env, PORT: "0", EVALUATOR_PORT: "0", ...env },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  const result = await Promise.race([
    once(child.stdout, "data").then(([data]) => JSON.parse(data.toString())),
    once(child, "exit").then(() => {
      throw Error("fixture stopped before listen");
    }),
  ]);
  return {
    child,
    base: `http://127.0.0.1:${result.port}`,
    evaluation: `http://127.0.0.1:${result.evaluatorPort}`,
  };
}
const post = (base, path, body) =>
  fetch(base + path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
async function stop(child) {
  const exited = once(child, "exit");
  child.kill();
  await exited;
}

test("benign submissions use private authority; public verifier never exposes evaluation", async () => {
  const authority = await start("../local/verify/server.mjs", {
    FLAG_SEED: "defensive-http-fixture",
  });
  const surface = await start("../local/app/server.mjs", {
    EVALUATOR_URL: authority.evaluation,
  });
  try {
    const quiz = await fetch(surface.base + "/quiz").then((r) => r.json());
    for (const question of Object.values(quiz.quiz))
      assert.deepEqual(Object.keys(question).sort(), ["options", "question"]);
    // Exact in-bounds fill only: no overflow or control-field payload is executed.
    const fill = await post(surface.base, "/icmp", {
      fragments: ["00".repeat(504)],
    }).then((r) => r.json());
    assert.equal(fill.overflowedBuffer, false);
    assert.equal(fill.maxEnd, 504);
    assert.equal(fill.checkpoint, "buffer-shape");
    const grade = await post(authority.base, "/verify", {
      checkpointId: fill.checkpoint,
      submission: fill.flag,
    }).then((r) => r.json());
    assert.equal(grade.correct, true);
    assert.equal(grade.checkpointId, fill.checkpoint);
    assert.equal("flag" in grade, false);
    for (const id of [{}, [], null, 3, "unknown"]) {
      const response = await post(surface.base, "/quiz", {
        quiz: id,
        option: "a",
      });
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { correct: false });
    }
    const empty = await post(surface.base, "/icmp", {
      fragments: ["00".repeat(200), "00".repeat(200), ""],
    });
    assert.equal(empty.status, 400);
    for (const path of ["/icmp", "/quiz"]) {
      assert.equal((await post(authority.base, path, {})).status, 404);
    }
    assert.equal((await fetch(surface.base + "/healthz")).status, 200);
    assert.equal((await fetch(authority.base + "/healthz")).status, 200);
  } finally {
    await stop(surface.child);
    await stop(authority.child);
  }
});

test("authority unavailability returns 503, not an incorrect answer or success", async () => {
  const surface = await start("../local/app/server.mjs", {
    EVALUATOR_URL: "http://127.0.0.1:1",
  });
  try {
    const response = await post(surface.base, "/quiz", {
      quiz: "boot-scope",
      option: "a",
    });
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), {
      error: "evaluation_unavailable",
    });
  } finally {
    await stop(surface.child);
  }
});
