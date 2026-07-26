import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import { parse as parseYaml } from "yaml";

/**
 * ac26-w3-nonce-reuse is Week 3's transfer problem. Its assertions run the attack for
 * real against a log that contains three separate decoys — a malformed row, a row that
 * parses and does not verify, and a row from a different signer sharing the commitment.
 * Each one makes a working extraction return a wrong number rather than fail loudly.
 * Python 3 is on ubuntu-latest and the problem is stdlib-only.
 */

const ROOT = join(import.meta.dir, "..", "challenges", "ac26-w3-nonce-reuse");
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
    ]);
    for (const source of courseAlignment.sources ?? []) {
      expect(source.ref).toMatch(/^[0-9a-f]{40}$/);
    }
    expect(status).toBe("draft");
  });
});
