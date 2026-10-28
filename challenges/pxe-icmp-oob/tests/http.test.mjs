import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { BUF_SIZE, HANDLER_MAGIC, HANDLER_OFFSET, flagFor } from "../local/app/model.mjs";

const SEED = "http-fixture";

async function start(entry, env = {}) {
  const child = spawn(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `const {server}=await import(${JSON.stringify(new URL(entry, import.meta.url).href)}); server.on('listening',()=>console.log(server.address().port));`,
    ],
    { env: { ...process.env, PORT: "0", ...env }, stdio: ["ignore", "pipe", "pipe"] },
  );
  let error = "";
  child.stderr.on("data", (d) => (error += d));
  const port = await Promise.race([
    once(child.stdout, "data").then(([d]) => Number(d.toString().trim())),
    once(child, "exit").then(() => {
      throw Error(error);
    }),
    new Promise((_, reject) => {
      const t = setTimeout(() => reject(Error("startup timeout")), 5000);
      t.unref();
    }),
  ]);
  return { child, base: `http://127.0.0.1:${port}` };
}

test("surface reveals FLAGS_SEED-derived flags; isolated verifier grades them; surface hides authority", async () => {
  const surface = await start("../local/app/server.mjs", { FLAG_SEED: SEED });
  const verify = await start("../local/verify/server.mjs", { FLAG_SEED: SEED });
  try {
    assert.equal((await fetch(surface.base + "/")).status, 200);
    assert.equal((await fetch(surface.base + "/healthz")).status, 200);
    assert.equal((await fetch(surface.base + "/spec")).status, 200);
    assert.equal((await fetch(surface.base + "/quiz")).status, 200);
    for (const path of ["/verify", "/../verify/server.mjs", "/tests/model.test.mjs"]) {
      assert.equal((await fetch(surface.base + path)).status, 404);
    }

    // Checkpoint 1: fill the 504-byte buffer exactly.
    const fill = await fetch(surface.base + "/icmp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ encoding: "hex", fragments: ["00".repeat(BUF_SIZE)] }),
    }).then((r) => r.json());
    assert.equal(fill.checkpoint, "buffer-shape");
    assert.equal(fill.flag, flagFor("buffer-shape", SEED));

    // Checkpoint 2: cumulative advance with total ≤ 504.
    const cum = await fetch(surface.base + "/icmp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        encoding: "hex",
        fragments: ["aa".repeat(200), "bb".repeat(200), "cc".repeat(100)],
      }),
    }).then((r) => r.json());
    assert.equal(cum.checkpoint, "cumulative-advance");
    assert.equal(cum.flag, flagFor("cumulative-advance", SEED));

    // Checkpoint 3: overwrite the adjacent handler tag with "debug".
    const payload = Buffer.alloc(HANDLER_OFFSET + HANDLER_MAGIC.length, 0x00);
    payload.write(HANDLER_MAGIC, HANDLER_OFFSET, "ascii");
    const hij = await fetch(surface.base + "/icmp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ encoding: "hex", fragments: [payload.toString("hex")] }),
    }).then((r) => r.json());
    assert.equal(hij.checkpoint, "overwrite-secret");
    assert.equal(hij.flag, flagFor("overwrite-secret", SEED));
    assert.equal(hij.handlerTag, HANDLER_MAGIC);

    // Conceptual quizzes.
    const scope = await fetch(surface.base + "/quiz", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ quiz: "boot-scope", option: "b" }),
    }).then((r) => r.json());
    assert.equal(scope.flag, flagFor("boot-scope", SEED));
    const impact = await fetch(surface.base + "/quiz", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ quiz: "impact-class", option: "c" }),
    }).then((r) => r.json());
    assert.equal(impact.flag, flagFor("impact-class", SEED));

    // Verifier grades each flag and rejects junk. Echoes checkpointId.
    const post = (body) =>
      fetch(verify.base + "/verify", { method: "POST", body: JSON.stringify(body) });
    assert.equal((await fetch(verify.base + "/healthz")).status, 200);
    for (const id of ["buffer-shape", "cumulative-advance", "overwrite-secret", "boot-scope", "impact-class"]) {
      const ok = await post({ checkpointId: id, submission: flagFor(id, SEED) });
      assert.equal(ok.status, 200);
      assert.deepEqual(await ok.json(), {
        checkpointId: id,
        correct: true,
        message: "Checkpoint cleared.",
      });
      const bad = await post({ checkpointId: id, submission: "TC{nope}" });
      assert.equal(bad.status, 200);
      assert.equal((await bad.json()).correct, false);
    }
    assert.equal((await post({ checkpointId: "nope", submission: "x" })).status, 400);
    assert.equal((await post({ checkpointId: "buffer-shape", submission: "x".repeat(500) })).status, 400);
    assert.equal((await fetch(verify.base + "/verify", { method: "POST", body: "{" })).status, 400);
    {
      let status;
      try {
        status = (await fetch(verify.base + "/verify", { method: "POST", body: "x".repeat(70 * 1024) })).status;
      } catch {
        status = 413; // undici may surface a closed socket when the server stops reading
      }
      assert.equal(status, 413);
    }

    // Surface does not persist: a second empty fill still works independently.
    const again = await fetch(surface.base + "/icmp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ encoding: "hex", fragments: ["00".repeat(BUF_SIZE)] }),
    }).then((r) => r.json());
    assert.equal(again.checkpoint, "buffer-shape");
  } finally {
    surface.child.kill();
    verify.child.kill();
    await Promise.all([once(surface.child, "exit"), once(verify.child, "exit")]);
  }
});
