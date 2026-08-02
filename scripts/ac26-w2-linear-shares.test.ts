import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "bun:test";
import { parse as parseYaml } from "yaml";

/**
 * ac26-w2-linear-shares is delivered as a container the participant plays from its
 * terminal: `shares show` / `shares row` / `shares total` / `shares silent` /
 * `shares transfer` / `shares flag`, one line at a time, no file to edit. The
 * interesting assertions therefore run that CLI for real -- including from a working
 * directory that is not the problem root, which is what the portal's terminal does
 * not promise -- rather than reading source text.
 *
 * Python 3 is on ubuntu-latest and the problem is stdlib-only.
 */

const ROOT = join(import.meta.dir, "..", "challenges", "ac26-w2-linear-shares");
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
    timeout: 600_000,
  });
}

/** A fresh progress directory, so no test inherits another's cleared stages. */
function state(): string {
  const directory = mkdtempSync(join(tmpdir(), "ac26-w2-shares-state-"));
  scratch.push(directory);
  return directory;
}

/**
 * Run the CLI the way the portal terminal does: by absolute path, from `/`.
 *
 * The cwd matters. The terminal does not promise to land in `/problem`, and a
 * `shares show` that fails with ImportError because of where the shell started is an
 * unanswerable error message for a participant.
 */
function shares(stateDir: string, ...args: string[]) {
  return python([join(LOCAL, "shares.py"), ...args], "/", { LAB_STATE_DIR: stateDir });
}

interface Answers {
  readonly row: string;
  readonly total: string;
  readonly silent: string;
  readonly transfer: string[];
}

/** The answers, from `reference/` -- present in the checkout, absent from the image. */
function referenceAnswers(seed: string): Answers {
  const script = [
    "import json, sys",
    "sys.path.insert(0, '.')",
    "from reference.solve import live_arguments, transfer_arguments",
    "seed = sys.argv[1]",
    "live = live_arguments(seed)",
    "print(json.dumps({'row': live['row'][0], 'total': live['total'][0],",
    "                  'silent': live['silent'][0],",
    "                  'transfer': transfer_arguments(seed)}))",
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

describe("ac26-w2-linear-shares: the files the container is built from", () => {
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
      "local/lab/judge.py",
      "local/lab/progress.py",
      "local/tests/public/test_shares.py",
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
    expect(read("Makefile")).toContain("IMAGE := ac26-w2-linear-shares");
  });
});

describe("ac26-w2-linear-shares: container safety", () => {
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

  it("should build the participant stage, not the one carrying the answers", () => {
    const compose = parseYaml(read("local/docker-compose.yml")) as {
      services: Record<string, { build?: { target?: string } }>;
    };
    for (const service of Object.values(compose.services)) {
      expect(service.build?.target).toBe("participant");
    }
    expect(read("Makefile")).toContain("docker build --target participant");
  });

  it("should pin the base image by digest", () => {
    expect(read("local/Dockerfile")).toMatch(/^FROM \S+@sha256:[0-9a-f]{64}( AS \S+)?$/m);
  });

  it("should put the entry point on PATH, since the terminal's cwd is not promised", () => {
    expect(read("local/Dockerfile")).toContain("/usr/local/bin/shares");
  });

  it("should never build a shell command out of participant input", () => {
    for (const file of ["local/verifier/server.py", "local/shares.py", "local/lab/judge.py"]) {
      const source = read(file);
      expect(source).not.toContain("os.system");
      expect(source).not.toContain("shell=True");
      expect(source).not.toContain("eval(");
    }
  });
});

describe("ac26-w2-linear-shares: fixtures are seed-derived", () => {
  it("should produce a different desk for a different seed", () => {
    const script = [
      "import json, sys",
      "sys.path.insert(0, '.')",
      "from fixtures.generate import CASES, expressions, field_modulus, flag, party_count",
      "from fixtures.generate import correct_row, correct_total, published_total, your_index",
      "seed = sys.argv[1]",
      "print(json.dumps({c: [field_modulus(seed, c), party_count(seed, c), your_index(seed, c),",
      "                      correct_row(seed, c), correct_total(seed, c), published_total(seed, c),",
      "                      [r['id'] + r['text'] for r in expressions(seed, c)]] for c in CASES}",
      "                 | {'f': flag(seed)}))",
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
      "from fixtures.generate import LIVE, party_count",
      "print(','.join(str(party_count('s%d' % i, LIVE)) for i in range(40)))",
    ].join("\n");
    const counts = new Set(python(["-c", script]).stdout.trim().split(","));
    expect(counts.size).toBeGreaterThan(2);
  });

  it("should give the second desk a different field from the first", () => {
    const script = [
      "import sys",
      "sys.path.insert(0, '.')",
      "from fixtures.generate import LIVE, TRANSFER, field_modulus",
      "print(sum(field_modulus('s%d' % i, LIVE) == field_modulus('s%d' % i, TRANSFER)",
      "          for i in range(60)))",
    ].join("\n");
    expect(python(["-c", script]).stdout.trim()).toBe("0");
  });

  it("should never make the live participant the party that folds the constant in", () => {
    // Without this the live `row` stage would ask for the constant, and the reflex the
    // problem is built around ("everyone adds it") would be right on the first try. The
    // transfer case is the mirror image, which is what makes it a transfer.
    const script = [
      "import sys",
      "sys.path.insert(0, '.')",
      "from fixtures.generate import LIVE, TRANSFER, designated_party, your_index",
      "live = [i for i in range(60)",
      "        if your_index('s%d' % i, LIVE) == designated_party('s%d' % i, LIVE)]",
      "away = [i for i in range(60)",
      "        if your_index('s%d' % i, TRANSFER) != designated_party('s%d' % i, TRANSFER)]",
      "print(len(live), len(away))",
    ].join("\n");
    expect(python(["-c", script]).stdout.trim()).toBe("0 0");
  });

  it("should make the first desk's correction wrong at the second desk", () => {
    // The anti-memorisation property. The two desks are faulty in opposite directions,
    // so `published - (n-1)*c` -- the whole of the live `total` stage -- never answers
    // the transfer one. Losing this turns the transfer stage into arithmetic practice.
    const script = [
      "import sys",
      "sys.path.insert(0, '.')",
      "from fixtures.generate import TRANSFER, correct_total, field_modulus, party_count",
      "from fixtures.generate import publics, published_total",
      "bad = []",
      "for i in range(60):",
      "    seed = 's%d' % i",
      "    p, n = field_modulus(seed, TRANSFER), party_count(seed, TRANSFER)",
      "    c = publics(seed, TRANSFER)['c']",
      "    if (published_total(seed, TRANSFER) - (n - 1) * c) % p == correct_total(seed, TRANSFER):",
      "        bad.append(seed)",
      "print(','.join(bad))",
    ].join("\n");
    expect(python(["-c", script]).stdout.trim()).toBe("");
  });

  it("should list both kinds of expression at both desks", () => {
    // A classification that is all of one kind is answered by a shrug.
    const script = [
      "import sys",
      "sys.path.insert(0, '.')",
      "from fixtures.generate import CASES, expressions, local_ids",
      "bad = []",
      "for i in range(60):",
      "    seed = 's%d' % i",
      "    for case in CASES:",
      "        listed = expressions(seed, case)",
      "        if not 1 <= len(local_ids(seed, case)) < len(listed):",
      "            bad.append(seed + '/' + case)",
      "print(','.join(bad))",
    ].join("\n");
    expect(python(["-c", script]).stdout.trim()).toBe("");
  });
});

describe("ac26-w2-linear-shares: the terminal is the whole interface", () => {
  it("should print usage when run with no arguments", () => {
    const result = shares(state());
    expect(result.status).toBe(0);
    for (const command of [
      "shares show",
      "shares row",
      "shares total",
      "shares silent",
      "shares transfer",
      "shares flag",
    ]) {
      expect(result.stdout).toContain(command);
    }
  });

  it("should describe the deployment without leaking the flag", () => {
    const result = shares(state(), "show");
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("who you are");
    expect(result.stdout).toContain("the desk's run sheet");
    expect(result.stdout).toContain("the operations queue");
    expect(result.stdout).not.toContain(expectedFlag(SEED));
  });

  it("should name the literal next command for every open stage", () => {
    // The portal shows a short brief and then hands over a shell, so whatever `show`
    // does not say, nobody says.
    const stdout = shares(state(), "show").stdout;
    for (const command of ["shares row <number>", "shares total <number>", "shares silent <ids>"]) {
      expect(stdout).toContain(command);
    }
  });

  it("should refuse an unknown command instead of doing something", () => {
    const result = shares(state(), "solve");
    expect(result.status).not.toBe(0);
    expect(result.stdout).toContain("unknown command");
  });

  it("should refuse a row that is not an element of the field", () => {
    const result = shares(state(), "row", "-1");
    expect(result.status).not.toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("not an element of the field");
  });

  it("should explain a malformed classification rather than raising", () => {
    const result = shares(state(), "silent", "e99");
    expect(result.status).not.toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("not one of the expressions");
  });

  it("should run identically from a directory that is not the problem root", () => {
    // Asserted by running every command in this file from `/` already; this pins the
    // property itself.
    expect(shares(state(), "show").status).toBe(0);
  });
});

describe("ac26-w2-linear-shares: the four stages and the gate", () => {
  const seeds = ["ci-fixed-seed", "ci-other-seed"] as const;

  it.each(seeds)("should take the reference answers from empty to flag on %s", (seed) => {
    const directory = state();
    const answers = referenceAnswers(seed);
    const run = (...args: string[]) =>
      python([join(LOCAL, "shares.py"), ...args], "/", {
        LAB_STATE_DIR: directory,
        FLAG_SEED: seed,
      });

    expect(run("flag").stdout).not.toContain(expectedFlag(seed));
    // The second desk is earned: not gradeable, and not even printed, before it.
    expect(run("transfer", ...answers.transfer).status).not.toBe(0);
    expect(run("row", answers.row).status).toBe(0);
    expect(run("total", answers.total).status).toBe(0);
    expect(run("silent", answers.silent).status).toBe(0);
    expect(run("flag").stdout).not.toContain(expectedFlag(seed));
    expect(run("transfer", ...answers.transfer).status).toBe(0);
    expect(run("flag").stdout).toContain(expectedFlag(seed));
  }, 120_000);

  it("should reject the row that folds the public constant in at every party", () => {
    // The near miss the whole problem is built around. The live participant is not the
    // designated party, so a row carrying `c` is the reflex being corrected.
    const script = [
      "import sys",
      "sys.path.insert(0, '.')",
      "from fixtures.generate import LIVE, correct_row, field_modulus, publics",
      "seed = sys.argv[1]",
      "p = field_modulus(seed, LIVE)",
      "print((correct_row(seed, LIVE) + publics(seed, LIVE)['c']) % p)",
    ].join("\n");
    const wrong = python(["-c", script, SEED]).stdout.trim();
    const result = shares(state(), "row", wrong);
    expect(result.status).not.toBe(0);
    expect(result.stdout).toContain("NOT YET");
  });

  it("should reject the number the desk published as the corrected total", () => {
    const script = [
      "import sys",
      "sys.path.insert(0, '.')",
      "from fixtures.generate import LIVE, published_total",
      "print(published_total(sys.argv[1], LIVE))",
    ].join("\n");
    const published = python(["-c", script, SEED]).stdout.trim();
    const result = shares(state(), "total", published);
    expect(result.status).not.toBe(0);
    expect(result.stdout).toContain("the desk published");
  });

  it("should reject a classification that calls every expression local", () => {
    const script = [
      "import sys",
      "sys.path.insert(0, '.')",
      "from fixtures.generate import LIVE, expressions",
      "print(','.join(str(r['id']) for r in expressions(sys.argv[1], LIVE)))",
    ].join("\n");
    const everything = python(["-c", script, SEED]).stdout.trim();
    const result = shares(state(), "silent", everything);
    expect(result.status).not.toBe(0);
    expect(result.stdout).toContain("REJECTED");
  });

  it("should never say which expressions of a wrong classification are wrong", () => {
    // Naming them hands over a map of where the misreading is, and drawing that map is
    // the stage. Not claimed to prevent a scripted search -- see TEMPLATE.md
    // "Assurance scope"; the flag is derivable from FLAG_SEED regardless.
    const script = [
      "import json, sys",
      "sys.path.insert(0, '.')",
      "from fixtures.generate import LIVE, expressions",
      "print(json.dumps([str(r['id']) for r in expressions(sys.argv[1], LIVE)]))",
    ].join("\n");
    const ids = JSON.parse(python(["-c", script, SEED]).stdout.trim()) as string[];
    const stdout = shares(state(), "silent", ids.join(",")).stdout;
    for (const id of ids) expect(stdout).not.toContain(id);
  });

  it("should lock the second desk until it is earned, rather than omit it", () => {
    // Locked, not absent. The portal terminal has no scrollback and no second page, so
    // a stage that simply is not printed reads as a broken problem.
    const script = [
      "import json, sys",
      "sys.path.insert(0, '.')",
      "from fixtures.generate import TRANSFER, expressions",
      "print(json.dumps([str(r['id']) for r in expressions(sys.argv[1], TRANSFER)]))",
    ].join("\n");
    const ids = JSON.parse(python(["-c", script, SEED]).stdout.trim()) as string[];
    const stdout = shares(state(), "show").stdout;
    for (const id of ids) expect(stdout).not.toContain(id);
    expect(stdout).toContain("[locked]");
  });

  it("should name the transfer command once the second desk is unlocked", () => {
    // The unlocked branch of `show` is the one nothing else exercises: every other
    // test here runs with empty progress, and TEMPLATE.md names "a `show` that never
    // said what to type next" as a bug found by playthrough and by no test.
    const directory = state();
    writeFileSync(
      join(directory, "progress.json"),
      JSON.stringify({ row: true, total: true, silent: true }),
    );
    const stdout = shares(directory, "show").stdout;
    expect(stdout).toContain("the second desk ==");
    expect(stdout).toContain("shares transfer row=<number> total=<number> silent=<ids>");
    expect(stdout).not.toContain("[locked]");
  });

  it("should require all three readings at once on the transfer stage", () => {
    const directory = state();
    writeFileSync(
      join(directory, "progress.json"),
      JSON.stringify({ row: true, total: true, silent: true }),
    );
    const [row, total, silent] = referenceAnswers(SEED).transfer;
    expect(shares(directory, "transfer", row as string, total as string).status).not.toBe(0);
    expect(shares(directory, "transfer", row as string, silent as string).status).not.toBe(0);
    expect(
      shares(directory, "transfer", row as string, total as string, silent as string).status,
    ).toBe(0);
  });

  it("should withhold the flag for every incomplete progress state", () => {
    for (const cleared of [
      { row: true },
      { total: true },
      { silent: true },
      { transfer: true },
      { row: true, total: true },
      { row: true, total: true, silent: true },
      { row: true, total: true, transfer: true },
      { total: true, silent: true, transfer: true },
    ]) {
      const directory = state();
      writeFileSync(join(directory, "progress.json"), JSON.stringify(cleared));
      const result = shares(directory, "flag");
      expect(result.status).not.toBe(0);
      expect(result.stdout).not.toContain(expectedFlag(SEED));
    }
  });

  it("should kill every intended defect in the mutation suite", () => {
    const result = python(["mutation.py"]);
    expect(result.stdout).toContain("PASS the seed set spans");
    expect(result.stdout).toContain("PASS the fixtures hold");
    expect(result.stdout).not.toContain("SURVIVED");
    expect(result.stdout).not.toContain("FAILED");
    expect(result.status).toBe(0);
  }, 900_000);

  it("should pass its own public self-check", () => {
    const result = python(["tests/public/test_shares.py"]);
    expect(result.stdout).not.toContain("FAIL");
    expect(result.status).toBe(0);
  }, 180_000);
});

describe("ac26-w2-linear-shares: /verify contract", () => {
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
    expect(evaluate("TC{linear_shares_00000000000000000000}")).toBe(false);
    expect(evaluate("")).toBe(false);
  });

  it("should run no participant code at all, since there is none to run", () => {
    const verifier = read("local/verifier/server.py");
    for (const pattern of ["subprocess", "runpy", "importlib", "exec(", "eval(", "compile("]) {
      expect(verifier).not.toContain(pattern);
    }
  });

  it("should never restate the expected value in its response", () => {
    const verifier = read("local/verifier/server.py");
    const message = /"message": \(([\s\S]*?)\),/.exec(verifier)?.[1] ?? "";
    expect(message).not.toContain("derive_flag");
    expect(message).not.toContain("FLAG");
  });
});

describe("ac26-w2-linear-shares: metadata contracts", () => {
  function metadata() {
    return JSON.parse(read("metadata.json")) as {
      difficulty: number;
      status: string;
      courseAlignment: { week: number; role: string; sources: Array<{ ref: string; kind: string }> };
      runtime: { verifyUrl: string; secretEnv: string[] };
      exposedPorts: Array<{ port: number }>;
      scoring: {
        kind: string;
        points: number;
        wrongAnswerPenalty: number;
        checks?: unknown;
        hints: Array<{ id: string; penalty: number }>;
      };
      i18n: { en: { hints: Array<{ id: string }>; checks?: unknown } };
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

  it("should carry no leftover checkpoint list from the multi-verify shape", () => {
    // The portal's answer box is a single-line text input, so a checkpoint that expected
    // a file's source could not be submitted from it. A stale `checks[]` would still be
    // projected into index.json.
    const meta = metadata();
    expect(meta.scoring.checks).toBeUndefined();
    expect(meta.i18n.en.checks).toBeUndefined();
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

  // Week 2 had no material at the recorded commit, so the pin records that absence
  // rather than an alignment: `kind: "placeholder"`, per SYNC.md section 2. That pin is
  // what lets `course:drift` report PUBLISHED the day the material appears, which is how
  // #219 finds out. Dropping it, or promoting the kind without reading the new material,
  // silently disconnects that signal.
  it("should pin week 2's placeholder rather than an alignment", () => {
    const { courseAlignment, status } = metadata();
    expect(courseAlignment.week).toBe(2);
    expect(courseAlignment.role).toBe("mechanism");
    expect(courseAlignment.sources).toEqual([
      {
        repository: "zk-tokyo/advanced-cryptography-2026",
        ref: "5e80999306608a45aecf9a0e4e3394a0b62f34d2",
        path: "week2/README.md",
        kind: "placeholder",
      },
    ]);
    expect(status).toBe("draft");
  });
});
