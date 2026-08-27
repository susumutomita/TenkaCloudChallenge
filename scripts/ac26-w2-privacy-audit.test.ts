import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import { parse as parseYaml } from "yaml";
import { participantPythonFiles } from "./lib/local-play-problems";

/**
 * ac26-w2-privacy-audit is Week 2's transfer problem. The assertions that matter run its
 * Python for real: the starter fails, the reference clears every checkpoint, the mutation
 * suite kills every intended defect, and — the point of this problem — an auditor that
 * flags every run is rejected just as firmly as one that flags none. Python 3 is on
 * ubuntu-latest and the problem is stdlib-only.
 */

const ROOT = join(import.meta.dir, "..", "challenges", "ac26-w2-privacy-audit");
const LOCAL = join(ROOT, "local");
const SEED = "ci-fixed-seed";
const CHECKPOINTS = [
  "allowed-opens",
  "opened-secret",
  "cross-party",
  "log-leak",
  "transcript",
  "repair",
  "mutation",
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
  return read(`local/${dir}/auditor.py`);
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

describe("ac26-w2-privacy-audit: participant contract", () => {
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
      "local/tests/public/test_auditor.py",
      "local/tests/hidden/check_auditor.py",
      "local/verifier/server.py",
      "local/participant/server.py",
      "local/participant/workbench.py",
      "local/starter/auditor.py",
      "local/reference/auditor.py",
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

describe("ac26-w2-privacy-audit: container safety", () => {
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

describe("ac26-w2-privacy-audit: the programs are indistinguishable by output", () => {
  // The premise of the whole problem: correctness cannot separate these implementations.
  // If one of them ever returned a different total, the audit would be unnecessary.
  it("should have every implementation return the same, correct total", () => {
    const script = [
      "import sys",
      "sys.path.insert(0, '.')",
      "from fixtures.generate import PROGRAM_IDS, execute, expected_total, program, spec",
      "sp = spec(sys.argv[1])",
      "totals = {execute(program(sp, pid), sp).output for pid in PROGRAM_IDS}",
      "print(len(totals), totals == {expected_total(sp)})",
    ].join("\n");
    expect(python(["-c", script, SEED]).stdout.trim()).toBe("1 True");
  });

  it("should mix leaking and clean implementations, so neither extreme auditor passes", () => {
    const script = [
      "import sys",
      "sys.path.insert(0, '.')",
      "from fixtures.generate import TRUTH",
      "clean = sum(1 for v in TRUTH.values() if v is None)",
      "leaky = sum(1 for v in TRUTH.values() if v is not None)",
      "print(clean, leaky, len(set(v for v in TRUTH.values() if v)))",
    ].join("\n");
    expect(python(["-c", script]).stdout.trim()).toBe("3 4 4");
  });
});

describe("ac26-w2-privacy-audit: fixtures are seed-derived", () => {
  it("should produce different specifications for different seeds", () => {
    const script = [
      "import json, sys",
      "sys.path.insert(0, '.')",
      "from fixtures.generate import health_token, spec",
      "sp = spec(sys.argv[1])",
      "print(json.dumps({'p': sp.p, 'w': sp.weights, 'x': sp.private, 't': health_token(sys.argv[1])}))",
    ].join("\n");
    const first = python(["-c", script, "seed-alpha"]).stdout.trim();
    const second = python(["-c", script, "seed-beta"]).stdout.trim();
    const again = python(["-c", script, "seed-alpha"]).stdout.trim();

    expect(first).not.toBe(second);
    expect(first).toBe(again);
  });

  it("should keep every public weight invertible, so the counterexample is reachable", () => {
    const script = [
      "import sys",
      "sys.path.insert(0, '.')",
      "from fixtures.generate import spec",
      "bad = 0",
      "for i in range(120):",
      "    sp = spec('s%d' % i)",
      "    if any(w % sp.p == 0 for w in sp.weights.values()):",
      "        bad += 1",
      "print(bad)",
    ].join("\n");
    expect(python(["-c", script]).stdout.trim()).toBe("0");
  });
});

describe("ac26-w2-privacy-audit: the problem is solvable and actually fails", () => {
  it("should fail the public tests in the shipped starter state", () => {
    const result = python(["tests/public/test_auditor.py"]);
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

describe("ac26-w2-privacy-audit: /verify contract", () => {
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

  // The two ways to "audit" without auditing. Both must fail on every checkpoint that
  // feeds a program, which is every checkpoint that consumes first_violation.
  const VIOLATION_CHECKPOINTS = ["opened-secret", "cross-party", "log-leak", "mutation"];

  it.each(VIOLATION_CHECKPOINTS)(
    "should reject an auditor that never reports anything on %s",
    (checkpoint) => {
      const source = `${bundle("reference")}\n\ndef first_violation(trace, spec):\n    return None\n`;
      expect(evaluate(checkpoint, source)).toBe(false);
    },
    120_000,
  );

  it.each(VIOLATION_CHECKPOINTS)(
    "should reject an auditor that condemns every run on %s",
    (checkpoint) => {
      const source = [
        bundle("reference"),
        "",
        "def first_violation(trace, spec):",
        "    return {'kind': 'opened-a-secret', 'index': 0}",
        "",
      ].join("\n");
      expect(evaluate(checkpoint, source)).toBe(false);
    },
    120_000,
  );

  // Naming the violation without locating it is half an answer, and the half that does
  // not help anyone fix it.
  it("should reject an auditor that names the violation but not its position", () => {
    const source = bundle("reference").replace(/"index": index/g, '"index": 0');
    expect(source).toContain('"index": 0');
    expect(evaluate("opened-secret", source)).toBe(false);
  }, 120_000);

  // "Delete every observation" is private and still correct, and is not a repair.
  it("should reject a repair that removes the legitimate observations too", () => {
    const source = bundle("reference").replace(
      'if kind == "open" and op[1] not in allowed:\n            continue',
      'if kind in ("open", "peek", "emit", "fail"):\n            continue',
    );
    expect(source).toContain('if kind in ("open", "peek", "emit", "fail"):');
    expect(evaluate("repair", source)).toBe(false);
  }, 120_000);

  it("should reject a submission that hangs, rather than hanging itself", () => {
    expect(
      evaluate("allowed-opens", "def allowed_opens(spec):\n    while True:\n        pass\n"),
    ).toBe(false);
  }, 60_000);

  it("should reject a submission that cannot even be imported", () => {
    expect(evaluate("allowed-opens", "def allowed_opens(:\n")).toBe(false);
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

describe("ac26-w2-privacy-audit: metadata contracts", () => {
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
    expect(meta.difficulty).toBe(4);
    expect(meta.scoring.checks.reduce((sum, check) => sum + check.points, 0)).toBe(300);
    // SCORING.md caps hints per checkpoint, not across the problem.
    for (const check of meta.scoring.checks) {
      const penalty = (check.hints ?? []).reduce((sum, hint) => sum + hint.penalty, 0);
      expect(penalty).toBeLessThanOrEqual(check.points / 2);
    }
  });

  it("should score exactly the checkpoints the verifier implements", () => {
    expect(metadata().scoring.checks.map((check) => check.id)).toEqual([...CHECKPOINTS]);
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
    expect(courseAlignment.role).toBe("transfer");
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

const REPO = join(import.meta.dir, "..");
const DIR = "challenges/ac26-w2-privacy-audit";

describe("ac26-w2-privacy-audit: the participant image carries nothing that grades", () => {
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
    expect(verifierStage).not.toContain("COPY participant/");
    expect(verifierStage).not.toContain("COPY reference/");
    expect(verifierStage).not.toContain("COPY mutation.py");
  });

  it("reproduces the original leak: no file the participant image carries reaches the derivation or the hidden assertions", () => {
    // The file list comes from the Dockerfile's participant stage, via the same
    // derivation `check-answer-reachability.ts` uses, rather than being restated here --
    // so a COPY that puts `fixtures/` or `tests/hidden/` back fails this test.
    const participantFiles = participantPythonFiles(REPO, DIR);
    expect(participantFiles).not.toContain(`${DIR}/local/fixtures/generate.py`);
    expect(participantFiles).not.toContain(`${DIR}/local/tests/hidden/check_auditor.py`);
    expect(participantFiles).not.toContain(`${DIR}/local/verifier/server.py`);
    expect(participantFiles).toContain(`${DIR}/local/tests/public/test_auditor.py`);
    expect(participantFiles).toContain(`${DIR}/local/participant/server.py`);
    for (const file of participantFiles) {
      const source = readFileSync(join(REPO, file), "utf8");
      // The one permitted mention is the lazy, function-scoped checkout/author fallback
      // in show.py and the public tests: never a module-level import, which is what
      // would fail loudly the moment it ran inside a participant image that carries no
      // `fixtures/` at all.
      expect(source).not.toMatch(/^from fixtures/m);
      expect(source).not.toMatch(/^import fixtures/m);
      expect(source).not.toMatch(/^from tests\.hidden/m);
      expect(source).not.toMatch(/^from verifier/m);
    }
  });

  it("publishes only the Workbench, and reaches the verifier over an internal network", () => {
    const compose = parseYaml(read("local/docker-compose.yml")) as {
      services: Record<string, Record<string, unknown>>;
      networks: Record<string, Record<string, unknown>>;
    };
    expect(Object.keys(compose.services).sort()).toEqual(["verifier", "workbench"]);
    // The published port and the /verify URL are what metadata.json's runtime declares,
    // and they did not move: the Workbench answers on 18098 and forwards inward.
    expect(compose.services.workbench.ports).toEqual(["127.0.0.1:18098:18098"]);
    expect(compose.services.verifier.ports).toBeUndefined();
    expect(compose.networks.lab.internal).toBe(true);
    expect(compose.services.verifier.networks).toEqual(["lab"]);
    const runtime = JSON.parse(read("metadata.json")).runtime as { verifyUrl: string };
    expect(runtime.verifyUrl).toBe("http://127.0.0.1:18098/verify");
  });
});

describe("ac26-w2-privacy-audit: what the split does and does not close", () => {
  it("scores zero for a submission that imports the graded material at grading time", () => {
    // Issue 591: `fixtures/` and `tests/hidden/` are on the runner's sys.path because
    // grading needs them, so the guard in verifier/server.py's RUNNER -- not the Docker
    // split -- is what closes this path. Measured, not assumed.
    for (const checkpoint of CHECKPOINTS) {
      expect(evaluate(checkpoint, "from fixtures.generate import *\n")).toBe(false);
    }
  }, 180_000);

  it("scores zero for the modules the participant image ships", () => {
    // The other probe: the participant reads what their own container carries and
    // pastes it, so the RUNNER guard -- which only blocks `import` -- is not in the
    // path. The reference passing every checkpoint above is this probe's positive
    // control (docs/AGENT_LOOP_CONSTRAINTS.md §5): the guard-removal control is flat on
    // this problem, because `fixtures/generate.py` defines none of the four names
    // `starter/auditor.py` asks for.
    for (const shipped of ["participant/workbench.py", "participant/server.py", "show.py"]) {
      const source = readFileSync(join(LOCAL, ...shipped.split("/")), "utf8");
      for (const checkpoint of CHECKPOINTS) {
        expect(evaluate(checkpoint, source)).toBe(false);
      }
    }
  }, 300_000);

  it("no longer ships the decision rule the graded checkpoints exist to make a learner derive", () => {
    // What the single stage actually handed over. `_expected_index` and `_leaks` in the
    // hidden checker state the rule `first_violation` is graded on, kind by kind, and
    // `TRUTH` in the fixtures names the verdict for each program by id. Transcribing
    // those two files scored 7/7 checkpoints -- the whole 300 points -- before the split.
    // Asserted on the rule itself rather than on the identifiers, because
    // participant/server.py's own docstring names them when it explains what moved.
    const hidden = read("local/tests/hidden/check_auditor.py");
    expect(hidden).toContain('event["party"] != event["owner"]');
    expect(hidden).toContain("def _expected_index");
    expect(read("local/fixtures/generate.py")).toMatch(/^TRUTH: /m);
    for (const file of participantPythonFiles(REPO, DIR)) {
      const source = readFileSync(join(REPO, file), "utf8");
      expect(source).not.toContain('event["party"] != event["owner"]');
      expect(source).not.toContain('op[1] not in allowed');
      // `VIOLATIONS` itself is participant surface -- the starter declares the four
      // names. What must not be here is the rule that maps an event to one of them.
      expect(source).not.toMatch(/^TRUTH/m);
      expect(source).not.toMatch(/^def _expected_index/m);
    }
  });
});

describe("ac26-w2-privacy-audit: the public half survives the split", () => {
  it("serves show.py and the public tests every value they used to import", () => {
    const script = [
      "import json, sys",
      "sys.path.insert(0, '.')",
      "from fixtures.generate import execute, health_token, program, spec, spec_as_public",
      "from fixtures.generate import PROGRAM_IDS, public_payload",
      "payload = public_payload(sys.argv[1])",
      "sp = spec(sys.argv[1])",
      "print(json.dumps({",
      "  'spec': payload['spec'] == spec_as_public(sp),",
      "  'cleanEvents': payload['cleanEvents'] == execute(program(sp, 'alpha'), sp).events,",
      "  'health': payload['healthToken'] == health_token(sys.argv[1]),",
      // The private half, the verdict table and the six leaking programs are what must
      // not travel: with any of them a learner could answer a graded checkpoint from
      // `make inspect` alone.
      "  'withheld': not ({'private', 'masks', 'weights', 'truth', 'programs'} & set(payload)),",
      "  'oneProgramOnly': len(PROGRAM_IDS) == 7,",
      "}))",
    ].join("\n");
    const result = python(["-c", script, SEED]);
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout.trim().split("\n").at(-1) ?? "{}")).toEqual({
      spec: true,
      cleanEvents: true,
      health: true,
      withheld: true,
      oneProgramOnly: true,
    });
  });

  it("carries only the clean program's trace, never a leaking one", () => {
    // `show.py` printed exactly one run before the split -- the clean one -- and the
    // payload must not widen that. A leaking trace in here would answer `opened-secret`,
    // `cross-party` or `log-leak` outright, and a `bravo` transcript would answer
    // `transcript`.
    const script = [
      "import json, sys",
      "sys.path.insert(0, '.')",
      "from fixtures.generate import public_payload, spec",
      "payload = public_payload(sys.argv[1])",
      "sp = spec(sys.argv[1])",
      "allowed = {*sp.public_inputs, *sp.masked, sp.result}",
      "leaks = [e for e in payload['cleanEvents']",
      "         if (e['kind'] in ('open', 'emit', 'fail') and e['label'] not in allowed)",
      "         or (e['kind'] == 'peek' and e['party'] != e['owner'])]",
      "print(json.dumps({'leakingEvents': len(leaks)}))",
    ].join("\n");
    for (const seed of ["seed-a", "seed-b", "seed-c", "seed-d", "seed-e"]) {
      const result = python(["-c", script, seed]);
      expect(result.status).toBe(0);
      expect(JSON.parse(result.stdout.trim().split("\n").at(-1) ?? "{}")).toEqual({
        leakingEvents: 0,
      });
    }
  });
});
