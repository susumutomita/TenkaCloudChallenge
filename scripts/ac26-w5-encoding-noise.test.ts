import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import { parse as parseYaml } from "yaml";
import { participantPythonFiles } from "./lib/local-play-problems";

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
      "local/participant/server.py",
      "local/participant/workbench.py",
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
    expect(read("local/Dockerfile")).toMatch(/^FROM \S+@sha256:[0-9a-f]{64}( AS \S+)?$/m);
  });

  it("should never build a shell command out of participant input", () => {
    const verifier = read("local/verifier/server.py");
    expect(verifier).toContain("shell=False");
    expect(verifier).not.toContain("os.system");
    expect(verifier).not.toContain("shell=True");
  });
});

describe("ac26-w5-encoding-noise: participant/verifier separation (Issue 537/538)", () => {
  it("keeps fixtures/, the five graded implementations and the hidden suite out of the participant Docker stage", () => {
    const dockerfile = read("local/Dockerfile");
    const participantStage = dockerfile.slice(
      dockerfile.indexOf("FROM base AS participant"),
      dockerfile.indexOf("FROM base AS verifier"),
    );
    // The class this problem was scaffolded with before this fix: `fixtures/` shipping
    // to the participant stage put complete `encode`, `centered`, `decode`,
    // `success_interval` and `first_failure` implementations -- under the exact five
    // names the starter's own stubs ask the learner to write -- in the same container a
    // learner's own build produced, and `tests/hidden/check_encoding.py` shipping there
    // put every checkpoint's own assertions right alongside them.
    expect(participantStage).not.toContain("COPY --chown=lab:lab fixtures/");
    expect(participantStage).not.toContain("tests/hidden");
    expect(participantStage).not.toContain("COPY --chown=lab:lab verifier/");
    expect(participantStage).not.toContain("COPY --chown=lab:lab reference/");
    expect(participantStage).not.toContain("COPY --chown=lab:lab mutation.py");
    expect(participantStage).toContain("COPY --chown=lab:lab tests/public/");
    expect(participantStage).toContain("COPY --chown=lab:lab participant/");

    const verifierStage = dockerfile.slice(
      dockerfile.indexOf("FROM base AS verifier"),
      dockerfile.indexOf("FROM participant AS author"),
    );
    expect(verifierStage).toContain("COPY --chown=lab:lab fixtures/");
    expect(verifierStage).toContain("COPY --chown=lab:lab tests/hidden/");
    expect(verifierStage).toContain("COPY --chown=lab:lab verifier/");
    expect(verifierStage).not.toContain("COPY --chown=lab:lab participant/");
    expect(verifierStage).not.toContain("COPY --chown=lab:lab reference/");
    expect(verifierStage).not.toContain("COPY --chown=lab:lab mutation.py");
  });

  it("reproduces the original leak: no file the participant image carries reaches a working encode/centered/decode/success_interval/first_failure", () => {
    // The file list comes from the Dockerfile's participant stage, via the same
    // derivation `check-answer-reachability.ts` uses, rather than being restated here --
    // so a COPY that puts `fixtures/` or `tests/hidden/` back fails this test.
    const participantFiles = participantPythonFiles(
      join(import.meta.dir, ".."),
      "challenges/ac26-w5-encoding-noise",
    );
    expect(participantFiles).not.toContain(
      "challenges/ac26-w5-encoding-noise/local/fixtures/generate.py",
    );
    expect(participantFiles).not.toContain(
      "challenges/ac26-w5-encoding-noise/local/tests/hidden/check_encoding.py",
    );
    expect(participantFiles).toContain(
      "challenges/ac26-w5-encoding-noise/local/tests/public/test_encoding.py",
    );
    for (const file of participantFiles) {
      const source = readFileSync(join(import.meta.dir, "..", file), "utf8");
      // The one permitted mention is the lazy, function-scoped checkout/author
      // fallback: never a module-level import, which is what would fail loudly the
      // moment it ran inside a participant image that carries no `fixtures/` at all.
      expect(source).not.toMatch(/^from fixtures/m);
      expect(source).not.toMatch(/^import fixtures/m);
    }
    // The starter's own stubs stay -- that is the file the learner edits, and it never
    // held a working implementation. What must not be reachable is a WORKING one, which
    // only ever lived in `fixtures/generate.py`, asserted absent above.
    const starter = bundle("starter");
    for (const name of ["encode", "centered", "decode", "success_interval", "first_failure"]) {
      expect(starter).toContain(`def ${name}(`);
      const rest = starter.slice(starter.indexOf(`def ${name}(`) + 1);
      const nextDef = rest.indexOf("\ndef ");
      const body = nextDef === -1 ? rest : rest.slice(0, nextDef);
      // The whole body is one placeholder return. Anything else here would mean the
      // starter itself is handing over part of the answer.
      expect(body.split("\n").filter((line) => /^\s+\S/.test(line) && !/^\s+#/.test(line))
        .at(-1)).toMatch(/^\s+return (0|\(0, 0\))$/);
    }
  });

  it("keeps the Portal editor API and the fixtures import on opposite sides of the split", () => {
    const participantServer = read("local/participant/server.py");
    const hiddenServer = read("local/verifier/server.py");
    for (const endpoint of [
      "/api/config",
      "/api/inspect",
      "/api/starter",
      "/api/test",
      "/api/prepare",
    ]) {
      expect(participantServer).toContain(endpoint);
      expect(hiddenServer).not.toContain(endpoint);
    }
    expect(participantServer).not.toContain("def evaluate(");
    expect(participantServer).not.toContain("def _run_submission(");
    expect(participantServer).not.toMatch(/^from fixtures/m);
    expect(hiddenServer).toContain("from fixtures.generate import");
    expect(hiddenServer).toContain("/verify");
    expect(hiddenServer).toContain("/healthz");
    expect(hiddenServer).toContain("/public");
  });

  it("re-checks the answer seal in the verifier, so bypassing the Workbench does not credit a bare answer", () => {
    const script = [
      "import json, sys",
      "sys.path.insert(0, '.')",
      "from verifier.server import _unwrap_submission",
      "print(json.dumps({",
      "  'forged': _unwrap_submission('decode', 'tcw1.eyJ2IjoxfQ.AAAA'),",
      "  'code': _unwrap_submission('decode', 'def decode(params, c): pass'),",
      "}))",
    ].join("\n");
    const result = python(["-c", script]);
    expect(result.status).toBe(0);
    const output = JSON.parse(result.stdout.trim().split("\n").at(-1) ?? "{}") as {
      forged: unknown;
      code: unknown;
    };
    expect(output.forged).toBeNull();
    expect(output.code).toBe("def decode(params, c): pass");
  });

  it("proxies /verify to the internal verifier and fails closed when it is unreachable", () => {
    const script = String.raw`
import json, sys
sys.path.insert(0, ".")
from participant import server
bodies = [{"checkpointId": checkpoint, "submission": "anything"} for checkpoint in server.CHECKPOINTS]
print(json.dumps({
    "missing": [server.proxy_verdict(body, "") for body in bodies],
    "unavailable": [server.proxy_verdict(body, "http://127.0.0.1:1/verify") for body in bodies],
    "hasInlineEvaluator": hasattr(server, "evaluate") or hasattr(server, "_run_submission"),
}))
`;
    const result = python(["-c", script]);
    expect(result.status).toBe(0);
    const output = JSON.parse(result.stdout.trim().split("\n").at(-1) ?? "{}") as {
      missing: Array<{ checkpointId: string; correct: boolean }>;
      unavailable: Array<{ checkpointId: string; correct: boolean }>;
      hasInlineEvaluator: boolean;
    };
    const expectedVerdicts = CHECKPOINTS.map((checkpointId) => ({ checkpointId, correct: false }));
    expect(output.missing).toEqual(expectedVerdicts);
    expect(output.unavailable).toEqual(expectedVerdicts);
    expect(output.hasInlineEvaluator).toBe(false);
  });

  it("compose builds the right target for each service, publishes only the Workbench port, and isolates the verifier network", () => {
    const compose = read("local/docker-compose.yml");
    for (const contract of [
      "target: participant",
      "target: verifier",
      '"127.0.0.1:18107:18107"',
      "VERIFIER_URL: http://verifier:18145/verify",
      "VERIFIER_PUBLIC_URL: http://verifier:18145/public",
      "read_only: true",
      "cap_drop:",
      "- ALL",
      "no-new-privileges:true",
      "healthcheck:",
      "internal: true",
      'com.docker.network.bridge.enable_ip_masquerade: "false"',
    ]) {
      expect(compose).toContain(contract);
    }
    expect(compose).not.toContain('"127.0.0.1:18145:18145"');
    expect(compose.match(/ports:/g)).toHaveLength(1);
  });

  it("serves the public half without any function a learner is graded on writing", () => {
    const payload = JSON.parse(
      probe([
        "import json",
        "from fixtures.generate import public_payload",
        "print(json.dumps(public_payload('ci-fixed-seed')))",
      ]),
    ) as Record<string, unknown>;
    expect(Object.keys(payload).sort()).toEqual([
      "healthToken",
      "invalidParams",
      "params",
      "points",
      "successInterval",
      "walk",
    ]);
    // Values only. `VALID_PARAMS` is the half of `validate_params`'s answer `show.py`
    // has never printed, so it is not in here either.
    expect(JSON.stringify(payload)).not.toContain("def ");
    expect(payload).not.toHaveProperty("validParams");
  });

  it("renders the whole `make inspect` page from the public half alone, with no fixtures import", () => {
    // Every section show.py has always printed is still there, built only from what
    // `GET /public` serves -- across both parities of delta and both ends of the p
    // range. That the page is byte-identical to the pre-split one is checked against
    // the previous revision by hand (see the PR), not here: this file can only see the
    // current one.
    const rendered = JSON.parse(
      probe([
        "import io, json, os, contextlib, importlib",
        "from fixtures.generate import public_payload",
        "import show",
        "out = {}",
        'for seed in ("ci-fixed-seed", "seed-b", "12345", "xyz"):',
        '    os.environ["PUBLIC_EVIDENCE_JSON"] = json.dumps(public_payload(seed))',
        "    importlib.reload(show)",
        "    buffer = io.StringIO()",
        "    with contextlib.redirect_stdout(buffer):",
        "        show.main()",
        "    out[seed] = buffer.getvalue()",
        "print(json.dumps(out))",
      ]),
    ) as Record<string, string>;
    for (const [seed, page] of Object.entries(rendered)) {
      expect(page).toContain("health token :");
      expect(page).toContain("tolerated noise:");
      expect(page).toContain("parameter sets that must be rejected:");
      expect(page.length).toBeGreaterThan(400);
      expect(seed.length).toBeGreaterThan(0);
    }
    expect(new Set(Object.values(rendered)).size).toBe(4);
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
