import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import { parse as parseYaml } from "yaml";

/**
 * CI for `sha256-schedule-logic`, problem 2 of the SHA-256 series.
 *
 * The interesting assertions run the problem's own Python for real rather than reading its
 * source: that the shipped starter fails, that the reference passes, that the hidden tests
 * kill every intended defect, and that /verify holds its security contract.
 *
 * Two assertions here are about SHA-256 rather than about the harness, and both are checked
 * against something outside this problem so a mistake of mine fails the test instead of
 * shipping: the reference's functions are run through a full SHA-256 and compared against
 * `hashlib`, and the `dependency` answer is compared against the index formula the README
 * teaches. Getting either wrong would mean teaching the wrong thing convincingly.
 */

const ROOT = join(import.meta.dir, "..", "challenges", "sha256-schedule-logic");
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
    timeout: 180_000,
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

/** The eight functions a submission has to define. */
const FUNCTIONS = [
  "rotr",
  "small_sigma0",
  "small_sigma1",
  "big_sigma0",
  "big_sigma1",
  "choose",
  "majority",
  "expand_schedule",
] as const;

describe("sha256-schedule-logic: participant contract", () => {
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
      "local/starter/schedule.py",
      "local/reference/schedule.py",
      "local/fixtures/generate.py",
      "local/tests/public/test_schedule.py",
      "local/tests/hidden/check_schedule.py",
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

  it("should declare the same eight functions in the starter and the reference", () => {
    // A function the starter never mentions is one a learner cannot know to write; a
    // function only the starter has is dead weight in the image.
    for (const file of ["local/starter/schedule.py", "local/reference/schedule.py"]) {
      const source = read(file);
      for (const name of FUNCTIONS) {
        expect(source).toContain(`def ${name}(`);
      }
    }
  });

  it("should name every checkpoint in `make inspect`", () => {
    const result = python(["show.py"]);
    expect(result.status).toBe(0);
    for (const id of ["rotate", "mux", "dependency"]) {
      expect(result.stdout).toContain(`== checkpoint: ${id} ==`);
    }
    // The three code checkpoints share one section, since none of them has a fixture.
    expect(result.stdout).toContain("== checkpoints: sigma / logic / schedule ==");
  });

  it("should print bit rows, since the checkpoints are about bit positions", () => {
    // The rotate checkpoint is answerable from hex, but only painfully. This is the
    // affordance that makes it a reasoning exercise rather than a bit-counting chore.
    expect(python(["show.py"]).stdout).toMatch(/[01]{4} [01]{4} [01]{4} [01]{4}/);
  });

  it("should not print any sigma output or expanded schedule, which are the answers", () => {
    const printed = python(["show.py"]).stdout;
    const leaks = JSON.parse(
      pythonValue([
        "import json",
        "from fixtures.generate import dependency_case, rotate_case",
        "from reference.schedule import big_sigma0, big_sigma1, expand_schedule, small_sigma0, small_sigma1",
        "word = rotate_case(sys.argv[1]).word",
        "values = [f(word) for f in (small_sigma0, small_sigma1, big_sigma0, big_sigma1)]",
        "values += expand_schedule(list(dependency_case(sys.argv[1]).words))[16:]",
        "print(json.dumps([f'{value:08x}' for value in values]))",
      ], SEED),
    ) as string[];
    expect(leaks.length).toBeGreaterThan(0);
    for (const value of leaks) {
      expect(printed).not.toContain(value);
    }
  });
});

describe("sha256-schedule-logic: container safety", () => {
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

describe("sha256-schedule-logic: fixtures are seed-derived", () => {
  const dump = [
    "import json",
    "from fixtures.generate import dependency_case, mux_case, rotate_case",
    "seed = sys.argv[1]",
    "rotate = rotate_case(seed)",
    "mux = mux_case(seed)",
    "dependency = dependency_case(seed)",
    "print(json.dumps({",
    "  'rotate': [rotate.word, rotate.rotate_by, rotate.shift_by],",
    "  'mux': [mux.e, mux.f, mux.g],",
    "  'dependency': [list(dependency.words), dependency.index, dependency.bit],",
    "}))",
  ];

  it("should produce different fixtures for different seeds", () => {
    const first = pythonValue(dump, "seed-alpha");
    const second = pythonValue(dump, "seed-beta");
    const again = pythonValue(dump, "seed-alpha");
    expect(first).not.toBe(second);
    expect(first).toBe(again);
  });

  it("should keep the mux fixture's two choices complementary", () => {
    // Where f and g agree, the selector cannot be observed — every such position would
    // hide a mistake. Complements mean all 32 positions are load-bearing.
    for (const seed of ["seed-alpha", "seed-beta", SEED]) {
      const [, f, g] = (JSON.parse(pythonValue(dump, seed)) as { mux: number[] }).mux;
      expect((f ^ g) >>> 0).toBe(0xffffffff);
    }
  });

  it("should never ask for a rotation or shift of zero", () => {
    // Zero would make the rotate checkpoint answerable without understanding either.
    for (const seed of ["seed-alpha", "seed-beta", SEED]) {
      const [, rotateBy, shiftBy] = (JSON.parse(pythonValue(dump, seed)) as { rotate: number[] })
        .rotate;
      expect(rotateBy).toBeGreaterThan(0);
      expect(rotateBy).toBeLessThan(32);
      expect(shiftBy).toBeGreaterThan(0);
      expect(shiftBy).toBeLessThan(32);
    }
  });
});

describe("sha256-schedule-logic: the functions really are SHA-256's", () => {
  it("should reproduce hashlib's digest when driven through a full compression loop", () => {
    // The strongest available check: run the whole of SHA-256 using ONLY the reference's
    // rotr, sigmas, Ch, Maj and schedule, and compare against hashlib.
    const matches = pythonValue([
      "import hashlib",
      "from reference.schedule import (MASK, big_sigma0, big_sigma1, choose, expand_schedule, majority)",
      "K = [",
      "  0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,",
      "  0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,",
      "  0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,",
      "  0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,",
      "  0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,",
      "  0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,",
      "  0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,",
      "  0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2]",
      "def digest(message):",
      "    h = [0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19]",
      "    padded = bytearray(message)",
      "    padded.append(0x80)",
      "    while len(padded) % 64 != 56:",
      "        padded.append(0)",
      "    padded += (len(message) * 8).to_bytes(8, 'big')",
      "    for offset in range(0, len(padded), 64):",
      "        block = padded[offset:offset + 64]",
      "        w = expand_schedule([int.from_bytes(block[i:i+4], 'big') for i in range(0, 64, 4)])",
      "        a, b, c, d, e, f, g, hh = h",
      "        for i in range(64):",
      "            t1 = (hh + big_sigma1(e) + choose(e, f, g) + K[i] + w[i]) & MASK",
      "            t2 = (big_sigma0(a) + majority(a, b, c)) & MASK",
      "            hh, g, f, e, d, c, b, a = g, f, e, (d + t1) & MASK, c, b, a, (t1 + t2) & MASK",
      "        h = [(x + y) & MASK for x, y in zip(h, [a, b, c, d, e, f, g, hh])]",
      "    return ''.join(f'{x:08x}' for x in h)",
      "cases = [b'', b'abc', b'hello world', bytes(55), bytes(56), bytes(64), bytes(200), 'てんか雲'.encode()]",
      "print(all(digest(m) == hashlib.sha256(m).hexdigest() for m in cases))",
    ]);
    expect(matches).toBe("True");
  });

  it("should have sigma1 of an all-ones word keep only the shifted term", () => {
    // Both rotations of an all-ones word are all ones and cancel under xor, so only SHR^10
    // survives: 0x003fffff. It is the shortest proof that the third term is a shift.
    expect(
      pythonValue([
        "from reference.schedule import small_sigma1",
        "print(f'{small_sigma1(0xffffffff):08x}')",
      ]),
    ).toBe("003fffff");
  });

  it("should have the big sigmas leave an all-ones word alone, since they only rotate", () => {
    expect(
      pythonValue([
        "from reference.schedule import big_sigma0, big_sigma1",
        "print(big_sigma0(0xffffffff) == 0xffffffff and big_sigma1(0xffffffff) == 0xffffffff)",
      ]),
    ).toBe("True");
  });

  it("should disagree with the parity on six of Maj's eight truth-table rows", () => {
    // The number is stated in both READMEs, the starter docstring and the hint text, and I
    // had it wrong (three agree, five differ) until this assertion said otherwise. Maj and
    // parity agree on exactly two single-bit rows: all zeros and all ones.
    expect(
      pythonValue([
        "from reference.schedule import majority",
        "rows = [(a, b, c) for a in (0, 1) for b in (0, 1) for c in (0, 1)]",
        "print(sum(1 for a, b, c in rows if majority(a, b, c) != a ^ b ^ c))",
      ]),
    ).toBe("6");
  });

  it("should make the expansion non-linear over xor, which is what xoring the terms loses", () => {
    expect(
      pythonValue([
        "from reference.schedule import expand_schedule",
        "from fixtures.generate import hidden_blocks",
        "blocks = hidden_blocks(sys.argv[1])",
        "def linear(left, right):",
        "    joint = expand_schedule([a ^ b for a, b in zip(left, right)])",
        "    return joint == [a ^ b for a, b in zip(expand_schedule(list(left)), expand_schedule(list(right)))]",
        "print(any(not linear(l, r) for l in blocks for r in blocks if l != r))",
      ], SEED),
    ).toBe("True");
  });
});

describe("sha256-schedule-logic: the dependency answer matches the reasoning it teaches", () => {
  it("should equal the smallest of k+16, k+15, k+7 and k+2 that reaches 16", () => {
    // The verifier computes this from the reference schedule so it can never disagree with
    // reality. This asserts that the formula the READMEs teach agrees with reality too —
    // for every input index, not just the one the seed happened to pick.
    expect(
      pythonValue([
        "from verifier.server import reference_schedule",
        "from fixtures.generate import dependency_case",
        "words = list(dependency_case(sys.argv[1]).words)",
        "def measured(k, bit):",
        "    flipped = list(words)",
        "    flipped[k] ^= 1 << bit",
        "    before, after = reference_schedule(words), reference_schedule(flipped)",
        "    return next(i for i in range(16, 64) if before[i] != after[i])",
        "def formula(k):",
        "    return min(i for i in (k + 16, k + 15, k + 7, k + 2) if i >= 16)",
        "print(all(measured(k, bit) == formula(k) for k in range(16) for bit in range(32)))",
      ], SEED),
    ).toBe("True");
  });

  it("should not always be 16, so the checkpoint cannot be guessed", () => {
    expect(
      pythonValue([
        "print(len({min(i for i in (k + 16, k + 15, k + 7, k + 2) if i >= 16) for k in range(16)}))",
      ]),
    ).not.toBe("1");
  });
});

describe("sha256-schedule-logic: the problem is actually solvable and actually fails", () => {
  it("should fail the public tests in the shipped starter state", () => {
    const result = python(["tests/public/test_schedule.py"]);
    expect(result.status).not.toBe(0);
    expect(result.stdout).toContain("FAIL");
  });

  it("should pass the public tests once the reference is in place", () => {
    // The public suite imports `starter.schedule`, so run it against a shim over the
    // reference rather than editing the checkout. A failure here is a broken public test.
    const result = python([
      "-c",
      [
        "import runpy, sys, types",
        "sys.path.insert(0, '.')",
        "import reference.schedule as reference",
        "shim = types.ModuleType('starter.schedule')",
        "for name in dir(reference):",
        "    if not name.startswith('__'):",
        "        setattr(shim, name, getattr(reference, name))",
        "package = types.ModuleType('starter')",
        "package.__path__ = []",
        "sys.modules['starter'] = package",
        "sys.modules['starter.schedule'] = shim",
        "runpy.run_path('tests/public/test_schedule.py', run_name='__main__')",
      ].join("\n"),
    ]);
    expect(result.stdout).not.toContain("FAIL");
    expect(result.stdout).toContain("all passed");
  });

  it("should have public tests that are not sufficient", () => {
    // The stated design: an xor-everything schedule passes every public test. If that ever
    // stops being true the README's claim is wrong, which is worse than a weak test.
    const result = python([
      "-c",
      [
        "import runpy, sys, types",
        "sys.path.insert(0, '.')",
        "import reference.schedule as reference",
        "shim = types.ModuleType('starter.schedule')",
        "for name in dir(reference):",
        "    if not name.startswith('__'):",
        "        setattr(shim, name, getattr(reference, name))",
        "def xor_expand(words):",
        "    schedule = list(words)",
        "    for index in range(16, 64):",
        "        schedule.append(",
        "            schedule[index - 16]",
        "            ^ reference.small_sigma0(schedule[index - 15])",
        "            ^ schedule[index - 7]",
        "            ^ reference.small_sigma1(schedule[index - 2])",
        "        )",
        "    return schedule",
        "shim.expand_schedule = xor_expand",
        "package = types.ModuleType('starter')",
        "package.__path__ = []",
        "sys.modules['starter'] = package",
        "sys.modules['starter.schedule'] = shim",
        "runpy.run_path('tests/public/test_schedule.py', run_name='__main__')",
      ].join("\n"),
    ]);
    expect(result.stdout).toContain("all passed");
  });

  it("should kill every intended defect in the mutation suite", () => {
    const result = python(["mutation.py"]);
    expect(result.stdout).toContain("PASS reference implementation passes all three hidden suites");
    expect(result.stdout).not.toContain("SURVIVED");
    expect(result.status).toBe(0);
  }, 120_000);
});

describe("sha256-schedule-logic: resource caps", () => {
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

describe("sha256-schedule-logic: /verify contract", () => {
  const reference = read("local/reference/schedule.py");
  const starter = read("local/starter/schedule.py");

  it("should accept the reference on all three code checkpoints", () => {
    for (const checkpoint of ["sigma", "logic", "schedule"]) {
      expect(evaluate(checkpoint, reference)).toBe(true);
    }
  }, 60_000);

  it("should reject the shipped starter on all three code checkpoints", () => {
    for (const checkpoint of ["sigma", "logic", "schedule"]) {
      expect(evaluate(checkpoint, starter)).toBe(false);
    }
  }, 60_000);

  it("should score the schedule checkpoint without scoring the sigmas", () => {
    // The independence claim in both READMEs, asserted end to end rather than only in the
    // mutation suite: identity sigmas plus a correct recurrence passes `schedule` and fails
    // `sigma`. If this ever flips, the hint text ("your sigmas are not being scored here")
    // becomes a lie that costs someone points.
    const identitySigmas = [
      "MASK = 0xFFFFFFFF",
      "def rotr(value, amount):",
      "    amount %= 32",
      "    return ((value >> amount) | (value << (32 - amount))) & MASK",
      "def small_sigma0(word):",
      "    return word",
      "def small_sigma1(word):",
      "    return word",
      "def big_sigma0(word):",
      "    return rotr(word, 2) ^ rotr(word, 13) ^ rotr(word, 22)",
      "def big_sigma1(word):",
      "    return rotr(word, 6) ^ rotr(word, 11) ^ rotr(word, 25)",
      "def choose(e, f, g):",
      "    return (e & f) ^ (~e & MASK & g)",
      "def majority(a, b, c):",
      "    return (a & b) ^ (a & c) ^ (b & c)",
      "def expand_schedule(words):",
      "    schedule = list(words)",
      "    for index in range(16, 64):",
      "        schedule.append((",
      "            schedule[index - 16]",
      "            + small_sigma0(schedule[index - 15])",
      "            + schedule[index - 7]",
      "            + small_sigma1(schedule[index - 2])",
      "        ) & MASK)",
      "    return schedule",
      "",
    ].join("\n");
    expect(evaluate("schedule", identitySigmas)).toBe(true);
    expect(evaluate("sigma", identitySigmas)).toBe(false);
  }, 60_000);

  // The verifier's own wall-clock cap is 20s, so this case necessarily outlives bun's 5s
  // default. That is the behaviour under test, not slowness.
  it(
    "should reject a submission that hangs, rather than hanging itself",
    () => {
      expect(evaluate("sigma", "def rotr(v, a):\n    while True:\n        pass\n")).toBe(false);
    },
    60_000,
  );

  it("should reject a submission that exits the interpreter", () => {
    expect(evaluate("logic", "raise SystemExit(0)\n")).toBe(false);
  });

  it("should reject a submission that prints a passing verdict from an atexit hook", () => {
    const spoof = [
      "import atexit, json",
      'atexit.register(lambda: print(json.dumps({"failures": []})))',
      "",
    ].join("\n");
    for (const checkpoint of ["sigma", "logic", "schedule"]) {
      expect(evaluate(checkpoint, spoof)).toBe(false);
    }
  }, 60_000);

  it("should report a missing function rather than crediting the checkpoint", () => {
    expect(evaluate("logic", "def choose(e, f, g):\n    return 0\n")).toBe(false);
  });

  it("should reject an unknown checkpoint id instead of crediting it", () => {
    expect(evaluate("finish-everything", "anything")).toBe(false);
  });

  it("should accept the rotate answer in either separator style and reject a shift for it", () => {
    const [rotated, shifted] = JSON.parse(
      pythonValue([
        "import json",
        "from fixtures.generate import MASK, rotate_case",
        "case = rotate_case(sys.argv[1])",
        "amount = case.rotate_by % 32",
        "rotated = ((case.word >> amount) | (case.word << (32 - amount))) & MASK",
        "print(json.dumps([f'{rotated:08x}', f'{case.word >> case.shift_by:08x}']))",
      ], SEED),
    ) as [string, string];
    expect(evaluate("rotate", `${rotated},${shifted}`)).toBe(true);
    expect(evaluate("rotate", ` 0X${rotated.toUpperCase()}  ${shifted} `)).toBe(true);
    expect(evaluate("rotate", `${shifted},${rotated}`)).toBe(false);
    expect(evaluate("rotate", rotated)).toBe(false);
    expect(evaluate("rotate", `1${rotated},${shifted}`)).toBe(false);
  });

  it("should reject majority and parity answers on the mux checkpoint", () => {
    const [correct, maj, parity] = JSON.parse(
      pythonValue([
        "import json",
        "from fixtures.generate import MASK, mux_case",
        "case = mux_case(sys.argv[1])",
        "e, f, g = case.e, case.f, case.g",
        "print(json.dumps([",
        "  f'{(e & f) ^ (~e & MASK & g):08x}',",
        "  f'{(e & f) | (e & g) | (f & g):08x}',",
        "  f'{e ^ f ^ g:08x}',",
        "]))",
      ], SEED),
    ) as [string, string, string];
    expect(evaluate("mux", correct)).toBe(true);
    expect(evaluate("mux", maj)).toBe(false);
    expect(evaluate("mux", parity)).toBe(false);
  });

  it("should accept only the measured dependency index", () => {
    const index = Number(
      pythonValue(["from verifier.server import first_affected_index", "print(first_affected_index())"]),
    );
    expect(index).toBeGreaterThanOrEqual(16);
    expect(evaluate("dependency", String(index))).toBe(true);
    expect(evaluate("dependency", String(index + 1))).toBe(false);
    expect(evaluate("dependency", "sixteen")).toBe(false);
  });

  it("should echo the checkpointId so the platform can fail closed", () => {
    expect(read("local/verifier/server.py")).toContain(
      '{"checkpointId": checkpoint_id, "correct": correct}',
    );
  });
});

describe("sha256-schedule-logic: scoring follows the tier regulation", () => {
  const meta = JSON.parse(read("metadata.json")) as {
    difficulty: number;
    scoring: {
      kind: string;
      checks: Array<{ id: string; points: number; hints?: Array<{ penalty: number }> }>;
    };
  };

  it("should total the Medium tier's 200 points across its checkpoints", () => {
    expect(meta.scoring.kind).toBe("multi-verify");
    expect(meta.difficulty).toBe(3);
    expect(meta.scoring.checks.reduce((sum, check) => sum + check.points, 0)).toBe(200);
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
      predict: ["rotate"],
      misconception: ["mux"],
      transfer: ["dependency"],
      construct: ["sigma", "logic", "schedule"],
    };
    expect(Object.keys(kinds).length).toBeGreaterThanOrEqual(3);
    expect(Object.values(kinds).flat().sort()).toEqual(
      meta.scoring.checks.map((check) => check.id).sort(),
    );
  });
});
