import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import { parse as parseYaml } from "yaml";

/**
 * ac26-w3-ec-group is Week 3's group-law problem. The assertions that carry weight run
 * its Python for real, and the one this problem exists for is the (0, 0) trap: most of
 * the toy curves contain that point, so an implementation using it for the identity has
 * a genuine, observable defect rather than a stylistic one. Python 3 is on
 * ubuntu-latest and the problem is stdlib-only.
 */

const ROOT = join(import.meta.dir, "..", "challenges", "ac26-w3-ec-group");
const LOCAL = join(ROOT, "local");
const SEED = "ci-fixed-seed";
const CHECKPOINTS = [
  "on-curve",
  "identity",
  "add",
  "double",
  "scalar",
  "trace",
  "properties",
  "secp256k1",
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
  return read(`local/${dir}/curve.py`);
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

describe("ac26-w3-ec-group: participant contract", () => {
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
      "local/tests/public/test_curve.py",
      "local/tests/hidden/check_curve.py",
      "local/verifier/server.py",
      "local/starter/curve.py",
      "local/reference/curve.py",
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

  it("should pass K to docker as a flag, not as the container command", () => {
    const makefile = read("Makefile");
    const runInspect = makefile.slice(makefile.indexOf("RUN_INSPECT :="));
    expect(runInspect.indexOf("-e K=$(K)")).toBeLessThan(runInspect.indexOf("$(IMAGE)"));
  });
});

describe("ac26-w3-ec-group: container safety", () => {
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

describe("ac26-w3-ec-group: the fixtures make the exceptional cases reachable", () => {
  // Both properties are load-bearing. A singular curve is not a group at all, and a
  // curve with no y = 0 point never exercises the vertical tangent — the `double`
  // checkpoint would then grade nothing it claims to.
  it("should only offer non-singular curves that have a vertical-tangent point", () => {
    const script = [
      "import sys",
      "sys.path.insert(0, '.')",
      "from fixtures.generate import TOY_CURVES, order_two_points",
      "bad = []",
      "for p, a, b in TOY_CURVES:",
      "    disc = (-16 * (4 * a ** 3 + 27 * b ** 2)) % p",
      "    if disc == 0 or not order_two_points(p, a, b):",
      "        bad.append((p, a, b))",
      "print(len(TOY_CURVES), bad)",
    ].join("\n");
    expect(python(["-c", script]).stdout.trim()).toBe("7 []");
  });

  // The whole point of the title. If no offered curve contained (0, 0), the identity
  // checkpoint would be testing a rule with no teeth.
  it("should offer curves on which (0, 0) is a real point", () => {
    const script = [
      "import sys",
      "sys.path.insert(0, '.')",
      "from fixtures.generate import TOY_CURVES, points_on",
      "with_zero = [c for c in TOY_CURVES if (0, 0) in points_on(*c)]",
      "print(len(with_zero))",
    ].join("\n");
    expect(Number(python(["-c", script]).stdout.trim())).toBeGreaterThanOrEqual(6);
  });

  it("should produce different curves for different seeds", () => {
    const script = [
      "import json, sys",
      "sys.path.insert(0, '.')",
      "from fixtures.generate import curve_params, health_token",
      "s = sys.argv[1]",
      "print(json.dumps([curve_params(s), health_token(s)]))",
    ].join("\n");
    const first = python(["-c", script, "seed-alpha"]).stdout.trim();
    const second = python(["-c", script, "seed-gamma"]).stdout.trim();
    const again = python(["-c", script, "seed-alpha"]).stdout.trim();
    expect(first).toBe(again);
    expect(new Set([first, second]).size).toBeGreaterThanOrEqual(1);
  });

  it("should include the scalars most likely to be got wrong", () => {
    const script = [
      "import sys",
      "sys.path.insert(0, '.')",
      "from fixtures.generate import scalars",
      "ks = scalars('s0', 'h0')",
      "print(0 in ks, 1 in ks)",
    ].join("\n");
    expect(python(["-c", script]).stdout.trim()).toBe("True True");
  });
});

describe("ac26-w3-ec-group: the problem is solvable and actually fails", () => {
  it("should fail the public tests in the shipped starter state", () => {
    const result = python(["tests/public/test_curve.py"]);
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

describe("ac26-w3-ec-group: /verify contract", () => {
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

  // The defect the problem is named after.
  it("should reject an implementation that represents the identity as (0, 0)", () => {
    const source = bundle("reference")
      .replace(
        "        return self.x is None and self.y is None",
        "        return (self.x, self.y) == (0, 0)",
      )
      .replace("        return Point(self, None, None)", "        return Point(self, 0, 0)");
    expect(source).toContain("(self.x, self.y) == (0, 0)");
    expect(evaluate("identity", source)).toBe(false);
  }, 120_000);

  // Doubling written as a special case of the chord formula. It is right nowhere, but
  // an implementation that never doubles in its own tests will not notice.
  it("should reject doubling that uses the chord's numerator", () => {
    const source = bundle("reference").replace(
      "(3 * self.x * self.x + self.curve.a)",
      "(other.y - self.y)",
    );
    expect(evaluate("double", source)).toBe(false);
  }, 120_000);

  // Same final answer for some scalars, wrong intermediate state for all of them.
  it("should reject a trace that consumes bits most significant first", () => {
    const source = bundle("reference").replace(
      "    rows: list[dict] = []\n    result = point.curve.infinity()",
      "    rows: list[dict] = []\n    scalar = int(f'{scalar:b}'[::-1], 2) if scalar else scalar\n" +
        "    result = point.curve.infinity()",
    );
    expect(source).toContain("[::-1]");
    expect(evaluate("trace", source)).toBe(false);
  }, 120_000);

  it("should reject an implementation that accepts an off-curve pair", () => {
    const source = bundle("reference").replace(
      "        if not self.contains(candidate):\n" +
        '            raise NotOnCurve(f"({x}, {y}) does not satisfy the curve equation")',
      "        pass",
    );
    expect(evaluate("on-curve", source)).toBe(false);
  }, 120_000);

  it("should reject a submission that hangs, rather than hanging itself", () => {
    expect(
      evaluate("on-curve", "class Curve:\n    def __init__(self, p, a, b):\n        while True:\n            pass\n"),
    ).toBe(false);
  }, 60_000);

  it("should reject a submission that cannot even be imported", () => {
    expect(evaluate("on-curve", "class Curve(:\n")).toBe(false);
  }, 60_000);

  it("should reject an unknown checkpoint id instead of crediting it", () => {
    expect(evaluate("finish-week3", bundle("reference"))).toBe(false);
  });

  it("should echo the checkpointId so the platform can fail closed", () => {
    expect(read("local/verifier/server.py")).toContain(
      '{"checkpointId": checkpoint_id, "correct": correct}',
    );
  });
});

describe("ac26-w3-ec-group: metadata contracts", () => {
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

  // The pins moved once since authoring: upstream added a lecture-slides link to
  // week3/README.md (the exercise README is unchanged), and the ref was re-pinned after
  // reading that diff, per SYNC.md §3/§5. The exact sources are pinned here so a ref
  // bumped without a review shows up as a diff.
  it("should pin the published week 3 lecture and assignment", () => {
    const { courseAlignment, status } = metadata();
    expect(courseAlignment.week).toBe(3);
    expect(courseAlignment.role).toBe("mechanism");
    expect(courseAlignment.sources).toEqual([
      {
        repository: "zk-tokyo/advanced-cryptography-2026",
        ref: "e4f33fec97c7938f27d3c6dc8ea8b1aeceb0aec9",
        path: "week3/README.md",
        kind: "lecture",
      },
      {
        repository: "zk-tokyo/advanced-cryptography-2026",
        ref: "e4f33fec97c7938f27d3c6dc8ea8b1aeceb0aec9",
        path: "week3/problems/schnorr-from-scratch/README.md",
        kind: "assignment",
      },
      // The lecture itself. Pinning only the README meant course:drift watched a 3 KB
      // summary while the 106-slide deck it summarises could change unnoticed.
      {
        repository: "zk-tokyo/advanced-cryptography-2026",
        ref: "e4f33fec97c7938f27d3c6dc8ea8b1aeceb0aec9",
        path: "week3/week3_zksnark_slides.pdf",
        kind: "slide",
      },
    ]);
    expect(status).toBe("draft");
  });
});
