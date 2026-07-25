import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import { parse as parseYaml } from "yaml";

/**
 * ac26-w5-lwe-rlwe is the second Week 5 problem: the two constructions that carry a message
 * the way problem 510 described, which turn out to be one construction written twice.
 *
 * Three properties are asserted here rather than left to review.
 *
 * The first is that the generated parameter sets really do vary the ring degree AND keep it
 * different from the LWE dimension often enough to matter. An implementation that assumes
 * `degree == dimension` is wrong, and a generator that always drew them equal would never
 * say so.
 *
 * The second is that the negacyclic fold is periodic rather than one-way: `X^N = -1` and
 * `X^2N = +1`. This is the defect the encryption path structurally cannot reveal, because a
 * product of two ring elements reaches degree 2N-2 at most.
 *
 * The third is that the coefficient-vector identity behind the `correspondence` checkpoint
 * holds against the fixtures for every secret, and that dropping its sign — the cyclic
 * rotation — really does break it. A vector graded against the submission's own `ring_mul`
 * would accept both being wrong together.
 *
 * Python 3 is on ubuntu-latest and the problem is stdlib-only.
 */

const ROOT = join(import.meta.dir, "..", "challenges", "ac26-w5-lwe-rlwe");
const LOCAL = join(ROOT, "local");
const SEED = "ci-fixed-seed";
const CHECKPOINTS = [
  "normalize",
  "ring",
  "lwe",
  "rlwe",
  "correspondence",
  "boundary",
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
  return read(`local/${dir}/lattice.py`);
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

describe("ac26-w5-lwe-rlwe: participant contract", () => {
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
      "local/tests/public/test_lattice.py",
      "local/tests/hidden/check_lattice.py",
      "local/verifier/server.py",
      "local/starter/lattice.py",
      "local/reference/lattice.py",
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

  // The previous problem's answer is handed over rather than re-graded, which is what makes
  // the `requires` edge to it real. If these drift out of the starter the problem silently
  // becomes a re-run of 510.
  it("should ship problem 510's answer already written in the starter", () => {
    const starter = bundle("starter");
    for (const given of ["def encode(", "def decode(", "def centered(", "def noise_interval("]) {
      expect(starter).toContain(given);
    }
    expect(starter).toContain('return (m % params["p"]) * params["delta"] % params["q"]');
    expect(starter).toContain("return (-(delta // 2), delta - delta // 2 - 1)");
  });
});

describe("ac26-w5-lwe-rlwe: container safety", () => {
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

  it("should bound the verifier process itself, not only the submission", () => {
    const compose = parseYaml(read("local/docker-compose.yml")) as {
      services: Record<string, { mem_limit?: string; pids_limit?: number }>;
    };
    for (const service of Object.values(compose.services)) {
      expect(service.mem_limit).toBeTruthy();
      expect(service.pids_limit).toBeGreaterThan(0);
    }
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

describe("ac26-w5-lwe-rlwe: the generated parameters exercise both cases", () => {
  it("should draw both ring degrees", () => {
    const answer = probe([
      "from fixtures.generate import params",
      "degrees = {params('s', f'L{i}')['degree'] for i in range(40)}",
      "print(sorted(degrees))",
    ]);
    expect(JSON.parse(answer.replace(/'/g, '"'))).toEqual([4, 8]);
  });

  // An implementation that assumes the LWE dimension equals the ring degree passes every
  // parameter set where they happen to coincide.
  it("should keep the dimension and the degree different most of the time", () => {
    const answer = probe([
      "from fixtures.generate import params",
      "sets = [params('s', f'L{i}') for i in range(40)]",
      "print(sum(1 for x in sets if x['dimension'] != x['degree']))",
    ]);
    expect(Number(answer)).toBeGreaterThanOrEqual(20);
  });

  it("should draw both parities of delta, so the budget is asymmetric somewhere", () => {
    const answer = probe([
      "from fixtures.generate import params",
      "deltas = [params('s', f'L{i}')['delta'] for i in range(40)]",
      "print(any(d % 2 for d in deltas), any(d % 2 == 0 for d in deltas))",
    ]);
    expect(answer).toBe("True True");
  });

  // Small enough to enumerate is what keeps the hidden suite's sweeps affordable and the
  // trace printable.
  it("should keep every ring small enough to enumerate", () => {
    const answer = probe([
      "from fixtures.generate import params",
      "print(max(params('s', f'L{i}')['q'] for i in range(40)))",
    ]);
    expect(Number(answer)).toBeLessThanOrEqual(256);
  });
});

describe("ac26-w5-lwe-rlwe: the ring really is negacyclic", () => {
  // The whole problem rests on this, and it is the one property the encryption path cannot
  // demonstrate: a product of two ring elements never reaches degree 2N.
  it("should send X^N to -1 and X^2N back to +1", () => {
    const answer = probe([
      "import json",
      "from fixtures.generate import normalize, params",
      "bad = []",
      "for i in range(20):",
      "    par = params('s', f'L{i}')",
      "    n, q = par['degree'], par['q']",
      "    for turns, sign in ((1, -1), (2, 1), (3, -1)):",
      "        got = normalize(par, [0] * (turns * n) + [1])",
      "        if got != normalize(par, [sign]):",
      "            bad.append([par, turns, list(got)])",
      "print(json.dumps(bad))",
    ]);
    expect(JSON.parse(answer)).toEqual([]);
  });

  it("should disagree with a cyclic convolution on X^(N-1) * X", () => {
    const answer = probe([
      "from fixtures.generate import cyclic_mul, params, ring_mul",
      "ok = True",
      "for i in range(20):",
      "    par = params('s', f'L{i}')",
      "    n = par['degree']",
      "    top = [0] * (n - 1) + [1]",
      "    shift = [0, 1] + [0] * (n - 2)",
      "    ok = ok and ring_mul(par, top, shift) != cyclic_mul(par, top, shift)",
      "print(ok)",
    ]);
    expect(answer).toBe("True");
  });
});

describe("ac26-w5-lwe-rlwe: the coefficient vector is the product's own", () => {
  // Both sides come from the fixtures. Grading `<v, s>` with the submission's `ring_mul`
  // would accept a wrong vector and a wrong product agreeing with each other.
  it("should satisfy <v, s> = (a*s)[k] for every secret and every k", () => {
    const answer = probe([
      "import json",
      "from fixtures.generate import params, phase_coefficient_terms, ring_element, ring_mul, secret",
      "bad = []",
      "for i in range(20):",
      "    par = params('s', f'L{i}')",
      "    n, q = par['degree'], par['q']",
      "    a = ring_element(par, 's', f'L{i}')",
      "    trials = [tuple(1 if x == j else 0 for x in range(n)) for j in range(n)]",
      "    trials += [secret('s', f'L{i}:{t}', n) for t in range(4)]",
      "    for s in trials:",
      "        product = ring_mul(par, a, s)",
      "        for k in range(n):",
      "            v = phase_coefficient_terms(par, a, k)",
      "            if sum(x * y for x, y in zip(v, s)) % q != product[k]:",
      "                bad.append([i, k, list(s)])",
      "print(json.dumps(bad))",
    ]);
    expect(JSON.parse(answer)).toEqual([]);
  });

  it("should break once the sign on the wrapped entries is dropped", () => {
    // The cyclic rotation is a real vector satisfying a real identity, in the wrong ring.
    const answer = probe([
      "from fixtures.generate import normalize, params, ring_element, ring_mul, secret",
      "broken = 0",
      "for i in range(20):",
      "    par = params('s', f'L{i}')",
      "    n, q = par['degree'], par['q']",
      "    a = normalize(par, ring_element(par, 's', f'L{i}'))",
      "    s = secret('s', f'L{i}:x', n)",
      "    product = ring_mul(par, a, s)",
      "    for k in range(n):",
      "        v = [a[(k - j) % n] for j in range(n)]",
      "        if sum(x * y for x, y in zip(v, s)) % q != product[k]:",
      "            broken += 1",
      "            break",
      "print(broken)",
    ]);
    expect(Number(answer)).toBeGreaterThanOrEqual(18);
  });
});

describe("ac26-w5-lwe-rlwe: the budget is spent per coefficient", () => {
  // The sample that fails first is built so its mean is comfortable and its maximum is not.
  it("should hide the first failure behind a comfortable mean", () => {
    const answer = probe([
      "import json",
      "from fixtures.generate import boundary_samples, first_failing_index, params",
      "bad = []",
      "for i in range(20):",
      "    par = params('s', f'L{i}')",
      "    samples = boundary_samples(par, 's', f'L{i}')",
      "    index = first_failing_index(par, samples)",
      "    killer = samples[index]",
      "    if isinstance(killer, int):",
      "        bad.append(['scalar killer', i])",
      "        continue",
      "    low, high = par['delta'] // -2, par['delta'] - par['delta'] // 2 - 1",
      "    if not low <= sum(killer) <= high:",
      "        bad.append(['mean is not comfortable', i, sum(killer)])",
      "print(json.dumps(bad))",
    ]);
    expect(JSON.parse(answer)).toEqual([]);
  });

  it("should not always put the first failure at the same index", () => {
    const answer = probe([
      "from fixtures.generate import boundary_samples, first_failing_index, params",
      "seen = set()",
      "for i in range(40):",
      "    par = params('s', f'L{i}')",
      "    seen.add(first_failing_index(par, boundary_samples(par, 's', f'L{i}')))",
      "print(len(seen))",
    ]);
    expect(Number(answer)).toBeGreaterThan(1);
  });

  it("should ship a run with no failure in it, so -1 is reachable", () => {
    const answer = probe([
      "from fixtures.generate import first_failing_index, params, surviving_samples",
      "sets = [params('s', f'L{i}') for i in range(20)]",
      "print(all(first_failing_index(x, surviving_samples(x, 's', 'L')) == -1 for x in sets))",
    ]);
    expect(answer).toBe("True");
  });
});

describe("ac26-w5-lwe-rlwe: the rejects are stated, not constructed by the learner", () => {
  it("should define the malformed ciphertexts outside the submission", () => {
    expect(read("local/fixtures/generate.py")).toContain("invalid_ciphertexts");
    expect(bundle("starter")).not.toContain("invalid_ciphertexts");
    expect(bundle("reference")).not.toContain("invalid_ciphertexts");
  });

  // The top of the ring is an ordinary coefficient. An over-eager validator loses it.
  it("should require q - 1 to be accepted as canonical", () => {
    const answer = probe([
      "from fixtures.generate import params, valid_ciphertexts",
      "par = params('s')",
      "flat = [c for _mode, ct in valid_ciphertexts(par) for part in ct",
      "        for c in (part if isinstance(part, tuple) else (part,))]",
      "print(par['q'] - 1 in flat)",
    ]);
    expect(answer).toBe("True");
  });
});

describe("ac26-w5-lwe-rlwe: the problem is solvable and actually fails", () => {
  it("should fail the public tests in the shipped starter state", () => {
    const result = python(["tests/public/test_lattice.py"]);
    expect(result.status).not.toBe(0);
    expect(result.stdout).toContain("failed");
  });

  // Not just "some check failed". A stub returning 0 passed the LWE round trip on any seed
  // that happened to draw message 0, so the public set reported `ok` for a function the
  // learner had not written. Every public check must fail against the shipped starter.
  it("should have no public check that a stub can pass by coincidence", () => {
    const result = python(["tests/public/test_lattice.py"]);
    expect(result.stdout).not.toContain("ok   ");
  });

  // TEMPLATE.md: the public tests must not be sufficient. This is the sharpest case —
  // a submission in the WRONG RING passes all four, because the encrypt and decrypt paths
  // use the same wrong product and it cancels out of the phase. Nothing in the public set
  // reaches past degree N, which is where the whole problem lives.
  it("should let a fully cyclic implementation pass every public test", () => {
    const cyclic = bundle("reference")
      .replace("            raw[i + j] += a * b", "            raw[(i + j) % len(left)] += a * b")
      .replace("        sign = -1 if (index // n) % 2 else 1", "        sign = 1");
    const script = [
      "import os, shutil, subprocess, sys, tempfile",
      "work = tempfile.mkdtemp()",
      "shutil.copytree('.', os.path.join(work, 'p'), ignore=shutil.ignore_patterns('__pycache__'))",
      "open(os.path.join(work, 'p', 'starter', 'lattice.py'), 'w').write(sys.argv[1])",
      "run = subprocess.run([sys.executable, 'tests/public/test_lattice.py'],",
      "                     cwd=os.path.join(work, 'p'), capture_output=True, text=True)",
      "print(run.returncode)",
    ].join("\n");
    const result = python(["-c", script, cyclic]);
    expect(result.status).toBe(0);
    expect(result.stdout.trim().split("\n").at(-1)).toBe("0");
    // ...and the hidden tests catch it, so the teeth are in the right place.
    expect(evaluate("normalize", cyclic)).toBe(false);
    expect(evaluate("ring", cyclic)).toBe(false);
  }, 120_000);

  it("should kill every intended defect in the mutation suite", () => {
    const result = python(["mutation.py"]);
    expect(result.stdout).toContain("PASS reference implementation passes the hidden tests");
    expect(result.stdout).not.toContain("SURVIVED");
    expect(result.status).toBe(0);
  }, 180_000);
});

describe("ac26-w5-lwe-rlwe: /verify contract", () => {
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

  // Each of these round-trips an LWE ciphertext correctly, which is the property a learner
  // checks first.
  it("should reject a fold whose sign is a threshold rather than a period", () => {
    const source = bundle("reference").replace(
      "        sign = -1 if (index // n) % 2 else 1",
      "        sign = -1 if index >= n else 1",
    );
    expect(evaluate("normalize", source)).toBe(false);
  }, 120_000);

  it("should reject a cyclic convolution, which is a product in a different ring", () => {
    const source = bundle("reference").replace(
      "            raw[i + j] += a * b",
      "            raw[(i + j) % len(left)] += a * b",
    );
    expect(evaluate("ring", source)).toBe(false);
  }, 120_000);

  it("should reject a phase that adds the inner product back", () => {
    const source = bundle("reference").replace(
      '    return (body - sum(a * s for a, s in zip(mask, secret))) % params["q"]',
      '    return (body + sum(a * s for a, s in zip(mask, secret))) % params["q"]',
    );
    expect(evaluate("lwe", source)).toBe(false);
  }, 120_000);

  it("should reject encoding only the constant term of an RLWE message", () => {
    const source = bundle("reference").replace(
      "    encoded = [encode(params, m) for m in message]",
      "    encoded = [encode(params, message[0])] + [0] * (len(message) - 1)",
    );
    expect(evaluate("rlwe", source)).toBe(false);
  }, 120_000);

  it("should reject a coefficient vector that is a plain cyclic rotation", () => {
    const source = bundle("reference").replace(
      "        (coefficients[k - j] if j <= k else -coefficients[k + n - j]) % q for j in range(n)",
      "        (coefficients[k - j] if j <= k else coefficients[k + n - j]) % q for j in range(n)",
    );
    expect(evaluate("correspondence", source)).toBe(false);
  }, 120_000);

  it("should reject a budget scored by the total instead of the worst coefficient", () => {
    const source = bundle("reference").replace(
      "    return all(low <= value <= high for value in values)",
      "    return low <= sum(values) <= high",
    );
    expect(evaluate("boundary", source)).toBe(false);
  }, 120_000);

  it("should reject a validator that takes q itself as canonical", () => {
    const source = bundle("reference").replace(
      "            if not 0 <= value < q:",
      "            if not 0 <= value <= q:",
    );
    expect(evaluate("validate", source)).toBe(false);
  }, 120_000);

  // The transfer checkpoint runs under a derived seed, so a submission that memorized one
  // ring fails it while passing everything else.
  it("should run transfer under parameters no other checkpoint used", () => {
    expect(read("local/verifier/server.py")).toContain('f"{SEED}:transfer"');
  });

  it("should reject a submission that hangs, rather than hanging itself", () => {
    expect(
      evaluate("normalize", "def normalize(params, c):\n    while True:\n        pass\n"),
    ).toBe(false);
  }, 60_000);

  it("should reject a submission that cannot even be imported", () => {
    expect(evaluate("normalize", "def normalize(:\n")).toBe(false);
  }, 60_000);

  it("should reject an unknown checkpoint id instead of crediting it", () => {
    expect(evaluate("gadget-decomposition", bundle("reference"))).toBe(false);
  });

  it("should echo the checkpointId so the platform can fail closed", () => {
    expect(read("local/verifier/server.py")).toContain(
      '{"checkpointId": checkpoint_id, "correct": correct}',
    );
  });
});

describe("ac26-w5-lwe-rlwe: metadata contracts", () => {
  function metadata() {
    return JSON.parse(read("metadata.json")) as {
      difficulty: number;
      status: string;
      track: { order: number };
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
      runtime: { verifyUrl: string };
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

  it("should take the curriculum's 520 slot, after the encoding problem's 510", () => {
    expect(metadata().track.order).toBe(520);
  });

  it("should point at the port the compose file publishes", () => {
    const compose = parseYaml(read("local/docker-compose.yml")) as {
      services: Record<string, { ports?: string[] }>;
    };
    const ports = Object.values(compose.services).flatMap((service) => service.ports ?? []);
    const port = new URL(metadata().runtime.verifyUrl).port;
    expect(ports.some((mapping) => mapping.endsWith(`:${port}`))).toBe(true);
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

  it("should declare the independent-reimplementation spoiler policy", () => {
    expect(metadata().courseAlignment.spoilerPolicy).toBe("independent-reimplementation");
  });
});
