import { test } from "node:test";
import assert from "node:assert/strict";
import { BUF_SIZE, HANDLER_MAGIC, HANDLER_OFFSET, collectIcmpError } from "../local/app/model.mjs";
import { earnedByCopy, earnedByQuiz, flagFor, isCheckpoint } from "../local/verify/grading.mjs";

const SEED = "model-fixture";

test("flags are derived from FLAG_SEED and never collide across checkpoints", () => {
  const ids = [
    "buffer-shape",
    "cumulative-advance",
    "overwrite-secret",
    "boot-scope",
    "impact-class",
  ];
  const flags = ids.map((id) => flagFor(id, SEED));
  for (const f of flags) assert.match(f, /^TC\{[a-z]+_[0-9a-f]{20}\}$/);
  assert.equal(new Set(flags).size, ids.length);
  assert.notEqual(flagFor("buffer-shape", SEED), flagFor("buffer-shape", "other-seed"));
  assert.equal(flagFor("nope", SEED), null);
  assert.equal(isCheckpoint("buffer-shape"), true);
  assert.equal(isCheckpoint("nope"), false);
});

test("a single 504-byte fragment fills the buffer without overflow (buffer-shape)", () => {
  const frag = Buffer.alloc(BUF_SIZE, 0x00);
  const analysis = collectIcmpError([frag], SEED);
  assert.equal(analysis.overflow, false);
  assert.equal(analysis.guardIntact, true);
  assert.equal(analysis.handlerTag, "idle.");
  assert.equal(earnedByCopy(analysis, [frag]), "buffer-shape");
});

test("cumulative pointer advance lands a later fragment past 504 even when total fits (cumulative-advance)", () => {
  // 200 + 200 + 100 = 500 ≤ 504, but after the second fragment the destination
  // has advanced by the running cumulative (400), so the third lands at 600.
  const fragments = [Buffer.alloc(200, 0xaa), Buffer.alloc(200, 0xbb), Buffer.alloc(100, 0xcc)];
  const analysis = collectIcmpError(fragments, SEED);
  assert.equal(analysis.total, 500);
  assert.equal(analysis.overflow, true);

  assert.equal(analysis.writes[2].offset, 600);
  assert.equal(analysis.guardIntact, true); // third fragment starts past the guard
  assert.equal(earnedByCopy(analysis, fragments), "cumulative-advance");
});

test("an oversized single fragment can overwrite the adjacent handler tag (overwrite-secret)", () => {
  const payload = Buffer.alloc(HANDLER_OFFSET + HANDLER_MAGIC.length, 0x00);
  payload.write(HANDLER_MAGIC, HANDLER_OFFSET, "ascii");
  const analysis = collectIcmpError([payload], SEED);
  assert.equal(analysis.overflow, true);
  assert.equal(analysis.guardIntact, false);
  assert.equal(analysis.handlerTag, HANDLER_MAGIC);
  assert.equal(earnedByCopy(analysis, [payload]), "overwrite-secret");
});

test("quiz answers map to the conceptual checkpoints", () => {
  assert.equal(earnedByQuiz("boot-scope", "b"), "boot-scope");
  assert.equal(earnedByQuiz("boot-scope", "a"), null);
  assert.equal(earnedByQuiz("impact-class", "c"), "impact-class");
  assert.equal(earnedByQuiz("impact-class", "B"), null);
  assert.equal(earnedByQuiz("nope", "a"), null);
});
