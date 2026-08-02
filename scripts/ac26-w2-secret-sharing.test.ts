import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "bun:test";
import { parse as parseYaml } from "yaml";

/**
 * ac26-w2-secret-sharing is delivered as a container the participant plays from its
 * terminal: `shares show` / `shares recover` / `shares complete` / `shares refresh` /
 * `shares transfer` / `shares flag`, one line at a time, no file to edit. The
 * interesting assertions therefore run that CLI for real -- including from a working
 * directory that is not the problem root, which is what the portal's terminal does not
 * promise -- rather than reading source text.
 *
 * The fixture sweep below is the part that earns its keep. None of what it checks shows
 * up as a crash; each shows up as a stage that teaches the wrong thing:
 *
 *  - a `known` that does not exceed the modulus makes the reduction in a completion rule
 *    optional on this deployment's own numbers;
 *  - two ledgers with the same total collapse two readings into one;
 *  - a second setting sharing the first's modulus or party count is not a transfer.
 *
 * Python 3 is on ubuntu-latest and the problem is stdlib-only.
 */

const ROOT = join(import.meta.dir, "..", "challenges", "ac26-w2-secret-sharing");
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

/** Evaluate a snippet against the problem's own modules and parse the last line as JSON. */
function evaluatePython<T>(lines: string[], ...args: string[]): T {
  const result = python([
    "-c",
    ["import json, sys", "sys.path.insert(0, '.')", ...lines].join("\n"),
    ...args,
  ]);
  expect(result.stderr).toBe("");
  expect(result.status).toBe(0);
  return JSON.parse(result.stdout.trim().split("\n").at(-1) as string) as T;
}

/** A fresh progress directory, so no test inherits another's cleared stages. */
function state(): string {
  const directory = mkdtempSync(join(tmpdir(), "ac26-sharing-state-"));
  scratch.push(directory);
  return directory;
}

/**
 * Run the CLI the way the portal terminal does: by absolute path, from `/`.
 *
 * The cwd matters. The terminal does not promise to land in `/problem`, and a
 * `shares show` that fails with ImportError because of where the shell started is an
 * unanswerable error message.
 */
function shares(stateDir: string, seed: string, ...args: string[]) {
  return python([join(LOCAL, "shares.py"), ...args], "/", {
    LAB_STATE_DIR: stateDir,
    FLAG_SEED: seed,
  });
}

interface Answers {
  recover: string[];
  complete: string[];
  refresh: string[];
  transfer: string[];
}

/** The answers, from `reference/` -- present in the checkout, absent from the image. */
function referenceAnswers(seed: string): Answers {
  return evaluatePython<Answers>(
    [
      "from reference.solve import (complete_arguments, recover_arguments, refresh_arguments,",
      "                             transfer_arguments)",
      "seed = sys.argv[1]",
      "print(json.dumps({'recover': recover_arguments(seed), 'complete': complete_arguments(seed),",
      "                  'refresh': refresh_arguments(seed), 'transfer': transfer_arguments(seed)}))",
    ],
    seed,
  );
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

describe("ac26-w2-secret-sharing: the files the container is built from", () => {
  it("should ship every file the delivery needs", () => {
    for (const path of [
      "Makefile",
      "metadata.json",
      "README.md",
      "README.ja.md",
      "local/docker-compose.yml",
      "local/Dockerfile",
      "local/shares.py",
      "local/mutation.py",
      "local/fixtures/generate.py",
      "local/lab/expr.py",
      "local/lab/judge.py",
      "local/lab/progress.py",
      "local/tests/public/test_shares.py",
      "local/reference/solve.py",
      "local/verifier/server.py",
    ]) {
      expect(existsSync(join(ROOT, path))).toBe(true);
    }
  });

  it("should have nothing to edit and no hidden suite, since the problem is played from the terminal", () => {
    // Both are artifacts of the shape this problem used to have: a file the learner
    // edited and pasted back. The portal's answer box is one line of text, so that shape
    // could not be submitted from it at all.
    expect(existsSync(join(LOCAL, "starter"))).toBe(false);
    expect(existsSync(join(LOCAL, "tests", "hidden"))).toBe(false);
    expect(existsSync(join(LOCAL, "show.py"))).toBe(false);
  });

  it("should not send a participant to a make target or a file to edit", () => {
    for (const file of ["README.md", "README.ja.md", "metadata.json"]) {
      const text = read(file);
      expect(text).not.toContain("make inspect");
      expect(text).not.toContain("starter");
    }
  });

  it("should tag its image with its own problem id", () => {
    expect(read("Makefile")).toContain("IMAGE := ac26-w2-secret-sharing");
  });

  it("should keep what makes a refresh a refresh inside the judge", () => {
    // The mutation suite breaks `lab/judge.py`. A requirement kept in `fixtures/` is one
    // it cannot reach, and an unreachable requirement is one nothing tests. This one
    // started in the fixtures and had to move.
    expect(read("local/lab/judge.py")).toContain("def zero_sharing_problems");
    expect(read("local/fixtures/generate.py")).not.toContain("def zero_sharing_problems");
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

  it("should build the participant stage, not the last one", () => {
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
    expect(read("local/Dockerfile")).toContain("/usr/local/bin/shares");
  });

  it("should never build a shell command out of participant input", () => {
    for (const file of [
      "local/verifier/server.py",
      "local/shares.py",
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
    // The completion rule is one line of participant-authored arithmetic. It is parsed
    // and interpreted by lab/expr.py; nothing compiles or execs it.
    const source = read("local/lab/expr.py");
    expect(source).not.toContain("compile(");
    expect(source).not.toContain("exec(");
  });
});

describe("ac26-w2-secret-sharing: fixtures are seed-derived", () => {
  function fixtures(seed: string): string {
    const result = python([
      "-c",
      [
        "import json, sys",
        "sys.path.insert(0, '.')",
        "from fixtures.generate import LIVE, TRANSFER, flag, ledger_a, ledger_b, setting, target_value",
        "seed = sys.argv[1]",
        "out = {'flag': flag(seed), 'target': target_value(seed, TRANSFER)}",
        "for name in (LIVE, TRANSFER):",
        "    out[name] = {'setting': setting(seed, name).rendered(),",
        "                 'a': list(ledger_a(seed, name).shares),",
        "                 'b': list(ledger_b(seed, name).visible()),",
        "                 'missing': ledger_b(seed, name).missing}",
        "print(json.dumps(out))",
      ].join("\n"),
      seed,
    ]);
    expect(result.status).toBe(0);
    return result.stdout.trim().split("\n").at(-1) as string;
  }

  it("should produce different ledgers for different seeds, and the same for the same", () => {
    expect(fixtures("seed-alpha")).not.toBe(fixtures("seed-beta"));
    expect(fixtures("seed-alpha")).toBe(fixtures("seed-alpha"));
  });

  it("should hand over settings the four stages can be answered from, on every seed", () => {
    const bad = evaluatePython<string[][]>([
      "from fixtures.generate import (LIVE, TRANSFER, completion_family, family_is_vacuous,",
      "                               ledger_a, ledger_b, setting)",
      "bad = []",
      "for index in range(150):",
      "    seed = 'sweep-%d' % index",
      "    live, second = setting(seed, LIVE), setting(seed, TRANSFER)",
      "    if live.p == second.p: bad.append([seed, 'same modulus'])",
      "    if live.n == second.n: bad.append([seed, 'same party count'])",
      "    for cfg in (live, second):",
      "        a, b = ledger_a(seed, cfg.name), ledger_b(seed, cfg.name)",
      "        if b.known() <= cfg.p: bad.append([seed, cfg.name, 'known not above the modulus'])",
      "        if a.secret == b.secret: bad.append([seed, cfg.name, 'ledgers share a total'])",
      "        if len(b.visible()) != cfg.n - 1: bad.append([seed, cfg.name, 'wrong visible count'])",
      "        if cfg.n < 3: bad.append([seed, cfg.name, 'fewer than three parties'])",
      "    if ledger_b(seed, LIVE).missing != live.n - 1: bad.append([seed, 'live missing moved'])",
      "    if ledger_b(seed, TRANSFER).missing == second.n - 1:",
      "        bad.append([seed, 'second hides the last party too'])",
      "    if family_is_vacuous(completion_family(seed)): bad.append([seed, 'family vacuous'])",
      "print(json.dumps(bad))",
    ]);
    expect(bad).toEqual([]);
  }, 300_000);

  it("should build a completion family that crosses the edges it claims to", () => {
    const missing = evaluatePython<string[]>([
      "from fixtures.generate import completion, completion_family",
      "family = completion_family(sys.argv[1])",
      "checks = {'known = 0': lambda c: c.known == 0,",
      "          'known above the modulus': lambda c: c.known > c.modulus,",
      "          'target below known': lambda c: c.target < c.known,",
      "          'target of zero': lambda c: c.target == 0}",
      "missing = [name for name, ok in checks.items() if not any(ok(c) for c in family)]",
      "if len({c.modulus for c in family}) < 2: missing.append('more than one modulus')",
      "if any(not 0 <= completion(c) < c.modulus for c in family):",
      "    missing.append('a completion outside its own field')",
      "print(json.dumps(missing))",
    ], SEED);
    expect(missing).toEqual([]);
  });
});

describe("ac26-w2-secret-sharing: the terminal is the whole interface", () => {
  it("should print usage when run with no arguments", () => {
    const result = shares(state(), SEED);
    expect(result.status).toBe(0);
    for (const command of [
      "shares show",
      "shares recover",
      "shares complete",
      "shares refresh",
      "shares transfer",
      "shares flag",
    ]) {
      expect(result.stdout).toContain(command);
    }
  });

  it("should let `show` alone tell a participant what to do next", () => {
    const result = shares(state(), SEED, "show");
    expect(result.status).toBe(0);
    for (const expected of [
      "the sharing",
      "stage 1 of 4",
      "stage 2 of 4",
      "stage 3 of 4",
      "stage 4 of 4",
      "shares recover <total>",
      'shares complete "<expression>"',
      "target, known, modulus",
    ]) {
      expect(result.stdout).toContain(expected);
    }
    expect(result.stdout).not.toContain(expectedFlag(SEED));
  });

  it("should print every number a stage needs, including the unreduced sum", () => {
    // Without ledger A on screen `recover` cannot be answered, and without the raw sum
    // the completion rule has no `known` to name.
    const facts = evaluatePython<{ a: number[]; b: number[]; known: number; setting: string }>(
      [
        "from fixtures.generate import LIVE, ledger_a, ledger_b, setting",
        "seed = sys.argv[1]",
        "a, b = ledger_a(seed, LIVE), ledger_b(seed, LIVE)",
        "print(json.dumps({'a': list(a.shares), 'b': list(b.visible()), 'known': b.known(),",
        "                  'setting': setting(seed, LIVE).rendered()}))",
      ],
      SEED,
    );
    const shown = shares(state(), SEED, "show").stdout;
    expect(shown).toContain(JSON.stringify(facts.a).replaceAll(",", ", "));
    expect(shown).toContain(JSON.stringify(facts.b).replaceAll(",", ", "));
    expect(shown).toContain(`known = ${facts.known}`);
    expect(shown).toContain(facts.setting);
  });

  it("should keep the second setting off the screen until the first three are cleared", () => {
    const result = shares(state(), SEED, "show");
    expect(result.stdout).toContain("locked");
    const second = evaluatePython<{ setting: string; a: number[] }>(
      [
        "from fixtures.generate import TRANSFER, ledger_a, setting",
        "seed = sys.argv[1]",
        "print(json.dumps({'setting': setting(seed, TRANSFER).rendered(),",
        "                  'a': list(ledger_a(seed, TRANSFER).shares)}))",
      ],
      SEED,
    );
    expect(result.stdout).not.toContain(second.setting);
    expect(result.stdout).not.toContain(JSON.stringify(second.a).replaceAll(",", ", "));
  });

  it("should refuse an unknown command instead of doing something", () => {
    const result = shares(state(), SEED, "solve");
    expect(result.status).not.toBe(0);
    expect(result.stdout).toContain("unknown command");
  });

  it("should explain a malformed answer rather than raising", () => {
    for (const [args, expected] of [
      [["recover"], "no total given"],
      [["recover", "ninety"], "not a whole number"],
      [["complete"], "no rule given"],
      [["complete", "target known"], "not an expression"],
      [["complete", "target / modulus"], "no division"],
      [["refresh"], "no offsets given"],
      [["refresh", "1 2 3"], "commas and no spaces"],
      [["refresh", "a,b"], "not a whole number"],
    ] as const) {
      const result = shares(state(), SEED, ...args);
      expect(result.status).not.toBe(0);
      expect(result.stderr).toBe("");
      expect(result.stdout).toContain(expected);
    }
  }, 120_000);

  it("should run identically from a directory that is not the problem root", () => {
    expect(shares(state(), SEED, "show").status).toBe(0);
  });
});

describe("ac26-w2-secret-sharing: the four stages and the gate", () => {
  const seeds = ["ci-fixed-seed", "ci-other-seed"] as const;

  it.each(seeds)("should take the reference answers from empty to flag on %s", (seed) => {
    const directory = state();
    const answers = referenceAnswers(seed);
    const run = (...args: string[]) => shares(directory, seed, ...args);

    expect(run("flag").stdout).not.toContain(expectedFlag(seed));
    // The second setting is refused before the first three, even with the right answer.
    expect(run("transfer", ...answers.transfer).status).not.toBe(0);

    expect(run("recover", ...answers.recover).status).toBe(0);
    expect(run("complete", ...answers.complete).status).toBe(0);
    expect(run("refresh", ...answers.refresh).status).toBe(0);
    expect(run("flag").stdout).not.toContain(expectedFlag(seed));

    expect(run("transfer", ...answers.transfer).status).toBe(0);
    expect(run("flag").stdout).toContain(expectedFlag(seed));
  }, 300_000);

  it("should reject a total that was never brought back into the field", () => {
    const raw = evaluatePython<number>([
      "from fixtures.generate import LIVE, ledger_a",
      "print(json.dumps(sum(ledger_a(sys.argv[1], LIVE).shares)))",
    ], SEED);
    const result = shares(state(), SEED, "recover", String(raw));
    expect(result.status).not.toBe(0);
    expect(result.stdout).toContain("before it is brought back");
  });

  it("should reject a completion rule that never reduces, and one written as a constant", () => {
    for (const rule of ["target - known", "target % modulus", "(known - target) % modulus"]) {
      const result = shares(state(), SEED, "complete", rule);
      expect(result.status).not.toBe(0);
      expect(result.stdout).toContain("REJECTED");
    }
    const constant = evaluatePython<number>([
      "from fixtures.generate import completion, completion_family",
      "print(json.dumps(completion(completion_family(sys.argv[1])[0])))",
    ], SEED);
    // The reason the rule is graded over a family rather than over the case on screen.
    expect(shares(state(), SEED, "complete", String(constant)).status).not.toBe(0);
  }, 120_000);

  it("should accept any rule that agrees with the arithmetic, not one spelling", () => {
    for (const rule of [
      "(target - known) % modulus",
      "(target + modulus - known % modulus) % modulus",
      "((target - known) % modulus + modulus) % modulus",
    ]) {
      expect(shares(state(), SEED, "complete", rule).status).toBe(0);
    }
  }, 120_000);

  it("should refuse offsets that sum to zero with a party left where it was", () => {
    // The half of a refresh that a judge which only adds them up would miss.
    const offsets = evaluatePython<string>([
      "from fixtures.generate import LIVE, setting",
      "cfg = setting(sys.argv[1], LIVE)",
      "values = [1] * (cfg.n - 2) + [(-(cfg.n - 2)) % cfg.p, 0]",
      "print(json.dumps(','.join(str(v) for v in values)))",
    ], SEED);
    const result = shares(state(), SEED, "refresh", offsets);
    expect(result.status).not.toBe(0);
    expect(result.stdout).toContain("does not move");
  });

  it("should refuse a zero-sharing built for the wrong number of parties", () => {
    const offsets = evaluatePython<string>([
      "from fixtures.generate import LIVE, setting",
      "cfg = setting(sys.argv[1], LIVE)",
      "values = [1] * cfg.n + [(-cfg.n) % cfg.p]",
      "print(json.dumps(','.join(str(v) for v in values)))",
    ], SEED);
    const result = shares(state(), SEED, "refresh", offsets);
    expect(result.status).not.toBe(0);
    expect(result.stdout).toContain("offsets");
  });

  it("should not credit the first setting's answers on the second one", () => {
    const directory = state();
    const answers = referenceAnswers(SEED);
    for (const [stage, args] of [
      ["recover", answers.recover],
      ["complete", answers.complete],
      ["refresh", answers.refresh],
    ] as const) {
      expect(shares(directory, SEED, stage, ...args).status).toBe(0);
    }
    const live = evaluatePython<{ total: number; refresh: string }>(
      [
        "from fixtures.generate import LIVE, ledger_a",
        "from reference.solve import refresh_arguments",
        "seed = sys.argv[1]",
        "print(json.dumps({'total': ledger_a(seed, LIVE).secret,",
        "                  'refresh': refresh_arguments(seed, LIVE)[0]}))",
      ],
      SEED,
    );
    const result = shares(
      directory,
      SEED,
      "transfer",
      `recover=${live.total}`,
      "complete=0",
      `refresh=${live.refresh}`,
    );
    expect(result.status).not.toBe(0);
    expect(result.stdout).toContain("NOT YET");
  }, 120_000);

  it("should withhold the flag for every incomplete progress state", () => {
    const stages = ["recover", "complete", "refresh", "transfer"];
    for (let mask = 0; mask < (1 << stages.length) - 1; mask += 1) {
      const directory = state();
      const cleared = Object.fromEntries(
        stages.filter((_stage, index) => (mask & (1 << index)) !== 0).map((stage) => [stage, true]),
      );
      writeFileSync(join(directory, "progress.json"), JSON.stringify(cleared));
      const result = shares(directory, SEED, "flag");
      expect(result.status).not.toBe(0);
      expect(result.stdout).not.toContain(expectedFlag(SEED));
    }
  }, 120_000);

  it("should kill every intended defect in the mutation suite", () => {
    const result = python(["mutation.py"]);
    expect(result.stdout).toContain("PASS the reference answers pass");
    expect(result.stdout).toContain("PASS every seed hands over ledgers");
    expect(result.stdout).toContain("PASS the second setting is locked");
    expect(result.stdout).not.toContain("SURVIVED");
    expect(result.stdout).not.toContain("FAILED");
    expect(result.status).toBe(0);
  }, 600_000);

  it("should pass its own public self-check", () => {
    const result = python(["tests/public/test_shares.py"]);
    expect(result.stdout).not.toContain("FAIL");
    expect(result.status).toBe(0);
  }, 300_000);
});

describe("ac26-w2-secret-sharing: /verify contract", () => {
  function evaluate(submission: string): boolean {
    const result = python([
      "-c",
      [
        "import json, sys",
        "sys.path.insert(0, '.')",
        "from verifier.server import evaluate",
        "print(json.dumps(evaluate(sys.argv[1])))",
      ].join("\n"),
      submission,
    ]);
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
    expect(evaluate("TC{w2_secret_sharing_00000000000000000000}")).toBe(false);
    expect(evaluate("")).toBe(false);
  });

  it("should compare in constant time, so a wrong answer is not an oracle", () => {
    expect(read("local/verifier/server.py")).toContain("hmac.compare_digest");
  });

  it("should run no participant code at all", () => {
    // The grading that needs reasoning happened in the participant's own terminal. By the
    // time a string reaches here the only question left is whether it is the flag.
    const verifier = read("local/verifier/server.py");
    for (const forbidden of ["subprocess", "runpy", "importlib", "exec(", "eval(", "compile("]) {
      expect(verifier).not.toContain(forbidden);
    }
  });

  it("should never restate the expected value in its response", () => {
    const verifier = read("local/verifier/server.py");
    const message = /"message": \(([\s\S]*?)\),/.exec(verifier)?.[1] ?? "";
    expect(message.length).toBeGreaterThan(0);
    expect(message).not.toContain("derive_flag");
    expect(message).not.toContain("FLAG");
  });
});

describe("ac26-w2-secret-sharing: metadata contracts", () => {
  function metadata() {
    return JSON.parse(read("metadata.json")) as {
      difficulty: number;
      status: string;
      track: { id: string; order: number };
      courseAlignment: {
        week: number;
        role: string;
        sources: Array<{ ref: string; kind: string; path: string }>;
      };
      runtime: { verifyUrl: string; secretEnv: string[] };
      exposedPorts: Array<{ port: number }>;
      scoring: {
        kind: string;
        points: number;
        wrongAnswerPenalty: number;
        hints: Array<{ id: string; penalty: number }>;
      };
      nodes: { concepts: Array<{ id: string }> };
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

  it("should keep the Week 2 placeholder pin while the material is unpublished", () => {
    // The pin records the ABSENCE of material at that commit. `course:drift` reports
    // PUBLISHED rather than DRIFT the day it appears, which is the whole reason it is
    // there -- and the problem stays draft until that is reconciled.
    const meta = metadata();
    expect(meta.track.order).toBe(210);
    expect(meta.courseAlignment.week).toBe(2);
    expect(meta.courseAlignment.role).toBe("mechanism");
    expect(meta.status).toBe("draft");
    const source = meta.courseAlignment.sources[0];
    expect(source.kind).toBe("placeholder");
    expect(source.path).toBe("week2/README.md");
    expect(source.ref).toMatch(/^[0-9a-f]{40}$/);
  });

  it("should keep declaring the concepts other problems point at", () => {
    // Node ids are globally unique across the catalog, so these two are declared here and
    // nowhere else; ac26-w6-* and ac26-w7-* relations resolve against them.
    const ids = metadata().nodes.concepts.map((concept) => concept.id);
    for (const id of ["concept.additive-secret-sharing", "concept.share-reconstruction"]) {
      expect(ids).toContain(id);
    }
  });
});
