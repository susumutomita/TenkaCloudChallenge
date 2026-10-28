// pxe-icmp-oob — safe "EDK-toy / NetBoot lab" model of the parser-bug pattern
// behind the EDK II PXE ICMP-error buffer overflow (CVE-2026-97631).
//
// This is NOT real firmware. It is a tiny, process-local re-creation of one
// buggy copy loop so a participant can *see* the mechanism without any ring-0,
// Secure Boot, or TPM surface. Real exploitation needs a PXE boot window, LAN
// reach to the target in those seconds, and per-build address tuning; none of
// that exists here. Nothing attacker-supplied is persisted: every request
// copies into a fresh in-process buffer that is discarded when the request ends.
import { createHash } from "node:crypto";

export const BUF_SIZE = 504; // Mode.IcmpError fixed buffer (the real struct's size)
export const GUARD_SIZE = 16; // adjacent integrity cookie laid down next to the buffer
export const HANDLER_OFFSET = BUF_SIZE + GUARD_SIZE; // 520 — adjacent control field
export const HANDLER_MAGIC = "debug"; // bytes that, written into the control field, flip the handler
export const REGION_SIZE = 640; // physical region we allocate so the toy never crashes

const sha = (value) => createHash("sha256").update(value).digest("hex");

// checkpointId -> flag, derived from the per-run FLAG_SEED. The surface reveals a
// flag only when the lab mechanics are solved; the verifier derives the same value
// independently and grades it. Nothing plaintext is ever committed.
const FLAG_PREFIX = {
  "buffer-shape": "pxebuf",
  "cumulative-advance": "pxecum",
  "overwrite-secret": "pxehij",
  "boot-scope": "pxescope",
  "impact-class": "pxeimpact",
};

export function flagFor(checkpointId, seed) {
  const prefix = FLAG_PREFIX[checkpointId];
  if (!prefix || !seed) return null;
  return `TC{${prefix}_${sha(`flag:${checkpointId}:${seed}`).slice(0, 20)}}`;
}

export function isCheckpoint(checkpointId) {
  return Object.hasOwn(FLAG_PREFIX, checkpointId);
}

// The per-run guard cookie placed immediately after the 504-byte buffer. Its bytes
// are never returned to the participant; only whether it is still intact is shown.
export function guardCookie(seed) {
  return Buffer.from(sha(`guard:${seed}`).slice(0, GUARD_SIZE * 2), "hex");
}

/**
 * The intentionally buggy copy loop, modeled on NetworkPkg/UefiPxeBcDxe's handling
 * of fragmented ICMP error data. Two faults, both faithful to the writeup:
 *   BUG 1 (broken bounds check): it notices overflow but still copies the whole
 *          fragment, so an oversized blob writes past the 504-byte buffer.
 *   BUG 2 (cumulative advance): it advances the destination pointer by the running
 *          *cumulative* length instead of this fragment's length, so later
 *          fragments land progressively farther out — overflowing even when the
 *          total submitted bytes would have fit under 504.
 * `region` is process-local and discarded by the caller; nothing is persisted.
 */
export function collectIcmpError(fragments, seed) {
  const region = Buffer.alloc(REGION_SIZE);
  guardCookie(seed).copy(region, BUF_SIZE);
  region.write("idle.", HANDLER_OFFSET, "ascii");
  const originalGuard = Buffer.from(region.subarray(BUF_SIZE, BUF_SIZE + GUARD_SIZE));

  let offset = 0;
  let cumulative = 0;
  let maxEnd = 0;
  let overflow = false;
  const writes = [];
  const total = fragments.reduce((sum, frag) => sum + frag.length, 0);

  for (const frag of fragments) {
    cumulative += frag.length;
    const end = offset + frag.length;
    if (end > BUF_SIZE) overflow = true; // BUG 1: observed, but the copy proceeds anyway
    const writable = Math.max(0, Math.min(frag.length, REGION_SIZE - offset));
    if (writable > 0) frag.copy(region, offset, 0, writable);
    writes.push({ offset, len: frag.length });
    maxEnd = Math.max(maxEnd, Math.min(end, REGION_SIZE));
    offset += cumulative; // BUG 2: advance by cumulative, not frag.length
  }

  const guardNow = region.subarray(BUF_SIZE, BUF_SIZE + GUARD_SIZE);
  const guardIntact = guardNow.equals(originalGuard);
  const handlerTag = region
    .toString("ascii", HANDLER_OFFSET, HANDLER_OFFSET + HANDLER_MAGIC.length)
    .replace(/[^\x20-\x7e].*$/, "");
  // Signature of BUG 2: a fragment landed at/after offset 504 even though the total
  // submitted bytes fit under 504 — impossible with a correct per-fragment advance.
  const cumulativeSignature = total <= BUF_SIZE && writes.some((w) => w.offset >= BUF_SIZE);

  return { total, writes, maxEnd, overflow, guardIntact, handlerTag, cumulativeSignature };
}

// Which checkpoint (if any) a submission to the ICMP collector earns. Order runs
// from most specific (adjacent-field overwrite) to least.
export function earnedByCopy(analysis, fragments) {
  if (!analysis.guardIntact && analysis.handlerTag === HANDLER_MAGIC) return "overwrite-secret";
  if (analysis.cumulativeSignature && analysis.overflow) return "cumulative-advance";
  if (fragments.length === 1 && fragments[0].length === BUF_SIZE && !analysis.overflow) {
    return "buffer-shape";
  }
  return null;
}

// Two conceptual checkpoints delivered as a short quiz. The question + options are
// public (served by the surface); only the answer key lives here, next to the flag
// mapping, so a correct choice reveals the matching flag.
export const QUIZ = {
  "boot-scope": {
    checkpoint: "boot-scope",
    answer: "b",
    question:
      "This bug lives in the network-boot (PXE) path. Why is a machine that boots only from its local disk out of scope?",
    options: {
      a: "Because local disks are always encrypted, so the copy loop never runs.",
      b: "Because the buggy copy loop only runs during a PXE boot, so a machine that never network-boots never reaches it.",
      c: "Because disk firmware is written in a memory-safe language.",
    },
  },
  "impact-class": {
    checkpoint: "impact-class",
    answer: "c",
    question:
      "A crafted blob overwrites the adjacent control field. Conceptually, how do you tell a denial-of-service outcome from a code-execution outcome?",
    options: {
      a: "They are the same thing; any overflow is automatically code execution.",
      b: "A hang or crash is always worse than code execution.",
      c: "A hang/crash is denial-of-service; steering the overwritten control field to attacker-chosen behavior is the code-execution outcome, and it needs per-build tuning.",
    },
  },
};

export function earnedByQuiz(quizId, option) {
  const quiz = QUIZ[quizId];
  if (!quiz || typeof option !== "string") return null;
  return option.trim().toLowerCase() === quiz.answer ? quiz.checkpoint : null;
}

// Public view of the quiz: questions and options, never the answer key.
export function publicQuiz() {
  return Object.fromEntries(
    Object.entries(QUIZ).map(([id, q]) => [id, { question: q.question, options: q.options }]),
  );
}
