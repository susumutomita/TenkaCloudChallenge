import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import { parse as parseYaml } from "yaml";

/**
 * ac26-w6-cosnark-linear is the first Week 6 problem. The interesting assertions run its
 * Python for real — the starter fails, the reference passes every checkpoint, the mutation
 * suite kills every intended defect, and /verify holds its security contract — rather than
 * reading source text. Python 3 is on ubuntu-latest and the problem is stdlib-only.
 *
 * Two of them are about this problem specifically rather than about the template:
 *
 *  - the `audit` checkpoint is the **only** one that catches a prover which reconstructs the
 *    witness, folds it in the clear and re-shares the answer. Both READMEs say so, so the
 *    claim is pinned here rather than left to the mutation suite's summary line.
 *  - the `trace` checkpoint is handed a log that disagrees with the answer everyone already
 *    knows. A report that returns `rounds: 0` from belief has to fail.
 */

const ROOT = join(import.meta.dir, "..", "challenges", "ac26-w6-cosnark-linear");
const LOCAL = join(ROOT, "local");
const SEED = "ci-fixed-seed";
const CHECKPOINTS = [
  "relation",
  "witness",
  "combine-a",
  "combine-b",
  "audit",
  "trace",
  "equivalence",
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
  return read(`local/${dir}/prover.py`);
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

describe("ac26-w6-cosnark-linear: participant contract", () => {
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
      "local/tests/public/test_prover.py",
      "local/tests/hidden/check_prover.py",
      "local/verifier/server.py",
      "local/starter/prover.py",
      "local/reference/prover.py",
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

describe("ac26-w6-cosnark-linear: container safety", () => {
  it("should publish every port on loopback only", () => {
    const compose = parseYaml(read("local/docker-compose.yml")) as {
      services: Record<string, { ports?: string[] }>;
    };
    const ports = Object.values(compose.services).flatMap((service) => service.ports ?? []);
    expect(ports.length).toBeGreaterThan(0);
    for (const mapping of ports) expect(mapping.startsWith("127.0.0.1:")).toBe(true);
  });

  it("should bound the verifier itself, not only the submissions it runs", () => {
    const compose = read("local/docker-compose.yml");
    expect(compose).toContain("mem_limit:");
    expect(compose).toContain("pids_limit:");
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

describe("ac26-w6-cosnark-linear: fixtures are seed-derived", () => {
  it("should produce different settings for different seeds", () => {
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

  it("should vary the field, party count and witness length across seeds", () => {
    const script = [
      "import sys",
      "sys.path.insert(0, '.')",
      "from fixtures.generate import setting",
      "print(','.join(setting('s%d' % i)['settingId'] for i in range(40)))",
    ].join("\n");
    const ids = python(["-c", script]).stdout.trim().split(",");
    const fields = new Set(ids.map((id) => id.split("-")[0]));
    const parties = new Set(ids.map((id) => id.split("-")[1]));
    const widths = new Set(ids.map((id) => id.split("-")[2]));
    expect(fields.size).toBeGreaterThan(2);
    expect(parties.size).toBeGreaterThan(2);
    expect(widths.size).toBeGreaterThan(2);
  });

  it("should draw a sparse shape that really has zeros, so the index trap can fire", () => {
    // Without a zero anywhere, indexing the witness by position among the non-zero
    // coefficients is indistinguishable from indexing it by j, and `equivalence` would be
    // testing nothing it does not already test with a dense vector.
    const script = [
      "import sys",
      "sys.path.insert(0, '.')",
      "from fixtures.generate import coefficients, setting",
      "seeds = ['s%d' % i for i in range(20)]",
      "rows = [coefficients(s, 'r:a', setting(s), 'sparse') for s in seeds]",
      "print(sum(1 for row in rows if any(c == 0 for c in row) and any(row)))",
    ].join("\n");
    expect(Number(python(["-c", script]).stdout.trim())).toBeGreaterThan(15);
  });

  it("should draw signed coefficients that are actually negative", () => {
    const script = [
      "import sys",
      "sys.path.insert(0, '.')",
      "from fixtures.generate import coefficients, setting",
      "seeds = ['s%d' % i for i in range(20)]",
      "rows = [coefficients(s, 'r:a', setting(s), 'signed') for s in seeds]",
      "print(sum(1 for row in rows if any(c < 0 for c in row)))",
    ].join("\n");
    expect(Number(python(["-c", script]).stdout.trim())).toBeGreaterThan(15);
  });
});

describe("ac26-w6-cosnark-linear: the problem is solvable and actually fails", () => {
  it("should fail the public tests in the shipped starter state", () => {
    const result = python(["tests/public/test_prover.py"]);
    expect(result.status).not.toBe(0);
    expect(result.stdout).toContain("FAIL");
  });

  it("should kill every intended defect in the mutation suite", () => {
    const result = python(["mutation.py"]);
    expect(result.stdout).toContain("PASS reference implementation passes the hidden tests");
    expect(result.stdout).not.toContain("SURVIVED");
    expect(result.status).toBe(0);
  }, 120_000);

  it("should still measure that most defects reconstruct to the right A and B", () => {
    // The README quotes this count. If a change makes the checkpoints cheaper the number
    // moves, and the claim has to move with it rather than quietly going stale.
    const result = python(["mutation.py"]);
    expect(result.stdout).toContain(
      "18 of 24 mutations reconstruct to the right A and B on every shape",
    );
    for (const readme of ["README.md", "README.ja.md"]) {
      expect(read(readme)).toContain("18");
      expect(read(readme)).toContain("24");
    }
  }, 120_000);
});

describe("ac26-w6-cosnark-linear: /verify contract", () => {
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

  it("should reject a submission that hangs, rather than hanging itself", () => {
    expect(
      evaluate("relation", "def parse_relation(relation):\n    while True:\n        pass\n"),
    ).toBe(false);
  }, 120_000);

  it("should reject an unknown checkpoint id instead of crediting it", () => {
    expect(evaluate("finish-week6", bundle("reference"))).toBe(false);
  });

  it("should echo the checkpointId so the platform can fail closed", () => {
    expect(read("local/verifier/server.py")).toContain(
      '{"checkpointId": checkpoint_id, "correct": correct}',
    );
  });
});

describe("ac26-w6-cosnark-linear: what each checkpoint is worth", () => {
  /** Run one mutation of the reference through every hidden phase, and name the catchers. */
  function phasesCatching(mutationName: string): string[] {
    const script = [
      "import json, sys",
      "sys.path.insert(0, '.')",
      "from mutation import _load, _mutations, SEED",
      "from tests.hidden.check_prover import PHASES",
      "source = dict(_mutations())[sys.argv[1]]",
      "module = _load(source)",
      "print(json.dumps([p.__name__ for p in PHASES if p(module, SEED)]))",
    ].join("\n");
    const result = python(["-c", script, mutationName]);
    expect(result.status).toBe(0);
    return JSON.parse(result.stdout.trim().split("\n").at(-1) ?? "null") as string[];
  }

  // The claim both READMEs make, in the one place a later edit would break it silently.
  // `check_transfer` re-runs every other phase under a derived seed, so it is expected to
  // appear alongside whichever phase actually did the catching.
  it("should let only the audit catch a prover that reconstructs and re-shares", () => {
    expect(phasesCatching("witness reconstructed, folded in the clear, and re-shared")).toEqual([
      "check_audit",
      "check_transfer",
    ]);
  }, 120_000);

  it("should let only the parser catch a coefficient left in a non-canonical form", () => {
    expect(phasesCatching("coefficients left as the representative they arrived as")).toEqual([
      "check_relation",
      "check_transfer",
    ]);
  }, 120_000);

  it("should reject a communication report that asserts the answer it already knows", () => {
    expect(phasesCatching("trace reports the answer everyone already knows")).toContain(
      "check_trace",
    );
  }, 120_000);
});

describe("ac26-w6-cosnark-linear: metadata contracts", () => {
  function metadata() {
    return JSON.parse(read("metadata.json")) as {
      difficulty: number;
      status: string;
      exposedPorts: Array<{ port: number }>;
      runtime: { verifyUrl: string };
      courseAlignment: { week: number; role: string; sources?: Array<{ path: string }> };
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
    const hintPenalty = meta.scoring.checks
      .flatMap((check) => check.hints ?? [])
      .reduce((sum, hint) => sum + hint.penalty, 0);
    expect(hintPenalty).toBeLessThanOrEqual(150);
  });

  // The multi-verify cap is eight, mirrored in SCHEMA.json and in the platform's
  // problem-sdk. This problem's eight stages fit exactly, so unlike ac26-w5-pbs-homnand
  // nothing is graded as a pair — and a ninth stage would have to merge two, not raise a cap.
  it("should declare exactly the eight checkpoints the verifier serves", () => {
    expect(metadata().scoring.checks.map((check) => check.id)).toEqual([...CHECKPOINTS]);
    const verifier = read("local/verifier/server.py");
    for (const checkpoint of CHECKPOINTS) expect(verifier).toContain(`"${checkpoint}":`);
  });

  it("should point the platform at the port the compose file publishes", () => {
    const meta = metadata();
    expect(meta.exposedPorts.map((entry) => entry.port)).toEqual([18113]);
    expect(meta.runtime.verifyUrl).toBe("http://127.0.0.1:18113/verify");
    expect(read("local/docker-compose.yml")).toContain("127.0.0.1:18113:18113");
  });

  // Week 6's material is published upstream, unlike Weeks 2 and 4 — so the pins are a real
  // alignment (`lecture` / `assignment`), not a `placeholder` recording an absence.
  it("should pin week 6's published material rather than a placeholder", () => {
    const { courseAlignment } = metadata();
    expect(courseAlignment.week).toBe(6);
    expect(courseAlignment.role).toBe("mechanism");
    expect(courseAlignment.sources).toEqual([
      {
        repository: "zk-tokyo/advanced-cryptography-2026",
        ref: "a3aa4b56fa88fbe803b57d320fbc87c1a203b480",
        path: "week6/README.md",
        kind: "lecture",
      },
      {
        repository: "zk-tokyo/advanced-cryptography-2026",
        ref: "a3aa4b56fa88fbe803b57d320fbc87c1a203b480",
        path: "week6/problems/co-snark-prove/README.md",
        kind: "assignment",
      },
    ]);
  });

  it("should never let a value reach the event log or a violation record", () => {
    // The trace is the evidence checkpoints 5 and 6 are graded on, and it is only evidence
    // while it names operands instead of quoting them. `_emit` and `_violate` have no
    // parameter that could carry one today; this pins the field sets so a later "just log
    // the value on the error path" cannot pass review by being invisible.
    const script = [
      "import sys",
      "sys.path.insert(0, '.')",
      "from fixtures.generate import ParticipantRuntime, Runtime, relation, setting, witness",
      "sys.path.insert(0, 'reference')",
      "import prover",
      "cfg = setting('probe-seed')",
      "runtime = Runtime(cfg)",
      "shares = runtime.deal_witness('probe-seed', witness('probe-seed', 'p', cfg), label='pw')",
      "prover.prove_linear(ParticipantRuntime(runtime), dict(relation('probe-seed', 'p', cfg, 'signed')), shares)",
      "assert runtime.events, 'the probe produced no trace at all'",
      "allowed = {'op', 'party', 'operands', 'result', 'communication', 'messages', 'public'}",
      "for event in runtime.events:",
      "    assert set(event) <= allowed, sorted(set(event) - allowed)",
      "    assert 'public' not in event or event['op'] == 'mul-public'",
      "    assert all(isinstance(operand, str) for operand in event['operands'])",
      "for violation in runtime.violations:",
      "    assert set(violation) <= {'kind', 'party', 'share', 'owner'}",
      "print('ok')",
    ].join("\n");
    const result = python(["-c", script]);
    expect(result.stderr).toBe("");
    expect(result.stdout.trim()).toBe("ok");
  });

  it("should not hand the participant runtime a way to reconstruct", () => {
    // The whole no-reconstruction audit rests on the facade not forwarding it. A future
    // edit that adds the method for convenience makes checkpoint 5 unfalsifiable.
    const fixtures = read("local/fixtures/generate.py");
    const facade = fixtures.slice(fixtures.indexOf("class ParticipantRuntime"));
    expect(facade).not.toMatch(/def reconstruct/);
    expect(fixtures).toMatch(/class Runtime[\s\S]*?def reconstruct/);
  });
});
