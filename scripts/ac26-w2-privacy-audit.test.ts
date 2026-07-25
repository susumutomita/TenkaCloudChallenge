import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import { parse as parseYaml } from "yaml";

/**
 * ac26-w2-privacy-audit is Week 2's transfer problem. The assertions that matter run its
 * Python for real: the starter fails, the reference clears every checkpoint, the mutation
 * suite kills every intended defect, and — the point of this problem — an auditor that
 * flags every run is rejected just as firmly as one that flags none. Python 3 is on
 * ubuntu-latest and the problem is stdlib-only.
 */

const ROOT = join(import.meta.dir, "..", "challenges", "ac26-w2-privacy-audit");
const LOCAL = join(ROOT, "local");
const SEED = "ci-fixed-seed";
const CHECKPOINTS = [
  "allowed-opens",
  "opened-secret",
  "cross-party",
  "log-leak",
  "transcript",
  "repair",
  "mutation",
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
  return read(`local/${dir}/auditor.py`);
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

describe("ac26-w2-privacy-audit: participant contract", () => {
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
      "local/tests/public/test_auditor.py",
      "local/tests/hidden/check_auditor.py",
      "local/verifier/server.py",
      "local/starter/auditor.py",
      "local/reference/auditor.py",
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

describe("ac26-w2-privacy-audit: container safety", () => {
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
});

describe("ac26-w2-privacy-audit: the programs are indistinguishable by output", () => {
  // The premise of the whole problem: correctness cannot separate these implementations.
  // If one of them ever returned a different total, the audit would be unnecessary.
  it("should have every implementation return the same, correct total", () => {
    const script = [
      "import sys",
      "sys.path.insert(0, '.')",
      "from fixtures.generate import PROGRAM_IDS, execute, expected_total, program, spec",
      "sp = spec(sys.argv[1])",
      "totals = {execute(program(sp, pid), sp).output for pid in PROGRAM_IDS}",
      "print(len(totals), totals == {expected_total(sp)})",
    ].join("\n");
    expect(python(["-c", script, SEED]).stdout.trim()).toBe("1 True");
  });

  it("should mix leaking and clean implementations, so neither extreme auditor passes", () => {
    const script = [
      "import sys",
      "sys.path.insert(0, '.')",
      "from fixtures.generate import TRUTH",
      "clean = sum(1 for v in TRUTH.values() if v is None)",
      "leaky = sum(1 for v in TRUTH.values() if v is not None)",
      "print(clean, leaky, len(set(v for v in TRUTH.values() if v)))",
    ].join("\n");
    expect(python(["-c", script]).stdout.trim()).toBe("3 4 4");
  });
});

describe("ac26-w2-privacy-audit: fixtures are seed-derived", () => {
  it("should produce different specifications for different seeds", () => {
    const script = [
      "import json, sys",
      "sys.path.insert(0, '.')",
      "from fixtures.generate import health_token, spec",
      "sp = spec(sys.argv[1])",
      "print(json.dumps({'p': sp.p, 'w': sp.weights, 'x': sp.private, 't': health_token(sys.argv[1])}))",
    ].join("\n");
    const first = python(["-c", script, "seed-alpha"]).stdout.trim();
    const second = python(["-c", script, "seed-beta"]).stdout.trim();
    const again = python(["-c", script, "seed-alpha"]).stdout.trim();

    expect(first).not.toBe(second);
    expect(first).toBe(again);
  });

  it("should keep every public weight invertible, so the counterexample is reachable", () => {
    const script = [
      "import sys",
      "sys.path.insert(0, '.')",
      "from fixtures.generate import spec",
      "bad = 0",
      "for i in range(120):",
      "    sp = spec('s%d' % i)",
      "    if any(w % sp.p == 0 for w in sp.weights.values()):",
      "        bad += 1",
      "print(bad)",
    ].join("\n");
    expect(python(["-c", script]).stdout.trim()).toBe("0");
  });
});

describe("ac26-w2-privacy-audit: the problem is solvable and actually fails", () => {
  it("should fail the public tests in the shipped starter state", () => {
    const result = python(["tests/public/test_auditor.py"]);
    expect(result.status).not.toBe(0);
    expect(result.stdout).toContain("failed");
  });

  it("should kill every intended defect in the mutation suite", () => {
    const result = python(["mutation.py"]);
    expect(result.stdout).toContain("PASS reference implementation passes the hidden tests");
    expect(result.stdout).not.toContain("SURVIVED");
    expect(result.status).toBe(0);
  });
});

describe("ac26-w2-privacy-audit: /verify contract", () => {
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

  // The two ways to "audit" without auditing. Both must fail on every checkpoint that
  // feeds a program, which is every checkpoint that consumes first_violation.
  const VIOLATION_CHECKPOINTS = ["opened-secret", "cross-party", "log-leak", "mutation"];

  it.each(VIOLATION_CHECKPOINTS)(
    "should reject an auditor that never reports anything on %s",
    (checkpoint) => {
      const source = `${bundle("reference")}\n\ndef first_violation(trace, spec):\n    return None\n`;
      expect(evaluate(checkpoint, source)).toBe(false);
    },
    120_000,
  );

  it.each(VIOLATION_CHECKPOINTS)(
    "should reject an auditor that condemns every run on %s",
    (checkpoint) => {
      const source = [
        bundle("reference"),
        "",
        "def first_violation(trace, spec):",
        "    return {'kind': 'opened-a-secret', 'index': 0}",
        "",
      ].join("\n");
      expect(evaluate(checkpoint, source)).toBe(false);
    },
    120_000,
  );

  // Naming the violation without locating it is half an answer, and the half that does
  // not help anyone fix it.
  it("should reject an auditor that names the violation but not its position", () => {
    const source = bundle("reference").replace(/"index": index/g, '"index": 0');
    expect(source).toContain('"index": 0');
    expect(evaluate("opened-secret", source)).toBe(false);
  }, 120_000);

  // "Delete every observation" is private and still correct, and is not a repair.
  it("should reject a repair that removes the legitimate observations too", () => {
    const source = bundle("reference").replace(
      'if kind == "open" and op[1] not in allowed:\n            continue',
      'if kind in ("open", "peek", "emit", "fail"):\n            continue',
    );
    expect(source).toContain('if kind in ("open", "peek", "emit", "fail"):');
    expect(evaluate("repair", source)).toBe(false);
  }, 120_000);

  it("should reject a submission that hangs, rather than hanging itself", () => {
    expect(
      evaluate("allowed-opens", "def allowed_opens(spec):\n    while True:\n        pass\n"),
    ).toBe(false);
  }, 60_000);

  it("should reject a submission that cannot even be imported", () => {
    expect(evaluate("allowed-opens", "def allowed_opens(:\n")).toBe(false);
  }, 60_000);

  it("should reject an unknown checkpoint id instead of crediting it", () => {
    expect(evaluate("finish-week2", bundle("reference"))).toBe(false);
  });

  it("should echo the checkpointId so the platform can fail closed", () => {
    expect(read("local/verifier/server.py")).toContain(
      '{"checkpointId": checkpoint_id, "correct": correct}',
    );
  });
});

describe("ac26-w2-privacy-audit: metadata contracts", () => {
  function metadata() {
    return JSON.parse(read("metadata.json")) as {
      difficulty: number;
      status: string;
      courseAlignment: { week: number; role: string; sources?: Array<{ kind: string }> };
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
    // SCORING.md caps hints per checkpoint, not across the problem.
    for (const check of meta.scoring.checks) {
      const penalty = (check.hints ?? []).reduce((sum, hint) => sum + hint.penalty, 0);
      expect(penalty).toBeLessThanOrEqual(check.points / 2);
    }
  });

  it("should score exactly the checkpoints the verifier implements", () => {
    expect(metadata().scoring.checks.map((check) => check.id)).toEqual([...CHECKPOINTS]);
  });

  it("should pin week 2's placeholder rather than an alignment", () => {
    const { courseAlignment, status } = metadata();
    expect(courseAlignment.week).toBe(2);
    expect(courseAlignment.role).toBe("transfer");
    expect(courseAlignment.sources).toEqual([
      {
        repository: "zk-tokyo/advanced-cryptography-2026",
        ref: "5e80999306608a45aecf9a0e4e3394a0b62f34d2",
        path: "week2/README.md",
        kind: "placeholder",
      },
    ]);
    expect(status).toBe("draft");
  });
});
