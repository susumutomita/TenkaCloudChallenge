import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import { parse as parseYaml } from "yaml";

/**
 * ac26-w4-sumcheck-drill is a drill: twelve lines typed into the learner's own Python, eight
 * of them direct-answer checkpoints (the platform's per-problem maximum), each the value
 * one line prints against this deployment's numbers — nine lines as the SumCheck verifier,
 * three as the lying prover. No checkpoint runs learner code, so the contract tested here
 * is the value grader — exact, seed-bound, refusing the near-misses a learner would paste —
 * plus the participant surface every AC26 problem ships.
 */

const ROOT = join(import.meta.dir, "..", "challenges", "ac26-w4-sumcheck-drill");
const LOCAL = join(ROOT, "local");
const SEED = "ci-fixed-seed";

/** The eight graded lines, in drill order. */
const LINES = [
  "circuit",
  "mle",
  "grid",
  "round1",
  "final-check",
  "lie",
  "lie-caught",
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

/** This seed's expected values and public numbers, as JSON. */
function deployment(seed = SEED): { expected: Record<string, unknown>; public: Record<string, unknown> } {
  const script = [
    "import json, sys",
    "sys.path.insert(0, '.')",
    "from fixtures.generate import setting",
    "cfg = setting(sys.argv[1])",
    "print(json.dumps({'expected': cfg['expected'], 'public': cfg['public']}))",
  ].join("\n");
  const result = python(["-c", script, seed]);
  expect(result.status).toBe(0);
  return JSON.parse(result.stdout.trim().split("\n").at(-1) ?? "{}");
}

describe("ac26-w4-sumcheck-drill: participant contract", () => {
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
      "local/tests/public/test_sumcheck_drill.py",
      "local/tests/hidden/check_sumcheck_drill.py",
      "local/verifier/server.py",
      "local/verifier/workbench.py",
      "local/starter/sumcheck_drill.py",
      "local/reference/sumcheck_drill.py",
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
    expect(author).toContain("COPY reference/");
    expect(author).toContain("COPY mutation.py");
  });
});

describe("ac26-w4-sumcheck-drill: container safety", () => {
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

describe("ac26-w4-sumcheck-drill: fixtures are seed-derived", () => {
  it("should keep the reference passing every line across 2000 fixture seeds", () => {
    const script = [
      "import importlib.util, sys",
      "sys.path.insert(0, '.')",
      "from tests.hidden import check_sumcheck_drill",
      "from fixtures.generate import setting",
      "spec = importlib.util.spec_from_file_location('ref', 'reference/sumcheck_drill.py')",
      "ref = importlib.util.module_from_spec(spec); spec.loader.exec_module(ref)",
      "bad = {}",
      "for i in range(2000):",
      "    seed = f'solvability-{i}'",
      "    failures = check_sumcheck_drill.run(ref, seed)",
      "    cfg = setting(seed); pub = cfg['public']; exp = cfg['expected']",
      "    y0, y1, out = exp['circuit']",
      "    if y0 == y1 or y0 == 0 or y1 == 0 or out == 0:",
      "        failures.append('degenerate layer')",
      "    if len(exp['miss-points']) != 2 or pub['r2'] in exp['miss-points']:",
      "        failures.append('miss points degenerate, or r2 does not catch the lie')",
      "    if exp['round1'] == pub['c0']:",
      "        failures.append('round1 equals the shown c0')",
      "    if failures:",
      "        bad[seed] = failures",
      "print(bad)",
    ].join("\n");
    const result = python(["-c", script]);
    expect(result.status).toBe(0);
    expect(result.stdout.trim().split("\n").at(-1)).toBe("{}");
  });

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

describe("ac26-w4-sumcheck-drill: the problem is solvable and actually fails", () => {
  it("should fail the public tests in the shipped starter state", () => {
    const result = python(["tests/public/test_sumcheck_drill.py"]);
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
    const starter = read("local/starter/sumcheck_drill.py");
    const reference = read("local/reference/sumcheck_drill.py");
    for (const giveaway of ["(y0 * (1 - z) + y1 * z) % p", "d * (1 - t)", "sh * (1 - t) + m * t * (1 - t)"]) {
      expect(starter).not.toContain(giveaway);
      expect(reference).toContain(giveaway);
    }
  });

  it("ships an inspect path that shows the numbers but never a line's value", () => {
    const shown = python(["show.py"]).stdout;
    const { expected, public: pub } = deployment();
    expect(shown).toContain(`d, m = ${pub.d}, ${pub.m}`);
    // The claim (the circuit's output) is line 1's job, not the screen's.
    expect(shown).not.toMatch(/output\s*[:=]\s*\d/);
    for (const line of LINES) expect(shown).not.toContain(`${line} = ${JSON.stringify(expected[line])}`);
  });
});

describe("ac26-w4-sumcheck-drill: /verify contract", () => {
  const { expected, public: pub } = deployment();
  const asText = (value: unknown): string =>
    Array.isArray(value) ? JSON.stringify(value) : String(value);

  it.each([...LINES])("should accept this deployment's value on %s", (line) => {
    expect(evaluate(line, asText(expected[line]))).toBe(true);
  });

  it("should accept a tuple in bracket form and in bare form", () => {
    const [a, b, c] = expected["circuit"] as [number, number, number];
    expect(evaluate("circuit", `(${a}, ${b}, ${c})`)).toBe(true);
    expect(evaluate("circuit", `${a}, ${b}, ${c}`)).toBe(true);
  });

  it.each([...LINES])("should reject another deployment's value on %s", (line) => {
    const other = deployment("another-deployment").expected[line];
    if (JSON.stringify(other) === JSON.stringify(expected[line])) return; // coincidence: nothing to test
    expect(evaluate(line, asText(other))).toBe(false);
  });

  it("should reject a shown fixture value pasted in place of the answer", () => {
    expect(evaluate("round1", String(pub.c0))).toBe(false);
    expect(evaluate("round1", String(pub.r1))).toBe(false);
    expect(evaluate("circuit", `${pub.x1}, ${pub.x2}, ${pub.x3}`)).toBe(false);
  });

  it("should reject an ungraded line's value offered to a graded checkpoint", () => {
    // The sum checks are typed but not graded; they must not score a graded line.
    expect(evaluate("round1", String(expected["p1-sum"]))).toBe(
      expected["round1"] === expected["p1-sum"],
    );
    expect(evaluate("grid-total", String(expected["grid-total"]))).toBe(false);
    expect(evaluate("p1-sum", String(expected["p1-sum"]))).toBe(false);
  });

  it("should reject the right tuple with a wrong shape, a boolean, and junk", () => {
    const [g00, g01] = expected["grid"] as [number, number];
    expect(evaluate("grid", `${g01}`)).toBe(false);
    expect(evaluate("grid", `[${g00}, ${g01}]`)).toBe(false);
    const [one, tStar] = expected["miss-points"] as [number, number];
    expect(evaluate("miss-points", `[${tStar}, ${one}]`)).toBe(tStar === one);
    expect(evaluate("round1", "true")).toBe(false);
    expect(evaluate("round1", "")).toBe(false);
    expect(evaluate("round1", "not a number")).toBe(false);
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

describe("ac26-w4-sumcheck-drill: metadata contracts", () => {
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
