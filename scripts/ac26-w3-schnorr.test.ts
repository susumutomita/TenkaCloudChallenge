import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import { parse as parseYaml } from "yaml";

/**
 * ac26-w3-schnorr is Week 3's assignment-companion. Its sharpest assertions cover the
 * defects that sign and verify perfectly and are broken only against an attacker:
 * a challenge missing one of its binding inputs, and an encoding with two readings.
 * Python 3 is on ubuntu-latest and the problem is stdlib-only.
 */

const ROOT = join(import.meta.dir, "..", "challenges", "ac26-w3-schnorr");
const LOCAL = join(ROOT, "local");
const SEED = "ci-fixed-seed";
const CHECKPOINTS = [
  "keygen",
  "sigma",
  "transcript",
  "serialization",
  "fiat-shamir",
  "sign-verify",
  "cross-protocol",
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
  return read(`local/${dir}/schnorr.py`);
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

/** Drop one field from the challenge preimage. Signing and verifying still work. */
function withoutPreimageField(field: string): string {
  const source = bundle("reference");
  const lines: Record<string, string> = {
    domain: '            len(domain_bytes).to_bytes(4, "big"),\n            domain_bytes,\n',
    message: '            len(message).to_bytes(4, "big"),\n            message,\n',
    commitment: "            encode_point(commitment, group),\n",
    key: "            encode_point(public, group),\n",
  };
  const removed = source.replace(lines[field], "");
  expect(removed).not.toBe(source);
  return removed;
}

describe("ac26-w3-schnorr: participant contract", () => {
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
      "local/tests/public/test_schnorr.py",
      "local/tests/hidden/check_schnorr.py",
      "local/verifier/server.py",
      "local/starter/schnorr.py",
      "local/reference/schnorr.py",
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

  // The two values the protocol exists to protect. A lab that prints them teaches the
  // opposite of its own lesson.
  it("should never print the secret key or the nonce", () => {
    const output = python(["show.py"]).stdout;
    const script = [
      "import sys",
      "sys.path.insert(0, '.')",
      "from fixtures.generate import nonce, secret_key, toy_group",
      "g = toy_group(sys.argv[1])",
      "print(secret_key(sys.argv[1], 'public', g), nonce(sys.argv[1], 'public', g))",
    ].join("\n");
    const [secret, nonceValue] = python(["-c", script, SEED]).stdout.trim().split(" ");
    const printedNumbers = new Set(output.match(/\b\d+\b/g) ?? []);
    expect(printedNumbers.has(secret)).toBe(false);
    expect(printedNumbers.has(nonceValue)).toBe(false);
  });
});

describe("ac26-w3-schnorr: container safety", () => {
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

describe("ac26-w3-schnorr: the groups are what they claim to be", () => {
  // z = k + e*x mod n is only a sound response if n really is the generator's order and
  // is prime. A generator of smaller order would make the protocol quietly wrong.
  it("should offer only prime-order groups whose generator has exactly that order", () => {
    const script = [
      "import sys",
      "sys.path.insert(0, '.')",
      "from fixtures.generate import TOY_GROUPS, Group",
      "def is_prime(n):",
      "    return n > 1 and all(n % d for d in range(2, int(n ** 0.5) + 1))",
      "bad = []",
      "for params in TOY_GROUPS:",
      "    g = Group(*params)",
      "    on_curve = g.contains(g.generator)",
      "    kills = g.generator.scalar_mul(g.n).is_infinity",
      "    exact = all(not g.generator.scalar_mul(d).is_infinity for d in range(1, g.n))",
      "    if not (on_curve and kills and exact and is_prime(g.n)):",
      "        bad.append(params)",
      "print(len(TOY_GROUPS), bad)",
    ].join("\n");
    expect(python(["-c", script]).stdout.trim()).toBe("5 []");
  });

  it("should use the real secp256k1 order, so nG is the identity", () => {
    const script = [
      "import sys",
      "sys.path.insert(0, '.')",
      "from fixtures.generate import secp_group",
      "g = secp_group()",
      "print(g.contains(g.generator), g.generator.scalar_mul(g.n).is_infinity)",
    ].join("\n");
    expect(python(["-c", script]).stdout.trim()).toBe("True True");
  });

  // The weakened challenge belongs to the fixtures, not to the submission: attacking
  // your own deliberately weakened code proves nothing.
  it("should define the weak challenge outside the submission", () => {
    expect(read("local/fixtures/generate.py")).toContain("def weak_challenge(");
    expect(bundle("starter")).not.toContain("def weak_challenge(");
    expect(bundle("reference")).not.toContain("def weak_challenge(");
  });
});

describe("ac26-w3-schnorr: the problem is solvable and actually fails", () => {
  it("should fail the public tests in the shipped starter state", () => {
    const result = python(["tests/public/test_schnorr.py"]);
    expect(result.status).not.toBe(0);
    expect(result.stdout).toContain("failed");
  });

  // Ten mutants, each run through a suite that includes secp256k1 scalar multiplication,
  // so this one legitimately needs more than bun's five-second default.
  it("should kill every intended defect in the mutation suite", () => {
    const result = python(["mutation.py"]);
    expect(result.stdout).toContain("PASS reference implementation passes the hidden tests");
    expect(result.stdout).not.toContain("SURVIVED");
    expect(result.status).toBe(0);
  }, 120_000);
});

describe("ac26-w3-schnorr: /verify contract", () => {
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

  // Each of these signs and verifies perfectly. They are broken only against somebody
  // trying, which is the entire lesson of the problem.
  it.each(["domain", "message", "commitment", "key"])(
    "should reject a challenge that leaves out %s",
    (field) => {
      const source = withoutPreimageField(field);
      expect(evaluate("fiat-shamir", source)).toBe(false);
    },
    120_000,
  );

  it("should reject an encoding whose variable-length fields have no lengths", () => {
    const source = bundle("reference")
      .replace('            len(domain_bytes).to_bytes(4, "big"),\n', "")
      .replace('            len(message).to_bytes(4, "big"),\n', "");
    expect(source).not.toContain('to_bytes(4, "big")');
    expect(evaluate("serialization", source)).toBe(false);
  }, 120_000);

  it("should reject a response reduced by the field modulus instead of the group order", () => {
    const source = bundle("reference").replace(
      "    return (nonce + challenge * secret) % group.n",
      "    return (nonce + challenge * secret) % group.p",
    );
    expect(evaluate("sigma", source)).toBe(false);
  }, 120_000);

  it("should reject an implementation that accepts the identity as a public key", () => {
    const source = bundle("reference").replace(
      "    return group.contains(point) and not point.is_infinity",
      "    return group.contains(point)",
    );
    expect(evaluate("keygen", source)).toBe(false);
  }, 120_000);

  it("should reject a submission that hangs, rather than hanging itself", () => {
    expect(
      evaluate("keygen", "def public_key(secret, group):\n    while True:\n        pass\n"),
    ).toBe(false);
  }, 60_000);

  it("should reject a submission that cannot even be imported", () => {
    expect(evaluate("keygen", "def public_key(:\n")).toBe(false);
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

describe("ac26-w3-schnorr: metadata contracts", () => {
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

  // ASSESSMENT.md: an assignment-companion must carry at least one predict or
  // counterexample checkpoint, because it sits closest to the official exercise and is
  // the easiest to accidentally turn into a walkthrough of it.
  it("should carry a counterexample checkpoint, as its role requires", () => {
    const meta = metadata();
    expect(meta.courseAlignment.role).toBe("assignment-companion");
    expect(meta.scoring.checks.map((check) => check.id)).toContain("cross-protocol");
  });

  it("should pin the published week 3 lecture and assignment", () => {
    const { courseAlignment, status } = metadata();
    expect(courseAlignment.week).toBe(3);
    expect(courseAlignment.sources?.map((source) => source.kind)).toEqual([
      "lecture",
      "assignment",
      // The lecture itself. Pinning only the README meant course:drift watched a 3 KB
      // summary while the 106-slide deck it summarises could change unnoticed.
      "slide",
    ]);
    for (const source of courseAlignment.sources ?? []) {
      expect(source.ref).toMatch(/^[0-9a-f]{40}$/);
    }
    expect(status).toBe("draft");
  });
});
