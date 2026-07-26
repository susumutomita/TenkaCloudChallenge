import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import { parse as parseYaml } from "yaml";

/**
 * ac26-w5-lwe-rlwe builds the negacyclic ring and both toy schemes. Three properties carry
 * the design and all three are asserted here rather than left to review.
 *
 * **The ring is really negacyclic.** `X^N = -1` is the whole difference from a cyclic ring,
 * and a cyclic ring is a perfectly good ring — it satisfies every axiom and round-trips
 * encryption against decryption. If the fixtures' own product were cyclic, nothing in the
 * problem would notice.
 *
 * **The secrets are never all zero.** This one is not hypothetical: the mutation seed drew
 * `(0, 0, 0, 0, 0)` and three separate mutations survived on it. With an all-zero secret the
 * mask term vanishes, so `b = encode(m) + e` regardless of what the implementation did with
 * the secret — a sign-flipped inner product, a phase that adds instead of subtracting, and
 * an implementation that ignores the mask all look correct.
 *
 * **Round trips are crossed.** Encrypt with the fixtures, decrypt with the submission, and
 * the other way round. A scheme that is only self-consistent passes an uncrossed test.
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
  "defense",
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
  return read(`local/${dir}/lwe.py`);
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
      "local/tests/public/test_lwe.py",
      "local/tests/hidden/check_lwe.py",
      "local/verifier/server.py",
      "local/starter/lwe.py",
      "local/reference/lwe.py",
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

describe("ac26-w5-lwe-rlwe: the ring is the one the problem claims", () => {
  it("should satisfy X^(N-1) * X = -1 for every generated degree", () => {
    const answer = probe([
      "import json",
      "from fixtures.generate import normalize, params, ring_mul",
      "bad = []",
      "for i in range(30):",
      "    par = params('s', f'L{i}')",
      "    n = par['degree']",
      "    top = tuple([0] * (n - 1) + [1])",
      "    x = tuple([0, 1] + [0] * (n - 2)) if n > 1 else (1,)",
      "    if ring_mul(par, top, x) != normalize(par, [-1] + [0] * (n - 1)):",
      "        bad.append(par)",
      "print(json.dumps(bad))",
    ]);
    expect(JSON.parse(answer)).toEqual([]);
  });

  // If the fixtures' own product were cyclic, every check in the problem would agree with
  // it and the whole lesson would evaporate. So the two must actually disagree.
  it("should differ from the cyclic product on real inputs", () => {
    const answer = probe([
      "from fixtures.generate import cyclic_mul, params, ring_mul, rlwe_mask",
      "differ = 0",
      "for i in range(30):",
      "    par = params('s', f'L{i}')",
      "    a = rlwe_mask('s', par, 'a')",
      "    b = rlwe_mask('s', par, 'b')",
      "    if cyclic_mul(par, a, b) != ring_mul(par, a, b):",
      "        differ += 1",
      "print(differ == 30)",
    ]);
    expect(answer).toBe("True");
  });

  it("should be distributive, commutative, and idempotent under normalization", () => {
    const answer = probe([
      "from fixtures.generate import normalize, params, ring_add, ring_mul, rlwe_mask",
      "ok = True",
      "for i in range(30):",
      "    par = params('s', f'L{i}')",
      "    a, b, c = (rlwe_mask('s', par, k) for k in 'abc')",
      "    ok = ok and ring_mul(par, a, ring_add(par, b, c)) == ring_add(",
      "        par, ring_mul(par, a, b), ring_mul(par, a, c))",
      "    ok = ok and ring_mul(par, a, b) == ring_mul(par, b, a)",
      "    ok = ok and normalize(par, normalize(par, a)) == normalize(par, a)",
      "print(ok)",
    ]);
    expect(answer).toBe("True");
  });

  // Two wraps restore the sign. A fold that negates once and stops gets this wrong, and
  // ring_mul never produces an input long enough to expose it.
  it("should restore the sign after two wraps, not just negate once", () => {
    const answer = probe([
      "from fixtures.generate import normalize, params",
      "ok = True",
      "for i in range(30):",
      "    par = params('s', f'L{i}')",
      "    n = par['degree']",
      "    ok = ok and normalize(par, [0] * (2 * n) + [1])[0] == 1 % par['modulus']",
      "    ok = ok and normalize(par, [0] * n + [1])[0] == -1 % par['modulus']",
      "print(ok)",
    ]);
    expect(answer).toBe("True");
  });
});

describe("ac26-w5-lwe-rlwe: the fixtures do not degenerate the scheme", () => {
  // Not hypothetical. The mutation seed drew an all-zero LWE secret and three mutations
  // survived on it, because b = encode(m) + e no matter what the secret was used for.
  it("should never generate an all-zero secret", () => {
    const answer = probe([
      "import json",
      "from fixtures.generate import lwe_secret, params, rlwe_secret",
      "bad = []",
      "for seed in ('a', 'b', 'mutation-suite-seed', 'ci-fixed-seed', 'local-dev-seed'):",
      "    for i in range(10):",
      "        par = params(seed, f'L{i}')",
      "        if not any(lwe_secret(seed, par)) or not any(rlwe_secret(seed, par)):",
      "            bad.append([seed, i])",
      "print(json.dumps(bad))",
    ]);
    expect(JSON.parse(answer)).toEqual([]);
  });

  it("should never generate all-zero noise, which would hide a dropped noise term", () => {
    const answer = probe([
      "from fixtures.generate import params, small_noise",
      "ok = True",
      "for i in range(30):",
      "    par = params('s', f'L{i}')",
      "    ok = ok and any(small_noise('s', par, f'n{i}', par['degree']))",
      "print(ok)",
    ]);
    expect(answer).toBe("True");
  });

  it("should keep every round-trip noise inside the tolerated budget", () => {
    const answer = probe([
      "from fixtures.generate import params, small_noise, success_interval",
      "ok = True",
      "for i in range(30):",
      "    par = params('s', f'L{i}')",
      "    low, high = success_interval(par)",
      "    ok = ok and all(low <= e <= high for e in small_noise('s', par, f'n{i}', 8))",
      "print(ok)",
    ]);
    expect(answer).toBe("True");
  });

  // The first failing sample must not sit at a fixed index, or it can be returned without
  // looking at the samples at all.
  it("should not put the first boundary crossing at a constant index", () => {
    const answer = probe([
      "from fixtures.generate import first_boundary_crossing, params",
      "seen = {first_boundary_crossing(s, params(s)) for s in",
      "        ('a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l')}",
      "print(len(seen) > 1)",
    ]);
    expect(answer).toBe("True");
  });
});

describe("ac26-w5-lwe-rlwe: both schemes round-trip against the fixtures", () => {
  it("should decrypt what the fixtures encrypted, in both schemes", () => {
    const answer = probe([
      "import json",
      "from fixtures.generate import (lwe_decrypt, lwe_encrypt, lwe_mask, lwe_secret,",
      "    params, rlwe_decrypt, rlwe_encrypt, rlwe_mask, rlwe_secret, small_noise)",
      "bad = []",
      "for i in range(20):",
      "    par = params('s', f'L{i}')",
      "    s_, mask = lwe_secret('s', par), lwe_mask('s', par, 'm')",
      "    for m in range(par['plaintext_modulus']):",
      "        e = small_noise('s', par, f'e{i}', 1)[0]",
      "        got = lwe_decrypt(par, s_, lwe_encrypt(par, s_, m, mask, e))",
      "        if got['message'] != m or got['noise'] != e:",
      "            bad.append(['lwe', i, m])",
      "    n = par['degree']",
      "    S, A = rlwe_secret('s', par), rlwe_mask('s', par, 'A')",
      "    msgs = tuple(j % par['plaintext_modulus'] for j in range(n))",
      "    E = small_noise('s', par, f'E{i}', n)",
      "    got = rlwe_decrypt(par, S, rlwe_encrypt(par, S, msgs, A, E))",
      "    if tuple(got['message']) != msgs or tuple(got['noise']) != tuple(E):",
      "        bad.append(['rlwe', i])",
      "print(json.dumps(bad))",
    ]);
    expect(JSON.parse(answer)).toEqual([]);
  });

  it("should carry N messages in one RLWE ciphertext, not one", () => {
    const answer = probe([
      "from fixtures.generate import params",
      "print(all(params('s', f'L{i}')['degree'] > 1 for i in range(30)))",
    ]);
    expect(answer).toBe("True");
  });
});

describe("ac26-w5-lwe-rlwe: the problem is solvable and actually fails", () => {
  it("should fail the public tests in the shipped starter state", () => {
    const result = python(["tests/public/test_lwe.py"]);
    expect(result.status).not.toBe(0);
    expect(result.stdout).toContain("failed");
  });

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
    180_000,
  );

  it.each(CHECKPOINTS)(
    "should reject the starter submission on %s",
    (checkpoint) => {
      expect(evaluate(checkpoint, bundle("starter"))).toBe(false);
    },
    180_000,
  );

  // Each of these is self-consistent: it encrypts and decrypts its own ciphertexts
  // perfectly, and only fails once something else has to agree with it.
  it("should reject a cyclic ring, which satisfies every axiom but the right one", () => {
    const source = bundle("reference").replace(
      '        sign = -1 if (index // n) % 2 else 1',
      "        sign = 1",
    );
    expect(evaluate("ring", source)).toBe(false);
  }, 180_000);

  it("should reject a phase that adds the secret product instead of cancelling it", () => {
    const source = bundle("reference").replace(
      '    phase = (ciphertext["b"] - product) % q',
      '    phase = (ciphertext["b"] + product) % q',
    );
    expect(evaluate("lwe", source)).toBe(false);
  }, 180_000);

  it("should reject a ciphertext that carries its own plaintext", () => {
    const source = bundle("reference").replace(
      '        "b": (product + encode(params, message) + noise) % q,\n    }',
      '        "b": (product + encode(params, message) + noise) % q,\n        "message": message,\n    }',
    );
    expect(evaluate("lwe", source)).toBe(false);
  }, 180_000);

  it("should reject an RLWE decryptor that only gets the constant coefficient right", () => {
    const source = bundle("reference").replace(
      "    messages = tuple(decode(params, value) for value in phase)",
      '    messages = (decode(params, phase[0]),) + (0,) * (params["degree"] - 1)',
    );
    expect(evaluate("rlwe", source)).toBe(false);
  }, 180_000);

  it("should reject calling the RLWE operation an inner product", () => {
    const source = bundle("reference").replace(
      '            "operation": "negacyclic-product",',
      '            "operation": "inner-product",',
    );
    expect(evaluate("correspondence", source)).toBe(false);
  }, 180_000);

  it("should reject a validator that measures every ciphertext against the dimension", () => {
    const source = bundle("reference").replace(
      '    expected = params["dimension"] if kind == "lwe" else params["degree"]',
      '    expected = params["dimension"]',
    );
    expect(evaluate("defense", source)).toBe(false);
  }, 180_000);

  it("should run transfer under a ring no other checkpoint used", () => {
    expect(read("local/verifier/server.py")).toContain('f"{SEED}:transfer"');
  });

  it("should reject a submission that hangs, rather than hanging itself", () => {
    expect(
      evaluate("normalize", "def normalize(params, coefficients):\n    while True:\n        pass\n"),
    ).toBe(false);
  }, 60_000);

  it("should reject a submission that cannot even be imported", () => {
    expect(evaluate("normalize", "def normalize(:\n")).toBe(false);
  }, 60_000);

  it("should reject an unknown checkpoint id instead of crediting it", () => {
    expect(evaluate("negacyclic", bundle("reference"))).toBe(false);
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

  // The API, the parameter generation, and the scheme write-up are original; nothing is
  // taken from the official exercise's function names, fixtures, or skeleton.
  it("should declare the independent-reimplementation spoiler policy", () => {
    expect(metadata().courseAlignment.spoilerPolicy).toBe("independent-reimplementation");
  });
});
