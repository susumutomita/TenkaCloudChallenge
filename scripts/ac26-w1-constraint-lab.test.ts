import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import { parse as parseYaml } from "yaml";

/**
 * ac26-w1-constraint-lab is the first Week 1 problem. The interesting assertions run its
 * Python for real — the starter fails, the reference passes every checkpoint, the mutation
 * suite kills every intended defect, and /verify holds its security contract — rather than
 * reading source text. Python 3 is on ubuntu-latest and the problem is stdlib-only.
 */

const ROOT = join(import.meta.dir, "..", "challenges", "ac26-w1-constraint-lab");
const LOCAL = join(ROOT, "local");
const SEED = "ci-fixed-seed";
const SUBMITTED = ["field.py", "circuit.py", "gadgets.py"] as const;

function read(relativePath: string): string {
  return readFileSync(join(ROOT, relativePath), "utf8");
}

function python(args: string[], cwd = LOCAL) {
  return spawnSync("python3", args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, FLAG_SEED: SEED, PYTHONDONTWRITEBYTECODE: "1" },
    timeout: 180_000,
  });
}

function bundle(dir: "starter" | "reference"): string {
  return JSON.stringify(
    Object.fromEntries(SUBMITTED.map((name) => [name, read(`local/${dir}/${name}`)])),
  );
}

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

function firstBrokenAnswer(): { constraintId: string; residual: number } {
  const script = [
    "import json, os, sys",
    "sys.path.insert(0, '.')",
    "from fixtures.generate import broken_diagnosis",
    "print(json.dumps(broken_diagnosis(os.environ['FLAG_SEED'])))",
  ].join("\n");
  const result = python(["-c", script]);
  expect(result.status).toBe(0);
  return JSON.parse(result.stdout.trim()) as { constraintId: string; residual: number };
}

describe("ac26-w1-constraint-lab: participant contract", () => {
  it("should ship every file the AC26 template requires", () => {
    for (const path of [
      "Makefile",
      "metadata.json",
      "README.md",
      "README.ja.md",
      "local/docker-compose.yml",
      "local/Dockerfile",
      "local/show.py",
      "local/mutation.py",
      "local/fixtures/generate.py",
      "local/tests/public/test_circuit.py",
      "local/tests/hidden/check_circuit.py",
      "local/verifier/server.py",
      ...SUBMITTED.flatMap((name) => [`local/starter/${name}`, `local/reference/${name}`]),
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

  it("should mount only starter/, keeping the answer out of the checkout", () => {
    const makefile = read("Makefile");
    expect(makefile).toContain("local/starter:/problem/starter:ro");
    expect(makefile).not.toContain("local/reference:");
    expect(makefile).not.toContain("tests/hidden:");
  });
});

describe("ac26-w1-constraint-lab: container safety", () => {
  it("should publish every port on loopback only", () => {
    const compose = parseYaml(read("local/docker-compose.yml")) as {
      services: Record<string, { ports?: string[] }>;
    };
    const ports = Object.values(compose.services).flatMap((service) => service.ports ?? []);
    expect(ports.length).toBeGreaterThan(0);
    for (const mapping of ports) expect(mapping.startsWith("127.0.0.1:")).toBe(true);
  });

  it("should require FLAG_SEED rather than defaulting to a committed value", () => {
    expect(read("local/docker-compose.yml")).toContain("${FLAG_SEED:?");
  });

  it("should pin the base image by digest", () => {
    expect(read("local/Dockerfile")).toMatch(/^FROM \S+@sha256:[0-9a-f]{64}( AS \S+)?$/m);
  });

  it("should never build a shell command out of participant input", () => {
    const verifier = read("local/verifier/server.py");
    expect(verifier).toContain("shell=False");
    expect(verifier).not.toContain("os.system");
    expect(verifier).not.toContain("shell=True");
  });
});

describe("ac26-w1-constraint-lab: fixtures are seed-derived", () => {
  it("should produce different circuits for different seeds", () => {
    const script = [
      "import json, sys",
      "sys.path.insert(0, '.')",
      "from fixtures.generate import circuit, field_modulus, health_token",
      "seed = sys.argv[1]",
      "print(json.dumps({'p': field_modulus(seed), 'c': circuit(seed), 't': health_token(seed)}))",
    ].join("\n");
    const first = python(["-c", script, "seed-alpha"]).stdout.trim();
    const second = python(["-c", script, "seed-beta"]).stdout.trim();
    const again = python(["-c", script, "seed-alpha"]).stdout.trim();

    expect(first).not.toBe(second);
    expect(first).toBe(again);
  });

  it("should never place the injected break at the first constraint", () => {
    const script = [
      "import sys",
      "sys.path.insert(0, '.')",
      "from fixtures.generate import broken_witness",
      "print(','.join(broken_witness('s%d' % i)[1] for i in range(40)))",
    ].join("\n");
    const ids = python(["-c", script]).stdout.trim().split(",");
    expect(ids.length).toBe(40);
    expect(ids).not.toContain("c0");
  });

  it("should bind first-broken to the seeded residual, not a two-way guess", () => {
    const script = [
      "import json, sys",
      "sys.path.insert(0, '.')",
      "from fixtures.generate import broken_diagnosis",
      "answers = [json.dumps(broken_diagnosis(f'solvability-{i}'), sort_keys=True) for i in range(2000)]",
      "counts = {answer: answers.count(answer) for answer in set(answers)}",
      "print(json.dumps({'distinct': len(counts), 'max': max(counts.values())}))",
    ].join("\n");
    const result = python(["-c", script]);
    expect(result.status).toBe(0);
    const distribution = JSON.parse(result.stdout.trim()) as { distinct: number; max: number };
    expect(distribution.distinct).toBeGreaterThan(100);
    expect(distribution.max / 2000).toBeLessThan(0.05);
  });
});

describe("ac26-w1-constraint-lab: the problem is solvable and actually fails", () => {
  it("should fail the public tests in the shipped starter state", () => {
    const result = python(["tests/public/test_circuit.py"]);
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

describe("ac26-w1-constraint-lab: /verify contract", () => {
  it.each(["residuals", "boolean", "membership", "transfer"])(
    "should accept the reference submission on %s",
    (checkpoint) => {
      expect(evaluate(checkpoint, bundle("reference"))).toBe(true);
    },
    120_000,
  );

  it.each(["residuals", "boolean", "membership", "transfer"])(
    "should reject the starter submission on %s",
    (checkpoint) => {
      expect(evaluate(checkpoint, bundle("starter"))).toBe(false);
    },
    120_000,
  );

  it("should reject a submission that hangs, rather than hanging itself", () => {
    const files = JSON.parse(bundle("reference")) as Record<string, string>;
    files["circuit.py"] = "def trace(c, w, f):\n    while True:\n        pass\n";
    expect(evaluate("residuals", JSON.stringify(files))).toBe(false);
  }, 60_000);

  it("should reject an unknown checkpoint id instead of crediting it", () => {
    expect(evaluate("finish-week1", bundle("reference"))).toBe(false);
  });

  it("should require the seeded id and residual on first-broken", () => {
    const answer = firstBrokenAnswer();
    expect(evaluate("first-broken", JSON.stringify(answer))).toBe(true);
    expect(evaluate("first-broken", answer.constraintId)).toBe(false);
    expect(
      evaluate("first-broken", JSON.stringify({ ...answer, residual: answer.residual + 1 })),
    ).toBe(false);
  });

  it("should echo the checkpointId so the platform can fail closed", () => {
    expect(read("local/verifier/server.py")).toContain(
      '{"checkpointId": checkpoint_id, "correct": correct}',
    );
  });
});

describe("ac26-w1-constraint-lab: metadata contracts", () => {
  function metadata() {
    return JSON.parse(read("metadata.json")) as {
      difficulty: number;
      courseAlignment: { week: number; role: string; sources: Array<{ ref: string }> };
      scoring: {
        kind: string;
        checks: Array<{ points: number; hints?: Array<{ penalty: number }> }>;
      };
    };
  }

  it("should total the Medium tier's 200 points across its checkpoints", () => {
    const meta = metadata();
    expect(meta.scoring.kind).toBe("multi-verify");
    expect(meta.difficulty).toBe(3);
    expect(meta.scoring.checks.reduce((sum, check) => sum + check.points, 0)).toBe(200);
    const hintPenalty = meta.scoring.checks
      .flatMap((check) => check.hints ?? [])
      .reduce((sum, hint) => sum + hint.penalty, 0);
    expect(hintPenalty).toBeLessThanOrEqual(100);
  });

  // The pins moved once since authoring: upstream added a lecture-slides link to
  // week1/README.md (the exercise README is unchanged), and the ref was re-pinned after
  // reading that diff, per SYNC.md §3/§5. The exact sources are pinned here so a ref
  // bumped without a review shows up as a diff.
  it("should pin the published week 1 lecture and assignment", () => {
    const { courseAlignment } = metadata();
    expect(courseAlignment.week).toBe(1);
    expect(courseAlignment.role).toBe("mechanism");
    expect(courseAlignment.sources).toEqual([
      {
        repository: "zk-tokyo/advanced-cryptography-2026",
        ref: "e4f33fec97c7938f27d3c6dc8ea8b1aeceb0aec9",
        path: "week1/README.md",
        kind: "lecture",
      },
      {
        repository: "zk-tokyo/advanced-cryptography-2026",
        ref: "e4f33fec97c7938f27d3c6dc8ea8b1aeceb0aec9",
        path: "week1/problems/proof-of-exploit/README.md",
        kind: "assignment",
      },
    ]);
  });
});
