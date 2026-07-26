import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import { parse as parseYaml } from "yaml";

/**
 * ac26-w6-zkvm-witness-binding is Week 6's assignment-companion: a zkVM proves that a
 * program ran, and says nothing about which program, which inputs, or which claim. This problem
 * never runs the proving. It grades the contract around it — the public statement, the private
 * witness, and the public journal — because a valid proof bound to the wrong statement is
 * evidence for something nobody intended. The interesting assertions run its Python for real
 * rather than reading source text: the colliding pair really is two real accounts with two real
 * exploits, the four sibling images really do split two and two, the reference passes every
 * checkpoint, the mutation suite kills every intended defect, and /verify holds its contract.
 *
 * Six are about this problem specifically rather than about the template:
 *
 *  - **the premise**. Every seed draws two accounts that are different statements, that a
 *    length-free encoder maps to the same bytes, and that the canonical encoder separates — and
 *    both of them admit an exploit the reference guest accepts. If either member stopped being a
 *    real account with a real exploit, the headline failure would be "a malformed statement slips
 *    through" rather than "a valid proof about one is a valid proof about the other".
 *  - **two images are the base program and two are not**. `renamed` and `relabelled` carry the
 *    same bytes; `rebuilt` and `restamped` do not. Every way of getting `image_digest` wrong gets
 *    a different pair wrong, which is only true while the split is really two and two.
 *  - **the host's account is wrong on every field**. The hints the reexec checkpoint hands over
 *    disagree with the truth on all seven run fields, so a guest that reads any one of them is
 *    caught by that field rather than by luck.
 *  - **two of the ten runs disclose nothing, and one of them is loud**. An audit graded only on
 *    runs that leak learns to answer "yes" and is right nine times out of ten.
 *  - **which checkpoint catches which defect**, measured. Most defects are local to one
 *    checkpoint. Two are not, and the coupling is real rather than incidental: `image_digest` is
 *    what `run_guest` fails closed on, and `_is_statement` is what four of the seven functions
 *    refuse with.
 *  - **the encoding defect stays inside its own checkpoint**. The replay checkpoint seals the
 *    receipts it offers with the submission's own encoder, so a guest whose encoder collides is
 *    handed a receipt that genuinely does verify against both accounts — and fails the row that
 *    offers the pair against each other, which is the failure itself rather than a second report
 *    of what the encoding checkpoint already said.
 */

const ROOT = join(import.meta.dir, "..", "challenges", "ac26-w6-zkvm-witness-binding");
const LOCAL = join(ROOT, "local");
const SEED = "ci-fixed-seed";
const CHECKPOINTS = [
  "encoding",
  "identity",
  "ingestion",
  "reexec",
  "journal",
  "replay",
  "privacy",
  "transfer",
] as const;
const PINNED = "5e80999306608a45aecf9a0e4e3394a0b62f34d2";
/** Measured by `make reference-test`; both READMEs quote these two numbers. */
const BROKEN_GUESTS = 55;
const WEAK_PROBE_BLIND = 42;

function read(relativePath: string): string {
  return readFileSync(join(ROOT, relativePath), "utf8");
}

function python(args: string[], cwd = LOCAL) {
  return spawnSync("python3", args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, FLAG_SEED: SEED, PYTHONDONTWRITEBYTECODE: "1" },
    timeout: 900_000,
  });
}

function bundle(dir: "starter" | "reference"): string {
  return read(`local/${dir}/guest.py`);
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

describe("ac26-w6-zkvm-witness-binding: participant contract", () => {
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
      "local/tests/public/test_guest.py",
      "local/tests/hidden/check_guest.py",
      "local/verifier/server.py",
      "local/starter/guest.py",
      "local/reference/guest.py",
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

describe("ac26-w6-zkvm-witness-binding: container safety", () => {
  it("should publish every port on loopback only", () => {
    const compose = parseYaml(read("local/docker-compose.yml")) as {
      services: Record<string, { ports?: string[] }>;
    };
    const ports = Object.values(compose.services).flatMap((service) => service.ports ?? []);
    expect(ports.length).toBeGreaterThan(0);
    for (const mapping of ports) expect(mapping.startsWith("127.0.0.1:")).toBe(true);
  });

  it("should bound the verifier itself, not only the submissions it runs", () => {
    const compose = read("local/docker-compose.yml");
    expect(compose).toContain("mem_limit:");
    expect(compose).toContain("pids_limit:");
  });

  it("should require FLAG_SEED rather than defaulting to a committed value", () => {
    expect(read("local/docker-compose.yml")).toContain("${FLAG_SEED:?");
  });

  it("should pin the base image by digest", () => {
    expect(read("local/Dockerfile")).toMatch(/^FROM \S+@sha256:[0-9a-f]{64}$/m);
  });

  it("should never build a shell command out of participant input", () => {
    const verifier = read("local/verifier/server.py");
    expect(verifier).toContain("shell=False");
    expect(verifier).not.toContain("os.system");
    expect(verifier).not.toContain("shell=True");
  });
});

describe("ac26-w6-zkvm-witness-binding: fixtures are seed-derived", () => {
  it("should produce a different statement for a different seed", () => {
    const script = [
      "import json, sys",
      "sys.path.insert(0, '.')",
      "from fixtures.generate import health_token, statement, statement_id",
      "seed = sys.argv[1]",
      "print(json.dumps({'s': statement_id(statement(seed)), 'h': health_token(seed)}))",
    ].join("\n");
    const first = python(["-c", script, "seed-alpha"]).stdout.trim();
    const second = python(["-c", script, "seed-beta"]).stdout.trim();
    const again = python(["-c", script, "seed-alpha"]).stdout.trim();

    expect(first).not.toBe(second);
    expect(first).toBe(again);
  });

  it("should vary the width, the account, the protocol namespace and the guest build", () => {
    const script = [
      "import json, sys",
      "sys.path.insert(0, '.')",
      "from fixtures.generate import statement, statement_id",
      "drawn = [statement('s%d' % i, label) for i in range(30) for label in ('a', 'b')]",
      "print(json.dumps({",
      "    'ids': len({statement_id(s) for s in drawn}),",
      "    'semantics': len({s['semantics'] for s in drawn}),",
      "    'domains': len({s['domain'] for s in drawn}),",
      "    'guests': len({s['guestVersion'] for s in drawn}),",
      "}))",
    ].join("\n");
    const drawn = JSON.parse(python(["-c", script]).stdout.trim()) as Record<string, number>;
    expect(drawn.ids).toBeGreaterThan(30);
    expect(drawn.semantics).toBeGreaterThan(2);
    // Both vocabularies have exactly two members, and a statement that never varies them would
    // make the two fields people drop first -- "they do not affect the computation" -- untestable.
    expect(drawn.domains).toBe(2);
    expect(drawn.guests).toBe(2);
  });

  it("should draw its widths from a set that contains no familiar mask", () => {
    const script = [
      "import json, sys",
      "sys.path.insert(0, '.')",
      "from fixtures.generate import SEMANTICS, WIDTHS, statement",
      "drawn = sorted({SEMANTICS[statement('w%d' % i, label)['semantics']]['width']",
      "                for i in range(40) for label in ('a', 'b', 'c')})",
      "print(json.dumps({'declared': sorted(WIDTHS), 'drawn': drawn}))",
    ].join("\n");
    const { declared, drawn } = JSON.parse(python(["-c", script]).stdout.trim()) as {
      declared: number[];
      drawn: number[];
    };
    expect(declared).toEqual([7, 9, 10, 11, 12, 13]);
    expect(drawn).toEqual(declared);
    for (const familiar of [8, 16, 32, 64]) expect(declared).not.toContain(familiar);
  });
});

describe("ac26-w6-zkvm-witness-binding: the premise holds", () => {
  it("should draw two real accounts a length-free encoder cannot tell apart", () => {
    // The headline of the whole problem, and the one thing `make inspect` answers outright. If
    // either member stopped being an account with a real exploit, the failure would be "a
    // malformed statement slips through" rather than "a valid proof about one real account is a
    // valid proof about a different real account". Measured against the reference guest.
    const script = [
      "import sys",
      "sys.path.insert(0, '.')",
      "sys.path.insert(0, 'reference')",
      "from fixtures.generate import (",
      "    Env, collision_pair, decode_program, exploit_witness, image, naive_encode)",
      "import guest",
      "held = draws = 0",
      "for i in range(12):",
      "    for label in ('a', 'b'):",
      "        seed = 'pair%d' % i",
      "        draws += 1",
      "        left, right = collision_pair(seed, label)",
      "        built = image(seed, label)",
      "        program = decode_program(built['body'])",
      "        exploited = []",
      "        for member in (left, right):",
      "            env = Env()",
      "            witness = exploit_witness(member, program, 'mul')",
      "            guest.guest_input(env, dict(member), witness)",
      "            run = guest.run_guest(dict(built), env)",
      "            exploited.append(run['claimResult'] is True)",
      "        if (",
      "            left != right",
      "            and naive_encode(left) == naive_encode(right)",
      "            and guest.encode_statement(dict(left)) != guest.encode_statement(dict(right))",
      "            and all(exploited)",
      "        ):",
      "            held += 1",
      "print(held, draws)",
    ].join("\n");
    expect(python(["-c", script]).stdout.trim()).toBe("24 24");
  }, 900_000);

  it("should separate every pair in the statement family, the two soft fields included", () => {
    // `domain` and `guestVersion` are the two fields dropped first, because they "do not affect
    // the computation". A family member differing only in one of them is a different statement.
    const script = [
      "import sys",
      "sys.path.insert(0, '.')",
      "sys.path.insert(0, 'reference')",
      "from fixtures.generate import naive_collisions, statement_family",
      "import guest",
      "separated = collided = draws = 0",
      "for i in range(12):",
      "    for label in ('a', 'b'):",
      "        seed = 'family%d' % i",
      "        draws += 1",
      "        family = statement_family(seed, label)",
      "        encoded = {guest.encode_statement(dict(member)) for member in family}",
      "        separated += 1 if len(encoded) == len(family) == 9 else 0",
      "        collided += len(naive_collisions(seed, label))",
      "print(separated, draws, collided)",
    ].join("\n");
    // Nine distinct statements, canonically distinct every draw, and exactly one pair a
    // length-free encoder merges -- so the collision is a property of the encoder, not of a
    // family that happens to contain near-duplicates.
    expect(python(["-c", script]).stdout.trim()).toBe("24 24 24");
  }, 900_000);

  it("should make two of the four sibling images the base program and two not", () => {
    const script = [
      "import sys",
      "sys.path.insert(0, '.')",
      "sys.path.insert(0, 'reference')",
      "from fixtures.generate import image, sibling_images",
      "import guest",
      "split = draws = 0",
      "for i in range(12):",
      "    for label in ('a', 'b'):",
      "        seed = 'images%d' % i",
      "        draws += 1",
      "        base = guest.image_digest(dict(image(seed, label)))",
      "        same = {name: guest.image_digest(dict(sibling)) == base",
      "                for name, sibling in sibling_images(seed, label).items()}",
      "        if same == {'rebuilt': False, 'restamped': False,",
      "                    'renamed': True, 'relabelled': True}:",
      "            split += 1",
      "print(split, draws)",
    ].join("\n");
    expect(python(["-c", script]).stdout.trim()).toBe("24 24");
  }, 900_000);

  it("should hand the reexec checkpoint a host account that is wrong on every run field", () => {
    // A guest that believes one hint has to be caught by that field rather than by luck, so no
    // hinted value may coincide with the truth on any of the seven.
    const script = [
      "import sys",
      "sys.path.insert(0, '.')",
      "from fixtures.generate import RUN_FIELDS, scenario",
      "from tests.hidden.check_guest import LABELS, _misleading, _run",
      "wrong = total = 0",
      "for label in LABELS:",
      "    built = scenario('ci-fixed-seed', label)",
      "    truth = _run(built['image'], built['statement'], built['witness'])",
      "    hinted = _misleading(truth)",
      "    for field in RUN_FIELDS:",
      "        total += 1",
      "        wrong += 1 if hinted[field] != truth[field] else 0",
      "print(wrong, total)",
    ].join("\n");
    expect(python(["-c", script]).stdout.trim()).toBe("28 28");
  });

  it("should leave exactly two of the ten runs clean, one of them loud", () => {
    // An audit graded only on runs that leak learns to answer "yes" and is right nine times out
    // of ten. The loud one fills four channels with numbers and discloses nothing.
    const script = [
      "import sys",
      "sys.path.insert(0, '.')",
      "from fixtures.generate import CHANNELS, disclosure_truth, disclosures",
      "clean = loud = draws = 0",
      "for i in range(12):",
      "    for label in ('a', 'b'):",
      "        seed = 'audit%d' % i",
      "        draws += 1",
      "        truth = disclosure_truth(seed, label)",
      "        spotless = [name for name, leaks in truth.items() if not leaks]",
      "        clean += 1 if len(spotless) == 2 and len(truth) == 10 else 0",
      "        by_id = {entry['id']: entry['disclosure'] for entry in disclosures(seed, label)}",
      "        filled = [sum(1 for channel in CHANNELS[1:]",
      "                      if getattr(by_id[name], channel))",
      "                  for name in spotless]",
      "        loud += 1 if max(filled) >= 4 else 0",
      "print(clean, loud, draws)",
    ].join("\n");
    expect(python(["-c", script]).stdout.trim()).toBe("24 24 24");
  });

  it("should leave exactly two of the fifteen offered receipts honest", () => {
    const script = [
      "import sys",
      "sys.path.insert(0, '.')",
      "from fixtures.generate import replay_cases, replay_truth",
      "honest = draws = 0",
      "for i in range(12):",
      "    for label in ('a', 'b'):",
      "        seed = 'replay%d' % i",
      "        draws += 1",
      "        truth = replay_truth(seed, label)",
      "        honest += 1 if sum(truth.values()) == 2 and len(replay_cases(seed, label)) == 15 else 0",
      "print(honest, draws)",
    ].join("\n");
    expect(python(["-c", script]).stdout.trim()).toBe("24 24");
  });
});

describe("ac26-w6-zkvm-witness-binding: the problem is solvable and actually fails", () => {
  it("should fail the public tests in the shipped starter state", () => {
    const result = python(["tests/public/test_guest.py"]);
    expect(result.status).not.toBe(0);
    expect(result.stdout).toContain("FAIL");
  });

  it("should kill every intended defect in the mutation suite", () => {
    const result = python(["mutation.py"]);
    expect(result.stdout).toContain("PASS reference implementation passes the hidden tests");
    expect(result.stdout).not.toContain("SURVIVED");
    expect(result.status).toBe(0);
  }, 1_800_000);

  it("should still measure how many broken guests the weak probe cannot see", () => {
    // Both READMEs quote this count. The happy path verifying and a receipt offered against a
    // different program being refused are the two questions anybody writing a test for a guest
    // contract asks first, and they are the two the problem text states outright -- so most of
    // the broken guests answer them correctly. If a later edit made the checkpoints cheaper the
    // number moves, and the claim has to move with it rather than quietly going stale.
    const result = python(["mutation.py"]);
    expect(result.stdout).toContain(
      `${WEAK_PROBE_BLIND} of ${BROKEN_GUESTS} broken guests still get the easy two right`,
    );
    for (const readme of ["README.md", "README.ja.md"]) {
      expect(read(readme)).toContain(String(WEAK_PROBE_BLIND));
      expect(read(readme)).toContain(String(BROKEN_GUESTS));
    }
  }, 1_800_000);

  it("should keep the dropped mutation genuinely undetectable, not merely unwritten", () => {
    // Both READMEs say one candidate was written and then removed rather than shipped as a
    // survivor: `run_guest` reporting the statement's digest instead of the one it computed.
    // The claim is that no input separates the two, because the function refuses before running
    // whenever they differ. Measured here, so the paragraph cannot quietly become false.
    const script = [
      "import sys",
      "sys.path.insert(0, '.')",
      "from mutation import REFERENCE, SEED, _load",
      "from tests.hidden.check_guest import run",
      "source = REFERENCE.replace(",
      "    '        \"imageDigest\": digest,\\n',",
      "    '        \"imageDigest\": statement[\"imageDigest\"],\\n')",
      "assert source != REFERENCE",
      "print(len(run(_load(source), SEED)))",
    ].join("\n");
    expect(python(["-c", script]).stdout.trim()).toBe("0");
    for (const readme of ["README.md", "README.ja.md"]) {
      expect(read(readme)).toContain('statement["imageDigest"]');
    }
  }, 1_800_000);

  it("should show the statement, the machine and the image in make inspect", () => {
    const result = python(["show.py"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("== the public statement ==");
    expect(result.stdout).toContain("== two statements one encoder cannot tell apart ==");
    expect(result.stdout).toContain("== the runner's two doors ==");
    expect(result.stdout).toContain("health token:");
  });

  it("should never let make inspect print an exploit quantity or an answer", () => {
    // `inspect` is the one place a learner sees the objects before writing anything, and it has
    // to do it without answering a graded question: which quantity exploits this account, which
    // sibling is the same program, which receipt verifies, or which run leaked.
    const script = [
      "import json, os, sys",
      "sys.path.insert(0, '.')",
      "from fixtures.generate import disclosure_truth, replay_truth, scenario",
      "seed = os.environ['FLAG_SEED']",
      "print(json.dumps({",
      "    'quantities': [scenario(seed, 'public', site=s)['witness']['quantity']",
      "                   for s in ('mul', 'add')],",
      "    'leaks': {name: [list(pair) for pair in leaks]",
      "              for name, leaks in disclosure_truth(seed, 'public').items()},",
      "    'replay': replay_truth(seed, 'public'),",
      "}))",
    ].join("\n");
    const { quantities, leaks, replay } = JSON.parse(python(["-c", script]).stdout.trim()) as {
      quantities: number[];
      leaks: Record<string, string[][]>;
      replay: Record<string, boolean>;
    };
    const printed = python(["show.py"]).stdout;

    for (const quantity of quantities) {
      expect(printed).not.toMatch(new RegExp(`(?<![0-9])${quantity}(?![0-9])`));
    }
    // Every disclosure id and every replay id is listed -- that is the point of those sections --
    // but never next to the verdict behind it.
    for (const [id, pairs] of Object.entries(leaks)) {
      expect(printed).toContain(id);
      for (const [channel, name] of pairs) {
        expect(printed).not.toMatch(new RegExp(`${id}\\b.*${channel}.*${name}`));
      }
    }
    for (const id of Object.keys(replay)) expect(printed).toContain(id);
    expect(printed).not.toMatch(/honest\b[^\n]*\b(verifies|accepted)\b/);
  });
});

describe("ac26-w6-zkvm-witness-binding: /verify contract", () => {
  it.each(CHECKPOINTS)(
    "should accept the reference submission on %s",
    (checkpoint) => {
      expect(evaluate(checkpoint, bundle("reference"))).toBe(true);
    },
    1_800_000,
  );

  it.each(CHECKPOINTS)(
    "should reject the starter submission on %s",
    (checkpoint) => {
      expect(evaluate(checkpoint, bundle("starter"))).toBe(false);
    },
    1_800_000,
  );

  it("should reject a submission that hangs, rather than hanging itself", () => {
    expect(
      evaluate("encoding", "def encode_statement(statement):\n    while True:\n        pass\n"),
    ).toBe(false);
  }, 1_800_000);

  it("should reject an unknown checkpoint id instead of crediting it", () => {
    expect(evaluate("finish-week6", bundle("reference"))).toBe(false);
  });

  it("should echo the checkpointId so the platform can fail closed", () => {
    expect(read("local/verifier/server.py")).toContain(
      '{"checkpointId": checkpoint_id, "correct": correct}',
    );
  });
});

describe("ac26-w6-zkvm-witness-binding: what each checkpoint is worth", () => {
  /** Run one mutation of the reference through every hidden phase, and name the catchers. */
  function phasesCatching(mutationName: string): string[] {
    const script = [
      "import json, sys",
      "sys.path.insert(0, '.')",
      "from mutation import _load, _mutations, SEED",
      "from tests.hidden.check_guest import PHASES",
      "source = dict(_mutations())[sys.argv[1]]",
      "module = _load(source)",
      "print(json.dumps([p.__name__ for p in PHASES if p(module, SEED)]))",
    ].join("\n");
    const result = python(["-c", script, mutationName]);
    expect(result.status).toBe(0);
    return JSON.parse(result.stdout.trim().split("\n").at(-1) ?? "null") as string[];
  }

  // `check_transfer` re-runs every other phase under a derived seed, so it is expected to
  // appear alongside whichever phase actually did the catching.
  it("should let only the encoding checkpoint catch an encoding with no length prefixes", () => {
    // The signature defect. It stays local because the replay checkpoint seals the receipts it
    // offers with the submission's own encoder: a colliding encoder is handed a receipt that
    // genuinely verifies against both accounts, which is the failure rather than a second report
    // of it -- and that row is inside `check_replay`, not `check_encoding`.
    expect(phasesCatching("the encoding has no length prefixes")).toEqual([
      "check_encoding",
      "check_transfer",
    ]);
  }, 1_800_000);

  it("should let only the ingestion checkpoint catch a witness sent as a public input", () => {
    expect(phasesCatching("the witness travels as a public input")).toEqual([
      "check_ingestion",
      "check_transfer",
    ]);
  }, 1_800_000);

  it("should let only the reexec checkpoint catch a guest that believes the host", () => {
    expect(phasesCatching("the guest believes the host's verdict")).toEqual([
      "check_reexec",
      "check_transfer",
    ]);
  }, 1_800_000);

  it("should let only the journal checkpoint catch a measurement nobody could recompute", () => {
    expect(phasesCatching("the journal carries a cycle count next to the step count")).toEqual([
      "check_journal",
      "check_transfer",
    ]);
  }, 1_800_000);

  it("should let only the replay checkpoint catch a receipt read off its own journal", () => {
    expect(phasesCatching("a receipt is accepted on the strength of its own journal")).toEqual([
      "check_replay",
      "check_transfer",
    ]);
  }, 1_800_000);

  it("should let only the privacy checkpoint catch an approved name carrying anything", () => {
    expect(phasesCatching("an approved name is an approval, whatever it carries")).toEqual([
      "check_privacy",
      "check_transfer",
    ]);
  }, 1_800_000);

  it("should fail identity and reexec together when a program is named by its path", () => {
    // `run_guest` fails closed by comparing `image_digest` against the statement, so a digest
    // over the wrong field is both a wrong name and a run that refuses everything. The coupling
    // is the design rather than an accident: one function decides what a program is called, and
    // the other refuses to execute anything else.
    expect(phasesCatching("a program is named by where the toolchain says it was built")).toEqual([
      "check_identity",
      "check_reexec",
      "check_transfer",
    ]);
  }, 1_800_000);

  it("should fail four checkpoints when a statement may name a protocol nobody implemented", () => {
    // What counts as a statement is asked by four of the seven functions, so relaxing it is not
    // a local defect and is not priced as one.
    expect(phasesCatching("a claim may be made in a protocol nobody implemented")).toEqual([
      "check_encoding",
      "check_ingestion",
      "check_reexec",
      "check_journal",
      "check_transfer",
    ]);
  }, 1_800_000);
});

describe("ac26-w6-zkvm-witness-binding: metadata contracts", () => {
  function metadata() {
    return JSON.parse(read("metadata.json")) as {
      difficulty: number;
      exposedPorts: Array<{ port: number }>;
      runtime: { verifyUrl: string };
      track: { order: number };
      courseAlignment: { week: number; role: string; sources?: Array<Record<string, string>> };
      scoring: {
        kind: string;
        checks: Array<{
          id: string;
          points: number;
          wrongAnswerPenalty: number;
          hints?: Array<{ id: string; penalty: number }>;
        }>;
      };
    };
  }

  it("should total the Hard tier's 300 points across its checkpoints", () => {
    const meta = metadata();
    expect(meta.scoring.kind).toBe("multi-verify");
    expect(meta.difficulty).toBe(5);
    expect(meta.scoring.checks).toHaveLength(CHECKPOINTS.length);
    expect(meta.scoring.checks.reduce((sum, check) => sum + check.points, 0)).toBe(300);
    for (const check of meta.scoring.checks) {
      const penalty = (check.hints ?? []).reduce((sum, hint) => sum + hint.penalty, 0);
      expect(penalty).toBeLessThanOrEqual(check.points / 2);
    }
    // Opening every hint still has to leave more than half the problem standing, or the hints
    // are a second scoring scheme rather than a cost.
    const total = meta.scoring.checks
      .flatMap((check) => check.hints ?? [])
      .reduce((sum, hint) => sum + hint.penalty, 0);
    expect(total).toBeLessThanOrEqual(150);
    const ids = meta.scoring.checks.flatMap((check) => (check.hints ?? []).map((hint) => hint.id));
    expect(new Set(ids).size).toBe(ids.length);
    for (const check of meta.scoring.checks) expect(check.wrongAnswerPenalty).toBe(15);
  });

  // The multi-verify cap is eight, mirrored in SCHEMA.json and in the platform's problem-sdk,
  // which drops the whole scoring object rather than truncating it. Issue #243 asks for eight
  // checkpoints, which fits exactly -- a ninth would have to merge two, not raise a cap on one
  // side.
  it("should declare exactly the eight checkpoints the verifier serves", () => {
    expect(metadata().scoring.checks.map((check) => check.id)).toEqual([...CHECKPOINTS]);
    const script = [
      "import json, sys",
      "sys.path.insert(0, '.')",
      "from verifier.server import CODE_CHECKPOINTS",
      "print(json.dumps(sorted(CODE_CHECKPOINTS)))",
    ].join("\n");
    const served = JSON.parse(python(["-c", script]).stdout.trim()) as string[];
    expect(served).toEqual([...CHECKPOINTS].sort());
  });

  it("should point the platform at the port the compose file publishes", () => {
    const meta = metadata();
    expect(meta.exposedPorts.map((entry) => entry.port)).toEqual([18117]);
    expect(meta.runtime.verifyUrl).toBe("http://127.0.0.1:18117/verify");
    expect(read("local/docker-compose.yml")).toContain("127.0.0.1:18117:18117");
  });

  it("should sit after its prerequisite in the track", () => {
    // It is the sequel to `ac26-w6-zkvm-exploit-predicate` (order 640) and says so in `requires`.
    expect(metadata().track.order).toBe(650);
    expect(read("metadata.json")).toContain('"target": "problem.ac26-w6-zkvm-exploit-predicate"');
  });

  it("should pin week 6's published material as an assignment-companion", () => {
    const { courseAlignment } = metadata();
    expect(courseAlignment.week).toBe(6);
    expect(courseAlignment.role).toBe("assignment-companion");
    expect(courseAlignment.sources).toEqual([
      {
        repository: "zk-tokyo/advanced-cryptography-2026",
        ref: PINNED,
        path: "week6/README.md",
        kind: "lecture",
      },
      {
        repository: "zk-tokyo/advanced-cryptography-2026",
        ref: PINNED,
        path: "week6/problems/zkvm-exploit/README.md",
        kind: "assignment",
      },
    ]);
  });

  // ASSESSMENT.md: an assignment-companion must carry at least one predict or counterexample
  // checkpoint, because it sits closest to the official exercise and is the easiest to
  // accidentally turn into a walkthrough of it. `replay` is that checkpoint -- it hands over
  // receipts that are valid and are evidence for something else, and a walkthrough of the
  // official exercise does not answer it.
  it("should carry a counterexample checkpoint, as its role requires", () => {
    expect(metadata().scoring.checks.map((check) => check.id)).toContain("replay");
  });

  it("should keep the participant-facing text free of the answers", () => {
    // The fairness contract (#1124): `description` and `writeup` are operator-facing and may
    // spoil; `instructions` is what a competitor reads and may not. The three answers this
    // problem is graded on are which siblings are the same program, which receipts verify, and
    // which runs leaked.
    const meta = JSON.parse(read("metadata.json")) as {
      instructions: string;
      i18n: { en: { instructions: string } };
    };
    for (const text of [meta.instructions, meta.i18n.en.instructions]) {
      for (const answer of ["renamed", "relabelled", "restamped", "rebuilt"]) {
        expect(text).not.toContain(answer);
      }
    }
  });
});
