import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import { parse as parseYaml } from "yaml";

/**
 * ac26-w5-cmux-blind-rotation chains CMUX and monomial rotation into a blind rotation on top
 * of the supplied ring, RLWE, RGSW and external product. Four properties carry the design and
 * all four are asserted here rather than argued in a comment.
 *
 * **Every generated parameter set keeps the accumulator decryptable.** One external product's
 * worth of noise lands per CMUX and the loop runs `dimension` of them. If that total ever
 * exceeded the tolerated interval, a correct submission would fail. `VIABLE` is enumerated
 * rather than sampled for exactly this reason.
 *
 * **The plaintext modulus is 4, and that is load-bearing.** Modulo 2 a negated message is the
 * same message, so an implementation that wrote an ordinary circular shift would score full
 * marks. The assertion below is that negation actually moves a plaintext.
 *
 * **The rotation exponent's modulus is 2N, not N.** Rotating by N negates; rotating by 2N is
 * the identity. Reducing modulo N loses precisely the sign.
 *
 * **The loop lands on `X^(-phase)` without computing phase.** Checked against the plaintext
 * model, which is the same separation the hidden tests rely on.
 *
 * Python 3 is on ubuntu-latest and the problem is stdlib-only.
 */

const ROOT = join(import.meta.dir, "..", "challenges", "ac26-w5-cmux-blind-rotation");
const LOCAL = join(ROOT, "local");
const SEED = "ci-fixed-seed";
const CHECKPOINTS = [
  "combine",
  "cmux",
  "constant",
  "rotate",
  "conditional",
  "blind",
  "trace",
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
  return read(`local/${dir}/cmux.py`);
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

describe("ac26-w5-cmux-blind-rotation: participant contract", () => {
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
      "local/tests/public/test_cmux.py",
      "local/tests/hidden/check_cmux.py",
      "local/verifier/server.py",
      "local/starter/cmux.py",
      "local/reference/cmux.py",
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

describe("ac26-w5-cmux-blind-rotation: container safety", () => {
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

  it("should bound the verifier itself, not only the submission it runs", () => {
    const compose = read("local/docker-compose.yml");
    expect(compose).toContain("mem_limit:");
    expect(compose).toContain("pids_limit:");
  });

  it("should never build a shell command out of participant input", () => {
    const verifier = read("local/verifier/server.py");
    expect(verifier).toContain("shell=False");
    expect(verifier).not.toContain("os.system");
    expect(verifier).not.toContain("shell=True");
  });
});

describe("ac26-w5-cmux-blind-rotation: every generated parameter set stays decryptable", () => {
  // One external product's worth of noise per CMUX, `dimension` CMUXes, and the accumulator
  // starts as a trivial ciphertext carrying none. If that total ever exceeded the tolerated
  // interval, a correct submission would fail and the problem would be unsolvable.
  it("should keep the blind rotation's noise bound inside the budget", () => {
    const answer = probe([
      "import json",
      "from fixtures.generate import VIABLE, noise_bound",
      "bad = []",
      "for base, levels, degree, dimension in VIABLE:",
      "    q = base ** levels",
      "    par = {'base': base, 'levels': levels, 'degree': degree, 'dimension': dimension,",
      "           'modulus': q, 'plaintext_modulus': 4, 'delta': q // 4}",
      "    if noise_bound(par) * 2 >= par['delta'] // 2:",
      "        bad.append([base, levels, degree, dimension, noise_bound(par), par['delta'] // 2])",
      "print(json.dumps(bad))",
    ]);
    // Twice the bound, so the margin is real rather than marginal.
    expect(JSON.parse(answer)).toEqual([]);
  });

  it("should only draw parameter sets from that enumerated list", () => {
    const answer = probe([
      "from fixtures.generate import VIABLE, params",
      "drawn = {(p['base'], p['levels'], p['degree'], p['dimension']) for p in",
      "         (params('s', f'L{i}') for i in range(40))}",
      "print(drawn <= set(VIABLE))",
    ]);
    expect(answer).toBe("True");
  });

  it("should keep q equal to base ** levels, which is what makes the external product exact", () => {
    const answer = probe([
      "from fixtures.generate import params",
      "print(all(p['modulus'] == p['base'] ** p['levels'] for p in",
      "          (params('s', f'L{i}') for i in range(40))))",
    ]);
    expect(answer).toBe("True");
  });

  it("should draw both bases and more than one ring degree across seeds", () => {
    const answer = probe([
      "from fixtures.generate import params",
      "drawn = [params(s, f'L{i}') for s in 'abcdef' for i in range(8)]",
      "print(sorted({p['base'] for p in drawn}), len({p['degree'] for p in drawn}) > 1)",
    ]);
    expect(answer).toBe("[2, 4] True");
  });
});

describe("ac26-w5-cmux-blind-rotation: the encoding makes the sign visible", () => {
  // Modulo 2 a negated message is the same message, so the negacyclic wrap would never
  // reach the plaintext and a circular shift would pass everything.
  it("should use a plaintext modulus under which negation moves a message", () => {
    const answer = probe([
      "import json",
      "from fixtures.generate import decode, encode, params",
      "par = params('s')",
      "moved = [m for m in range(par['plaintext_modulus'])",
      "         if decode(par, -encode(par, m)) != m]",
      "print(json.dumps([par['plaintext_modulus'], moved]))",
    ]);
    expect(JSON.parse(answer)).toEqual([4, [1, 3]]);
  });

  it("should draw test vectors only from the residues negation moves", () => {
    // A constant test vector, or one built from 0 and 2, would make a wrap invisible again.
    const answer = probe([
      "from fixtures.generate import params, test_vector",
      "values = {v for s in 'abcd' for i in range(6)",
      "          for v in test_vector(s, params(s, f'L{i}'), f'L{i}')}",
      "print(sorted(values))",
    ]);
    expect(answer).toBe("[1, 3]");
  });
});

describe("ac26-w5-cmux-blind-rotation: rotation is negacyclic, modulo 2N", () => {
  it("should make rotation by N a negation and by 2N the identity", () => {
    const answer = probe([
      "import json",
      "from fixtures.generate import monomial_rotate, params, ring_random",
      "bad = []",
      "for i in range(12):",
      "    par = params('s', f'L{i}')",
      "    n, q = par['degree'], par['modulus']",
      "    poly = ring_random('s', par, f'r{i}')",
      "    if monomial_rotate(par, poly, 2 * n) != tuple(poly):",
      "        bad.append(['2N is not the identity', i])",
      "    if monomial_rotate(par, poly, n) != tuple((-v) % q for v in poly):",
      "        bad.append(['N is not a negation', i])",
      "    # Reducing modulo N instead of 2N would make these two agree.",
      "    if monomial_rotate(par, poly, n) == monomial_rotate(par, poly, 2 * n):",
      "        bad.append(['N and 2N agree, so the sign is gone', i])",
      "print(json.dumps(bad))",
    ]);
    expect(JSON.parse(answer)).toEqual([]);
  });

  it("should compose additively and normalize a negative exponent", () => {
    const answer = probe([
      "import json",
      "from fixtures.generate import monomial_rotate, params, ring_random",
      "bad = []",
      "for i in range(12):",
      "    par = params('s', f'L{i}')",
      "    n = par['degree']",
      "    poly = ring_random('s', par, f'c{i}')",
      "    for left, right in ((1, 1), (n - 1, 2), (n, n), (2, -3), (-1, 1)):",
      "        once = monomial_rotate(par, monomial_rotate(par, poly, left), right)",
      "        if once != monomial_rotate(par, poly, left + right):",
      "            bad.append([i, left, right])",
      "    if monomial_rotate(par, poly, -1) != monomial_rotate(par, poly, 2 * n - 1):",
      "        bad.append(['X^-1 is not X^(2N-1)', i])",
      "print(json.dumps(bad))",
    ]);
    expect(JSON.parse(answer)).toEqual([]);
  });
});

describe("ac26-w5-cmux-blind-rotation: CMUX selects without branching", () => {
  it("should give both selector semantics on every parameter set", () => {
    const answer = probe([
      "import json",
      "from fixtures.generate import (cmux, params, rgsw_encrypt, rgsw_material, ring_noise,",
      "    ring_random, rlwe_decrypt, rlwe_encrypt, rlwe_secret)",
      "bad = []",
      "for i in range(12):",
      "    par = params('s', f'L{i}')",
      "    secret = rlwe_secret('s', par)",
      "    m0 = tuple((k + 1) % par['plaintext_modulus'] for k in range(par['degree']))",
      "    m1 = tuple((v + 2) % par['plaintext_modulus'] for v in m0)",
      "    cts = [rlwe_encrypt(par, secret, m, ring_random('s', par, f'{i}{w}'),",
      "                        ring_noise('s', par, f'{i}{w}')) for w, m in enumerate((m0, m1))]",
      "    for mu in (0, 1):",
      "        rows = rgsw_encrypt(par, secret, mu, rgsw_material('s', par, f'z{i}{mu}'))",
      "        out = cmux(par, rows, cts[0], cts[1])",
      "        want = m0 if mu == 0 else m1",
      "        if rlwe_decrypt(par, secret, out) != want:",
      "            bad.append([i, mu, list(rlwe_decrypt(par, secret, out)), list(want)])",
      "        if (out['a'], out['b']) in ((cts[0]['a'], cts[0]['b']), (cts[1]['a'], cts[1]['b'])):",
      "            bad.append(['returned an input', i, mu])",
      "print(json.dumps(bad))",
    ]);
    expect(JSON.parse(answer)).toEqual([]);
  });

  it("should return the input exactly when the two branches coincide", () => {
    // The degenerate case the README documents and the mutation suite accounts for: the
    // difference is zero, so the external product is the zero ciphertext.
    const answer = probe([
      "from fixtures.generate import (cmux, params, rgsw_encrypt, rgsw_material, ring_noise,",
      "    ring_random, rlwe_encrypt, rlwe_secret)",
      "ok = True",
      "for i in range(8):",
      "    par = params('s', f'L{i}')",
      "    secret = rlwe_secret('s', par)",
      "    ct = rlwe_encrypt(par, secret, [1] * par['degree'], ring_random('s', par, f'd{i}'),",
      "                      ring_noise('s', par, f'd{i}'))",
      "    for mu in (0, 1):",
      "        out = cmux(par, rgsw_encrypt(par, secret, mu, rgsw_material('s', par, f'd{i}{mu}')), ct, ct)",
      "        ok = ok and (out['a'], out['b']) == (ct['a'], ct['b'])",
      "print(ok)",
    ]);
    expect(answer).toBe("True");
  });
});

describe("ac26-w5-cmux-blind-rotation: the loop lands on the phase it never computes", () => {
  it("should match the plaintext model on every parameter set", () => {
    const answer = probe([
      "import json",
      "from fixtures.generate import (blind_rotate, bootstrap_key, lwe_sample, lwe_secret,",
      "    params, reference_model, rlwe_decrypt, rlwe_secret, rlwe_trivial, test_vector)",
      "bad = []",
      "for i in range(12):",
      "    par = params('s', f'L{i}')",
      "    ring_secret = rlwe_secret('s', par, f'r{i}')",
      "    bits = lwe_secret('s', par, f'L{i}')",
      "    key = bootstrap_key('s', par, ring_secret, bits, f'L{i}')",
      "    sample = lwe_sample('s', par, bits, f'L{i}')",
      "    plaintext = test_vector('s', par, f'L{i}')",
      "    out = blind_rotate(par, key, sample, rlwe_trivial(par, plaintext))",
      "    got = rlwe_decrypt(par, ring_secret, out)",
      "    want = reference_model(par, bits, sample, plaintext)",
      "    if got != want:",
      "        bad.append([i, list(got), list(want)])",
      "print(json.dumps(bad))",
    ]);
    expect(JSON.parse(answer)).toEqual([]);
  });

  it("should reach a rotation that actually moved, so the check is not vacuous", () => {
    // If every drawn phase were zero the model and the accumulator would agree trivially.
    const answer = probe([
      "from fixtures.generate import lwe_phase, lwe_sample, lwe_secret, params",
      "phases = set()",
      "for s in 'abcd':",
      "    for i in range(8):",
      "        par = params(s, f'L{i}')",
      "        bits = lwe_secret(s, par, f'L{i}')",
      "        phases.add(lwe_phase(par, bits, lwe_sample(s, par, bits, f'L{i}')))",
      "print(len(phases - {0}) > 0)",
    ]);
    expect(answer).toBe("True");
  });

  it("should never let the secret reach the trace's public fields", () => {
    const answer = probe([
      "import json",
      "from fixtures.generate import (blind_rotate_trace, bootstrap_key, lwe_sample, lwe_secret,",
      "    params, rlwe_secret, rlwe_trivial, test_vector)",
      "bad = []",
      "for i in range(8):",
      "    par = params('s', f'L{i}')",
      "    ring_secret = rlwe_secret('s', par, f'r{i}')",
      "    bits = lwe_secret('s', par, f'L{i}')",
      "    sample = lwe_sample('s', par, bits, f'L{i}')",
      "    acc = rlwe_trivial(par, test_vector('s', par, f'L{i}'))",
      "    left = blind_rotate_trace(par, bootstrap_key('s', par, ring_secret, bits, f'L{i}'), sample, acc)",
      "    flipped = tuple(1 - b for b in bits)",
      "    right = blind_rotate_trace(par, bootstrap_key('s', par, ring_secret, flipped, f'f{i}'), sample, acc)",
      "    for a, b in zip(left, right):",
      "        for field in ('step', 'mask', 'exponent', 'selector'):",
      "            if a[field] != b[field]:",
      "                bad.append([i, field])",
      "print(json.dumps(bad))",
    ]);
    expect(JSON.parse(answer)).toEqual([]);
  });
});

describe("ac26-w5-cmux-blind-rotation: the problem is solvable and actually fails", () => {
  it("should fail the public tests in the shipped starter state", () => {
    const result = python(["tests/public/test_cmux.py"]);
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

describe("ac26-w5-cmux-blind-rotation: /verify contract", () => {
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

  // Each of these is self-consistent somewhere, and only separates once it is measured
  // against something the submission did not build.
  it("should reject a rotation that is reversed in both the primitive and the loop", () => {
    // The public tests compare the loop against its own steps, so this passes all of them.
    const source = bundle("reference").replace(
      "    shift = exponent % (2 * degree)",
      "    shift = (-exponent) % (2 * degree)",
    );
    expect(evaluate("blind", source)).toBe(false);
  }, 180_000);

  it("should reject a circular shift that ignores the negacyclic sign", () => {
    const source = bundle("reference").replace(
      "    return normalize(params, [0] * shift + padded)",
      "    rotated = [padded[(index - shift) % degree] for index in range(degree)]\n"
        + "    return tuple(value % params['modulus'] for value in rotated)",
    );
    expect(evaluate("rotate", source)).toBe(false);
  }, 180_000);

  it("should reject an exponent reduced modulo N instead of 2N", () => {
    const source = bundle("reference").replace(
      "    shift = exponent % (2 * degree)",
      "    shift = exponent % degree",
    );
    expect(evaluate("rotate", source)).toBe(false);
  }, 180_000);

  it("should reject a CMUX that returns ct1, which is right for selector 1", () => {
    const source = bundle("reference").replace(
      "    return rlwe_add(params, ct0, external_product(params, rgsw, rlwe_sub(params, ct1, ct0)))",
      "    return dict(ct1)",
    );
    expect(evaluate("cmux", source)).toBe(false);
    expect(evaluate("constant", source)).toBe(false);
  }, 180_000);

  it("should reject a loop that pairs mask coefficients with the wrong key rows", () => {
    const source = bundle("reference").replace(
      '    for index, mask in enumerate(sample["mask"]):\n'
        + "        current = conditional_rotate(params, key[index], current, mask)\n"
        + "    return current",
      '    for index, mask in enumerate(sample["mask"]):\n'
        + "        current = conditional_rotate(params, key[len(key) - 1 - index], current, mask)\n"
        + "    return current",
    );
    expect(evaluate("blind", source)).toBe(false);
  }, 180_000);

  it("should run transfer under parameters no other checkpoint used", () => {
    expect(read("local/verifier/server.py")).toContain('f"{SEED}:transfer"');
  });

  it("should reject a submission that hangs, rather than hanging itself", () => {
    expect(
      evaluate("rotate", "def monomial_rotate(params, poly, exponent):\n    while True:\n        pass\n"),
    ).toBe(false);
  }, 60_000);

  it("should reject a submission that cannot even be imported", () => {
    expect(evaluate("rotate", "def monomial_rotate(:\n")).toBe(false);
  }, 60_000);

  it("should reject a verdict printed from an atexit hook", () => {
    // The catalog-wide guard lives in verifier-spoof-guard.test.ts; this pins the fix for
    // this problem's own verifier, which is the one a scaffolded copy would carry forward.
    const spoof = [
      "import atexit, json",
      'atexit.register(lambda: print(json.dumps({"failures": []})))',
      "",
    ].join("\n");
    expect(evaluate("combine", spoof)).toBe(false);
  }, 60_000);

  it("should reject an unknown checkpoint id instead of crediting it", () => {
    expect(evaluate("bootstrap", bundle("reference"))).toBe(false);
  });

  it("should echo the checkpointId so the platform can fail closed", () => {
    expect(read("local/verifier/server.py")).toContain(
      '{"checkpointId": checkpoint_id, "correct": correct}',
    );
  });
});

/**
 * Everything above calls `evaluate()` directly, which is how a wrong bind address survives a
 * fully green suite: the scoring logic is perfect and the platform still cannot reach it.
 *
 * A published container port is forwarded to the container's bridge address, so a server
 * listening on 127.0.0.1 *inside* the container accepts nothing from outside it. Every
 * request is opened and closed with no response and no checkpoint can ever score. This
 * problem shipped that fault until it was found by running the container -- the same fault
 * ac26-w7-capstone-design and -demo already carry a guard for, and the same one the rest of
 * the AC26 chain still has.
 *
 * The source assertion is the one that catches it. A round trip on the host passes with
 * either bind address, because there loopback reaches loopback; reproducing it honestly
 * needs the container, and CI has no Docker daemon.
 *
 * Host-side loopback is the compose file's job (`127.0.0.1:<port>:<port>`), asserted in the
 * container-safety block above.
 */
describe("ac26-w5-cmux-blind-rotation: the verifier is reachable, not only correct", () => {
  it("should bind every interface inside the container, not the container's loopback", () => {
    const verifier = read("local/verifier/server.py");
    expect(verifier).not.toMatch(/HTTPServer\(\(\s*["']127\.0\.0\.1["']/);
    expect(verifier).toMatch(/HTTPServer\(\(\s*["']0\.0\.0\.0["']/);
  });

  it("should publish that port on host loopback only, which is where the restriction belongs", () => {
    const compose = read("local/docker-compose.yml");
    const port = JSON.parse(read("metadata.json")).exposedPorts[0].port as number;
    expect(compose).toContain(`"127.0.0.1:${port}:${port}"`);
    expect(JSON.parse(read("metadata.json")).runtime.verifyUrl).toBe(
      `http://127.0.0.1:${port}/verify`,
    );
  });
});

describe("ac26-w5-cmux-blind-rotation: metadata contracts", () => {
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

  it("should sit at order 540, after the external product it builds on", () => {
    expect(metadata().track.order).toBe(540);
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
