import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import { parse as parseYaml } from "yaml";

/**
 * ac26-w6-cosnark-privacy is Week 6's third problem: the two before it built a co-SNARK
 * prover, and this one asks what a prover built on top of it is allowed to say out loud. The
 * interesting assertions run its Python for real — the specimens really do agree on the
 * answer, the reference passes every checkpoint, the mutation suite kills every intended
 * defect, and /verify holds its security contract — rather than reading source text.
 *
 * Four are about this problem specifically rather than about the template:
 *
 *  - **the premise**. All eight specimens reconstruct `C` to `A * B` at every seed and every
 *    shape. If that ever stopped being true the problem would be solvable by running them,
 *    and both READMEs would be lying, so it is measured here rather than asserted in prose.
 *  - **the record carries no values**. `reached()` names capabilities and operand ids. It is
 *    the evidence three checkpoints are graded on, and it is only evidence while it names
 *    operands instead of quoting them.
 *  - **the runtime does hand out `reconstruct`**. The previous problem's facade withheld it;
 *    this one deliberately does not, because a defect that cannot be written cannot be
 *    audited. A future edit that "restores" the previous problem's default would silently
 *    make three specimens unwritable.
 *  - **one predicate, two checkpoints**. Breaking `_authorized` down to either half alone
 *    fails `classify` and `open-set` together, which is the claim that those two checkpoints
 *    ask the same question.
 */

const ROOT = join(import.meta.dir, "..", "challenges", "ac26-w6-cosnark-privacy");
const LOCAL = join(ROOT, "local");
const SEED = "ci-fixed-seed";
const CHECKPOINTS = [
  "classify",
  "capability",
  "open-set",
  "cross-party",
  "leakage",
  "evidence",
  "repair",
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
    timeout: 300_000,
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

describe("ac26-w6-cosnark-privacy: participant contract", () => {
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
      "local/fixtures/lab.py",
      "local/fixtures/specimens.py",
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

describe("ac26-w6-cosnark-privacy: container safety", () => {
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

describe("ac26-w6-cosnark-privacy: fixtures are seed-derived", () => {
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

  it("should draw a value catalog that reaches every class and shuffles with the seed", () => {
    // A catalog that stopped covering a class would make `classify` pass by being smaller,
    // and one whose order is fixed would let a positional answer carry between seeds.
    const script = [
      "import sys",
      "sys.path.insert(0, '.')",
      "sys.path.insert(0, 'reference')",
      "from fixtures.generate import CLASSES, relation, setting, value_catalog",
      "import prover",
      "orders = set()",
      "covered = set()",
      "for i in range(20):",
      "    seed = 's%d' % i",
      "    cfg = setting(seed, 'c')",
      "    row = dict(relation(seed, 'c', cfg, 'dense'))",
      "    catalog = value_catalog(seed, 'c', row)",
      "    classes = tuple(prover.classify(dict(e), dict(row)) for e in catalog)",
      "    orders.add(classes)",
      "    covered.update(classes)",
      "print(len(orders), len(covered), len(CLASSES))",
    ].join("\n");
    const [orders, covered, total] = python(["-c", script]).stdout.trim().split(" ").map(Number);
    expect(covered).toBe(total);
    expect(orders).toBeGreaterThan(5);
  });
});

describe("ac26-w6-cosnark-privacy: the premise holds", () => {
  it("should have all eight specimens reconstruct C to A * B on every shape", () => {
    // The whole problem rests on a correctness test being unable to separate them. If a
    // specimen ever stopped agreeing, the problem would be solvable by running them and both
    // READMEs would be quoting a claim that is no longer true.
    const script = [
      "import sys",
      "sys.path.insert(0, '.')",
      "from fixtures.generate import SHAPES",
      "from fixtures.lab import Scenario, run_on",
      "from fixtures.specimens import SPECIMEN_IDS",
      "agree = total = 0",
      "for i in range(3):",
      "    for shape in SHAPES:",
      "        for name in SPECIMEN_IDS:",
      "            scenario = Scenario('s%d' % i, 'p', shape)",
      "            evidence = run_on(scenario, name)",
      "            a = scenario.runtime.reconstruct(scenario.halves['A'])",
      "            b = scenario.runtime.reconstruct(scenario.halves['B'])",
      "            expected = (a * b) % scenario.cfg['p']",
      "            shipped = evidence.disclosure.artifact['C']",
      "            actual = (",
      "                scenario.runtime.reconstruct(shipped)",
      "                if isinstance(shipped, tuple)",
      "                else shipped % scenario.cfg['p']",
      "            )",
      "            total += 1",
      "            agree += 1 if actual == expected else 0",
      "print(agree, total)",
    ].join("\n");
    expect(python(["-c", script]).stdout.trim()).toBe("96 96");
  });

  it("should let a specimen reach a capability through a name grep cannot find", () => {
    // `grep("reconstruct")` is the audit this problem exists to be better than, so at least
    // one specimen must reach a capability without the literal appearing in its code. The
    // source is round-tripped through the AST first: comments are not in the AST, and one of
    // the specimens has a comment saying what it is doing, which a raw text scan would read
    // as the call it is describing.
    const script = [
      "import ast, inspect, sys",
      "sys.path.insert(0, '.')",
      "from fixtures.lab import Scenario, run_on",
      "from fixtures.specimens import SPECIMEN_IDS, specimen",
      "hidden = 0",
      "for name in SPECIMEN_IDS:",
      "    code = ast.unparse(ast.parse(inspect.getsource(specimen(name))))",
      "    evidence = run_on(Scenario('probe', 'p', 'dense'), name)",
      "    reached = {record['capability'] for record in evidence.runtime.reached()}",
      "    for capability in ('reconstruct', 'peek'):",
      "        if capability in reached and capability not in code:",
      "            hidden += 1",
      "print(hidden)",
    ].join("\n");
    expect(Number(python(["-c", script]).stdout.trim())).toBeGreaterThan(0);
  });
});

describe("ac26-w6-cosnark-privacy: the problem is solvable and actually fails", () => {
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
  }, 300_000);

  it("should still measure that most broken audits get every verdict right", () => {
    // Both READMEs quote this count. Noticing that a prover is not clean is the easy half;
    // if a change ever made the checkpoints cheaper the number moves, and the claim has to
    // move with it rather than quietly going stale.
    const result = python(["mutation.py"]);
    expect(result.stdout).toContain(
      "29 of 35 broken audits still give every specimen the right verdict",
    );
    for (const readme of ["README.md", "README.ja.md"]) {
      expect(read(readme)).toContain("29");
      expect(read(readme)).toContain("35");
    }
  }, 300_000);

  it("should show a clean run's record in make inspect without running a specimen", () => {
    // `inspect` is the one place a learner sees the shape of the evidence before writing
    // anything, and it must do it without saying which of the eight are honest.
    const result = python(["show.py"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("'capability': 'open'");
    expect(result.stdout).toContain("'maskedBy'");
    expect(result.stdout).not.toMatch(/^== S\d, run once/m);
  });

  it("should dump one specimen's record only when make inspect is asked for one", () => {
    const result = spawnSync("python3", ["show.py"], {
      cwd: LOCAL,
      encoding: "utf8",
      env: { ...process.env, FLAG_SEED: SEED, P: "S3", PYTHONDONTWRITEBYTECODE: "1" },
      timeout: 120_000,
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("== S3, run once on an honest row ==");
  });
});

describe("ac26-w6-cosnark-privacy: /verify contract", () => {
  it.each(CHECKPOINTS)(
    "should accept the reference submission on %s",
    (checkpoint) => {
      expect(evaluate(checkpoint, bundle("reference"))).toBe(true);
    },
    300_000,
  );

  it.each(CHECKPOINTS)(
    "should reject the starter submission on %s",
    (checkpoint) => {
      expect(evaluate(checkpoint, bundle("starter"))).toBe(false);
    },
    300_000,
  );

  it("should reject a submission that hangs, rather than hanging itself", () => {
    expect(
      evaluate("classify", "def classify(entry, row):\n    while True:\n        pass\n"),
    ).toBe(false);
  }, 300_000);

  it("should reject an unknown checkpoint id instead of crediting it", () => {
    expect(evaluate("finish-week6", bundle("reference"))).toBe(false);
  });

  it("should echo the checkpointId so the platform can fail closed", () => {
    expect(read("local/verifier/server.py")).toContain(
      '{"checkpointId": checkpoint_id, "correct": correct}',
    );
  });
});

describe("ac26-w6-cosnark-privacy: what each checkpoint is worth", () => {
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

  // `check_transfer` re-runs every other phase under a derived seed, so it is expected to
  // appear alongside whichever phase actually did the catching.
  it("should let only the capability checkpoint catch an audit that runs a specimen once", () => {
    expect(phasesCatching("the capability audit only ever runs the specimen once")).toEqual([
      "check_capability",
      "check_transfer",
    ]);
  }, 300_000);

  it("should let only the leakage checkpoint catch an audit that reads the artifact alone", () => {
    // The channel a correctness test reads. Three specimens use only the other three.
    expect(phasesCatching("the leakage audit reads the proof artifact and nothing else")).toEqual([
      "check_leakage",
      "check_transfer",
    ]);
  }, 300_000);

  it("should let only the cross-party checkpoint catch an audit that never finds a crossing", () => {
    // One specimen discloses nothing at all and fails here alone.
    expect(phasesCatching("the cross-party audit never finds a crossing")).toEqual([
      "check_crossparty",
      "check_transfer",
    ]);
  }, 300_000);

  it("should let only the evidence checkpoint catch a value taken at face value", () => {
    // The indirect one: `x` published next to the `d` it was masking is `A`.
    expect(
      phasesCatching("the evidence takes a disclosed value at face value next to its mask"),
    ).toEqual(["check_evidence", "check_transfer"]);
  }, 300_000);

  it("should let only the repair checkpoint catch a prover that ships C in the clear", () => {
    expect(phasesCatching("the repaired prover ships C as a reconstructed value")).toEqual([
      "check_repair",
      "check_transfer",
    ]);
  }, 300_000);

  it("should fail two checkpoints at once when the shared authorization rule is halved", () => {
    // `classify` and `open-set` ask the same question of two different records, so the
    // predicate is shared on purpose and breaking it has to show up in both.
    expect(phasesCatching("classify authorizes an opening on its mask alone")).toEqual([
      "check_classify",
      "check_openset",
      "check_transfer",
    ]);
  }, 300_000);
});

describe("ac26-w6-cosnark-privacy: metadata contracts", () => {
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
    expect(meta.difficulty).toBe(5);
    expect(meta.scoring.checks.reduce((sum, check) => sum + check.points, 0)).toBe(300);
    const hintPenalty = meta.scoring.checks
      .flatMap((check) => check.hints ?? [])
      .reduce((sum, hint) => sum + hint.penalty, 0);
    expect(hintPenalty).toBeLessThanOrEqual(150);
  });

  // The multi-verify cap is eight, mirrored in SCHEMA.json and in the platform's
  // problem-sdk, which drops the whole scoring object rather than truncating it. Issue #241
  // asks for eight checkpoints, which fits exactly — a ninth would have to merge two, not
  // raise a cap on one side.
  it("should declare exactly the eight checkpoints the verifier serves", () => {
    expect(metadata().scoring.checks.map((check) => check.id)).toEqual([...CHECKPOINTS]);
    const verifier = read("local/verifier/server.py");
    for (const checkpoint of CHECKPOINTS) expect(verifier).toContain(`"${checkpoint}":`);
  });

  it("should point the platform at the port the compose file publishes", () => {
    const meta = metadata();
    expect(meta.exposedPorts.map((entry) => entry.port)).toEqual([18115]);
    expect(meta.runtime.verifyUrl).toBe("http://127.0.0.1:18115/verify");
    expect(read("local/docker-compose.yml")).toContain("127.0.0.1:18115:18115");
  });

  it("should pin week 6's published material as a transfer problem", () => {
    const { courseAlignment } = metadata();
    expect(courseAlignment.week).toBe(6);
    expect(courseAlignment.role).toBe("transfer");
    expect(courseAlignment.sources).toEqual([
      {
        repository: "zk-tokyo/advanced-cryptography-2026",
        ref: "5e80999306608a45aecf9a0e4e3394a0b62f34d2",
        path: "week6/README.md",
        kind: "lecture",
      },
      {
        repository: "zk-tokyo/advanced-cryptography-2026",
        ref: "5e80999306608a45aecf9a0e4e3394a0b62f34d2",
        path: "week6/problems/co-snark-prove/README.md",
        kind: "assignment",
      },
    ]);
  });

  it("should never let a share's value reach the capability record or an opening record", () => {
    // `reached()` is the evidence three checkpoints are graded on, and it is only evidence
    // while it names operands instead of quoting them. This pins the field sets so a later
    // "just record the value so the audit is easier" cannot pass review by being invisible.
    const script = [
      "import sys",
      "sys.path.insert(0, '.')",
      "from fixtures.lab import Scenario, run_on",
      "from fixtures.specimens import SPECIMEN_IDS",
      "for name in SPECIMEN_IDS:",
      "    scenario = Scenario('probe-seed', 'p', 'signed')",
      "    evidence = run_on(scenario, name)",
      "    assert evidence.runtime.reached(), 'the probe reached nothing at all'",
      "    for record in evidence.runtime.reached():",
      "        assert set(record) <= {'capability', 'party', 'operands', 'round_id'}",
      "        assert all(isinstance(operand, str) for operand in record['operands'])",
      "    for record in evidence.runtime.openings():",
      "        assert set(record) == {'roundId', 'shareIds', 'maskedBy'}",
      "        assert all(isinstance(item, str) for item in record['shareIds'])",
      "        assert all(isinstance(item, str) for item in record['maskedBy'])",
      "print('ok')",
    ].join("\n");
    const result = python(["-c", script]);
    expect(result.stderr).toBe("");
    expect(result.stdout.trim()).toBe("ok");
  });

  it("should hand the audited runtime a way to reconstruct, unlike the previous problem", () => {
    // The reversal is the design. `ac26-w6-cosnark-beaver` withheld `reconstruct` so a
    // shortcut was unwritable; here the whole class of defect has to be writable or it
    // cannot be audited. An edit that "restored" the previous default would silently make
    // three specimens impossible to write and the checkpoints impossible to fail.
    const fixtures = read("local/fixtures/generate.py");
    const facade = fixtures.slice(fixtures.indexOf("class AuditRuntime"));
    expect(facade).toMatch(/def reconstruct/);
    expect(facade).toMatch(/def peek/);
    expect(facade).toContain('_reach("reconstruct"');
  });

  it("should serialize a disclosure down to share ids, so evidence has to be derived", () => {
    // The `evidence` checkpoint is handed this view. If a sharing survived as live objects,
    // `Share._value` would answer the question instead of the derivation.
    const script = [
      "import sys",
      "sys.path.insert(0, '.')",
      "from fixtures.lab import Scenario, run_on, serialized",
      "scenario = Scenario('probe-seed', 'p', 'dense')",
      "view = serialized(run_on(scenario, 'S1').disclosure)",
      "assert all(isinstance(item, str) for item in view.artifact['A'])",
      "assert all(isinstance(item, str) for item in view.artifact['C'])",
      "print('ok')",
    ].join("\n");
    expect(python(["-c", script]).stdout.trim()).toBe("ok");
  });
});
