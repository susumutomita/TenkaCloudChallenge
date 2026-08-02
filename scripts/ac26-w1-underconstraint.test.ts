import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "bun:test";
import { parse as parseYaml } from "yaml";

/**
 * ac26-w1-underconstraint is delivered as a container the participant plays from its
 * terminal: `circuit show` / `circuit check` / `circuit repair` / `circuit flag`, one
 * line at a time, no file to edit. The interesting assertions therefore run that CLI
 * for real -- including from a working directory that is not the problem root, which
 * is what the portal's terminal does not promise -- rather than reading source text.
 *
 * Python 3 is on ubuntu-latest and the problem is stdlib-only.
 */

const ROOT = join(import.meta.dir, "..", "challenges", "ac26-w1-underconstraint");
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
    timeout: 180_000,
  });
}

/** A fresh progress directory, so no test inherits another's cleared stages. */
function state(): string {
  const directory = mkdtempSync(join(tmpdir(), "ac26-w1-state-"));
  scratch.push(directory);
  return directory;
}

/**
 * Run the CLI the way the portal terminal does: by absolute path, from `/`.
 *
 * The cwd matters. The terminal does not promise to land in `/problem`, and a
 * `circuit show` that fails with ImportError because of where the shell started is an
 * unanswerable error message for a participant.
 */
function circuit(stateDir: string, ...args: string[]) {
  return python([join(LOCAL, "circuit.py"), ...args], "/", { LAB_STATE_DIR: stateDir });
}

/** The answers, from `reference/` -- present in the checkout, absent from the image. */
function referenceAnswers(seed: string): { witness: string[]; repair: string[] } {
  const script = [
    "import json, sys",
    "sys.path.insert(0, '.')",
    "from reference.solve import repair_arguments, witness_arguments",
    "print(json.dumps({'witness': witness_arguments(sys.argv[1]),",
    "                  'repair': repair_arguments(sys.argv[1])}))",
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

describe("ac26-w1-underconstraint: the files the container is built from", () => {
  it("should ship every file the delivery needs", () => {
    for (const path of [
      "Makefile",
      "metadata.json",
      "README.md",
      "README.ja.md",
      "local/docker-compose.yml",
      "local/Dockerfile",
      "local/circuit.py",
      "local/mutation.py",
      "local/fixtures/generate.py",
      "local/fixtures/evaluator.py",
      "local/lab/expr.py",
      "local/lab/judge.py",
      "local/lab/progress.py",
      "local/tests/public/test_circuit.py",
      "local/reference/solve.py",
      "local/verifier/server.py",
    ]) {
      expect(existsSync(join(ROOT, path))).toBe(true);
    }
  });

  it("should have no starter to edit, since the problem is played from the terminal", () => {
    expect(existsSync(join(LOCAL, "starter"))).toBe(false);
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
    expect(read("Makefile")).toContain("IMAGE := ac26-w1-underconstraint");
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
    expect(read("local/Dockerfile")).toContain("/usr/local/bin/circuit");
  });

  it("should never build a shell command out of participant input", () => {
    for (const file of ["local/verifier/server.py", "local/circuit.py", "local/lab/judge.py"]) {
      const source = read(file);
      expect(source).not.toContain("os.system");
      expect(source).not.toContain("shell=True");
      expect(source).not.toContain("eval(");
    }
  });
});

describe("ac26-w1-underconstraint: fixtures are seed-derived", () => {
  it("should produce different circuits for different seeds", () => {
    const script = [
      "import json, sys",
      "sys.path.insert(0, '.')",
      "from fixtures.generate import params, deployed_circuit, flag",
      "seed = sys.argv[1]",
      "print(json.dumps({'p': params(seed), 'c': deployed_circuit(seed), 'f': flag(seed)}))",
    ].join("\n");
    const first = python(["-c", script, "seed-alpha"]).stdout.trim();
    const second = python(["-c", script, "seed-beta"]).stdout.trim();
    const again = python(["-c", script, "seed-alpha"]).stdout.trim();

    expect(first).not.toBe(second);
    expect(first).toBe(again);
  });

  // Both is-zero constraints must actually occur as the dropped one across seeds, or
  // half the exploit logic would never be exercised by any learner.
  it("should drop each of the two is-zero constraints across seeds", () => {
    const script = [
      "import sys",
      "sys.path.insert(0, '.')",
      "from fixtures.generate import dropped_constraint",
      "print(','.join(dropped_constraint('s%d' % i) for i in range(40)))",
    ].join("\n");
    const dropped = new Set(python(["-c", script]).stdout.trim().split(","));
    expect(dropped).toEqual(new Set(["c-iszero-a", "c-iszero-b"]));
  });
});

describe("ac26-w1-underconstraint: the terminal is the whole interface", () => {
  it("should print usage when run with no arguments", () => {
    const result = circuit(state());
    expect(result.status).toBe(0);
    for (const command of ["circuit show", "circuit check", "circuit repair", "circuit flag"]) {
      expect(result.stdout).toContain(command);
    }
  });

  it("should describe the deployment without leaking the flag", () => {
    const result = circuit(state(), "show");
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("the circuit that is deployed");
    expect(result.stdout).toContain("honest witnesses");
    expect(result.stdout).not.toContain(expectedFlag(SEED));
  });

  it("should refuse an unknown command instead of doing something", () => {
    const result = circuit(state(), "solve");
    expect(result.status).not.toBe(0);
    expect(result.stdout).toContain("unknown command");
  });

  it("should explain a malformed witness rather than raising", () => {
    const result = circuit(state(), "check", "revoked=1");
    expect(result.status).not.toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("no value for");
  });

  it("should run identically from a directory that is not the problem root", () => {
    // The portal terminal does not promise a working directory. Asserted by running
    // every command in this file from `/` already; this pins the property itself.
    expect(circuit(state(), "show").status).toBe(0);
  });
});

describe("ac26-w1-underconstraint: the two stages and the gate", () => {
  const seeds = ["ci-fixed-seed", "ci-other-seed"] as const;

  it.each(seeds)("should take the reference answers from empty to flag on %s", (seed) => {
    const directory = state();
    const answers = referenceAnswers(seed);
    const run = (...args: string[]) =>
      python([join(LOCAL, "circuit.py"), ...args], "/", {
        LAB_STATE_DIR: directory,
        FLAG_SEED: seed,
      });

    expect(run("flag").stdout).not.toContain(expectedFlag(seed));
    expect(run("check", ...answers.witness).status).toBe(0);
    expect(run("flag").stdout).not.toContain(expectedFlag(seed));
    expect(run("repair", ...answers.repair).status).toBe(0);
    expect(run("flag").stdout).toContain(expectedFlag(seed));
  }, 60_000);

  it("should reject an honest witness, which asserts nothing false", () => {
    // The near miss the structural definition exists to exclude: satisfying the
    // deployed circuit is only half of an exploit.
    const script = [
      "import sys",
      "sys.path.insert(0, '.')",
      "from fixtures.generate import SIGNALS, honest_witnesses, params",
      "w = honest_witnesses(params(sys.argv[1]))[0]",
      "print(' '.join('%s=%d' % (n, w[n]) for n in SIGNALS))",
    ].join("\n");
    const witness = python(["-c", script, SEED]).stdout.trim().split(" ");
    const result = circuit(state(), "check", ...witness);
    expect(result.status).not.toBe(0);
    expect(result.stdout).toContain("REJECTED");
  });

  it("should reject a repair that adds nothing", () => {
    expect(circuit(state(), "repair", "0").status).not.toBe(0);
  });

  it("should reject a repair that denies an honest holder", () => {
    const result = circuit(state(), "repair", "ok");
    expect(result.status).not.toBe(0);
    expect(result.stdout).toContain("REJECTED");
  });

  it("should reject a repair that adds more than the one constraint that was removed", () => {
    const result = circuit(state(), "repair", "revoked*ok", "revoked*inv + ok - 1");
    expect(result.status).not.toBe(0);
    expect(result.stdout).toContain("REJECTED");
  });

  it("should withhold the flag when only one stage is recorded", () => {
    for (const cleared of [{ check: true }, { repair: true }]) {
      const directory = state();
      writeFileSync(join(directory, "progress.json"), JSON.stringify(cleared));
      const result = circuit(directory, "flag");
      expect(result.status).not.toBe(0);
      expect(result.stdout).not.toContain(expectedFlag(SEED));
    }
  });

  it("should kill every intended defect in the mutation suite", () => {
    const result = python(["mutation.py"]);
    expect(result.stdout).toContain("PASS the seed set covers both drops");
    expect(result.stdout).not.toContain("SURVIVED");
    expect(result.stdout).not.toContain("FAILED");
    expect(result.status).toBe(0);
  }, 180_000);

  it("should pass its own public self-check", () => {
    const result = python(["tests/public/test_circuit.py"]);
    expect(result.stdout).not.toContain("FAIL");
    expect(result.status).toBe(0);
  }, 120_000);
});

describe("ac26-w1-underconstraint: /verify contract", () => {
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
    expect(evaluate("TC{underconstraint_00000000000000000000}")).toBe(false);
    expect(evaluate("")).toBe(false);
  });

  it("should never restate the expected value in its response", () => {
    const verifier = read("local/verifier/server.py");
    const message = /"message": \(([\s\S]*?)\),/.exec(verifier)?.[1] ?? "";
    expect(message).not.toContain("derive_flag");
    expect(message).not.toContain("FLAG");
  });
});

describe("ac26-w1-underconstraint: metadata contracts", () => {
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

  it("should score as a single discovered flag at the Hard tier", () => {
    const meta = metadata();
    expect(meta.scoring.kind).toBe("verify");
    expect(meta.difficulty).toBe(4);
    expect(meta.scoring.points).toBe(300);
    expect(meta.scoring.wrongAnswerPenalty).toBe(15);
    const hintPenalty = meta.scoring.hints.reduce((sum, hint) => sum + hint.penalty, 0);
    expect(hintPenalty).toBeLessThanOrEqual(150);
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
    expect(courseAlignment.role).toBe("assignment-companion");
    expect(courseAlignment.sources.length).toBeGreaterThan(0);
    for (const source of courseAlignment.sources) {
      expect(source.ref).toMatch(/^[0-9a-f]{40}$/);
    }
  });
});
