import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import { parse as parseYaml } from "yaml";
import { participantPythonFiles } from "./lib/local-play-problems";

/**
 * ac26-w4-arithmetization is Week 4's bridge problem. The assertions that carry weight
 * run its Python for real, and the sharpest of them is the underconstrained witness: a
 * trace that satisfies every transition constraint, is not the computation, and proves a
 * different statement. Python 3 is on ubuntu-latest and the problem is stdlib-only.
 */

const ROOT = join(import.meta.dir, "..", "challenges", "ac26-w4-arithmetization");
const LOCAL = join(ROOT, "local");
const SEED = "ci-fixed-seed";
const CHECKPOINTS = [
  "trace",
  "transition",
  "boundary",
  "interpolate",
  "compose",
  "locate",
  "underconstrained",
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
  return read(`local/${dir}/air.py`);
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

describe("ac26-w4-arithmetization: participant contract", () => {
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
      "local/tests/public/test_air.py",
      "local/tests/hidden/check_air.py",
      "local/verifier/server.py",
      "local/starter/air.py",
      "local/reference/air.py",
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

describe("ac26-w4-arithmetization: container safety", () => {
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

describe("ac26-w4-arithmetization: the domain is a real evaluation domain", () => {
  // Row i sits at g^i, so consecutive rows are consecutive points. That only exists if
  // the group has an element of order `steps`, which needs steps to divide p-1.
  it("should only offer fields where a root of unity of the trace length exists", () => {
    const script = [
      "import sys",
      "sys.path.insert(0, '.')",
      "from fixtures.generate import DOMAINS, root_of_unity",
      "bad = []",
      "for p, steps in DOMAINS:",
      "    if (p - 1) % steps:",
      "        bad.append((p, steps)); continue",
      "    root = root_of_unity(p, steps)",
      "    powers = {pow(root, i, p) for i in range(steps)}",
      "    if len(powers) != steps or pow(root, steps, p) != 1:",
      "        bad.append((p, steps))",
      "print(len(DOMAINS), bad)",
    ].join("\n");
    expect(python(["-c", script]).stdout.trim()).toBe("6 []");
  });

  // A tamper at either end is caught by the boundary constraints alone, which would let
  // an implementation that only checks boundaries look correct.
  it("should never tamper with the first or last row", () => {
    const script = [
      "import sys",
      "sys.path.insert(0, '.')",
      "from fixtures.generate import setting, tampered_trace",
      "ends = 0",
      "for i in range(40):",
      "    cfg = setting('s%d' % i)",
      "    _rows, index = tampered_trace('s%d' % i, 'h0', cfg)",
      "    if index in (0, cfg['steps'] - 1):",
      "        ends += 1",
      "print(ends)",
    ].join("\n");
    expect(python(["-c", script]).stdout.trim()).toBe("0");
  });

  it("should change exactly one row when it tampers", () => {
    const script = [
      "import sys",
      "sys.path.insert(0, '.')",
      "from fixtures.generate import honest_trace, setting, tampered_trace",
      "bad = 0",
      "for i in range(40):",
      "    cfg = setting('s%d' % i)",
      "    rows, index = tampered_trace('s%d' % i, 'h0', cfg)",
      "    honest = honest_trace(cfg)",
      "    differing = [j for j in range(len(rows)) if rows[j] != honest[j]]",
      "    if differing != [index]:",
      "        bad += 1",
      "print(bad)",
    ].join("\n");
    expect(python(["-c", script]).stdout.trim()).toBe("0");
  });
});

describe("ac26-w4-arithmetization: the problem is solvable and actually fails", () => {
  it("should fail the public tests in the shipped starter state", () => {
    const result = python(["tests/public/test_air.py"]);
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

describe("ac26-w4-arithmetization: /verify contract", () => {
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

  // The two that produce a system which looks complete and is not.
  it("should reject a residual evaluator that checks only the last transition", () => {
    const source = bundle("reference").replace(
      "    for index in range(len(trace) - 1):\n        a, b = trace[index]",
      "    for index in range(len(trace) - 2, len(trace) - 1):\n        a, b = trace[index]",
    );
    expect(evaluate("transition", source)).toBe(false);
  }, 120_000);

  it("should reject an implementation with no boundary constraints", () => {
    const source = bundle("reference").replace(
      "    return [(trace[0][0] - start_a) % p, (trace[0][1] - start_b) % p]",
      "    return [0, 0]",
    );
    expect(evaluate("boundary", source)).toBe(false);
  }, 120_000);

  // The i-th transition produces row i+1, so reporting i points one row away.
  it("should reject a violation reported at the row it came from", () => {
    const source = bundle("reference").replace(
      '            return {"row": index + 1, "kind": "transition"}',
      '            return {"row": index, "kind": "transition"}',
    );
    expect(evaluate("locate", source)).toBe(false);
  }, 120_000);

  it("should reject interpolation done over the integers", () => {
    const source = bundle("reference").replace(
      "        scale = values[index] * pow(denominator, -1, p) % p",
      "        scale = values[index] // denominator if denominator else 0",
    );
    expect(evaluate("interpolate", source)).toBe(false);
  }, 120_000);

  it("should reject an underconstrained witness that is just the honest trace", () => {
    const source = bundle("reference").replace(
      '    forged["start"] = ((start_a + 1) % p, start_b)',
      '    forged["start"] = (start_a, start_b)',
    );
    expect(evaluate("underconstrained", source)).toBe(false);
  }, 120_000);

  it("should reject a submission that hangs, rather than hanging itself", () => {
    expect(
      evaluate("trace", "def execute(setting):\n    while True:\n        pass\n"),
    ).toBe(false);
  }, 60_000);

  it("should reject a submission that cannot even be imported", () => {
    expect(evaluate("trace", "def execute(:\n")).toBe(false);
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

describe("ac26-w4-arithmetization: metadata contracts", () => {
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

const DIR = "challenges/ac26-w4-arithmetization";
const REPO_ROOT = join(import.meta.dir, "..");

/**
 * The transcription probe (docs/AGENT_LOOP_CONSTRAINTS.md §5, as on ac26-w2-privacy-audit,
 * ac26-w3-ec-group and ac26-w3-fft-domain). Neither standard probe says anything here,
 * because the leaked material is a set of rules nobody imports by name. Every clause below
 * is copied out of the two files the participant stage used to ship, with no reasoning past
 * copying: `execute` is `fixtures.generate.honest_trace` verbatim -- its docstring there
 * calls it the reference answer for the trace checkpoint -- and the rest comes from
 * `tests/hidden/check_air.py`: the `steps - 1` residual count `check_transition` requires,
 * "the transition out of row i breaks row i+1" from that file's module docstring, the
 * boundary residual `check_boundary` constructs, and the four conditions
 * `check_underconstrained` accepts a witness on. It is kept here rather than under `local/`
 * because it is a probe, not a reference solution: it interpolates nothing, because neither
 * shipped file contains an interpolation.
 */
const TRANSCRIBED = [
  "def execute(setting):",
  "    p, steps, weight = setting['p'], setting['steps'], setting['weight']",
  "    a, b = setting['start']",
  "    rows = [(a % p, b % p)]",
  "    for _ in range(steps - 1):",
  "        a, b = (a + b) % p, (b + weight * a) % p",
  "        rows.append((a, b))",
  "    return rows",
  "",
  "def transition_residuals(trace, setting):",
  "    p, weight = setting['p'], setting['weight']",
  "    out = []",
  "    for index in range(len(trace) - 1):",
  "        a, b = trace[index]",
  "        next_a, next_b = trace[index + 1]",
  "        out.append((((a + b) - next_a) % p, ((b + weight * a) - next_b) % p))",
  "    return out",
  "",
  "def boundary_residuals(trace, setting):",
  "    p = setting['p']",
  "    start_a, start_b = setting['start']",
  "    return [(trace[0][0] - start_a) % p, (trace[0][1] - start_b) % p]",
  "",
  "def interpolate(values, points, p):",
  "    return []",
  "",
  "def evaluate(coefficients, x, p):",
  "    return sum(c * pow(x, degree, p) for degree, c in enumerate(coefficients)) % p",
  "",
  "def column_polynomials(trace, points, p):",
  "    return []",
  "",
  "def first_violation(trace, setting):",
  "    p = setting['p']",
  "    start_a, start_b = setting['start']",
  "    if (trace[0][0] - start_a) % p != 0 or (trace[0][1] - start_b) % p != 0:",
  "        return {'row': 0, 'kind': 'boundary'}",
  "    for position, pair in enumerate(transition_residuals(trace, setting)):",
  "        if any(value % p != 0 for value in pair):",
  "            return {'row': position + 1, 'kind': 'transition'}",
  "    return None",
  "",
  "def underconstrained_witness(setting):",
  "    p = setting['p']",
  "    start_a, start_b = setting['start']",
  "    moved = dict(setting)",
  "    moved['start'] = ((start_a + 1) % p, start_b)",
  "    return {'trace': execute(moved), 'constraint_dropped': 'boundary'}",
  "",
].join("\n");

/** The five checkpoints the transcription above reaches: 185 of this problem's 300 points. */
const TRANSCRIBED_CHECKPOINTS = [
  "trace",
  "transition",
  "boundary",
  "locate",
  "underconstrained",
] as const;

describe("ac26-w4-arithmetization: the participant image carries nothing that grades", () => {
  it("keeps fixtures/, the hidden suite and the verifier out of the participant Docker stage", () => {
    const dockerfile = read("local/Dockerfile");
    const participantStage = dockerfile.slice(
      dockerfile.indexOf("FROM base AS participant"),
      dockerfile.indexOf("FROM base AS verifier"),
    );
    expect(participantStage).not.toContain("COPY fixtures/");
    expect(participantStage).not.toContain("tests/hidden");
    expect(participantStage).not.toContain("COPY verifier/");
    expect(participantStage).not.toContain("COPY reference/");
    expect(participantStage).not.toContain("COPY mutation.py");
    expect(participantStage).toContain("COPY tests/public/");
    expect(participantStage).toContain("COPY participant/");

    const verifierStage = dockerfile.slice(
      dockerfile.indexOf("FROM base AS verifier"),
      dockerfile.indexOf("FROM participant AS author"),
    );
    expect(verifierStage).toContain("COPY fixtures/");
    expect(verifierStage).toContain("COPY tests/hidden/");
    expect(verifierStage).toContain("COPY verifier/");
    // Unlike ac26-w2-private-aggregate there is no supplied half here: every graded
    // function is handed its setting, its trace and its domain, so the verifier stage must
    // not pull `participant/` in at all.
    expect(verifierStage).not.toContain("COPY participant/");
    expect(verifierStage).not.toContain("COPY reference/");
    expect(verifierStage).not.toContain("COPY mutation.py");
  });

  it("reproduces the original leak: no file the participant image carries states a grading rule", () => {
    // The file list comes from the Dockerfile's participant stage, via the same derivation
    // `check-answer-reachability.ts` uses, rather than being restated here -- so a COPY
    // that puts `fixtures/` or `tests/hidden/` back fails this test.
    const participantFiles = participantPythonFiles(REPO_ROOT, DIR);
    expect(participantFiles).not.toContain(`${DIR}/local/fixtures/generate.py`);
    expect(participantFiles).not.toContain(`${DIR}/local/tests/hidden/check_air.py`);
    expect(participantFiles).not.toContain(`${DIR}/local/verifier/server.py`);
    expect(participantFiles).toContain(`${DIR}/local/tests/public/test_air.py`);
    expect(participantFiles).toContain(`${DIR}/local/participant/server.py`);
    for (const file of participantFiles) {
      const source = readFileSync(join(REPO_ROOT, file), "utf8");
      // The one permitted mention is the lazy, function-scoped checkout/author fallback in
      // show.py and tests/public/test_air.py: never a module-level import, which is what
      // would fail loudly the moment it ran inside a participant image that carries no
      // `fixtures/` at all.
      expect(source).not.toMatch(/^from fixtures/m);
      expect(source).not.toMatch(/^import fixtures/m);
      expect(source).not.toMatch(/^from tests\.hidden/m);
      expect(source).not.toMatch(/^from verifier/m);
      // The machine itself: honest_trace is the trace checkpoint's answer, and
      // tampered_trace decides where `locate` has to point.
      expect(source).not.toContain("def honest_trace");
      expect(source).not.toContain("def tampered_trace");
      // The residual count is the thing starter/air.py tells the learner to work out.
      expect(source).not.toContain("def check_transition");
      expect(source).not.toContain("def check_underconstrained");
    }
  });

  it("publishes only the Workbench, and reaches the verifier over an internal network", () => {
    const compose = parseYaml(read("local/docker-compose.yml")) as {
      services: Record<string, Record<string, unknown>>;
      networks: Record<string, Record<string, unknown>>;
    };
    expect(Object.keys(compose.services).sort()).toEqual(["verifier", "workbench"]);
    // The published port and the /verify URL are what metadata.json's runtime declares, and
    // they did not move: the Workbench answers on 18104 and forwards inward.
    expect(compose.services.workbench.ports).toEqual(["127.0.0.1:18104:18104"]);
    expect(compose.services.verifier.ports).toBeUndefined();
    expect(compose.networks.lab.internal).toBe(true);
    expect(compose.services.verifier.networks).toEqual(["lab"]);
    const runtime = JSON.parse(read("metadata.json")).runtime as { verifyUrl: string };
    expect(runtime.verifyUrl).toBe("http://127.0.0.1:18104/verify");
  });

  it("brings the verifier up for every target that needs public evidence", () => {
    // Since the split `show.py` and the public tests read this deployment's public half
    // over the compose network, so a bare `docker run` against the participant image cannot
    // serve them.
    const makefile = read("Makefile");
    for (const target of [
      "test: build verifier-up",
      "test-one: build verifier-up",
      "inspect: build verifier-up",
    ]) {
      expect(makefile).toContain(target);
    }
    expect(makefile).toContain("verifier-up:");
    expect(makefile).toContain("verifier-down:");
    // Every problem's compose directory is named `local`, so an unqualified project name
    // collides across problems -- and `--remove-orphans` then deletes another problem's
    // running containers (docs/AGENT_LOOP_CONSTRAINTS.md §6).
    expect(makefile).toContain("-p $(IMAGE)");
    expect(makefile).not.toContain("--remove-orphans");
  });
});

describe("ac26-w4-arithmetization: what the split does and does not close", () => {
  it("scores zero for a submission that imports the graded material at grading time", () => {
    // Issue 591: `fixtures/` and `tests/hidden/` are on the runner's sys.path because
    // grading needs them, so the guard in verifier/server.py's RUNNER -- not the Docker
    // split -- is what closes this path. Measured, not assumed.
    for (const checkpoint of CHECKPOINTS) {
      expect(evaluate(checkpoint, "from fixtures.generate import *\n")).toBe(false);
    }
  }, 300_000);

  it("scores zero for the module the participant image ships", () => {
    // The other probe: the participant reads what their own container carries and pastes
    // it, so the RUNNER guard -- which only blocks `import` -- is not in the path. The
    // reference passing every checkpoint (below) is this probe's positive control
    // (docs/AGENT_LOOP_CONSTRAINTS.md §5), because the guard-removal control is flat here:
    // nothing the participant stage ships defines any name the hidden suite calls, so
    // without the reference a silently broken probe would report the same zero.
    const shipped = read("local/participant/workbench.py");
    for (const checkpoint of CHECKPOINTS) {
      expect(evaluate(checkpoint, shipped)).toBe(false);
    }
  }, 300_000);

  it("scores five eighths of the problem for a submission transcribed out of the two shipped files", () => {
    // What the split closes, asserted as a live measurement rather than a claim: the
    // transcription still scores -- grading did not change -- and the files it was
    // transcribed from are no longer in the participant image (the tests above). It stops
    // at five checkpoints because neither shipped file contains an interpolation, which is
    // what `interpolate`, `compose` and `transfer` need.
    for (const checkpoint of CHECKPOINTS) {
      expect(evaluate(checkpoint, TRANSCRIBED)).toBe(
        (TRANSCRIBED_CHECKPOINTS as readonly string[]).includes(checkpoint),
      );
    }
    const checks = JSON.parse(read("metadata.json")).scoring.checks as Array<{
      id: string;
      points: number;
    }>;
    const scored = checks.filter((check) =>
      (TRANSCRIBED_CHECKPOINTS as readonly string[]).includes(check.id),
    );
    expect(scored.reduce((sum, check) => sum + check.points, 0)).toBe(185);
  }, 300_000);

  it("is a probe that can score: the reference passes every checkpoint", () => {
    // The positive control for the two zeros above. Without it, a probe broken in some way
    // that has nothing to do with the split reports the same 0 as a closed problem.
    for (const checkpoint of CHECKPOINTS) {
      expect(evaluate(checkpoint, bundle("reference"))).toBe(true);
    }
  }, 300_000);
});

describe("ac26-w4-arithmetization: the public half survives the split", () => {
  it("serves show.py and the public tests every value they used to import, and nothing else", () => {
    const script = [
      "import json, sys",
      "sys.path.insert(0, '.')",
      "from fixtures.generate import public_payload, domain, honest_trace, setting, health_token",
      "seed = sys.argv[1]",
      "cfg = setting(seed)",
      "payload = public_payload(seed)",
      "print(json.dumps({",
      "  'health': payload['healthToken'] == health_token(seed),",
      "  'setting': payload['setting'] == {'p': cfg['p'], 'steps': cfg['steps'],",
      "      'weight': cfg['weight'], 'start': list(cfg['start'])},",
      "  'domain': payload['domain'] == domain(cfg),",
      "  'trace': payload['trace'] == [list(row) for row in honest_trace(cfg)],",
      // The hidden labels are what every checkpoint is graded on, and none of them travels.
      "  'publicLabelOnly': all(",
      "      json.dumps(public_payload(seed)) != json.dumps({",
      "          'healthToken': payload['healthToken'],",
      "          'setting': {'p': setting(seed, label)['p'],",
      "              'steps': setting(seed, label)['steps'],",
      "              'weight': setting(seed, label)['weight'],",
      "              'start': list(setting(seed, label)['start'])},",
      "          'domain': domain(setting(seed, label)),",
      "          'trace': [list(r) for r in honest_trace(setting(seed, label))],",
      "      }) for label in ('h0', 'h1', 'h2')),",
      "}))",
    ].join("\n");
    const result = python(["-c", script, SEED]);
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout.trim().split("\n").at(-1) ?? "{}")).toEqual({
      health: true,
      setting: true,
      domain: true,
      trace: true,
      publicLabelOnly: true,
    });
  });

  it("prints exactly what it printed before the split, on every seed shape", () => {
    // show.py reads `GET /public` now instead of importing `fixtures.generate`. What a
    // learner sees must not have moved with it, so the payload path is driven straight
    // through show.py -- via PUBLIC_EVIDENCE_JSON, the same value the network branch
    // returns -- and compared against the derivation, across seeds.
    const script = [
      "import io, json, os, contextlib, sys",
      "sys.path.insert(0, '.')",
      "import show",
      "from fixtures.generate import public_payload",
      "disagreed = []",
      "for index in range(30):",
      "    seed = 'show-%d' % index",
      "    os.environ['PUBLIC_EVIDENCE_JSON'] = json.dumps(public_payload(seed))",
      "    injected = io.StringIO()",
      "    with contextlib.redirect_stdout(injected):",
      "        show.main()",
      "    del os.environ['PUBLIC_EVIDENCE_JSON']",
      "    show.SEED = seed",
      "    direct = io.StringIO()",
      "    with contextlib.redirect_stdout(direct):",
      "        show.main()",
      "    if injected.getvalue() != direct.getvalue():",
      "        disagreed.append(index)",
      "print(json.dumps({'disagreed': disagreed}))",
    ].join("\n");
    const result = python(["-c", script]);
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout.trim().split("\n").at(-1) ?? "null")).toEqual({
      disagreed: [],
    });
  });

  it("tells a learner which service is missing when the verifier is not running", () => {
    // show.py inside a participant image has no `fixtures/` to fall back to, so an
    // unreachable verifier must say so rather than raise a urllib traceback at somebody
    // trying to read their own fixtures.
    const result = spawnSync("python3", ["show.py"], {
      cwd: LOCAL,
      encoding: "utf8",
      env: {
        ...process.env,
        FLAG_SEED: SEED,
        PYTHONDONTWRITEBYTECODE: "1",
        // Nothing listens on the discard port.
        VERIFIER_PUBLIC_URL: "http://127.0.0.1:9/public",
      },
      timeout: 60_000,
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("cannot reach this deployment's verifier");
    expect(result.stderr).toContain("make verifier-up");
  });

  it("forwards a verdict inward and fails closed when the verifier does not answer", () => {
    // Nothing in the Workbench decides a checkpoint. A missing verifier must read as a
    // wrong answer, never as a correct one and never as a crash.
    const script = [
      "import json, sys",
      "sys.path.insert(0, '.')",
      "from participant.server import proxy_verdict",
      "body = {'checkpointId': 'trace', 'submission': 'x'}",
      "print(json.dumps({",
      "  'unset': proxy_verdict(body, ''),",
      "  'unreachable': proxy_verdict(body, 'http://127.0.0.1:9/verify'),",
      "}))",
    ].join("\n");
    const result = python(["-c", script]);
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout.trim().split("\n").at(-1) ?? "{}")).toEqual({
      unset: { checkpointId: "trace", correct: false },
      unreachable: { checkpointId: "trace", correct: false },
    });
  });
});
