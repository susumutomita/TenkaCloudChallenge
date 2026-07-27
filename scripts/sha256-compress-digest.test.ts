import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import { parse as parseYaml } from "yaml";

/**
 * CI for `sha256-compress-digest`, problem 3 of the SHA-256 series.
 *
 * The interesting assertions run the problem's own Python for real rather than reading its
 * source: that the shipped starter fails, that the reference passes, that the hidden tests
 * kill every intended defect, and that /verify holds its security contract.
 *
 * Three assertions are about cryptography rather than about the harness, and each is checked
 * against something outside this problem so a mistake of mine fails here instead of teaching
 * a learner something false:
 *   - the reference digest is compared against `hashlib` across block boundaries;
 *   - the derived K and initial-state tables are compared against FIPS 180-4's published
 *     first and last entries;
 *   - the two quizzes' answers are checked to be non-degenerate and order-dependent, since
 *     a quiz whose answer is all-T teaches a coin flip.
 */

const ROOT = join(import.meta.dir, "..", "challenges", "sha256-compress-digest");
const LOCAL = join(ROOT, "local");
const SEED = "ci-fixed-seed";

function read(relativePath: string): string {
  return readFileSync(join(ROOT, relativePath), "utf8");
}

function python(args: string[], cwd = LOCAL) {
  return spawnSync("python3", args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, FLAG_SEED: SEED, PYTHONDONTWRITEBYTECODE: "1" },
    timeout: 300_000,
  });
}

/** Run a snippet inside `local/` and return its last stdout line. */
function pythonValue(lines: readonly string[], ...argv: string[]): string {
  const script = ["import sys", "sys.path.insert(0, '.')", ...lines].join("\n");
  const result = python(["-c", script, ...argv]);
  expect(result.stderr).toBe("");
  expect(result.status).toBe(0);
  return result.stdout.trim().split("\n").at(-1) ?? "";
}

/** Evaluate one checkpoint through the verifier's own entry point. */
function evaluate(checkpointId: string, submission: string): boolean {
  return (
    pythonValue(
      [
        "import json",
        "from verifier.server import evaluate",
        "print(json.dumps(evaluate(sys.argv[1], sys.argv[2])))",
      ],
      checkpointId,
      submission,
    ) === "true"
  );
}

const FUNCTIONS = [
  "round_step",
  "compress_rounds",
  "compress_block",
  "invert_round",
  "invert_rounds",
  "sha256_hex",
] as const;

describe("sha256-compress-digest: participant contract", () => {
  it("should ship every file the local-play template requires", () => {
    for (const path of [
      "Makefile",
      "metadata.json",
      "README.md",
      "README.ja.md",
      "local/docker-compose.yml",
      "local/Dockerfile",
      "local/show.py",
      "local/mutation.py",
      "local/given/primitives.py",
      "local/starter/compress.py",
      "local/reference/compress.py",
      "local/fixtures/generate.py",
      "local/tests/public/test_compress.py",
      "local/tests/hidden/check_compress.py",
      "local/verifier/server.py",
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

  it("should keep the answer out of the participant's checkout by mounting only starter/", () => {
    const makefile = read("Makefile");
    expect(makefile).toContain("local/starter:/problem/starter:ro");
    expect(makefile).not.toContain("local/reference:");
    expect(makefile).not.toContain("tests/hidden:");
  });

  it("should build the participant stage, not the last one", () => {
    expect(read("Makefile")).toContain("docker build --target participant -t $(IMAGE) local");
    expect(read("local/docker-compose.yml")).toMatch(/^\s*target:\s*participant\s*$/m);
  });

  it("should copy given/ into the participant stage, since the starter imports it", () => {
    // Without this the image builds and then every run dies on ModuleNotFoundError, which
    // reads as a broken problem rather than a missing COPY.
    expect(read("local/Dockerfile")).toMatch(/^COPY given\/ \.\/given\/$/m);
  });

  it("should declare the same six functions in the starter and the reference", () => {
    for (const file of ["local/starter/compress.py", "local/reference/compress.py"]) {
      const source = read(file);
      for (const name of FUNCTIONS) {
        expect(source).toContain(`def ${name}(`);
      }
    }
  });

  it("should name every checkpoint in `make inspect`", () => {
    const result = python(["show.py"]);
    expect(result.status).toBe(0);
    for (const id of ["round", "feedforward", "avalanche", "properties", "storage"]) {
      expect(result.stdout).toContain(`== checkpoint: ${id} ==`);
    }
    expect(result.stdout).toContain("== checkpoints: compress / digest ==");
  });

  it("should not print any digest, post-round state, or the avalanche distance", () => {
    const printed = python(["show.py"]).stdout;
    const leaks = JSON.parse(
      pythonValue([
        "import json",
        "from fixtures.generate import avalanche_case, inversion_case, round_case",
        "from given.primitives import K",
        "from reference.compress import compress_rounds, round_step, sha256_hex",
        "from verifier.server import avalanche_distance",
        "seed = sys.argv[1]",
        "case = round_case(seed)",
        "after = round_step(case.state, K[case.round_index], case.schedule_word)",
        "state, schedule = inversion_case(seed)",
        "forward = compress_rounds(state, schedule)",
        "avalanche = avalanche_case(seed)",
        "values = [f'{word:08x}' for word in (after[0], after[4], forward[0], forward[7])]",
        "values += [sha256_hex(avalanche.message), sha256_hex(avalanche.flipped)]",
        "values.append(str(avalanche_distance()))",
        "print(json.dumps(values))",
      ], SEED),
    ) as string[];
    expect(leaks.length).toBeGreaterThan(0);
    for (const value of leaks) {
      expect(printed).not.toContain(value);
    }
  });
});

describe("sha256-compress-digest: container safety", () => {
  it("should publish every port on loopback only", () => {
    const compose = parseYaml(read("local/docker-compose.yml")) as {
      services: Record<string, { ports?: string[] }>;
    };
    const ports = Object.values(compose.services).flatMap((service) => service.ports ?? []);
    expect(ports.length).toBeGreaterThan(0);
    for (const mapping of ports) {
      expect(mapping.startsWith("127.0.0.1:")).toBe(true);
    }
  });

  it("should require FLAG_SEED rather than defaulting to a committed value", () => {
    expect(read("local/docker-compose.yml")).toContain("${FLAG_SEED:?");
  });

  it("should pin the base image by digest so fixtures cannot shift under the learner", () => {
    expect(read("local/Dockerfile")).toMatch(/^FROM \S+@sha256:[0-9a-f]{64}(?: AS \S+)?$/m);
  });

  it("should never build a shell command out of participant input", () => {
    const verifier = read("local/verifier/server.py");
    expect(verifier).toContain("shell=False");
    expect(verifier).not.toContain("os.system");
    expect(verifier).not.toContain("shell=True");
  });
});

describe("sha256-compress-digest: the given primitives really are SHA-256's", () => {
  it("should derive K and the initial state to match FIPS 180-4's published tables", () => {
    // Derived from prime roots rather than pasted. If the derivation drifts, the digest is
    // wrong with nothing to point at, so pin the four published anchors.
    const anchors = JSON.parse(
      pythonValue([
        "import json",
        "from given.primitives import INITIAL_STATE, K",
        "print(json.dumps([",
        "  [f'{word:08x}' for word in K[:4]],",
        "  [f'{word:08x}' for word in K[60:]],",
        "  [f'{word:08x}' for word in INITIAL_STATE],",
        "]))",
      ]),
    ) as [string[], string[], string[]];
    expect(anchors[0]).toEqual(["428a2f98", "71374491", "b5c0fbcf", "e9b5dba5"]);
    expect(anchors[1]).toEqual(["90befffa", "a4506ceb", "bef9a3f7", "c67178f2"]);
    expect(anchors[2]).toEqual([
      "6a09e667",
      "bb67ae85",
      "3c6ef372",
      "a54ff53a",
      "510e527f",
      "9b05688c",
      "1f83d9ab",
      "5be0cd19",
    ]);
  });

  it("should reproduce hashlib's digest across the block boundary", () => {
    expect(
      pythonValue([
        "import hashlib",
        "from reference.compress import sha256_hex",
        "cases = [b'', b'abc', b'hello world', bytes(55), bytes(56), bytes(63), bytes(64),",
        "         bytes(119), bytes(120), bytes(200), 'てんか雲'.encode()]",
        "print(all(sha256_hex(m) == hashlib.sha256(m).hexdigest() for m in cases))",
      ]),
    ).toBe("True");
  });

  it("should make the 64 rounds invertible but a compressed block not", () => {
    // The claim the whole `feedforward` checkpoint rests on, checked directly.
    expect(
      pythonValue([
        "from fixtures.generate import hidden_schedules, hidden_states",
        "from reference.compress import compress_block, compress_rounds, invert_rounds",
        "seed = sys.argv[1]",
        "states = [s for s in hidden_states(seed) if any(s)]",
        "rounds_ok = all(",
        "    invert_rounds(compress_rounds(s, sch), sch) == tuple(s)",
        "    for s in states for sch in hidden_schedules(seed))",
        "block_not_ok = all(",
        "    invert_rounds(compress_block(s, sch), sch) != tuple(s)",
        "    for s in states for sch in hidden_schedules(seed))",
        "print(rounds_ok and block_not_ok)",
      ], SEED),
    ).toBe("True");
  });

  it("should measure an avalanche distance in the band a good hash produces", () => {
    // Not a tight assertion, because the true value is data. It catches a fixture that made
    // the two messages identical (distance 0) or the checkpoint trivial (distance 256).
    const distance = Number(
      pythonValue(["from verifier.server import avalanche_distance", "print(avalanche_distance())"]),
    );
    expect(distance).toBeGreaterThan(80);
    expect(distance).toBeLessThan(180);
  });
});

describe("sha256-compress-digest: the quizzes are answerable and not guessable", () => {
  const dump = [
    "import json",
    "from fixtures.generate import property_quiz, quiz_answer, storage_quiz",
    "seed = sys.argv[1]",
    "print(json.dumps({",
    "  'properties': quiz_answer(property_quiz(seed)),",
    "  'storage': quiz_answer(storage_quiz(seed)),",
    "  'property_texts': [s.text for s in property_quiz(seed)],",
    "  'storage_texts': [s.text for s in storage_quiz(seed)],",
    "}))",
  ];

  interface Quiz {
    properties: string;
    storage: string;
    property_texts: string[];
    storage_texts: string[];
  }

  it("should reorder the statements when the seed changes, so an answer string does not carry", () => {
    const first = JSON.parse(pythonValue(dump, "seed-alpha")) as Quiz;
    const second = JSON.parse(pythonValue(dump, "seed-beta")) as Quiz;
    const again = JSON.parse(pythonValue(dump, "seed-alpha")) as Quiz;
    expect(first.property_texts).not.toEqual(second.property_texts);
    expect(first.storage_texts).not.toEqual(second.storage_texts);
    expect(first).toEqual(again);
    // Same statements, different order — not a different set of claims.
    expect([...first.property_texts].sort()).toEqual([...second.property_texts].sort());
  });

  it("should mix true and false claims in both quizzes", () => {
    // An all-true or all-false quiz is a coin flip, not a question.
    for (const seed of ["seed-alpha", "seed-beta", SEED]) {
      const quiz = JSON.parse(pythonValue(dump, seed)) as Quiz;
      for (const answer of [quiz.properties, quiz.storage]) {
        expect(answer.length).toBe(10);
        expect(answer).toContain("T");
        expect(answer).toContain("F");
      }
    }
  });

  it("should give both quizzes a Japanese statement for every English one", () => {
    expect(
      pythonValue([
        "from fixtures.generate import PROPERTY_STATEMENTS, STORAGE_STATEMENTS",
        "everything = PROPERTY_STATEMENTS + STORAGE_STATEMENTS",
        "print(all(s.text.strip() and s.text_ja.strip() for s in everything))",
      ]),
    ).toBe("True");
  });
});

describe("sha256-compress-digest: the problem is actually solvable and actually fails", () => {
  it("should fail the public tests in the shipped starter state", () => {
    const result = python(["tests/public/test_compress.py"]);
    expect(result.status).not.toBe(0);
    expect(result.stdout).toContain("FAIL");
  });

  it("should pass the public tests once the reference is in place", () => {
    const result = python(["-c", shimScript()]);
    expect(result.stdout).not.toContain("FAIL");
    expect(result.stdout).toContain("all passed");
  });

  it("should have public tests that pass for a first-block-only digest", () => {
    // The stated design, and the reason the published `abc` vector is not enough. If this
    // ever stops holding, both READMEs are making a claim the tests do not support.
    const result = python(["-c", shimScript(FIRST_BLOCK_ONLY)]);
    expect(result.stdout).toContain("all passed");
  });

  it("should kill every intended defect in the mutation suite", () => {
    const result = python(["mutation.py"]);
    expect(result.stdout).toContain("PASS reference implementation passes all four hidden suites");
    expect(result.stdout).not.toContain("SURVIVED");
    expect(result.status).toBe(0);
  }, 300_000);
});

/** A `sha256_hex` that compresses only the first block — the starter's headline defect. */
const FIRST_BLOCK_ONLY = [
  "def first_block_only(message):",
  "    schedules = reference.message_schedules(message)",
  "    state = reference.compress_block(tuple(reference.INITIAL_STATE), schedules[0])",
  "    return ''.join(f'{word:08x}' for word in state)",
  "shim.sha256_hex = first_block_only",
].join("\n");

/**
 * Run the public suite against the reference, optionally with one function replaced.
 *
 * The suite imports `starter.compress`, so this shims that module rather than editing the
 * learner-facing checkout.
 */
function shimScript(patch = ""): string {
  return [
    "import runpy, sys, types",
    "sys.path.insert(0, '.')",
    "import reference.compress as reference",
    "shim = types.ModuleType('starter.compress')",
    "for name in dir(reference):",
    "    if not name.startswith('__'):",
    "        setattr(shim, name, getattr(reference, name))",
    patch,
    "package = types.ModuleType('starter')",
    "package.__path__ = []",
    "sys.modules['starter'] = package",
    "sys.modules['starter.compress'] = shim",
    "runpy.run_path('tests/public/test_compress.py', run_name='__main__')",
  ]
    .filter(Boolean)
    .join("\n");
}

describe("sha256-compress-digest: resource caps", () => {
  it("should cap address space on Linux, where the lab actually runs", () => {
    expect(
      pythonValue([
        "from verifier.server import _ADDRESS_SPACE_CAPPABLE",
        "print(_ADDRESS_SPACE_CAPPABLE == sys.platform.startswith('linux'))",
      ]),
    ).toBe("True");
  });

  it("should apply its limits without raising on this platform", () => {
    expect(
      pythonValue([
        "import os",
        "from verifier.server import _limits",
        "pid = os.fork()",
        "if pid == 0:",
        "    try:",
        "        _limits()",
        "        os._exit(0)",
        "    except Exception:",
        "        os._exit(3)",
        "print(os.waitpid(pid, 0)[1] == 0)",
      ]),
    ).toBe("True");
  });
});

describe("sha256-compress-digest: /verify contract", () => {
  const reference = read("local/reference/compress.py");
  const starter = read("local/starter/compress.py");
  const CODE_CHECKPOINTS = ["round", "compress", "feedforward", "digest"] as const;

  it("should accept the reference on all four code checkpoints", () => {
    for (const checkpoint of CODE_CHECKPOINTS) {
      expect(evaluate(checkpoint, reference)).toBe(true);
    }
  }, 180_000);

  it("should reject the shipped starter on all four code checkpoints", () => {
    for (const checkpoint of CODE_CHECKPOINTS) {
      expect(evaluate(checkpoint, starter)).toBe(false);
    }
  }, 180_000);

  it("should reject a digest that only compresses the first block", () => {
    // Passes every public test and the published `abc` vector; must not pass the checkpoint.
    const submission = `${reference}\n${[
      "def sha256_hex(message):",
      "    schedules = message_schedules(message)",
      "    state = compress_block(tuple(INITIAL_STATE), schedules[0])",
      "    return ''.join(f'{word:08x}' for word in state)",
      "",
    ].join("\n")}`;
    expect(evaluate("digest", submission)).toBe(false);
  }, 60_000);

  it("should reject an inverse that only agrees with a broken forward pass", () => {
    // The separation that makes `feedforward` mean something: the checker inverts ITS own
    // forward pass, so a consistent-but-wrong pair fails.
    const submission = `${reference}\n${[
      "def _shifted(state):",
      "    return (state[1], state[2], state[3], state[4], state[5], state[6], state[7], 0)",
      "def invert_round(state, round_constant, schedule_word):",
      "    return _shifted(state)",
      "def invert_rounds(state, schedule):",
      "    working = tuple(state)",
      "    for index in reversed(range(64)):",
      "        working = invert_round(working, K[index], schedule[index])",
      "    return working",
      "",
    ].join("\n")}`;
    expect(evaluate("feedforward", submission)).toBe(false);
  }, 60_000);

  // The verifier's own wall-clock cap is 30s, so this case necessarily outlives bun's 5s
  // default. That is the behaviour under test, not slowness.
  it(
    "should reject a submission that hangs, rather than hanging itself",
    () => {
      expect(evaluate("round", "def round_step(s, k, w):\n    while True:\n        pass\n")).toBe(
        false,
      );
    },
    90_000,
  );

  it("should reject a submission that exits the interpreter", () => {
    expect(evaluate("round", "raise SystemExit(0)\n")).toBe(false);
  });

  it("should reject a submission that prints a passing verdict from an atexit hook", () => {
    const spoof = [
      "import atexit, json",
      'atexit.register(lambda: print(json.dumps({"failures": []})))',
      "",
    ].join("\n");
    for (const checkpoint of CODE_CHECKPOINTS) {
      expect(evaluate(checkpoint, spoof)).toBe(false);
    }
  }, 120_000);

  it("should report a missing function rather than crediting the checkpoint", () => {
    expect(evaluate("digest", "def round_step(s, k, w):\n    return s\n")).toBe(false);
  });

  it("should reject an unknown checkpoint id instead of crediting it", () => {
    expect(evaluate("finish-everything", "anything")).toBe(false);
  });

  it("should accept only the measured avalanche distance", () => {
    const distance = Number(
      pythonValue(["from verifier.server import avalanche_distance", "print(avalanche_distance())"]),
    );
    expect(evaluate("avalanche", String(distance))).toBe(true);
    expect(evaluate("avalanche", String(distance + 1))).toBe(false);
    expect(evaluate("avalanche", "128")).toBe(distance === 128);
    expect(evaluate("avalanche", "257")).toBe(false);
    expect(evaluate("avalanche", "-1")).toBe(false);
    expect(evaluate("avalanche", "about half")).toBe(false);
  });

  it("should accept a quiz answer in any of the tolerated letter styles", () => {
    const answers = JSON.parse(
      pythonValue([
        "import json",
        "from fixtures.generate import property_quiz, quiz_answer, storage_quiz",
        "seed = sys.argv[1]",
        "print(json.dumps([quiz_answer(property_quiz(seed)), quiz_answer(storage_quiz(seed))]))",
      ], SEED),
    ) as [string, string];
    const [properties, storage] = answers;
    expect(evaluate("properties", properties)).toBe(true);
    expect(evaluate("properties", properties.toLowerCase())).toBe(true);
    expect(evaluate("properties", properties.split("").join(", "))).toBe(true);
    expect(
      evaluate("storage", storage.replace(/T/g, "1").replace(/F/g, "0")),
    ).toBe(true);
    expect(evaluate("storage", storage.replace(/T/g, "Y").replace(/F/g, "N"))).toBe(true);
  });

  it("should reject a quiz answer with any single letter wrong", () => {
    const properties = pythonValue([
      "from fixtures.generate import property_quiz, quiz_answer",
      "print(quiz_answer(property_quiz(sys.argv[1])))",
    ], SEED);
    for (let position = 0; position < properties.length; position += 1) {
      const letters = properties.split("");
      letters[position] = letters[position] === "T" ? "F" : "T";
      expect(evaluate("properties", letters.join(""))).toBe(false);
    }
    expect(evaluate("properties", "T".repeat(properties.length))).toBe(false);
    expect(evaluate("properties", properties.slice(0, -1))).toBe(false);
  });

  it("should echo the checkpointId so the platform can fail closed", () => {
    expect(read("local/verifier/server.py")).toContain(
      '{"checkpointId": checkpoint_id, "correct": correct}',
    );
  });
});

describe("sha256-compress-digest: scoring follows the tier regulation", () => {
  const meta = JSON.parse(read("metadata.json")) as {
    difficulty: number;
    scoring: {
      kind: string;
      checks: Array<{ id: string; points: number; hints?: Array<{ penalty: number }> }>;
    };
  };

  it("should total the Hard tier's 300 points across its checkpoints", () => {
    expect(meta.scoring.kind).toBe("multi-verify");
    expect(meta.difficulty).toBeGreaterThanOrEqual(4);
    expect(meta.scoring.checks.reduce((sum, check) => sum + check.points, 0)).toBe(300);
    for (const check of meta.scoring.checks) {
      const penalty = (check.hints ?? []).reduce((sum, hint) => sum + hint.penalty, 0);
      expect(penalty).toBeLessThanOrEqual(check.points * 0.5);
    }
  });

  it("should score exactly the checkpoints the verifier knows about", () => {
    const declared = meta.scoring.checks.map((check) => check.id).sort();
    const implemented = JSON.parse(
      pythonValue(["import json", "from verifier.server import CHECKPOINTS", "print(json.dumps(sorted(CHECKPOINTS)))"]),
    ) as string[];
    expect(implemented).toEqual(declared);
  });

  it("should stay inside the template's 2-8 checkpoint range", () => {
    expect(meta.scoring.checks.length).toBeGreaterThanOrEqual(2);
    expect(meta.scoring.checks.length).toBeLessThanOrEqual(8);
  });

  it("should state the same hint remainder in both READMEs as the metadata implies", () => {
    // Both READMEs advertise "opening every hint still leaves you N of M". I got that number
    // wrong in two of the three problems before this assertion existed, and a wrong number
    // here is a promise about scoring that the platform will not keep.
    const total = meta.scoring.checks.reduce((sum, check) => sum + check.points, 0);
    const hints = meta.scoring.checks
      .flatMap((check) => check.hints ?? [])
      .reduce((sum, hint) => sum + hint.penalty, 0);
    const remaining = total - hints;

    const english = /still leaves you\s+(\d+) of (\d+)/.exec(read("README.md"));
    expect(english).not.toBeNull();
    expect(Number((english as RegExpExecArray)[1])).toBe(remaining);
    expect(Number((english as RegExpExecArray)[2])).toBe(total);

    const japanese = /(\d+) 点中 (\d+) 点は残ります/.exec(read("README.ja.md"));
    expect(japanese).not.toBeNull();
    expect(Number((japanese as RegExpExecArray)[1])).toBe(total);
    expect(Number((japanese as RegExpExecArray)[2])).toBe(remaining);
  });

  it("should span at least three checkpoint kinds, per the template's scoring contract", () => {
    const kinds = {
      construct: ["round", "compress", "digest"],
      counterexample: ["feedforward"],
      observe: ["avalanche"],
      misconception: ["properties", "storage"],
    };
    expect(Object.keys(kinds).length).toBeGreaterThanOrEqual(3);
    expect(Object.values(kinds).flat().sort()).toEqual(
      meta.scoring.checks.map((check) => check.id).sort(),
    );
  });
});
