import { type ChildProcess, spawn } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
// @ts-expect-error The container runtime is intentionally plain JavaScript.
import {
  classifyEvidence,
  COMPROMISED_VERSION,
  decodeSubmission,
  encodeSubmission,
  evaluateHost,
  evaluateScriptPolicy,
  inspectStarter,
  OBSERVATIONS,
  PATCHED_VERSION,
  PUBLIC_FIXTURES,
  PUBLIC_HOSTS,
  PUBLIC_PATCHED_SUBJECT,
  PUBLIC_REVIEW_SUBJECT,
  reviewPackage,
  STARTER_TRIAGE,
  validateTriage,
} from "../challenges/signed-does-not-mean-safe/local/app/engine.mjs";
// @ts-expect-error Hidden verifier code is intentionally plain JavaScript.
import {
  CHECKPOINT_IDS,
  gradeAll,
  gradeCheckpoint,
  gradeReplay,
  REPLAY_MATRIX,
} from "../challenges/signed-does-not-mean-safe/local/verifier/grader.mjs";
// @ts-expect-error Author-only mutation code is intentionally plain JavaScript.
import { runMutations } from "../challenges/signed-does-not-mean-safe/local/verifier/mutation.mjs";
// @ts-expect-error Public cases are intentionally plain JavaScript.
import { runPublicCases } from "../challenges/signed-does-not-mean-safe/local/verifier/public-cases.mjs";
// @ts-expect-error Author-only reference is intentionally plain JavaScript.
import { REFERENCE_TRIAGE } from "../challenges/signed-does-not-mean-safe/local/verifier/reference.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const PROBLEM = join(ROOT, "challenges/signed-does-not-mean-safe");
const read = (path: string) => readFileSync(join(PROBLEM, path), "utf8");
const readRoot = (path: string) => readFileSync(join(ROOT, path), "utf8");

function withReference(mutate: (triage: Record<string, unknown>) => void) {
  const triage = structuredClone(REFERENCE_TRIAGE) as Record<string, unknown> & {
    review: { resolveFrom: string; treatValidAttestationAsSafe: boolean; flagOn: string[] };
    scriptPolicy: { default: string; allow: Array<{ name: string; version: string }> };
    incident: { treatFetchAsExecuted: boolean; actions: Record<string, string[]> };
  };
  mutate(triage);
  return triage;
}

describe("signed-does-not-mean-safe participant contract", () => {
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
    const participant = dockerfile.slice(
      dockerfile.indexOf("FROM base AS participant"),
      dockerfile.indexOf("FROM base AS verifier"),
    );
    expect(participant).toContain("COPY --chown=node:node app/");
    expect(participant).not.toContain("verifier/");
    expect(participant).not.toContain("reference");
    expect(participant).not.toContain("mutation");
  });

  it("keeps every hidden token out of the participant build input", () => {
    // The participant target copies only app/, so app/ is the participant build
    // input. Neither the reference triage, the graders, nor any hidden-matrix
    // fixture name may appear there — the tokens below exist only in verifier/.
    const appFiles = readdirSync(join(PROBLEM, "local/app")).sort();
    expect(appFiles).toEqual(["engine.mjs", "server.mjs"]);
    for (const file of appFiles) {
      const source = read(`local/app/${file}`);
      for (const token of [
        "REFERENCE_TRIAGE",
        "gradeCheckpoint",
        "gradeAll",
        "runMutations",
        "REPLAY_MATRIX",
        "../verifier",
        "quickmemo",
        "metricline",
        "logline",
        "notedown",
        "spanstore",
        "tracepack",
      ]) {
        expect(source).not.toContain(token);
      }
    }
    expect(read("local/.dockerignore")).toContain("**/*.test.*");
  });

  it("binds only loopback and applies the read-only no-egress boundary to both services", () => {
    const compose = read("local/docker-compose.yml");
    expect(compose.match(/127\.0\.0\.1/g)?.length).toBe(2);
    expect(compose.match(/read_only: true/g)?.length).toBe(2);
    expect(compose.match(/cap_drop:/g)?.length).toBe(2);
    expect(compose.match(/no-new-privileges:true/g)?.length).toBe(2);
    expect(compose.match(/seccomp=\.\/seccomp-no-connect\.json/g)?.length).toBe(2);
    expect(compose.match(/restart: "no"/g)?.length).toBe(2);
    expect(read("local/Dockerfile").match(/USER node/g)?.length).toBe(2);
  });
});

describe("signed-does-not-mean-safe starter evidence", () => {
  it("exposes all four starter blind spots before any repair", () => {
    const report = inspectStarter();
    expect(report.cases).toHaveLength(4);
    expect(
      report.cases.every((item: { expected: string; actual: string }) => item.expected !== item.actual),
    ).toBe(true);
    expect(new Set(report.cases.map((item: { observation: string }) => item.observation)).size).toBe(4);
    expect([...OBSERVATIONS].sort()).toEqual(
      report.cases.map((item: { observation: string }) => item.observation).sort(),
    );
  });

  it("fails the public matrix while the reference passes it", () => {
    const starter = runPublicCases(STARTER_TRIAGE);
    expect(starter.correct).toBe(false);
    expect(starter.cases.filter((item: { passed: boolean }) => !item.passed).length).toBeGreaterThanOrEqual(4);
    expect(runPublicCases(REFERENCE_TRIAGE).correct).toBe(true);
  });

  it("shows the compromised inventory and lockfile pin in the participant fixtures", () => {
    expect(PUBLIC_FIXTURES.tarball.shippedFiles).toContain("scripts/prepare-env.js");
    expect(PUBLIC_FIXTURES.tarball.expectedFiles).not.toContain("scripts/prepare-env.js");
    expect(PUBLIC_FIXTURES.tarball.lifecycleScripts[0].event).toBe("preinstall");
    expect(PUBLIC_FIXTURES.lockfile.packages["node_modules/flatstore"].version).toBe(COMPROMISED_VERSION);
    expect(PUBLIC_FIXTURES.manifest.dependencies.cachekit).toBe("^5.2.0");
    expect(PUBLIC_FIXTURES.attestation.verified).toBe(true);
  });
});

describe("signed-does-not-mean-safe triage evaluator", () => {
  it("flags the compromised package although its attestation is valid", () => {
    const verdict = reviewPackage(REFERENCE_TRIAGE, PUBLIC_REVIEW_SUBJECT);
    expect(verdict.flagged).toBe(true);
    expect(verdict.reasons).toContain("unexpected-file");
    expect(verdict.reasons).toContain("added-lifecycle-script");
    expect(verdict.resolution).toEqual({
      source: "lockfile",
      version: COMPROMISED_VERSION,
      integrity: PUBLIC_REVIEW_SUBJECT.lockfile.integrity,
      path: ["payments-service", "cachekit", "flatstore"],
    });
  });

  it("does not flag the clean patched release", () => {
    expect(reviewPackage(REFERENCE_TRIAGE, PUBLIC_PATCHED_SUBJECT).flagged).toBe(false);
  });

  it("never lets the manifest range decide the resolved version", () => {
    const rangeResolver = withReference((triage) => {
      (triage as { review: { resolveFrom: string } }).review.resolveFrom = "manifest-range";
    });
    const verdict = reviewPackage(rangeResolver, PUBLIC_REVIEW_SUBJECT);
    // The range ^1.1.0 selects the clean patched release and misses the pinned
    // compromised one — which is exactly why the grader rejects this resolver.
    expect(verdict.resolution?.version).toBe(PATCHED_VERSION);
    expect(verdict.flagged).toBe(false);
    expect(gradeCheckpoint(rangeResolver, "resolved-dependency").correct).toBe(false);
  });

  it("keeps the script policy default-deny with one pinned exception", () => {
    expect(
      evaluateScriptPolicy(REFERENCE_TRIAGE, { name: "native-hash", version: "3.4.1", event: "preinstall" }).allowed,
    ).toBe(true);
    for (const request of [
      { name: "native-hash", version: "3.4.0", event: "preinstall" },
      { name: "flatstore", version: COMPROMISED_VERSION, event: "preinstall" },
      { name: "webframe", version: "4.1.2", event: "postinstall" },
    ]) {
      expect(evaluateScriptPolicy(REFERENCE_TRIAGE, request).allowed).toBe(false);
    }
  });

  it("separates fetched from executed when classifying host evidence", () => {
    expect(classifyEvidence({ artifactPresent: false, lifecycleExecuted: false }, false)).toBe("not-installed");
    expect(classifyEvidence({ artifactPresent: true, lifecycleExecuted: false }, false)).toBe(
      "installed-scripts-disabled",
    );
    expect(classifyEvidence({ artifactPresent: true, lifecycleExecuted: true }, false)).toBe("scripts-executed");
    const disabled = PUBLIC_HOSTS.find((host: { id: string }) => host.id === "dev-laptop-3");
    const outcome = evaluateHost(REFERENCE_TRIAGE, disabled);
    expect(outcome.state).toBe("installed-scripts-disabled");
    expect(outcome.actions).not.toContain("rotate-credentials");
  });

  it("accepts only the bounded documented triage subset", () => {
    expect(validateTriage(REFERENCE_TRIAGE)).toEqual([]);
    expect(validateTriage(STARTER_TRIAGE)).toEqual([]);
    expect(validateTriage({})).not.toEqual([]);
    expect(validateTriage({ ...structuredClone(REFERENCE_TRIAGE), extra: true })).not.toEqual([]);
    const wildcard = withReference((triage) => {
      (triage as { scriptPolicy: { allow: unknown[] } }).scriptPolicy.allow = [{ name: "*", version: "1.0.0" }];
    });
    expect(validateTriage(wildcard)).not.toEqual([]);
    const rangeAllow = withReference((triage) => {
      (triage as { scriptPolicy: { allow: unknown[] } }).scriptPolicy.allow = [
        { name: "native-hash", version: "^3.4.0" },
      ];
    });
    expect(validateTriage(rangeAllow)).not.toEqual([]);
    const emptyFlagOn = withReference((triage) => {
      (triage as { review: { flagOn: string[] } }).review.flagOn = [];
    });
    expect(validateTriage(emptyFlagOn)).not.toEqual([]);
    const unknownAction = withReference((triage) => {
      (triage as { incident: { actions: Record<string, string[]> } }).incident.actions["scripts-executed"] = [
        "retaliate",
      ];
    });
    expect(validateTriage(unknownAction)).not.toEqual([]);
  });
});

describe("signed-does-not-mean-safe hidden verification", () => {
  it("defines exactly six independent checkpoints", () => {
    expect(CHECKPOINT_IDS).toEqual([
      "artifact-inventory",
      "provenance-boundary",
      "resolved-dependency",
      "install-policy",
      "incident-scope",
      "replay-resistance",
    ]);
    expect(gradeAll(REFERENCE_TRIAGE).correct).toBe(true);
    expect(gradeAll(STARTER_TRIAGE).correct).toBe(false);
  });

  it("accepts the reference and rejects the starter on every checkpoint", () => {
    for (const checkpointId of CHECKPOINT_IDS) {
      expect(gradeCheckpoint(REFERENCE_TRIAGE, checkpointId)).toMatchObject({ checkpointId, correct: true });
      expect(gradeCheckpoint(STARTER_TRIAGE, checkpointId)).toMatchObject({ checkpointId, correct: false });
    }
  });

  it("refuses to treat a valid attestation as safe", () => {
    const trusting = withReference((triage) => {
      (triage as { review: { treatValidAttestationAsSafe: boolean } }).review.treatValidAttestationAsSafe = true;
    });
    expect(gradeCheckpoint(trusting, "provenance-boundary").correct).toBe(false);
  });

  it("refuses to treat an invalid attestation as valid", () => {
    const ignoring = withReference((triage) => {
      const review = (triage as { review: { flagOn: string[] } }).review;
      review.flagOn = review.flagOn.filter((signal) => signal !== "invalid-attestation");
    });
    expect(gradeCheckpoint(ignoring, "provenance-boundary").correct).toBe(false);
  });

  it("requires the lockfile integrity to be part of the resolution decision", () => {
    const ignoringIntegrity = withReference((triage) => {
      const review = (triage as { review: { flagOn: string[] } }).review;
      review.flagOn = review.flagOn.filter((signal) => signal !== "integrity-mismatch");
    });
    expect(gradeCheckpoint(ignoringIntegrity, "resolved-dependency").correct).toBe(false);
  });

  it("refuses a global script allow and a padded allowlist", () => {
    const allowAll = withReference((triage) => {
      (triage as { scriptPolicy: { default: string } }).scriptPolicy.default = "allow";
    });
    expect(gradeCheckpoint(allowAll, "install-policy").correct).toBe(false);
    const padded = withReference((triage) => {
      (triage as { scriptPolicy: { allow: Array<{ name: string; version: string }> } }).scriptPolicy.allow.push({
        name: "cachekit",
        version: "5.2.4",
      });
    });
    expect(gradeCheckpoint(padded, "install-policy").correct).toBe(false);
  });

  it("refuses credential rotation without execution evidence", () => {
    const rotating = withReference((triage) => {
      (triage as { incident: { actions: Record<string, string[]> } }).incident.actions[
        "installed-scripts-disabled"
      ] = ["remove-artifact", "rotate-credentials"];
    });
    expect(gradeCheckpoint(rotating, "incident-scope").correct).toBe(false);
    const conflating = withReference((triage) => {
      (triage as { incident: { treatFetchAsExecuted: boolean } }).incident.treatFetchAsExecuted = true;
    });
    expect(gradeCheckpoint(conflating, "incident-scope").correct).toBe(false);
  });

  it("fails a keyword-matching triage on the dressed replay variants", () => {
    const keyword = withReference((triage) => {
      (triage as { review: { flagOn: string[] } }).review.flagOn = ["known-bad-name"];
    });
    // False positive: the clean same-name release is flagged by name alone.
    expect(reviewPackage(keyword, PUBLIC_PATCHED_SUBJECT).flagged).toBe(true);
    // Miss: the same compromise under a different name is not flagged.
    const renamed = REPLAY_MATRIX.find(
      (item: { subject: { id: string } }) => item.subject.id === "notedown-renamed-compromise",
    );
    expect(renamed.expected).toBe(true);
    expect(reviewPackage(keyword, renamed.subject).flagged).toBe(false);
    expect(gradeReplay(keyword)).toBe(false);
    expect(gradeCheckpoint(keyword, "replay-resistance").correct).toBe(false);
  });

  it("keeps the replay matrix shuffled, dressed, and free of false positives", () => {
    const ids = REPLAY_MATRIX.map((item: { subject: { id: string } }) => item.subject.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.some((id: string) => id.endsWith("-shuffled"))).toBe(true);
    expect(ids.some((id: string) => id.endsWith("-dressed"))).toBe(true);
    expect(
      REPLAY_MATRIX.filter((item: { expected: boolean }) => item.expected === false).length,
    ).toBeGreaterThanOrEqual(6);
    expect(gradeReplay(REFERENCE_TRIAGE)).toBe(true);
  });

  it("kills all six documented mutants", () => {
    const results = runMutations();
    expect(results.map((item: { name: string }) => item.name)).toEqual([
      "provenance-implies-safe",
      "ignore-lockfile-resolution",
      "ignore-lifecycle-script",
      "allow-all-scripts",
      "rotate-without-execution-evidence",
      "order-dependent-graph",
    ]);
    expect(results.every((item: { killed: boolean }) => item.killed)).toBe(true);
  });

  it("round-trips a bounded submission and rejects malformed or flag-like values", () => {
    const submission = encodeSubmission(REFERENCE_TRIAGE);
    expect(decodeSubmission(submission)).toEqual(REFERENCE_TRIAGE);
    expect(decodeSubmission("TC{fixed}")).toBeNull();
    expect(decodeSubmission("not-base64-json")).toBeNull();
    expect(decodeSubmission("a".repeat(16 * 1024 + 1))).toBeNull();
    expect(() => encodeSubmission({})).toThrow();
  });

  it("rejects an unknown checkpoint and echoes its id", () => {
    expect(gradeCheckpoint(REFERENCE_TRIAGE, "unknown")).toMatchObject({ checkpointId: "unknown", correct: false });
  });
});

describe("signed-does-not-mean-safe spawned runtime contract", () => {
  let participant: ChildProcess | undefined;
  let verifier: ChildProcess | undefined;
  let workbenchPort = 0;
  let verifyPort = 0;
  let stderrLog = "";

  async function portPair(): Promise<[number, number]> {
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const first = await new Promise<number>((resolve, reject) => {
        const server = createServer();
        server.once("error", reject);
        server.listen(0, "127.0.0.1", () => {
          const address = server.address();
          if (address === null || typeof address === "string") {
            server.close();
            reject(new Error("could not allocate a loopback port"));
            return;
          }
          server.close(() => resolve(address.port));
        });
      });
      if (first >= 65_535) continue;
      const probe = createServer();
      const secondFree = await new Promise<boolean>((resolve) => {
        probe.once("error", () => resolve(false));
        probe.listen(first + 1, "127.0.0.1", () => probe.close(() => resolve(true)));
      });
      if (secondFree) return [first, first + 1];
    }
    throw new Error("could not allocate adjacent loopback ports");
  }

  function launch(script: string, port: number): ChildProcess {
    const child = spawn("node", [join(PROBLEM, script)], {
      env: { ...process.env, PORT: String(port) },
      stdio: ["ignore", "ignore", "pipe"],
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderrLog += chunk.toString("utf8");
    });
    return child;
  }

  async function waitFor(url: string): Promise<void> {
    const deadline = Date.now() + 15_000;
    let last = "no response";
    while (Date.now() < deadline) {
      try {
        const response = await fetch(url);
        if (response.ok) return;
        last = `HTTP ${response.status}`;
      } catch (error) {
        last = error instanceof Error ? error.message : String(error);
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(`${url} did not become healthy: ${last}; stderr: ${stderrLog.slice(0, 400)}`);
  }

  async function post(path: string, body: unknown, browserRequest = false) {
    const response = await fetch(`http://127.0.0.1:${verifyPort}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(browserRequest ? { origin: `http://127.0.0.1:${workbenchPort}` } : {}),
      },
      body: JSON.stringify(body),
    });
    const value = (await response.json()) as Record<string, unknown>;
    return { status: response.status, value };
  }

  beforeAll(async () => {
    [workbenchPort, verifyPort] = await portPair();
    participant = launch("local/app/server.mjs", workbenchPort);
    verifier = launch("local/verifier/server.mjs", verifyPort);
    await Promise.all([
      waitFor(`http://127.0.0.1:${workbenchPort}/healthz`),
      waitFor(`http://127.0.0.1:${verifyPort}/healthz`),
    ]);
  });

  afterAll(() => {
    participant?.kill();
    verifier?.kill();
  });

  it("serves the Workbench, the fixtures, and the starter blind spots", async () => {
    const home = await fetch(`http://127.0.0.1:${workbenchPort}/`).then((response) => response.text());
    expect(home).toContain("署名済みなら、安全？");
    const app = await fetch(`http://127.0.0.1:${workbenchPort}/app.js`).then((response) => response.text());
    expect(app).toContain("verifierOrigin");
    const fixtures = (await fetch(`http://127.0.0.1:${workbenchPort}/api/fixtures`).then((response) =>
      response.json(),
    )) as typeof PUBLIC_FIXTURES;
    expect(fixtures.tarball.package).toBe(`flatstore@${COMPROMISED_VERSION}`);
    const observation = (await fetch(`http://127.0.0.1:${workbenchPort}/api/inspect`).then((response) =>
      response.json(),
    )) as ReturnType<typeof inspectStarter>;
    expect(observation.cases).toHaveLength(4);
    const missing = await fetch(`http://127.0.0.1:${workbenchPort}/nope`);
    expect(missing.status).toBe(404);
  });

  it("guards the browser endpoints behind the adjacent-port origin", async () => {
    const noOrigin = await post("/public-test", { triage: STARTER_TRIAGE });
    expect(noOrigin.status).toBe(403);
    const response = await fetch(`http://127.0.0.1:${verifyPort}/public-test`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: `http://127.0.0.1:${workbenchPort + 7}`,
      },
      body: JSON.stringify({ triage: STARTER_TRIAGE }),
    });
    expect(response.status).toBe(403);
  });

  it("fails the starter publicly and prepares no submission for it", async () => {
    const starter = await post("/public-test", { triage: STARTER_TRIAGE }, true);
    expect(starter.status).toBe(200);
    expect((starter.value.report as { correct: boolean }).correct).toBe(false);
    const prepared = await post("/prepare", { triage: STARTER_TRIAGE }, true);
    expect(prepared.status).toBe(200);
    expect(prepared.value.submission).toBeUndefined();
  });

  it("passes the reference through all six live checkpoints with an echoed id", async () => {
    const prepared = await post("/prepare", { triage: REFERENCE_TRIAGE }, true);
    const submission = prepared.value.submission as string;
    expect(typeof submission).toBe("string");
    for (const checkpointId of CHECKPOINT_IDS) {
      const verdict = await post("/verify", { checkpointId, submission });
      expect(verdict.status).toBe(200);
      expect(verdict.value).toMatchObject({ checkpointId, correct: true });
    }
  });

  it("fails closed for malformed, flag-like, unknown, and oversized verify requests", async () => {
    const prepared = await post("/prepare", { triage: REFERENCE_TRIAGE }, true);
    const submission = prepared.value.submission as string;
    for (const body of [
      { checkpointId: "artifact-inventory", submission: "TC{fixed}" },
      { checkpointId: "artifact-inventory", submission: "not-base64-json" },
      { checkpointId: "unknown", submission },
      { checkpointId: "artifact-inventory" },
    ]) {
      const verdict = await post("/verify", body);
      expect(verdict.status).toBe(200);
      expect(verdict.value.correct).toBe(false);
    }
    const oversized = await post("/verify", {
      checkpointId: "artifact-inventory",
      submission: "a".repeat(17 * 1024),
    });
    expect(oversized.status).toBe(400);
  });
});

describe("signed-does-not-mean-safe metadata and sources", () => {
  const metadata = JSON.parse(read("metadata.json"));

  it("scores the Medium tier's 200 points across the exact verifier ids", () => {
    expect(metadata.scoring.kind).toBe("multi-verify");
    expect(metadata.scoring.checks.map((item: { id: string }) => item.id)).toEqual(CHECKPOINT_IDS);
    expect(metadata.scoring.checks.reduce((sum: number, item: { points: number }) => sum + item.points, 0)).toBe(200);
    for (const check of metadata.scoring.checks as Array<{
      points: number;
      wrongAnswerPenalty: number;
      hints?: Array<{ penalty: number }>;
    }>) {
      expect(check.wrongAnswerPenalty).toBeLessThanOrEqual(check.points);
      const hintSum = (check.hints ?? []).reduce((sum, hint) => sum + hint.penalty, 0);
      expect(hintSum).toBeLessThanOrEqual(check.points * 0.5);
    }
    expect(metadata.i18n.en.checks.map((item: { id: string }) => item.id)).toEqual(CHECKPOINT_IDS);
  });

  it("documents the npm provenance sources, the incident research, and the model boundary", () => {
    for (const path of ["README.md", "README.ja.md"]) {
      const text = read(path);
      expect(text).toContain(
        "https://docs.npmjs.com/generating-provenance-statements/#provenance-limitations",
      );
      expect(text).toContain("https://docs.npmjs.com/cli/v11/using-npm/scripts/");
      expect(text).toContain("https://docs.npmjs.com/cli/v12/commands/npm-approve-scripts/");
      expect(text).toContain("snyk.io/blog/inside-keyv-npm-compromise");
      expect(text).toContain("socket.dev/blog/popular-npm-packages-in-the-keyv-and-cacheable-namespaces");
      expect(text).toMatch(/deterministic teaching model|決定論的な教材/);
    }
  });

  it("declares zero cloud cost and distinguishes automated evidence from human playtest", () => {
    for (const path of ["README.md", "README.ja.md"]) {
      const text = read(path);
      expect(text).toMatch(/USD 0|0 USD/);
      expect(text).toMatch(/human[\s\S]*playtest/i);
      expect(text).toContain("down --volumes --remove-orphans");
    }
  });

  it("stays defense-only in every participant-facing text", () => {
    // The docs may *name* the excluded topics ("no implementation guidance for
    // credential harvesting"), so this scans for attack-recipe vocabulary, not
    // for the defensive disclaimer that rules it out.
    for (const path of ["README.md", "README.ja.md", "metadata.json"]) {
      const text = read(path).toLowerCase();
      for (const banned of ["keylog", "reverse shell", "backdoor", "exfiltration script", "c2 server"]) {
        expect(text).not.toContain(banned);
      }
    }
    for (const path of ["README.md", "README.ja.md"]) {
      expect(read(path)).toMatch(/defense-only/i);
    }
  });

  it("makes the clean Docker proof a required check in its own path-filtered workflow", () => {
    // The runtime proof used to be an unconditional job inside ci.yml, gated
    // through the `validate` aggregate. It now lives in its own path-filtered
    // workflow (the mcp-origin-guardian-runtime.yml shape) so an unrelated PR
    // does not boot this problem's Docker Compose lab.
    const ciWorkflow = readRoot(".github/workflows/ci.yml");
    const workflow = readRoot(".github/workflows/signed-does-not-mean-safe-runtime.yml");
    expect(workflow).toContain("signed-npm-runtime:");
    expect(workflow).toContain("bun run signed-npm:runtime");

    // Leaving the job in both places would silently reintroduce the double-run
    // cost this split exists to remove.
    expect(ciWorkflow).not.toContain("signed-npm-runtime:");

    // A path filter narrower than what the proof depends on lets a real
    // regression merge unchecked, which is worse than no filter at all.
    expect(workflow).toContain("challenges/signed-does-not-mean-safe/**");
    expect(workflow).toContain("scripts/verify-signed-does-not-mean-safe.ts");
    expect(workflow).toContain(".github/workflows/signed-does-not-mean-safe-runtime.yml");

    expect(workflow).toMatch(/push:\s*\n\s*branches:\s*\n\s*-\s*main/);
    expect(workflow).toContain("concurrency:");
    expect(workflow).toMatch(/cancel-in-progress:\s*true/);

    expect(JSON.parse(readRoot("package.json")).scripts["signed-npm:runtime"]).toBe(
      "bun run scripts/verify-signed-does-not-mean-safe.ts",
    );
  });
});
