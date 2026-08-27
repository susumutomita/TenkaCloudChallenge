import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import { parse as parseYaml } from "yaml";
import { participantPythonFiles } from "./lib/local-play-problems";

/**
 * ac26-w3-nonce-reuse is Week 3's transfer problem. Its assertions run the attack for
 * real against a log that contains three separate decoys — a malformed row, a row that
 * parses and does not verify, and a row from a different signer sharing the commitment.
 * Each one makes a working extraction return a wrong number rather than fail loudly.
 * Python 3 is on ubuntu-latest and the problem is stdlib-only.
 */

const REPO = join(import.meta.dir, "..");
const DIR = "challenges/ac26-w3-nonce-reuse";
const ROOT = join(REPO, DIR);
const LOCAL = join(ROOT, "local");
const SEED = "ci-fixed-seed";
const CHECKPOINTS = [
  "parse",
  "detect",
  "extract",
  "confirm",
  "reject",
  "hunt",
  "collision",
  "repair",
] as const;

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

function bundle(dir: "starter" | "reference"): string {
  return read(`local/${dir}/recover.py`);
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

describe("ac26-w3-nonce-reuse: participant contract", () => {
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
      "local/tests/public/test_recover.py",
      "local/tests/hidden/check_recover.py",
      "local/verifier/server.py",
      "local/participant/server.py",
      "local/participant/schnorr.py",
      "local/starter/recover.py",
      "local/reference/recover.py",
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

  // The premise of the scenario: an audit log does not hold secret keys.
  it("should never put a secret key in the log the learner is given", () => {
    const script = [
      "import sys",
      "sys.path.insert(0, '.')",
      "from fixtures.generate import audit_log, toy_group",
      "g = toy_group(sys.argv[1])",
      "log = audit_log(sys.argv[1], 'public', g)",
      "keys = set()",
      "for record in log['records']:",
      "    keys.update(record.keys())",
      "print(sorted(keys))",
    ].join("\n");
    const keys = python(["-c", script, SEED]).stdout.trim();
    expect(keys).not.toContain("secret");
    expect(keys).toContain("commitment");
    expect(keys).toContain("response");
  });
});

describe("ac26-w3-nonce-reuse: container safety", () => {
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

  it("should pin the base image by digest", () => {
    expect(read("local/Dockerfile")).toMatch(/^FROM \S+@sha256:[0-9a-f]{64}( AS \S+)?$/m);
  });

  it("should never build a shell command out of participant input", () => {
    const verifier = read("local/verifier/server.py");
    expect(verifier).toContain("shell=False");
    expect(verifier).not.toContain("os.system");
    expect(verifier).not.toContain("shell=True");
  });
});

describe("ac26-w3-nonce-reuse: the log contains exactly one solvable reuse", () => {
  it("should keep the reference extraction and hunt answerable across 2000 fixture seeds", () => {
    const script = [
      "import json, sys",
      "sys.path.insert(0, 'reference')",
      "import recover",
      "from tests.hidden import check_recover",
      "bad = {'extract': [], 'hunt': []}",
      "for index in range(2000):",
      "    seed = f'solvability-{index}'",
      "    for name in bad:",
      "        failures = getattr(check_recover, f'check_{name}')(recover, seed)",
      "        if failures: bad[name].append([seed, failures])",
      "print(json.dumps({name: rows[:5] for name, rows in bad.items() if rows}))",
    ].join("\n");
    expect(JSON.parse(python(["-c", script]).stdout.trim())).toEqual({});
    // `python()` above allows the sweep 180s; without this argument Bun stops the test
    // at its own 5s default, so the budget the helper declares is not the budget that
    // binds. This sweep finishes well inside a second alone and was observed at 5017ms
    // -- a timeout, with no failing assertion -- when the whole 125-file suite ran
    // concurrently on a loaded machine. Same fix, same reason, as the eight tests in
    // scripts/cs-http-retry-idempotency.test.ts, one of which did turn main red.
  }, 180_000);

  // Two same-signer reuse groups would make "find the reuse" ambiguous: the attack would
  // recover a key, just not reliably the victim's. On a group this small a hash-derived
  // nonce collides often enough for that to happen, so the honest nonces are chosen.
  it("should have exactly one same-signer commitment collision per log", () => {
    const script = [
      "import sys",
      "sys.path.insert(0, '.')",
      "from collections import Counter",
      "from fixtures.generate import audit_log, toy_group",
      "counts = []",
      "for label in ('public', 'h0', 'h1', 'h2', 'r0'):",
      "    g = toy_group(sys.argv[1], label)",
      "    log = audit_log(sys.argv[1], label, g)",
      "    rows = [r for r in log['records']",
      "            if isinstance(r.get('response'), int) and isinstance(r.get('public_key'), tuple)]",
      "    c = Counter((tuple(r['commitment']), tuple(r['public_key'])) for r in rows)",
      "    counts.append(sum(1 for v in c.values() if v > 1))",
      "print(sorted(set(counts)))",
    ].join("\n");
    expect(python(["-c", script, SEED]).stdout.trim()).toBe("[1]");
  });

  // Each decoy makes a specific wrong implementation produce a wrong answer instead of
  // an error, and each one was added because a mutation survived without it.
  it("should carry all three decoys: malformed, non-accepting, and cross-signer", () => {
    const script = [
      "import sys",
      "sys.path.insert(0, '.')",
      "from fixtures.generate import DOMAINS, audit_log, challenge, toy_group",
      "g = toy_group(sys.argv[1])",
      "log = audit_log(sys.argv[1], 'public', g)",
      "malformed = sum(1 for r in log['records'] if 'response' not in r or 'public_key' not in r)",
      "def accepts(r):",
      "    public = g.point(*r['public_key'])",
      "    commitment = g.point(*r['commitment'])",
      "    e = challenge(DOMAINS[0], commitment, public, r['message'], g)",
      "    return g.generator.scalar_mul(r['response']) == commitment + public.scalar_mul(e)",
      "rows = [r for r in log['records']",
      "        if isinstance(r.get('response'), int) and isinstance(r.get('public_key'), tuple)]",
      "non_accepting = sum(1 for r in rows if not accepts(r))",
      "victim = (log['victim_public'].x, log['victim_public'].y)",
      "reused = [tuple(r['commitment']) for r in rows",
      "          if tuple(r['public_key']) == victim and accepts(r)]",
      "cross = sum(1 for r in rows",
      "            if tuple(r['public_key']) != victim and tuple(r['commitment']) in set(reused))",
      "print(malformed > 0, non_accepting > 0, cross > 0)",
    ].join("\n");
    expect(python(["-c", script, SEED]).stdout.trim()).toBe("True True True");
  });
});

describe("ac26-w3-nonce-reuse: the problem is solvable and actually fails", () => {
  it("should fail the public tests in the shipped starter state", () => {
    const result = python(["tests/public/test_recover.py"]);
    expect(result.status).not.toBe(0);
    expect(result.stdout).toContain("failed");
  });

  it("should kill every intended defect in the mutation suite", () => {
    const result = python(["mutation.py"]);
    expect(result.stdout).toContain("PASS reference implementation passes the hidden tests");
    expect(result.stdout).not.toContain("SURVIVED");
    expect(result.status).toBe(0);
  }, 120_000);
});

describe("ac26-w3-nonce-reuse: /verify contract", () => {
  it.each(CHECKPOINTS)(
    "should accept the reference submission on %s",
    (checkpoint) => {
      expect(evaluate(checkpoint, bundle("reference"))).toBe(true);
    },
    120_000,
  );

  it.each(CHECKPOINTS)(
    "should reject the starter submission on %s",
    (checkpoint) => {
      expect(evaluate(checkpoint, bundle("starter"))).toBe(false);
    },
    120_000,
  );

  // Each of these returns a number. None of them returns the key.
  it("should reject an extraction that divides instead of inverting", () => {
    const source = bundle("reference").replace(
      'return (first["response"] - second["response"]) * pow(e1 - e2, -1, group.n) % group.n',
      'return (first["response"] - second["response"]) // (e1 - e2) % group.n',
    );
    expect(evaluate("extract", source)).toBe(false);
  }, 120_000);

  it("should reject a detector that pairs transcripts from different signers", () => {
    const source = bundle("reference").replace(
      'if a["commitment"] == b["commitment"] and a["public_key"] == b["public_key"]:',
      'if a["commitment"] == b["commitment"]:',
    );
    expect(evaluate("detect", source)).toBe(false);
  }, 120_000);

  it("should reject a detector that ignores whether the transcripts verify", () => {
    const source = bundle("reference").replace(
      "        if accepts(candidate, group):\n            parsed[index] = candidate",
      "        parsed[index] = candidate",
    );
    expect(evaluate("detect", source)).toBe(false);
  }, 120_000);

  // Sixty draws from 65536 are all distinct about 97% of the time, so distinctness
  // alone would let this through. The range check is what rules it out.
  it("should reject a repaired generator truncated to sixteen bits", () => {
    const source = bundle("reference").replace(
      '    return 1 + int.from_bytes(digest, "big") % (group.n - 1)',
      '    return 1 + int.from_bytes(digest, "big") % 65536',
    );
    expect(evaluate("repair", source)).toBe(false);
  }, 120_000);

  it("should reject a nonce derived from the message alone", () => {
    const source = bundle("reference").replace(
      '        b"nonce/v1" + secret.to_bytes(32, "big") + len(message).to_bytes(4, "big") + message',
      '        b"nonce/v1" + len(message).to_bytes(4, "big") + message',
    );
    expect(evaluate("repair", source)).toBe(false);
  }, 120_000);

  it("should reject a submission that hangs, rather than hanging itself", () => {
    expect(
      evaluate("parse", "def parse_record(record, group):\n    while True:\n        pass\n"),
    ).toBe(false);
  }, 60_000);

  it("should reject a submission that cannot even be imported", () => {
    expect(evaluate("parse", "def parse_record(:\n")).toBe(false);
  }, 60_000);

  it("should reject an unknown checkpoint id instead of crediting it", () => {
    expect(evaluate("finish-week3", bundle("reference"))).toBe(false);
  });

  it("should echo the checkpointId so the platform can fail closed", () => {
    expect(read("local/verifier/server.py")).toContain(
      '{"checkpointId": checkpoint_id, "correct": correct}',
    );
  });
});

describe("ac26-w3-nonce-reuse: metadata contracts", () => {
  function metadata() {
    return JSON.parse(read("metadata.json")) as {
      difficulty: number;
      status: string;
      courseAlignment: { week: number; role: string; sources?: Array<{ kind: string; ref: string }> };
      scoring: {
        kind: string;
        checks: Array<{ id: string; points: number; hints?: Array<{ penalty: number }> }>;
      };
    };
  }

  it("should total the Hard tier's 300 points across its checkpoints", () => {
    const meta = metadata();
    expect(meta.scoring.kind).toBe("multi-verify");
    expect(meta.difficulty).toBe(4);
    expect(meta.scoring.checks.reduce((sum, check) => sum + check.points, 0)).toBe(300);
    for (const check of meta.scoring.checks) {
      const penalty = (check.hints ?? []).reduce((sum, hint) => sum + hint.penalty, 0);
      expect(penalty).toBeLessThanOrEqual(check.points / 2);
    }
  });

  it("should score exactly the checkpoints the verifier implements", () => {
    expect(metadata().scoring.checks.map((check) => check.id)).toEqual([...CHECKPOINTS]);
  });

  it("should pin the published week 3 lecture and assignment", () => {
    const { courseAlignment, status } = metadata();
    expect(courseAlignment.week).toBe(3);
    expect(courseAlignment.role).toBe("transfer");
    expect(courseAlignment.sources?.map((source) => source.kind)).toEqual([
      "lecture",
      "assignment",
      // The lecture itself. Pinning only the README meant course:drift watched a 3 KB
      // summary while the 106-slide deck it summarises could change unnoticed.
      "slide",
    ]);
    for (const source of courseAlignment.sources ?? []) {
      expect(source.ref).toMatch(/^[0-9a-f]{40}$/);
    }
    expect(status).toBe("draft");
  });
});

/**
 * Issue 537/538 (Issue 543 option B2). Before the split, one Docker stage carried the
 * Portal, the public tests, `fixtures/generate.py` and `tests/hidden/check_recover.py`
 * at once. Three things in there are answers rather than material: `audit_log` returns
 * `victim_secret` and `victim_public` beside the records the `hunt` checkpoint grades on;
 * `secret_key` derives every key in this deployment from the `FLAG_SEED` the participant
 * container already carries, so the hidden labels' keys were computable in the learner's
 * own container; and `deterministic_nonce` is the `repair` checkpoint's answer with a
 * docstring explaining it. The hidden checker's `_really_accepts` is the acceptance rule
 * `detect` is graded on.
 */
function slicedSource(source: string, from: string, to: string): string {
  const start = source.indexOf(from);
  expect(start).toBeGreaterThanOrEqual(0);
  const end = source.indexOf(to, start + from.length);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end).trimEnd();
}

/**
 * The third probe (docs/AGENT_LOOP_CONSTRAINTS.md §5, the ac26-w2-privacy-audit /
 * ac26-w3-ec-group reading): a submission transcribed out of the two files the single
 * stage shipped, with no reasoning past copying them and wiring them to the starter's
 * declared API. Built from those files' own source so it cannot drift from them.
 */
function transcribedSubmission(): string {
  const fixtures = readFileSync(join(LOCAL, "fixtures", "generate.py"), "utf8");
  const checker = readFileSync(join(LOCAL, "tests", "hidden", "check_recover.py"), "utf8");
  const repairAnswer = slicedSource(fixtures, "def deterministic_nonce(", "\ndef audit_log(");
  const acceptanceRule = slicedSource(checker, "def _really_accepts(", "\ndef check_detect(");
  expect(repairAnswer).toContain('b"nonce/v1" + secret.to_bytes(32, "big")');
  expect(acceptanceRule).toContain("return left == commitment + public.scalar_mul(e)");
  return [
    "import hashlib",
    // challenge/DOMAINS are participant surface either way: the supplied protocol lives
    // in participant/schnorr.py, which both images carry.
    // `Group` is here only because the copied `deterministic_nonce` signature annotates
    // its third argument with it -- the transcription is verbatim, annotations included.
    "from participant.schnorr import DOMAINS, Group, challenge",
    "",
    "",
    "class MalformedRecord(Exception):",
    "    pass",
    "",
    "",
    "def parse_record(record, group):",
    "    return {}",
    "",
    "",
    acceptanceRule,
    "",
    "",
    "accepts = _really_accepts",
    "",
    "",
    // The three conditions are copied out of check_detect's own failure branches.
    "def find_reuse(records, group):",
    "    pairs = []",
    "    for left in range(len(records)):",
    "        for right in range(left + 1, len(records)):",
    "            a, b = records[left], records[right]",
    "            try:",
    "                if a['commitment'] != b['commitment']:",
    "                    continue",
    "                if a['public_key'] != b['public_key']:",
    "                    continue",
    "                if not accepts(a, group) or not accepts(b, group):",
    "                    continue",
    "            except Exception:",
    "                continue",
    "            pairs.append((left, right))",
    "    return pairs",
    "",
    "",
    "def recover_secret(first, second, group):",
    "    return 0",
    "",
    "",
    "def confirms(secret, public, group):",
    "    return False",
    "",
    "",
    "def attack_log(records, group):",
    "    return {}",
    "",
    "",
    "def collision_experiment(seed, group, samples):",
    "    return {}",
    "",
    "",
    repairAnswer,
    "",
    "",
    "safe_nonce = deterministic_nonce",
    "",
  ].join("\n");
}

describe("ac26-w3-nonce-reuse: the participant image carries nothing that grades", () => {
  it("keeps fixtures/, the hidden suite and the verifier out of the participant Docker stage", () => {
    const dockerfile = read("local/Dockerfile");
    const participantStage = dockerfile.slice(
      dockerfile.indexOf("FROM base AS participant"),
      dockerfile.indexOf("FROM base AS verifier"),
    );
    expect(participantStage).not.toContain("COPY fixtures/");
    expect(participantStage).not.toContain("tests/hidden");
    expect(participantStage).not.toContain("COPY verifier/");
    expect(participantStage).not.toContain("COPY reference/");
    expect(participantStage).not.toContain("COPY mutation.py");
    expect(participantStage).toContain("COPY tests/public/");
    expect(participantStage).toContain("COPY participant/");

    const verifierStage = dockerfile.slice(
      dockerfile.indexOf("FROM base AS verifier"),
      dockerfile.indexOf("FROM participant AS author"),
    );
    expect(verifierStage).toContain("COPY fixtures/");
    expect(verifierStage).toContain("COPY tests/");
    expect(verifierStage).toContain("COPY verifier/");
    // The supplied half has to be importable at grading time -- the `collision`
    // checkpoint measures participant/schnorr.py's truncated_nonce, and
    // fixtures/generate.py re-exports the protocol from it -- but the Workbench's own
    // server and Portal support have no business in the grading image.
    expect(verifierStage).toContain("COPY participant/schnorr.py");
    expect(verifierStage).not.toContain("COPY participant/ ");
    expect(verifierStage).not.toContain("COPY reference/");
    expect(verifierStage).not.toContain("COPY mutation.py");
  });

  it("reproduces the original leak: nothing the participant image carries names a key", () => {
    // The file list comes from the Dockerfile's participant stage, via the same
    // derivation `check-answer-reachability.ts` uses, rather than being restated here --
    // so a COPY that puts `fixtures/` or `tests/hidden/` back fails this test.
    const participantFiles = participantPythonFiles(REPO, DIR);
    expect(participantFiles).not.toContain(`${DIR}/local/fixtures/generate.py`);
    expect(participantFiles).not.toContain(`${DIR}/local/tests/hidden/check_recover.py`);
    expect(participantFiles).not.toContain(`${DIR}/local/verifier/server.py`);
    expect(participantFiles).toContain(`${DIR}/local/tests/public/test_recover.py`);
    expect(participantFiles).toContain(`${DIR}/local/participant/schnorr.py`);
    for (const file of participantFiles) {
      const source = readFileSync(join(REPO, file), "utf8");
      // The one permitted mention is the lazy, function-scoped checkout/author fallback
      // in show.py: never a module-level import, which is what would fail loudly the
      // moment it ran inside a participant image that carries no `fixtures/` at all.
      expect(source).not.toMatch(/^from fixtures/m);
      expect(source).not.toMatch(/^import fixtures/m);
      expect(source).not.toMatch(/^from tests\.hidden/m);
      expect(source).not.toMatch(/^from verifier/m);
      // The three answers, by name: the log builder that returns the victim's key, the
      // key derivation, and the repaired generator.
      expect(source).not.toContain("def audit_log");
      expect(source).not.toContain("def secret_key");
      expect(source).not.toContain("def deterministic_nonce");
    }
  });

  it("publishes only the Workbench, and reaches the verifier over an internal network", () => {
    const compose = parseYaml(read("local/docker-compose.yml")) as {
      services: Record<string, Record<string, unknown>>;
      networks: Record<string, Record<string, unknown>>;
    };
    expect(Object.keys(compose.services).sort()).toEqual(["verifier", "workbench"]);
    // The published port and the /verify URL are what metadata.json's runtime declares,
    // and they did not move: the Workbench answers on 18103 and forwards inward.
    expect(compose.services.workbench.ports).toEqual(["127.0.0.1:18103:18103"]);
    expect(compose.services.verifier.ports).toBeUndefined();
    expect(compose.networks.lab.internal).toBe(true);
    expect(compose.services.verifier.networks).toEqual(["lab"]);
    const runtime = JSON.parse(read("metadata.json")).runtime as { verifyUrl: string };
    expect(runtime.verifyUrl).toBe("http://127.0.0.1:18103/verify");
  });

  it("brings the verifier up for every target that needs public evidence", () => {
    // Since the split `show.py` reads this deployment's public half over the compose
    // network, so a bare `docker run` against the participant image cannot serve it.
    const makefile = read("Makefile");
    for (const target of ["test: build verifier-up", "inspect: build verifier-up"]) {
      expect(makefile).toContain(target);
    }
    expect(makefile).toContain("verifier-up:");
    expect(makefile).toContain("verifier-down:");
    // Every problem's compose directory is named `local`, so an unqualified project name
    // collides across problems -- and `--remove-orphans` then deletes another problem's
    // running containers (docs/AGENT_LOOP_CONSTRAINTS.md §6).
    expect(makefile).toContain("-p $(IMAGE)");
    expect(makefile).not.toContain("--remove-orphans");
  });
});

describe("ac26-w3-nonce-reuse: what the split does and does not close", () => {
  it("scores zero for a submission that imports the graded material at grading time", () => {
    // Issue 591: `fixtures/` and `tests/hidden/` are on the runner's sys.path because
    // grading needs them, so the guard in verifier/server.py's RUNNER -- not the Docker
    // split -- is what closes this path. Measured, not assumed. It reads zero here
    // either way, because fixtures/generate.py defines none of the eight names
    // starter/recover.py asks for; the reference passing every checkpoint above is this
    // probe's positive control, since the guard-removal control is flat.
    for (const checkpoint of CHECKPOINTS) {
      expect(evaluate(checkpoint, "from fixtures.generate import *\n")).toBe(false);
    }
  }, 300_000);

  it("scores zero for the module the participant image ships", () => {
    // The other probe: the participant reads what their own container carries and pastes
    // it, so the RUNNER guard -- which only blocks `import` -- is not in the path.
    const shipped = readFileSync(join(LOCAL, "participant", "schnorr.py"), "utf8");
    for (const checkpoint of CHECKPOINTS) {
      expect(evaluate(checkpoint, shipped)).toBe(false);
    }
  }, 300_000);

  it("scores detect and repair for a submission transcribed out of the removed files", () => {
    // The third probe. Neither standard probe says anything here, so without this one the
    // report would be two zeroes and a claim that nothing was leaked. What the single
    // stage handed over is `deterministic_nonce` -- the `repair` answer verbatim -- and
    // `_really_accepts`, the acceptance rule, next to `check_detect`'s own statement of
    // the two other conditions a reported pair must meet.
    //
    // This is what the split closes: the transcription still scores, and the files it was
    // transcribed from are no longer in the participant image (the test above).
    const transcribed = transcribedSubmission();
    const scored = Object.fromEntries(
      CHECKPOINTS.map((checkpoint) => [checkpoint, evaluate(checkpoint, transcribed)]),
    );
    expect(scored).toEqual({
      parse: false,
      detect: true,
      extract: false,
      confirm: false,
      reject: false,
      hunt: false,
      collision: false,
      repair: true,
    });
  }, 300_000);
});

describe("ac26-w3-nonce-reuse: the public half survives the split", () => {
  it("serves show.py every value it used to import, and withholds the answer", () => {
    const script = [
      "import json, sys",
      "sys.path.insert(0, '.')",
      "from fixtures.generate import public_payload, audit_log, toy_group, health_token",
      "from fixtures.generate import NONCE_SPACE",
      "seed = sys.argv[1]",
      "group = toy_group(seed)",
      "log = audit_log(seed, 'public', group)",
      "payload = public_payload(seed)",
      "encoded = json.dumps(payload)",
      "print(json.dumps({",
      "  'health': payload['healthToken'] == health_token(seed),",
      "  'group': payload['group']['p'] == group.p and payload['group']['n'] == group.n,",
      "  'space': payload['nonceSpace'] == NONCE_SPACE,",
      "  'rows': len(payload['records']) == len(log['records']),",
      // The two halves that must not travel are audit_log's other return values: the
      // victim's key answers `hunt` outright, and naming which public key is the
      // victim's answers the half of it that `confirms` is supposed to establish.
      "  'onlyLogFields': all(set(r) <= {'message', 'public_key', 'commitment', 'response'}",
      "                       for r in payload['records']),",
      "  'noVictim': 'victim' not in encoded,",
      "}))",
    ].join("\n");
    const result = python(["-c", script, SEED]);
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout.trim().split("\n").at(-1) ?? "{}")).toEqual({
      health: true,
      group: true,
      space: true,
      rows: true,
      onlyLogFields: true,
      noVictim: true,
    });
  });

  it("prints exactly what it printed before the split, on every seed shape", () => {
    // show.py reads `GET /public` now instead of importing `fixtures.generate`. What a
    // learner sees must not have moved with it, so the payload path is driven straight
    // through show.py -- via PUBLIC_EVIDENCE_JSON, the same value the network branch
    // returns -- and compared against the derivation, across seeds.
    const script = [
      "import io, json, os, contextlib, sys",
      "sys.path.insert(0, '.')",
      "import show",
      "from fixtures.generate import public_payload",
      "disagreed = []",
      "for index in range(30):",
      "    seed = 'show-%d' % index",
      "    os.environ['PUBLIC_EVIDENCE_JSON'] = json.dumps(public_payload(seed))",
      "    injected = io.StringIO()",
      "    with contextlib.redirect_stdout(injected):",
      "        show.main()",
      "    del os.environ['PUBLIC_EVIDENCE_JSON']",
      "    show.SEED = seed",
      "    direct = io.StringIO()",
      "    with contextlib.redirect_stdout(direct):",
      "        show.main()",
      "    if injected.getvalue() != direct.getvalue():",
      "        disagreed.append(index)",
      "print(json.dumps({'disagreed': disagreed}))",
    ].join("\n");
    const result = python(["-c", script]);
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout.trim().split("\n").at(-1) ?? "null")).toEqual({
      disagreed: [],
    });
  }, 180_000);

  it("tells a learner which service is missing when the verifier is not running", () => {
    // show.py inside a participant image has no `fixtures/` to fall back to, so an
    // unreachable verifier must say so rather than raise a urllib traceback at somebody
    // trying to read their own log.
    const result = spawnSync("python3", ["show.py"], {
      cwd: LOCAL,
      encoding: "utf8",
      env: {
        ...process.env,
        FLAG_SEED: SEED,
        PYTHONDONTWRITEBYTECODE: "1",
        // Nothing listens on the discard port.
        VERIFIER_PUBLIC_URL: "http://127.0.0.1:9/public",
      },
      timeout: 60_000,
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("cannot reach this deployment's verifier");
    expect(result.stderr).toContain("make verifier-up");
  });
});
