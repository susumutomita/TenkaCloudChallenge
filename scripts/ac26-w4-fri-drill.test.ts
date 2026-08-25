import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import { parse as parseYaml } from "yaml";

/**
 * ac26-w4-fri-drill is a drill: twelve lines typed into the learner's own Python, eight
 * of them direct-answer checkpoints (the platform's per-problem maximum), each the value
 * one line prints against this deployment's numbers — one honest FRI lap, then a
 * dishonest fold caught by the query check. No checkpoint runs learner code, so the
 * contract tested here is the value grader — exact, seed-bound, refusing the near-misses
 * a learner would paste — plus the participant surface every AC26 problem ships.
 */

const ROOT = join(import.meta.dir, "..", "challenges", "ac26-w4-fri-drill");
const LOCAL = join(ROOT, "local");
const SEED = "ci-fixed-seed";

/** The eight graded lines, in drill order. */
const LINES = [
  "poly",
  "fold",
  "fold2",
  "query",
  "recover",
  "consistency",
  "cheat-caught",
  "miss-points",
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

/**
 * This seed's expected values and public numbers, as JSON.
 *
 * `expected_for` lives only in `verifier/expected.py` (Issue 543/537): reading it here
 * from the checkout, rather than the participant Docker image, is deliberate -- this
 * helper is test-only tooling with full repository access, the same way
 * `mutation.py` and `tests/hidden/check_fri_drill.py` are. What must NOT resolve
 * `expected_for` is the participant image itself; that boundary is asserted separately
 * in the "participant/verifier separation" describe block below.
 */
function deployment(seed = SEED): { expected: Record<string, unknown>; public: Record<string, unknown> } {
  const script = [
    "import json, sys",
    "sys.path.insert(0, '.')",
    "from fixtures.generate import setting",
    "from verifier.expected import expected_for",
    "pub = setting(sys.argv[1])['public']",
    "print(json.dumps({'expected': expected_for(sys.argv[1]), 'public': pub}))",
  ].join("\n");
  const result = python(["-c", script, seed]);
  expect(result.status).toBe(0);
  return JSON.parse(result.stdout.trim().split("\n").at(-1) ?? "{}");
}

describe("ac26-w4-fri-drill: participant contract", () => {
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
      "local/tests/public/test_fri_drill.py",
      "local/tests/hidden/check_fri_drill.py",
      "local/verifier/server.py",
      "local/verifier/expected.py",
      "local/participant/server.py",
      "local/participant/workbench.py",
      "local/starter/fri_drill.py",
      "local/reference/fri_drill.py",
    ]) {
      expect(existsSync(join(ROOT, path)), path).toBe(true);
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

  it("keeps the author-only artifacts out of the participant stage", () => {
    const dockerfile = read("local/Dockerfile");
    const [participant, author] = dockerfile.split(/^FROM participant AS author$/m);
    expect(author).toBeDefined();
    const participantCopies = participant.split("\n").filter((line) => line.startsWith("COPY "));
    expect(participantCopies.some((line) => line.includes("starter/"))).toBe(true);
    expect(participantCopies.some((line) => line.includes("reference/"))).toBe(false);
    expect(participantCopies.some((line) => line.includes("mutation.py"))).toBe(false);
    expect(author).toContain("COPY --chown=lab:lab reference/ ./reference/");
    expect(author).toContain("COPY --chown=lab:lab mutation.py ./mutation.py");
  });
});

describe("ac26-w4-fri-drill: container safety", () => {
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

describe("ac26-w4-fri-drill: participant/verifier separation (Issue 543/537)", () => {
  it("keeps the answer derivation and hidden suite out of the participant Docker stage", () => {
    const dockerfile = read("local/Dockerfile");
    const participantStage = dockerfile.slice(
      dockerfile.indexOf("FROM base AS participant"),
      dockerfile.indexOf("FROM base AS verifier"),
    );
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
    expect(verifierStage).toContain("COPY --chown=lab:lab tests/hidden/");
    expect(verifierStage).toContain("COPY --chown=lab:lab verifier/");
    expect(verifierStage).not.toContain("COPY --chown=lab:lab participant/");
    expect(verifierStage).not.toContain("COPY --chown=lab:lab reference/");
    expect(verifierStage).not.toContain("COPY --chown=lab:lab mutation.py");
  });

  it("never defines expected_for outside verifier/expected.py", () => {
    const fixtures = read("local/fixtures/generate.py");
    const participantServer = read("local/participant/server.py");
    const participantWorkbench = read("local/participant/workbench.py");
    for (const source of [fixtures, participantServer, participantWorkbench]) {
      expect(source).not.toContain("def expected_for");
      expect(source).not.toContain("tests.hidden");
    }
    expect(read("local/verifier/expected.py")).toContain("def expected_for");
  });

  it("keeps the Portal editor API out of the hidden verifier and grading out of the Workbench", () => {
    const participantServer = read("local/participant/server.py");
    const hiddenServer = read("local/verifier/server.py");
    for (const endpoint of ["/api/config", "/api/inspect", "/api/starter", "/api/test", "/api/prepare"]) {
      expect(participantServer).toContain(endpoint);
      expect(hiddenServer).not.toContain(endpoint);
    }
    expect(participantServer).not.toContain("def evaluate(");
    expect(participantServer).not.toContain("from verifier");
    expect(hiddenServer).toContain("from verifier.expected import expected_for");
    expect(hiddenServer).toContain("/verify");
    expect(hiddenServer).toContain("/healthz");
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
    "hasInlineEvaluator": hasattr(server, "expected_for") or hasattr(server, "_check_line"),
}))
`;
    const result = python(["-c", probe]);
    expect(result.status).toBe(0);
    const output = JSON.parse(result.stdout.trim().split("\n").at(-1) ?? "{}") as {
      missing: Array<{ checkpointId: string; correct: boolean }>;
      unavailable: Array<{ checkpointId: string; correct: boolean }>;
      hasInlineEvaluator: boolean;
    };
    const expectedVerdicts = LINES.map((checkpointId) => ({ checkpointId, correct: false }));
    expect(output.missing).toEqual(expectedVerdicts);
    expect(output.unavailable).toEqual(expectedVerdicts);
    expect(output.hasInlineEvaluator).toBe(false);
  });

  it("compose builds the right target for each service, publishes only the Workbench port, and isolates the verifier network", () => {
    const compose = read("local/docker-compose.yml");
    for (const contract of [
      "target: participant",
      "target: verifier",
      '"127.0.0.1:18135:18135"',
      "VERIFIER_URL: http://verifier:18138/verify",
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
    expect(compose).not.toContain('"127.0.0.1:18138:18138"');
    expect(compose.match(/ports:/g)).toHaveLength(1);
  });
});

describe("ac26-w4-fri-drill: fixtures are seed-derived", () => {
  it("should keep the reference passing every line across 2000 fixture seeds", () => {
    const script = [
      "import importlib.util, sys",
      "sys.path.insert(0, '.')",
      "from tests.hidden import check_fri_drill",
      "from fixtures.generate import setting",
      "from verifier.expected import expected_for",
      "spec = importlib.util.spec_from_file_location('ref', 'reference/fri_drill.py')",
      "ref = importlib.util.module_from_spec(spec); spec.loader.exec_module(ref)",
      "bad = {}",
      "for i in range(2000):",
      "    seed = f'solvability-{i}'",
      "    failures = check_fri_drill.run(ref, seed)",
      "    pub = setting(seed)['public']; exp = expected_for(seed)",
      "    p = pub['p']",
      "    if (pub['q2'] + pub['beta'] * pub['q3']) % p == 0 or pub['q3'] == 0:",
      "        failures.append('degenerate fold: Q1 not degree 1, or Q0 not degree 3')",
      "    if exp['consistency'][0] != exp['consistency'][1]:",
      "        failures.append('honest query check does not pass')",
      "    if exp['cheat-caught'][0] == exp['cheat-caught'][1]:",
      "        failures.append('the swap is not caught at the query point')",
      "    lo, hi = exp['miss-points']",
      "    if (lo + hi) % p != 0 or lo == hi or pub['x'] in (lo, hi):",
      "        failures.append('miss points are not one +-x pair off the query point')",
      "    if failures:",
      "        bad[seed] = failures",
      "print(bad)",
    ].join("\n");
    const result = python(["-c", script]);
    expect(result.status).toBe(0);
    expect(result.stdout.trim().split("\n").at(-1)).toBe("{}");
  }, 120_000);

  it("should produce different numbers for different seeds", () => {
    const alpha = deployment("seed-alpha");
    const beta = deployment("seed-beta");
    expect(JSON.stringify(alpha.expected)).not.toBe(JSON.stringify(beta.expected));
    expect(JSON.stringify(deployment("seed-alpha").expected)).toBe(JSON.stringify(alpha.expected));
  });

  it("should vary the field across seeds, so p is never assumed", () => {
    const script = [
      "import sys",
      "sys.path.insert(0, '.')",
      "from fixtures.generate import setting",
      "print(','.join(str(setting(f'vary-{i}')['public']['p']) for i in range(40)))",
    ].join("\n");
    const primes = new Set(python(["-c", script]).stdout.trim().split(","));
    expect(primes.size).toBeGreaterThan(1);
  });
});

describe("ac26-w4-fri-drill: the problem is solvable and actually fails", () => {
  it("should fail the public tests in the shipped starter state", () => {
    const result = python(["tests/public/test_fri_drill.py"]);
    expect(result.status).not.toBe(0);
    expect(result.stdout).toContain("FAIL");
  });

  it("should kill every intended defect in the mutation suite", () => {
    const result = python(["mutation.py"]);
    expect(result.stdout).toContain("PASS reference implementation passes the hidden tests");
    expect(result.stdout).not.toContain("SURVIVED");
    expect(result.status).toBe(0);
  });

  it("does not hand the answers to the learner in the starter", () => {
    const starter = read("local/starter/fri_drill.py");
    const reference = read("local/reference/fri_drill.py");
    for (const giveaway of ["+ beta * _qo", "pow(2 * x, p - 2, p)", "d1 * (xx * xx % p)"]) {
      expect(starter).not.toContain(giveaway);
      expect(reference).toContain(giveaway);
    }
  });

  it("ships an inspect path that shows the numbers but never a line's value", () => {
    const shown = python(["show.py"]).stdout;
    const { expected, public: pub } = deployment();
    expect(shown).toContain(`beta, beta2 = ${pub.beta}, ${pub.beta2}`);
    // The folded values are the drill's job, not the screen's.
    expect(shown).not.toMatch(/Q1\s*[:=]\s*\d/);
    for (const line of LINES) expect(shown).not.toContain(`${line} = ${JSON.stringify(expected[line])}`);
  });
});

describe("ac26-w4-fri-drill: /verify contract", () => {
  const { expected, public: pub } = deployment();
  const asText = (value: unknown): string =>
    Array.isArray(value) ? JSON.stringify(value) : String(value);

  it.each([...LINES])("should accept this deployment's value on %s", (line) => {
    expect(evaluate(line, asText(expected[line]))).toBe(true);
  });

  it("should accept a tuple in bracket form and in bare form", () => {
    const [a, b, c] = expected["poly"] as [number, number, number];
    expect(evaluate("poly", `(${a}, ${b}, ${c})`)).toBe(true);
    expect(evaluate("poly", `${a}, ${b}, ${c}`)).toBe(true);
  });

  it.each([...LINES])("should reject another deployment's value on %s", (line) => {
    const other = deployment("another-deployment").expected[line];
    if (JSON.stringify(other) === JSON.stringify(expected[line])) return; // coincidence: nothing to test
    expect(evaluate(line, asText(other))).toBe(false);
  });

  it("should reject a shown fixture value pasted in place of the answer", () => {
    expect(evaluate("fold2", String(pub.beta2))).toBe(expected["fold2"] === pub.beta2);
    expect(evaluate("poly", `${pub.q0}, ${pub.q1}, ${pub.q2}`)).toBe(false);
  });

  it("should reject an ungraded line's value offered to a graded checkpoint", () => {
    // The material lines are typed but not graded; their ids must not score anything.
    expect(evaluate("split", JSON.stringify(expected["split"]))).toBe(false);
    expect(evaluate("identity", "true")).toBe(false);
    expect(evaluate("honest-all", "[]")).toBe(false);
  });

  it("should reject the right tuple with a wrong shape, a boolean, and junk", () => {
    const recovered = expected["recover"] as number[];
    expect(evaluate("recover", JSON.stringify(recovered.slice(0, 2)))).toBe(false);
    expect(evaluate("recover", String(recovered[0]))).toBe(false);
    const [lo, hi] = expected["miss-points"] as [number, number];
    expect(evaluate("miss-points", `[${hi}, ${lo}]`)).toBe(lo === hi);
    expect(evaluate("fold2", "true")).toBe(false);
    expect(evaluate("fold2", "")).toBe(false);
    expect(evaluate("fold2", "not a number")).toBe(false);
  });

  it("should reject an unknown checkpoint id instead of crediting it", () => {
    expect(evaluate("line-13", "0")).toBe(false);
  });

  it("should echo the checkpointId so the platform can fail closed", () => {
    expect(read("local/verifier/server.py")).toContain(
      '{"checkpointId": checkpoint_id, "correct": correct}',
    );
  });
});

describe("ac26-w4-fri-drill: metadata contracts", () => {
  const metadata = JSON.parse(read("metadata.json")) as {
    difficulty: number;
    status: string;
    scoring: {
      kind: string;
      checks: { id: string; points: number; wrongAnswerPenalty: number; input?: string; hints?: { penalty: number }[] }[];
    };
    courseAlignment: { week: number; role: string; sources: unknown[] };
    i18n: { en: { checks: { id: string }[] } };
  };

  it("should total the Medium tier's 200 points across eight direct-answer lines", () => {
    expect(metadata.scoring.kind).toBe("multi-verify");
    expect(metadata.difficulty).toBe(3);
    expect(metadata.scoring.checks.map((check) => check.id)).toEqual([...LINES]);
    expect(metadata.scoring.checks.reduce((sum, check) => sum + check.points, 0)).toBe(200);
    for (const check of metadata.scoring.checks) {
      expect(check.wrongAnswerPenalty).toBe(10);
      expect(check.input ?? "text").toBe("text");
    }
    const hintPenalty = metadata.scoring.checks.reduce(
      (sum, check) => sum + (check.hints ?? []).reduce((inner, hint) => inner + hint.penalty, 0),
      0,
    );
    expect(hintPenalty).toBeLessThanOrEqual(100);
    expect(metadata.i18n.en.checks.map((check) => check.id)).toEqual([...LINES]);
  });

  it("should pin week 4's published material and stay draft until played", () => {
    expect(metadata.courseAlignment.week).toBe(4);
    expect(metadata.courseAlignment.role).toBe("mechanism");
    expect(metadata.courseAlignment.sources).toEqual([
      {
        repository: "zk-tokyo/advanced-cryptography-2026",
        ref: "c088f8e6f301dedcd80b6dd9c321a1cd83410637",
        path: "week4/README.md",
        kind: "lecture",
      },
      {
        repository: "zk-tokyo/advanced-cryptography-2026",
        ref: "c088f8e6f301dedcd80b6dd9c321a1cd83410637",
        path: "week4/acp-2026-week4-redacted.pdf",
        kind: "slide",
      },
    ]);
    expect(metadata.status).toBe("draft");
  });
});
