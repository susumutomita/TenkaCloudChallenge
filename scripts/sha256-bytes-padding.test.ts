import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import { parse as parseYaml } from "yaml";

/**
 * CI for `sha256-bytes-padding`, problem 1 of the SHA-256 series.
 *
 * The interesting assertions run the problem's own Python for real rather than reading its
 * source: that the shipped starter fails, that the reference passes, that the hidden tests kill
 * every intended defect, and that /verify holds its security contract. Python 3 is present on
 * ubuntu-latest and the problem uses only the standard library, so this needs no container.
 *
 * Two assertions are specific to this problem and worth keeping honest, because both are facts
 * about SHA-256 rather than about the harness: the padded length across the 55/56 boundary, and
 * the trailing field being a big-endian *bit* count. They are checked against Python's `hashlib`
 * digest of a padded block, so an error in my arithmetic here fails the test rather than shipping.
 */

const ROOT = join(import.meta.dir, "..", "challenges", "sha256-bytes-padding");
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
    timeout: 120_000,
  });
}

/** Run a snippet inside `local/` and return its last stdout line. */
function pythonValue(lines: readonly string[], ...argv: string[]): string {
  const result = python(["-c", ["import sys", "sys.path.insert(0, '.')", ...lines].join("\n"), ...argv]);
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

describe("sha256-bytes-padding: participant contract", () => {
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
      "local/starter/padding.py",
      "local/reference/padding.py",
      "local/fixtures/generate.py",
      "local/tests/public/test_padding.py",
      "local/tests/hidden/check_padding.py",
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

  it("should name every checkpoint in `make inspect`", () => {
    // A checkpoint `make inspect` forgets is unanswerable, and the symptom is a learner
    // filing "there is no data for this one".
    const result = python(["show.py"]);
    expect(result.status).toBe(0);
    const declared = (
      JSON.parse(read("metadata.json")) as { scoring: { checks: Array<{ id: string }> } }
    ).scoring.checks.map((check) => check.id);
    for (const id of declared) {
      expect(result.stdout).toContain(`== checkpoint: ${id} ==`);
    }
  });

  it("should not print a padded message, which would make `pad` transcription", () => {
    // The one fixture deliberately withheld: seeing the bytes laid out removes the exercise.
    const printed = python(["show.py"]).stdout;
    const padded = pythonValue([
      "from reference.padding import pad_message",
      "from fixtures.generate import text_case",
      "print(pad_message(text_case(sys.argv[1]).text.encode()).hex())",
      "",
    ], SEED);
    expect(padded.length).toBeGreaterThan(0);
    expect(printed).not.toContain(padded);
  });
});

describe("sha256-bytes-padding: container safety", () => {
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
    // The base `FROM` only — the second stage is `FROM participant`, which inherits the pin.
    expect(read("local/Dockerfile")).toMatch(/^FROM \S+@sha256:[0-9a-f]{64}(?: AS \S+)?$/m);
  });

  it("should build the participant stage, not the last one", () => {
    // `docker build` and a compose `build:` with no target both build the LAST stage, which
    // is `author` — the one carrying reference/ and mutation.py.
    expect(read("Makefile")).toContain("docker build --target participant -t $(IMAGE) local");
    expect(read("local/docker-compose.yml")).toMatch(/^\s*target:\s*participant\s*$/m);
  });

  it("should never build a shell command out of participant input", () => {
    const verifier = read("local/verifier/server.py");
    expect(verifier).toContain("shell=False");
    expect(verifier).not.toContain("os.system");
    expect(verifier).not.toContain("shell=True");
  });
});

describe("sha256-bytes-padding: fixtures are seed-derived", () => {
  it("should produce different fixtures for different seeds", () => {
    const lines = [
      "import json",
      "from fixtures.generate import collision_message, length_field_case, length_quiz, text_case, word_case",
      "seed = sys.argv[1]",
      "print(json.dumps({",
      "  'text': text_case(seed).text,",
      "  'lengths': length_quiz(seed),",
      "  'field': length_field_case(seed),",
      "  'block': word_case(seed).hex(),",
      "  'collide': collision_message(seed).hex(),",
      "}))",
    ];
    const first = pythonValue(lines, "seed-alpha");
    const second = pythonValue(lines, "seed-beta");
    const again = pythonValue(lines, "seed-alpha");

    expect(first).not.toBe(second);
    expect(first).toBe(again);
  });

  it("should give padded-length enough seeded answer shapes to defeat guessing", () => {
    const lines = [
      "import json",
      "from fixtures.generate import length_quiz, padded_length",
      "answers = [json.dumps([padded_length(n) for n in length_quiz(f'solvability-{i}')]) for i in range(2000)]",
      "counts = {answer: answers.count(answer) for answer in set(answers)}",
      "print(json.dumps({'distinct': len(counts), 'max': max(counts.values())}))",
    ];
    const distribution = JSON.parse(pythonValue(lines)) as { distinct: number; max: number };
    expect(distribution.distinct).toBeGreaterThan(100);
    expect(distribution.max / 2000).toBeLessThan(0.05);
  });

  it("should always include the 55 and 56 byte boundary in the length quiz", () => {
    // The whole point of the padded-length checkpoint. A seed that dropped these would leave a
    // learner able to pass by "round up to the next multiple of 64".
    for (const seed of ["seed-alpha", "seed-beta", "ci-fixed-seed"]) {
      const lengths = JSON.parse(
        pythonValue(
          ["import json", "from fixtures.generate import length_quiz", "print(json.dumps(length_quiz(sys.argv[1])))"],
          seed,
        ),
      ) as number[];
      expect(lengths).toContain(55);
      expect(lengths).toContain(56);
    }
  });

  it("should give the byte-length checkpoint a string whose byte count differs from its characters", () => {
    for (const seed of ["seed-alpha", "seed-beta", "ci-fixed-seed"]) {
      const [bytes, chars] = JSON.parse(
        pythonValue(
          [
            "import json",
            "from fixtures.generate import text_case",
            "case = text_case(sys.argv[1])",
            "print(json.dumps([case.byte_length, case.char_length]))",
          ],
          seed,
        ),
      ) as [number, number];
      expect(bytes).toBeGreaterThan(chars);
    }
  });
});

describe("sha256-bytes-padding: the padding really is SHA-256's padding", () => {
  it("should produce blocks that reproduce hashlib's digest when compressed by hand", () => {
    // The strongest available check on the reference: run the whole of SHA-256 on top of it,
    // using only the reference's padding and word splitting, and compare against hashlib.
    const digest = pythonValue([
      "import hashlib",
      "from reference.padding import block_words, pad_message",
      "def sha256(message):",
      "    k = [",
      "        0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,",
      "        0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,",
      "        0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,",
      "        0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,",
      "        0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,",
      "        0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,",
      "        0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,",
      "        0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2,",
      "    ]",
      "    h = [0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19]",
      "    mask = 0xffffffff",
      "    rotr = lambda x, n: ((x >> n) | (x << (32 - n))) & mask",
      "    padded = pad_message(message)",
      "    for offset in range(0, len(padded), 64):",
      "        w = block_words(padded[offset:offset + 64])",
      "        for i in range(16, 64):",
      "            s0 = rotr(w[i-15], 7) ^ rotr(w[i-15], 18) ^ (w[i-15] >> 3)",
      "            s1 = rotr(w[i-2], 17) ^ rotr(w[i-2], 19) ^ (w[i-2] >> 10)",
      "            w.append((w[i-16] + s0 + w[i-7] + s1) & mask)",
      "        a, b, c, d, e, f, g, hh = h",
      "        for i in range(64):",
      "            S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)",
      "            ch = (e & f) ^ (~e & mask & g)",
      "            t1 = (hh + S1 + ch + k[i] + w[i]) & mask",
      "            S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)",
      "            maj = (a & b) ^ (a & c) ^ (b & c)",
      "            t2 = (S0 + maj) & mask",
      "            hh, g, f, e, d, c, b, a = g, f, e, (d + t1) & mask, c, b, a, (t1 + t2) & mask",
      "        h = [(x + y) & mask for x, y in zip(h, [a, b, c, d, e, f, g, hh])]",
      "    return ''.join(f'{x:08x}' for x in h)",
      "cases = [b'', b'abc', b'hello world', bytes(55), bytes(56), bytes(63), bytes(64), bytes(120), 'てんか雲'.encode()]",
      "print(all(sha256(m) == hashlib.sha256(m).hexdigest() for m in cases))",
    ]);
    expect(digest).toBe("True");
  });

  it("should place the 55 / 56 boundary where FIPS 180-4 puts it", () => {
    const lengths = pythonValue([
      "import json",
      "from reference.padding import pad_message",
      "print(json.dumps([len(pad_message(bytes(n))) for n in [0, 54, 55, 56, 63, 64, 119, 120]]))",
    ]);
    expect(JSON.parse(lengths)).toEqual([64, 64, 64, 128, 128, 128, 128, 192]);
  });

  it("should write the trailing field as a big-endian bit count", () => {
    const field = pythonValue([
      "from reference.padding import pad_message",
      "print(pad_message(bytes(3))[-8:].hex())",
    ]);
    // 3 bytes = 24 bits = 0x18, most significant byte first.
    expect(field).toBe("0000000000000018");
  });
});

describe("sha256-bytes-padding: the problem is actually solvable and actually fails", () => {
  it("should fail the public tests in the shipped starter state", () => {
    const result = python(["tests/public/test_padding.py"]);
    expect(result.status).not.toBe(0);
    expect(result.stdout).toContain("FAIL");
  });

  it("should pass the public tests once the reference is in place", () => {
    // The public suite imports `starter.padding`, so run it against a copy of the reference
    // rather than editing the checkout. Anything that fails here is a broken public test.
    const result = python([
      "-c",
      [
        "import runpy, sys, types",
        "sys.path.insert(0, '.')",
        "import reference.padding as reference",
        "shim = types.ModuleType('starter.padding')",
        "shim.pad_message = reference.pad_message",
        "shim.block_words = reference.block_words",
        "shim.BLOCK_BYTES = reference.BLOCK_BYTES",
        "package = types.ModuleType('starter')",
        "package.__path__ = []",
        "sys.modules['starter'] = package",
        "sys.modules['starter.padding'] = shim",
        "runpy.run_path('tests/public/test_padding.py', run_name='__main__')",
      ].join("\n"),
    ]);
    expect(result.stdout).not.toContain("FAIL");
    expect(result.stdout).toContain("all passed");
  });

  it("should kill every intended defect in the mutation suite", () => {
    const result = python(["mutation.py"]);
    expect(result.stdout).toContain("PASS reference implementation passes both hidden suites");
    expect(result.stdout).not.toContain("SURVIVED");
    expect(result.status).toBe(0);
  });
});

describe("sha256-bytes-padding: resource caps", () => {
  /**
   * `preexec_fn` runs in the child between fork and exec, so anything it raises aborts the
   * exec and the submission never runs at all — the verifier reports a failure for code that
   * was never executed, including the reference. Darwin aliases RLIMIT_AS onto RLIMIT_RSS and
   * refuses to set it, which is exactly that situation on a macOS checkout.
   */
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

describe("sha256-bytes-padding: /verify contract", () => {
  const reference = read("local/reference/padding.py");
  const starter = read("local/starter/padding.py");

  it("should accept the reference on both implementation checkpoints", () => {
    expect(evaluate("pad", reference)).toBe(true);
    expect(evaluate("words", reference)).toBe(true);
  });

  it("should reject the shipped starter on both implementation checkpoints", () => {
    expect(evaluate("pad", starter)).toBe(false);
    expect(evaluate("words", starter)).toBe(false);
  });

  // The verifier's own wall-clock cap is 10s, so this case necessarily outlives bun's 5s
  // default. That is the behaviour under test, not slowness.
  it(
    "should reject a submission that hangs, rather than hanging itself",
    () => {
      expect(evaluate("pad", "def pad_message(m):\n    while True:\n        pass\n")).toBe(false);
    },
    30_000,
  );

  it("should reject a submission that exits the interpreter", () => {
    expect(evaluate("pad", "raise SystemExit(0)\n")).toBe(false);
  });

  it("should reject a submission that prints a passing verdict from an atexit hook", () => {
    const spoof = [
      "import atexit, json",
      'atexit.register(lambda: print(json.dumps({"failures": []})))',
      "",
    ].join("\n");
    expect(evaluate("pad", spoof)).toBe(false);
    expect(evaluate("words", spoof)).toBe(false);
  });

  it("should reject an unknown checkpoint id instead of crediting it", () => {
    expect(evaluate("finish-everything", "anything")).toBe(false);
  });

  it("should reject a character count on the byte-length checkpoint", () => {
    const [bytes, chars] = JSON.parse(
      pythonValue([
        "import json",
        "from fixtures.generate import text_case",
        "case = text_case(sys.argv[1])",
        "print(json.dumps([case.byte_length, case.char_length]))",
      ], SEED),
    ) as [number, number];
    expect(evaluate("byte-length", String(chars))).toBe(false);
    expect(evaluate("byte-length", String(bytes))).toBe(true);
  });

  it("should reject a non-numeric prediction without evaluating it", () => {
    expect(evaluate("byte-length", "__import__('os').system('true')")).toBe(false);
    expect(evaluate("padded-length", "__import__('os').system('true')")).toBe(false);
  });

  it("should accept the padded lengths in either separator style", () => {
    const expected = JSON.parse(
      pythonValue([
        "import json",
        "from fixtures.generate import length_quiz, padded_length",
        "print(json.dumps([padded_length(n) for n in length_quiz(sys.argv[1])]))",
      ], SEED),
    ) as number[];
    expect(evaluate("padded-length", expected.join(","))).toBe(true);
    expect(evaluate("padded-length", expected.join(" "))).toBe(true);
    expect(evaluate("padded-length", ` ${expected.join(", ")} `)).toBe(true);
    expect(evaluate("padded-length", expected.slice(0, -1).join(","))).toBe(false);
  });

  it("should reject a byte count and a little-endian value on the length-field checkpoint", () => {
    const [big, little, bytesOnly] = JSON.parse(
      pythonValue([
        "import json",
        "from fixtures.generate import length_field_case",
        "n = length_field_case(sys.argv[1])",
        "print(json.dumps([(n * 8).to_bytes(8, 'big').hex(), (n * 8).to_bytes(8, 'little').hex(), n.to_bytes(8, 'big').hex()]))",
      ], SEED),
    ) as [string, string, string];
    expect(evaluate("length-field", big)).toBe(true);
    expect(evaluate("length-field", little)).toBe(false);
    expect(evaluate("length-field", bytesOnly)).toBe(false);
    expect(evaluate("length-field", `0x${big.toUpperCase()}`)).toBe(true);
  });

  it("should require the collision to be a different message that pads identically", () => {
    const original = pythonValue([
      "from fixtures.generate import collision_message",
      "print(collision_message(sys.argv[1]).hex())",
    ], SEED);
    expect(evaluate("collision", original)).toBe(false);
    expect(evaluate("collision", `${original}00`)).toBe(true);
    expect(evaluate("collision", `${original}01`)).toBe(false);
    expect(evaluate("collision", "")).toBe(false);
    expect(evaluate("collision", "zz")).toBe(false);
  });

  it("should echo the checkpointId so the platform can fail closed", () => {
    expect(read("local/verifier/server.py")).toContain(
      '{"checkpointId": checkpoint_id, "correct": correct}',
    );
  });
});

describe("sha256-bytes-padding: scoring follows the tier regulation", () => {
  const meta = JSON.parse(read("metadata.json")) as {
    difficulty: number;
    scoring: {
      kind: string;
      checks: Array<{ id: string; points: number; hints?: Array<{ penalty: number }> }>;
    };
  };

  it("should total the Easy tier's 100 points across its checkpoints", () => {
    expect(meta.scoring.kind).toBe("multi-verify");
    expect(meta.difficulty).toBeLessThanOrEqual(2);
    expect(meta.scoring.checks.reduce((sum, check) => sum + check.points, 0)).toBe(100);

    // The validator enforces the 50 % hint ceiling per checkpoint, which is stricter than
    // SCORING.md's problem-wide wording. Assert the per-checkpoint rule, since that is the gate.
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
    // observe / predict / construct / counterexample here. Recorded as an assertion because a
    // later edit that turned every checkpoint into "submit your file" would still validate.
    const kinds = {
      predict: ["byte-length", "padded-length"],
      observe: ["length-field"],
      construct: ["pad", "words"],
      counterexample: ["collision"],
    };
    expect(Object.keys(kinds).length).toBeGreaterThanOrEqual(3);
    expect(Object.values(kinds).flat().sort()).toEqual(
      meta.scoring.checks.map((check) => check.id).sort(),
    );
  });
});
