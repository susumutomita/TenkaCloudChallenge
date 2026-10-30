import { createHmac } from "node:crypto";

const CHECKPOINTS = Object.freeze([
  "observe-asan",
  "stack-heap",
  "lab-event",
  "fix-ok",
]);

export function assertSeed(seed) {
  if (typeof seed !== "string" || !/^[a-f0-9]{64}$/.test(seed)) {
    throw new Error("FLAG_SEED must be an injected 64-character hexadecimal secret.");
  }
}

export function flagFor(checkpointId, seed) {
  assertSeed(seed);
  if (!CHECKPOINTS.includes(checkpointId)) {
    throw new Error("unknown checkpoint");
  }
  return `TC{${createHmac("sha256", seed)
    .update(`php-memory-lifetime-lab:${checkpointId}`)
    .digest("hex")
    .slice(0, 32)}}`;
}

export { CHECKPOINTS };
