import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import {
  decodeSubmission,
  encodeSubmission,
  runStream,
  STARTER_POLICY,
  validatePolicy,
} from "../challenges/eventbridge-delivery-discipline/local/app/engine.mjs";
import {
  CHECKPOINT_IDS,
  gradeAll,
  gradeCheckpoint,
} from "../challenges/eventbridge-delivery-discipline/local/verifier/grader.mjs";
import { runPublicCases } from "../challenges/eventbridge-delivery-discipline/local/verifier/public-cases.mjs";
import { REFERENCE_POLICY } from "../challenges/eventbridge-delivery-discipline/local/verifier/reference.mjs";

const challengeRoot = join(import.meta.dir, "../challenges/eventbridge-delivery-discipline");
const localRoot = join(challengeRoot, "local");
const metadata = JSON.parse(readFileSync(join(challengeRoot, "metadata.json"), "utf8"));

function mutate(path: string, value: unknown) {
  const result = structuredClone(REFERENCE_POLICY) as Record<string, unknown>;
  const parts = path.split(".");
  let target: Record<string, unknown> = result;
  for (const part of parts.slice(0, -1)) target = target[part] as Record<string, unknown>;
  target[parts.at(-1)!] = value;
  return result;
}

describe("eventbridge delivery behavior", () => {
  it("starts with exactly the four intended public failures", () => {
    const report = runPublicCases(STARTER_POLICY);
    expect(report.correct).toBe(false);
    expect(report.cases).toHaveLength(4);
    expect(report.cases.filter((item) => !item.passed)).toHaveLength(4);
  });

  it("accepts the reference through every independently remeasured checkpoint", () => {
    expect(validatePolicy(REFERENCE_POLICY)).toEqual([]);
    expect(gradeAll(REFERENCE_POLICY)).toEqual({
      correct: true,
      checks: CHECKPOINT_IDS.map((checkpointId) => ({ checkpointId, correct: true, errors: [] })),
    });
    expect(runPublicCases(REFERENCE_POLICY).correct).toBe(true);
  });

  it.each([
    ["observe", "diagnosis", []],
    ["idempotency", "idempotency.key", "deliveryId"],
    ["idempotency", "idempotency.atomic", false],
    ["ordering", "ordering.key", "timestamp"],
    ["ordering", "ordering.gapOutcome", "applied"],
    ["conflict", "conflict.fingerprint", "none"],
    ["conflict", "conflict.sameVersion", "last_write_wins"],
    ["retry-dlq", "retry.maxAttempts", 10],
    ["retry-dlq", "retry.backoff", "none"],
    ["retry-dlq", "retry.retryable", ["transient", "permanent"]],
    ["retry-dlq", "dlq.enabled", false],
    ["retry-dlq", "dlq.include", ["event", "reason", "attempts"]],
    ["replay", "replay.persistLedger", false],
    ["replay", "replay.deterministic", false],
  ] as const)("rejects the %s mutation at %s", (checkpointId, path, value) => {
    expect(gradeCheckpoint(mutate(path, value), checkpointId).correct).toBe(false);
  });

  it("keeps final state, side effects, and DLQ fixed across a second replay", () => {
    const stream = [
      { id: "a1", deliveryId: "d1", aggregateId: "a", version: 1, type: "OrderCreated", data: { status: "created" } },
      { id: "a2", deliveryId: "d2", aggregateId: "a", version: 2, type: "PaymentCaptured", data: { status: "paid", amount: 10 } },
      { id: "b1", deliveryId: "d3", aggregateId: "b", version: 1, type: "OrderCreated", data: { status: "created" }, failure: { type: "transient", succeedsOnAttempt: 99 } },
    ];
    const first = runStream(REFERENCE_POLICY, stream).state;
    const second = runStream(REFERENCE_POLICY, stream, first).state;
    expect(second.aggregates).toEqual(first.aggregates);
    expect(second.sideEffects).toBe(first.sideEffects);
    expect(second.dlq).toEqual(first.dlq);
  });

  it("round-trips a bounded policy and rejects flag-like or malformed submissions", () => {
    expect(decodeSubmission(encodeSubmission(REFERENCE_POLICY))).toEqual(REFERENCE_POLICY);
    expect(decodeSubmission("FLAG{delivery-discipline}")).toBeNull();
    expect(decodeSubmission("a".repeat(8193))).toBeNull();
  });
});

describe("eventbridge delivery metadata and image boundary", () => {
  it("declares six checkpoints totaling the difficulty-3 tier", () => {
    expect(metadata.id).toBe("eventbridge-delivery-discipline");
    expect(metadata.difficulty).toBe(3);
    expect(metadata.scoring.kind).toBe("multi-verify");
    expect(metadata.scoring.checks.map((item: { id: string }) => item.id)).toEqual(CHECKPOINT_IDS);
    expect(metadata.scoring.checks.reduce((sum: number, item: { points: number }) => sum + item.points, 0)).toBe(200);
    expect(metadata.scoring.checks.reduce((sum: number, item: { wrongAnswerPenalty: number }) => sum + item.wrongAnswerPenalty, 0)).toBe(10);
    expect(metadata.i18n.en.checks.map((item: { id: string }) => item.id)).toEqual(CHECKPOINT_IDS);
  });

  it("keeps participant and verifier material in disjoint Docker targets", () => {
    const dockerfile = readFileSync(join(localRoot, "Dockerfile"), "utf8");
    const participant = dockerfile.split("FROM base AS participant", 2)[1]?.split("FROM base AS verifier", 1)[0];
    expect(participant).toBeDefined();
    expect(participant).toContain("COPY --chown=node:node app/ ./app/");
    expect(participant).not.toContain("verifier/");
    expect(dockerfile).toContain("COPY --chown=node:node verifier/ ./verifier/");

    const appFiles = readdirSync(join(localRoot, "app")).sort();
    expect(appFiles).toEqual(["engine.mjs", "server.mjs"]);
    for (const file of appFiles) {
      const source = readFileSync(join(localRoot, "app", file), "utf8");
      expect(source).not.toContain("REFERENCE_POLICY");
      expect(source).not.toContain("gradeCheckpoint");
      expect(source).not.toContain("completeReceipt");
    }
  });

  it("binds to loopback, separates networks, and denies outbound syscalls", () => {
    const compose = readFileSync(join(localRoot, "docker-compose.yml"), "utf8");
    expect(compose).toContain("${EVENTBRIDGE_WORKBENCH_BIND:-127.0.0.1}");
    expect(compose).toContain("${EVENTBRIDGE_VERIFY_BIND:-127.0.0.1}");
    expect(compose).toContain("- participant");
    expect(compose).toContain("- verifier");
    expect(compose).not.toContain("network_mode: host");
    expect(compose.match(/seccomp=\.\/seccomp-no-connect\.json/g)).toHaveLength(2);
    expect(compose.match(/cap_drop:/g)).toHaveLength(2);
    expect(compose.match(/read_only: true/g)).toHaveLength(2);

    const seccomp = JSON.parse(readFileSync(join(localRoot, "seccomp-no-connect.json"), "utf8"));
    expect(seccomp.syscalls).toContainEqual({
      names: ["connect", "sendto", "sendmsg", "sendmmsg"],
      action: "SCMP_ACT_ERRNO",
      errnoRet: 1,
    });
  });

  it("documents AWS differences, zero cost, cleanup, and an unclaimed human playtest", () => {
    for (const file of ["README.md", "README.ja.md"]) {
      const text = readFileSync(join(challengeRoot, file), "utf8");
      expect(text).toContain("eb-rule-retry-policy.html");
      expect(text).toContain("eb-rule-dlq.html");
      expect(text).toContain("185");
      expect(text).toMatch(/0 USD|USD 0/);
      expect(text).toContain("docker compose");
      expect(text).toMatch(/human.*playtest/i);
    }
  });

  it("requires the clean Docker proof in the stable CI aggregate", () => {
    const workflow = readFileSync(join(import.meta.dir, "../.github/workflows/ci.yml"), "utf8");
    expect(workflow).toContain("eventbridge-runtime:");
    expect(workflow).toContain("run: bun run eventbridge:runtime");
    // Assert this job's own dependency, not the whole list. Pinning every job name
    // here made adding one unrelated job fail four unrelated suites, and the
    // exhaustive "every job is listed and gated" check lives in
    // scripts/validate-shard.test.ts, which reads the list out of the workflow.
    expect(/needs:\s*\[([^\]]+)\]/.exec(workflow)?.[1]?.split(",").map((job) => job.trim())).toContain(
      "eventbridge-runtime",
    );
    expect(workflow).toContain(
      'test "${{ needs.eventbridge-runtime.result }}" = "success"',
    );
  });
});
