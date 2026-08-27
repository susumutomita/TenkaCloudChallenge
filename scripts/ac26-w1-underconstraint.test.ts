import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import { parse as parseYaml } from "yaml";

/**
 * ac26-w1-underconstraint is the first Week 1 problem. The interesting assertions run its
 * Python for real — the starter fails, the reference passes every checkpoint, the mutation
 * suite kills every intended defect, and /verify holds its security contract — rather than
 * reading source text. Python 3 is on ubuntu-latest and the problem is stdlib-only.
 */

const ROOT = join(import.meta.dir, "..", "challenges", "ac26-w1-underconstraint");
const LOCAL = join(ROOT, "local");
const SEED = "ci-fixed-seed";
const SUBMITTED = ["policy.py"] as const;

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
  return read(`local/${dir}/policy.py`);
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

/** Same as `evaluate`, but against a caller-chosen seed rather than the module-level SEED. */
function evaluateWithSeed(seed: string, checkpointId: string, submission: string): boolean {
  const script = [
    "import json, sys",
    "sys.path.insert(0, '.')",
    "from verifier.server import evaluate",
    "print(json.dumps(evaluate(sys.argv[1], sys.argv[2])))",
  ].join("\n");
  const result = spawnSync("python3", ["-c", script, checkpointId, submission], {
    cwd: LOCAL,
    encoding: "utf8",
    env: { ...process.env, FLAG_SEED: seed, PYTHONDONTWRITEBYTECODE: "1" },
    timeout: 60_000,
  });
  expect(result.status).toBe(0);
  return JSON.parse(result.stdout.trim().split("\n").at(-1) ?? "null") === true;
}

/** Find a seed whose deployed circuit is missing exactly the given constraint. */
function findSeedForBranch(missing: "c-iszero-a" | "c-iszero-b"): string {
  const script = [
    "import sys",
    "sys.path.insert(0, '.')",
    "from fixtures.generate import DROPPABLE, vulnerable_circuit",
    "target = sys.argv[1]",
    "for i in range(4000):",
    "    seed = f'branch-search-{i}'",
    "    present = {c['id'] for c in vulnerable_circuit(seed)}",
    "    if next(cid for cid in DROPPABLE if cid not in present) == target:",
    "        print(seed)",
    "        break",
  ].join("\n");
  const result = spawnSync("python3", ["-c", script, missing], { cwd: LOCAL, encoding: "utf8" });
  expect(result.status).toBe(0);
  const seed = result.stdout.trim();
  expect(seed).not.toBe("");
  return seed;
}

function rootCauseAnswerFor(seed: string): {
  missingConstraintId: string;
  manipulatedSignals: Array<{ signal: string; before: number; after: number }>;
} {
  const script = [
    "import json, sys",
    "sys.path.insert(0, '.')",
    "from verifier.server import _expected_root_cause",
    "print(json.dumps(_expected_root_cause(sys.argv[1])))",
  ].join("\n");
  const result = spawnSync("python3", ["-c", script, seed], { cwd: LOCAL, encoding: "utf8" });
  expect(result.status).toBe(0);
  return JSON.parse(result.stdout.trim());
}

function rootCauseAnswer(): {
  missingConstraintId: string;
  manipulatedSignals: Array<{ signal: string; before: number; after: number }>;
} {
  // `_expected_root_cause` lives in verifier/server.py, not fixtures/generate.py:
  // it is the root-cause checkpoint's ground truth, and unlike the input
  // generators it must not be importable from the module the participant reads
  // for inputs (#525). Grading, not fixtures, is the only thing that needs it.
  const script = [
    "import json, os, sys",
    "sys.path.insert(0, '.')",
    "from verifier.server import _expected_root_cause",
    "print(json.dumps(_expected_root_cause(os.environ['FLAG_SEED'])))",
  ].join("\n");
  const result = python(["-c", script]);
  expect(result.status).toBe(0);
  return JSON.parse(result.stdout.trim());
}

describe("ac26-w1-underconstraint: participant contract", () => {
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
      "local/tests/public/test_policy.py",
      "local/tests/hidden/check_policy.py",
      // The supplied residual evaluator moved out of fixtures/ with the Issue 543
      // option B2 split: it is the half this problem deliberately hands over, so it
      // has to stay in the participant image while fixtures/ leaves it.
      "local/participant/evaluator.py",
      "local/participant/evidence.py",
      "local/verifier/server.py",
      "local/starter/policy.py",
      "local/reference/policy.py",
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

describe("ac26-w1-underconstraint: container safety", () => {
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

describe("ac26-w1-underconstraint: fixtures are seed-derived", () => {
  it("should produce different circuits for different seeds", () => {
    const script = [
      "import json, sys",
      "sys.path.insert(0, '.')",
      "from fixtures.generate import params, vulnerable_circuit, health_token",
      "seed = sys.argv[1]",
      "print(json.dumps({'p': params(seed), 'c': vulnerable_circuit(seed), 't': health_token(seed)}))",
    ].join("\n");
    const first = python(["-c", script, "seed-alpha"]).stdout.trim();
    const second = python(["-c", script, "seed-beta"]).stdout.trim();
    const again = python(["-c", script, "seed-alpha"]).stdout.trim();

    expect(first).not.toBe(second);
    expect(first).toBe(again);
  });

  // Both is-zero constraints must actually occur as the dropped one across seeds, or
  // half the exploit logic would never be exercised by any learner. Derived by reading
  // `vulnerable_circuit`'s own ids, the same way `check_audit` and the verifier do now
  // — not by importing a function whose whole job is to say which one (#525).
  it("should drop each of the two is-zero constraints across seeds", () => {
    const script = [
      "import sys",
      "sys.path.insert(0, '.')",
      "from fixtures.generate import DROPPABLE, vulnerable_circuit",
      "def dropped(seed):",
      "    present = {c['id'] for c in vulnerable_circuit(seed)}",
      "    return next(cid for cid in DROPPABLE if cid not in present)",
      "print(','.join(dropped('s%d' % i) for i in range(40)))",
    ].join("\n");
    const dropped = new Set(python(["-c", script]).stdout.trim().split(","));
    expect(dropped).toEqual(new Set(["c-iszero-a", "c-iszero-b"]));
  });

  it("should bind root-cause to seeded before/after values, not a two-way guess", () => {
    const script = [
      "import json, sys",
      "sys.path.insert(0, '.')",
      "from verifier.server import _expected_root_cause",
      "answers = [json.dumps(_expected_root_cause(f'solvability-{i}'), sort_keys=True) for i in range(2000)]",
      "counts = {answer: answers.count(answer) for answer in set(answers)}",
      "print(json.dumps({'distinct': len(counts), 'max': max(counts.values())}))",
    ].join("\n");
    const result = python(["-c", script]);
    expect(result.status).toBe(0);
    const distribution = JSON.parse(result.stdout.trim()) as { distinct: number; max: number };
    expect(distribution.distinct).toBeGreaterThan(100);
    expect(distribution.max / 2000).toBeLessThan(0.05);
  });
});

describe("ac26-w1-underconstraint: fixtures do not ship in the participant image (#537/#543 B2)", () => {
  /**
   * #533 stopped `fixtures/generate.py` exporting the complete circuit, the missing id,
   * a forgery or the root-cause diagnosis as callable values, and the tests below still
   * pin that. What it did not stop is `_ISZERO_HALVES`: both halves of the is-zero
   * gadget as dicts, under the exact `c-iszero-a` / `c-iszero-b` ids the checkpoints
   * require. `intended_circuit()` was a copy out of that dict, and `audit` and `repair`
   * fell out of it as a set difference against the deployed circuit. Measured on the
   * shipped image: transcription alone scored 3 of 6 checkpoints (160/300), and
   * transcription plus a scan over the supplied evaluator scored 5 of 6 (260/300) --
   * every checkpoint a code submission can reach, the same score as the reference.
   *
   * These tests fail, and that path reopens, the moment `COPY fixtures/` returns to the
   * participant stage.
   */
  function participantStage(): string {
    const dockerfile = read("local/Dockerfile");
    const stage = /\nFROM base AS participant\n([\s\S]*?)\nFROM /.exec(dockerfile);
    expect(stage).not.toBeNull();
    return stage?.[1] ?? "";
  }

  it("should copy neither fixtures/, tests/hidden/ nor verifier/ into the participant stage", () => {
    const stage = participantStage();
    expect(stage).toContain("COPY tests/public/");
    expect(stage).toContain("COPY participant/");
    expect(stage).toContain("COPY starter/");
    for (const forbidden of ["COPY fixtures/", "COPY tests/ ", "COPY tests/hidden/", "COPY verifier/"]) {
      expect(stage).not.toContain(forbidden);
    }
  });

  it("should leave nothing on the participant side importing fixtures at module level", () => {
    for (const path of ["local/show.py", "local/participant/server.py", "local/tests/public/test_policy.py"]) {
      // `participant/evidence.py` has the one deliberate function-scoped fallback, which
      // resolves in a checkout or the author stage and never inside a participant image.
      expect(read(path)).not.toContain("from fixtures.");
      expect(read(path)).not.toContain("import fixtures");
    }
    const evidence = read("local/participant/evidence.py");
    expect(evidence).toContain("from fixtures.generate import public_payload");
    // Function-scoped: it must not be reachable at import time.
    expect(evidence).not.toMatch(/^from fixtures\./m);
  });

  it("should serve the public half from the verifier and wire the workbench to it", () => {
    expect(read("local/verifier/server.py")).toContain('if path == "/public":');
    expect(read("local/verifier/server.py")).toContain("public_payload(SEED)");
    const compose = read("local/docker-compose.yml");
    expect(compose).toContain("VERIFIER_PUBLIC_URL: http://verifier:18095/public");
    // The verifier is still not published to the host, so that URL only resolves inside `lab`.
    const parsed = parseYaml(compose) as { services: Record<string, { ports?: string[] }> };
    expect(parsed.services.verifier.ports).toBeUndefined();
    const makefile = read("Makefile");
    for (const target of ["verifier-up:", "verifier-down:"]) expect(makefile).toContain(target);
  });

  it("should keep the second is-zero half out of the public payload on every seed", () => {
    // The deployed circuit carries exactly one of the two halves -- that is the problem
    // statement. Serving both would put `intended_circuit()`'s answer back on the wire.
    const script = [
      "import json, sys",
      "sys.path.insert(0, '.')",
      "from fixtures.generate import public_payload",
      "seen = set()",
      "for i in range(40):",
      "    payload = public_payload(f'payload-seed-{i}')",
      "    blob = json.dumps(payload)",
      "    kinds = sorted(c['kind'] for c in payload['deployedCircuit'] if c['kind'].startswith('iszero'))",
      "    assert len(kinds) == 1, kinds",
      "    seen.update(kinds)",
      "    assert 'DROPPABLE' not in blob and '_ISZERO_HALVES' not in blob",
      "print(','.join(sorted(seen)))",
    ].join("\n");
    const result = python(["-c", script]);
    expect(result.status).toBe(0);
    // Both branches occur across seeds, so the single-half assertion above is not
    // passing because one branch never happens.
    expect(result.stdout.trim()).toBe("iszero_a,iszero_b");
  }, 60_000);

  it("should refuse a submission that reaches for the fixtures at grading time", () => {
    // The renamed import, not a star one: `fixtures/generate.py` defines none of the four
    // names the starter asks for, so `from fixtures.generate import *` scores 0 whether
    // the Issue 591 guard is there or not. Importing `_ISZERO_HALVES` under another name
    // and building the four functions from it is the reachability measurement -- it scores
    // 5 of 6 checkpoints with the guard removed, and must score nothing with it in place.
    const cheat = [
      "from fixtures.generate import _ISZERO_HALVES as HALVES, DROPPABLE as CANDIDATES",
      "BASE = [",
      "    {'id': 'c-issuer-bool', 'kind': 'boolean', 'signal': 'issuer_ok'},",
      "    {'id': 'c-ok-bool', 'kind': 'boolean', 'signal': 'ok'},",
      "    {'id': 'c-grant', 'kind': 'mul', 'left': 'ok', 'right': 'issuer_ok', 'out': 'granted'},",
      "]",
      "INTENDED = BASE[:2] + [dict(HALVES[c]) for c in CANDIDATES] + BASE[2:]",
      "def intended_circuit():",
      "    return [dict(c) for c in INTENDED]",
      "def audit(circuit):",
      "    present = {str(c['id']) for c in circuit}",
      "    return sorted(str(c['id']) for c in INTENDED if str(c['id']) not in present)",
      "def forge_witness(circuit, params):",
      "    return {}",
      "def repair(circuit):",
      "    present = {str(c['id']) for c in circuit}",
      "    return [dict(c) for c in circuit] + [dict(c) for c in INTENDED if str(c['id']) not in present]",
    ].join("\n");
    for (const checkpoint of ["build", "audit", "repair"]) {
      expect(evaluate(checkpoint, cheat)).toBe(false);
    }
  }, 120_000);

  it("should guard the submission import against fixtures/ and tests/ on the grading path", () => {
    const verifier = read("local/verifier/server.py");
    expect(verifier).toContain(
      'if name in ("tests", "fixtures") or name.startswith(("tests.", "fixtures."))',
    );
    // The supplied evaluator is preloaded ahead of the guard, so a submission's own
    // top-level import of it still resolves (#608's rule).
    expect(verifier).toContain("import participant.evaluator");
  });

  it("should print the same evidence from GET /public as from the checkout's fixtures", () => {
    // `show.py` has three resolution branches; this drives the injected one against the
    // fixtures one and diffs them, which is what makes the wire form testable with no
    // Docker daemon.
    const script = [
      "import io, json, os, sys",
      "from contextlib import redirect_stdout",
      "sys.path.insert(0, '.')",
      "import show",
      "from fixtures.generate import public_payload",
      "for i in range(20):",
      "    seed = f'show-seed-{i}'",
      "    os.environ['FLAG_SEED'] = seed",
      "    os.environ.pop('PUBLIC_EVIDENCE_JSON', None)",
      "    os.environ.pop('VERIFIER_PUBLIC_URL', None)",
      "    local = io.StringIO()",
      "    with redirect_stdout(local):",
      "        show.main()",
      "    os.environ['PUBLIC_EVIDENCE_JSON'] = json.dumps(public_payload(seed))",
      "    wire = io.StringIO()",
      "    with redirect_stdout(wire):",
      "        show.main()",
      "    assert local.getvalue() == wire.getvalue(), seed",
      "print('identical')",
    ].join("\n");
    const result = python(["-c", script]);
    expect(result.status).toBe(0);
    expect(result.stdout.trim().split("\n").at(-1)).toBe("identical");
  }, 60_000);
});

describe("ac26-w1-underconstraint: fixtures do not ship checkpoint answers (#525)", () => {
  // The audit that filed #525 found the complete circuit, the missing-constraint id,
  // a pre-built forgery and the root-cause diagnosis all sitting in fixtures/generate.py
  // -- the module the public AND hidden tests both import for legitimate reasons, and
  // so the module a curious learner reaches first. None of the four belong there.
  it("should not export the complete circuit, the missing id, a forgery, or the root-cause diagnosis from fixtures/generate.py", () => {
    const script = [
      "import sys",
      "sys.path.insert(0, '.')",
      "import fixtures.generate as g",
      "leaked = [n for n in ('intended_circuit', 'dropped_constraint', 'forgery_case', 'root_cause_diagnosis') if hasattr(g, n)]",
      "print(','.join(leaked))",
    ].join("\n");
    const result = python(["-c", script]);
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe("");
  });

  it("should not import the complete circuit or the missing id from fixtures/generate.py in the hidden tests", () => {
    // `module.intended_circuit()` (the *submission's own* function) legitimately
    // appears in check_policy.py, so this checks the import list specifically,
    // not the whole file for the substring.
    const hidden = read("local/tests/hidden/check_policy.py");
    const match = /from fixtures\.generate import \(([\s\S]*?)\)/.exec(hidden);
    expect(match).not.toBeNull();
    const imported = match?.[1] ?? "";
    expect(imported).not.toContain("intended_circuit");
    expect(imported).not.toContain("dropped_constraint");
    expect(imported).not.toContain("forgery_case");
    expect(imported).not.toContain("root_cause_diagnosis");
  });

  it("should not import a pre-built forgery or the root-cause diagnosis from fixtures/generate.py in the verifier", () => {
    const verifier = read("local/verifier/server.py");
    const match = /from fixtures\.generate import \(([\s\S]*?)\)/.exec(verifier);
    expect(match).not.toBeNull();
    const imported = match?.[1] ?? "";
    expect(imported).not.toContain("forgery_case");
    expect(imported).not.toContain("root_cause_diagnosis");
    expect(imported).not.toContain("intended_circuit");
    expect(imported).not.toContain("dropped_constraint");
  });

  // The exact shape #525 reported: a policy.py with no cryptographic reasoning at all,
  // just importing whatever fixtures/generate.py hands out and returning it. Before the
  // fix this scored 210+/300 with zero understanding; if it ever scores again on any
  // checkpoint, the answer leaked back into the participant image.
  it("should not let a policy.py that only re-exports fixtures/generate.py's own leftovers pass any checkpoint", () => {
    const cheat = [
      "import os",
      "import fixtures.generate as g",
      "FLAG_SEED = os.environ.get('FLAG_SEED', 'local-dev-seed')",
      "def _leak(name, *args):",
      "    fn = getattr(g, name, None)",
      "    return fn(*args) if fn else None",
      "def intended_circuit():",
      "    return _leak('intended_circuit') or []",
      "def audit(circuit):",
      "    got = _leak('dropped_constraint', FLAG_SEED)",
      "    return [got] if got else []",
      "def forge_witness(circuit, params):",
      "    got = _leak('forgery_case', FLAG_SEED)",
      "    return got[1] if got else {}",
      "def repair(circuit):",
      "    return _leak('intended_circuit') or list(circuit)",
    ].join("\n");
    for (const checkpoint of ["build", "audit", "exploit", "repair"]) {
      expect(evaluate(checkpoint, cheat)).toBe(false);
    }
  }, 120_000);
});

describe("ac26-w1-underconstraint: the problem is solvable and actually fails", () => {
  // The public tests pass in the starter state *by design*: the starter circuit accepts
  // both honest witnesses while binding `ok` to nothing at all. That is the misconception
  // the problem exists to break, so it is asserted rather than tolerated.
  it("should pass the public tests in the shipped starter state, because they never forge", () => {
    const result = python(["tests/public/test_policy.py"]);
    expect(result.status).toBe(0);
    expect(result.stdout).not.toContain("FAIL");
  });

  it("should kill every intended defect in the mutation suite", () => {
    const result = python(["mutation.py"]);
    expect(result.stdout).toContain("PASS reference implementation passes the hidden tests");
    expect(result.stdout).not.toContain("SURVIVED");
    expect(result.status).toBe(0);
  });
});

describe("ac26-w1-underconstraint: /verify contract", () => {
  it.each(["build", "audit", "exploit", "repair", "mutation-transfer"])(
    "should accept the reference submission on %s",
    (checkpoint) => {
      expect(evaluate(checkpoint, bundle("reference"))).toBe(true);
    },
    120_000,
  );

  it.each(["build", "audit", "exploit", "repair", "mutation-transfer"])(
    "should reject the starter submission on %s",
    (checkpoint) => {
      expect(evaluate(checkpoint, bundle("starter"))).toBe(false);
    },
    120_000,
  );

  it("should reject a submission that hangs, rather than hanging itself", () => {
    expect(evaluate("build", "def intended_circuit():\n    while True:\n        pass\n")).toBe(
      false,
    );
  }, 60_000);

  it("should reject an unknown checkpoint id instead of crediting it", () => {
    expect(evaluate("finish-week1", bundle("reference"))).toBe(false);
  });

  it("should require the seeded before/after values in root-cause", () => {
    const answer = rootCauseAnswer();
    expect(evaluate("root-cause", JSON.stringify(answer))).toBe(true);
    expect(
      evaluate(
        "root-cause",
        JSON.stringify({
          missingConstraintId: answer.missingConstraintId,
          manipulatedSignals: answer.manipulatedSignals.map(({ signal }) => signal),
        }),
      ),
    ).toBe(false);
  });

  // A forgery that also satisfies the intended circuit demonstrates nothing, and is the
  // single most likely way to "pass" the exploit checkpoint without understanding it.
  it("should reject a forgery that satisfies the intended circuit too", () => {
    const source = [
      "def intended_circuit():",
      "    return []",
      "def audit(circuit):",
      "    return []",
      "def forge_witness(circuit, params):",
      "    p = params['p']; r = params['revoked'] % p",
      "    inv = pow(r, -1, p) if r else 0",
      "    return {'revoked': r, 'inv': inv, 'ok': 0, 'issuer_ok': params['issuer_ok'], 'granted': 0}",
      "def repair(circuit):",
      "    return list(circuit)",
    ].join("\n");
    expect(evaluate("exploit", source)).toBe(false);
  });

  it("should echo the checkpointId so the platform can fail closed", () => {
    expect(read("local/verifier/server.py")).toContain(
      '{"checkpointId": checkpoint_id, "correct": correct}',
    );
  });
});

describe("ac26-w1-underconstraint: participant/verifier separation (Issue 525/543/537)", () => {
  /** The file set a stage actually carries, in COPY order, for one Dockerfile stage. */
  function stage(name: "participant" | "verifier" | "author"): string {
    const dockerfile = read("local/Dockerfile");
    const starts = [
      ["participant", "FROM base AS participant"],
      ["verifier", "FROM base AS verifier"],
      ["author", "FROM participant AS author"],
    ] as const;
    const index = starts.findIndex(([id]) => id === name);
    const from = dockerfile.indexOf(starts[index][1]);
    const next = index + 1 < starts.length ? dockerfile.indexOf(starts[index + 1][1]) : -1;
    return next < 0 ? dockerfile.slice(from) : dockerfile.slice(from, next);
  }

  it("keeps the grader and the hidden suite out of the participant Docker stage", () => {
    // This is the leak #533 did not close. It moved `intended_circuit`,
    // `dropped_constraint`, `forgery_case` and `root_cause_diagnosis` out of
    // `fixtures/generate.py`, but the derivation that replaced them --
    // `verifier/server.py`'s `_expected_root_cause`, which returns exactly the JSON
    // `root-cause` accepts for a given seed -- kept shipping in the one stage a
    // learner's own `make build` produced, keyed by the FLAG_SEED already in their
    // container's environment.
    const participant = stage("participant");
    expect(participant).not.toContain("COPY verifier/");
    expect(participant).not.toContain("tests/hidden");
    expect(participant).not.toContain("COPY reference/");
    expect(participant).not.toContain("COPY mutation.py");
    expect(participant).toContain("COPY participant/");
    expect(participant).toContain("COPY tests/public/");
    // `fixtures/` used to stay here, on the grounds that after #533 it returned the
    // deployed circuit, the parameters and the two honest witnesses -- all of which
    // `make inspect` prints -- so dropping it would hide the question, not the answer.
    // That was wrong: `_ISZERO_HALVES` is both halves of the gadget as dicts under the
    // exact ids the checkpoints require, which is `intended_circuit()`'s answer. The
    // public half moved to the verifier's `GET /public` (Issue 543 option B2).
    expect(participant).not.toContain("COPY fixtures/");

    const verifier = stage("verifier");
    expect(verifier).toContain("COPY verifier/");
    expect(verifier).toContain("COPY tests/hidden/");
    expect(verifier).toContain("COPY fixtures/");
    // The supplied evaluator, and only it: the Workbench and the starter stay out.
    expect(verifier).toContain("COPY participant/evaluator.py");
    expect(verifier).not.toContain("COPY participant/ ");
    expect(verifier).not.toContain("COPY starter/");
    expect(verifier).not.toContain("COPY reference/");
    expect(verifier).not.toContain("COPY mutation.py");

    const author = stage("author");
    for (const copied of ["COPY verifier/", "COPY tests/hidden/", "COPY reference/", "COPY mutation.py"]) {
      expect(author).toContain(copied);
    }
  });

  it("reproduces the original leak: the participant stage's own files cannot derive root-cause", () => {
    // The point of the split, executed rather than read. Everything the participant
    // stage carries is importable here; `_expected_root_cause` must not be reachable
    // from any of it, and no other module may have grown a copy of the derivation.
    // The file set comes from the Dockerfile's own participant stage, not a list
    // repeated here: a COPY that puts the grader back must make this fail, not pass
    // against a hardcoded set that no longer describes the image.
    const shipped = [...stage("participant").matchAll(/^COPY (\S+)/gm)].map((m) => m[1]);
    expect(shipped.length).toBeGreaterThan(0);
    const probe = String.raw`
import json, pathlib, re, sys
root = pathlib.Path(".").resolve()
shipped = json.loads(sys.argv[1])
sources = []
for entry in shipped:
    path = root / entry
    sources.extend(p for p in ([path] if path.is_file() else sorted(path.rglob("*.py"))))
text = "\n".join(p.read_text(encoding="utf-8") for p in sources)
print(json.dumps({
    "files": sorted(str(p.relative_to(root)) for p in sources),
    "mentionsExpectedRootCause": "_expected_root_cause" in text,
    "importsVerifier": bool(re.search(r"^\s*(from|import)\s+verifier", text, re.M)),
    "definesManipulatedSignals": "manipulatedSignals" in text,
}))
`;
    const result = python(["-c", probe, JSON.stringify(shipped)]);
    expect(result.status).toBe(0);
    const output = JSON.parse(result.stdout.trim().split("\n").at(-1) ?? "{}") as {
      files: string[];
      mentionsExpectedRootCause: boolean;
      importsVerifier: boolean;
      definesManipulatedSignals: boolean;
    };
    expect(output.files.length).toBeGreaterThan(0);
    expect(output.files).not.toContain("verifier/server.py");
    expect(output.mentionsExpectedRootCause).toBe(false);
    expect(output.importsVerifier).toBe(false);
    // The key the grader compares on. Naming it anywhere in the participant file set
    // would mean a second derivation had grown there.
    expect(output.definesManipulatedSignals).toBe(false);
  });

  it("keeps the Portal editor API in the Workbench and grading out of it", () => {
    const workbench = read("local/participant/server.py");
    const grader = read("local/verifier/server.py");
    for (const endpoint of ["/api/config", "/api/inspect", "/api/starter", "/api/test", "/api/prepare"]) {
      expect(workbench).toContain(endpoint);
      expect(grader).not.toContain(endpoint);
    }
    expect(workbench).not.toContain("def evaluate(");
    expect(workbench).not.toContain("def _check_");
    expect(workbench).not.toContain("_expected_root_cause");
    expect(grader).toContain("/verify");
    expect(grader).toContain("/healthz");
  });

  it("proxies /verify to the internal verifier and fails closed when it is unreachable", () => {
    const probe = String.raw`
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
    const result = python(["-c", probe]);
    expect(result.status).toBe(0);
    const output = JSON.parse(result.stdout.trim().split("\n").at(-1) ?? "{}") as {
      missing: Array<{ checkpointId: string; correct: boolean }>;
      unavailable: Array<{ checkpointId: string; correct: boolean }>;
      hasInlineEvaluator: boolean;
    };
    const expectedVerdicts = [
      "build",
      "audit",
      "exploit",
      "root-cause",
      "repair",
      "mutation-transfer",
    ].map((checkpointId) => ({ checkpointId, correct: false }));
    expect(output.missing).toEqual(expectedVerdicts);
    expect(output.unavailable).toEqual(expectedVerdicts);
    expect(output.hasInlineEvaluator).toBe(false);
  });

  it("compose builds the right target per service, publishes only the Workbench, and isolates the verifier", () => {
    const compose = read("local/docker-compose.yml");
    for (const contract of [
      "target: participant",
      "target: verifier",
      '"127.0.0.1:18094:18094"',
      "VERIFIER_URL: http://verifier:18095/verify",
      "read_only: true",
      "no-new-privileges:true",
      "healthcheck:",
      "internal: true",
      'com.docker.network.bridge.enable_ip_masquerade: "false"',
    ]) {
      expect(compose).toContain(contract);
    }
    // The verifier's port is never published: reaching it means going through the
    // Workbench, which does not grade.
    expect(compose).not.toContain('"127.0.0.1:18095:18095"');
    expect(compose.match(/ports:/g)).toHaveLength(1);
  });
});

describe("ac26-w1-underconstraint: root-cause accepts every equally-correct diagnosis (#527)", () => {
  // When `c-iszero-a` is the missing constraint, only B survives, and B never reads
  // `inv` -- so the deployed circuit leaves it completely unconstrained. Any value
  // other than the honest one is an equally valid diagnosis; pinning one canonical
  // number the way the checker used to (#527's second report) rejects correct
  // reasoning as often as it accepts it.
  it("should accept a different, equally valid 'after' value for the signal the deployed circuit never constrains", () => {
    const seed = findSeedForBranch("c-iszero-a");
    const expected = rootCauseAnswerFor(seed);
    expect(expected.missingConstraintId).toBe("c-iszero-a");
    expect(expected.manipulatedSignals).toHaveLength(1);
    expect(expected.manipulatedSignals[0]?.signal).toBe("inv");

    const pScript = [
      "import sys",
      "sys.path.insert(0, '.')",
      "from fixtures.generate import params",
      "print(params(sys.argv[1])['p'])",
    ].join("\n");
    const p = Number(
      spawnSync("python3", ["-c", pScript, seed], { cwd: LOCAL, encoding: "utf8" }).stdout.trim(),
    );
    const before = expected.manipulatedSignals[0]?.before ?? 0;
    const canonicalAfter = expected.manipulatedSignals[0]?.after ?? 0;
    const alternateAfter = [1, 2, 3, 4, 5]
      .map((delta) => (before + delta) % p)
      .find((candidate) => candidate !== before && candidate !== canonicalAfter);
    expect(alternateAfter).toBeDefined();

    // The canonical example still works...
    expect(evaluateWithSeed(seed, "root-cause", JSON.stringify(expected))).toBe(true);
    // ...and so does a different value nobody hard-coded, as long as it actually changed.
    expect(
      evaluateWithSeed(
        seed,
        "root-cause",
        JSON.stringify({
          missingConstraintId: expected.missingConstraintId,
          manipulatedSignals: [{ signal: "inv", before, after: alternateAfter }],
        }),
      ),
    ).toBe(true);
    // Reporting no actual change is not a diagnosis.
    expect(
      evaluateWithSeed(
        seed,
        "root-cause",
        JSON.stringify({
          missingConstraintId: expected.missingConstraintId,
          manipulatedSignals: [{ signal: "inv", before, after: before }],
        }),
      ),
    ).toBe(false);
  }, 60_000);

  // Symmetric check: when `c-iszero-b` is missing, A alone pins `inv` to exactly one
  // value once the false claim fixes `ok = 1` (a field has no zero divisors), so there
  // is no ambiguity here and the widened rule must not swallow a genuinely wrong answer.
  it("should still reject a wrong value for a signal the deployed circuit does pin down", () => {
    const seed = findSeedForBranch("c-iszero-b");
    const expected = rootCauseAnswerFor(seed);
    expect(expected.missingConstraintId).toBe("c-iszero-b");
    const invEntry = expected.manipulatedSignals.find((c) => c.signal === "inv");
    expect(invEntry).toBeDefined();

    expect(evaluateWithSeed(seed, "root-cause", JSON.stringify(expected))).toBe(true);
    const sentinel = (invEntry?.after ?? 0) === 999_999 ? 888_888 : 999_999;
    const wrong = {
      missingConstraintId: expected.missingConstraintId,
      manipulatedSignals: expected.manipulatedSignals.map((c) =>
        c.signal === "inv" ? { ...c, after: sentinel } : c,
      ),
    };
    expect(evaluateWithSeed(seed, "root-cause", JSON.stringify(wrong))).toBe(false);
  }, 60_000);
});

describe("ac26-w1-underconstraint: metadata contracts", () => {
  function metadata() {
    return JSON.parse(read("metadata.json")) as {
      difficulty: number;
      courseAlignment: { week: number; role: string; sources: Array<{ ref: string }> };
      scoring: {
        kind: string;
        checks: Array<{ points: number; hints?: Array<{ penalty: number }> }>;
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

  it("should pin every upstream source to a 40-hex commit sha", () => {
    const { courseAlignment } = metadata();
    expect(courseAlignment.week).toBe(1);
    expect(courseAlignment.role).toBe("assignment-companion");
    expect(courseAlignment.sources.length).toBeGreaterThan(0);
    for (const source of courseAlignment.sources) {
      expect(source.ref).toMatch(/^[0-9a-f]{40}$/);
    }
  });
});
