import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import { parse as parseYaml } from "yaml";

/**
 * ac26-w5-rgsw-external builds the gadget and the external product on top of the supplied
 * ring. Three properties carry the design and all three are asserted here.
 *
 * **Every generated parameter set keeps the product decryptable.** The external product
 * accumulates `sum(d_j * e_j)` over 2L rows, and if that exceeded the tolerated interval a
 * correct submission would fail. `VIABLE` is enumerated rather than sampled for exactly
 * this reason, and the bound is checked here rather than trusted.
 *
 * **The two halves of the RGSW really are different.** The whole construction rests on the
 * first L rows carrying the gadget in `a` and the rest in `b`; if the fixtures built both
 * halves the same way, nothing in the problem would notice.
 *
 * **Selector 0 and selector 1 are indistinguishable in shape.** Same row count, same
 * structure, different content -- which is what makes the external product's branch
 * unobservable.
 *
 * Python 3 is on ubuntu-latest and the problem is stdlib-only.
 */

const ROOT = join(import.meta.dir, "..", "challenges", "ac26-w5-rgsw-external");
const LOCAL = join(ROOT, "local");
const SEED = "ci-fixed-seed";
const CHECKPOINTS = [
  "decompose",
  "gadget",
  "polynomial",
  "rgsw",
  "external",
  "trace",
  "failure",
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
  return read(`local/${dir}/rgsw.py`);
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

describe("ac26-w5-rgsw-external: participant contract", () => {
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
      "local/tests/public/test_rgsw.py",
      "local/tests/hidden/check_rgsw.py",
      "local/verifier/server.py",
      "local/starter/rgsw.py",
      "local/reference/rgsw.py",
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

describe("ac26-w5-rgsw-external: container safety", () => {
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


describe("ac26-w5-rgsw-external: every generated parameter set stays decryptable", () => {
  // The external product accumulates sum(d_j * e_j) over 2L rows. If that ever exceeded the
  // tolerated interval, a correct submission would fail and the problem would be unsolvable.
  // VIABLE is enumerated rather than sampled for exactly this reason.
  it("should keep the external product's noise bound inside the budget", () => {
    const answer = probe([
      "import json",
      "from fixtures.generate import VIABLE, noise_bound",
      "bad = []",
      "for base, levels, degree in VIABLE:",
      "    q = base ** levels",
      "    par = {'base': base, 'levels': levels, 'degree': degree, 'modulus': q,",
      "           'plaintext_modulus': 2, 'delta': q // 2}",
      "    if noise_bound(par) + 2 >= par['delta'] // 2:",
      "        bad.append([base, levels, degree, noise_bound(par), par['delta'] // 2])",
      "print(json.dumps(bad))",
    ]);
    expect(JSON.parse(answer)).toEqual([]);
  });

  it("should only draw parameter sets from that enumerated list", () => {
    const answer = probe([
      "from fixtures.generate import VIABLE, params",
      "drawn = {(p['base'], p['levels'], p['degree']) for p in",
      "         (params('s', f'L{i}') for i in range(40))}",
      "print(drawn <= set(VIABLE))",
    ]);
    expect(answer).toBe("True");
  });

  it("should keep q equal to base ** levels, which is what makes recomposition exact", () => {
    const answer = probe([
      "from fixtures.generate import params",
      "print(all(p['modulus'] == p['base'] ** p['levels'] for p in",
      "          (params('s', f'L{i}') for i in range(40))))",
    ]);
    expect(answer).toBe("True");
  });

  it("should draw both bases across seeds, so a shift-only decomposition cannot hide", () => {
    const answer = probe([
      "from fixtures.generate import params",
      "bases = {params(s, f'L{i}')['base'] for s in 'abcdef' for i in range(8)}",
      "print(sorted(bases))",
    ]);
    expect(answer).toBe("[2, 4]");
  });
});

describe("ac26-w5-rgsw-external: the RGSW halves are genuinely different", () => {
  // If the fixtures built both halves the same way, the row layout would be untested and
  // an implementation that collapsed them would pass.
  it("should put the gadget in a for the first half and in b for the second", () => {
    const answer = probe([
      "import json",
      "from fixtures.generate import (params, rgsw_encrypt, rgsw_material, rlwe_secret)",
      "bad = []",
      "for i in range(12):",
      "    par = params('s', f'L{i}')",
      "    L = par['levels']",
      "    secret = rlwe_secret('s', par)",
      "    mat = rgsw_material('s', par, f'x{i}')",
      "    zero = rgsw_encrypt(par, secret, 0, mat)",
      "    one = rgsw_encrypt(par, secret, 1, mat)",
      "    # Selector only moves the slot the gadget lives in, so exactly one component of",
      "    # each row differs between the two selectors -- a for the first half, b for the rest.",
      "    for j in range(2 * L):",
      "        moved_a = zero[j][0] != one[j][0]",
      "        moved_b = zero[j][1] != one[j][1]",
      "        want_a, want_b = (j < L), (j >= L)",
      "        if (moved_a, moved_b) != (want_a, want_b):",
      "            bad.append([i, j, moved_a, moved_b])",
      "print(json.dumps(bad))",
    ]);
    expect(JSON.parse(answer)).toEqual([]);
  });

  it("should make the two selectors indistinguishable in shape", () => {
    // Same row count, same structure, different content. If selector 0 and 1 produced
    // different shapes, the branch would be readable off the ciphertext.
    const answer = probe([
      "from fixtures.generate import params, rgsw_encrypt, rgsw_material, rlwe_secret",
      "ok = True",
      "for i in range(12):",
      "    par = params('s', f'L{i}')",
      "    secret = rlwe_secret('s', par)",
      "    mat = rgsw_material('s', par, f'y{i}')",
      "    a = rgsw_encrypt(par, secret, 0, mat)",
      "    b = rgsw_encrypt(par, secret, 1, mat)",
      "    ok = ok and len(a) == len(b) == 2 * par['levels']",
      "    ok = ok and all(len(x) == len(y) == 2 for x, y in zip(a, b))",
      "    ok = ok and a != b",
      "print(ok)",
    ]);
    expect(answer).toBe("True");
  });

  it("should give both selector semantics on every parameter set", () => {
    const answer = probe([
      "import json",
      "from fixtures.generate import (external_product, params, rgsw_encrypt, rgsw_material,",
      "    ring_noise, ring_random, rlwe_decrypt, rlwe_encrypt, rlwe_secret)",
      "bad = []",
      "for i in range(12):",
      "    par = params('s', f'L{i}')",
      "    secret = rlwe_secret('s', par)",
      "    msgs = tuple((k + 1) % par['plaintext_modulus'] for k in range(par['degree']))",
      "    ct = rlwe_encrypt(par, secret, msgs, ring_random('s', par, f'c{i}'),",
      "                      ring_noise('s', par, f'c{i}'))",
      "    for mu in (0, 1):",
      "        rows = rgsw_encrypt(par, secret, mu, rgsw_material('s', par, f'z{i}{mu}'))",
      "        got = rlwe_decrypt(par, secret, external_product(par, rows, ct))",
      "        want = tuple([0] * par['degree']) if mu == 0 else msgs",
      "        if got != want:",
      "            bad.append([i, mu, list(got), list(want)])",
      "print(json.dumps(bad))",
    ]);
    expect(JSON.parse(answer)).toEqual([]);
  });
});

describe("ac26-w5-rgsw-external: the problem is solvable and actually fails", () => {
  it("should fail the public tests in the shipped starter state", () => {
    const result = python(["tests/public/test_rgsw.py"]);
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

describe("ac26-w5-rgsw-external: /verify contract", () => {
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

  // Each of these is self-consistent and only separates once the fixtures have to agree.
  it("should reject a gadget vector built most-significant first", () => {
    const source = bundle("reference").replace(
      '    return tuple(params["base"] ** index for index in range(params["levels"]))',
      '    return tuple(params["base"] ** index for index in reversed(range(params["levels"])))',
    );
    expect(evaluate("gadget", source)).toBe(false);
  }, 180_000);

  it("should reject a transposed polynomial decomposition", () => {
    const source = bundle("reference").replace(
      "    return tuple(\n"
        + "        tuple(per_coefficient[k][i] for k in range(degree))\n"
        + '        for i in range(params["levels"])\n'
        + "    )",
      "    return tuple(tuple(d) for d in per_coefficient)",
    );
    expect(evaluate("polynomial", source)).toBe(false);
  }, 180_000);

  it("should reject an RGSW that keeps the selector in its structure", () => {
    const source = bundle("reference").replace(
      "            rows.append((_reduce(params, mask), _bump(params, body, selector * gadget[j - levels])))\n"
        + "    return tuple(rows)",
      "            rows.append((_reduce(params, mask), _bump(params, body, selector * gadget[j - levels]), selector))\n"
        + "    return tuple(rows)",
    );
    expect(evaluate("rgsw", source)).toBe(false);
  }, 180_000);

  it("should reject an external product that returns its input", () => {
    // Decrypts correctly for selector 1, which is the case a learner tests first.
    const source = bundle("reference").replace(
      "    digits = _digit_vector(params, ciphertext)\n"
        + '    left = right = tuple([0] * params["degree"])',
      "    return dict(ciphertext)\n"
        + "    digits = _digit_vector(params, ciphertext)\n"
        + '    left = right = tuple([0] * params["degree"])',
    );
    expect(evaluate("external", source)).toBe(false);
  }, 180_000);

  it("should reject counting the levels with a float logarithm", () => {
    const source = bundle("reference").replace(
      "    needed, covered = 0, 1\n"
        + "    while covered < modulus:\n"
        + "        covered *= base\n"
        + "        needed += 1\n"
        + "    return needed",
      "    import math\n    return int(math.ceil(math.log(modulus, base)))",
    );
    expect(evaluate("failure", source)).toBe(false);
  }, 180_000);

  it("should run transfer under parameters no other checkpoint used", () => {
    expect(read("local/verifier/server.py")).toContain('f"{SEED}:transfer"');
  });

  it("should reject a submission that hangs, rather than hanging itself", () => {
    expect(
      evaluate("decompose", "def decompose(params, value):\n    while True:\n        pass\n"),
    ).toBe(false);
  }, 60_000);

  it("should reject a submission that cannot even be imported", () => {
    expect(evaluate("decompose", "def decompose(:\n")).toBe(false);
  }, 60_000);

  it("should reject an unknown checkpoint id instead of crediting it", () => {
    expect(evaluate("cmux", bundle("reference"))).toBe(false);
  });

  it("should echo the checkpointId so the platform can fail closed", () => {
    expect(read("local/verifier/server.py")).toContain(
      '{"checkpointId": checkpoint_id, "correct": correct}',
    );
  });
});

describe("ac26-w5-rgsw-external: metadata contracts", () => {
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

  it("should declare the independent-reimplementation spoiler policy", () => {
    expect(metadata().courseAlignment.spoilerPolicy).toBe("independent-reimplementation");
  });
});
