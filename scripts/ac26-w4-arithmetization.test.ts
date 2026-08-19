import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import { parse as parseYaml } from "yaml";

/**
 * ac26-w4-arithmetization is Week 4's bridge problem. The assertions that carry weight
 * run its Python for real, and the sharpest of them is the underconstrained witness: a
 * trace that satisfies every transition constraint, is not the computation, and proves a
 * different statement. Python 3 is on ubuntu-latest and the problem is stdlib-only.
 */

const ROOT = join(import.meta.dir, "..", "challenges", "ac26-w4-arithmetization");
const LOCAL = join(ROOT, "local");
const SEED = "ci-fixed-seed";
const CHECKPOINTS = [
  "trace",
  "transition",
  "boundary",
  "interpolate",
  "compose",
  "locate",
  "underconstrained",
  "transfer",
] as const;

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
  return read(`local/${dir}/air.py`);
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

describe("ac26-w4-arithmetization: participant contract", () => {
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
      "local/tests/public/test_air.py",
      "local/tests/hidden/check_air.py",
      "local/verifier/server.py",
      "local/starter/air.py",
      "local/reference/air.py",
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

describe("ac26-w4-arithmetization: container safety", () => {
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

describe("ac26-w4-arithmetization: the domain is a real evaluation domain", () => {
  // Row i sits at g^i, so consecutive rows are consecutive points. That only exists if
  // the group has an element of order `steps`, which needs steps to divide p-1.
  it("should only offer fields where a root of unity of the trace length exists", () => {
    const script = [
      "import sys",
      "sys.path.insert(0, '.')",
      "from fixtures.generate import DOMAINS, root_of_unity",
      "bad = []",
      "for p, steps in DOMAINS:",
      "    if (p - 1) % steps:",
      "        bad.append((p, steps)); continue",
      "    root = root_of_unity(p, steps)",
      "    powers = {pow(root, i, p) for i in range(steps)}",
      "    if len(powers) != steps or pow(root, steps, p) != 1:",
      "        bad.append((p, steps))",
      "print(len(DOMAINS), bad)",
    ].join("\n");
    expect(python(["-c", script]).stdout.trim()).toBe("6 []");
  });

  // A tamper at either end is caught by the boundary constraints alone, which would let
  // an implementation that only checks boundaries look correct.
  it("should never tamper with the first or last row", () => {
    const script = [
      "import sys",
      "sys.path.insert(0, '.')",
      "from fixtures.generate import setting, tampered_trace",
      "ends = 0",
      "for i in range(40):",
      "    cfg = setting('s%d' % i)",
      "    _rows, index = tampered_trace('s%d' % i, 'h0', cfg)",
      "    if index in (0, cfg['steps'] - 1):",
      "        ends += 1",
      "print(ends)",
    ].join("\n");
    expect(python(["-c", script]).stdout.trim()).toBe("0");
  });

  it("should change exactly one row when it tampers", () => {
    const script = [
      "import sys",
      "sys.path.insert(0, '.')",
      "from fixtures.generate import honest_trace, setting, tampered_trace",
      "bad = 0",
      "for i in range(40):",
      "    cfg = setting('s%d' % i)",
      "    rows, index = tampered_trace('s%d' % i, 'h0', cfg)",
      "    honest = honest_trace(cfg)",
      "    differing = [j for j in range(len(rows)) if rows[j] != honest[j]]",
      "    if differing != [index]:",
      "        bad += 1",
      "print(bad)",
    ].join("\n");
    expect(python(["-c", script]).stdout.trim()).toBe("0");
  });
});

describe("ac26-w4-arithmetization: the problem is solvable and actually fails", () => {
  it("should fail the public tests in the shipped starter state", () => {
    const result = python(["tests/public/test_air.py"]);
    expect(result.status).not.toBe(0);
    expect(result.stdout).toContain("failed");
  });

  it("should kill every intended defect in the mutation suite", () => {
    const result = python(["mutation.py"]);
    expect(result.stdout).toContain("PASS reference implementation passes the hidden tests");
    expect(result.stdout).not.toContain("SURVIVED");
    expect(result.status).toBe(0);
  }, 120_000);
});

describe("ac26-w4-arithmetization: /verify contract", () => {
  it.each(CHECKPOINTS)(
    "should accept the reference submission on %s",
    (checkpoint) => {
      expect(evaluate(checkpoint, bundle("reference"))).toBe(true);
    },
    120_000,
  );

  it.each(CHECKPOINTS)(
    "should reject the starter submission on %s",
    (checkpoint) => {
      expect(evaluate(checkpoint, bundle("starter"))).toBe(false);
    },
    120_000,
  );

  // The two that produce a system which looks complete and is not.
  it("should reject a residual evaluator that checks only the last transition", () => {
    const source = bundle("reference").replace(
      "    for index in range(len(trace) - 1):\n        a, b = trace[index]",
      "    for index in range(len(trace) - 2, len(trace) - 1):\n        a, b = trace[index]",
    );
    expect(evaluate("transition", source)).toBe(false);
  }, 120_000);

  it("should reject an implementation with no boundary constraints", () => {
    const source = bundle("reference").replace(
      "    return [(trace[0][0] - start_a) % p, (trace[0][1] - start_b) % p]",
      "    return [0, 0]",
    );
    expect(evaluate("boundary", source)).toBe(false);
  }, 120_000);

  // The i-th transition produces row i+1, so reporting i points one row away.
  it("should reject a violation reported at the row it came from", () => {
    const source = bundle("reference").replace(
      '            return {"row": index + 1, "kind": "transition"}',
      '            return {"row": index, "kind": "transition"}',
    );
    expect(evaluate("locate", source)).toBe(false);
  }, 120_000);

  it("should reject interpolation done over the integers", () => {
    const source = bundle("reference").replace(
      "        scale = values[index] * pow(denominator, -1, p) % p",
      "        scale = values[index] // denominator if denominator else 0",
    );
    expect(evaluate("interpolate", source)).toBe(false);
  }, 120_000);

  it("should reject an underconstrained witness that is just the honest trace", () => {
    const source = bundle("reference").replace(
      '    forged["start"] = ((start_a + 1) % p, start_b)',
      '    forged["start"] = (start_a, start_b)',
    );
    expect(evaluate("underconstrained", source)).toBe(false);
  }, 120_000);

  it("should reject a submission that hangs, rather than hanging itself", () => {
    expect(
      evaluate("trace", "def execute(setting):\n    while True:\n        pass\n"),
    ).toBe(false);
  }, 60_000);

  it("should reject a submission that cannot even be imported", () => {
    expect(evaluate("trace", "def execute(:\n")).toBe(false);
  }, 60_000);

  it("should reject an unknown checkpoint id instead of crediting it", () => {
    expect(evaluate("finish-week4", bundle("reference"))).toBe(false);
  });

  it("should echo the checkpointId so the platform can fail closed", () => {
    expect(read("local/verifier/server.py")).toContain(
      '{"checkpointId": checkpoint_id, "correct": correct}',
    );
  });
});

describe("ac26-w4-arithmetization: metadata contracts", () => {
  function metadata() {
    return JSON.parse(read("metadata.json")) as {
      difficulty: number;
      status: string;
      courseAlignment: { week: number; role: string; sources?: Array<{ kind: string; ref: string }> };
      scoring: {
        kind: string;
        checks: Array<{ id: string; points: number; hints?: Array<{ penalty: number }> }>;
      };
    };
  }

  it("should total the Hard tier's 300 points across its checkpoints", () => {
    const meta = metadata();
    expect(meta.scoring.kind).toBe("multi-verify");
    expect(meta.difficulty).toBe(4);
    expect(meta.scoring.checks.reduce((sum, check) => sum + check.points, 0)).toBe(300);
    for (const check of meta.scoring.checks) {
      const penalty = (check.hints ?? []).reduce((sum, hint) => sum + hint.penalty, 0);
      expect(penalty).toBeLessThanOrEqual(check.points / 2);
    }
  });

  it("should score exactly the checkpoints the verifier implements", () => {
    expect(metadata().scoring.checks.map((check) => check.id)).toEqual([...CHECKPOINTS]);
  });

  // Week 4's lecture (slides + README) was published upstream on 2026-08-18, so the
  // pin moved from the placeholder to the real material. The official exercise is
  // still WIP in that README, so the role stays `transfer` (it carries the lecture's
  // idea into a different setting) rather than `assignment-companion`.
  it("should pin week 4's published lecture and keep a role that claims no assignment", () => {
    const { courseAlignment, status } = metadata();
    expect(courseAlignment.week).toBe(4);
    expect(["diagnostic", "transfer"]).toContain(courseAlignment.role);
    expect(courseAlignment.sources).toEqual([
      {
        repository: "zk-tokyo/advanced-cryptography-2026",
        ref: "c088f8e6f301dedcd80b6dd9c321a1cd83410637",
        path: "week4/README.md",
        kind: "lecture",
      },
      {
        repository: "zk-tokyo/advanced-cryptography-2026",
        ref: "c088f8e6f301dedcd80b6dd9c321a1cd83410637",
        path: "week4/acp-2026-week4-redacted.pdf",
        kind: "slide",
      },
    ]);
    expect(status).toBe("draft");
  });
});
