import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import { parse as parseYaml } from "yaml";

/**
 * ac26-w2-secret-sharing is the first Week 1 problem. The interesting assertions run its
 * Python for real — the starter fails, the reference passes every checkpoint, the mutation
 * suite kills every intended defect, and /verify holds its security contract — rather than
 * reading source text. Python 3 is on ubuntu-latest and the problem is stdlib-only.
 */

const ROOT = join(import.meta.dir, "..", "challenges", "ac26-w2-secret-sharing");
const LOCAL = join(ROOT, "local");
const SEED = "ci-fixed-seed";
const SUBMITTED = ["sharing.py"] as const;

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
  return read(`local/${dir}/sharing.py`);
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

describe("ac26-w2-secret-sharing: participant contract", () => {
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
      "local/tests/public/test_sharing.py",
      "local/tests/hidden/check_sharing.py",
      "local/verifier/server.py",
      "local/starter/sharing.py",
      "local/reference/sharing.py",
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

describe("ac26-w2-secret-sharing: container safety", () => {
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

describe("ac26-w2-secret-sharing: fixtures are seed-derived", () => {
  it("should produce different circuits for different seeds", () => {
    const script = [
      "import json, sys",
      "sys.path.insert(0, '.')",
      "from fixtures.generate import setting, reference_shares, health_token",
      "seed = sys.argv[1]",
      "print(json.dumps({'s': setting(seed), 'r': reference_shares(seed), 't': health_token(seed)}))",
    ].join("\n");
    const first = python(["-c", script, "seed-alpha"]).stdout.trim();
    const second = python(["-c", script, "seed-beta"]).stdout.trim();
    const again = python(["-c", script, "seed-alpha"]).stdout.trim();

    expect(first).not.toBe(second);
    expect(first).toBe(again);
  });

  it("should vary the party count across seeds, so n is never assumed", () => {
    const script = [
      "import sys",
      "sys.path.insert(0, '.')",
      "from fixtures.generate import setting",
      "print(','.join(str(setting('s%d' % i)['n']) for i in range(40)))",
    ].join("\n");
    const counts = new Set(python(["-c", script]).stdout.trim().split(","));
    expect(counts.size).toBeGreaterThan(2);
  });
});

describe("ac26-w2-secret-sharing: the problem is solvable and actually fails", () => {
  it("should fail the public tests in the shipped starter state", () => {
    const result = python(["tests/public/test_sharing.py"]);
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

describe("ac26-w2-secret-sharing: /verify contract", () => {
  it.each(["share-and-reconstruct", "hides-the-secret", "rerandomize", "transfer"])(
    "should accept the reference submission on %s",
    (checkpoint) => {
      expect(evaluate(checkpoint, bundle("reference"))).toBe(true);
    },
    120_000,
  );

  it.each(["share-and-reconstruct", "hides-the-secret", "rerandomize", "transfer"])(
    "should reject the starter submission on %s",
    (checkpoint) => {
      expect(evaluate(checkpoint, bundle("starter"))).toBe(false);
    },
    120_000,
  );

  it("should reject a submission that hangs, rather than hanging itself", () => {
    expect(
      evaluate("share-and-reconstruct", "def share(s, n, p, r):\n    while True:\n        pass\n"),
    ).toBe(false);
  }, 60_000);

  it("should reject an unknown checkpoint id instead of crediting it", () => {
    expect(evaluate("finish-week2", bundle("reference"))).toBe(false);
  });

  it("should reject a threshold answer that names the count but shows no witnesses", () => {
    expect(evaluate("threshold", '{"sharesNeeded": 3, "partial": [1, 2], "completions": []}')).toBe(
      false,
    );
  });

  // Two witnesses carrying the SAME secret demonstrate nothing about independence, and
  // are the most likely way to "pass" this checkpoint without understanding it.
  it("should reject two witnesses that agree on the secret", () => {
    const script = [
      "import json, sys",
      "sys.path.insert(0, '.')",
      "from fixtures.generate import setting",
      "cfg = setting(sys.argv[1]); p = cfg['p']; n = cfg['n']",
      "head = [1] * (n - 1)",
      "last = (7 - sum(head)) % p",
      "print(json.dumps({'sharesNeeded': n, 'partial': head, 'completions': [",
      "  {'secret': 7, 'lastShare': last}, {'secret': 7, 'lastShare': last}]}))",
    ].join("\n");
    expect(evaluate("threshold", python(["-c", script, SEED]).stdout.trim())).toBe(false);
  });

  it("should reject an unknown checkpoint id instead of crediting it", () => {
    expect(evaluate("finish-week2", bundle("reference"))).toBe(false);
  });

  it("should reject a root cause that names the wrong constraint", () => {
    expect(
      evaluate("root-cause", '{"missingConstraintId": "c-grant", "manipulatedSignals": []}'),
    ).toBe(false);
  });

  // A forgery that also satisfies the intended circuit demonstrates nothing, and is the
  // single most likely way to "pass" the exploit checkpoint without understanding it.
  it("should reject a forgery that satisfies the intended circuit too", () => {
    const source = [
      "def intended_circuit():",
      "    return []",
      "def audit(circuit):",
      "    return []",
      "def forge_witness(circuit, params):",
      "    p = params['p']; r = params['revoked'] % p",
      "    inv = pow(r, -1, p) if r else 0",
      "    return {'revoked': r, 'inv': inv, 'ok': 0, 'issuer_ok': params['issuer_ok'], 'granted': 0}",
      "def repair(circuit):",
      "    return list(circuit)",
    ].join("\n");
    expect(evaluate("exploit", source)).toBe(false);
  });

  it("should echo the checkpointId so the platform can fail closed", () => {
    expect(read("local/verifier/server.py")).toContain(
      '{"checkpointId": checkpoint_id, "correct": correct}',
    );
  });
});

describe("ac26-w2-secret-sharing: metadata contracts", () => {
  function metadata() {
    return JSON.parse(read("metadata.json")) as {
      difficulty: number;
      status: string;
      courseAlignment: { week: number; role: string; sources?: Array<{ ref: string }> };
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

  // Week 2 was unpublished upstream at the recorded commit, so there is nothing to point
  // at. The absence of `sources` is deliberate; inventing a SHA would fabricate a pin.
  // Asserted so nobody later "fixes" it with a made-up value.
  it("should declare the week and role but pin no upstream source", () => {
    const { courseAlignment, status } = metadata();
    expect(courseAlignment.week).toBe(2);
    expect(courseAlignment.role).toBe("mechanism");
    expect(courseAlignment.sources).toBeUndefined();
    expect(status).toBe("draft");
  });
});
