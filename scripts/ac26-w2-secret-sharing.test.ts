import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import { parse as parseYaml } from "yaml";
import { participantPythonFiles } from "./lib/local-play-problems";

/**
 * ac26-w2-secret-sharing is the first Week 1 problem. The interesting assertions run its
 * Python for real — the starter fails, the reference passes every checkpoint, the mutation
 * suite kills every intended defect, and /verify holds its security contract — rather than
 * reading source text. Python 3 is on ubuntu-latest and the problem is stdlib-only.
 */

const ROOT = join(import.meta.dir, "..", "challenges", "ac26-w2-secret-sharing");
const LOCAL = join(ROOT, "local");
const SEED = "ci-fixed-seed";
const SUBMITTED = ["sharing.py"] as const;

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
  return read(`local/${dir}/sharing.py`);
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

describe("ac26-w2-secret-sharing: participant contract", () => {
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
      "local/tests/public/test_sharing.py",
      "local/tests/hidden/check_sharing.py",
      "local/verifier/server.py",
      "local/starter/sharing.py",
      "local/reference/sharing.py",
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

describe("ac26-w2-secret-sharing: container safety", () => {
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

describe("ac26-w2-secret-sharing: fixtures are seed-derived", () => {
  it("should keep the reference split and refresh non-degenerate across 2000 fixture seeds", () => {
    const script = [
      "import json, sys",
      "sys.path.insert(0, 'reference')",
      "import sharing",
      "from tests.hidden import check_sharing",
      "bad = {'share-and-reconstruct': [], 'rerandomize': [], 'transfer': []}",
      "for index in range(2000):",
      "    seed = f'solvability-{index}'",
      "    phases = {",
      "        'share-and-reconstruct': check_sharing.check_roundtrip(sharing, seed)",
      "            + check_sharing.check_no_trivial_split(sharing, seed),",
      "        'rerandomize': check_sharing.check_rerandomize(sharing, seed),",
      "        'transfer': check_sharing.run(sharing, seed + ':transfer'),",
      "    }",
      "    for name, failures in phases.items():",
      "        if failures: bad[name].append([seed, failures])",
      "print(json.dumps({name: rows[:5] for name, rows in bad.items() if rows}))",
    ].join("\n");
    expect(JSON.parse(python(["-c", script]).stdout.trim())).toEqual({});
  });

  it("should produce different circuits for different seeds", () => {
    const script = [
      "import json, sys",
      "sys.path.insert(0, '.')",
      "from fixtures.generate import setting, reference_shares, health_token",
      "seed = sys.argv[1]",
      "print(json.dumps({'s': setting(seed), 'r': reference_shares(seed), 't': health_token(seed)}))",
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
});

describe("ac26-w2-secret-sharing: the problem is solvable and actually fails", () => {
  it("should fail the public tests in the shipped starter state", () => {
    const result = python(["tests/public/test_sharing.py"]);
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

describe("ac26-w2-secret-sharing: /verify contract", () => {
  it.each(["share-and-reconstruct", "hides-the-secret", "rerandomize", "transfer"])(
    "should accept the reference submission on %s",
    (checkpoint) => {
      expect(evaluate(checkpoint, bundle("reference"))).toBe(true);
    },
    120_000,
  );

  it.each(["share-and-reconstruct", "hides-the-secret", "rerandomize", "transfer"])(
    "should reject the starter submission on %s",
    (checkpoint) => {
      expect(evaluate(checkpoint, bundle("starter"))).toBe(false);
    },
    120_000,
  );

  it("should reject a submission that hangs, rather than hanging itself", () => {
    expect(
      evaluate("share-and-reconstruct", "def share(s, n, p, r):\n    while True:\n        pass\n"),
    ).toBe(false);
  }, 60_000);

  it("should reject an unknown checkpoint id instead of crediting it", () => {
    expect(evaluate("finish-week2", bundle("reference"))).toBe(false);
  });

  it("should reject a threshold answer that names the count but shows no witnesses", () => {
    expect(evaluate("threshold", '{"sharesNeeded": 3, "partial": [1, 2], "completions": []}')).toBe(
      false,
    );
  });

  // Two witnesses carrying the SAME secret demonstrate nothing about independence, and
  // are the most likely way to "pass" this checkpoint without understanding it.
  it("should reject two witnesses that agree on the secret", () => {
    const script = [
      "import json, sys",
      "sys.path.insert(0, '.')",
      "from fixtures.generate import setting",
      "cfg = setting(sys.argv[1]); p = cfg['p']; n = cfg['n']",
      "head = [1] * (n - 1)",
      "last = (7 - sum(head)) % p",
      "print(json.dumps({'sharesNeeded': n, 'partial': head, 'completions': [",
      "  {'secret': 7, 'lastShare': last}, {'secret': 7, 'lastShare': last}]}))",
    ].join("\n");
    expect(evaluate("threshold", python(["-c", script, SEED]).stdout.trim())).toBe(false);
  });

  it("should reject an unknown checkpoint id instead of crediting it", () => {
    expect(evaluate("finish-week2", bundle("reference"))).toBe(false);
  });

  it("should reject a root cause that names the wrong constraint", () => {
    expect(
      evaluate("root-cause", '{"missingConstraintId": "c-grant", "manipulatedSignals": []}'),
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

describe("ac26-w2-secret-sharing: metadata contracts", () => {
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

/**
 * Issue 537/538 (Issue 543 option B2). This problem shipped as a single Docker stage
 * that carried `fixtures/`, `tests/hidden/` and `verifier/` in the same image a
 * learner's own `make build` produced. Four of the five checkpoints are graded by
 * running `tests/hidden/check_sharing.py` against the submitted file, so the person
 * being graded was shipped the assertions; `threshold` is decided by `_check_threshold`
 * in `verifier/server.py`, which was there too; and `fixtures/generate.py`'s
 * `reference_shares` builds a correct split of this deployment's secret, which is the
 * `share` half of the first checkpoint.
 *
 * The tests below pin the boundary that fix put in, in the two ways it can be checked
 * without a Docker daemon: the Dockerfile's own COPY lists, and the participant stage's
 * real file list run through the same derivation `check-answer-reachability.ts` uses.
 * Restoring any of the three COPY lines turns them red.
 */

const REPO = join(import.meta.dir, "..");
const DIR = "challenges/ac26-w2-secret-sharing";
const CODE_CHECKPOINTS = [
  "share-and-reconstruct",
  "hides-the-secret",
  "rerandomize",
  "transfer",
] as const;

describe("ac26-w2-secret-sharing: the participant image carries nothing that grades", () => {
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
    expect(participantFiles).not.toContain(`${DIR}/local/tests/hidden/check_sharing.py`);
    expect(participantFiles).not.toContain(`${DIR}/local/verifier/server.py`);
    expect(participantFiles).toContain(`${DIR}/local/tests/public/test_sharing.py`);
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
    // and they did not move: the Workbench answers on 18095 and forwards inward.
    expect(compose.services.workbench.ports).toEqual(["127.0.0.1:18095:18095"]);
    expect(compose.services.verifier.ports).toBeUndefined();
    expect(compose.networks.lab.internal).toBe(true);
    expect(compose.services.verifier.networks).toEqual(["lab"]);
    const runtime = JSON.parse(read("metadata.json")).runtime as { verifyUrl: string };
    expect(runtime.verifyUrl).toBe("http://127.0.0.1:18095/verify");
  });
});

describe("ac26-w2-secret-sharing: what the split does and does not close", () => {
  it("scores zero for a submission that imports the graded material at grading time", () => {
    // Issue 591: `fixtures/` and `tests/hidden/` are on the runner's sys.path because
    // grading needs them, so the guard in verifier/server.py's RUNNER -- not the Docker
    // split -- is what closes this path. Measured, not assumed.
    for (const checkpoint of CODE_CHECKPOINTS) {
      expect(evaluate(checkpoint, "from fixtures.generate import *\n")).toBe(false);
    }
  }, 120_000);

  it("scores zero for the module the participant image ships", () => {
    // The other probe: the participant reads what their own container carries and
    // pastes it, so the RUNNER guard -- which only blocks `import` -- is not in the
    // path. The reference passing every checkpoint above is this probe's positive
    // control (docs/AGENT_LOOP_CONSTRAINTS.md §5): without one, a silently broken probe
    // reports the same zero as a closed problem.
    const shipped = readFileSync(join(LOCAL, "participant", "workbench.py"), "utf8");
    for (const checkpoint of CODE_CHECKPOINTS) {
      expect(evaluate(checkpoint, shipped)).toBe(false);
    }
  }, 120_000);
});

describe("ac26-w2-secret-sharing: the public half survives the split", () => {
  it("serves show.py and the public tests every value they used to import", () => {
    const script = [
      "import json, sys",
      "sys.path.insert(0, '.')",
      "from fixtures.generate import public_payload, setting, reference_shares",
      "from fixtures.generate import share_randomness, rerandomization_randomness",
      "payload = public_payload(sys.argv[1])",
      "cfg = setting(sys.argv[1])",
      "p, n = cfg['p'], cfg['n']",
      "print(json.dumps({",
      "  'params': payload['params'] == {'p': p, 'n': n},",
      "  'secret': payload['secret'] == cfg['secret'],",
      "  'partial': payload['partialShares'] == reference_shares(sys.argv[1])[:-1],",
      "  'share': payload['shareRandomness'] == share_randomness(sys.argv[1], 'public', n - 1, p, cfg['secret']),",
      "  'rr': payload['rerandomizationRandomness'] == rerandomization_randomness(sys.argv[1], 'rr', n - 1, p),",
      "  'withheld': len(payload['partialShares']) == n - 1,",
      "}))",
    ].join("\n");
    const result = python(["-c", script, SEED]);
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout.trim().split("\n").at(-1) ?? "{}")).toEqual({
      params: true,
      secret: true,
      partial: true,
      share: true,
      rr: true,
      withheld: true,
    });
  });

  it("prints exactly what it printed before the split, on every seed shape", () => {
    // show.py reads `GET /public` now instead of importing `fixtures.generate`. What a
    // learner sees must not have moved with it, so the payload path is compared against
    // the derivation directly across seeds spanning both ends of p and n.
    const script = [
      "import json, sys",
      "sys.path.insert(0, '.')",
      "from fixtures.generate import public_payload, setting, reference_shares, share_randomness",
      "rows = []",
      "for index in range(60):",
      "    seed = 'show-%d' % index",
      "    payload = public_payload(seed)",
      "    cfg = setting(seed)",
      "    rows.append([",
      "        payload['params']['p'] == cfg['p'],",
      "        payload['params']['n'] == cfg['n'],",
      "        payload['partialShares'] == reference_shares(seed)[:-1],",
      "        payload['shareRandomness'] == share_randomness(seed, 'public', cfg['n'] - 1, cfg['p'], cfg['secret']),",
      "    ])",
      "print(json.dumps({'disagreed': [i for i, row in enumerate(rows) if not all(row)]}))",
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
});
