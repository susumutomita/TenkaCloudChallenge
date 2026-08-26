import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
// @ts-expect-error The container runtime is intentionally plain JavaScript.
import {
  ACTION,
  AUDIENCE_KEY,
  decodeSubmission,
  encodeSubmission,
  evaluateTrustPolicy,
  inspectStarter,
  ISSUER,
  PROVIDER_ARN,
  requestContext,
  STARTER_POLICY,
  SUBJECT_KEY,
  TARGET_AUDIENCE,
  TARGET_SUBJECT,
  validatePolicy,
} from "../challenges/github-oidc-trust-boundary/local/app/engine.mjs";
// @ts-expect-error Hidden verifier code is intentionally plain JavaScript.
import {
  CHECKPOINT_IDS,
  gradeAll,
  gradeCheckpoint,
  HIDDEN_MATRIX,
} from "../challenges/github-oidc-trust-boundary/local/verifier/grader.mjs";
// @ts-expect-error Author-only mutation code is intentionally plain JavaScript.
import { runMutations } from "../challenges/github-oidc-trust-boundary/local/verifier/mutation.mjs";
// @ts-expect-error Public cases are intentionally plain JavaScript.
import { runPublicCases } from "../challenges/github-oidc-trust-boundary/local/verifier/public-cases.mjs";
// @ts-expect-error Author-only reference is intentionally plain JavaScript.
import { REFERENCE_POLICY } from "../challenges/github-oidc-trust-boundary/local/verifier/reference.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const PROBLEM = join(ROOT, "challenges/github-oidc-trust-boundary");
const read = (path: string) => readFileSync(join(PROBLEM, path), "utf8");
const readRoot = (path: string) => readFileSync(join(ROOT, path), "utf8");

describe("github-oidc-trust-boundary participant contract", () => {
  it("ships the complete two-image Browser Workbench problem", () => {
    for (const path of [
      "README.md",
      "README.ja.md",
      "metadata.json",
      "local/Dockerfile",
      "local/docker-compose.yml",
      "local/seccomp-no-connect.json",
      "local/app/engine.mjs",
      "local/app/server.mjs",
      "local/verifier/server.mjs",
      "local/verifier/grader.mjs",
      "local/verifier/reference.mjs",
      "local/verifier/public-cases.mjs",
      "local/verifier/mutation.mjs",
    ]) {
      expect(read(path).length).toBeGreaterThan(20);
    }
  });

  it("keeps the verifier and author artifacts out of the participant target", () => {
    const dockerfile = read("local/Dockerfile");
    const participant = dockerfile.slice(dockerfile.indexOf("FROM base AS participant"), dockerfile.indexOf("FROM base AS verifier"));
    expect(participant).toContain("COPY --chown=node:node app/");
    expect(participant).not.toContain("verifier/");
    expect(participant).not.toContain("reference");
    expect(participant).not.toContain("mutation");
  });

  it("binds only loopback and applies the read-only no-egress boundary to both services", () => {
    const compose = read("local/docker-compose.yml");
    expect(compose.match(/127\.0\.0\.1/g)?.length).toBe(2);
    expect(compose.match(/read_only: true/g)?.length).toBe(2);
    expect(compose.match(/cap_drop:/g)?.length).toBe(2);
    expect(compose.match(/no-new-privileges:true/g)?.length).toBe(2);
    expect(compose.match(/seccomp=\.\/seccomp-no-connect\.json/g)?.length).toBe(2);
    expect(read("local/Dockerfile").match(/USER node/g)?.length).toBe(2);
  });
});

describe("github-oidc-trust-boundary starter evidence", () => {
  it("reproduces all four intended unintended allows before any repair", () => {
    const report = inspectStarter();
    expect(report.cases).toHaveLength(4);
    expect(report.cases.every((item: { expected: string; actual: string }) => item.expected === "deny" && item.actual === "allow")).toBe(true);
    expect(new Set(report.cases.map((item: { observation: string }) => item.observation)).size).toBe(4);
  });

  it("fails the public matrix while the reference passes it", () => {
    const starter = runPublicCases(STARTER_POLICY);
    expect(starter.correct).toBe(false);
    expect(starter.cases.filter((item: { passed: boolean }) => !item.passed).length).toBeGreaterThanOrEqual(4);
    expect(runPublicCases(REFERENCE_POLICY).correct).toBe(true);
  });
});

describe("github-oidc-trust-boundary evaluator", () => {
  it("allows the one production environment context", () => {
    expect(evaluateTrustPolicy(REFERENCE_POLICY, requestContext({ id: "good" }))).toEqual({ allowed: true, reasons: [] });
  });

  it("fails closed for issuer, provider, action, missing claims, and multi-valued audience", () => {
    const cases = [
      requestContext({ id: "issuer", iss: "https://token.example.invalid" }),
      requestContext({ id: "provider", providerArn: `${PROVIDER_ARN}-copy` }),
      requestContext({ id: "action", action: `${ACTION}:Other` }),
      requestContext({ id: "missing-aud", aud: undefined }),
      requestContext({ id: "missing-sub", sub: undefined }),
      requestContext({ id: "aud-array", aud: [TARGET_AUDIENCE] }),
    ];
    expect(cases.every((request) => !evaluateTrustPolicy(REFERENCE_POLICY, request).allowed)).toBe(true);
  });

  it("ignores benign extra GitHub claims instead of teaching that real tokens contain only three claims", () => {
    const request = requestContext({
      id: "extra-claims",
      extraClaims: {
        repository: "tenkacloud/production-app",
        environment: "Production",
        workflow_ref: "tenkacloud/production-app/.github/workflows/deploy.yml@refs/heads/main",
        run_id: "12345",
      },
    });
    expect(evaluateTrustPolicy(REFERENCE_POLICY, request).allowed).toBe(true);
  });

  it("uses the caller subject rather than mistaking an approved reusable workflow for caller identity", () => {
    const trusted = HIDDEN_MATRIX.find((item: { id: string }) => item.id === "approved-caller-environment");
    const untrusted = HIDDEN_MATRIX.find(
      (item: { id: string }) => item.id === "untrusted-caller-approved-reusable-workflow",
    );
    expect(evaluateTrustPolicy(REFERENCE_POLICY, trusted.request).allowed).toBe(true);
    expect(evaluateTrustPolicy(REFERENCE_POLICY, untrusted.request).allowed).toBe(false);
    expect(trusted.request.claims.job_workflow_ref).toBe(untrusted.request.claims.job_workflow_ref);
  });

  it("keeps exact comparisons case-sensitive and percent encoding literal", () => {
    for (const sub of [
      TARGET_SUBJECT.replace("Production", "production"),
      TARGET_SUBJECT.replace("tenkacloud/", "tenkacloud%2F"),
      TARGET_SUBJECT.replace("production-app", "production-app-copy"),
    ]) {
      expect(evaluateTrustPolicy(REFERENCE_POLICY, requestContext({ id: sub, sub })).allowed).toBe(false);
    }
  });

  it("accepts only the bounded documented IAM policy subset", () => {
    expect(validatePolicy(REFERENCE_POLICY)).toEqual([]);
    const unknown = JSON.parse(JSON.stringify(REFERENCE_POLICY));
    unknown.trustPolicy.Statement[0].Condition.StringEquals["token.actions.githubusercontent.com:repository"] =
      "tenkacloud/production-app";
    expect(validatePolicy(unknown)).not.toEqual([]);
    const duplicate = JSON.parse(JSON.stringify(REFERENCE_POLICY));
    duplicate.trustPolicy.Statement[0].Condition.StringLike = { [SUBJECT_KEY]: TARGET_SUBJECT };
    expect(validatePolicy(duplicate)).not.toEqual([]);
  });
});

describe("github-oidc-trust-boundary hidden verification", () => {
  it("defines exactly six independent checkpoints", () => {
    expect(CHECKPOINT_IDS).toEqual(["observe", "audience", "repository", "environment", "pull-request", "replay"]);
    expect(gradeAll(REFERENCE_POLICY).correct).toBe(true);
    expect(gradeAll(STARTER_POLICY).correct).toBe(false);
  });

  it("accepts the reference and rejects the starter on every checkpoint", () => {
    for (const checkpointId of CHECKPOINT_IDS) {
      expect(gradeCheckpoint(REFERENCE_POLICY, checkpointId)).toMatchObject({ checkpointId, correct: true });
      expect(gradeCheckpoint(STARTER_POLICY, checkpointId)).toMatchObject({ checkpointId, correct: false });
    }
  });

  it("kills the audience, wildcard, PR, environment, case, and encoding mutations", () => {
    const results = runMutations();
    expect(results).toHaveLength(6);
    expect(results.every((item: { killed: boolean }) => item.killed)).toBe(true);
  });

  it("round-trips a bounded submission and rejects malformed or flag-like values", () => {
    const submission = encodeSubmission(REFERENCE_POLICY);
    expect(decodeSubmission(submission)).toEqual(REFERENCE_POLICY);
    expect(decodeSubmission("TC{fixed}")).toBeNull();
    expect(decodeSubmission("not-base64-json")).toBeNull();
    expect(decodeSubmission("a".repeat(16 * 1024 + 1))).toBeNull();
  });

  it("rejects an unknown checkpoint and echoes its id", () => {
    expect(gradeCheckpoint(REFERENCE_POLICY, "unknown")).toMatchObject({ checkpointId: "unknown", correct: false });
  });
});

describe("github-oidc-trust-boundary metadata and sources", () => {
  const metadata = JSON.parse(read("metadata.json"));

  it("scores the Medium tier's 200 points across the exact verifier ids", () => {
    expect(metadata.scoring.kind).toBe("multi-verify");
    expect(metadata.scoring.checks.reduce((sum: number, item: { points: number }) => sum + item.points, 0)).toBe(200);
    expect(metadata.scoring.checks.map((item: { id: string }) => item.id)).toEqual(CHECKPOINT_IDS);
  });

  it("documents the primary GitHub and AWS sources and the model boundary in both languages", () => {
    for (const path of ["README.md", "README.ja.md"]) {
      const text = read(path);
      expect(text).toContain("docs.github.com");
      expect(text).toContain("docs.aws.amazon.com");
      expect(text).toContain(ISSUER);
      expect(text).toContain(TARGET_AUDIENCE);
      expect(text).toContain(TARGET_SUBJECT);
      expect(text).toMatch(/not an AWS IAM|教材/);
    }
  });

  it("declares zero cloud cost and distinguishes automated evidence from human playtest", () => {
    for (const path of ["README.md", "README.ja.md"]) {
      const text = read(path);
      expect(text).toMatch(/USD 0|0 USD/);
      expect(text).toMatch(/human[\s\S]*playtest/i);
    }
  });

  it("makes the clean Docker proof a required check in its own path-filtered workflow", () => {
    // The runtime proof used to be an unconditional job inside ci.yml, gated
    // through the `validate` aggregate. It now lives in its own path-filtered
    // workflow (the mcp-origin-guardian-runtime.yml shape) so an unrelated PR
    // does not boot this problem's Docker Compose lab.
    const ciWorkflow = readRoot(".github/workflows/ci.yml");
    const workflow = readRoot(".github/workflows/github-oidc-trust-boundary-runtime.yml");
    expect(workflow).toContain("github-oidc-runtime:");
    expect(workflow).toContain("bun run github-oidc:runtime");

    // Leaving the job in both places would silently reintroduce the double-run
    // cost this split exists to remove.
    expect(ciWorkflow).not.toContain("github-oidc-runtime:");

    // A path filter narrower than what the proof depends on lets a real
    // regression merge unchecked, which is worse than no filter at all.
    expect(workflow).toContain("challenges/github-oidc-trust-boundary/**");
    expect(workflow).toContain("scripts/verify-github-oidc-trust-boundary.ts");
    expect(workflow).toContain(".github/workflows/github-oidc-trust-boundary-runtime.yml");

    expect(workflow).toMatch(/push:\s*\n\s*branches:\s*\n\s*-\s*main/);
    expect(workflow).toContain("concurrency:");
    expect(workflow).toMatch(/cancel-in-progress:\s*true/);
  });

  it("uses the exact documented condition keys in the reference", () => {
    const conditions = REFERENCE_POLICY.trustPolicy.Statement[0].Condition.StringEquals;
    expect(conditions).toEqual({ [AUDIENCE_KEY]: TARGET_AUDIENCE, [SUBJECT_KEY]: TARGET_SUBJECT });
    expect(REFERENCE_POLICY.trustPolicy.Statement[0].Principal.Federated).toBe(PROVIDER_ARN);
    expect(REFERENCE_POLICY.trustPolicy.Statement[0].Action).toBe(ACTION);
    expect(ISSUER).toBe("https://token.actions.githubusercontent.com");
  });
});
