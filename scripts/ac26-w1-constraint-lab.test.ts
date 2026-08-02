import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "bun:test";
import { parse as parseYaml } from "yaml";

/**
 * ac26-w1-constraint-lab is delivered as a container the participant plays from its
 * terminal: `audit show` / `audit trace` / `audit admit` / `audit transfer` /
 * `audit flag`, one line at a time, no file to edit. The interesting assertions
 * therefore run that CLI for real -- including from a working directory that is not
 * the problem root, which is what the portal's terminal does not promise -- rather
 * than reading source text.
 *
 * Python 3 is on ubuntu-latest and the problem is stdlib-only.
 */

const ROOT = join(import.meta.dir, "..", "challenges", "ac26-w1-constraint-lab");
const LOCAL = join(ROOT, "local");
const SEED = "ci-fixed-seed";

const scratch: string[] = [];
afterAll(() => {
  for (const directory of scratch.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function read(relativePath: string): string {
  return readFileSync(join(ROOT, relativePath), "utf8");
}

function python(args: string[], cwd = LOCAL, env: NodeJS.ProcessEnv = {}) {
  return spawnSync("python3", args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, FLAG_SEED: SEED, PYTHONDONTWRITEBYTECODE: "1", ...env },
    timeout: 300_000,
  });
}

/** A fresh progress directory, so no test inherits another's cleared stages. */
function state(): string {
  const directory = mkdtempSync(join(tmpdir(), "ac26-w1-lab-state-"));
  scratch.push(directory);
  return directory;
}

/**
 * Run the CLI the way the portal terminal does: by absolute path, from `/`.
 *
 * The cwd matters. The terminal does not promise to land in `/problem`, and an
 * `audit show` that fails with ImportError because of where the shell started is an
 * unanswerable error message for a participant.
 */
function audit(stateDir: string, ...args: string[]) {
  return python([join(LOCAL, "audit.py"), ...args], "/", { LAB_STATE_DIR: stateDir });
}

/** The answers, from `reference/` -- present in the checkout, absent from the image. */
function referenceAnswers(seed: string): { live: string[]; admit: string[]; transfer: string[] } {
  const script = [
    "import json, sys",
    "sys.path.insert(0, '.')",
    "from fixtures.generate import LIVE, TRANSFER",
    "from reference.solve import admit_arguments, trace_arguments",
    "seed = sys.argv[1]",
    "print(json.dumps({'live': trace_arguments(seed, LIVE),",
    "                  'admit': admit_arguments(seed),",
    "                  'transfer': trace_arguments(seed, TRANSFER)}))",
  ].join("\n");
  const result = python(["-c", script, seed]);
  expect(result.status).toBe(0);
  return JSON.parse(result.stdout.trim().split("\n").at(-1) as string);
}

function expectedFlag(seed: string): string {
  const result = python([
    "-c",
    "import sys; sys.path.insert(0, '.'); from fixtures.generate import flag; print(flag(sys.argv[1]))",
    seed,
  ]);
  expect(result.status).toBe(0);
  return result.stdout.trim();
}

describe("ac26-w1-constraint-lab: the files the container is built from", () => {
  it("should ship every file the delivery needs", () => {
    for (const path of [
      "Makefile",
      "metadata.json",
      "README.md",
      "README.ja.md",
      "local/docker-compose.yml",
      "local/Dockerfile",
      "local/audit.py",
      "local/mutation.py",
      "local/fixtures/generate.py",
      "local/fixtures/evaluator.py",
      "local/lab/expr.py",
      "local/lab/judge.py",
      "local/lab/progress.py",
      "local/tests/public/test_audit.py",
      "local/reference/solve.py",
      "local/verifier/server.py",
    ]) {
      expect(existsSync(join(ROOT, path))).toBe(true);
    }
  });

  it("should have no starter to edit, since the problem is played from the terminal", () => {
    expect(existsSync(join(LOCAL, "starter"))).toBe(false);
  });

  it("should have no hidden test directory, since the judge is what grades", () => {
    // Grading moved into `lab/judge.py`, which the participant runs in their own
    // terminal against their own answer. A leftover `tests/hidden/` would be a second
    // grader nothing calls.
    expect(existsSync(join(LOCAL, "tests", "hidden"))).toBe(false);
  });

  it("should not send a participant to a make target or a file to edit", () => {
    // The player-facing surface is the portal page and the container terminal. A README
    // or an `instructions` that says `make inspect` describes a workflow the portal has
    // no way to offer, which is what this rebuild exists to remove.
    for (const file of ["README.md", "README.ja.md", "metadata.json"]) {
      const text = read(file);
      expect(text).not.toContain("make inspect");
      expect(text).not.toContain("starter");
    }
  });

  it("should tag its image with its own problem id", () => {
    expect(read("Makefile")).toContain("IMAGE := ac26-w1-constraint-lab");
  });
});

describe("ac26-w1-constraint-lab: container safety", () => {
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

  it("should keep a writable path for the progress file on a read-only container", () => {
    const compose = parseYaml(read("local/docker-compose.yml")) as {
      services: Record<string, { read_only?: boolean; tmpfs?: string[] }>;
    };
    for (const service of Object.values(compose.services)) {
      expect(service.read_only).toBe(true);
      expect(service.tmpfs).toContain("/tmp");
    }
  });

  it("should pin the base image by digest", () => {
    expect(read("local/Dockerfile")).toMatch(/^FROM \S+@sha256:[0-9a-f]{64}( AS \S+)?$/m);
  });

  it("should put the entry point on PATH, since the terminal's cwd is not promised", () => {
    expect(read("local/Dockerfile")).toContain("/usr/local/bin/audit");
  });

  it("should never build a shell command out of participant input", () => {
    for (const file of ["local/verifier/server.py", "local/audit.py", "local/lab/judge.py"]) {
      const source = read(file);
      expect(source).not.toContain("os.system");
      expect(source).not.toContain("shell=True");
      expect(source).not.toContain("eval(");
    }
  });
});

describe("ac26-w1-constraint-lab: fixtures are seed-derived", () => {
  it("should produce different circuits for different seeds", () => {
    const script = [
      "import json, sys",
      "sys.path.insert(0, '.')",
      "from fixtures.generate import CASES, circuit, field_modulus, flag",
      "seed = sys.argv[1]",
      "print(json.dumps({c: [field_modulus(seed, c), circuit(seed, c)] for c in CASES}",
      "                 | {'f': flag(seed)}))",
    ].join("\n");
    const first = python(["-c", script, "seed-alpha"]).stdout.trim();
    const second = python(["-c", script, "seed-beta"]).stdout.trim();
    const again = python(["-c", script, "seed-alpha"]).stdout.trim();

    expect(first).not.toBe(second);
    expect(first).toBe(again);
  });

  it("should give the transfer case a different field from the live one", () => {
    // A shared modulus would let a participant reuse arithmetic they already did, and
    // the transfer stage is the one that has to be answered from scratch.
    const script = [
      "import sys",
      "sys.path.insert(0, '.')",
      "from fixtures.generate import LIVE, TRANSFER, field_modulus",
      "print(sum(field_modulus('s%d' % i, LIVE) == field_modulus('s%d' % i, TRANSFER)",
      "          for i in range(60)))",
    ].join("\n");
    expect(python(["-c", script]).stdout.trim()).toBe("0");
  });

  it("should always need a member or boolean residual to answer the transfer stage", () => {
    // Without this the second circuit is a second helping of the first: the trace would
    // be answerable by copying zeros and the mul residuals, and the gadget the stage
    // exists to transfer would never be evaluated.
    const script = [
      "import sys",
      "sys.path.insert(0, '.')",
      "from fixtures.evaluator import trace",
      "from fixtures.generate import TRANSFER, circuit, failing_witness, field_modulus",
      "bad = []",
      "for i in range(60):",
      "    seed = 's%d' % i",
      "    circ = circuit(seed, TRANSFER)",
      "    residuals = trace(circ, failing_witness(seed, TRANSFER), field_modulus(seed, TRANSFER))",
      "    kinds = {c['kind'] for c, r in zip(circ, residuals) if r != 0}",
      "    if not kinds & {'member', 'boolean'}:",
      "        bad.append(seed)",
      "print(','.join(bad))",
    ].join("\n");
    expect(python(["-c", script]).stdout.trim()).toBe("");
  });
});

describe("ac26-w1-constraint-lab: the terminal is the whole interface", () => {
  it("should print usage when run with no arguments", () => {
    const result = audit(state());
    expect(result.status).toBe(0);
    for (const command of ["audit show", "audit trace", "audit admit", "audit transfer", "audit flag"]) {
      expect(result.stdout).toContain(command);
    }
  });

  it("should describe the deployment without leaking the flag or the trace", () => {
    const result = audit(state(), "show");
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("how to read a constraint");
    expect(result.stdout).toContain("the witness the monitor refused");
    expect(result.stdout).not.toContain(expectedFlag(SEED));
    const answers = referenceAnswers(SEED);
    expect(result.stdout).not.toContain(answers.live[0] as string);
  });

  it("should refuse an unknown command instead of doing something", () => {
    const result = audit(state(), "solve");
    expect(result.status).not.toBe(0);
    expect(result.stdout).toContain("unknown command");
  });

  it("should explain a malformed trace rather than raising", () => {
    const result = audit(state(), "trace", "0,0");
    expect(result.status).not.toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("residuals given");
  });

  it("should refuse a residual that is not an element of the field", () => {
    const result = audit(state(), "trace", "0,0,0,0,-1");
    expect(result.status).not.toBe(0);
    expect(result.stdout).toContain("not an element of the field");
  });

  it("should run identically from a directory that is not the problem root", () => {
    // The portal terminal does not promise a working directory. Asserted by running
    // every command in this file from `/` already; this pins the property itself.
    expect(audit(state(), "show").status).toBe(0);
  });
});

describe("ac26-w1-constraint-lab: the three stages and the gate", () => {
  const seeds = ["ci-fixed-seed", "ci-other-seed"] as const;

  it.each(seeds)("should take the reference answers from empty to flag on %s", (seed) => {
    const directory = state();
    const answers = referenceAnswers(seed);
    const run = (...args: string[]) =>
      python([join(LOCAL, "audit.py"), ...args], "/", {
        LAB_STATE_DIR: directory,
        FLAG_SEED: seed,
      });

    expect(run("flag").stdout).not.toContain(expectedFlag(seed));
    // The transfer circuit is earned: not gradeable, and not even printed, before it.
    expect(run("transfer", ...answers.transfer).status).not.toBe(0);
    expect(run("trace", ...answers.live).status).toBe(0);
    expect(run("admit", ...answers.admit).status).toBe(0);
    expect(run("flag").stdout).not.toContain(expectedFlag(seed));
    expect(run("transfer", ...answers.transfer).status).toBe(0);
    expect(run("flag").stdout).toContain(expectedFlag(seed));
  }, 120_000);

  it("should reject a trace of all zeros, since the witness really was refused", () => {
    const result = audit(state(), "trace", "0,0,0,0,0");
    expect(result.status).not.toBe(0);
    expect(result.stdout).toContain("REJECTED");
  });

  it("should never say which entries of a wrong trace are wrong", () => {
    // Naming them hands over a map of where the mistakes are, and drawing that map is
    // the stage. Not claimed to prevent a scripted search -- see TEMPLATE.md
    // "Assurance scope"; the flag is derivable from FLAG_SEED regardless.
    const result = audit(state(), "trace", "0,0,0,0,0");
    for (const id of ["c0", "c1", "c2", "c3", "c4"]) {
      expect(result.stdout).not.toContain(id);
    }
  });

  it("should reject a membership gadget that admits the whole field", () => {
    expect(audit(state(), "admit", "0").status).not.toBe(0);
  });

  it("should reject a membership gadget that pins only one licensed value", () => {
    const script = [
      "import sys",
      "sys.path.insert(0, '.')",
      "from fixtures.generate import LIVE, allowed_set",
      "print('(tier - %d)' % allowed_set(sys.argv[1], LIVE)[0])",
    ].join("\n");
    const gadget = python(["-c", script, SEED]).stdout.trim();
    const result = audit(state(), "admit", gadget);
    expect(result.status).not.toBe(0);
    expect(result.stdout).toContain("REJECTED");
  });

  it("should lock the transfer circuit until it is earned, rather than omit it", () => {
    // Locked, not absent. The portal terminal has no scrollback and no second page, so
    // a stage that simply is not printed reads as a broken problem.
    const directory = state();
    const script = [
      "import sys",
      "sys.path.insert(0, '.')",
      "from fixtures.generate import TRANSFER, circuit",
      "print(circuit(sys.argv[1], TRANSFER)[0]['id'])",
    ].join("\n");
    const id = python(["-c", script, SEED]).stdout.trim();
    const shown = audit(directory, "show").stdout;
    expect(shown).not.toContain(id);
    expect(shown).toContain("[locked]");
    expect(audit(directory, "explain", id).status).not.toBe(0);
  });

  it("should withhold the flag for every incomplete progress state", () => {
    for (const cleared of [
      { trace: true },
      { admit: true },
      { transfer: true },
      { trace: true, admit: true },
      { trace: true, transfer: true },
      { admit: true, transfer: true },
    ]) {
      const directory = state();
      writeFileSync(join(directory, "progress.json"), JSON.stringify(cleared));
      const result = audit(directory, "flag");
      expect(result.status).not.toBe(0);
      expect(result.stdout).not.toContain(expectedFlag(SEED));
    }
  });

  it("should kill every intended defect in the mutation suite", () => {
    const result = python(["mutation.py"]);
    expect(result.stdout).toContain("PASS the seed set covers every break shape");
    expect(result.stdout).toContain("PASS the fixtures hold");
    expect(result.stdout).not.toContain("SURVIVED");
    expect(result.stdout).not.toContain("FAILED");
    expect(result.status).toBe(0);
  }, 300_000);

  it("should pass its own public self-check", () => {
    const result = python(["tests/public/test_audit.py"]);
    expect(result.stdout).not.toContain("FAIL");
    expect(result.status).toBe(0);
  }, 180_000);
});

describe("ac26-w1-constraint-lab: /verify contract", () => {
  function evaluate(submission: string): boolean {
    const script = [
      "import json, sys",
      "sys.path.insert(0, '.')",
      "from verifier.server import evaluate",
      "print(json.dumps(evaluate(sys.argv[1])))",
    ].join("\n");
    const result = python(["-c", script, submission]);
    expect(result.status).toBe(0);
    return JSON.parse(result.stdout.trim().split("\n").at(-1) ?? "null") === true;
  }

  it("should accept this deployment's flag", () => {
    expect(evaluate(expectedFlag(SEED))).toBe(true);
  });

  it("should accept it with the whitespace a paste carries", () => {
    expect(evaluate(`  ${expectedFlag(SEED)}\n`)).toBe(true);
  });

  it("should reject another deployment's flag", () => {
    expect(evaluate(expectedFlag("some-other-seed"))).toBe(false);
  });

  it("should reject a guess at the flag's shape", () => {
    expect(evaluate("TC{constraint_lab_00000000000000000000}")).toBe(false);
    expect(evaluate("")).toBe(false);
  });

  it("should never restate the expected value in its response", () => {
    const verifier = read("local/verifier/server.py");
    const message = /"message": \(([\s\S]*?)\),/.exec(verifier)?.[1] ?? "";
    expect(message).not.toContain("derive_flag");
    expect(message).not.toContain("FLAG");
  });
});

describe("ac26-w1-constraint-lab: metadata contracts", () => {
  function metadata() {
    return JSON.parse(read("metadata.json")) as {
      difficulty: number;
      courseAlignment: { week: number; role: string; sources: Array<{ ref: string }> };
      runtime: { verifyUrl: string; secretEnv: string[] };
      exposedPorts: Array<{ port: number }>;
      scoring: {
        kind: string;
        points: number;
        wrongAnswerPenalty: number;
        hints: Array<{ id: string; penalty: number }>;
      };
      i18n: { en: { hints: Array<{ id: string }> } };
    };
  }

  it("should score as a single discovered flag at the Medium tier", () => {
    const meta = metadata();
    expect(meta.scoring.kind).toBe("verify");
    expect(meta.difficulty).toBe(3);
    expect(meta.scoring.points).toBe(200);
    expect(meta.scoring.wrongAnswerPenalty).toBe(10);
    const hintPenalty = meta.scoring.hints.reduce((sum, hint) => sum + hint.penalty, 0);
    expect(hintPenalty).toBeLessThanOrEqual(100);
  });

  it("should translate every hint", () => {
    const meta = metadata();
    expect(meta.i18n.en.hints.map((hint) => hint.id)).toEqual(
      meta.scoring.hints.map((hint) => hint.id),
    );
  });

  it("should publish the verify port it advertises", () => {
    const meta = metadata();
    const url = new URL(meta.runtime.verifyUrl);
    expect(url.hostname).toBe("127.0.0.1");
    expect(meta.exposedPorts.map((entry) => String(entry.port))).toContain(url.port);
    expect(meta.runtime.secretEnv).toContain("FLAG_SEED");
  });

  it("should pin every upstream source to a 40-hex commit sha", () => {
    const { courseAlignment } = metadata();
    expect(courseAlignment.week).toBe(1);
    expect(courseAlignment.role).toBe("mechanism");
    expect(courseAlignment.sources.length).toBeGreaterThan(0);
    for (const source of courseAlignment.sources) {
      expect(source.ref).toMatch(/^[0-9a-f]{40}$/);
    }
  });
});
