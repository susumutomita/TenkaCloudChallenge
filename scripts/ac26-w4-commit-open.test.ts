import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import { parse as parseYaml } from "yaml";

/**
 * ac26-w4-commit-open isolates the commit/challenge/open ORDER. Every mutation of this
 * problem produces a protocol that commits, challenges, opens and verifies successfully
 * — they differ only in what an adversary can do afterwards, so the assertions attack
 * rather than round-trip. Python 3 is on ubuntu-latest and the problem is stdlib-only.
 */

const ROOT = join(import.meta.dir, "..", "challenges", "ac26-w4-commit-open");
const LOCAL = join(ROOT, "local");
const SEED = "ci-fixed-seed";
const CHECKPOINTS = [
  "encoding",
  "root",
  "opening",
  "order",
  "adaptive",
  "ambiguity",
  "transcript",
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
  return read(`local/${dir}/commit.py`);
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

describe("ac26-w4-commit-open: participant contract", () => {
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
      "local/tests/public/test_commit.py",
      "local/tests/hidden/check_commit.py",
      "local/verifier/server.py",
      "local/starter/commit.py",
      "local/reference/commit.py",
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

describe("ac26-w4-commit-open: container safety", () => {
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

describe("ac26-w4-commit-open: the fixtures state the weakness rather than the learner", () => {
  // Breaking code you deliberately weakened yourself is not a counterexample, so the
  // separator-free encoding is fixed in the fixtures and absent from both submissions.
  it("should define the weak leaf encoding outside the submission", () => {
    expect(read("local/fixtures/generate.py")).toContain("def weak_leaf(");
    expect(bundle("starter")).not.toContain("def weak_leaf(");
    expect(bundle("reference")).not.toContain("def weak_leaf(");
  });

  it("should make the weak encoding genuinely collide on a nameable pair", () => {
    const script = [
      "import sys",
      "sys.path.insert(0, '.')",
      "from fixtures.generate import weak_leaf",
      "print(weak_leaf(1, 23) == weak_leaf(12, 3))",
    ].join("\n");
    expect(python(["-c", script]).stdout.trim()).toBe("True");
  });

  // A power of two means every level pairs cleanly, so the odd-leaf rule never applies.
  // Ragged trees are a separate lesson and conflating them would hide this one.
  it("should only commit to vectors whose length is a power of two", () => {
    const script = [
      "import sys",
      "sys.path.insert(0, '.')",
      "from fixtures.generate import setting",
      "bad = [i for i in range(60) if setting('s%d' % i)['length'] & (setting('s%d' % i)['length'] - 1)]",
      "print(len(bad))",
    ].join("\n");
    expect(python(["-c", script]).stdout.trim()).toBe("0");
  });
});

describe("ac26-w4-commit-open: the problem is solvable and actually fails", () => {
  it("should fail the public tests in the shipped starter state", () => {
    const result = python(["tests/public/test_commit.py"]);
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

describe("ac26-w4-commit-open: /verify contract", () => {
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

  // Every one of these commits, challenges, opens and verifies successfully.
  it("should reject a leaf encoding that does not bind the index", () => {
    const source = bundle("reference").replace(
      '    return LEAF_TAG + index.to_bytes(4, "big") + value.to_bytes(8, "big")',
      '    return LEAF_TAG + value.to_bytes(8, "big")',
    );
    expect(evaluate("encoding", source)).toBe(false);
  }, 120_000);

  it("should reject a verifier that ignores which side each sibling is on", () => {
    const source = bundle("reference").replace(
      '        node = node_hash(sibling, node) if step["sibling_is_left"] else node_hash(node, sibling)',
      "        node = node_hash(node, sibling)",
    );
    expect(evaluate("opening", source)).toBe(false);
  }, 120_000);

  it("should reject a session that accepts a challenge before the commitment", () => {
    const source = bundle("reference").replace(
      '        if self.phase != "committed":\n            raise ProtocolError("a challenge before a commitment is not a challenge")',
      "        pass",
    );
    expect(evaluate("order", source)).toBe(false);
  }, 120_000);

  // A challenge that does not depend on the commitment is one the prover knew first.
  it("should reject a transcript that leaves the commitment out", () => {
    const source = bundle("reference").replace(
      '            len(statement).to_bytes(4, "big"),\n            statement,\n            root,',
      '            len(statement).to_bytes(4, "big"),\n            statement,',
    );
    expect(evaluate("transcript", source)).toBe(false);
  }, 120_000);

  it("should reject an adaptive witness that is just the honest vector", () => {
    const source = bundle("reference").replace(
      "    forged = [(value + 1) % 10_000 for value in honest]\n    forged[query] = honest[query]",
      "    forged = list(honest)",
    );
    expect(evaluate("adaptive", source)).toBe(false);
  }, 120_000);

  it("should reject a submission that hangs, rather than hanging itself", () => {
    expect(
      evaluate("root", "def merkle_root(values):\n    while True:\n        pass\n"),
    ).toBe(false);
  }, 60_000);

  it("should reject a submission that cannot even be imported", () => {
    expect(evaluate("root", "def merkle_root(:\n")).toBe(false);
  }, 60_000);

  it("should reject an unknown checkpoint id instead of crediting it", () => {
    expect(evaluate("finish-week4", bundle("reference"))).toBe(false);
  });

  it("should echo the checkpointId so the platform can fail closed", () => {
    expect(read("local/verifier/server.py")).toContain(
      '{"checkpointId": checkpoint_id, "correct": correct}',
    );
  });
});

describe("ac26-w4-commit-open: metadata contracts", () => {
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

  // Week 4's lecture (slides + README) was published upstream on 2026-08-18, so the
  // pin moved from the placeholder to the real material. The official exercise is
  // still WIP in that README, so the role stays `transfer` (it carries the lecture's
  // idea into a different setting) rather than `assignment-companion`.
  it("should pin week 4's published lecture and keep a role that claims no assignment", () => {
    const { courseAlignment, status } = metadata();
    expect(courseAlignment.week).toBe(4);
    expect(["diagnostic", "transfer"]).toContain(courseAlignment.role);
    expect(courseAlignment.sources).toEqual([
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
    expect(status).toBe("draft");
  });
});
