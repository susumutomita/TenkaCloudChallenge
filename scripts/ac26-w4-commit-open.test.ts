import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import { parse as parseYaml } from "yaml";
import { participantPythonFiles } from "./lib/local-play-problems";

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

describe("ac26-w4-commit-open: participant/verifier separation (Issue 537/538)", () => {
  it("keeps fixtures/, node_hash's implementation and the hidden suite out of the participant Docker stage", () => {
    const dockerfile = read("local/Dockerfile");
    const participantStage = dockerfile.slice(
      dockerfile.indexOf("FROM base AS participant"),
      dockerfile.indexOf("FROM base AS verifier"),
    );
    // The class this problem was scaffolded with before this fix: `fixtures/` shipping
    // to the participant stage put a complete `node_hash` -- under the exact name the
    // starter's own stub asks the learner to write -- in the same container a
    // learner's own build produced, and `tests/hidden/check_commit.py` shipping there
    // put every checkpoint's own assertions right alongside it.
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

  it("reproduces the original leak: node_hash's implementation and the hidden suite are no longer in any file the participant image carries", () => {
    // The file list comes from the Dockerfile's participant stage, via the same
    // derivation `check-answer-reachability.ts` uses, rather than being restated here --
    // so a COPY that puts `fixtures/` or `tests/hidden/` back fails this test.
    const participantFiles = participantPythonFiles(
      join(import.meta.dir, ".."),
      "challenges/ac26-w4-commit-open",
    );
    expect(participantFiles).not.toContain(
      "challenges/ac26-w4-commit-open/local/fixtures/generate.py",
    );
    expect(participantFiles).not.toContain(
      "challenges/ac26-w4-commit-open/local/tests/hidden/check_commit.py",
    );
    expect(participantFiles).toContain(
      "challenges/ac26-w4-commit-open/local/tests/public/test_commit.py",
    );
    for (const file of participantFiles) {
      const source = readFileSync(join(import.meta.dir, "..", file), "utf8");
      // The one permitted mention is the lazy, function-scoped checkout/author
      // fallback: never a module-level import, which is what would fail loudly the
      // moment it ran inside a participant image that carries no `fixtures/` at all.
      expect(source).not.toMatch(/^from fixtures/m);
      expect(source).not.toMatch(/^import fixtures/m);
    }
    // The starter's own `node_hash` stub stays -- it is the file the learner edits and
    // it never held a working implementation. What must not be reachable is a WORKING
    // `node_hash`, which only ever lived in `fixtures/generate.py`, asserted absent
    // above.
    const starter = bundle("starter");
    expect(starter).toContain("def node_hash(");
    const nodeHashBody = starter.slice(starter.indexOf("def node_hash("));
    expect(nodeHashBody.slice(0, nodeHashBody.indexOf("\n\n"))).toContain('return b""');
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
      "  'forged': _unwrap_submission('root', 'tcw1.eyJ2IjoxfQ.AAAA'),",
      "  'code': _unwrap_submission('root', 'def merkle_root(): pass'),",
      "}))",
    ].join("\n");
    const result = python(["-c", script]);
    expect(result.status).toBe(0);
    const output = JSON.parse(result.stdout.trim().split("\n").at(-1) ?? "{}") as {
      forged: unknown;
      code: unknown;
    };
    expect(output.forged).toBeNull();
    expect(output.code).toBe("def merkle_root(): pass");
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
      '"127.0.0.1:18105:18105"',
      "VERIFIER_URL: http://verifier:18106/verify",
      "VERIFIER_PUBLIC_URL: http://verifier:18106/public",
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
    expect(compose).not.toContain('"127.0.0.1:18106:18106"');
    expect(compose.match(/ports:/g)).toHaveLength(1);
  });

  it("serves the public evidence without a node_hash a learner could import", () => {
    const script = [
      "import json, sys",
      "sys.path.insert(0, '.')",
      "from fixtures.generate import public_payload",
      "payload = public_payload('ci-fixed-seed')",
      "print(json.dumps({'keys': sorted(payload)}))",
    ].join("\n");
    const result = python(["-c", script]);
    expect(result.status).toBe(0);
    const output = JSON.parse(result.stdout.trim().split("\n").at(-1) ?? "{}") as {
      keys: string[];
    };
    expect(output.keys).toEqual([
      "healthToken",
      "leafHashesHex",
      "openingForQuery",
      "rootHex",
      "setting",
      "treeLevels",
    ]);
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
