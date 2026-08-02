import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "bun:test";
import { parse as parseYaml } from "yaml";

/**
 * ac26-bridge-properties is delivered as a container the participant plays from its
 * terminal: `review show` / `review run` / `review reject` / `review recover` /
 * `review forge` / `review classify` / `review transfer` / `review flag`, one line at a
 * time, no file to edit. The interesting assertions therefore run that CLI for real --
 * including from a working directory that is not the problem root, which is what the
 * portal's terminal does not promise -- rather than reading source text.
 *
 * Two classes of assertion here exist because of defects this problem actually had, and
 * neither shows up as a crash:
 *
 *  - a **fixture sweep**, because the two statements are drawn independently and on
 *    roughly one seed in forty their honest witnesses came out equal, which gave `reject`
 *    and `recover` the same answer;
 *  - a **role-permutation** check, because a fixed assignment of defects to verifiers
 *    makes the `classify` answer one sentence that is identical on every deployment, and
 *    therefore a remembered string rather than a reading.
 *
 * Python 3 is on ubuntu-latest and the problem is stdlib-only.
 */

const ROOT = join(import.meta.dir, "..", "challenges", "ac26-bridge-properties");
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
  const result = python(["-c", ["import json, sys", "sys.path.insert(0, '.')", ...lines].join("\n"), ...args]);
  expect(result.stderr).toBe("");
  expect(result.status).toBe(0);
  return JSON.parse(result.stdout.trim().split("\n").at(-1) as string) as T;
}

/** A fresh progress directory, so no test inherits another's cleared stages. */
function state(): string {
  const directory = mkdtempSync(join(tmpdir(), "ac26-properties-state-"));
  scratch.push(directory);
  return directory;
}

/**
 * Run the CLI the way the portal terminal does: by absolute path, from `/`.
 *
 * The cwd matters. The terminal does not promise to land in `/problem`, and a
 * `review show` that fails with ImportError because of where the shell started is an
 * unanswerable error message.
 */
function review(stateDir: string, seed: string, ...args: string[]) {
  return python([join(LOCAL, "review.py"), ...args], "/", {
    LAB_STATE_DIR: stateDir,
    FLAG_SEED: seed,
  });
}

interface Answers {
  reject: string[];
  recover: string[];
  forge: string[];
  classify: string[];
  transfer: string[];
}

/** The answers, from `reference/` -- present in the checkout, absent from the image. */
function referenceAnswers(seed: string): Answers {
  return evaluatePython<Answers>(
    [
      "from reference.solve import (classify_arguments, forge_arguments, recover_arguments,",
      "                             reject_arguments, transfer_arguments)",
      "seed = sys.argv[1]",
      "print(json.dumps({'reject': reject_arguments(seed), 'recover': recover_arguments(seed),",
      "                  'forge': forge_arguments(seed), 'classify': classify_arguments(seed),",
      "                  'transfer': transfer_arguments(seed)}))",
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

describe("ac26-bridge-properties: the files the container is built from", () => {
  it("should ship every file the delivery needs", () => {
    for (const path of [
      "Makefile",
      "metadata.json",
      "README.md",
      "README.ja.md",
      "local/docker-compose.yml",
      "local/Dockerfile",
      "local/review.py",
      "local/mutation.py",
      "local/fixtures/generate.py",
      "local/lab/judge.py",
      "local/lab/progress.py",
      "local/tests/public/test_review.py",
      "local/reference/solve.py",
      "local/verifier/server.py",
    ]) {
      expect(existsSync(join(ROOT, path))).toBe(true);
    }
  });

  it("should have nothing to edit and no hidden suite, since the problem is played from the terminal", () => {
    // Both are artifacts of the shape this problem used to have: files the learner edited
    // and pasted back. The portal's answer box is one line of text, so that shape could
    // not be submitted from it at all.
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
    expect(read("Makefile")).toContain("IMAGE := ac26-bridge-properties");
  });
});

describe("ac26-bridge-properties: container safety", () => {
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
    expect(read("local/Dockerfile")).toContain("/usr/local/bin/review");
  });

  it("should never build a shell command out of participant input", () => {
    for (const file of ["local/verifier/server.py", "local/review.py", "local/lab/judge.py"]) {
      const source = read(file);
      expect(source).not.toContain("os.system");
      expect(source).not.toContain("shell=True");
      expect(source).not.toContain("eval(");
      expect(source).not.toContain("exec(");
    }
  });
});

describe("ac26-bridge-properties: fixtures are seed-derived", () => {
  function fixtures(seed: string): string {
    const result = python([
      "-c",
      [
        "import json, sys",
        "sys.path.insert(0, '.')",
        "from fixtures.generate import LIVE, TRANSFER, flag, forged_value, panel",
        "seed = sys.argv[1]",
        "out = {'flag': flag(seed)}",
        "for name in (LIVE, TRANSFER):",
        "    p = panel(seed, name)",
        "    out[name] = {'main': p.main.rendered(), 'edge': p.edge.rendered(),",
        "                 'roles': [[v.id, v.role] for v in p.verifiers],",
        "                 'forge': forged_value(p)}",
        "print(json.dumps(out))",
      ].join("\n"),
      seed,
    ]);
    expect(result.status).toBe(0);
    return result.stdout.trim().split("\n").at(-1) as string;
  }

  it("should produce different panels for different seeds, and the same for the same", () => {
    expect(fixtures("seed-alpha")).not.toBe(fixtures("seed-beta"));
    expect(fixtures("seed-alpha")).toBe(fixtures("seed-alpha"));
  });

  /**
   * The properties that make the stages answerable at all, over many seeds.
   *
   * `well_posed` is the same function the judge refuses to grade on, so this sweeps the
   * author side of it. Each of its clauses was a real failure mode:
   *
   *  - the incomplete verifier accepting the edge witness leaves `reject` with no answer;
   *  - two verifiers breaking one property leaves `classify` with a table that does not
   *    match the story `show` tells;
   *  - **the main and edge witnesses coinciding gives `reject` and `recover` the same
   *    answer**, which credits one reading as two. That one shipped in the first draft
   *    and was found by this sweep, on about one seed in forty.
   */
  it("should pose a well-formed panel on every seed, for both panels", () => {
    const bad = evaluatePython<string[][]>([
      "from fixtures.generate import LIVE, TRANSFER, panel, well_posed",
      "bad = []",
      "for index in range(150):",
      "    seed = 'sweep-%d' % index",
      "    for name in (LIVE, TRANSFER):",
      "        for problem in well_posed(panel(seed, name)):",
      "            bad.append([seed, name, problem])",
      "print(json.dumps(bad))",
    ]);
    expect(bad).toEqual([]);
  }, 300_000);

  it("should keep the two panels different in every flavour", () => {
    // A transfer stage measures nothing if the second panel is the first one again.
    const same = evaluatePython<string[][]>([
      "from fixtures.generate import LIVE, ROLES, TRANSFER, panel",
      "same = []",
      "for index in range(60):",
      "    seed = 'flavour-%d' % index",
      "    live, second = panel(seed, LIVE), panel(seed, TRANSFER)",
      "    for role in ROLES:",
      "        a, b = live.by_role(role), second.by_role(role)",
      "        if (a.range_rule, a.audit_key) == (b.range_rule, b.audit_key):",
      "            same.append([seed, role])",
      "print(json.dumps(same))",
    ]);
    expect(same).toEqual([]);
  }, 120_000);

  it("should move the defects between verifiers with the seed", () => {
    // A fixed assignment makes the `classify` answer the same sentence on every
    // deployment -- a remembered string, and one that travels between participants.
    const orders = evaluatePython<Record<string, string[][]>>([
      "from fixtures.generate import LIVE, TRANSFER, panel",
      "seen = {}",
      "for name in (LIVE, TRANSFER):",
      "    seen[name] = sorted({tuple(v.role for v in panel('perm-%d' % i, name).verifiers)",
      "                         for i in range(120)})",
      "print(json.dumps({k: [list(o) for o in v] for k, v in seen.items()}))",
    ]);
    for (const name of ["p", "q"]) expect(orders[name].length).toBe(6);
  }, 120_000);
});

describe("ac26-bridge-properties: the terminal is the whole interface", () => {
  it("should print usage when run with no arguments", () => {
    const result = review(state(), SEED);
    expect(result.status).toBe(0);
    for (const command of [
      "review show",
      "review run",
      "review reject",
      "review recover",
      "review forge",
      "review classify",
      "review transfer",
      "review flag",
    ]) {
      expect(result.stdout).toContain(command);
    }
  });

  it("should let `show` alone tell a participant what to do next", () => {
    const result = review(state(), SEED, "show");
    expect(result.status).toBe(0);
    for (const expected of [
      "the claim",
      "complete",
      "sound",
      "private",
      "stage 1 of 5",
      "stage 2 of 5",
      "stage 3 of 5",
      "stage 4 of 5",
      "stage 5 of 5",
      "review run <verifier> <w>",
      "review reject <w>",
      "review recover <w>",
      "review forge <w>",
    ]) {
      expect(result.stdout).toContain(expected);
    }
    expect(result.stdout).not.toContain(expectedFlag(SEED));
  });

  it("should carry a record on screen for the privacy stage to read", () => {
    // Without the honest record printed, `recover` has no source and the stage is a
    // guessing game. Asserted against the value the leaky verifier actually writes.
    const leaked = evaluatePython<number>([
      "from fixtures.generate import LIVE, panel",
      "p = panel(sys.argv[1], LIVE)",
      "print(json.dumps(p.main.witness - p.main.lo))",
    ], SEED);
    expect(review(state(), SEED, "show").stdout).toContain(`"position_in_range": ${leaked}`);
  });

  it("should keep the second panel off the screen until the first four are cleared", () => {
    const result = review(state(), SEED, "show");
    expect(result.stdout).toContain("locked");
    const rendered = evaluatePython<string[]>([
      "from fixtures.generate import TRANSFER, panel",
      "p = panel(sys.argv[1], TRANSFER)",
      "print(json.dumps([p.main.rendered(), p.edge.rendered()]))",
    ], SEED);
    expect(rendered.length).toBe(2);
    for (const line of rendered) expect(result.stdout).not.toContain(line);
  });

  it("should refuse an unknown command instead of doing something", () => {
    const result = review(state(), SEED, "solve");
    expect(result.status).not.toBe(0);
    expect(result.stdout).toContain("unknown command");
  });

  it("should explain a malformed answer rather than raising", () => {
    for (const [args, expected] of [
      [["reject"], "no witness given"],
      [["reject", "twelve"], "not a whole number"],
      [["recover", "1", "2"], "2 values given"],
      [["run"], "usage: review run"],
      [["run", "nobody", "1"], "no verifier called"],
      [["run", "p1", "wat"], "not a whole number"],
    ] as const) {
      const result = review(state(), SEED, ...args);
      expect(result.status).not.toBe(0);
      expect(result.stderr).toBe("");
      expect(result.stdout).toContain(expected);
    }
  }, 120_000);

  it("should run identically from a directory that is not the problem root", () => {
    // Every command in this file already runs from `/`; this pins the property itself.
    expect(review(state(), SEED, "show").status).toBe(0);
  });
});

describe("ac26-bridge-properties: the five stages and the gates", () => {
  const seeds = ["ci-fixed-seed", "ci-other-seed"] as const;

  it.each(seeds)("should take the reference answers from empty to flag on %s", (seed) => {
    const directory = state();
    const answers = referenceAnswers(seed);
    const run = (...args: string[]) => review(directory, seed, ...args);

    expect(run("flag").stdout).not.toContain(expectedFlag(seed));
    // Both gates refuse the right answer before their stages are cleared.
    expect(run("classify", ...answers.classify).status).not.toBe(0);
    expect(run("transfer", ...answers.transfer).status).not.toBe(0);

    expect(run("reject", ...answers.reject).status).toBe(0);
    expect(run("recover", ...answers.recover).status).toBe(0);
    expect(run("forge", ...answers.forge).status).toBe(0);
    expect(run("transfer", ...answers.transfer).status).not.toBe(0);

    expect(run("classify", ...answers.classify).status).toBe(0);
    expect(run("flag").stdout).not.toContain(expectedFlag(seed));

    expect(run("transfer", ...answers.transfer).status).toBe(0);
    expect(run("flag").stdout).toContain(expectedFlag(seed));
  }, 300_000);

  it("should not credit the first panel's answers on the second one", () => {
    // The whole reason the transfer stage exists: the defects sit on different verifiers,
    // the strict bound is on the other end, and the record counts the other way.
    const directory = state();
    const answers = referenceAnswers(SEED);
    for (const [stage, args] of [
      ["reject", answers.reject],
      ["recover", answers.recover],
      ["forge", answers.forge],
      ["classify", answers.classify],
    ] as const) {
      expect(review(directory, SEED, stage, ...args).status).toBe(0);
    }
    const live = evaluatePython<Record<string, number>>([
      "from fixtures.generate import LIVE, forged_value, panel",
      "p = panel(sys.argv[1], LIVE)",
      "print(json.dumps({'reject': p.edge.witness, 'recover': p.main.witness,",
      "                  'forge': forged_value(p)}))",
    ], SEED);
    const result = review(
      directory,
      SEED,
      "transfer",
      `reject=${live.reject}`,
      `recover=${live.recover}`,
      `forge=${live.forge}`,
    );
    expect(result.status).not.toBe(0);
    expect(result.stdout).toContain("NOT YET");
  }, 120_000);

  it("should refuse a classification that calls a one-property break a total loss", () => {
    // The misconception the stage exists for. Every verifier here still guarantees two of
    // the three things.
    const directory = state();
    const answers = referenceAnswers(SEED);
    for (const [stage, args] of [
      ["reject", answers.reject],
      ["recover", answers.recover],
      ["forge", answers.forge],
    ] as const) {
      expect(review(directory, SEED, stage, ...args).status).toBe(0);
    }
    const result = review(directory, SEED, "classify", "p1=none", "p2=none", "p3=none");
    expect(result.status).not.toBe(0);
    expect(result.stdout).toContain("NOT YET");
  }, 120_000);

  it("should keep `review run` free of any effect on progress", () => {
    const directory = state();
    for (const verifier of ["p1", "p2", "p3"]) {
      for (const w of ["0", "1", "40"]) {
        expect(review(directory, SEED, "run", verifier, w).status).toBe(0);
      }
    }
    expect(review(directory, SEED, "status").stdout).not.toContain("cleared");
    expect(review(directory, SEED, "flag").stdout).not.toContain(expectedFlag(SEED));
  }, 120_000);

  it("should withhold the flag for every incomplete progress state", () => {
    const stages = ["reject", "recover", "forge", "classify", "transfer"];
    for (let mask = 0; mask < (1 << stages.length) - 1; mask += 1) {
      const directory = state();
      const cleared = Object.fromEntries(
        stages.filter((_stage, index) => (mask & (1 << index)) !== 0).map((stage) => [stage, true]),
      );
      writeFileSync(join(directory, "progress.json"), JSON.stringify(cleared));
      const result = review(directory, SEED, "flag");
      expect(result.status).not.toBe(0);
      expect(result.stdout).not.toContain(expectedFlag(SEED));
    }
  }, 300_000);

  it("should kill every intended defect in the mutation suite", () => {
    const result = python(["mutation.py"]);
    expect(result.stdout).toContain("PASS the reference answers pass");
    expect(result.stdout).toContain("PASS every seed poses a panel");
    expect(result.stdout).toContain("PASS `review run` clears nothing");
    expect(result.stdout).not.toContain("SURVIVED");
    expect(result.stdout).not.toContain("FAILED");
    expect(result.status).toBe(0);
  }, 600_000);

  it("should pass its own public self-check", () => {
    const result = python(["tests/public/test_review.py"]);
    expect(result.stdout).not.toContain("FAIL");
    expect(result.status).toBe(0);
  }, 300_000);
});

describe("ac26-bridge-properties: /verify contract", () => {
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
    expect(evaluate("TC{bridge_properties_00000000000000000000}")).toBe(false);
    expect(evaluate("")).toBe(false);
  });

  it("should compare in constant time, so a wrong answer is not an oracle", () => {
    // The platform charges for wrong answers; a timing oracle would make that avoidable.
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

describe("ac26-bridge-properties: metadata contracts", () => {
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

  it("should stay a Bridge 0 diagnostic, and pin no upstream source", () => {
    // `diagnostic` runs before the material rather than alongside it, so there is no
    // lecture or exercise to cite, and inventing a SHA to fill the field is worse than
    // leaving it out.
    const meta = metadata();
    expect(meta.track.id).toBe("advanced-cryptography-2026");
    expect(meta.track.order).toBe(20);
    expect(meta.courseAlignment.role).toBe("diagnostic");
    expect(meta.courseAlignment.sources).toBeUndefined();
  });

  it("should keep declaring the concepts other problems point at", () => {
    // Node ids are globally unique across the catalog, so these three are declared here
    // and nowhere else; ac26-w6-* and ac26-w7-* relations resolve against them.
    const nodes = (JSON.parse(read("metadata.json")) as {
      nodes: { concepts: Array<{ id: string }> };
    }).nodes.concepts.map((concept) => concept.id);
    for (const id of ["concept.correctness", "concept.soundness", "concept.privacy"]) {
      expect(nodes).toContain(id);
    }
  });
});
