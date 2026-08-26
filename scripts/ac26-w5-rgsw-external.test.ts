import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import { participantPythonFiles } from "./lib/local-play-problems";
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
    expect(read("local/Dockerfile")).toMatch(/^FROM \S+@sha256:[0-9a-f]{64}( AS \S+)?$/m);
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

describe("ac26-w5-rgsw-external: participant/verifier separation (Issue 543/537)", () => {
  it("keeps the fixture derivation and hidden suite out of the participant Docker stage", () => {
    const dockerfile = read("local/Dockerfile");
    const participantStage = dockerfile.slice(
      dockerfile.indexOf("FROM base AS participant"),
      dockerfile.indexOf("FROM base AS verifier"),
    );
    expect(participantStage).not.toContain("COPY --chown=lab:lab tests/hidden/");
    expect(participantStage).not.toContain("COPY --chown=lab:lab verifier/");
    expect(participantStage).not.toContain("COPY --chown=lab:lab reference/");
    expect(participantStage).not.toContain("COPY --chown=lab:lab mutation.py");
    // Issue 543 option B2: `fixtures/` is on the verifier's side of the boundary too.
    expect(participantStage).not.toContain("COPY --chown=lab:lab fixtures/");
    expect(participantStage).toContain("COPY --chown=lab:lab tests/public/");
    expect(participantStage).toContain("COPY --chown=lab:lab participant/");
    expect(participantStage).toContain("COPY --chown=lab:lab starter/");

    const verifierStage = dockerfile.slice(
      dockerfile.indexOf("FROM base AS verifier"),
      dockerfile.indexOf("FROM participant AS author"),
    );
    expect(verifierStage).toContain("COPY --chown=lab:lab fixtures/");
    expect(verifierStage).toContain("COPY --chown=lab:lab tests/hidden/");
    expect(verifierStage).toContain("COPY --chown=lab:lab verifier/");
    // The supplied ring, and only that: the Portal server and its adapter must not
    // reach the grading image, so the whole `participant/` package is never copied.
    expect(verifierStage).toContain("COPY --chown=lab:lab participant/ring.py");
    expect(verifierStage).not.toContain("COPY --chown=lab:lab participant/ ");
    expect(verifierStage).not.toContain("COPY --chown=lab:lab reference/");
    expect(verifierStage).not.toContain("COPY --chown=lab:lab mutation.py");

    // The author target is `FROM participant`, so dropping fixtures/ above takes it out
    // of the author image too unless it is copied back -- and mutation.py, the hidden
    // suite and the seed sweep all need it.
    const authorStage = dockerfile.slice(dockerfile.indexOf("FROM participant AS author"));
    expect(authorStage).toContain("COPY --chown=lab:lab fixtures/");
    expect(authorStage).toContain("COPY --chown=lab:lab tests/hidden/");
  });

  it("reproduces the original leak: the ten graded functions are no longer in the participant image", () => {
    // Before Issue 543's option B2, `fixtures/generate.py` shipped in the single
    // participant stage. It has to implement working `gadget_vector`, `decompose`,
    // `recompose`, `decompose_poly`, `recompose_poly`, `levels_needed`,
    // `smallest_unrepresentable`, `rgsw_encrypt`, `external_product` and
    // `external_trace` to derive this deployment's rows, traces and boundary witness --
    // the same names `starter/rgsw.py` asks the learner to write -- so every one of them
    // was one import away, with no comparison anywhere near them. The file list below
    // comes from the Dockerfile via the same derivation `check-answer-reachability.ts`
    // uses, so a COPY that puts `fixtures/` back fails this test.
    const repoRoot = join(import.meta.dir, "..");
    const participantFiles = participantPythonFiles(
      repoRoot,
      "challenges/ac26-w5-rgsw-external",
    );
    expect(participantFiles).not.toContain(
      "challenges/ac26-w5-rgsw-external/local/fixtures/generate.py",
    );
    expect(participantFiles).toContain(
      "challenges/ac26-w5-rgsw-external/local/tests/public/test_rgsw.py",
    );
    expect(participantFiles).toContain("challenges/ac26-w5-rgsw-external/local/show.py");
    const graded = [
      "gadget_vector",
      "decompose",
      "recompose",
      "decompose_poly",
      "recompose_poly",
      "levels_needed",
      "smallest_unrepresentable",
      "rgsw_encrypt",
      "external_product",
      "external_trace",
    ];
    for (const file of participantFiles) {
      const source = readFileSync(join(repoRoot, file), "utf8");
      // The one permitted mention is the lazy, function-scoped checkout/author
      // fallback: never a module-level import, which is what would fail loudly the
      // moment it ran inside a participant image that carries no `fixtures/` at all.
      expect(source).not.toMatch(/^from fixtures/m);
      expect(source).not.toMatch(/^import fixtures/m);
      // `starter/rgsw.py` is the one file that may define these names -- as the empty
      // stubs the learner fills in. Anywhere else in the participant image, a
      // definition of the same name is a working implementation of the problem.
      if (file.includes("/starter/")) continue;
      for (const name of graded) expect(source).not.toContain(`def ${name}(`);
    }

    // And the leak is real, not hypothetical. Hand `fixtures.generate` itself to the
    // hidden suite as if it were the learner's file and six of the eight checkpoints
    // pass with nothing written -- 220 of the problem's 300 points for one import. The
    // remaining two fail on a single stated requirement the fixtures have no use for
    // (rejecting a selector outside {0, 1}), not because the gadget, the decomposition
    // or the external product was any work.
    const free = JSON.parse(
      probe([
        "import json",
        "from tests.hidden import check_rgsw",
        "from fixtures import generate",
        "phases = ('check_decompose', 'check_gadget', 'check_polynomial',",
        "          'check_external', 'check_trace', 'check_failure')",
        "print(json.dumps({p: getattr(check_rgsw, p)(generate, 'ci-fixed-seed') for p in phases}))",
      ]),
    ) as Record<string, string[]>;
    expect(free).toEqual({
      check_decompose: [],
      check_gadget: [],
      check_polynomial: [],
      check_external: [],
      check_trace: [],
      check_failure: [],
    });
  });

  it("serves the public half over the verifier's GET /public, and no expected value", () => {
    const payload = JSON.parse(
      probe([
        "import json",
        "from fixtures.generate import public_payload",
        "print(json.dumps(public_payload('ci-fixed-seed')))",
      ]),
    ) as Record<string, unknown>;
    expect(Object.keys(payload).sort()).toEqual([
      "budget",
      "cases",
      "ciphertext",
      "decomposition",
      "exhaustion",
      "gadget",
      "healthToken",
      "inputs",
      "noiseBound",
      "params",
    ]);
    // Every key above was already printed by `make inspect` before the split, or is an
    // argument the graded functions receive anyway. What must not appear is a value the
    // hidden suite compares a submission against on a parameter set the submission is
    // graded on: `transfer` runs under a derived seed, so its parameters -- and every
    // row, trace and witness derived from them -- are absent here.
    const transfer = JSON.parse(
      probe([
        "import json",
        "from fixtures.generate import params, public_payload",
        "print(json.dumps([params('ci-fixed-seed:transfer'), public_payload('ci-fixed-seed')['params']]))",
      ]),
    ) as [Record<string, number>, Record<string, number>];
    expect(transfer[0]).not.toEqual(transfer[1]);

    const verifier = read("local/verifier/server.py");
    expect(verifier).toContain('path == "/public"');
    expect(verifier).toContain('path == "/healthz"');
    // The Portal surface belongs to the participant image, not here.
    for (const route of ["/api/config", "/api/inspect", "/api/starter", "/api/test", "/api/prepare"]) {
      expect(verifier).not.toContain(route);
    }
  });

  it("wires the Workbench to the verifier over an internal-only network", () => {
    const compose = parseYaml(read("local/docker-compose.yml")) as {
      services: Record<
        string,
        { ports?: string[]; networks?: string[]; environment?: Record<string, string> }
      >;
      networks: Record<string, { internal?: boolean }>;
    };
    expect(Object.keys(compose.services).sort()).toEqual(["verifier", "workbench"]);
    // The published port and the /verify URL the platform holds are unchanged.
    expect(compose.services.workbench.ports).toEqual(["127.0.0.1:18109:18109"]);
    expect(compose.services.verifier.ports ?? []).toEqual([]);
    expect(compose.services.workbench.environment?.VERIFIER_URL).toBe(
      "http://verifier:18141/verify",
    );
    expect(compose.services.workbench.environment?.VERIFIER_PUBLIC_URL).toBe(
      "http://verifier:18141/public",
    );
    expect(compose.services.verifier.networks).toEqual(["lab"]);
    expect(compose.networks.lab.internal).toBe(true);
  });

  it("fails a checkpoint closed when the verifier cannot be reached", () => {
    const script = [
      "import json, sys",
      "sys.path.insert(0, '.')",
      "from participant.server import proxy_verdict",
      "body = {'checkpointId': 'external', 'submission': 'whatever'}",
      // An address nothing is listening on, and the empty URL a mis-wired deployment
      // would hand this process.
      "print(json.dumps([",
      "  proxy_verdict(body, 'http://127.0.0.1:1/verify'),",
      "  proxy_verdict(body, ''),",
      "]))",
    ];
    const verdicts = JSON.parse(probe(script)) as { checkpointId: string; correct: boolean }[];
    for (const verdict of verdicts) {
      expect(verdict).toEqual({ checkpointId: "external", correct: false });
    }
  });

  it("keeps the supplied ring readable, with one definition behind it", () => {
    // `starter/rgsw.py` imports the ring on its first line, so it has to survive the
    // split -- and it has to be the same code the fixtures and the hidden suite use, or
    // a learner would be graded against arithmetic they cannot run.
    expect(existsSync(join(LOCAL, "participant", "ring.py"))).toBe(true);
    for (const path of ["README.md", "README.ja.md", "local/starter/rgsw.py"]) {
      expect(read(path)).not.toContain("fixtures.generate");
    }
    expect(read("README.md")).toContain("participant.ring");
    expect(read("README.ja.md")).toContain("participant.ring");
    const definitions = probe([
      "import json",
      "from fixtures.generate import ring_mul as viaFixtures, rlwe_encrypt as encFixtures",
      "from participant.ring import ring_mul as viaParticipant, rlwe_encrypt as encParticipant",
      "print(json.dumps(viaFixtures is viaParticipant and encFixtures is encParticipant))",
    ]);
    expect(JSON.parse(definitions)).toBe(true);
  });
});
