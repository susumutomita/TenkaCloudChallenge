import { createHash } from "node:crypto";
import { BUF_SIZE, HANDLER_MAGIC, collectIcmpError, decodeFragments } from "../app/model.mjs";
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
  if (typeof checkpointId !== "string" || !Object.hasOwn(FLAG_PREFIX, checkpointId)) return null;
  const prefix = FLAG_PREFIX[checkpointId];
  if (!prefix || !seed) return null;
  return `TC{${prefix}_${sha(`flag:${checkpointId}:${seed}`).slice(0, 20)}}`;
}

export function isCheckpoint(checkpointId) {
  return typeof checkpointId === "string" && Object.hasOwn(FLAG_PREFIX, checkpointId);
}

// Which checkpoint (if any) a submission to the ICMP collector earns. Order runs
// from most specific (adjacent-field overwrite) to least.
export function earnedByCopy(analysis, fragments) {
  if (!analysis.guardIntact && analysis.handlerTag === HANDLER_MAGIC) return "overwrite-secret";
  if (
    analysis.total <= BUF_SIZE &&
    analysis.writes.some((w) => w.len > 0 && w.offset >= BUF_SIZE) &&
    analysis.overflow
  )
    return "cumulative-advance";
  if (fragments.length === 1 && fragments[0].length === BUF_SIZE && !analysis.overflow) {
    return "buffer-shape";
  }
  return null;
}

const QUIZ = {
  "boot-scope": { checkpoint: "boot-scope", answer: "b" },
  "impact-class": { checkpoint: "impact-class", answer: "c" },
};
export function earnedByQuiz(quizId, option) {
  if (typeof quizId !== "string" || !Object.hasOwn(QUIZ, quizId)) return null;
  const quiz = QUIZ[quizId];
  if (!quiz || typeof option !== "string") return null;
  return option.trim().toLowerCase() === quiz.answer ? quiz.checkpoint : null;
}

export function evaluate(kind, body, seed) {
  if (kind === "quiz") {
    const checkpoint = earnedByQuiz(body?.quiz, body?.option);
    return {
      status: 200,
      value: checkpoint
        ? { correct: true, checkpoint, flag: flagFor(checkpoint, seed) }
        : { correct: false },
    };
  }
  const fragments = decodeFragments(body);
  if (!fragments) return { status: 400, value: { error: "invalid_fragments" } };
  const analysis = collectIcmpError(fragments, seed);
  const checkpoint = earnedByCopy(analysis, fragments);
  return {
    status: 200,
    value: {
      total: analysis.total,
      writes: analysis.writes,
      maxEnd: analysis.maxEnd,
      overflowedBuffer: analysis.overflow,
      guardIntact: analysis.guardIntact,
      handlerTag: analysis.handlerTag,
      ...(checkpoint ? { checkpoint, flag: flagFor(checkpoint, seed) } : {}),
    },
  };
}
