import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import { parse as parseYaml } from "yaml";
import { participantPythonFiles } from "./lib/local-play-problems";

/**
 * ac26-w3-field-inverse is Week 3's first problem. The assertions that carry weight run
 * its Python for real. The sharpest one covers the defect a working implementation is
 * most likely to contain: computing the inverse by Fermat's little theorem, which is
 * right on every prime and silently wrong on a composite. Python 3 is on ubuntu-latest
 * and the problem is stdlib-only.
 */

const ROOT = join(import.meta.dir, "..", "challenges", "ac26-w3-field-inverse");
const LOCAL = join(ROOT, "local");
const SEED = "ci-fixed-seed";
const CHECKPOINTS = [
  "normalize",
  "arithmetic",
  "egcd-trace",
  "inverse",
  "errors",
  "composite",
  "axioms",
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
  return read(`local/${dir}/field.py`);
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

/** The reference, inverting by Fermat's little theorem. Correct over every prime. */
function fermatInverse(): string {
  const source = bundle("reference").replace(
    /        g, s, _t = egcd\(self\.value, self\.field\.modulus\)[\s\S]*?return FieldElement\(self\.field, s\)/,
    "        return FieldElement(\n" +
      "            self.field, pow(self.value, self.field.modulus - 2, self.field.modulus)\n" +
      "        )",
  );
  expect(source).toContain("pow(self.value, self.field.modulus - 2");
  expect(source).not.toContain("g, s, _t = egcd(");
  return source;
}

describe("ac26-w3-field-inverse: participant contract", () => {
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
      "local/tests/public/test_field.py",
      "local/tests/hidden/check_field.py",
      "local/verifier/server.py",
      "local/starter/field.py",
      "local/reference/field.py",
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

  // `make inspect A=17 P=101` only works if the env flags precede the image name;
  // appended after it, docker reads them as the command and the target breaks.
  it("should pass A and P to docker as flags, not as the container command", () => {
    const makefile = read("Makefile");
    const inspectLine = makefile
      .split("\n")
      .find((line) => line.includes("python show.py") && !line.includes("test"));
    expect(inspectLine).toContain("$(RUN_INSPECT)");
    const runInspect = makefile.slice(makefile.indexOf("RUN_INSPECT :="));
    expect(runInspect.indexOf("-e A=$(A)")).toBeLessThan(runInspect.indexOf("$(IMAGE)"));
    expect(runInspect.indexOf("-e P=$(P)")).toBeLessThan(runInspect.indexOf("$(IMAGE)"));
  });
});

describe("ac26-w3-field-inverse: container safety", () => {
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

describe("ac26-w3-field-inverse: fixtures are seed-derived", () => {
  it("should produce different moduli for different seeds", () => {
    const script = [
      "import json, sys",
      "sys.path.insert(0, '.')",
      "from fixtures.generate import composite_modulus, health_token, prime_modulus",
      "s = sys.argv[1]",
      "print(json.dumps([prime_modulus(s), composite_modulus(s), health_token(s)]))",
    ].join("\n");
    const first = python(["-c", script, "seed-alpha"]).stdout.trim();
    const second = python(["-c", script, "seed-beta"]).stdout.trim();
    const again = python(["-c", script, "seed-alpha"]).stdout.trim();

    expect(first).not.toBe(second);
    expect(first).toBe(again);
  });

  // The whole composite checkpoint rests on these actually being what they claim.
  it("should only ever offer genuine primes and genuine composites", () => {
    const script = [
      "import sys",
      "sys.path.insert(0, '.')",
      "from fixtures.generate import COMPOSITES, PRIMES",
      "def is_prime(n):",
      "    return n > 1 and all(n % d for d in range(2, int(n ** 0.5) + 1))",
      "print(all(is_prime(p) for p in PRIMES), not any(is_prime(n) for n in COMPOSITES))",
    ].join("\n");
    expect(python(["-c", script]).stdout.trim()).toBe("True True");
  });

  it("should hand the learner negatives and values past the modulus", () => {
    const script = [
      "import sys",
      "sys.path.insert(0, '.')",
      "from fixtures.generate import prime_modulus, sample_values",
      "p = prime_modulus('s0')",
      "vs = sample_values('s0', 'h0', p)",
      "print(any(v < 0 for v in vs), any(v >= p for v in vs), 0 in vs)",
    ].join("\n");
    expect(python(["-c", script]).stdout.trim()).toBe("True True True");
  });
});

describe("ac26-w3-field-inverse: the problem is solvable and actually fails", () => {
  it("should fail the public tests in the shipped starter state", () => {
    const result = python(["tests/public/test_field.py"]);
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

describe("ac26-w3-field-inverse: /verify contract", () => {
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

  // The defect the whole problem is aimed at. Fermat's little theorem is a correct
  // inverse over every prime, so it clears the prime checkpoints and fails only where
  // the modulus is composite — which is precisely the distinction being taught.
  it("should accept a Fermat inverse on the prime checkpoints and reject it on composite", () => {
    const source = fermatInverse();
    expect(evaluate("inverse", source)).toBe(true);
    expect(evaluate("axioms", source)).toBe(true);
    expect(evaluate("composite", source)).toBe(false);
  }, 180_000);

  // Half a trace: every row satisfies Bezout, the last row is the right one, and it is
  // still not a trace. This survived the checkpoint's first version.
  it("should reject a trace that contains only its last row", () => {
    const source = bundle("reference").replace(
      '        rows.append({"q": q, "r": old_r, "s": old_s, "t": old_t})\n    return rows',
      '        rows.append({"q": q, "r": old_r, "s": old_s, "t": old_t})\n    return rows[-1:]',
    );
    expect(source).toContain("return rows[-1:]");
    expect(evaluate("egcd-trace", source)).toBe(false);
  }, 120_000);

  it("should reject an implementation that reduces only at the end", () => {
    const source = bundle("reference").replace(
      "        self.value = value % field.modulus",
      "        self.value = value",
    );
    expect(evaluate("normalize", source)).toBe(false);
  }, 120_000);

  it("should reject an implementation that hands zero an inverse", () => {
    const source = bundle("reference").replace(
      '        if self.value == 0:\n            raise NotInvertible("zero has no multiplicative inverse")',
      "        if self.value == 0:\n            return FieldElement(self.field, 0)",
    );
    expect(evaluate("errors", source)).toBe(false);
  }, 120_000);

  it("should reject a submission that hangs, rather than hanging itself", () => {
    expect(
      evaluate("normalize", "class Field:\n    def __init__(self, m):\n        while True:\n            pass\n"),
    ).toBe(false);
  }, 60_000);

  it("should reject a submission that cannot even be imported", () => {
    expect(evaluate("normalize", "class Field(:\n")).toBe(false);
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

describe("ac26-w3-field-inverse: metadata contracts", () => {
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

  // Week 3 IS published upstream, so unlike Week 2 this problem pins the real lecture
  // and assignment it sits beside rather than a placeholder.
  it("should pin the published week 3 lecture and assignment", () => {
    const { courseAlignment, status } = metadata();
    expect(courseAlignment.week).toBe(3);
    expect(courseAlignment.role).toBe("mechanism");
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

/**
 * Issue 537/538 (Issue 543 option B2). Before this split the single `participant` stage
 * carried `fixtures/`, `tests/hidden/` and `verifier/` together: every checkpoint is
 * graded by running `tests/hidden/check_field.py` against the learner's file, and
 * `fixtures/generate.py` implements `egcd` under the exact name `starter/field.py`'s own
 * stub asks the learner to write, with `egcd_rows` supplying the row-for-row trace its
 * `egcd_trace` stub asks for. The assertions below fail the moment either directory is
 * copied back into that stage.
 */
function probe(lines: string[]): string {
  const result = python(["-c", lines.join("\n")]);
  expect(result.stderr).toBe("");
  expect(result.status).toBe(0);
  return result.stdout.trim().split("\n").at(-1) ?? "";
}

describe("ac26-w3-field-inverse: participant/verifier separation (Issue 537/538)", () => {
  it("keeps fixtures/, the graded egcd implementation and the hidden suite out of the participant Docker stage", () => {
    const dockerfile = read("local/Dockerfile");
    const participantStage = dockerfile.slice(
      dockerfile.indexOf("FROM base AS participant"),
      dockerfile.indexOf("FROM base AS verifier"),
    );
    expect(participantStage).not.toContain("COPY fixtures/");
    expect(participantStage).not.toContain("tests/hidden");
    expect(participantStage).not.toContain("COPY verifier/");
    expect(participantStage).not.toContain("COPY reference/");
    expect(participantStage).not.toContain("COPY mutation.py");
    expect(participantStage).toContain("COPY tests/public/");
    expect(participantStage).toContain("COPY participant/");

    const verifierStage = dockerfile.slice(
      dockerfile.indexOf("FROM base AS verifier"),
      dockerfile.indexOf("FROM participant AS author"),
    );
    expect(verifierStage).toContain("COPY fixtures/");
    expect(verifierStage).toContain("COPY tests/hidden/");
    expect(verifierStage).toContain("COPY verifier/");
    expect(verifierStage).not.toContain("COPY participant/");
    expect(verifierStage).not.toContain("COPY reference/");
    expect(verifierStage).not.toContain("COPY mutation.py");
  });

  it("reproduces the original leak: no file the participant image carries reaches a working egcd or egcd_rows", () => {
    // The file list comes from the Dockerfile's participant stage, via the same
    // derivation `check-answer-reachability.ts` uses, rather than being restated here --
    // so a COPY that puts `fixtures/` or `tests/hidden/` back fails this test.
    const participantFiles = participantPythonFiles(
      join(import.meta.dir, ".."),
      "challenges/ac26-w3-field-inverse",
    );
    expect(participantFiles).not.toContain(
      "challenges/ac26-w3-field-inverse/local/fixtures/generate.py",
    );
    expect(participantFiles).not.toContain(
      "challenges/ac26-w3-field-inverse/local/tests/hidden/check_field.py",
    );
    expect(participantFiles).toContain(
      "challenges/ac26-w3-field-inverse/local/tests/public/test_field.py",
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
    expect(starter).toContain("def egcd(");
    expect(starter).toContain("    return (0, 0, 0)");
    expect(starter).toContain("def egcd_trace(");
    expect(starter).toContain("    return []");
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
    const output = JSON.parse(
      probe([
        "import json, sys",
        "sys.path.insert(0, '.')",
        "from verifier.server import _unwrap_submission",
        "print(json.dumps({",
        "  'forged': _unwrap_submission('inverse', 'tcw1.eyJ2IjoxfQ.AAAA'),",
        "  'code': _unwrap_submission('inverse', 'class Field: pass'),",
        "}))",
      ]),
    ) as { forged: unknown; code: unknown };
    expect(output.forged).toBeNull();
    expect(output.code).toBe("class Field: pass");
  });

  it("proxies /verify to the internal verifier and fails closed when it is unreachable", () => {
    const output = JSON.parse(
      probe([
        "import json, sys",
        'sys.path.insert(0, ".")',
        "from participant import server",
        'bodies = [{"checkpointId": c, "submission": "anything"} for c in server.CHECKPOINTS]',
        "print(json.dumps({",
        '    "missing": [server.proxy_verdict(body, "") for body in bodies],',
        '    "unavailable": [server.proxy_verdict(body, "http://127.0.0.1:1/verify") for body in bodies],',
        '    "hasInlineEvaluator": hasattr(server, "evaluate") or hasattr(server, "_run_submission"),',
        "}))",
      ]),
    ) as {
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
      '"127.0.0.1:18100:18100"',
      "VERIFIER_URL: http://verifier:18146/verify",
      "VERIFIER_PUBLIC_URL: http://verifier:18146/public",
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
    expect(compose).not.toContain('"127.0.0.1:18146:18146"');
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
      "compositeModulus",
      "healthToken",
      "primeModulus",
      "smallestNonInvertible",
      "trace",
    ]);
    // Values only. `PRIMES` and `COMPOSITES` are the pools other deployments draw from,
    // which this deployment's `make inspect` has never printed, so they are not in here.
    expect(JSON.stringify(payload)).not.toContain("def ");
    expect(payload).not.toHaveProperty("primes");
    expect(payload).not.toHaveProperty("composites");
  });

  it("traces whatever pair `make inspect A=.. P=..` names, and defaults to this deployment's own", () => {
    const traced = JSON.parse(
      probe([
        "import json",
        "from fixtures.generate import default_trace_subject, public_payload",
        "chosen = public_payload('ci-fixed-seed', 17, 101)",
        "fallback = public_payload('ci-fixed-seed', 0, 0)",
        "a, modulus = default_trace_subject('ci-fixed-seed')",
        "print(json.dumps({",
        "  'chosen': chosen['trace'], 'fallback': fallback['trace'],",
        "  'default': {'a': a, 'modulus': modulus},",
        "}))",
      ]),
    ) as {
      chosen: { a: number; modulus: number; gcd: number; inverse: number; verification: number };
      fallback: { a: number; modulus: number };
      default: { a: number; modulus: number };
    };
    expect(traced.chosen.a).toBe(17);
    expect(traced.chosen.modulus).toBe(101);
    expect(traced.chosen.gcd).toBe(1);
    expect((17 * traced.chosen.inverse) % 101).toBe(1);
    expect(traced.chosen.verification).toBe(1);
    // A zero means "this deployment's default", exactly as it did when show.py computed
    // the default itself from an imported prime_modulus.
    expect(traced.fallback.a).toBe(traced.default.a);
    expect(traced.fallback.modulus).toBe(traced.default.modulus);
  });

  it("renders the whole `make inspect` page from the public half alone, with no fixtures import", () => {
    // Every section show.py has always printed is still there, built only from what
    // `GET /public` serves. That the page is byte-identical to the pre-split one is
    // checked against the previous revision by hand (see the PR), not here: this file
    // can only see the current one.
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
        "        show.main([])",
        "    out[seed] = buffer.getvalue()",
        "print(json.dumps(out))",
      ]),
    ) as Record<string, string>;
    for (const page of Object.values(rendered)) {
      for (const section of [
        "health token     :",
        "prime modulus    :",
        "composite modulus:",
        "smallest non-invertible element:",
        "extended Euclid for a =",
        "   step |     q |     r |     s |     t",
        "  gcd            :",
        "  inverse         :",
        "  verification    :",
      ]) {
        expect(page).toContain(section);
      }
    }
    expect(new Set(Object.values(rendered)).size).toBe(Object.keys(rendered).length);
  });
});
