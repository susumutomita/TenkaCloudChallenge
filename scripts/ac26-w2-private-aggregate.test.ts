import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import { parse as parseYaml } from "yaml";
import { participantPythonFiles } from "./lib/local-play-problems";

/**
 * ac26-w2-private-aggregate is Week 2's synthesis problem. The assertions that carry
 * weight run its Python for real, and the sharpest of them cover the two defects that
 * still produce a perfectly correct score — reusing one triple, and opening each
 * multiplication separately. A suite that only checked the answer would pass both.
 * Python 3 is on ubuntu-latest and the problem is stdlib-only.
 */

const ROOT = join(import.meta.dir, "..", "challenges", "ac26-w2-private-aggregate");
const LOCAL = join(ROOT, "local");
const SEED = "ci-fixed-seed";
const CHECKPOINTS = [
  "plan",
  "share-inputs",
  "linear",
  "multiply",
  "result",
  "privacy",
  "cost",
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
  return read(`local/${dir}/aggregate.py`);
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

/** The reference, with every product taking the same triple. Score stays correct. */
function reusingOneTriple(): string {
  const source = bundle("reference").replaceAll(
    "triple = triple_list[index]",
    "triple = triple_list[0]",
  );
  expect(source).not.toContain("triple_list[index]");
  return source;
}

/** The reference, opening each product on its own. Score stays correct; k rounds. */
function openingPerMultiplication(): string {
  const source = bundle("reference").replace(
    "    opened = io.open_batch(to_open)",
    [
      "    opened = []",
      "    for start in range(0, len(to_open), 2):",
      "        opened.extend(io.open_batch(to_open[start : start + 2]))",
    ].join("\n"),
  );
  expect(source).toContain("for start in range(0, len(to_open), 2):");
  return source;
}

describe("ac26-w2-private-aggregate: participant contract", () => {
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
      "local/tests/public/test_aggregate.py",
      "local/tests/hidden/check_aggregate.py",
      "local/verifier/server.py",
      "local/participant/server.py",
      "local/participant/workbench.py",
      "local/participant/protocol.py",
      "local/starter/aggregate.py",
      "local/reference/aggregate.py",
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

describe("ac26-w2-private-aggregate: container safety", () => {
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

describe("ac26-w2-private-aggregate: fixtures are seed-derived", () => {
  it("should produce different settings for different seeds", () => {
    const script = [
      "import json, sys",
      "sys.path.insert(0, '.')",
      "from fixtures.generate import health_token, setting",
      "st = setting(sys.argv[1])",
      "print(json.dumps({'p': st.p, 'n': st.parties, 'c': st.counts, 't': health_token(sys.argv[1])}))",
    ].join("\n");
    const first = python(["-c", script, "seed-alpha"]).stdout.trim();
    const second = python(["-c", script, "seed-beta"]).stdout.trim();
    const again = python(["-c", script, "seed-alpha"]).stdout.trim();

    expect(first).not.toBe(second);
    expect(first).toBe(again);
  });

  it("should vary the organization count across seeds, so k is never assumed", () => {
    const script = [
      "import sys",
      "sys.path.insert(0, '.')",
      "from fixtures.generate import setting",
      "print(','.join(str(setting('s%d' % i).parties) for i in range(40)))",
    ].join("\n");
    const counts = new Set(python(["-c", script]).stdout.trim().split(","));
    expect(counts.size).toBeGreaterThan(2);
  });

  // Reuse is detected by matching opened values against the masks each triple implies.
  // Triples that coincided would make two products indistinguishable and blunt that.
  it("should generate a distinct mask for every triple", () => {
    const script = [
      "import sys",
      "sys.path.insert(0, '.')",
      "from fixtures.generate import reconstruct, setting, triples",
      "bad = 0",
      "for i in range(60):",
      "    st = setting('s%d' % i)",
      "    ts = triples('s%d' % i, 'h0', st, st.parties)",
      "    masks = [reconstruct(list(t.a), st.p) for t in ts]",
      "    if len(set(masks)) != len(masks):",
      "        bad += 1",
      "print(bad)",
    ].join("\n");
    expect(python(["-c", script]).stdout.trim()).toBe("0");
  });

  it("should hold the triple invariant c = a*b in every generated triple", () => {
    const script = [
      "import sys",
      "sys.path.insert(0, '.')",
      "from fixtures.generate import reconstruct, setting, triples",
      "bad = 0",
      "for i in range(40):",
      "    st = setting('s%d' % i)",
      "    for t in triples('s%d' % i, 'h0', st, st.parties):",
      "        a = reconstruct(list(t.a), st.p)",
      "        b = reconstruct(list(t.b), st.p)",
      "        if reconstruct(list(t.c), st.p) != a * b % st.p:",
      "            bad += 1",
      "print(bad)",
    ].join("\n");
    expect(python(["-c", script]).stdout.trim()).toBe("0");
  });
});

describe("ac26-w2-private-aggregate: the problem is solvable and actually fails", () => {
  it("should fail the public tests in the shipped starter state", () => {
    const result = python(["tests/public/test_aggregate.py"]);
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

describe("ac26-w2-private-aggregate: /verify contract", () => {
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

  // The heart of the problem. Both of these are *correct* — the score is right — and
  // both must still fail, each on the specific checkpoint that measures what they broke.
  it("should accept a triple-reusing submission on multiply but reject it on privacy", () => {
    const source = reusingOneTriple();
    expect(evaluate("multiply", source)).toBe(true);
    expect(evaluate("privacy", source)).toBe(false);
  }, 180_000);

  it("should accept a per-multiplication opener on multiply and privacy but reject it on cost", () => {
    const source = openingPerMultiplication();
    expect(evaluate("multiply", source)).toBe(true);
    expect(evaluate("privacy", source)).toBe(true);
    expect(evaluate("cost", source)).toBe(false);
  }, 180_000);

  // The plan is graded against the run, so an estimate that is internally tidy but does
  // not describe what the protocol actually did is still wrong.
  it("should reject a cost claim that does not match the measured run", () => {
    const source = bundle("reference").replace(
      'return {"multiplications": k, "triples": k, "rounds": 1}',
      'return {"multiplications": k, "triples": k, "rounds": k}',
    );
    expect(evaluate("cost", source)).toBe(false);
  }, 120_000);

  it("should reject a submission that opens the running subtotal", () => {
    const source = bundle("reference").replace(
      '    return add_public(total, spec["bias"], p)',
      '    io.open_batch([list(total)])\n    return add_public(total, spec["bias"], p)',
    );
    expect(evaluate("privacy", source)).toBe(false);
  }, 120_000);

  it("should reject a submission that hangs, rather than hanging itself", () => {
    expect(evaluate("plan", "def plan(spec):\n    while True:\n        pass\n")).toBe(false);
  }, 60_000);

  it("should reject a submission that cannot even be imported", () => {
    expect(evaluate("plan", "def plan(:\n")).toBe(false);
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

describe("ac26-w2-private-aggregate: metadata contracts", () => {
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
    expect(meta.difficulty).toBe(5);
    expect(meta.scoring.checks.reduce((sum, check) => sum + check.points, 0)).toBe(300);
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
    expect(courseAlignment.role).toBe("synthesis");
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
 * learner's own `make build` produced. All eight checkpoints are graded by running
 * `tests/hidden/check_aggregate.py` against the submitted file, so the person being
 * graded was shipped the assertions: `check_plan` states the three numbers `plan()` must
 * return, `check_cost` states the round count and the opening count it accepts, and
 * `check_privacy` states the exact multiset a run may reveal. `fixtures/generate.py` was
 * there too, and it derives the secret counts and severities behind `plain_score`.
 *
 * The tests below pin the boundary that fix put in, in the two ways it can be checked
 * without a Docker daemon: the Dockerfile's own COPY lists, and the participant stage's
 * real file list run through the same derivation `check-answer-reachability.ts` uses.
 * Restoring any of the three COPY lines turns them red.
 */

const REPO = join(import.meta.dir, "..");
const DIR = "challenges/ac26-w2-private-aggregate";

describe("ac26-w2-private-aggregate: the participant image carries nothing that grades", () => {
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
    // The supplied opening handle, and only it: `fixtures/generate.py` imports Protocol
    // from here rather than restating it, so the verifier stage needs this one file and
    // must not pull in `participant/server.py` or the Portal support module with it.
    expect(verifierStage).toContain("COPY participant/protocol.py");
    expect(verifierStage).not.toMatch(/^COPY participant\/$/m);
    expect(verifierStage).not.toContain("COPY reference/");
    expect(verifierStage).not.toContain("COPY mutation.py");
  });

  it("reproduces the original leak: no file the participant image carries reaches the derivation or the hidden assertions", () => {
    // The file list comes from the Dockerfile's participant stage, via the same
    // derivation `check-answer-reachability.ts` uses, rather than being restated here --
    // so a COPY that puts `fixtures/` or `tests/hidden/` back fails this test.
    const participantFiles = participantPythonFiles(REPO, DIR);
    expect(participantFiles).not.toContain(`${DIR}/local/fixtures/generate.py`);
    expect(participantFiles).not.toContain(`${DIR}/local/tests/hidden/check_aggregate.py`);
    expect(participantFiles).not.toContain(`${DIR}/local/verifier/server.py`);
    expect(participantFiles).toContain(`${DIR}/local/tests/public/test_aggregate.py`);
    expect(participantFiles).toContain(`${DIR}/local/participant/server.py`);
    expect(participantFiles).toContain(`${DIR}/local/participant/protocol.py`);
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
    // and they did not move: the Workbench answers on 18099 and forwards inward.
    expect(compose.services.workbench.ports).toEqual(["127.0.0.1:18099:18099"]);
    expect(compose.services.verifier.ports).toBeUndefined();
    expect(compose.networks.lab.internal).toBe(true);
    expect(compose.services.verifier.networks).toEqual(["lab"]);
    const runtime = JSON.parse(read("metadata.json")).runtime as { verifyUrl: string };
    expect(runtime.verifyUrl).toBe("http://127.0.0.1:18099/verify");
  });
});

describe("ac26-w2-private-aggregate: what the split does and does not close", () => {
  it("scores zero for a submission that imports the graded material at grading time", () => {
    // Issue 591: `fixtures/` and `tests/hidden/` are on the runner's sys.path because
    // grading needs them, so the guard in verifier/server.py's RUNNER -- not the Docker
    // split -- is what closes this path. Measured, not assumed.
    for (const checkpoint of CHECKPOINTS) {
      expect(evaluate(checkpoint, "from fixtures.generate import *\n")).toBe(false);
    }
  }, 180_000);

  it("scores zero for the module the participant image ships", () => {
    // The other probe: the participant reads what their own container carries and
    // pastes it, so the RUNNER guard -- which only blocks `import` -- is not in the
    // path. The reference passing every checkpoint above is this probe's positive
    // control (docs/AGENT_LOOP_CONSTRAINTS.md §5): the guard-removal control is flat
    // here, because the shipped module defines none of the four names the starter asks
    // for, so without the reference a silently broken probe would report the same zero.
    const shipped = readFileSync(join(LOCAL, "participant", "protocol.py"), "utf8");
    for (const checkpoint of CHECKPOINTS) {
      expect(evaluate(checkpoint, shipped)).toBe(false);
    }
  }, 180_000);
});

describe("ac26-w2-private-aggregate: the public half survives the split", () => {
  it("serves show.py and the public tests every value they used to import", () => {
    const script = [
      "import json, sys",
      "sys.path.insert(0, '.')",
      "from fixtures.generate import public_payload, setting, inputs_shared, triples",
      "from fixtures.generate import health_token, plain_score",
      "seed = sys.argv[1]",
      "payload = public_payload(seed)",
      "st = setting(seed)",
      "shared = inputs_shared(seed, 'public', st)",
      "raw = triples(seed, 'public', st, st.parties)",
      "print(json.dumps({",
      "  'params': payload['params'] == {'p': st.p, 'parties': st.parties, 'bias': st.bias},",
      "  'counts': payload['counts'] == [list(s) for s in shared['counts']],",
      "  'severities': payload['severities'] == [list(s) for s in shared['severities']],",
      "  'triples': payload['triples'] == [",
      "      {'a': list(t.a), 'b': list(t.b), 'c': list(t.c)} for t in raw",
      "  ],",
      "  'health': payload['healthToken'] == health_token(seed),",
      // The seed derivation is the half that must not travel: `plain_score` and the
      // hidden `h0`/`h1`/`h2` settings decide every checkpoint, and the public label's
      // own score is a plain sum of shares the submission already receives.
      "  'withheld': not ({'score', 'secrets', 'counts_plain', 'severities_plain'} & set(payload)),",
      "  'labelled': setting(seed, 'h0').p != st.p or setting(seed, 'h0').counts != st.counts,",
      "  'notScore': plain_score(st) not in payload.values(),",
      "}))",
    ].join("\n");
    const result = python(["-c", script, SEED]);
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout.trim().split("\n").at(-1) ?? "{}")).toEqual({
      params: true,
      counts: true,
      severities: true,
      triples: true,
      health: true,
      withheld: true,
      labelled: true,
      notScore: true,
    });
  });

  it("prints exactly what it printed before the split, on every seed shape", () => {
    // show.py reads `GET /public` now instead of importing `fixtures.generate`. What a
    // learner sees must not have moved with it, so the payload path is compared against
    // the derivation directly across seeds spanning every prime the generator can pick.
    const script = [
      "import json, sys",
      "sys.path.insert(0, '.')",
      "from fixtures.generate import public_payload, setting, inputs_shared, triples",
      "rows = []",
      "primes = set()",
      "for index in range(60):",
      "    seed = 'show-%d' % index",
      "    payload = public_payload(seed)",
      "    st = setting(seed)",
      "    primes.add(st.p)",
      "    shared = inputs_shared(seed, 'public', st)",
      "    raw = triples(seed, 'public', st, st.parties)",
      "    rows.append([",
      "        payload['params']['p'] == st.p,",
      "        payload['params']['parties'] == st.parties,",
      "        payload['params']['bias'] == st.bias,",
      "        payload['counts'][0] == list(shared['counts'][0]),",
      "        payload['severities'][0] == list(shared['severities'][0]),",
      "        payload['triples'][0]['a'] == list(raw[0].a),",
      "        payload['triples'][0]['b'] == list(raw[0].b),",
      "        payload['triples'][0]['c'] == list(raw[0].c),",
      "    ])",
      "print(json.dumps({",
      "  'disagreed': [i for i, row in enumerate(rows) if not all(row)],",
      "  'primes': len(primes),",
      "}))",
    ].join("\n");
    const result = python(["-c", script]);
    expect(result.status).toBe(0);
    const seen = JSON.parse(result.stdout.trim().split("\n").at(-1) ?? "null");
    expect(seen.disagreed).toEqual([]);
    expect(seen.primes).toBe(8);
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
