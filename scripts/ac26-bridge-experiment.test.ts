import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "bun:test";
import { parse as parseYaml } from "yaml";

/**
 * ac26-bridge-experiment is the first problem in the AC26 track, and it is delivered as
 * a container the participant plays from its terminal: `counter show` / `counter predict`
 * / `counter locate` / `counter rule` / `counter transfer` / `counter flag`, one line at a
 * time, no file to edit. The interesting assertions therefore run that CLI for real --
 * including from a working directory that is not the problem root, which is what the
 * portal's terminal does not promise -- rather than reading source text.
 *
 * Being first matters for what is asserted here. A participant meets the terminal, the
 * track's vocabulary, and the shape of a checkpoint all at once in this problem, so the
 * assertions cover not only that the stages grade correctly but that `counter show`
 * carries every command a participant needs and that nothing sends them to a workflow
 * the portal cannot offer.
 *
 * Python 3 is on ubuntu-latest and the problem is stdlib-only.
 */

const ROOT = join(import.meta.dir, "..", "challenges", "ac26-bridge-experiment");
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
  const directory = mkdtempSync(join(tmpdir(), "ac26-bridge-state-"));
  scratch.push(directory);
  return directory;
}

/**
 * Run the CLI the way the portal terminal does: by absolute path, from `/`.
 *
 * The cwd matters. The terminal does not promise to land in `/problem`, and a
 * `counter show` that fails with ImportError because of where the shell started is an
 * unanswerable error message -- especially for someone whose first terminal command this
 * is.
 */
function counter(stateDir: string, seed: string, ...args: string[]) {
  return python([join(LOCAL, "counter.py"), ...args], "/", {
    LAB_STATE_DIR: stateDir,
    FLAG_SEED: seed,
  });
}

interface Answers {
  predict: string[];
  locate: string[];
  rule: string[];
  transfer: string[];
}

/** The answers, from `reference/` -- present in the checkout, absent from the image. */
function referenceAnswers(seed: string): Answers {
  const script = [
    "import json, sys",
    "sys.path.insert(0, '.')",
    "from reference.solve import (locate_arguments, predict_arguments, rule_arguments,",
    "                             transfer_arguments)",
    "seed = sys.argv[1]",
    "print(json.dumps({'predict': predict_arguments(seed), 'locate': locate_arguments(seed),",
    "                  'rule': rule_arguments(seed), 'transfer': transfer_arguments(seed)}))",
  ].join("\n");
  const result = python(["-c", script, seed]);
  expect(result.status).toBe(0);
  return JSON.parse(result.stdout.trim().split("\n").at(-1) as string) as Answers;
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

describe("ac26-bridge-experiment: the files the container is built from", () => {
  it("should ship every file the delivery needs", () => {
    for (const path of [
      "Makefile",
      "metadata.json",
      "README.md",
      "README.ja.md",
      "local/docker-compose.yml",
      "local/Dockerfile",
      "local/counter.py",
      "local/mutation.py",
      "local/fixtures/generate.py",
      "local/lab/expr.py",
      "local/lab/judge.py",
      "local/lab/progress.py",
      "local/tests/public/test_counter.py",
      "local/reference/solve.py",
      "local/verifier/server.py",
    ]) {
      expect(existsSync(join(ROOT, path))).toBe(true);
    }
  });

  it("should have nothing to edit and no hidden suite, since the problem is played from the terminal", () => {
    // Both are artifacts of the shape this problem used to have: a file the learner
    // edited and pasted back. The portal's answer box is one line of text, so that
    // shape could not be submitted from it at all.
    expect(existsSync(join(LOCAL, "starter"))).toBe(false);
    expect(existsSync(join(LOCAL, "tests", "hidden"))).toBe(false);
    expect(existsSync(join(LOCAL, "show.py"))).toBe(false);
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
    expect(read("Makefile")).toContain("IMAGE := ac26-bridge-experiment");
  });
});

describe("ac26-bridge-experiment: container safety", () => {
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

  it("should build the participant stage, not the last one", () => {
    // Without an explicit target, compose builds `author`, which carries reference/.
    const compose = parseYaml(read("local/docker-compose.yml")) as {
      services: Record<string, { build?: { target?: string } }>;
    };
    for (const service of Object.values(compose.services)) {
      expect(service.build?.target).toBe("participant");
    }
    expect(read("Makefile")).toContain("--target participant");
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
    expect(read("local/Dockerfile")).toContain("/usr/local/bin/counter");
  });

  it("should never build a shell command out of participant input", () => {
    for (const file of [
      "local/verifier/server.py",
      "local/counter.py",
      "local/lab/judge.py",
      "local/lab/expr.py",
    ]) {
      const source = read(file);
      expect(source).not.toContain("os.system");
      expect(source).not.toContain("shell=True");
      expect(source).not.toContain("eval(");
    }
  });

  it("should evaluate a submitted rule without handing it to Python", () => {
    // The rule is one line of participant-authored arithmetic. It is parsed and
    // interpreted by lab/expr.py; nothing compiles or execs it.
    const source = read("local/lab/expr.py");
    expect(source).not.toContain("compile(");
    expect(source).not.toContain("exec(");
  });
});

describe("ac26-bridge-experiment: fixtures are seed-derived", () => {
  function fixtures(seed: string): string {
    const script = [
      "import json, sys",
      "sys.path.insert(0, '.')",
      "from fixtures.generate import broken_case, flag, main_case, transfer_case",
      "seed = sys.argv[1]",
      "case, trace, first = broken_case(seed)",
      "print(json.dumps({'main': main_case(seed).as_dict(), 'trace': trace, 'first': first,",
      "                  'transfer': transfer_case(seed).as_dict(), 'flag': flag(seed)}))",
    ].join("\n");
    const result = python(["-c", script, seed]);
    expect(result.status).toBe(0);
    return result.stdout.trim().split("\n").at(-1) as string;
  }

  it("should produce different numbers for different seeds, and the same for the same", () => {
    expect(fixtures("seed-alpha")).not.toBe(fixtures("seed-beta"));
    expect(fixtures("seed-alpha")).toBe(fixtures("seed-alpha"));
  });

  /**
   * The properties that make the stages answerable at all, over many seeds.
   *
   * Every one of these was a real defect during authoring, and none of them shows up as
   * a crash -- they show up as a stage that cannot be cleared, or one whose question is
   * not the question being graded:
   *
   *  - a broken trace that never leaves the window has no answer for `locate`;
   *  - a broken trace that leaves it exactly once makes "the FIRST entry" mean nothing;
   *  - a break at entry 0 gives the participant no honest trace to compare against;
   *  - a `start` at or above the modulus is reduced before the loop, which moves the
   *    break somewhere other than where it was constructed. That one shipped, and was
   *    caught by walking the problem in the container rather than by any assertion.
   */
  it("should keep every broken trace readable across seeds", () => {
    const script = [
      "import json, sys",
      "sys.path.insert(0, '.')",
      "from fixtures.generate import (broken_case, in_window, main_case, transfer_broken_case,",
      "                               transfer_case)",
      "bad = []",
      "for index in range(120):",
      "    seed = 'sweep-%d' % index",
      "    for name, build in (('main', broken_case), ('transfer', transfer_broken_case)):",
      "        case, trace, first = build(seed)",
      "        outside = [i for i, v in enumerate(trace) if not in_window(v, case.modulus)]",
      "        if len(outside) < 2: bad.append([seed, name, 'leaves the window fewer than twice'])",
      "        if not outside or first != outside[0]: bad.append([seed, name, 'wrong first break'])",
      "        if first < 1: bad.append([seed, name, 'breaks at entry 0'])",
      "    for name, build in (('main', main_case), ('transfer', transfer_case)):",
      "        case = build(seed)",
      "        if not 0 <= case.start < case.modulus: bad.append([seed, name, 'start outside window'])",
      "    for name, build in (('main', broken_case), ('transfer', transfer_broken_case)):",
      "        case = build(seed)[0]",
      "        if not 0 <= case.start < case.modulus: bad.append([seed, name, 'start outside window'])",
      "print(json.dumps(bad))",
    ].join("\n");
    const result = python(["-c", script]);
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout.trim().split("\n").at(-1) as string)).toEqual([]);
  }, 60_000);
});

describe("ac26-bridge-experiment: the terminal is the whole interface", () => {
  it("should print usage when run with no arguments", () => {
    const result = counter(state(), SEED);
    expect(result.status).toBe(0);
    for (const command of [
      "counter show",
      "counter predict",
      "counter locate",
      "counter rule",
      "counter transfer",
      "counter flag",
    ]) {
      expect(result.stdout).toContain(command);
    }
  });

  it("should let `show` alone tell a participant what to do next", () => {
    // This is the first problem in the track: whatever `show` does not say, nobody says.
    const result = counter(state(), SEED, "show");
    expect(result.status).toBe(0);
    for (const expected of [
      "the promise",
      "stage 1 of 4",
      "stage 2 of 4",
      "stage 3 of 4",
      "stage 4 of 4",
      "counter predict <number>",
      "counter locate <index>",
      'counter rule "<expression>"',
    ]) {
      expect(result.stdout).toContain(expected);
    }
    expect(result.stdout).not.toContain(expectedFlag(SEED));
  });

  it("should keep the fourth case off the screen until the first three are cleared", () => {
    const result = counter(state(), SEED, "show");
    expect(result.stdout).toContain("locked");
    const script = [
      "import sys",
      "sys.path.insert(0, '.')",
      "from fixtures.generate import transfer_case",
      "print(transfer_case(sys.argv[1]).rendered())",
    ].join("\n");
    const rendered = python(["-c", script, SEED]).stdout.trim();
    expect(rendered.length).toBeGreaterThan(0);
    expect(result.stdout).not.toContain(rendered);
  });

  it("should refuse an unknown command instead of doing something", () => {
    const result = counter(state(), SEED, "solve");
    expect(result.status).not.toBe(0);
    expect(result.stdout).toContain("unknown command");
  });

  it("should explain a malformed answer rather than raising", () => {
    for (const [args, expected] of [
      [["predict", "nine"], "not a whole number"],
      [["locate", "third"], "not a whole number"],
      [["rule", "start step"], "not an expression"],
      [["rule", "start / modulus"], "no division"],
      [["rule"], "no rule given"],
    ] as const) {
      const result = counter(state(), SEED, ...args);
      expect(result.status).not.toBe(0);
      expect(result.stderr).toBe("");
      expect(result.stdout).toContain(expected);
    }
  });

  it("should run identically from a directory that is not the problem root", () => {
    // Every command in this file already runs from `/`; this pins the property itself.
    expect(counter(state(), SEED, "show").status).toBe(0);
  });
});

describe("ac26-bridge-experiment: the four stages and the gates", () => {
  const seeds = ["ci-fixed-seed", "ci-other-seed"] as const;

  it.each(seeds)("should take the reference answers from empty to flag on %s", (seed) => {
    const directory = state();
    const answers = referenceAnswers(seed);
    const run = (...args: string[]) => counter(directory, seed, ...args);

    expect(run("flag").stdout).not.toContain(expectedFlag(seed));
    // The transfer case is refused before the first three, even with the right answer.
    expect(run("transfer", ...answers.transfer).status).not.toBe(0);

    expect(run("predict", ...answers.predict).status).toBe(0);
    expect(run("locate", ...answers.locate).status).toBe(0);
    expect(run("rule", ...answers.rule).status).toBe(0);
    expect(run("flag").stdout).not.toContain(expectedFlag(seed));

    expect(run("transfer", ...answers.transfer).status).toBe(0);
    expect(run("flag").stdout).toContain(expectedFlag(seed));
  }, 120_000);

  it("should withhold the trace from a wrong prediction", () => {
    // The one property that makes predicting mean anything: the answer was not on the
    // screen first. A wrong prediction gets one round worked out, and nothing more.
    const script = [
      "import json, sys",
      "sys.path.insert(0, '.')",
      "from fixtures.generate import final_value, main_case, trace",
      "case = main_case(sys.argv[1])",
      "print(json.dumps({'wrong': (final_value(case) + 1) % case.modulus,",
      "                  'trace': str(trace(case))}))",
    ].join("\n");
    const { wrong, trace } = JSON.parse(
      python(["-c", script, SEED]).stdout.trim().split("\n").at(-1) as string,
    ) as { wrong: number; trace: string };
    const result = counter(state(), SEED, "predict", String(wrong));
    expect(result.status).not.toBe(0);
    expect(result.stdout).not.toContain(trace);
  });

  it("should reject a rule that never brings the value back into the window", () => {
    const result = counter(state(), SEED, "rule", "start + step*rounds");
    expect(result.status).not.toBe(0);
    expect(result.stdout).toContain("REJECTED");
  });

  it("should reject a rule that is this deployment's answer written as a constant", () => {
    // The reason the rule is graded over a family rather than over the visible case.
    const answer = python([
      "-c",
      [
        "import sys",
        "sys.path.insert(0, '.')",
        "from fixtures.generate import final_value, main_case",
        "print(final_value(main_case(sys.argv[1])))",
      ].join("\n"),
      SEED,
    ]).stdout.trim();
    const result = counter(state(), SEED, "rule", answer);
    expect(result.status).not.toBe(0);
    expect(result.stdout).toContain("REJECTED");
  });

  it("should accept any rule that agrees with the counter, not one particular spelling", () => {
    for (const rule of [
      "(start + step*rounds) % modulus",
      "(start % modulus + step*rounds) % modulus",
      "((start + step*rounds) % modulus + modulus) % modulus",
    ]) {
      expect(counter(state(), SEED, "rule", rule).status).toBe(0);
    }
  }, 60_000);

  it("should withhold the flag for every incomplete progress state", () => {
    const stages = ["predict", "locate", "rule", "transfer"];
    for (let mask = 0; mask < (1 << stages.length) - 1; mask += 1) {
      const directory = state();
      const cleared = Object.fromEntries(
        stages.filter((_stage, index) => (mask & (1 << index)) !== 0).map((stage) => [stage, true]),
      );
      writeFileSync(join(directory, "progress.json"), JSON.stringify(cleared));
      const result = counter(directory, SEED, "flag");
      expect(result.status).not.toBe(0);
      expect(result.stdout).not.toContain(expectedFlag(SEED));
    }
  }, 60_000);

  it("should kill every intended defect in the mutation suite", () => {
    const result = python(["mutation.py"]);
    expect(result.stdout).toContain("PASS the reference answers pass");
    expect(result.stdout).toContain("PASS the transfer case is locked");
    expect(result.stdout).not.toContain("SURVIVED");
    expect(result.stdout).not.toContain("FAILED");
    expect(result.status).toBe(0);
  }, 300_000);

  it("should pass its own public self-check", () => {
    const result = python(["tests/public/test_counter.py"]);
    expect(result.stdout).not.toContain("FAIL");
    expect(result.status).toBe(0);
  }, 120_000);
});

describe("ac26-bridge-experiment: /verify contract", () => {
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
    expect(evaluate("TC{bridge_experiment_00000000000000000000}")).toBe(false);
    expect(evaluate("")).toBe(false);
  });

  it("should compare in constant time, so a wrong answer is not an oracle", () => {
    // The platform charges for wrong answers; a timing oracle would make that avoidable.
    expect(read("local/verifier/server.py")).toContain("hmac.compare_digest");
  });

  it("should never restate the expected value in its response", () => {
    const verifier = read("local/verifier/server.py");
    const message = /"message": \(([\s\S]*?)\),/.exec(verifier)?.[1] ?? "";
    expect(message.length).toBeGreaterThan(0);
    expect(message).not.toContain("derive_flag");
    expect(message).not.toContain("FLAG");
  });
});

describe("ac26-bridge-experiment: metadata contracts", () => {
  function metadata() {
    return JSON.parse(read("metadata.json")) as {
      difficulty: number;
      track: { id: string; order: number };
      courseAlignment: { week: number; role: string; sources?: unknown };
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

  it("should score as a single discovered flag at the Easy tier", () => {
    const meta = metadata();
    expect(meta.scoring.kind).toBe("verify");
    expect(meta.difficulty).toBe(1);
    expect(meta.scoring.points).toBe(100);
    expect(meta.scoring.wrongAnswerPenalty).toBe(5);
    const hintPenalty = meta.scoring.hints.reduce((sum, hint) => sum + hint.penalty, 0);
    expect(hintPenalty).toBeLessThanOrEqual(50);
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

  it("should stay the track's first problem, and pin no upstream source", () => {
    // `diagnostic` runs before the material rather than alongside it, so there is no
    // lecture or exercise to cite. CATALOG.md names this problem as the worked example
    // of leaving `sources` out rather than inventing a SHA to fill the field.
    const meta = metadata();
    expect(meta.track.id).toBe("advanced-cryptography-2026");
    expect(meta.track.order).toBe(10);
    expect(meta.courseAlignment.role).toBe("diagnostic");
    expect(meta.courseAlignment.sources).toBeUndefined();
  });
});
