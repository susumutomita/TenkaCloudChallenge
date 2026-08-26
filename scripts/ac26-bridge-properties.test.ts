import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import { parse as parseYaml } from "yaml";

/**
 * ac26-bridge-properties is the reference implementation of the AC26 companion template
 * (docs/curricula/advanced-cryptography-2026/TEMPLATE.md). Every later AC26 problem is
 * scaffolded from it, so a regression here silently degrades the whole track.
 *
 * The interesting assertions run the problem's own Python for real rather than reading its
 * source: that the starter fails, that the reference passes, that the hidden tests kill every
 * intended defect, and that /verify holds its security contract. Python 3 is present on
 * ubuntu-latest, and the problem deliberately uses only the standard library, so this needs no
 * container and no extra CI provisioning.
 */

const ROOT = join(import.meta.dir, "..", "challenges", "ac26-bridge-properties");
const LOCAL = join(ROOT, "local");
const SEED = "ci-fixed-seed";

function read(relativePath: string): string {
  return readFileSync(join(ROOT, relativePath), "utf8");
}

function python(args: string[], cwd = LOCAL) {
  return spawnSync("python3", args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, FLAG_SEED: SEED, PYTHONDONTWRITEBYTECODE: "1" },
    timeout: 120_000,
  });
}

/** Read one field of the seeded public instance, for building negative cases. */
function instanceField(field: string): number {
  const script = [
    "import sys",
    "sys.path.insert(0, '.')",
    "from fixtures.generate import instance",
    "import os",
    "print(getattr(instance(os.environ['FLAG_SEED']), sys.argv[1]))",
  ].join("\n");
  const result = python(["-c", script, field]);
  expect(result.status).toBe(0);
  return Number(result.stdout.trim());
}

/** The starter's all-True matrix, as the learner would first submit it. */
function readStarterMatrix(): string {
  return JSON.stringify({
    p1: { complete: true, sound: true, private: true },
    p2: { complete: true, sound: true, private: true },
    p3: { complete: true, sound: true, private: true },
  });
}

/** Evaluate one checkpoint through the verifier's own entry point. */
function evaluate(checkpointId: string, submission: string): boolean {
  const script = [
    "import json, sys",
    "sys.path.insert(0, '.')",
    "from verifier.server import evaluate",
    "print(json.dumps(evaluate(sys.argv[1], sys.argv[2])))",
  ].join("\n");
  const result = python(["-c", script, checkpointId, submission]);
  expect(result.status).toBe(0);
  return JSON.parse(result.stdout.trim().split("\n").at(-1) ?? "null") === true;
}

describe("ac26-bridge-properties: participant contract", () => {
  it("should ship every file the AC26 template requires", () => {
    for (const path of [
      "Makefile",
      "metadata.json",
      "README.md",
      "README.ja.md",
      "local/docker-compose.yml",
      "local/Dockerfile",
      "local/starter/classify.py",
      "local/starter/counterexamples.py",
      "local/reference/classify.py",
      "local/reference/counterexamples.py",
      "local/fixtures/generate.py",
      "local/tests/public/test_properties.py",
      "local/tests/hidden/check_properties.py",
      "local/verifier/server.py",
      "local/participant/server.py",
      "local/mutation.py",
    ]) {
      expect(existsSync(join(ROOT, path))).toBe(true);
    }
  });

  it("should expose the four participant targets the template mandates", () => {
    const makefile = read("Makefile");
    for (const target of ["test:", "test-one:", "inspect:", "reset:"]) {
      expect(makefile).toContain(target);
    }
  });

  it("should keep the answer out of the participant's checkout by mounting only starter/", () => {
    const makefile = read("Makefile");
    expect(makefile).toContain("local/starter:/problem/starter:ro");
    expect(makefile).not.toContain("local/reference:");
    expect(makefile).not.toContain("tests/hidden:");
  });
});

describe("ac26-bridge-properties: container safety", () => {
  it("should publish every port on loopback only", () => {
    const compose = parseYaml(read("local/docker-compose.yml")) as {
      services: Record<string, { ports?: string[] }>;
    };
    const ports = Object.values(compose.services).flatMap((service) => service.ports ?? []);
    expect(ports.length).toBeGreaterThan(0);
    for (const mapping of ports) {
      expect(mapping.startsWith("127.0.0.1:")).toBe(true);
    }
  });

  it("should require FLAG_SEED rather than defaulting to a committed value", () => {
    expect(read("local/docker-compose.yml")).toContain("${FLAG_SEED:?");
  });

  it("should pin the base image by digest so fixtures cannot shift under the learner", () => {
    expect(read("local/Dockerfile")).toMatch(/^FROM \S+@sha256:[0-9a-f]{64}( AS \S+)?$/m);
  });

  it("should never build a shell command out of participant input", () => {
    const verifier = read("local/verifier/server.py");
    expect(verifier).toContain("shell=False");
    expect(verifier).not.toContain("os.system");
    expect(verifier).not.toContain("shell=True");
  });
});

describe("ac26-bridge-properties: fixtures are seed-derived", () => {
  it("should produce different fixtures for different seeds", () => {
    const script = [
      "import json, sys",
      "sys.path.insert(0, '.')",
      "from fixtures.generate import instance, health_token",
      "seed = sys.argv[1]",
      "print(json.dumps({**instance(seed).as_public(), 'token': health_token(seed)}))",
    ].join("\n");
    const first = python(["-c", script, "seed-alpha"]).stdout.trim();
    const second = python(["-c", script, "seed-beta"]).stdout.trim();
    const again = python(["-c", script, "seed-alpha"]).stdout.trim();

    expect(first).not.toBe(second);
    expect(first).toBe(again);
  });

  it("should vary the three public verifier labels across deployments", () => {
    const script = [
      "import json, sys",
      "sys.path.insert(0, '.')",
      "from fixtures.generate import protocol_ids",
      "answers = [json.dumps(protocol_ids(f'solvability-{i}')) for i in range(2000)]",
      "counts = {answer: answers.count(answer) for answer in set(answers)}",
      "print(json.dumps({'distinct': len(counts), 'max': max(counts.values())}))",
    ].join("\n");
    const result = python(["-c", script]);
    expect(result.status).toBe(0);
    const distribution = JSON.parse(result.stdout.trim()) as { distinct: number; max: number };
    expect(distribution.distinct).toBeGreaterThan(100);
    expect(distribution.max / 2000).toBeLessThan(0.05);
  });

  it("should keep the incompleteness boundary statement out of inspect", () => {
    const script = [
      "import json, sys",
      "sys.path.insert(0, '.')",
      "from participant.server import inspect_payload",
      "print(json.dumps(inspect_payload()))",
    ].join("\n");
    const result = python(["-c", script]);
    expect(result.status).toBe(0);
    const payload = JSON.parse(result.stdout.trim()) as Record<string, unknown>;
    expect(payload).not.toHaveProperty("boundaryStatement");
  });
});

describe("ac26-bridge-properties: the problem is actually solvable and actually fails", () => {
  // Unlike the Bridge 0 counter problem, the public tests here pass in the starter state
  // *by design*: they only check the shape of the answers. That is the lesson
  // (misconception.public-tests-are-complete), so it is asserted rather than tolerated.
  it("should pass the public tests in the shipped starter state, because they only check shape", () => {
    const result = python(["tests/public/test_properties.py"]);
    expect(result.status).toBe(0);
    expect(result.stdout).not.toContain("FAIL");
  });

  it("should fail every scored checkpoint in the shipped starter state", () => {
    expect(evaluate("property-matrix", readStarterMatrix())).toBe(false);
    expect(
      evaluate(
        "transfer",
        JSON.stringify({
          "classify.py": read("local/starter/classify.py"),
          "counterexamples.py": read("local/starter/counterexamples.py"),
        }),
      ),
    ).toBe(false);
  });

  it("should kill every intended defect in the mutation suite", () => {
    const result = python(["mutation.py"]);
    expect(result.stdout).toContain("PASS reference implementation passes the hidden tests");
    expect(result.stdout).not.toContain("SURVIVED");
    expect(result.status).toBe(0);
  });
});

describe("ac26-bridge-properties: /verify contract", () => {
  it("should accept the reference submission on the transfer checkpoint", () => {
    expect(
      evaluate(
        "transfer",
        JSON.stringify({
          "classify.py": read("local/reference/classify.py"),
          "counterexamples.py": read("local/reference/counterexamples.py"),
        }),
      ),
    ).toBe(true);
  });

  it("should reject a matrix that is right about one protocol and wrong about another", () => {
    expect(
      evaluate(
        "property-matrix",
        JSON.stringify({
          p1: { complete: false, sound: true, private: true },
          p2: { complete: true, sound: true, private: true },
          p3: { complete: true, sound: true, private: false },
        }),
      ),
    ).toBe(false);
  });

  // The rule the whole problem rests on: a label without a working counterexample
  // must not close a checkpoint.
  it("should reject an in-range value offered as proof of unsoundness", () => {
    expect(evaluate("unsoundness", String(instanceField("witness")))).toBe(false);
  });

  it("should reject a submission that hangs, rather than hanging itself", () => {
    expect(
      evaluate(
        "transfer",
        JSON.stringify({
          "classify.py": "def classify(p):\n    while True:\n        pass\n",
          "counterexamples.py": read("local/reference/counterexamples.py"),
        }),
      ),
    ).toBe(false);
  }, 40_000);

  it("should reject an unknown checkpoint id instead of crediting it", () => {
    expect(evaluate("finish-everything", "anything")).toBe(false);
  });

  it("should reject a non-numeric witness without evaluating it", () => {
    expect(evaluate("privacy-leak", "__import__('os').system('true')")).toBe(false);
  });

  it("should echo the checkpointId so the platform can fail closed", () => {
    expect(read("local/verifier/server.py")).toContain(
      '{"checkpointId": checkpoint_id, "correct": correct}',
    );
  });
});

describe("ac26-bridge-properties: participant/verifier separation (Issue 543/537)", () => {
  it("keeps fixtures/, the answer derivation and the hidden suite out of the participant Docker stage", () => {
    const dockerfile = read("local/Dockerfile");
    const participantStage = dockerfile.slice(
      dockerfile.indexOf("FROM base AS participant"),
      dockerfile.indexOf("FROM base AS verifier"),
    );
    // The class this problem was scaffolded from before this fix: `fixtures/` shipping
    // to the participant stage handed over `instance(seed).witness` directly, and the
    // undisclosed `boundary_instance` behind `incompleteness` too, regardless of where
    // `_check_privacy_leak`'s own comparison lived.
    expect(participantStage).not.toContain("COPY --chown=lab:lab fixtures/");
    expect(participantStage).not.toContain("tests/hidden");
    expect(participantStage).not.toContain("COPY --chown=lab:lab verifier/");
    expect(participantStage).not.toContain("COPY --chown=lab:lab reference/");
    expect(participantStage).not.toContain("COPY --chown=lab:lab mutation.py");
    expect(participantStage).toContain("COPY --chown=lab:lab tests/public/");
    expect(participantStage).toContain("COPY --chown=lab:lab participant/");

    const verifierStage = dockerfile.slice(
      dockerfile.indexOf("FROM base AS verifier"),
      dockerfile.indexOf("FROM participant AS author"),
    );
    expect(verifierStage).toContain("COPY --chown=lab:lab fixtures/");
    expect(verifierStage).toContain("COPY --chown=lab:lab tests/hidden/");
    expect(verifierStage).toContain("COPY --chown=lab:lab verifier/");
    expect(verifierStage).not.toContain("COPY --chown=lab:lab participant/");
    expect(verifierStage).not.toContain("COPY --chown=lab:lab reference/");
    expect(verifierStage).not.toContain("COPY --chown=lab:lab mutation.py");
  });

  it("keeps the Portal editor API and fixtures import out of the hidden verifier, and grading out of the Workbench", () => {
    const participantServer = read("local/participant/server.py");
    const hiddenServer = read("local/verifier/server.py");
    for (const endpoint of ["/api/config", "/api/inspect", "/api/starter", "/api/test", "/api/prepare"]) {
      expect(participantServer).toContain(endpoint);
      expect(hiddenServer).not.toContain(endpoint);
    }
    expect(participantServer).not.toContain("def evaluate(");
    expect(participantServer).not.toContain("def _check_");
    // The only `fixtures` reference in the Workbench is the lazy, function-scoped
    // CI/author fallback inside `fetch_public` -- never a module-level import, which
    // is what would make it resolve eagerly (and fail loudly) the moment this file
    // runs inside a built participant image that does not carry `fixtures/` at all.
    expect(participantServer).not.toMatch(/^from fixtures/m);
    expect(participantServer).toContain("from fixtures.generate import public_payload");
    expect(hiddenServer).toContain("from fixtures.generate import");
    expect(hiddenServer).toContain("/verify");
    expect(hiddenServer).toContain("/healthz");
    expect(hiddenServer).toContain("/public");
    expect(hiddenServer).toContain("/prepare");
  });

  it("proxies /verify and /prepare to the internal verifier and fails closed when it is unreachable", () => {
    const probe = String.raw`
import json, sys
sys.path.insert(0, ".")
from participant import server
bodies = [{"checkpointId": checkpoint, "submission": "anything"} for checkpoint in server.CHECKPOINTS]
print(json.dumps({
    "missing": [server.proxy_verdict(body, "") for body in bodies],
    "unavailable": [server.proxy_verdict(body, "http://127.0.0.1:1/verify") for body in bodies],
    "prepareUnreachable": server.proxy_prepare({"classify.py": "x", "counterexamples.py": "y"}, "http://127.0.0.1:1/prepare"),
    "hasInlineEvaluator": hasattr(server, "evaluate") or any(name.startswith("_check_") for name in dir(server)),
}))
`;
    const result = python(["-c", probe]);
    expect(result.status).toBe(0);
    const output = JSON.parse(result.stdout.trim().split("\n").at(-1) ?? "{}") as {
      missing: Array<{ checkpointId: string; correct: boolean }>;
      unavailable: Array<{ checkpointId: string; correct: boolean }>;
      prepareUnreachable: { ok: boolean };
      hasInlineEvaluator: boolean;
    };
    const checkpoints = [
      "incompleteness",
      "unsoundness",
      "privacy-leak",
      "property-matrix",
      "transfer",
    ];
    const expectedVerdicts = checkpoints.map((checkpointId) => ({ checkpointId, correct: false }));
    expect(output.missing).toEqual(expectedVerdicts);
    expect(output.unavailable).toEqual(expectedVerdicts);
    expect(output.prepareUnreachable.ok).toBe(false);
    expect(output.hasInlineEvaluator).toBe(false);
  });

  it("compose builds the right target for each service, publishes only the Workbench port, and isolates the verifier network", () => {
    const compose = read("local/docker-compose.yml");
    for (const contract of [
      "target: participant",
      "target: verifier",
      '"127.0.0.1:18092:18092"',
      "VERIFIER_URL: http://verifier:18093/verify",
      "VERIFIER_PREPARE_URL: http://verifier:18093/prepare",
      "VERIFIER_PUBLIC_URL: http://verifier:18093/public",
      "read_only: true",
      "cap_drop:",
      "- ALL",
      "no-new-privileges:true",
      "healthcheck:",
      "internal: true",
      'com.docker.network.bridge.enable_ip_masquerade: "false"',
    ]) {
      expect(compose).toContain(contract);
    }
    expect(compose).not.toContain('"127.0.0.1:18093:18093"');
    expect(compose.match(/ports:/g)).toHaveLength(1);
  });
});

describe("ac26-bridge-properties: scoring follows the tier regulation", () => {
  it("should total the Medium tier's 200 points across its checkpoints", () => {
    const meta = JSON.parse(read("metadata.json")) as {
      difficulty: number;
      scoring: { kind: string; checks: Array<{ points: number; hints?: Array<{ penalty: number }> }> };
    };

    expect(meta.scoring.kind).toBe("multi-verify");
    expect(meta.difficulty).toBe(3);
    expect(meta.scoring.checks.reduce((sum, check) => sum + check.points, 0)).toBe(200);

    const hintPenalty = meta.scoring.checks
      .flatMap((check) => check.hints ?? [])
      .reduce((sum, hint) => sum + hint.penalty, 0);
    expect(hintPenalty).toBeLessThanOrEqual(100);
  });
});
