import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import { parse as parseYaml } from "yaml";

/**
 * ac26-w2-gmw-and is Week 2's Boolean-MPC problem: 1-out-of-2 OT and a GMW-style
 * secret AND. The interesting assertions run its Python for real — the starter fails,
 * the reference passes every checkpoint, the mutation suite kills every intended
 * defect, and /verify holds its security contract — rather than reading source text.
 * Python 3 is on ubuntu-latest and the problem is stdlib-only.
 */

const ROOT = join(import.meta.dir, "..", "challenges", "ac26-w2-gmw-and");
const LOCAL = join(ROOT, "local");
const SEED = "ci-fixed-seed";

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
  return read(`local/${dir}/gmw.py`);
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

/** The correct direct answer for a checkpoint, built from the same fixtures the grader reads. */
function expectedAnswer(checkpoint: "choice-leak" | "cross-term-audit", seed = SEED): string {
  const script = [
    "import json, sys",
    "sys.path.insert(0, '.')",
    "from fixtures.generate import ot_setting, audit_bits",
    "seed = sys.argv[1]",
    "if sys.argv[2] == 'choice-leak':",
    "    cfg = ot_setting(seed)",
    "    a_pub = pow(cfg['g'], cfg['a'], cfg['p'])",
    "    print(json.dumps({'requestRevealingChoiceZero': a_pub, 'requestRevealingChoiceOne': 1}))",
    "else:",
    "    failing = [[x0, x1, y0, y1]",
    "               for x0 in (0, 1) for x1 in (0, 1) for y0 in (0, 1) for y1 in (0, 1)",
    "               if ((x0 & y0) ^ (x1 & y1)) != ((x0 ^ x1) & (y0 ^ y1))]",
    "    bits = audit_bits(seed)",
    "    this_run = dict(bits)",
    "    this_run['broken'] = (bits['x0'] & bits['y0']) ^ (bits['x1'] & bits['y1'])",
    "    this_run['correct'] = (bits['x0'] ^ bits['x1']) & (bits['y0'] ^ bits['y1'])",
    "    print(json.dumps({'failingPatterns': failing, 'thisRun': this_run}))",
  ].join("\n");
  const result = python(["-c", script, seed, checkpoint]);
  expect(result.status).toBe(0);
  return result.stdout.trim();
}

describe("ac26-w2-gmw-and: participant contract", () => {
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
      "local/tests/public/test_gmw.py",
      "local/tests/hidden/check_gmw.py",
      "local/verifier/server.py",
      "local/verifier/workbench.py",
      "local/starter/gmw.py",
      "local/reference/gmw.py",
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

describe("ac26-w2-gmw-and: container safety", () => {
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

describe("ac26-w2-gmw-and: fixtures are seed-derived", () => {
  it("should keep the reference passing every hidden phase across 2000 fixture seeds", () => {
    const script = [
      "import json, sys",
      "sys.path.insert(0, '.')",
      "sys.path.insert(0, 'reference')",
      "import gmw",
      "from tests.hidden import check_gmw",
      "bad = []",
      "for index in range(2000):",
      "    seed = f'solvability-{index}'",
      "    failures = check_gmw.run(gmw, seed)",
      "    if failures: bad.append([seed, failures])",
      "print(json.dumps(bad[:5]))",
    ].join("\n");
    expect(JSON.parse(python(["-c", script]).stdout.trim())).toEqual([]);
  }, 120_000);

  it("should produce different fixtures for different seeds", () => {
    const script = [
      "import json, sys",
      "sys.path.insert(0, '.')",
      "from fixtures.generate import ot_setting, gmw_setting, audit_bits, health_token",
      "seed = sys.argv[1]",
      "print(json.dumps({'ot': ot_setting(seed), 'gmw': gmw_setting(seed), 'audit': audit_bits(seed), 't': health_token(seed)}))",
    ].join("\n");
    const first = python(["-c", script, "seed-alpha"]).stdout.trim();
    const second = python(["-c", script, "seed-beta"]).stdout.trim();
    const again = python(["-c", script, "seed-alpha"]).stdout.trim();

    expect(first).not.toBe(second);
    expect(first).toBe(again);
  });

  it("should vary the toy group across hidden labels, so one prime is never assumed", () => {
    const script = [
      "import sys",
      "sys.path.insert(0, '.')",
      "from fixtures.generate import group",
      "print(','.join(str(group('s%d' % i, 'h1')[0]) for i in range(40)))",
    ].join("\n");
    const primes = new Set(python(["-c", script]).stdout.trim().split(","));
    expect(primes.size).toBeGreaterThan(2);
  });

  it("should keep the classroom group on the public label, so the statement's numbers hold", () => {
    const script = [
      "import sys",
      "sys.path.insert(0, '.')",
      "from fixtures.generate import group",
      "print(group(sys.argv[1]))",
    ].join("\n");
    expect(python(["-c", script, SEED]).stdout.trim()).toBe("(23, 11, 2)");
  });
});

describe("ac26-w2-gmw-and: the problem is solvable and actually fails", () => {
  it("should fail the public tests in the shipped starter state", () => {
    const result = python(["tests/public/test_gmw.py"]);
    expect(result.status).not.toBe(0);
    expect(result.stdout).toContain("FAIL");
  });

  it("should kill every intended defect in the mutation suite", () => {
    const result = python(["mutation.py"]);
    expect(result.stdout).toContain("PASS reference implementation passes the hidden tests");
    expect(result.stdout).not.toContain("SURVIVED");
    expect(result.status).toBe(0);
  });

  // The one implementation shape whose round trip is green for both choices while the
  // receiver can read the branch it never chose. If this line disappears from the
  // mutation output, the wrong-branch probe has silently lost its teeth.
  it("should pin that the wrong-branch probe alone kills the both-branches-open mutant", () => {
    const result = python(["mutation.py"]);
    expect(result.stdout).toContain(
      "KILLED both branches open under the receiver's key (round trip alone is green)",
    );
  });
});

describe("ac26-w2-gmw-and: /verify contract", () => {
  it.each(["ot-request", "ot-round-trip", "gmw-and"])(
    "should accept the reference submission on %s",
    (checkpoint) => {
      expect(evaluate(checkpoint, bundle("reference"))).toBe(true);
    },
    120_000,
  );

  it.each(["ot-request", "ot-round-trip", "gmw-and"])(
    "should reject the starter submission on %s",
    (checkpoint) => {
      expect(evaluate(checkpoint, bundle("starter"))).toBe(false);
    },
    120_000,
  );

  it("should reject a submission that hangs, rather than hanging itself", () => {
    expect(
      evaluate(
        "ot-request",
        "def ot_request(a_pub, choice, b, p, q, g):\n    while True:\n        pass\n",
      ),
    ).toBe(false);
  }, 60_000);

  it("should reject an unknown checkpoint id instead of crediting it", () => {
    expect(evaluate("finish-week2", bundle("reference"))).toBe(false);
  });

  it("should accept the seed-correct choice-leak pair", () => {
    expect(evaluate("choice-leak", expectedAnswer("choice-leak"))).toBe(true);
  });

  // Either value alone can be pattern-matched out of the statement; the pair with the
  // directions right is the part that requires seeing why each distribution lost a point.
  it("should reject a choice-leak answer with the directions swapped", () => {
    const answer = JSON.parse(expectedAnswer("choice-leak")) as Record<string, number>;
    const swapped = JSON.stringify({
      requestRevealingChoiceZero: answer.requestRevealingChoiceOne,
      requestRevealingChoiceOne: answer.requestRevealingChoiceZero,
    });
    expect(evaluate("choice-leak", swapped)).toBe(false);
  });

  it("should reject a choice-leak answer with one direction missing", () => {
    const answer = JSON.parse(expectedAnswer("choice-leak")) as Record<string, number>;
    expect(
      evaluate(
        "choice-leak",
        JSON.stringify({ requestRevealingChoiceZero: answer.requestRevealingChoiceZero }),
      ),
    ).toBe(false);
  });

  it("should accept the full cross-term audit for this seed", () => {
    expect(evaluate("cross-term-audit", expectedAnswer("cross-term-audit"))).toBe(true);
  });

  it("should reject a cross-term audit with one failing pattern swapped out", () => {
    const answer = JSON.parse(expectedAnswer("cross-term-audit")) as {
      failingPatterns: number[][];
      thisRun: Record<string, number>;
    };
    answer.failingPatterns[0] = [0, 0, 0, 0];
    expect(evaluate("cross-term-audit", JSON.stringify(answer))).toBe(false);
  });

  // The failing set is a fact about the shortcut; the verdict on this deployment's
  // recorded bits is what binds the answer to the seed. An answer worked out for a
  // different deployment carries the wrong bits and must not score this one.
  it("should reject a cross-term audit whose recorded run belongs to another deployment", () => {
    const foreign = expectedAnswer("cross-term-audit", "some-other-deploy-seed");
    const local = expectedAnswer("cross-term-audit");
    if (foreign === local) return; // the two seeds happen to share audit bits; nothing to assert
    expect(evaluate("cross-term-audit", foreign)).toBe(false);
  });

  it("should reject a cross-term audit that names the patterns but skips the recorded run", () => {
    const answer = JSON.parse(expectedAnswer("cross-term-audit")) as {
      failingPatterns: number[][];
    };
    expect(
      evaluate("cross-term-audit", JSON.stringify({ failingPatterns: answer.failingPatterns })),
    ).toBe(false);
  });

  it("should echo the checkpointId so the platform can fail closed", () => {
    expect(read("local/verifier/server.py")).toContain(
      '{"checkpointId": checkpoint_id, "correct": correct}',
    );
  });
});

describe("ac26-w2-gmw-and: metadata contracts", () => {
  function metadata() {
    return JSON.parse(read("metadata.json")) as {
      difficulty: number;
      status: string;
      track: { order: number };
      courseAlignment: { week: number; role: string; sources?: Array<{ ref: string }> };
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
    const hintPenalty = meta.scoring.checks
      .flatMap((check) => check.hints ?? [])
      .reduce((sum, hint) => sum + hint.penalty, 0);
    expect(hintPenalty).toBeLessThanOrEqual(100);
  });

  it("should sit at order 260, after the five Part A companions", () => {
    expect(metadata().track.order).toBe(260);
  });

  // This problem was authored against the published Part B (OT + GMW AND) of toy-mpc,
  // at the same commit the five Part A companions re-pinned to on 2026-08-12. The exact
  // sources are pinned here so a ref bumped without a review shows up as a diff.
  it("should pin week 2's published lecture and exercise", () => {
    const { courseAlignment, status } = metadata();
    expect(courseAlignment.week).toBe(2);
    expect(courseAlignment.role).toBe("mechanism");
    expect(courseAlignment.sources).toEqual([
      {
        repository: "zk-tokyo/advanced-cryptography-2026",
        ref: "e4f33fec97c7938f27d3c6dc8ea8b1aeceb0aec9",
        path: "week2/README.md",
        kind: "lecture",
      },
      {
        repository: "zk-tokyo/advanced-cryptography-2026",
        ref: "e4f33fec97c7938f27d3c6dc8ea8b1aeceb0aec9",
        path: "week2/problems/toy-mpc/README.md",
        kind: "assignment",
      },
    ]);
    expect(status).toBe("draft");
  });

  it("should be mapped in curriculum.md, so no unmapped challenge ships", () => {
    const curriculum = readFileSync(
      join(import.meta.dir, "..", "docs/curricula/advanced-cryptography-2026/curriculum.md"),
      "utf8",
    );
    expect(curriculum).toContain("`ac26-w2-gmw-and`");
    for (const concept of ["concept.xor-sharing", "concept.oblivious-transfer", "concept.gmw-and"]) {
      expect(curriculum).toContain(concept);
    }
  });
});
