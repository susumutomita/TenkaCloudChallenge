import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import { parse as parseYaml } from "yaml";

/**
 * ac26-w6-stack-design is Week 6's synthesis problem: a primitive can only check the shape of
 * what it was handed, so every component's own test passes and the architecture is broken
 * anyway. Nothing cryptographic runs. What is graded is the typed graph between the primitives —
 * what each wire carries, where the primitive's guarantee stops, which contract broke, which one
 * broke first, and what it costs to put back. The interesting assertions run its Python for real
 * rather than reading source text: the three architectures really are sound, the thirteen
 * deployments really are one change away, the eleven boundary classes really are all reachable,
 * the reference passes every checkpoint, the mutation suite kills every intended defect, and
 * /verify holds its contract.
 *
 * Seven are about this problem specifically rather than about the template:
 *
 *  - **the premise**. All three architectures are sound on every seed, and every deployment is
 *    exactly one change from one of them. If a "sound" architecture ever broke a contract, the
 *    headline would be "the model disagrees with itself" rather than "every part is correct".
 *  - **all eleven boundary classes are reachable**. The class list is the answer space of the
 *    `contracts` checkpoint, and a class no deployment can produce is a row of a table nobody
 *    ever grades.
 *  - **one deployment breaks no contract at all**. Every boundary holds and a primitive cannot
 *    run what it was handed. It is what makes `repair` ask for two conditions rather than one.
 *  - **first-in-flow is not first-by-id**. Three deployments disagree about it, which is what
 *    stops `diagnosis` from being a `min()` over a set of strings.
 *  - **the property no wire carries**. `availability` maps to the empty tuple in all three
 *    architectures, so an answer that finds something for every property is caught by that key.
 *  - **every branch of the selection rule is exercised**. Eight briefs, and the three that
 *    nobody writes — one holder "computing between themselves", an outside service that may see
 *    the answer, and a brief needing no primitive at all — are among them.
 *  - **which checkpoint catches which defect**, measured. Most defects are local to one
 *    checkpoint. Two are not, and the coupling is real rather than incidental.
 */

const ROOT = join(import.meta.dir, "..", "challenges", "ac26-w6-stack-design");
const LOCAL = join(ROOT, "local");
const SEED = "ci-fixed-seed";
const CHECKPOINTS = [
  "dataflow",
  "properties",
  "contracts",
  "diagnosis",
  "counterexample",
  "repair",
  "selection",
  "transfer",
] as const;
const PINNED = "a3aa4b56fa88fbe803b57d320fbc87c1a203b480";
/** Measured by `make reference-test`; both READMEs quote these two numbers. */
const BROKEN_STACKS = 53;
const WEAK_PROBE_BLIND = 47;

function read(relativePath: string): string {
  return readFileSync(join(ROOT, relativePath), "utf8");
}

function python(args: string[], cwd = LOCAL) {
  return spawnSync("python3", args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, FLAG_SEED: SEED, PYTHONDONTWRITEBYTECODE: "1" },
    timeout: 900_000,
  });
}

function bundle(dir: "starter" | "reference"): string {
  return read(`local/${dir}/stack.py`);
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

describe("ac26-w6-stack-design: participant contract", () => {
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
      "local/tests/public/test_stack.py",
      "local/tests/hidden/check_stack.py",
      "local/verifier/server.py",
      "local/starter/stack.py",
      "local/reference/stack.py",
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

describe("ac26-w6-stack-design: container safety", () => {
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

describe("ac26-w6-stack-design: fixtures are seed-derived", () => {
  it("should produce a different deployment for a different seed", () => {
    const script = [
      "import json, sys",
      "sys.path.insert(0, '.')",
      "from fixtures.generate import CASES, graph, health_token",
      "seed = sys.argv[1]",
      "print(json.dumps({",
      "    'g': [graph(seed, case)['edges'] for case in CASES],",
      "    'h': health_token(seed),",
      "}))",
    ].join("\n");
    const first = python(["-c", script, "seed-alpha"]).stdout.trim();
    const second = python(["-c", script, "seed-beta"]).stdout.trim();
    const again = python(["-c", script, "seed-alpha"]).stdout.trim();

    expect(first).not.toBe(second);
    expect(first).toBe(again);
  });

  it("should vary the field, the statement, the program and the briefs", () => {
    const script = [
      "import json, sys",
      "sys.path.insert(0, '.')",
      "from fixtures.generate import graph, use_cases",
      "fields = {graph('s%d' % i, 'mpc-prover')['edges'][0]['algebra'] for i in range(40)}",
      "statements = {graph('s%d' % i, 'mpc-prover')['edges'][-1]['identity'] for i in range(40)}",
      "programs = {graph('s%d' % i, 'zkvm-exploit')['edges'][0]['identity'] for i in range(40)}",
      "briefs = {tuple(u['id'] for u in use_cases('s%d' % i)) for i in range(40)}",
      "print(json.dumps({",
      "    'fields': len(fields), 'statements': len(statements),",
      "    'programs': len(programs), 'briefs': len(briefs),",
      "}))",
    ].join("\n");
    const drawn = JSON.parse(python(["-c", script]).stdout.trim()) as Record<string, number>;
    // Every field in the vocabulary gets drawn, and the identities and the briefs are one per
    // seed -- a statement or a brief that repeated would make a memorized answer carry.
    expect(drawn.fields).toBeGreaterThan(3);
    expect(drawn.statements).toBe(40);
    expect(drawn.programs).toBe(40);
    expect(drawn.briefs).toBe(40);
  });
});

describe("ac26-w6-stack-design: the premise holds", () => {
  it("should draw three architectures that are sound and whole on every seed", () => {
    // The baseline the whole problem is measured against. If a "sound" architecture ever broke
    // one of its own contracts, the headline would be "the model disagrees with itself" rather
    // than "every part is correct and the composition is not".
    const script = [
      "import sys",
      "sys.path.insert(0, '.')",
      "from fixtures.generate import CASES, graph, local_checks_pass, repair_cost, violations",
      "ok = draws = 0",
      "for i in range(20):",
      "    for case in CASES:",
      "        built = graph('sound%d' % i, case)",
      "        draws += 1",
      "        if not violations(built) and local_checks_pass(built) and repair_cost(built) == 0:",
      "            ok += 1",
      "print(ok, draws)",
    ].join("\n");
    expect(python(["-c", script]).stdout.trim()).toBe("60 60");
  }, 900_000);

  it("should keep every deployment exactly one change from whole", () => {
    // A repair has to have somewhere to be minimal against, and "the first boundary that broke"
    // has to have an answer. Two changes at once takes both away.
    const script = [
      "import sys",
      "sys.path.insert(0, '.')",
      "from fixtures.generate import VARIANTS, broken, changes, graph, repair_cost",
      "one = draws = 0",
      "for i in range(10):",
      "    for variant in VARIANTS:",
      "        hurt = broken('one%d' % i, variant)",
      "        draws += 1",
      "        made = changes(graph('one%d' % i, hurt['caseId']), hurt)",
      "        if len(made) == 1 and repair_cost(hurt) == 1:",
      "            one += 1",
      "print(one, draws)",
    ].join("\n");
    expect(python(["-c", script]).stdout.trim()).toBe("130 130");
  }, 900_000);

  it("should make all eleven boundary classes reachable", () => {
    // The class list is the answer space of the `contracts` checkpoint. A class no deployment
    // can produce is a row of a table nobody ever grades.
    const script = [
      "import json, sys",
      "sys.path.insert(0, '.')",
      "from fixtures.generate import BOUNDARY_CLASSES, VARIANTS, broken, violations",
      "seen = set()",
      "for variant in VARIANTS:",
      "    seen |= {boundary for _, boundary in violations(broken('classes', variant))}",
      "print(json.dumps({'seen': len(seen), 'missing': sorted(set(BOUNDARY_CLASSES) - seen)}))",
    ].join("\n");
    const { seen, missing } = JSON.parse(python(["-c", script]).stdout.trim()) as {
      seen: number;
      missing: string[];
    };
    expect(missing).toEqual([]);
    expect(seen).toBe(11);
  });

  it("should ship exactly one deployment that breaks no contract and still cannot run", () => {
    // Every boundary holds, no promise is unkept, and a primitive is holding a shape it has no
    // way to consume. It is the whole reason `repair` asks for two conditions rather than one.
    const script = [
      "import sys",
      "sys.path.insert(0, '.')",
      "from fixtures.generate import VARIANTS, broken, local_checks_pass, violations",
      "quiet = draws = 0",
      "for i in range(10):",
      "    found = [v for v in VARIANTS",
      "             if not violations(broken('quiet%d' % i, v))",
      "             and not local_checks_pass(broken('quiet%d' % i, v))]",
      "    draws += 1",
      "    quiet += 1 if len(found) == 1 else 0",
      "print(quiet, draws)",
    ].join("\n");
    expect(python(["-c", script]).stdout.trim()).toBe("10 10");
  }, 900_000);

  it("should make first-in-flow disagree with first-by-id on three deployments", () => {
    // Otherwise `diagnosis` is a `min()` over a set of strings and the checkpoint measures
    // nothing. A merge node is only released once everything it was waiting for has arrived,
    // which is what makes the two orders differ at all.
    const script = [
      "import sys",
      "sys.path.insert(0, '.')",
      "from fixtures.generate import VARIANTS, broken, first_broken, violations",
      "counts = set()",
      "for i in range(10):",
      "    differ = 0",
      "    for variant in VARIANTS:",
      "        hurt = broken('order%d' % i, variant)",
      "        edges = sorted({edge for edge, _ in violations(hurt)})",
      "        if edges and first_broken(hurt) != edges[0]:",
      "            differ += 1",
      "    counts.add(differ)",
      "print(sorted(counts))",
    ].join("\n");
    expect(python(["-c", script]).stdout.trim()).toBe("[3]");
  }, 900_000);

  it("should leave exactly one end-to-end property carried by no wire at all", () => {
    // An answer that finds something for every property is caught by that one key. It is a fact
    // about these architectures rather than a gap: losing it means putting the computation
    // somewhere else, and that is not a change to a value in flight.
    const script = [
      "import json, sys",
      "sys.path.insert(0, '.')",
      "from fixtures.generate import CASES, graph, load_bearing",
      "empty = set()",
      "for i in range(10):",
      "    for case in CASES:",
      "        carried = load_bearing(graph('carry%d' % i, case))",
      "        empty |= {frozenset(k for k, v in carried.items() if not v)}",
      "print(json.dumps(sorted(sorted(group) for group in empty)))",
    ].join("\n");
    expect(python(["-c", script]).stdout.trim()).toBe('[["availability"]]');
  }, 900_000);

  it("should leave every counterexample the checker asks for actually constructible", () => {
    // The `counterexample` checkpoint is graded by validating what came back rather than by
    // comparing it to a stored answer, which is the right way to grade a construction and also
    // the way that cannot notice an unsolvable request. A (case, property) pair with no
    // one-change counterexample would be a checkpoint nobody can clear and nothing would say so.
    const script = [
      "import sys",
      "sys.path.insert(0, '.')",
      "from fixtures.generate import COUNTEREXAMPLE_TARGETS, counterexample_exists, graph",
      "ok = draws = 0",
      "for i in range(6):",
      "    for case, prop in COUNTEREXAMPLE_TARGETS:",
      "        draws += 1",
      "        ok += 1 if counterexample_exists(graph('ce%d' % i, case), prop) else 0",
      "print(ok, draws)",
    ].join("\n");
    expect(python(["-c", script]).stdout.trim()).toBe("30 30");
  }, 900_000);

  it("should exercise every branch of the selection rule on every seed", () => {
    // Including the three nobody writes: a lone holder "computing between themselves", an
    // outside service that may see the answer, and a brief that needs no primitive at all.
    const script = [
      "import json, sys",
      "sys.path.insert(0, '.')",
      "from fixtures.generate import selection_truth, use_cases",
      "shapes = set()",
      "counts = set()",
      "for i in range(10):",
      "    briefs = use_cases('pick%d' % i)",
      "    counts.add(len(briefs))",
      "    shapes.add(frozenset(selection_truth(u)['primitives'] for u in briefs))",
      "print(json.dumps({",
      "    'counts': sorted(counts),",
      "    'shapes': sorted(sorted(list(s) for s in group) for group in shapes),",
      "}))",
    ].join("\n");
    const { counts, shapes } = JSON.parse(python(["-c", script]).stdout.trim()) as {
      counts: number[];
      shapes: string[][][];
    };
    expect(counts).toEqual([8]);
    expect(shapes).toEqual([
      [["fhe"], ["fhe", "zk"], ["mpc"], ["mpc", "zk"], ["none"], ["zk"]],
    ]);
  }, 900_000);
});

describe("ac26-w6-stack-design: the problem is solvable and actually fails", () => {
  it("should fail the public tests in the shipped starter state", () => {
    const result = python(["tests/public/test_stack.py"]);
    expect(result.status).not.toBe(0);
    expect(result.stdout).toContain("FAIL");
  });

  it("should kill every intended defect and still measure what the weak probe misses", () => {
    // One `mutation.py` run rather than two. The catalog's test step is the slowest thing in
    // this repo's CI and the mutation suite is the slowest thing in this file, so the two
    // assertions that need it share a run: `make reference-test` is a single command, and a
    // test that spends forty seconds re-deriving output it already has is spending the budget
    // a later problem will need.
    //
    // The count is quoted by both READMEs. A sound architecture coming back clean and a broken
    // one coming back dirty are the two questions anybody writing a test for an architecture
    // checker asks first, and they are the two the problem text states outright -- so most of
    // the broken stacks answer them correctly. If a later edit made the checkpoints cheaper the
    // number moves, and the claim has to move with it rather than quietly going stale.
    const result = python(["mutation.py"]);
    expect(result.stdout).toContain("PASS reference implementation passes the hidden tests");
    expect(result.stdout).not.toContain("SURVIVED");
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(
      `${WEAK_PROBE_BLIND} of ${BROKEN_STACKS} broken stacks still get the easy two right`,
    );
    for (const readme of ["README.md", "README.ja.md"]) {
      expect(read(readme)).toContain(String(WEAK_PROBE_BLIND));
      expect(read(readme)).toContain(String(BROKEN_STACKS));
    }
  }, 1_800_000);

  it("should show the architectures, the contracts and the promises in make inspect", () => {
    const result = python(["show.py"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("== the three architectures ==");
    expect(result.stdout).toContain("== the three levels of contract ==");
    expect(result.stdout).toContain("== a component's own check ==");
    expect(result.stdout).toContain("health token:");
  });

  it("should never let make inspect print a verdict", () => {
    // `inspect` is the one place a learner sees the objects before writing anything, and it has
    // to do it without answering a graded question: which contract a deployment breaks, where it
    // broke first, or which primitives a brief needs.
    const script = [
      "import json, os, sys",
      "sys.path.insert(0, '.')",
      "from fixtures.generate import break_truth, selection_truth, use_cases",
      "seed = os.environ['FLAG_SEED']",
      "print(json.dumps({",
      "    'breaks': {name: {'first': entry['firstBroken'],",
      "                      'classes': sorted({b for _, b in entry['violations']})}",
      "               for name, entry in break_truth(seed).items()},",
      "    'picks': {u['id']: list(selection_truth(u)['primitives']) for u in use_cases(seed)},",
      "}))",
    ].join("\n");
    const { breaks, picks } = JSON.parse(python(["-c", script]).stdout.trim()) as {
      breaks: Record<string, { first: string | null; classes: string[] }>;
      picks: Record<string, string[]>;
    };
    const printed = python(["show.py"]).stdout;

    // Every deployment id and every brief id is listed -- that is the point of those sections --
    // but never next to the verdict behind it.
    for (const [variant, entry] of Object.entries(breaks)) {
      expect(printed).toContain(variant);
      for (const boundary of entry.classes) {
        expect(printed).not.toMatch(new RegExp(`${variant}\\b.*${boundary}`));
      }
      if (entry.first) expect(printed).not.toMatch(new RegExp(`${variant}\\b.*${entry.first}`));
    }
    for (const [brief, chosen] of Object.entries(picks)) {
      expect(printed).toContain(brief);
      for (const name of chosen) {
        expect(printed).not.toMatch(new RegExp(`${brief}\\b[^\\n]*\\b${name}\\b`));
      }
    }
    // The property no wire carries is a graded answer too, and inspect points at the question
    // rather than at the answer.
    expect(printed).not.toMatch(/availability is not a property of any wire/i);
  }, 900_000);
});

describe("ac26-w6-stack-design: /verify contract", () => {
  it.each(CHECKPOINTS)(
    "should accept the reference submission on %s",
    (checkpoint) => {
      expect(evaluate(checkpoint, bundle("reference"))).toBe(true);
    },
    1_800_000,
  );

  it.each(CHECKPOINTS)(
    "should reject the starter submission on %s",
    (checkpoint) => {
      expect(evaluate(checkpoint, bundle("starter"))).toBe(false);
    },
    1_800_000,
  );

  it("should reject a submission that hangs, rather than hanging itself", () => {
    expect(evaluate("dataflow", "def carried(built):\n    while True:\n        pass\n")).toBe(
      false,
    );
  }, 1_800_000);

  it("should reject an unknown checkpoint id instead of crediting it", () => {
    expect(evaluate("finish-week6", bundle("reference"))).toBe(false);
  });

  it("should echo the checkpointId so the platform can fail closed", () => {
    expect(read("local/verifier/server.py")).toContain(
      '{"checkpointId": checkpoint_id, "correct": correct}',
    );
  });

  it("should run nine hidden phases behind the eight scored checkpoints", () => {
    // #244 asks for nine things and multi-verify caps a problem at eight. `dataflow` is the pair,
    // and the pairing has to stay a pairing rather than quietly become a dropped phase.
    const script = [
      "import json, sys",
      "sys.path.insert(0, '.')",
      "from verifier.server import CODE_CHECKPOINTS",
      "from tests.hidden.check_stack import PHASES",
      "served = [name for names in CODE_CHECKPOINTS.values() for name in names]",
      "print(json.dumps({",
      "    'served': sorted(served),",
      "    'declared': sorted(phase.__name__ for phase in PHASES),",
      "}))",
    ].join("\n");
    const { served, declared } = JSON.parse(python(["-c", script]).stdout.trim()) as {
      served: string[];
      declared: string[];
    };
    expect(declared).toHaveLength(9);
    expect(served).toEqual(declared);
  });
});

describe("ac26-w6-stack-design: what each checkpoint is worth", () => {
  /** Run one mutation of the reference through every hidden phase, and name the catchers. */
  function phasesCatching(mutationName: string): string[] {
    const script = [
      "import json, sys",
      "sys.path.insert(0, '.')",
      "from mutation import _load, _mutations, SEED",
      "from tests.hidden.check_stack import PHASES",
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
  it("should let only the properties checkpoint catch a map that drops the empty key", () => {
    expect(phasesCatching("a property no wire carries is a property nobody asked about")).toEqual([
      "check_properties",
      "check_transfer",
    ]);
  }, 1_800_000);

  it("should let only the diagnosis checkpoint catch an answer given in id order", () => {
    expect(phasesCatching("the first failure is the first one alphabetically")).toEqual([
      "check_first_failure",
      "check_transfer",
    ]);
  }, 1_800_000);

  it("should let only the counterexample checkpoint catch one that breaks a component", () => {
    expect(
      phasesCatching("a counterexample has to break a component to be a counterexample"),
    ).toEqual(["check_counterexample", "check_transfer"]);
  }, 1_800_000);

  it("should let only the repair checkpoint catch a policy edited to fit the deployment", () => {
    expect(phasesCatching("the node that opened the secret is authorised to have opened it")).toEqual(
      ["check_repair", "check_transfer"],
    );
  }, 1_800_000);

  it("should let only the selection checkpoint catch a design that names one primitive", () => {
    expect(phasesCatching("the first primitive that came to mind is the design")).toEqual([
      "check_selection",
      "check_transfer",
    ]);
  }, 1_800_000);

  it("should fail three checkpoints together when a component's own check is inverted", () => {
    // "Can this component consume what it was handed" is asked by three of the nine phases, so
    // inverting it is not a local defect and is not priced as one. The coupling is the design
    // rather than an accident: one function decides what a primitive is vouching for, a second
    // decides whether a counterexample really left every component content, and a third refuses
    // to call an architecture repaired while something cannot run.
    expect(
      phasesCatching("a component is content if anything it was handed is a shape it takes"),
    ).toEqual(["check_layers", "check_counterexample", "check_repair", "check_transfer"]);
  }, 1_800_000);

  it("should fail four checkpoints when the licence table is not consulted at all", () => {
    // What an edge is pinned to is asked by four of the eight phases, so relaxing it is not a
    // local defect and is not priced as one.
    expect(phasesCatching("a licensed change is a change the contract still pins")).toEqual([
      "check_flow",
      "check_layers",
      "check_properties",
      "check_contracts",
      "check_first_failure",
      "check_counterexample",
      "check_repair",
      "check_transfer",
    ]);
  }, 1_800_000);
});

describe("ac26-w6-stack-design: metadata contracts", () => {
  function metadata() {
    return JSON.parse(read("metadata.json")) as {
      difficulty: number;
      exposedPorts: Array<{ port: number }>;
      runtime: { verifyUrl: string };
      track: { order: number };
      courseAlignment: { week: number; role: string; sources?: Array<Record<string, string>> };
      scoring: {
        kind: string;
        checks: Array<{
          id: string;
          points: number;
          wrongAnswerPenalty: number;
          hints?: Array<{ id: string; penalty: number }>;
        }>;
      };
    };
  }

  it("should total the Hard tier's 300 points across its checkpoints", () => {
    const meta = metadata();
    expect(meta.scoring.kind).toBe("multi-verify");
    expect(meta.difficulty).toBe(5);
    expect(meta.scoring.checks).toHaveLength(CHECKPOINTS.length);
    expect(meta.scoring.checks.reduce((sum, check) => sum + check.points, 0)).toBe(300);
    for (const check of meta.scoring.checks) {
      const penalty = (check.hints ?? []).reduce((sum, hint) => sum + hint.penalty, 0);
      expect(penalty).toBeLessThanOrEqual(check.points / 2);
    }
    // Opening every hint still has to leave more than half the problem standing, or the hints
    // are a second scoring scheme rather than a cost.
    const total = meta.scoring.checks
      .flatMap((check) => check.hints ?? [])
      .reduce((sum, hint) => sum + hint.penalty, 0);
    expect(total).toBeLessThanOrEqual(150);
    const ids = meta.scoring.checks.flatMap((check) => (check.hints ?? []).map((hint) => hint.id));
    expect(new Set(ids).size).toBe(ids.length);
    for (const check of meta.scoring.checks) expect(check.wrongAnswerPenalty).toBe(15);
  });

  // The multi-verify cap is eight, mirrored in SCHEMA.json and in the platform's problem-sdk,
  // which drops the whole scoring object rather than truncating it. #244 asks for nine
  // checkpoints, so two of them share one -- a ninth check would take the other eight down with
  // it, not raise the cap on one side.
  it("should declare exactly the eight checkpoints the verifier serves", () => {
    expect(metadata().scoring.checks.map((check) => check.id)).toEqual([...CHECKPOINTS]);
    const script = [
      "import json, sys",
      "sys.path.insert(0, '.')",
      "from verifier.server import CODE_CHECKPOINTS",
      "print(json.dumps(sorted(CODE_CHECKPOINTS)))",
    ].join("\n");
    const served = JSON.parse(python(["-c", script]).stdout.trim()) as string[];
    expect(served).toEqual([...CHECKPOINTS].sort());
  });

  it("should point the platform at the port the compose file publishes", () => {
    const meta = metadata();
    expect(meta.exposedPorts.map((entry) => entry.port)).toEqual([18118]);
    expect(meta.runtime.verifyUrl).toBe("http://127.0.0.1:18118/verify");
    expect(read("local/docker-compose.yml")).toContain("127.0.0.1:18118:18118");
  });

  it("should close the week after both of its prerequisites", () => {
    expect(metadata().track.order).toBe(660);
    expect(read("metadata.json")).toContain('"target": "problem.ac26-w6-zkvm-witness-binding"');
    expect(read("metadata.json")).toContain('"target": "problem.ac26-w6-cosnark-privacy"');
  });

  it("should pin week 6's published material as the track's synthesis", () => {
    const { courseAlignment } = metadata();
    expect(courseAlignment.week).toBe(6);
    expect(courseAlignment.role).toBe("synthesis");
    expect(courseAlignment.sources).toEqual([
      {
        repository: "zk-tokyo/advanced-cryptography-2026",
        ref: PINNED,
        path: "week6/README.md",
        kind: "lecture",
      },
    ]);
  });

  it("should declare the concept the curriculum says this problem teaches", () => {
    // curriculum.md's Week 6 table names `concept.stack-composition` for order 660, and no other
    // problem declares it. A `covers` edge to a node nobody declared is a dangling cross-ref.
    expect(read("metadata.json")).toContain('"id": "concept.stack-composition"');
    const curriculum = readFileSync(
      join(import.meta.dir, "..", "docs/curricula/advanced-cryptography-2026/curriculum.md"),
      "utf8",
    );
    expect(curriculum).toContain("| 660 | `ac26-w6-stack-design` | `synthesis` |");
    expect(curriculum).toContain("`concept.stack-composition`");
  });

  it("should carry a counterexample checkpoint, as a synthesis problem should", () => {
    // ASSESSMENT.md requires one only of `assignment-companion`. A synthesis problem that
    // graded no construction would be a quiz about a model rather than a use of one.
    expect(metadata().scoring.checks.map((check) => check.id)).toContain("counterexample");
  });

  it("should keep the participant-facing text free of the answers", () => {
    // The fairness contract (#1124): `description` and `writeup` are operator-facing and may
    // spoil; `instructions` is what a competitor reads and may not. What this problem grades is
    // which boundary class each deployment broke, so `instructions` names none of them.
    const meta = JSON.parse(read("metadata.json")) as {
      instructions: string;
      i18n: { en: { instructions: string } };
    };
    const script = [
      "import json, sys",
      "sys.path.insert(0, '.')",
      "from fixtures.generate import BOUNDARY_CLASSES",
      "print(json.dumps(list(BOUNDARY_CLASSES)))",
    ].join("\n");
    const classes = JSON.parse(python(["-c", script]).stdout.trim()) as string[];
    expect(classes).toHaveLength(11);
    for (const text of [meta.instructions, meta.i18n.en.instructions]) {
      for (const boundary of classes) {
        expect(text).not.toContain(boundary);
      }
    }
  });
});
