import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import { parse as parseYaml } from "yaml";

/**
 * ac26-w4-proof-pipeline is a diagnosis problem: two toy pipelines, one contract per
 * layer, and runs where exactly one contract is broken. Two properties carry the whole
 * design and both are asserted here rather than left to review.
 *
 * The first is that the two pipelines are genuinely different shapes. Every hidden check
 * runs against both, so anything a submission hardcodes from A has to be wrong for B —
 * which is only true if the definitions really do differ in stage names, layer list, and
 * query minimum.
 *
 * The second is that each fault damages exactly one field. That is what makes the
 * `diagnose` checkpoint's minimality rule well-defined: a repair may differ from the
 * faulted run in that field and no other, which rules out both "rebuild a clean run" and
 * "reject everything".
 *
 * Python 3 is on ubuntu-latest and the problem is stdlib-only.
 */

const ROOT = join(import.meta.dir, "..", "challenges", "ac26-w4-proof-pipeline");
const LOCAL = join(ROOT, "local");
const SEED = "ci-fixed-seed";
const CHECKPOINTS = [
  "graph",
  "wiring",
  "constraints",
  "transcript",
  "opening",
  "assumptions",
  "cost",
  "diagnose",
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
  return read(`local/${dir}/pipeline.py`);
}

/** Last stdout line of a stdlib-only snippet run inside local/. */
function probe(lines: string[]): string {
  const result = python(["-c", ["import sys", "sys.path.insert(0, '.')", ...lines].join("\n")]);
  expect(result.stderr).toBe("");
  expect(result.status).toBe(0);
  return result.stdout.trim().split("\n").at(-1) ?? "";
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

describe("ac26-w4-proof-pipeline: participant contract", () => {
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
      "local/tests/public/test_pipeline.py",
      "local/tests/hidden/check_pipeline.py",
      "local/verifier/server.py",
      "local/starter/pipeline.py",
      "local/reference/pipeline.py",
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

describe("ac26-w4-proof-pipeline: container safety", () => {
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

describe("ac26-w4-proof-pipeline: the two pipelines are genuinely different shapes", () => {
  // If they were the same shape, every hidden check would be running the same test
  // twice, and a submission that hardcoded A would score full marks.
  it("should differ in stage names, layer list and query minimum", () => {
    const answer = probe([
      "import json",
      "from fixtures.generate import pipeline",
      "a, b = pipeline('A'), pipeline('B')",
      "names = lambda d: [s['name'] for s in d['stages']]",
      "layers = lambda d: [s['layer'] for s in d['stages']]",
      "print(json.dumps({",
      "  'shared_names': sorted(set(names(a)) & set(names(b))),",
      "  'only_b_layers': sorted(set(layers(b)) - set(layers(a))),",
      "  'minimums': [a['min_queries'], b['min_queries']],",
      "  'stage_counts': [len(a['stages']), len(b['stages'])],",
      "}))",
    ]);
    const shape = JSON.parse(answer) as {
      shared_names: string[];
      only_b_layers: string[];
      minimums: number[];
      stage_counts: number[];
    };
    expect(shape.only_b_layers).toEqual(["low-degree"]);
    expect(shape.minimums[0]).not.toBe(shape.minimums[1]);
    expect(shape.stage_counts[0]).not.toBe(shape.stage_counts[1]);
    // "commit", "challenge", "statement" and "verify" are shared vocabulary; everything
    // that names the pipeline's own subject matter is not.
    expect(shape.shared_names).not.toContain("open");
    expect(shape.shared_names).not.toContain("trace");
  });

  // B's extra layer sits in the middle, not at the end. A hardcoded A-shaped order that
  // simply appended it would still get every ordering question right.
  it("should place B's low-degree layer between opening and verifier", () => {
    const answer = probe([
      "from fixtures.generate import pipeline",
      "layers = [s['layer'] for s in pipeline('B')['stages']]",
      "i = layers.index('low-degree')",
      "print(layers[i - 1], layers[i + 1])",
    ]);
    expect(answer).toBe("opening verifier");
  });
});

describe("ac26-w4-proof-pipeline: each fault damages exactly one field", () => {
  // The `diagnose` checkpoint grades a repair by "one field differs, and it is the one
  // a repair is allowed to touch". That rule is only meaningful if the faults
  // themselves are single-field, so it is asserted rather than assumed.
  it("should change only its declared field, on every applicable pipeline", () => {
    const answer = probe([
      "import json",
      "from fixtures.generate import FAULTS, applicable_faults, faulted_run, honest_run",
      "bad = []",
      "for name in ('A', 'B'):",
      "    for fault in applicable_faults(name):",
      "        run = faulted_run('s', name, fault)",
      "        base = honest_run('s', name, 'public:' + fault)",
      "        changed = sorted(k for k in base if base[k] != run[k])",
      "        if changed != [FAULTS[fault]['damages']]:",
      "            bad.append([name, fault, changed])",
      "print(json.dumps(bad))",
    ]);
    expect(JSON.parse(answer)).toEqual([]);
  });

  // Eight of the nine repair the field they damaged. The ninth is the one that matters:
  // an unsatisfied constraint cannot be made satisfied by editing the record, so the
  // damage is in `constraints` and the only honest repair is to reject.
  it("should repair somewhere other than the damage for exactly one fault", () => {
    const answer = probe([
      "import json",
      "from fixtures.generate import FAULTS",
      "print(json.dumps({",
      "  f: [s['damages'], s['repair_field']]",
      "  for f, s in FAULTS.items() if s['damages'] != s['repair_field']",
      "}))",
    ]);
    expect(JSON.parse(answer)).toEqual({
      "accepts-unsatisfied-constraint": ["constraints", "verdict"],
    });
  });

  it("should leave every faulted run accepting", () => {
    // A run that rejected would be doing its job, and diagnosing it would teach
    // nothing. Every fault here produces a run that sailed through to "accept".
    const answer = probe([
      "import json",
      "from fixtures.generate import applicable_faults, faulted_run",
      "print(json.dumps(sorted({",
      "  faulted_run('s', n, f)['verdict']",
      "  for n in ('A', 'B') for f in applicable_faults(n)",
      "})))",
    ]);
    expect(JSON.parse(answer)).toEqual(["accept"]);
  });

  // The trap the `constraints` checkpoint exists for: the commitment succeeds in every
  // single run, including the one that accepted an unsatisfied constraint.
  it("should report a successful commitment in every run, honest or broken", () => {
    const answer = probe([
      "from fixtures.generate import applicable_faults, faulted_run, honest_run",
      "runs = [honest_run('s', n) for n in ('A', 'B')]",
      "runs += [faulted_run('s', n, f) for n in ('A', 'B') for f in applicable_faults(n)]",
      "print(all(r['commitment_ok'] for r in runs))",
    ]);
    expect(answer).toBe("True");
  });

  it("should confine low-degree-bypassed to the pipeline that has that stage", () => {
    const answer = probe([
      "from fixtures.generate import applicable_faults",
      "print('low-degree-bypassed' in applicable_faults('A'),",
      "      'low-degree-bypassed' in applicable_faults('B'))",
    ]);
    expect(answer).toBe("False True");
  });
});

describe("ac26-w4-proof-pipeline: the claims are ground truth, not opinion", () => {
  // Rejecting everything must not score the same as reading the profiles, so both
  // halves of the split have to be non-empty.
  it("should leave supported and unsupported claims both non-empty", () => {
    const answer = probe([
      "from fixtures.generate import CLAIMS, UNSUPPORTED_CLAIMS",
      "print(len(UNSUPPORTED_CLAIMS), len(CLAIMS) - len(UNSUPPORTED_CLAIMS))",
    ]);
    expect(answer).toBe("4 4");
  });

  it("should keep both setups resting on a non-empty assumption list", () => {
    // The `transparent` pipeline still needs a collision-resistant hash and a random
    // oracle. If its list were empty, "transparent means assumption-free" would be true
    // in this catalog and the misconception would be untestable.
    const answer = probe([
      "from fixtures.generate import PIPELINES",
      "print(all(p['setup']['assumptions'] for p in PIPELINES.values()),",
      "      sorted({p['setup']['kind'] for p in PIPELINES.values()}))",
    ]);
    expect(answer).toBe("True ['transparent', 'trusted']");
  });
});

describe("ac26-w4-proof-pipeline: the problem is solvable and actually fails", () => {
  it("should fail the public tests in the shipped starter state", () => {
    const result = python(["tests/public/test_pipeline.py"]);
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

describe("ac26-w4-proof-pipeline: /verify contract", () => {
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

  // Each of the following passes the public tests and every honest run. They are the
  // readings a participant is most likely to arrive at, not typos.
  it("should reject a contract that reads commitment_ok instead of the constraints", () => {
    const source = bundle("reference").replace(
      '    if unsatisfied and run["verdict"] == "accept":',
      '    if unsatisfied and not run["commitment_ok"]:',
    );
    expect(evaluate("constraints", source)).toBe(false);
  }, 120_000);

  it("should reject a leak check that trusts the run's own list of secrets", () => {
    const source = bundle("reference").replace(
      "    leaked = sorted(public & _prover_only(definition))",
      "    leaked = sorted(public & secret)",
    );
    expect(evaluate("wiring", source)).toBe(false);
  }, 120_000);

  it("should reject an opening check that matches counts rather than names", () => {
    const source = bundle("reference").replace(
      '    missing = sorted(set(run["openings_required"]) - set(run["openings_checked"]))\n    if missing:',
      '    missing = sorted(set(run["openings_required"]) - set(run["openings_checked"]))\n    if len(run["openings_checked"]) < len(run["openings_required"]):',
    );
    expect(evaluate("opening", source)).toBe(false);
  }, 120_000);

  it("should reject a matrix that equates transparency with assuming nothing", () => {
    const source = bundle("reference").replace(
      '            "transparent": definition["setup"]["kind"] == "transparent",',
      '            "transparent": not definition["setup"]["assumptions"],',
    );
    expect(evaluate("assumptions", source)).toBe(false);
  }, 120_000);

  it("should reject a diagnosis that reports the last broken layer", () => {
    const source = bundle("reference").replace(
      "        if contract(definition, run):\n            return layer\n    return None",
      [
        "    broken = [",
        "        layer",
        "        for layer in layer_order(definition)",
        "        if CONTRACTS.get(layer) and CONTRACTS[layer](definition, run)",
        "    ]",
        "    return broken[-1] if broken else None",
      ].join("\n"),
    );
    expect(evaluate("diagnose", source)).toBe(false);
  }, 120_000);

  it("should reject a repair that rebuilds a clean run instead of fixing one field", () => {
    const source = bundle("reference").replace(
      '    fixed = dict(run)\n    if layer == "input-boundary":',
      [
        "    fixed = dict(run)",
        '    fixed["public"] = sorted(_stage_with_layer(definition, "verifier")["consumes"])',
        '    fixed["setup_material"] = sorted(_setup_artifacts(definition))',
        '    fixed["verdict"] = "reject"',
        "    return fixed",
        '    if layer == "input-boundary":',
      ].join("\n"),
    );
    expect(evaluate("diagnose", source)).toBe(false);
  }, 120_000);

  it("should reject a submission that hangs, rather than hanging itself", () => {
    expect(
      evaluate("graph", "def artifact_graph(definition):\n    while True:\n        pass\n"),
    ).toBe(false);
  }, 60_000);

  it("should reject a submission that cannot even be imported", () => {
    expect(evaluate("graph", "def artifact_graph(:\n")).toBe(false);
  }, 60_000);

  it("should reject an unknown checkpoint id instead of crediting it", () => {
    expect(evaluate("first-fault", bundle("reference"))).toBe(false);
  });

  it("should echo the checkpointId so the platform can fail closed", () => {
    expect(read("local/verifier/server.py")).toContain(
      '{"checkpointId": checkpoint_id, "correct": correct}',
    );
  });
});

/**
 * Issue 537/538, Issue 543 option B2. Until this split the problem had one Docker stage,
 * and it carried `tests/hidden/check_pipeline.py` — whose `_reference_first_fault` is a
 * complete and correct implementation of every layer contract the starter asks a learner
 * to write — beside `fixtures/generate.py`, which carries `UNSUPPORTED_CLAIMS` (the
 * `cost` checkpoint's ground truth) and `FAULTS` (the layer `first_fault` must report,
 * and the single field `repair` may touch, for every injected fault). A submission
 * transcribed from those two files, with no reasoning past copying, scored 7 of 8
 * checkpoints.
 *
 * These assertions fail the moment either file goes back into the participant stage, or
 * the public payload starts carrying the half that decides a checkpoint.
 */
describe("ac26-w4-proof-pipeline: the answer is not in the participant image", () => {
  function participantStage(): string {
    const dockerfile = read("local/Dockerfile");
    const start = dockerfile.indexOf("FROM base AS participant");
    const end = dockerfile.indexOf("FROM base AS verifier");
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    return dockerfile.slice(start, end);
  }

  it("should copy neither fixtures/, tests/hidden/ nor verifier/ into the participant stage", () => {
    const stage = participantStage();
    expect(stage).toContain("COPY tests/public/");
    for (const forbidden of ["COPY fixtures/", "COPY tests/ ", "COPY tests/hidden/", "COPY verifier/"]) {
      expect(stage).not.toContain(forbidden);
    }
  });

  it("should serve the Portal from the participant image, not from the grading one", () => {
    expect(existsSync(join(ROOT, "local/participant/server.py"))).toBe(true);
    expect(existsSync(join(ROOT, "local/participant/workbench.py"))).toBe(true);
    expect(existsSync(join(ROOT, "local/verifier/workbench.py"))).toBe(false);
    // Nothing in the participant image may decide a checkpoint: it forwards instead.
    const server = read("local/participant/server.py");
    expect(server).toContain("proxy_verdict");
    expect(server).not.toContain("tests.hidden");
    expect(server).not.toContain("fixtures.generate");
  });

  it("should keep the verifier off the host and reachable only from the Workbench", () => {
    const compose = parseYaml(read("local/docker-compose.yml")) as {
      services: Record<string, { ports?: string[]; environment?: Record<string, string> }>;
      networks: Record<string, { internal?: boolean }>;
    };
    expect(compose.services.verifier.ports).toBeUndefined();
    expect(compose.services.workbench.environment?.VERIFIER_PUBLIC_URL).toContain("/public");
    expect(compose.networks.lab.internal).toBe(true);
  });

  it("should keep the ground truth and the fault table out of GET /public", () => {
    const payload = probe([
      "import json, os",
      "from fixtures.generate import public_payload",
      "print(json.dumps(public_payload(os.environ['FLAG_SEED'])))",
    ]);
    // Serialised, so a nested key or a value carrying one of these is caught too.
    for (const forbidden of [
      "UNSUPPORTED_CLAIMS",
      "repair_field",
      "damages",
      "claim-a-is-assumption-free\", \"claim-a-prover",
    ]) {
      expect(payload).not.toContain(forbidden);
    }
    const decoded = JSON.parse(payload) as Record<string, unknown>;
    expect(Object.keys(decoded).sort()).toEqual([
      "claims",
      "faultedRun",
      "healthToken",
      "honestRun",
      "pipelines",
    ]);
  });

  // The record used to carry its own `label`, and `faulted_run` labels a faulted run
  // `"<label>:<fault>"` — so the run handed to `first_fault` and `repair` named the fault
  // they were being asked to diagnose, on the graded h0/h1/h2 labels as much as on the
  // public one. Removing that field alone took the transcription probe above from 7/8 to
  // 6/8: `diagnose` is 50 of this problem's 300 points.
  it("should hand the submission a run that does not name its own fault", () => {
    const answer = probe([
      "import json",
      "from fixtures.generate import applicable_faults, faulted_run, honest_run",
      "leaks = []",
      "for name in ('A', 'B'):",
      "    for label in ('public', 'h0', 'h1', 'h2'):",
      "        runs = [honest_run('s', name, label)]",
      "        runs += [faulted_run('s', name, f, label) for f in applicable_faults(name)]",
      "        for run in runs:",
      "            blob = json.dumps(run)",
      "            leaks += [f for f in applicable_faults(name) if f in blob]",
      "            leaks += [k for k in run if k == 'label']",
      "print(json.dumps(sorted(set(leaks))))",
    ]);
    expect(JSON.parse(answer)).toEqual([]);
  });

  // The payload is the only source in the participant image, so it has to carry exactly
  // what `show.py` printed before the split — on every seed, not just this one.
  it("should print the same inspect output from the payload as from the fixtures", () => {
    const answer = probe([
      "import io, json, os, contextlib, importlib",
      "import show",
      "from fixtures.generate import public_payload",
      "diffs = []",
      "for i in range(30):",
      "    seed = f'seed-{i}'",
      "    os.environ['FLAG_SEED'] = seed",
      "    importlib.reload(show)",
      "    os.environ.pop('PUBLIC_EVIDENCE_JSON', None)",
      "    direct = io.StringIO()",
      "    with contextlib.redirect_stdout(direct):",
      "        show.main()",
      "    os.environ['PUBLIC_EVIDENCE_JSON'] = json.dumps(public_payload(seed))",
      "    injected = io.StringIO()",
      "    with contextlib.redirect_stdout(injected):",
      "        show.main()",
      "    os.environ.pop('PUBLIC_EVIDENCE_JSON', None)",
      "    if direct.getvalue() != injected.getvalue():",
      "        diffs.append(seed)",
      "print(json.dumps(diffs))",
    ]);
    expect(JSON.parse(answer)).toEqual([]);
  });
});

describe("ac26-w4-proof-pipeline: metadata contracts", () => {
  function metadata() {
    return JSON.parse(read("metadata.json")) as {
      difficulty: number;
      status: string;
      courseAlignment: {
        week: number;
        role: string;
        sources?: Array<{ kind: string; ref: string }>;
      };
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
