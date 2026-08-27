import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import { parse as parseYaml } from "yaml";
import { participantPythonFiles } from "./lib/local-play-problems";

/**
 * ac26-w2-beaver-mul is the third Week 2 problem. The interesting assertions run its
 * Python for real — the starter fails, the reference passes every checkpoint, the mutation
 * suite kills every intended defect, and the near-miss answer that folds the public scalar
 * into every share is rejected — rather than reading source text. Python 3 is on
 * ubuntu-latest and the problem is stdlib-only.
 */

const ROOT = join(import.meta.dir, "..", "challenges", "ac26-w2-beaver-mul");
const LOCAL = join(ROOT, "local");
const SEED = "ci-fixed-seed";
const CHECKPOINTS = ["mask", "open", "combine", "protocol", "transfer"] as const;

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
  return read(`local/${dir}/beaver.py`);
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

describe("ac26-w2-beaver-mul: participant contract", () => {
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
      "local/tests/public/test_beaver.py",
      "local/tests/hidden/check_beaver.py",
      "local/verifier/server.py",
      "local/participant/server.py",
      "local/participant/workbench.py",
      "local/starter/beaver.py",
      "local/reference/beaver.py",
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

describe("ac26-w2-beaver-mul: container safety", () => {
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

describe("ac26-w2-beaver-mul: fixtures are seed-derived", () => {
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

  // If d or e were zero, d*e would vanish and folding the public scalar into every share
  // would be indistinguishable from folding it into one. The generator forces both
  // non-zero; asserting it here stops a later "simplification" from silently reopening
  // the hole, because the wrong answer would then grade as correct.
  it("should never generate a setting where the masked difference vanishes", () => {
    const script = [
      "import sys",
      "sys.path.insert(0, '.')",
      "from fixtures.generate import setting",
      "bad = 0",
      "for i in range(200):",
      "    cfg = setting('s%d' % i)",
      "    p = cfg['p']",
      "    if (cfg['x'] - cfg['a']) % p == 0 or (cfg['y'] - cfg['b']) % p == 0:",
      "        bad += 1",
      "print(bad)",
    ].join("\n");
    expect(python(["-c", script]).stdout.trim()).toBe("0");
  });

  it("should hold the triple invariant c = a*b in every generated setting", () => {
    const script = [
      "import sys",
      "sys.path.insert(0, '.')",
      "from fixtures.generate import setting",
      "bad = [i for i in range(200)",
      "       if setting('s%d' % i)['c'] != (setting('s%d' % i)['a'] * setting('s%d' % i)['b'])",
      "       % setting('s%d' % i)['p']]",
      "print(len(bad))",
    ].join("\n");
    expect(python(["-c", script]).stdout.trim()).toBe("0");
  });
});

describe("ac26-w2-beaver-mul: the problem is solvable and actually fails", () => {
  it("should fail the public tests in the shipped starter state", () => {
    const result = python(["tests/public/test_beaver.py"]);
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

describe("ac26-w2-beaver-mul: /verify contract", () => {
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

  // The near miss this whole problem is built around: correct in every respect except
  // that the public scalar d*e is folded into every share, giving x*y + (n-1)*d*e.
  it("should reject a combine that folds the public scalar into every share", () => {
    const source = bundle("reference")
      .replace("out[0] = (out[0] + d * e) % p", "out = [(v + d * e) % p for v in out]")
      .replace("    return out", "    return out");
    expect(source).toContain("(v + d * e)");
    expect(evaluate("combine", source)).toBe(false);
  }, 120_000);

  // Preprocessing moves work offline; it does not remove the round. A submission that is
  // otherwise perfect must still fail the checkpoint that asks for the round count.
  it("should reject a protocol answer claiming a Beaver multiplication is silent", () => {
    const source = bundle("reference").replace("    return 1", "    return 0");
    expect(source).toContain("return 0");
    expect(evaluate("protocol", source)).toBe(false);
  }, 120_000);

  // `transfer` runs the whole suite under a seed the participant has never been shown, so
  // an answer that hard-codes the setting it was handed cannot survive it.
  it("should reject a submission hard-coded to one setting on transfer", () => {
    const script = [
      "import json, sys",
      "sys.path.insert(0, '.')",
      "from fixtures.generate import setting",
      "cfg = setting(sys.argv[1])",
      "print(json.dumps({'p': cfg['p'], 'n': cfg['n']}))",
    ].join("\n");
    const parse = (seed: string) =>
      JSON.parse(python(["-c", script, seed]).stdout.trim()) as { p: number; n: number };
    const { p, n } = parse(SEED);
    // The seed is fixed, so this is a deterministic precondition rather than a chance
    // one: if the transfer setting happened to match, the submission below would not be
    // hard-coded to anything and the assertion would pass vacuously.
    expect(parse(`${SEED}:transfer`)).not.toEqual({ p, n });
    const source = [
      "def mask(value_shares, mask_shares, p):",
      `    return [(v - m) % ${p} for v, m in zip(value_shares, mask_shares)]`,
      "def open_value(shares, p):",
      `    return sum(shares) % ${p}`,
      "def combine(c_shares, a_shares, b_shares, d, e, p):",
      `    out = [(c + d * b + e * a) % ${p}`,
      "           for c, a, b in zip(c_shares, a_shares, b_shares)]",
      `    out[0] = (out[0] + d * e) % ${p}`,
      `    return out[:${n}]`,
      "def rounds():",
      "    return 1",
    ].join("\n");
    expect(evaluate("transfer", source)).toBe(false);
  }, 120_000);

  it("should reject a submission that hangs, rather than hanging itself", () => {
    expect(
      evaluate("mask", "def mask(a, b, p):\n    while True:\n        pass\n"),
    ).toBe(false);
  }, 60_000);

  it("should reject a submission that cannot even be imported", () => {
    expect(evaluate("mask", "def mask(:\n")).toBe(false);
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

describe("ac26-w2-beaver-mul: metadata contracts", () => {
  function metadata() {
    return JSON.parse(read("metadata.json")) as {
      difficulty: number;
      status: string;
      courseAlignment: { week: number; role: string; sources?: Array<{ ref: string }> };
      scoring: {
        kind: string;
        checks: Array<{ id: string; points: number; hints?: Array<{ penalty: number }> }>;
      };
    };
  }

  it("should total the Medium tier's 200 points across its checkpoints", () => {
    const meta = metadata();
    expect(meta.scoring.kind).toBe("multi-verify");
    expect(meta.difficulty).toBe(3);
    expect(meta.scoring.checks.reduce((sum, check) => sum + check.points, 0)).toBe(200);
    // SCORING.md caps hints per checkpoint, not across the problem: no single checkpoint
    // may be worth less than half its points once every hint on it is opened.
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
 * learner's own `make build` produced. Every one of the five checkpoints is graded by
 * running `tests/hidden/check_beaver.py` against the submitted file, so the person being
 * graded was shipped the assertions -- `check_combine` names the folding rule the whole
 * problem asks them to derive, and `check_rounds` states its acceptance rule outright.
 * `fixtures/generate.py` was there too, and its `setting()` returns x, y, a, b and c in
 * the clear, which is enough to build a sharing of the product without running the
 * protocol at all.
 *
 * The tests below pin the boundary that fix put in, in the two ways it can be checked
 * without a Docker daemon: the Dockerfile's own COPY lists, and the participant stage's
 * real file list run through the same derivation `check-answer-reachability.ts` uses.
 * Restoring any of the three COPY lines turns them red.
 */

const REPO = join(import.meta.dir, "..");
const DIR = "challenges/ac26-w2-beaver-mul";

describe("ac26-w2-beaver-mul: the participant image carries nothing that grades", () => {
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
    expect(participantFiles).not.toContain(`${DIR}/local/tests/hidden/check_beaver.py`);
    expect(participantFiles).not.toContain(`${DIR}/local/verifier/server.py`);
    expect(participantFiles).toContain(`${DIR}/local/tests/public/test_beaver.py`);
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
    // and they did not move: the Workbench answers on 18097 and forwards inward.
    expect(compose.services.workbench.ports).toEqual(["127.0.0.1:18097:18097"]);
    expect(compose.services.verifier.ports).toBeUndefined();
    expect(compose.networks.lab.internal).toBe(true);
    expect(compose.services.verifier.networks).toEqual(["lab"]);
    const runtime = JSON.parse(read("metadata.json")).runtime as { verifyUrl: string };
    expect(runtime.verifyUrl).toBe("http://127.0.0.1:18097/verify");
  });
});

describe("ac26-w2-beaver-mul: what the split does and does not close", () => {
  it("scores zero for a submission that imports the graded material at grading time", () => {
    // Issue 591: `fixtures/` and `tests/hidden/` are on the runner's sys.path because
    // grading needs them, so the guard in verifier/server.py's RUNNER -- not the Docker
    // split -- is what closes this path. Measured, not assumed.
    for (const checkpoint of CHECKPOINTS) {
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
    for (const checkpoint of CHECKPOINTS) {
      expect(evaluate(checkpoint, shipped)).toBe(false);
    }
  }, 120_000);
});

describe("ac26-w2-beaver-mul: the public half survives the split", () => {
  it("serves show.py and the public tests every value they used to import", () => {
    const script = [
      "import json, sys",
      "sys.path.insert(0, '.')",
      "from fixtures.generate import public_payload, setting, shares_of, triple_shares",
      "from fixtures.generate import health_token",
      "payload = public_payload(sys.argv[1])",
      "cfg = setting(sys.argv[1])",
      "p, n = cfg['p'], cfg['n']",
      "print(json.dumps({",
      "  'params': payload['params'] == {'p': p, 'n': n},",
      "  'x': payload['x'] == cfg['x'],",
      "  'a': payload['a'] == cfg['a'],",
      "  'triple': payload['triple'] == triple_shares(sys.argv[1], 'public'),",
      "  'xShares': payload['xShares'] == shares_of(sys.argv[1], 'public-x', cfg['x'], n, p),",
      "  'health': payload['healthToken'] == health_token(sys.argv[1]),",
      // y, b and c are the half that must not travel: with y in hand a learner could
      // name this deployment's product without deriving the protocol.
      "  'withheld': not ({'y', 'b', 'c'} & set(payload)),",
      "}))",
    ].join("\n");
    const result = python(["-c", script, SEED]);
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout.trim().split("\n").at(-1) ?? "{}")).toEqual({
      params: true,
      x: true,
      a: true,
      triple: true,
      xShares: true,
      health: true,
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
      "from fixtures.generate import public_payload, setting, shares_of, triple_shares",
      "rows = []",
      "for index in range(60):",
      "    seed = 'show-%d' % index",
      "    payload = public_payload(seed)",
      "    cfg = setting(seed)",
      "    rows.append([",
      "        payload['params']['p'] == cfg['p'],",
      "        payload['params']['n'] == cfg['n'],",
      "        payload['triple'] == triple_shares(seed, 'public'),",
      "        payload['xShares'] == shares_of(seed, 'public-x', cfg['x'], cfg['n'], cfg['p']),",
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
