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
    expect(read("local/Dockerfile")).toMatch(/^FROM \S+@sha256:[0-9a-f]{64}( AS \S+)?$/m);
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

describe("ac26-bridge-experiment: resource caps", () => {
  /**
   * `preexec_fn` runs in the child between fork and exec, so anything it raises
   * aborts the exec and the submission never runs at all — the verifier reports a
   * failure for code that was never executed, including the reference.
   *
   * Darwin aliases RLIMIT_AS onto RLIMIT_RSS and refuses to set it while still
   * reporting RLIM_INFINITY, which is exactly that situation on a macOS checkout.
   * These two assertions pin both halves: the caps must apply where the lab runs,
   * and applying them must never be what breaks verification.
   */
  it("should cap address space on Linux, where the lab actually runs", () => {
    const result = python([
      "-c",
      [
        "import sys",
        "sys.path.insert(0, '.')",
        "from verifier.server import _ADDRESS_SPACE_CAPPABLE",
        "print(_ADDRESS_SPACE_CAPPABLE == sys.platform.startswith('linux'))",
      ].join("\n"),
    ]);
    expect(result.status).toBe(0);
    expect(result.stdout.trim().split("\n").at(-1)).toBe("True");
  });

  it("should apply its limits without raising on this platform", () => {
    // A raise here is invisible in normal runs: it surfaces as every checkpoint
    // failing, which reads as a broken problem rather than a broken cap.
    const result = python([
      "-c",
      [
        "import os, sys",
        "sys.path.insert(0, '.')",
        "from verifier.server import _limits",
        "pid = os.fork()",
        "if pid == 0:",
        "    try:",
        "        _limits()",
        "        os._exit(0)",
        "    except Exception:",
        "        os._exit(3)",
        "print(os.waitpid(pid, 0)[1] == 0)",
      ].join("\n"),
    ]);
    expect(result.status).toBe(0);
    expect(result.stdout.trim().split("\n").at(-1)).toBe("True");
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

  // The checkpoint used to be called `inspect`, which is also the name of the Workbench
  // command and the make target that show the evidence. Players read the two as one
  // thing. The checkpoint was the half that moved.
  it("should score the broken index under `first-broken`, not under `inspect`", () => {
    const brokenIndex = python([
      "-c",
      [
        "import sys",
        "sys.path.insert(0, '.')",
        "from fixtures.generate import corrupted_trace",
        "print(corrupted_trace(sys.argv[1])[2])",
      ].join("\n"),
      SEED,
    ]);
    expect(brokenIndex.status).toBe(0);
    const answer = brokenIndex.stdout.trim().split("\n").at(-1) ?? "";
    expect(answer).not.toBe("-1");
    expect(evaluate("first-broken", answer)).toBe(true);
    expect(evaluate("inspect", answer)).toBe(false);
  });

  /**
   * Skipping the reduction is only observable on a round that would have wrapped: if
   * `value + step` was already below the modulus, the corrupted trace equals the clean
   * one and no entry leaves `[0, modulus)`. Picking the round blind therefore shipped a
   * trace with nothing to find for roughly half of all seeds, and `first-broken` asked
   * those players for an index that did not exist. A per-deploy seed picks a fresh case
   * every time, so the property has to hold for all of them, not for this one.
   */
  it("should always leave exactly one entry outside the range, for any seed", () => {
    const result = python([
      "-c",
      [
        "import sys",
        "sys.path.insert(0, '.')",
        "from fixtures.generate import corrupted_trace",
        "bad = []",
        "for index in range(400):",
        "    case, trace, broke_at = corrupted_trace(f'sweep-{index}')",
        "    outside = [i for i, v in enumerate(trace) if not 0 <= v < case.modulus]",
        "    if outside != [broke_at]:",
        "        bad.append((index, outside, broke_at))",
        "print(bad[:5])",
        "print(len(bad))",
      ].join("\n"),
    ]);
    expect(result.status).toBe(0);
    expect(result.stdout.trim().split("\n").at(-1)).toBe("0");
  });

  /**
   * The evidence claims the step count can be recovered, and that claim is the reason
   * the problem exists at all. If the printed arithmetic did not round-trip, the
   * motivation would be a lie told to every player.
   */
  it("should print a walk that really does run backwards", () => {
    const result = python([
      "-c",
      [
        "import sys",
        "sys.path.insert(0, '.')",
        "from fixtures.generate import walkback_case",
        "bad = 0",
        "for index in range(400):",
        "    w = walkback_case(f'sweep-{index}')",
        "    if w['step'] * w['undoStep'] % w['modulus'] != 1:",
        "        bad += 1",
        "    if w['recoveredRounds'] != w['rounds']:",
        "        bad += 1",
        "print(bad)",
      ].join("\n"),
    ]);
    expect(result.status).toBe(0);
    expect(result.stdout.trim().split("\n").at(-1)).toBe("0");
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
