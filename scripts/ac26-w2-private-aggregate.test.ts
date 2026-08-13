import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import { parse as parseYaml } from "yaml";

/**
 * ac26-w2-private-aggregate is Week 2's synthesis problem. The assertions that carry
 * weight run its Python for real, and the sharpest of them cover the two defects that
 * still produce a perfectly correct score — reusing one triple, and opening each
 * multiplication separately. A suite that only checked the answer would pass both.
 * Python 3 is on ubuntu-latest and the problem is stdlib-only.
 */

const ROOT = join(import.meta.dir, "..", "challenges", "ac26-w2-private-aggregate");
const LOCAL = join(ROOT, "local");
const SEED = "ci-fixed-seed";
const CHECKPOINTS = [
  "plan",
  "share-inputs",
  "linear",
  "multiply",
  "result",
  "privacy",
  "cost",
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
  return read(`local/${dir}/aggregate.py`);
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

/** The reference, with every product taking the same triple. Score stays correct. */
function reusingOneTriple(): string {
  const source = bundle("reference").replaceAll(
    "triple = triple_list[index]",
    "triple = triple_list[0]",
  );
  expect(source).not.toContain("triple_list[index]");
  return source;
}

/** The reference, opening each product on its own. Score stays correct; k rounds. */
function openingPerMultiplication(): string {
  const source = bundle("reference").replace(
    "    opened = io.open_batch(to_open)",
    [
      "    opened = []",
      "    for start in range(0, len(to_open), 2):",
      "        opened.extend(io.open_batch(to_open[start : start + 2]))",
    ].join("\n"),
  );
  expect(source).toContain("for start in range(0, len(to_open), 2):");
  return source;
}

describe("ac26-w2-private-aggregate: participant contract", () => {
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
      "local/tests/public/test_aggregate.py",
      "local/tests/hidden/check_aggregate.py",
      "local/verifier/server.py",
      "local/starter/aggregate.py",
      "local/reference/aggregate.py",
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

describe("ac26-w2-private-aggregate: container safety", () => {
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

describe("ac26-w2-private-aggregate: fixtures are seed-derived", () => {
  it("should produce different settings for different seeds", () => {
    const script = [
      "import json, sys",
      "sys.path.insert(0, '.')",
      "from fixtures.generate import health_token, setting",
      "st = setting(sys.argv[1])",
      "print(json.dumps({'p': st.p, 'n': st.parties, 'c': st.counts, 't': health_token(sys.argv[1])}))",
    ].join("\n");
    const first = python(["-c", script, "seed-alpha"]).stdout.trim();
    const second = python(["-c", script, "seed-beta"]).stdout.trim();
    const again = python(["-c", script, "seed-alpha"]).stdout.trim();

    expect(first).not.toBe(second);
    expect(first).toBe(again);
  });

  it("should vary the organization count across seeds, so k is never assumed", () => {
    const script = [
      "import sys",
      "sys.path.insert(0, '.')",
      "from fixtures.generate import setting",
      "print(','.join(str(setting('s%d' % i).parties) for i in range(40)))",
    ].join("\n");
    const counts = new Set(python(["-c", script]).stdout.trim().split(","));
    expect(counts.size).toBeGreaterThan(2);
  });

  // Reuse is detected by matching opened values against the masks each triple implies.
  // Triples that coincided would make two products indistinguishable and blunt that.
  it("should generate a distinct mask for every triple", () => {
    const script = [
      "import sys",
      "sys.path.insert(0, '.')",
      "from fixtures.generate import reconstruct, setting, triples",
      "bad = 0",
      "for i in range(60):",
      "    st = setting('s%d' % i)",
      "    ts = triples('s%d' % i, 'h0', st, st.parties)",
      "    masks = [reconstruct(list(t.a), st.p) for t in ts]",
      "    if len(set(masks)) != len(masks):",
      "        bad += 1",
      "print(bad)",
    ].join("\n");
    expect(python(["-c", script]).stdout.trim()).toBe("0");
  });

  it("should hold the triple invariant c = a*b in every generated triple", () => {
    const script = [
      "import sys",
      "sys.path.insert(0, '.')",
      "from fixtures.generate import reconstruct, setting, triples",
      "bad = 0",
      "for i in range(40):",
      "    st = setting('s%d' % i)",
      "    for t in triples('s%d' % i, 'h0', st, st.parties):",
      "        a = reconstruct(list(t.a), st.p)",
      "        b = reconstruct(list(t.b), st.p)",
      "        if reconstruct(list(t.c), st.p) != a * b % st.p:",
      "            bad += 1",
      "print(bad)",
    ].join("\n");
    expect(python(["-c", script]).stdout.trim()).toBe("0");
  });
});

describe("ac26-w2-private-aggregate: the problem is solvable and actually fails", () => {
  it("should fail the public tests in the shipped starter state", () => {
    const result = python(["tests/public/test_aggregate.py"]);
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

describe("ac26-w2-private-aggregate: /verify contract", () => {
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

  // The heart of the problem. Both of these are *correct* — the score is right — and
  // both must still fail, each on the specific checkpoint that measures what they broke.
  it("should accept a triple-reusing submission on multiply but reject it on privacy", () => {
    const source = reusingOneTriple();
    expect(evaluate("multiply", source)).toBe(true);
    expect(evaluate("privacy", source)).toBe(false);
  }, 180_000);

  it("should accept a per-multiplication opener on multiply and privacy but reject it on cost", () => {
    const source = openingPerMultiplication();
    expect(evaluate("multiply", source)).toBe(true);
    expect(evaluate("privacy", source)).toBe(true);
    expect(evaluate("cost", source)).toBe(false);
  }, 180_000);

  // The plan is graded against the run, so an estimate that is internally tidy but does
  // not describe what the protocol actually did is still wrong.
  it("should reject a cost claim that does not match the measured run", () => {
    const source = bundle("reference").replace(
      'return {"multiplications": k, "triples": k, "rounds": 1}',
      'return {"multiplications": k, "triples": k, "rounds": k}',
    );
    expect(evaluate("cost", source)).toBe(false);
  }, 120_000);

  it("should reject a submission that opens the running subtotal", () => {
    const source = bundle("reference").replace(
      '    return add_public(total, spec["bias"], p)',
      '    io.open_batch([list(total)])\n    return add_public(total, spec["bias"], p)',
    );
    expect(evaluate("privacy", source)).toBe(false);
  }, 120_000);

  it("should reject a submission that hangs, rather than hanging itself", () => {
    expect(evaluate("plan", "def plan(spec):\n    while True:\n        pass\n")).toBe(false);
  }, 60_000);

  it("should reject a submission that cannot even be imported", () => {
    expect(evaluate("plan", "def plan(:\n")).toBe(false);
  }, 60_000);

  it("should reject an unknown checkpoint id instead of crediting it", () => {
    expect(evaluate("finish-week2", bundle("reference"))).toBe(false);
  });

  it("should echo the checkpointId so the platform can fail closed", () => {
    expect(read("local/verifier/server.py")).toContain(
      '{"checkpointId": checkpoint_id, "correct": correct}',
    );
  });
});

describe("ac26-w2-private-aggregate: metadata contracts", () => {
  function metadata() {
    return JSON.parse(read("metadata.json")) as {
      difficulty: number;
      status: string;
      courseAlignment: { week: number; role: string; sources?: Array<{ kind: string }> };
      scoring: {
        kind: string;
        checks: Array<{ id: string; points: number; hints?: Array<{ penalty: number }> }>;
      };
    };
  }

  it("should total the Hard tier's 300 points across its checkpoints", () => {
    const meta = metadata();
    expect(meta.scoring.kind).toBe("multi-verify");
    expect(meta.difficulty).toBe(5);
    expect(meta.scoring.checks.reduce((sum, check) => sum + check.points, 0)).toBe(300);
    for (const check of meta.scoring.checks) {
      const penalty = (check.hints ?? []).reduce((sum, hint) => sum + hint.penalty, 0);
      expect(penalty).toBeLessThanOrEqual(check.points / 2);
    }
  });

  it("should score exactly the checkpoints the verifier implements", () => {
    expect(metadata().scoring.checks.map((check) => check.id)).toEqual([...CHECKPOINTS]);
  });

  // Week 2 was unpublished when this problem was authored, so it pinned the placeholder
  // README (SYNC.md §2). The material has since shipped upstream — week2/problems/toy-mpc —
  // and was read on 2026-08-09: `course:drift` reported PUBLISHED, and the kind moved only
  // after the reading. The pins then moved to the commit the whole track was re-read at on
  // 2026-08-12, per SYNC.md §3/§5: the week README as `lecture`, the exercise README as
  // `assignment`. The exact sources are pinned here so a ref bumped without a review
  // shows up as a diff.
  it("should pin week 2's published lecture and exercise", () => {
    const { courseAlignment, status } = metadata();
    expect(courseAlignment.week).toBe(2);
    expect(courseAlignment.role).toBe("synthesis");
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
});
