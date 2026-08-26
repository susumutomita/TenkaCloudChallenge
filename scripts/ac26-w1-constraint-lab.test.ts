import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import { parse as parseYaml } from "yaml";

/**
 * ac26-w1-constraint-lab is the first Week 1 problem. The interesting assertions run its
 * Python for real — the starter fails, the reference passes every checkpoint, the mutation
 * suite kills every intended defect, and /verify holds its security contract — rather than
 * reading source text. Python 3 is on ubuntu-latest and the problem is stdlib-only.
 */

const ROOT = join(import.meta.dir, "..", "challenges", "ac26-w1-constraint-lab");
const LOCAL = join(ROOT, "local");
const SEED = "ci-fixed-seed";
const SUBMITTED = ["field.py", "circuit.py", "gadgets.py"] as const;

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
  return JSON.stringify(
    Object.fromEntries(SUBMITTED.map((name) => [name, read(`local/${dir}/${name}`)])),
  );
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

function firstBrokenAnswer(): { constraintId: string; residual: number } {
  const script = [
    "import json, os, sys",
    "sys.path.insert(0, '.')",
    "from fixtures.generate import broken_diagnosis",
    "print(json.dumps(broken_diagnosis(os.environ['FLAG_SEED'])))",
  ].join("\n");
  const result = python(["-c", script]);
  expect(result.status).toBe(0);
  return JSON.parse(result.stdout.trim()) as { constraintId: string; residual: number };
}

describe("ac26-w1-constraint-lab: participant contract", () => {
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
      "local/tests/public/test_circuit.py",
      "local/tests/hidden/check_circuit.py",
      "local/verifier/server.py",
      "local/participant/server.py",
      ...SUBMITTED.flatMap((name) => [`local/starter/${name}`, `local/reference/${name}`]),
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

describe("ac26-w1-constraint-lab: container safety", () => {
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

describe("ac26-w1-constraint-lab: fixtures are seed-derived", () => {
  it("should produce different circuits for different seeds", () => {
    const script = [
      "import json, sys",
      "sys.path.insert(0, '.')",
      "from fixtures.generate import circuit, field_modulus, health_token",
      "seed = sys.argv[1]",
      "print(json.dumps({'p': field_modulus(seed), 'c': circuit(seed), 't': health_token(seed)}))",
    ].join("\n");
    const first = python(["-c", script, "seed-alpha"]).stdout.trim();
    const second = python(["-c", script, "seed-beta"]).stdout.trim();
    const again = python(["-c", script, "seed-alpha"]).stdout.trim();

    expect(first).not.toBe(second);
    expect(first).toBe(again);
  });

  it("should never place the injected break at the first constraint", () => {
    const script = [
      "import sys",
      "sys.path.insert(0, '.')",
      "from fixtures.generate import broken_witness",
      "print(','.join(broken_witness('s%d' % i)[1] for i in range(40)))",
    ].join("\n");
    const ids = python(["-c", script]).stdout.trim().split(",");
    expect(ids.length).toBe(40);
    expect(ids).not.toContain("c0");
  });

  it("should bind first-broken to the seeded residual, not a two-way guess", () => {
    const script = [
      "import json, sys",
      "sys.path.insert(0, '.')",
      "from fixtures.generate import broken_diagnosis",
      "answers = [json.dumps(broken_diagnosis(f'solvability-{i}'), sort_keys=True) for i in range(2000)]",
      "counts = {answer: answers.count(answer) for answer in set(answers)}",
      "print(json.dumps({'distinct': len(counts), 'max': max(counts.values())}))",
    ].join("\n");
    const result = python(["-c", script]);
    expect(result.status).toBe(0);
    const distribution = JSON.parse(result.stdout.trim()) as { distinct: number; max: number };
    expect(distribution.distinct).toBeGreaterThan(100);
    expect(distribution.max / 2000).toBeLessThan(0.05);
  });
});

describe("ac26-w1-constraint-lab: the problem is solvable and actually fails", () => {
  it("should fail the public tests in the shipped starter state", () => {
    // This is the author-time half of the invariant that used to live inside
    // tests/public/test_circuit.py itself, as a self-check built on starter_payload()
    // (Issue #526). That self-check read whatever was on disk under local/starter/ at
    // the moment it ran -- which is exactly what `make test` bind-mounts read-write
    // over, so it inverted into a false failure the instant a learner solved the
    // problem correctly. Checking the real repository files here, with no bind mount in
    // the way, gets the same guarantee without that failure mode.
    const result = python(["tests/public/test_circuit.py"]);
    expect(result.status).not.toBe(0);
    expect(result.stdout).toContain("FAIL test_normalize_maps_into_the_field");
  });

  it("should pass the public tests once the starter has been correctly solved", () => {
    // The regression this guards against: a self-check re-added inside
    // tests/public/test_circuit.py that reads the live starter/ directory (via
    // starter_payload() or any other on-disk read) rather than a fixed, as-shipped
    // baseline. Swapping the reference solution into starter/ reproduces exactly what
    // `make test` sees once a participant has solved the problem -- restored in
    // `finally` so a failed assertion here can never leave the repository dirty.
    const originals = Object.fromEntries(
      SUBMITTED.map((name) => [name, readFileSync(join(LOCAL, "starter", name), "utf8")]),
    );
    try {
      for (const name of SUBMITTED) {
        writeFileSync(join(LOCAL, "starter", name), read(`local/reference/${name}`), "utf8");
      }
      const result = python(["tests/public/test_circuit.py"]);
      expect(result.stdout).toContain("public tests: all passed");
      expect(result.status).toBe(0);
    } finally {
      for (const name of SUBMITTED) {
        writeFileSync(join(LOCAL, "starter", name), originals[name], "utf8");
      }
    }
  });

  it("should kill every intended defect in the mutation suite", () => {
    const result = python(["mutation.py"]);
    expect(result.stdout).toContain("PASS reference implementation passes the hidden tests");
    expect(result.stdout).not.toContain("SURVIVED");
    expect(result.status).toBe(0);
  });
});

describe("ac26-w1-constraint-lab: /verify contract", () => {
  it.each(["residuals", "boolean", "membership", "transfer"])(
    "should accept the reference submission on %s",
    (checkpoint) => {
      expect(evaluate(checkpoint, bundle("reference"))).toBe(true);
    },
    120_000,
  );

  it.each(["residuals", "boolean", "membership", "transfer"])(
    "should reject the starter submission on %s",
    (checkpoint) => {
      expect(evaluate(checkpoint, bundle("starter"))).toBe(false);
    },
    120_000,
  );

  it("should reject a submission that hangs, rather than hanging itself", () => {
    const files = JSON.parse(bundle("reference")) as Record<string, string>;
    files["circuit.py"] = "def trace(c, w, f):\n    while True:\n        pass\n";
    expect(evaluate("residuals", JSON.stringify(files))).toBe(false);
  }, 60_000);

  it("should reject an unknown checkpoint id instead of crediting it", () => {
    expect(evaluate("finish-week1", bundle("reference"))).toBe(false);
  });

  it("should require the seeded id and residual on first-broken", () => {
    const answer = firstBrokenAnswer();
    expect(evaluate("first-broken", JSON.stringify(answer))).toBe(true);
    expect(evaluate("first-broken", answer.constraintId)).toBe(false);
    expect(
      evaluate("first-broken", JSON.stringify({ ...answer, residual: answer.residual + 1 })),
    ).toBe(false);
  });

  it("should echo the checkpointId so the platform can fail closed", () => {
    expect(read("local/verifier/server.py")).toContain(
      '{"checkpointId": checkpoint_id, "correct": correct}',
    );
  });
});

describe("ac26-w1-constraint-lab: participant/verifier separation (Issue 543/537)", () => {
  it("keeps fixtures/, the answer derivation and the hidden suite out of the participant Docker stage", () => {
    const dockerfile = read("local/Dockerfile");
    const participantStage = dockerfile.slice(
      dockerfile.indexOf("FROM base AS participant"),
      dockerfile.indexOf("FROM base AS verifier"),
    );
    // The class this problem was scaffolded from before this fix: `fixtures/` shipping
    // to the participant stage handed over `broken_witness` and `broken_diagnosis`
    // directly, so a learner with nothing but their own container's FLAG_SEED could
    // reconstruct `first-broken`'s answer even with `evaluate` staying out of reach.
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

  it("keeps the Portal editor API and fixtures import out of the hidden verifier, and grading out of the Workbench", () => {
    const participantServer = read("local/participant/server.py");
    const hiddenServer = read("local/verifier/server.py");
    for (const endpoint of ["/api/config", "/api/inspect", "/api/starter", "/api/test", "/api/prepare"]) {
      expect(participantServer).toContain(endpoint);
      expect(hiddenServer).not.toContain(endpoint);
    }
    expect(participantServer).not.toContain("def evaluate(");
    expect(participantServer).not.toContain("def _check_");
    // The only `fixtures` reference in the Workbench is the lazy, function-scoped
    // CI/author fallback inside `fetch_public` -- never a module-level import, which
    // is what would make it resolve eagerly (and fail loudly) the moment this file
    // runs inside a built participant image that does not carry `fixtures/` at all.
    expect(participantServer).not.toMatch(/^from fixtures/m);
    expect(participantServer).toContain("from fixtures.generate import public_payload");
    expect(hiddenServer).toContain("from fixtures.generate import");
    expect(hiddenServer).toContain("/verify");
    expect(hiddenServer).toContain("/healthz");
    expect(hiddenServer).toContain("/public");
  });

  it("proxies /verify to the internal verifier and fails closed when it is unreachable", () => {
    const probe = String.raw`
import json, sys
sys.path.insert(0, ".")
from participant import server
bodies = [{"checkpointId": checkpoint, "submission": "anything"} for checkpoint in server.CHECKPOINTS]
print(json.dumps({
    "missing": [server.proxy_verdict(body, "") for body in bodies],
    "unavailable": [server.proxy_verdict(body, "http://127.0.0.1:1/verify") for body in bodies],
    "hasInlineEvaluator": hasattr(server, "evaluate") or any(name.startswith("_check_") for name in dir(server)),
}))
`;
    const result = python(["-c", probe]);
    expect(result.status).toBe(0);
    const output = JSON.parse(result.stdout.trim().split("\n").at(-1) ?? "{}") as {
      missing: Array<{ checkpointId: string; correct: boolean }>;
      unavailable: Array<{ checkpointId: string; correct: boolean }>;
      hasInlineEvaluator: boolean;
    };
    const checkpoints = ["residuals", "first-broken", "boolean", "membership", "transfer"];
    const expectedVerdicts = checkpoints.map((checkpointId) => ({ checkpointId, correct: false }));
    expect(output.missing).toEqual(expectedVerdicts);
    expect(output.unavailable).toEqual(expectedVerdicts);
    expect(output.hasInlineEvaluator).toBe(false);
  });

  it("compose builds the right target for each service, publishes only the Workbench port, and isolates the verifier network", () => {
    const compose = read("local/docker-compose.yml");
    for (const contract of [
      "target: participant",
      "target: verifier",
      '"127.0.0.1:18093:18093"',
      "VERIFIER_URL: http://verifier:18094/verify",
      "VERIFIER_PUBLIC_URL: http://verifier:18094/public",
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
    expect(compose).not.toContain('"127.0.0.1:18094:18094"');
    expect(compose.match(/ports:/g)).toHaveLength(1);
  });
});

describe("ac26-w1-constraint-lab: metadata contracts", () => {
  function metadata() {
    return JSON.parse(read("metadata.json")) as {
      difficulty: number;
      courseAlignment: { week: number; role: string; sources: Array<{ ref: string }> };
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

  it("should pin every upstream source to a 40-hex commit sha", () => {
    const { courseAlignment } = metadata();
    expect(courseAlignment.week).toBe(1);
    expect(courseAlignment.role).toBe("mechanism");
    expect(courseAlignment.sources.length).toBeGreaterThan(0);
    for (const source of courseAlignment.sources) {
      expect(source.ref).toMatch(/^[0-9a-f]{40}$/);
    }
  });
});
