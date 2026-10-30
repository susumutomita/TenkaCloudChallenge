import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { CHECKPOINTS, assertSeed, flagFor } from "../local/app/flags.mjs";
import {
  BIN_DIR,
  QUIZ,
  asanDetectedHeapUaf,
  parseObs,
  runBuggyAsan,
  runFixedScenario,
  runLabEvent,
} from "../local/app/harness.mjs";
import { challengeServer } from "../local/app/server.mjs";
import { verifierServer } from "../local/verify/server.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const seed = "a".repeat(64);
const hasBins =
  existsSync(join(BIN_DIR, "lab_buggy_asan")) &&
  existsSync(join(BIN_DIR, "lab_fixed"));

test("FLAG_SEED and per-checkpoint flags are instance-specific", () => {
  assert.throws(() => assertSeed("short"));
  assert.notEqual(flagFor("observe-asan", seed), flagFor("observe-asan", "b".repeat(64)));
  assert.notEqual(flagFor("observe-asan", seed), flagFor("lab-event", seed));
  assert.equal(CHECKPOINTS.length, 4);
});

test("quiz correct answer is the heap-freed / pointer-kept explanation", () => {
  assert.equal(QUIZ.correct, "heap-freed-pointer-kept");
});

test("OBS parser recognizes stale and cleared markers", () => {
  const stale = parseObs("OBS phase=after_free retained_still=0x1 stale=1\n");
  assert.equal(stale.staleAfterFree, true);
  const fixed = parseObs("OBS phase=after_free retained_cleared=1 stale=0\nOBS phase=consume_rejected reason=null_or_cleared\n");
  assert.equal(fixed.retainedCleared, true);
  assert.equal(fixed.consumeRejected, true);
});

test("ASan detector requires both ERROR and heap-use-after-free", () => {
  assert.equal(asanDetectedHeapUaf("ERROR: AddressSanitizer: heap-use-after-free on address"), true);
  assert.equal(asanDetectedHeapUaf("segmentation fault"), false);
  assert.equal(asanDetectedHeapUaf("ERROR: AddressSanitizer: stack-buffer-overflow"), false);
});

async function withServer(server, run) {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  try {
    return await run(`http://127.0.0.1:${server.address().port}`);
  } finally {
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
  }
}

test("verifier accepts only the matching checkpoint flag", async () => {
  await withServer(verifierServer(seed), async (origin) => {
    for (const id of CHECKPOINTS) {
      const ok = await fetch(`${origin}/verify`, {
        method: "POST",
        body: JSON.stringify({ checkpointId: id, submission: flagFor(id, seed) }),
      });
      assert.deepEqual(await ok.json(), {
        checkpointId: id,
        correct: true,
        message: "Checkpoint cleared.",
      });
      const bad = await fetch(`${origin}/verify`, {
        method: "POST",
        body: JSON.stringify({ checkpointId: id, submission: flagFor(id, "b".repeat(64)) }),
      });
      const body = await bad.json();
      assert.equal(body.checkpointId, id);
      assert.equal(body.correct, false);
    }
    assert.equal((await fetch(`${origin}/`)).status, 404);
  });
});

test("packaging keeps judge authority apart and binds loopback", () => {
  const compose = readFileSync(join(ROOT, "local/docker-compose.yml"), "utf8");
  const dockerfile = readFileSync(join(ROOT, "local/Dockerfile"), "utf8");
  assert.ok(compose.includes("127.0.0.1:18080:8080"));
  assert.ok(compose.includes("127.0.0.1:18081:8081"));
  assert.ok(compose.includes("driver: bridge"));
  assert.ok(!compose.includes("privileged:"));
  assert.ok(!compose.includes("network_mode: host"));
  assert.ok(!compose.includes("/var/run/docker.sock"));
  const surface = dockerfile.split("AS surface")[1].split("AS verifier")[0];
  assert.ok(surface.includes("COPY app/"));
  assert.ok(!surface.includes("verify/"));
  assert.ok(!surface.includes("tests"));
  assert.ok(!surface.includes("metadata.json"));
});

test("participant-facing text names the answer shape and avoids exploit framing", () => {
  const metadata = JSON.parse(readFileSync(join(ROOT, "metadata.json"), "utf8"));
  for (const text of [metadata.instructions, metadata.i18n.en.instructions]) {
    assert.ok(text.includes("TC{...}") || text.includes("TC{"));
    assert.ok(!/exploit|RCE|arbitrary code|戻り先を上書き/i.test(text));
  }
  assert.equal(metadata.id, "php-memory-lifetime-lab");
  assert.equal(metadata.scoring.kind, "multi-verify");
  assert.equal(
    metadata.scoring.checks.reduce((s, c) => s + c.points, 0),
    100,
  );
});

test(
  "binaries: ASan catches buggy path; fixed rejects stale and keeps normal; lab-event records",
  { skip: !hasBins && "LAB_BIN_DIR binaries not built" },
  async () => {
    const buggy = await runBuggyAsan();
    assert.equal(buggy.asanHeapUaf, true, buggy.stderr.slice(-500));
    assert.equal(buggy.obs.staleAfterFree, true);

    const fixed = await runFixedScenario();
    assert.equal(fixed.fixedOk, true, JSON.stringify(fixed.staleObs) + JSON.stringify(fixed.normalObs));

    const event = await runLabEvent();
    assert.equal(event.recorded, true, event.stdout);
  },
);

test(
  "HTTP surface mints flags only after real harness evidence",
  { skip: !hasBins && "LAB_BIN_DIR binaries not built" },
  async () => {
    await withServer(challengeServer(seed), async (origin) => {
      const home = await (await fetch(origin)).text();
      assert.ok(home.includes("record_lab_event"));
      assert.ok(!home.includes(flagFor("observe-asan", seed)));

      const observe = await (await fetch(`${origin}/api/observe`, { method: "POST" })).json();
      assert.equal(observe.correct, true);
      assert.equal(observe.flag, flagFor("observe-asan", seed));

      const quizWrong = await (
        await fetch(`${origin}/api/quiz`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ answer: "return-addr" }),
        })
      ).json();
      assert.equal(quizWrong.correct, false);
      assert.equal(quizWrong.flag, null);

      const quiz = await (
        await fetch(`${origin}/api/quiz`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ answer: QUIZ.correct }),
        })
      ).json();
      assert.equal(quiz.flag, flagFor("stack-heap", seed));

      const event = await (await fetch(`${origin}/api/lab-event`, { method: "POST" })).json();
      assert.equal(event.flag, flagFor("lab-event", seed));

      const fix = await (await fetch(`${origin}/api/fix`, { method: "POST" })).json();
      assert.equal(fix.flag, flagFor("fix-ok", seed));

      for (const path of ["/verify", "/etc/passwd", "/proc/self/environ"]) {
        assert.equal((await fetch(`${origin}${path}`)).status, 404);
      }
    });
  },
);
