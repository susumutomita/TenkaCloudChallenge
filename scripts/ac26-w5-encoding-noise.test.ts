import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import { parse as parseYaml } from "yaml";

/**
 * ac26-w5-encoding-noise is the first Week 5 problem and the one the rest of the week's
 * noise budget rests on. Two properties are asserted here rather than left to review.
 *
 * The first is that the generated parameter sets really do produce both parities of
 * `delta`. The tolerated noise interval is asymmetric when `delta` is even and symmetric
 * when it is odd; if the generator only ever drew one parity, half the problem would
 * silently stop being tested.
 *
 * The second is that the interval `success_interval` reports is exact — every message
 * survives inside it and no message survives one step outside — checked against the
 * fixtures rather than against any implementation of `decode`. A measured interval agrees
 * with whatever decoder measured it, which is the failure mode the whole checkpoint split
 * exists to prevent.
 *
 * Python 3 is on ubuntu-latest and the problem is stdlib-only.
 */

const ROOT = join(import.meta.dir, "..", "challenges", "ac26-w5-encoding-noise");
const LOCAL = join(ROOT, "local");
const SEED = "ci-fixed-seed";
const CHECKPOINTS = [
  "encode",
  "noise",
  "decode",
  "interval",
  "first-failure",
  "transfer",
  "validate",
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
  return read(`local/${dir}/encoding.py`);
}

/** Last stdout line of a stdlib-only snippet run inside local/. */
function probe(lines: string[]): string {
  const result = python(["-c", ["import sys", "sys.path.insert(0, '.')", ...lines].join("\n")]);
  expect(result.stderr).toBe("");
  expect(result.status).toBe(0);
  return result.stdout.trim().split("\n").at(-1) ?? "";
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

describe("ac26-w5-encoding-noise: participant contract", () => {
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
      "local/tests/public/test_encoding.py",
      "local/tests/hidden/check_encoding.py",
      "local/verifier/server.py",
      "local/starter/encoding.py",
      "local/reference/encoding.py",
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

describe("ac26-w5-encoding-noise: container safety", () => {
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

describe("ac26-w5-encoding-noise: the generated parameters exercise both cases", () => {
  // The interval is asymmetric for even delta and symmetric for odd. A generator that
  // only ever drew one parity would let half the problem go untested forever.
  it("should draw both parities of delta", () => {
    const answer = probe([
      "from fixtures.generate import params",
      "deltas = [params('s', f'L{i}')['delta'] for i in range(40)]",
      "print(any(d % 2 for d in deltas), any(d % 2 == 0 for d in deltas))",
    ]);
    expect(answer).toBe("True True");
  });

  it("should keep every generated set consistent, so q = p * delta always holds", () => {
    const answer = probe([
      "from fixtures.generate import params",
      "sets = [params('s', f'L{i}') for i in range(40)]",
      "print(all(x['q'] == x['p'] * x['delta'] and x['p'] >= 2 and x['delta'] >= 1 for x in sets))",
    ]);
    expect(answer).toBe("True");
  });

  // Small enough to enumerate by hand is the whole reason the boundary is visible. It is
  // also what makes the hidden suite's full-ring sweeps affordable.
  it("should keep every ring small enough to enumerate", () => {
    const answer = probe([
      "from fixtures.generate import params",
      "print(max(params('s', f'L{i}')['q'] for i in range(40)))",
    ]);
    expect(Number(answer)).toBeLessThanOrEqual(512);
  });
});

describe("ac26-w5-encoding-noise: the reported interval is exactly the tolerated one", () => {
  // Both halves matter. Only checking that messages survive inside would pass an interval
  // that is too narrow; only checking the outside would pass one that is too wide.
  it("should hold every message inside the interval and lose one at each edge", () => {
    const answer = probe([
      "import json",
      "from fixtures.generate import decode, encode, params, success_interval",
      "bad = []",
      "for i in range(40):",
      "    par = params('s', f'L{i}')",
      "    low, high = success_interval(par)",
      "    for m in range(par['p']):",
      "        base = encode(par, m)",
      "        inside = all(decode(par, (base + e) % par['q']) == m for e in range(low, high + 1))",
      "        edges = all(decode(par, (base + e) % par['q']) != m for e in (low - 1, high + 1))",
      "        if not (inside and edges):",
      "            bad.append([par, m, inside, edges])",
      "print(json.dumps(bad))",
    ]);
    expect(JSON.parse(answer)).toEqual([]);
  });

  it("should make the interval exactly delta wide, whatever the parity", () => {
    const answer = probe([
      "from fixtures.generate import params, success_interval",
      "sets = [params('s', f'L{i}') for i in range(40)]",
      "print(all(high - low + 1 == x['delta'] for x in sets for low, high in [success_interval(x)]))",
    ]);
    expect(answer).toBe("True");
  });

  it("should be asymmetric for even delta and symmetric for odd", () => {
    const answer = probe([
      "from fixtures.generate import params, success_interval",
      "ok = True",
      "for i in range(40):",
      "    x = params('s', f'L{i}')",
      "    low, high = success_interval(x)",
      "    ok = ok and ((low == -high) == bool(x['delta'] % 2))",
      "print(ok)",
    ]);
    expect(answer).toBe("True");
  });
});

describe("ac26-w5-encoding-noise: the rejects are stated, not constructed by the learner", () => {
  it("should define the invalid parameter sets outside the submission", () => {
    expect(read("local/fixtures/generate.py")).toContain("INVALID_PARAMS");
    expect(bundle("starter")).not.toContain("INVALID_PARAMS");
    expect(bundle("reference")).not.toContain("INVALID_PARAMS");
  });

  // delta = 1 is a usable parameter set that tolerates no noise at all. An over-eager
  // validator rejects it, so it is in the accept list on purpose.
  it("should require the degenerate but usable delta = 1 to be accepted", () => {
    const answer = probe([
      "from fixtures.generate import VALID_PARAMS",
      "print(any(x['delta'] == 1 for x in VALID_PARAMS))",
    ]);
    expect(answer).toBe("True");
  });
});

describe("ac26-w5-encoding-noise: the problem is solvable and actually fails", () => {
  it("should fail the public tests in the shipped starter state", () => {
    const result = python(["tests/public/test_encoding.py"]);
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

describe("ac26-w5-encoding-noise: /verify contract", () => {
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

  // Each of these decodes every exact encoding point correctly, which is the property a
  // learner checks first.
  it("should reject a decoder that floors instead of rounding to nearest", () => {
    const source = bundle("reference").replace(
      '    return ((c % params["q"]) + delta // 2) // delta % params["p"]',
      '    return (c % params["q"]) // delta % params["p"]',
    );
    expect(evaluate("decode", source)).toBe(false);
  }, 120_000);

  it("should reject the symmetric interval, which ignores the tie rule", () => {
    const source = bundle("reference").replace(
      "    return (-(delta // 2), delta - delta // 2 - 1)",
      "    return (-(delta // 2), delta // 2)",
    );
    expect(evaluate("interval", source)).toBe(false);
  }, 120_000);

  it("should reject taking the absolute value of the noise", () => {
    const source = bundle("reference").replace(
      '    return (c + e) % params["q"]',
      '    return (c + abs(e)) % params["q"]',
    );
    expect(evaluate("noise", source)).toBe(false);
  }, 120_000);

  it("should reject a failing message that is not wrapped modulo p", () => {
    const source = bundle("reference").replace(
      "    noise = high + 1 if direction > 0 else low - 1\n"
        + "    return (noise, decode(params, add_noise(params, encode(params, m), noise)))",
      "    noise = high + 1 if direction > 0 else low - 1\n"
        + "    return (noise, m + 1 if direction > 0 else m - 1)",
    );
    expect(evaluate("first-failure", source)).toBe(false);
  }, 120_000);

  it("should reject a validator that accepts a q which is not p * delta", () => {
    const source = bundle("reference").replace(
      '    if not failures and q != p * delta:\n'
        + '        failures.append("q must equal p * delta, or the encoding points do not tile the ring")',
      "    pass",
    );
    expect(evaluate("validate", source)).toBe(false);
  }, 120_000);

  // The transfer checkpoint runs under a derived seed, so a submission that memorized one
  // parameter set fails it while passing everything else.
  it("should run transfer under parameters no other checkpoint used", () => {
    expect(read("local/verifier/server.py")).toContain('f"{SEED}:transfer"');
  });

  it("should reject a submission that hangs, rather than hanging itself", () => {
    expect(evaluate("encode", "def encode(params, m):\n    while True:\n        pass\n")).toBe(
      false,
    );
  }, 60_000);

  it("should reject a submission that cannot even be imported", () => {
    expect(evaluate("encode", "def encode(:\n")).toBe(false);
  }, 60_000);

  it("should reject an unknown checkpoint id instead of crediting it", () => {
    expect(evaluate("noise-budget", bundle("reference"))).toBe(false);
  });

  it("should echo the checkpointId so the platform can fail closed", () => {
    expect(read("local/verifier/server.py")).toContain(
      '{"checkpointId": checkpoint_id, "correct": correct}',
    );
  });
});

describe("ac26-w5-encoding-noise: metadata contracts", () => {
  function metadata() {
    return JSON.parse(read("metadata.json")) as {
      difficulty: number;
      status: string;
      courseAlignment: {
        week: number;
        role: string;
        spoilerPolicy: string;
        sources?: Array<{ kind: string; ref: string; path: string }>;
      };
      scoring: {
        kind: string;
        checks: Array<{ id: string; points: number; hints?: Array<{ penalty: number }> }>;
      };
    };
  }

  it("should total the Medium tier's 200 points across its checkpoints", () => {
    const meta = metadata();
    expect(meta.scoring.kind).toBe("multi-verify");
    expect(meta.difficulty).toBe(3);
    expect(meta.scoring.checks.reduce((sum, check) => sum + check.points, 0)).toBe(200);
    for (const check of meta.scoring.checks) {
      const penalty = (check.hints ?? []).reduce((sum, hint) => sum + hint.penalty, 0);
      expect(penalty).toBeLessThanOrEqual(check.points / 2);
    }
  });

  it("should score exactly the checkpoints the verifier implements", () => {
    expect(metadata().scoring.checks.map((check) => check.id)).toEqual([...CHECKPOINTS]);
  });

  // Week 5 IS published upstream, unlike Weeks 2 and 4. So this pins the real lecture and
  // assignment paths rather than a placeholder, and the role is not restricted by
  // GOVERNANCE.md section 6.
  it("should pin week 5's real lecture and assignment, not a placeholder", () => {
    const { courseAlignment, status } = metadata();
    expect(courseAlignment.week).toBe(5);
    expect(courseAlignment.role).toBe("mechanism");
    const sources = courseAlignment.sources ?? [];
    expect(sources.map((source) => source.kind).sort()).toEqual(["assignment", "lecture"]);
    for (const source of sources) {
      expect(source.kind).not.toBe("placeholder");
      expect(source.ref).toMatch(/^[0-9a-f]{40}$/);
      expect(source.path.startsWith("week5/")).toBe(true);
    }
    expect(status).toBe("draft");
  });

  // The parameters are generated from the seed and the encoding rule is stated in the
  // problem text, so nothing is taken from the official exercise.
  it("should declare the independent-reimplementation spoiler policy", () => {
    expect(metadata().courseAlignment.spoilerPolicy).toBe("independent-reimplementation");
  });
});
