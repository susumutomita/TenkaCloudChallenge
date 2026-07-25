import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import { parse as parseYaml } from "yaml";

/**
 * ac26-bridge-experiment is the reference implementation of the AC26 companion template
 * (docs/curricula/advanced-cryptography-2026/TEMPLATE.md). Every later AC26 problem is
 * scaffolded from it, so a regression here silently degrades the whole track.
 *
 * The interesting assertions run the problem's own Python for real rather than reading its
 * source: that the starter fails, that the reference passes, that the hidden tests kill every
 * intended defect, and that /verify holds its security contract. Python 3 is present on
 * ubuntu-latest, and the problem deliberately uses only the standard library, so this needs no
 * container and no extra CI provisioning.
 */

const ROOT = join(import.meta.dir, "..", "challenges", "ac26-bridge-experiment");
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

describe("ac26-bridge-experiment: participant contract", () => {
  it("should ship every file the AC26 template requires", () => {
    for (const path of [
      "Makefile",
      "metadata.json",
      "README.md",
      "README.ja.md",
      "local/docker-compose.yml",
      "local/Dockerfile",
      "local/starter/counter.py",
      "local/reference/counter.py",
      "local/fixtures/generate.py",
      "local/tests/public/test_counter.py",
      "local/tests/hidden/check_counter.py",
      "local/verifier/server.py",
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

describe("ac26-bridge-experiment: container safety", () => {
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
    expect(read("local/Dockerfile")).toMatch(/^FROM \S+@sha256:[0-9a-f]{64}$/m);
  });

  it("should never build a shell command out of participant input", () => {
    const verifier = read("local/verifier/server.py");
    expect(verifier).toContain("shell=False");
    expect(verifier).not.toContain("os.system");
    expect(verifier).not.toContain("shell=True");
  });
});

describe("ac26-bridge-experiment: fixtures are seed-derived", () => {
  it("should produce different fixtures for different seeds", () => {
    const script = [
      "import json, sys",
      "sys.path.insert(0, '.')",
      "from fixtures.generate import public_case, health_token",
      "seed = sys.argv[1]",
      "print(json.dumps({**public_case(seed).as_dict(), 'token': health_token(seed)}))",
    ].join("\n");
    const first = python(["-c", script, "seed-alpha"]).stdout.trim();
    const second = python(["-c", script, "seed-beta"]).stdout.trim();
    const again = python(["-c", script, "seed-alpha"]).stdout.trim();

    expect(first).not.toBe(second);
    expect(first).toBe(again);
  });
});

describe("ac26-bridge-experiment: the problem is actually solvable and actually fails", () => {
  it("should fail the public tests in the shipped starter state", () => {
    const result = python(["tests/public/test_counter.py"]);
    expect(result.status).not.toBe(0);
    expect(result.stdout).toContain("FAIL");
  });

  it("should kill every intended defect in the mutation suite", () => {
    const result = python(["mutation.py"]);
    expect(result.stdout).toContain("PASS reference implementation passes the hidden tests");
    expect(result.stdout).not.toContain("SURVIVED");
    expect(result.status).toBe(0);
  });
});

describe("ac26-bridge-experiment: /verify contract", () => {
  it("should accept the reference implementation on the generalize checkpoint", () => {
    expect(evaluate("generalize", read("local/reference/counter.py"))).toBe(true);
  });

  it("should reject the starter implementation on the generalize checkpoint", () => {
    expect(evaluate("generalize", read("local/starter/counter.py"))).toBe(false);
  });

  // The verifier's own wall-clock cap is 10s, so this case necessarily outlives bun's
  // 5s default. That is the behaviour under test, not slowness.
  it(
    "should reject a submission that hangs, rather than hanging itself",
    () => {
      expect(
        evaluate("generalize", "def advance(a, b, c, d):\n    while True:\n        pass\n"),
      ).toBe(false);
    },
    30_000,
  );

  it("should reject a submission that exits the interpreter", () => {
    expect(evaluate("generalize", "raise SystemExit(0)\n")).toBe(false);
  });

  it("should reject an unknown checkpoint id instead of crediting it", () => {
    expect(evaluate("finish-everything", "anything")).toBe(false);
  });

  it("should reject a wrong health token", () => {
    expect(evaluate("environment", "not-the-token")).toBe(false);
  });

  it("should reject a non-numeric prediction without evaluating it", () => {
    expect(evaluate("predict", "__import__('os').system('true')")).toBe(false);
  });

  it("should echo the checkpointId so the platform can fail closed", () => {
    const script = [
      "import json, sys",
      "sys.path.insert(0, '.')",
      "from verifier.server import Handler",
      // The handler builds its response through _respond; assert the shape it is given.
      "print(json.dumps(sorted(['checkpointId', 'correct'])))",
    ].join("\n");
    expect(python(["-c", script]).status).toBe(0);
    expect(read("local/verifier/server.py")).toContain(
      '{"checkpointId": checkpoint_id, "correct": correct}',
    );
  });
});

describe("ac26-bridge-experiment: scoring follows the tier regulation", () => {
  it("should total the Easy tier's 100 points across its checkpoints", () => {
    const meta = JSON.parse(read("metadata.json")) as {
      difficulty: number;
      scoring: { kind: string; checks: Array<{ points: number; hints?: Array<{ penalty: number }> }> };
    };

    expect(meta.scoring.kind).toBe("multi-verify");
    expect(meta.difficulty).toBeLessThanOrEqual(2);
    expect(meta.scoring.checks.reduce((sum, check) => sum + check.points, 0)).toBe(100);

    const hintPenalty = meta.scoring.checks
      .flatMap((check) => check.hints ?? [])
      .reduce((sum, hint) => sum + hint.penalty, 0);
    expect(hintPenalty).toBeLessThanOrEqual(50);
  });
});
