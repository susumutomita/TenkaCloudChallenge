import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import { parse as parseYaml } from "yaml";
import { participantPythonFiles } from "./lib/local-play-problems";

/**
 * ac26-w2-linear-shares is the first Week 1 problem. The interesting assertions run its
 * Python for real — the starter fails, the reference passes every checkpoint, the mutation
 * suite kills every intended defect, and /verify holds its security contract — rather than
 * reading source text. Python 3 is on ubuntu-latest and the problem is stdlib-only.
 */

const ROOT = join(import.meta.dir, "..", "challenges", "ac26-w2-linear-shares");
const LOCAL = join(ROOT, "local");
const SEED = "ci-fixed-seed";
const SUBMITTED = ["linear.py"] as const;

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
  return read(`local/${dir}/linear.py`);
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

function communicationAnswer(interactiveRounds = 1): string {
  const script = [
    "import json, os, sys",
    "sys.path.insert(0, '.')",
    "from fixtures.generate import OPERATION_ROUNDS, operations",
    "answer = {name: (0 if OPERATION_ROUNDS[name] == 0 else int(sys.argv[1]))",
    "          for name in operations(os.environ['FLAG_SEED'])}",
    "print(json.dumps(answer))",
  ].join("\n");
  const result = python(["-c", script, String(interactiveRounds)]);
  expect(result.status).toBe(0);
  return result.stdout.trim();
}

describe("ac26-w2-linear-shares: participant contract", () => {
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
      "local/tests/public/test_linear.py",
      "local/tests/hidden/check_linear.py",
      "local/verifier/server.py",
      "local/participant/server.py",
      "local/participant/workbench.py",
      "local/starter/linear.py",
      "local/reference/linear.py",
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

describe("ac26-w2-linear-shares: container safety", () => {
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

describe("ac26-w2-linear-shares: fixtures are seed-derived", () => {
  it("should produce different circuits for different seeds", () => {
    const script = [
      "import json, sys",
      "sys.path.insert(0, '.')",
      "from fixtures.generate import setting, health_token",
      "seed = sys.argv[1]",
      "print(json.dumps({'s': setting(seed), 't': health_token(seed)}))",
    ].join("\n");
    const first = python(["-c", script, "seed-alpha"]).stdout.trim();
    const second = python(["-c", script, "seed-beta"]).stdout.trim();
    const again = python(["-c", script, "seed-alpha"]).stdout.trim();

    expect(first).not.toBe(second);
    expect(first).toBe(again);
  });

  it("should vary the party count across seeds, so n is never assumed", () => {
    const script = [
      "import sys",
      "sys.path.insert(0, '.')",
      "from fixtures.generate import setting",
      "print(','.join(str(setting('s%d' % i)['n']) for i in range(40)))",
    ].join("\n");
    const counts = new Set(python(["-c", script]).stdout.trim().split(","));
    expect(counts.size).toBeGreaterThan(2);
  });

  it("should vary the operation set instead of grading one shareable table", () => {
    const script = [
      "import json, sys",
      "sys.path.insert(0, '.')",
      "from fixtures.generate import operations",
      "answers = [json.dumps(operations(f'solvability-{i}')) for i in range(2000)]",
      "counts = {answer: answers.count(answer) for answer in set(answers)}",
      "print(json.dumps({'distinct': len(counts), 'max': max(counts.values())}))",
    ].join("\n");
    const result = python(["-c", script]);
    expect(result.status).toBe(0);
    const distribution = JSON.parse(result.stdout.trim()) as { distinct: number; max: number };
    expect(distribution.distinct).toBeGreaterThan(20);
    expect(distribution.max / 2000).toBeLessThan(0.08);
  });
});

describe("ac26-w2-linear-shares: the problem is solvable and actually fails", () => {
  it("should fail the public tests in the shipped starter state", () => {
    const result = python(["tests/public/test_linear.py"]);
    expect(result.status).not.toBe(0);
    expect(result.stdout).toContain("FAIL");
  });

  it("should kill every intended defect in the mutation suite", () => {
    const result = python(["mutation.py"]);
    expect(result.stdout).toContain("PASS reference implementation passes the hidden tests");
    expect(result.stdout).not.toContain("SURVIVED");
    expect(result.status).toBe(0);
  });
});

describe("ac26-w2-linear-shares: /verify contract", () => {
  it.each(["add-shares", "add-constant", "mul-constant", "transfer"])(
    "should accept the reference submission on %s",
    (checkpoint) => {
      expect(evaluate(checkpoint, bundle("reference"))).toBe(true);
    },
    120_000,
  );

  it.each(["add-shares", "add-constant", "mul-constant", "transfer"])(
    "should reject the starter submission on %s",
    (checkpoint) => {
      expect(evaluate(checkpoint, bundle("starter"))).toBe(false);
    },
    120_000,
  );

  it("should reject a submission that hangs, rather than hanging itself", () => {
    expect(
      evaluate("add-shares", "def add_shares(a, b, p):\n    while True:\n        pass\n"),
    ).toBe(false);
  }, 60_000);

  it("should reject an unknown checkpoint id instead of crediting it", () => {
    expect(evaluate("finish-week2", bundle("reference"))).toBe(false);
  });

  it("should reject a partial operation table", () => {
    expect(
      evaluate(
        "no-communication",
        '{"add-shared": 0, "add-constant": 0, "mul-constant": 0}',
      ),
    ).toBe(false);
  });

  // The whole point of the classification: multiplying two shared values is the one
  // operation that cannot be done locally.
  it("should reject a table claiming multiplication of two sharings is local", () => {
    expect(
      evaluate(
        "no-communication",
        '{"add-shared": 0, "add-constant": 0, "mul-constant": 0, "mul-shared": 0}',
      ),
    ).toBe(false);
  });

  // Graded on zero versus non-zero, because the round count of a multiplication
  // protocol is protocol-dependent while the need to communicate is not.
  it("should accept any positive round count for multiplying two sharings", () => {
    for (const rounds of [1, 2, 3]) {
      expect(evaluate("no-communication", communicationAnswer(rounds))).toBe(true);
    }
  });

  it("should echo the checkpointId so the platform can fail closed", () => {
    expect(read("local/verifier/server.py")).toContain(
      '{"checkpointId": checkpoint_id, "correct": correct}',
    );
  });
});

describe("ac26-w2-linear-shares: participant/verifier separation (Issue 543/537)", () => {
  it("keeps fixtures/, the answer derivation and the hidden suite out of the participant Docker stage", () => {
    const dockerfile = read("local/Dockerfile");
    const participantStage = dockerfile.slice(
      dockerfile.indexOf("FROM base AS participant"),
      dockerfile.indexOf("FROM base AS verifier"),
    );
    // The class this problem was scaffolded from before this fix: `fixtures/` shipping
    // to the participant stage put the round-count table `no-communication` is graded
    // against inside the learner's own container, so their own FLAG_SEED was enough to
    // reconstruct that checkpoint's answer with one import — no matter where the
    // comparison itself lived.
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

  it("reproduces the original leak: the answer table is no longer in any file the participant image carries", () => {
    // The file list comes from the Dockerfile's participant stage, via the same
    // derivation `check-answer-reachability.ts` uses, rather than being restated here —
    // so a COPY that puts `fixtures/` back fails this test. Before the split
    // `fixtures/generate.py` was in this list, and the round-count table it defines was
    // `no-communication`'s answer for the price of one import.
    const participantFiles = participantPythonFiles(join(import.meta.dir, ".."), "challenges/ac26-w2-linear-shares");
    expect(participantFiles).not.toContain(
      "challenges/ac26-w2-linear-shares/local/fixtures/generate.py",
    );
    expect(participantFiles).toContain(
      "challenges/ac26-w2-linear-shares/local/tests/public/test_linear.py",
    );
    for (const file of participantFiles) {
      const source = readFileSync(join(import.meta.dir, "..", file), "utf8");
      // The one permitted mention is the lazy, function-scoped checkout/author
      // fallback: never a module-level import, which is what would fail loudly the
      // moment it ran inside a participant image that carries no `fixtures/` at all.
      expect(source).not.toMatch(/^from fixtures/m);
      expect(source).not.toMatch(/^import fixtures/m);
      expect(source).not.toContain("OPERATION_ROUNDS[");
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
    expect(participantServer).not.toContain("def _check_");
    expect(participantServer).not.toMatch(/^from fixtures/m);
    expect(hiddenServer).toContain("from fixtures.generate import");
    expect(hiddenServer).toContain("/verify");
    expect(hiddenServer).toContain("/healthz");
    expect(hiddenServer).toContain("/public");
  });

  it("re-checks the answer seal in the verifier, so bypassing the Workbench does not credit a bare answer", () => {
    // The Workbench unwraps nothing before proxying: a `no-communication` table that
    // never went through prepare must be rejected by the verifier itself.
    const script = [
      "import json, sys",
      "sys.path.insert(0, '.')",
      "from verifier.server import _unwrap_submission",
      "raw = '{\"add-shared\": 0}'",
      "print(json.dumps({",
      "  'bare': _unwrap_submission('no-communication', raw),",
      "  'forged': _unwrap_submission('no-communication', 'tcw1.eyJ2IjoxfQ.AAAA'),",
      "  'code': _unwrap_submission('add-shares', 'def add_shares(): pass'),",
      "}))",
    ].join("\n");
    const result = python(["-c", script]);
    expect(result.status).toBe(0);
    const output = JSON.parse(result.stdout.trim().split("\n").at(-1) ?? "{}") as {
      bare: unknown;
      forged: unknown;
      code: unknown;
    };
    expect(output.bare).toBeNull();
    expect(output.forged).toBeNull();
    expect(output.code).toBe("def add_shares(): pass");
  });

  it("accepts a sealed answer end to end, Workbench seal through verifier unwrap", () => {
    const script = [
      "import json, sys",
      "sys.path.insert(0, '.')",
      "from participant.server import _WORKBENCH",
      "from verifier.server import _unwrap_submission, evaluate",
      "from fixtures.generate import OPERATION_ROUNDS, operations",
      "import os",
      "answer = {name: (0 if OPERATION_ROUNDS[name] == 0 else 1)",
      "          for name in operations(os.environ['FLAG_SEED'])}",
      "prepared = _WORKBENCH.prepare_submissions(_WORKBENCH.starter_payload(),",
      "                                          {'no-communication': json.dumps(answer)})",
      "sealed = prepared['submissions']['no-communication']",
      "unwrapped = _unwrap_submission('no-communication', sealed)",
      "print(json.dumps({'sealed': sealed.startswith('tcw1.'),",
      "                  'correct': evaluate('no-communication', unwrapped)}))",
    ].join("\n");
    const result = python(["-c", script]);
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout.trim().split("\n").at(-1) ?? "{}")).toEqual({
      sealed: true,
      correct: true,
    });
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
    "hasInlineEvaluator": hasattr(server, "evaluate") or any(name.startswith("_check_") for name in dir(server)),
}))
`;
    const result = python(["-c", script]);
    expect(result.status).toBe(0);
    const output = JSON.parse(result.stdout.trim().split("\n").at(-1) ?? "{}") as {
      missing: Array<{ checkpointId: string; correct: boolean }>;
      unavailable: Array<{ checkpointId: string; correct: boolean }>;
      hasInlineEvaluator: boolean;
    };
    const expectedVerdicts = [
      "add-shares",
      "add-constant",
      "mul-constant",
      "no-communication",
      "transfer",
    ].map((checkpointId) => ({ checkpointId, correct: false }));
    expect(output.missing).toEqual(expectedVerdicts);
    expect(output.unavailable).toEqual(expectedVerdicts);
    expect(output.hasInlineEvaluator).toBe(false);
  });

  it("compose builds the right target for each service, publishes only the Workbench port, and isolates the verifier network", () => {
    const compose = read("local/docker-compose.yml");
    for (const contract of [
      "target: participant",
      "target: verifier",
      '"127.0.0.1:18096:18096"',
      "VERIFIER_URL: http://verifier:18097/verify",
      "VERIFIER_PUBLIC_URL: http://verifier:18097/public",
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
    expect(compose).not.toContain('"127.0.0.1:18097:18097"');
    expect(compose.match(/ports:/g)).toHaveLength(1);
  });

  it("serves the public evidence without the classification the checkpoint is graded on", () => {
    const script = [
      "import json, sys",
      "sys.path.insert(0, '.')",
      "from fixtures.generate import public_payload",
      "payload = public_payload('ci-fixed-seed')",
      "print(json.dumps({'keys': sorted(payload), 'blob': json.dumps(payload)}))",
    ].join("\n");
    const result = python(["-c", script]);
    expect(result.status).toBe(0);
    const output = JSON.parse(result.stdout.trim().split("\n").at(-1) ?? "{}") as {
      keys: string[];
      blob: string;
    };
    expect(output.keys).toEqual([
      "healthToken",
      "operations",
      "setting",
      "sharesOfX",
      "sharesOfY",
    ]);
    // The four operation names are the question. Which of them are local is the answer,
    // and no wording of it travels over /public.
    for (const forbidden of ["rounds", "local", "interactive"]) {
      expect(output.blob.toLowerCase()).not.toContain(forbidden);
    }
  });
});

describe("ac26-w2-linear-shares: metadata contracts", () => {
  function metadata() {
    return JSON.parse(read("metadata.json")) as {
      difficulty: number;
      status: string;
      courseAlignment: { week: number; role: string; sources?: Array<{ ref: string }> };
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

  // Week 2's material was published and read on 2026-08-09, so this pin now records an
  // alignment rather than an absence. The placeholder did its job: `course:drift`
  // reported PUBLISHED, and the material was read before the kind moved.
  //
  // What the reading found is what this test now guards. The official `toy-mpc` has two
  // halves, and this track accompanies one of them: Part A (Arithmetic MPC) is covered,
  // Part B (Oblivious Transfer and the GMW secret AND) has no companion at all —
  // Issue 412. The `assignment` pin is the only thing watching the file that would tell
  // us the official exercise moved again. Dropping it would not fail anything today; it
  // would just make the uncovered half stop being visible, which is how a known gap
  // turns into a forgotten one.
  it("should pin week 2's published material, including the official exercise", () => {
    const { courseAlignment, status } = metadata();
    expect(courseAlignment.week).toBe(2);
    expect(courseAlignment.role).toBe("mechanism");
    expect(courseAlignment.sources).toEqual([
      {
        repository: "zk-tokyo/advanced-cryptography-2026",
        ref: "a3aa4b56fa88fbe803b57d320fbc87c1a203b480",
        path: "week2/README.md",
        kind: "lecture",
      },
      {
        repository: "zk-tokyo/advanced-cryptography-2026",
        ref: "a3aa4b56fa88fbe803b57d320fbc87c1a203b480",
        path: "week2/problems/toy-mpc/README.md",
        kind: "assignment",
      },
    ]);
    expect(status).toBe("draft");
  });
});
