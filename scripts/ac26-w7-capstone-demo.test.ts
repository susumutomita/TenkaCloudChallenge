import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import { parse as parseYaml } from "yaml";

/**
 * ac26-w7-capstone-demo is the track's last problem: implement the protocol Week 7's design
 * problem selected, then produce the evidence that it does what it claims and nothing else.
 *
 * The assertions that matter are the ones about *measurement*. Privacy here is not asserted,
 * it is enumerated: two settings with the same sum and different honest inputs, the whole
 * randomness space, every coalition below the threshold. The tests below check that the
 * enumeration actually discriminates — that a protocol which leaks only to the last party is
 * rejected, and that a privacy experiment which samples instead of enumerating is too.
 *
 * Python 3 is on ubuntu-latest and the problem is stdlib-only.
 */

const ROOT = join(import.meta.dir, "..", "challenges", "ac26-w7-capstone-demo");
const LOCAL = join(ROOT, "local");
const SEED = "ci-fixed-seed";
const CHECKPOINTS = [
  "scope",
  "correctness",
  "transcript",
  "privacy",
  "threshold",
  "detect",
  "measure",
  "evidence",
] as const;

function read(relativePath: string): string {
  return readFileSync(join(ROOT, relativePath), "utf8");
}

function python(args: string[], cwd = LOCAL) {
  return spawnSync("python3", args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, FLAG_SEED: SEED, PYTHONDONTWRITEBYTECODE: "1" },
    timeout: 600_000,
  });
}

function bundle(dir: "starter" | "reference"): string {
  return read(`local/${dir}/capstone.py`);
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

/**
 * Every checkpoint in one interpreter. Scoring one submission per checkpoint is sixteen
 * process spawns for the two blocks below, and the spawn dominates the work now that the
 * enumeration is cheap. The catalog's CI budget is shared with forty-odd other problems.
 */
function evaluateAll(submission: string): Record<string, boolean> {
  const script = [
    "import json, sys",
    "sys.path.insert(0, '.')",
    "from verifier.server import CHECKPOINTS, evaluate",
    "source = sys.argv[1]",
    "print(json.dumps({c: evaluate(c, source) for c in CHECKPOINTS}))",
  ].join("\n");
  const result = python(["-c", script, submission]);
  expect(result.status).toBe(0);
  return JSON.parse(result.stdout.trim().split("\n").at(-1) ?? "null");
}

/** Run a snippet against the problem's fixtures and reference, and return its stdout. */
function probe(lines: string[]): string {
  const script = [
    "import sys",
    "sys.path.insert(0, '.')",
    "sys.path.insert(0, 'reference')",
    ...lines,
  ].join("\n");
  const result = python(["-c", script]);
  expect(result.stderr).toBe("");
  return result.stdout.trim();
}

describe("ac26-w7-capstone-demo: participant contract", () => {
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
      "local/tests/public/test_capstone.py",
      "local/tests/hidden/check_capstone.py",
      "local/verifier/server.py",
      "local/starter/capstone.py",
      "local/reference/capstone.py",
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

  // The mutants the `detect` checkpoint grades against must not be readable from the
  // checkout, or the suite can special-case them instead of testing.
  it("should keep the graded mutants out of every file the learner can read", () => {
    for (const path of [
      "local/fixtures/generate.py",
      "local/starter/capstone.py",
      "local/tests/public/test_capstone.py",
      "local/show.py",
    ]) {
      expect(read(path)).not.toContain("draws_no_randomness");
      expect(read(path)).not.toContain("opens_raw_shares");
    }
    expect(read("local/tests/hidden/check_capstone.py")).toContain("draws_no_randomness");
  });
});

describe("ac26-w7-capstone-demo: container safety", () => {
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
    expect(read("local/Dockerfile")).toMatch(/^FROM \S+@sha256:[0-9a-f]{64}$/m);
  });

  it("should never build a shell command out of participant input", () => {
    const verifier = read("local/verifier/server.py");
    expect(verifier).toContain("shell=False");
    expect(verifier).not.toContain("os.system");
    expect(verifier).not.toContain("shell=True");
  });

  // A published port is forwarded to the container's bridge address, so a server on the
  // container's own loopback answers nothing and no checkpoint can ever score.
  it("should not bind the container's own loopback, which no published port reaches", () => {
    const verifier = read("local/verifier/server.py");
    expect(verifier).not.toMatch(/HTTPServer\(\(\s*["']127\.0\.0\.1["']/);
    expect(verifier).toMatch(/HTTPServer\(\(\s*["']0\.0\.0\.0["']/);
  });
});

describe("ac26-w7-capstone-demo: the measurement actually discriminates", () => {
  // Without this the whole problem is decorative: if the enumeration cannot tell a leaking
  // protocol from a private one, every privacy checkpoint passes vacuously.
  it("should reject a protocol that leaks only to the party nobody checks", () => {
    const output = probe([
      "from fixtures.generate import *",
      "import capstone as R",
      "def draws_no_randomness(setting, randomness):",
      "    return R.run(setting, (0,) * setting.randomness_length)",
      "print(R.detects(R.run), R.detects(draws_no_randomness))",
    ]);
    // The reference is clean; the leaker is caught even though party 0 sees nothing wrong.
    expect(output).toBe("False True");
  }, 300_000);

  it("should find that protocol private when only one coalition is examined", () => {
    // This is the finding the sweep exists for, pinned so it cannot quietly regress into a
    // single-coalition check that passes everything.
    const output = probe([
      "from fixtures.generate import *",
      "import capstone as R",
      "def draws_no_randomness(setting, randomness):",
      "    return R.run(setting, (0,) * setting.randomness_length)",
      "left, right = tiny_settings()",
      "seen = [sorted(repr(R.view(draws_no_randomness(s, r), (0,)))",
      "               for r in randomness_space(s)) for s in (left, right)]",
      "print(seen[0] == seen[1])",
    ]);
    expect(output).toBe("True");
  }, 300_000);

  it("should enumerate the whole probability space rather than a sample", () => {
    const output = probe([
      "from fixtures.generate import tiny_settings",
      "import capstone as R",
      "left, _ = tiny_settings()",
      "print(R.experiment_privacy()['space'] == left.modulus ** left.randomness_length)",
    ]);
    expect(output).toBe("True");
  }, 300_000);

  it("should put the coalition threshold at all-but-one, where the output itself gives it away", () => {
    const output = probe([
      "import capstone as R",
      "print([R.threshold(n) == n - 1 for n in (2, 3, 4, 5)])",
    ]);
    expect(output).toBe("[True, True, True, True]");
  });

  it("should change its settings when the deploy seed changes", () => {
    const output = probe([
      "from fixtures.generate import public_setting, hidden_settings",
      "a = (public_setting('seed-a'), tuple(hidden_settings('seed-a')))",
      "b = (public_setting('seed-b'), tuple(hidden_settings('seed-b')))",
      "print(a != b)",
    ]);
    expect(output).toBe("True");
  });
});

describe("ac26-w7-capstone-demo: the problem is solvable and actually fails", () => {
  it("should fail the public tests in the shipped starter state", () => {
    const result = python(["tests/public/test_capstone.py"]);
    expect(result.status).not.toBe(0);
    expect(result.stdout).toContain("failed");
  });

  it("should kill every intended defect in the mutation suite", () => {
    const result = python(["mutation.py"]);
    expect(result.stdout).toContain("PASS reference implementation passes the hidden tests");
    expect(result.stdout).not.toContain("SURVIVED");
    expect(result.status).toBe(0);
  }, 600_000);
});

describe("ac26-w7-capstone-demo: /verify contract", () => {
  it("should accept the reference submission on every checkpoint", () => {
    const scored = evaluateAll(bundle("reference"));
    expect(scored).toEqual(Object.fromEntries(CHECKPOINTS.map((name) => [name, true])));
  }, 300_000);

  it("should reject the starter submission on every checkpoint", () => {
    const scored = evaluateAll(bundle("starter"));
    expect(scored).toEqual(Object.fromEntries(CHECKPOINTS.map((name) => [name, false])));
  }, 300_000);

  // Each of these computes the right sum. None of them is a correct capstone.
  it("should reject a protocol that opens raw shares instead of partial sums", () => {
    const source = bundle("reference").replace(
      '        {"kind": "partial", "from": party, "value": sum(parts) % modulus}\n        for party, parts in enumerate(held)',
      '        {"kind": "partial", "from": party, "value": parts[0] % modulus}\n        for party, parts in enumerate(held)',
    );
    expect(evaluate("correctness", source)).toBe(false);
  }, 300_000);

  it("should reject a protocol that gives every party the same randomness", () => {
    const source = bundle("reference").replace(
      "        start, end = setting.slice_for(party)\n        parts = share(value, setting.parties, modulus, randomness[start:end])",
      "        start, end = setting.slice_for(0)\n        parts = share(value, setting.parties, modulus, randomness[start:end])",
    );
    expect(evaluate("privacy", source)).toBe(false);
  }, 300_000);

  it("should reject a suite that never finds anything", () => {
    const source = bundle("reference").replace(
      "def detects(protocol: Protocol) -> bool:",
      "def detects(protocol: Protocol) -> bool:\n    return False",
    );
    expect(evaluate("detect", source)).toBe(false);
  }, 300_000);

  it("should reject a scope that claims what the build cannot do", () => {
    const source = bundle("reference").replace(
      '        "claims": sorted(PROVIDED),',
      '        "claims": sorted(PROVIDED | NOT_PROVIDED),',
    );
    expect(evaluate("scope", source)).toBe(false);
  }, 300_000);

  it("should reject a measurement nobody counted", () => {
    const source = bundle("reference").replace(
      '        "rounds": transcript["rounds"],',
      '        "rounds": 3,',
    );
    expect(evaluate("measure", source)).toBe(false);
  }, 300_000);

  it("should reject a bundle that omits what the build cannot do", () => {
    const source = bundle("reference").replace(
      "    for name in sorted(NOT_PROVIDED):",
      "    for name in []:",
    );
    expect(evaluate("evidence", source)).toBe(false);
  }, 300_000);

  it("should reject a submission that hangs, rather than hanging itself", () => {
    expect(evaluate("scope", "def scope(setting):\n    while True:\n        pass\n")).toBe(false);
  }, 300_000);

  it("should reject a submission that cannot even be imported", () => {
    expect(evaluate("scope", "def scope(:\n")).toBe(false);
  }, 120_000);

  it("should reject an unknown checkpoint id instead of crediting it", () => {
    expect(evaluate("build-the-capstone", bundle("reference"))).toBe(false);
  });

  it("should echo the checkpointId so the platform can fail closed", () => {
    expect(read("local/verifier/server.py")).toContain(
      '{"checkpointId": checkpoint_id, "correct": correct}',
    );
  });
});

describe("ac26-w7-capstone-demo: metadata contracts", () => {
  function metadata() {
    return JSON.parse(read("metadata.json")) as {
      difficulty: number;
      status: string;
      track: { order: number };
      courseAlignment: { week: number; role: string; sources?: Array<{ kind: string; ref: string }> };
      relations: Array<{ type: string; target: string }>;
      scoring: {
        kind: string;
        checks: Array<{ id: string; points: number; hints?: Array<{ penalty: number }> }>;
      };
    };
  }

  it("should total the Hard tier's 300 points across its checkpoints", () => {
    const meta = metadata();
    expect(meta.scoring.kind).toBe("multi-verify");
    expect(meta.difficulty).toBe(5);
    expect(meta.scoring.checks.reduce((sum, check) => sum + check.points, 0)).toBe(300);
    for (const check of meta.scoring.checks) {
      const penalty = (check.hints ?? []).reduce((sum, hint) => sum + hint.penalty, 0);
      expect(penalty).toBeLessThanOrEqual(check.points / 2);
    }
  });

  it("should score exactly the checkpoints the verifier implements", () => {
    expect(metadata().scoring.checks.map((check) => check.id)).toEqual([...CHECKPOINTS]);
  });

  it("should pin the repository roadmap, because week 7 has no material to pin", () => {
    const { courseAlignment, status, track } = metadata();
    expect(courseAlignment.week).toBe(7);
    expect(courseAlignment.role).toBe("synthesis");
    expect(track.order).toBe(720);
    expect(courseAlignment.sources?.map((source) => source.kind)).toEqual(["roadmap"]);
    for (const source of courseAlignment.sources ?? []) {
      expect(source.ref).toMatch(/^[0-9a-f]{40}$/);
    }
    expect(status).toBe("draft");
  });

  // Unlike the design problem, this one's prerequisite exists, so the edge is declared.
  it("should require the design problem it builds from", () => {
    const prerequisites = metadata()
      .relations.filter((relation) => relation.type === "requires")
      .map((relation) => relation.target)
      .filter((target) => target.startsWith("problem."));
    expect(prerequisites).toEqual(["problem.ac26-w7-capstone-design"]);
  });
});
