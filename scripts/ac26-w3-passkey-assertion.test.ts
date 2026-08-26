import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import { parse as parseYaml } from "yaml";
import { participantPythonFiles } from "./lib/local-play-problems";

/**
 * Issue #363's hard boundary is not merely "one UV test passes".  Every seed must
 * contain a cryptographically valid UV=0 assertion, and that assertion must have
 * exactly one rejection reason.  These tests pin the construction and the public
 * server-record boundary in addition to the ordinary participant contract.
 */

const ROOT = join(import.meta.dir, "..", "challenges", "ac26-w3-passkey-assertion");
const LOCAL = join(ROOT, "local");
const SEED = "passkey-ci-seed";
const CHECKPOINTS = ["signature", "find-uv-gap", "enforce-uv"] as const;

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

function bundle(directory: "starter" | "reference"): string {
  return read(`local/${directory}/assertion.py`);
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

describe("ac26-w3-passkey-assertion: participant contract", () => {
  it("should ship the complete local-play problem", () => {
    for (const path of [
      "Makefile",
      "metadata.json",
      "README.md",
      "README.ja.md",
      "diagram.svg",
      "local/Dockerfile",
      "local/docker-compose.yml",
      "local/show.py",
      "local/mutation.py",
      "local/fixtures/generate.py",
      "local/starter/assertion.py",
      "local/reference/assertion.py",
      "local/tests/public/test_assertion.py",
      "local/tests/hidden/check_assertion.py",
      "local/verifier/server.py",
    ]) {
      expect(existsSync(join(ROOT, path))).toBe(true);
    }
    expect(existsSync(join(ROOT, "local/workbench"))).toBe(false);
  });

  it("should expose the participant and author targets", () => {
    const makefile = read("Makefile");
    for (const target of ["test:", "test-one:", "inspect:", "reset:", "reference-test:", "solvability:"]) {
      expect(makefile).toContain(target);
    }
    expect(makefile).toContain("local/starter:/problem/starter:ro");
    expect(makefile).not.toContain("local/reference:");
    expect(makefile).not.toContain("tests/hidden:");
  });

  it("should leave no scaffold exercise names or story behind", () => {
    const participantFiles = [
      read("Makefile"),
      read("metadata.json"),
      read("README.md"),
      read("README.ja.md"),
      read("local/verifier/server.py"),
    ].join("\n");
    expect(participantFiles).not.toContain("exercise.py");
    expect(participantFiles).not.toContain("modular counter");
    expect(participantFiles).not.toContain("TODO:");
  });
});

describe("ac26-w3-passkey-assertion: fixture construction", () => {
  it("should use the P-256 base point at its real prime order", () => {
    const script = [
      "import sys",
      "sys.path.insert(0, '.')",
      "from fixtures.generate import A, G, N, P, _scalar_mul",
      "x, y = G",
      "B = 0x5AC635D8AA3A93E7B3EBBD55769886BC651D06B0CC53B0F63BCE3C3E27D2604B",
      "print((y*y - (x*x*x + A*x + B)) % P == 0, _scalar_mul(N) is None)",
    ].join("\n");
    expect(python(["-c", script]).stdout.trim()).toBe("True True");
  });

  it("should construct one and only one single-defect case of each kind across seeds", () => {
    const script = [
      "import sys",
      "sys.path.insert(0, '.')",
      "from fixtures.generate import fixture",
      "from reference.assertion import verify_assertion, verify_signature, user_verified",
      "expected = {'honest': {'ok': True, 'reason': 'ok'}, 'no-uv': {'ok': False, 'reason': 'user-verification-required'}, 'bad-signature': {'ok': False, 'reason': 'signature-invalid'}, 'wrong-rp': {'ok': False, 'reason': 'rp-id-mismatch'}}",
      "answers = set()",
      "for index in range(256):",
      "    case = fixture(f'sweep-{index}')",
      "    assert len(case.assertions) == 4 and len({a['caseId'] for a in case.assertions}) == 4",
      "    assert all(a['id'] == case.server_record['credentialId'] for a in case.assertions)",
      "    assert not {'privateKey', 'secretKey', 'password'} & set(case.server_record)",
      "    by_kind = {kind: next(a for a in case.assertions if a['caseId'] == alias) for kind, alias in case.aliases_by_kind.items()}",
      "    for kind, verdict in expected.items(): assert verify_assertion(case.server_record, by_kind[kind], True) == verdict",
      "    assert verify_signature(case.server_record['publicKey'], by_kind['no-uv']) is True",
      "    assert user_verified(by_kind['no-uv']) is False",
      "    answers.add(case.aliases_by_kind['no-uv'])",
      "print(len(answers))",
    ].join("\n");
    const result = python(["-c", script]);
    expect(result.status).toBe(0);
    expect(Number(result.stdout.trim())).toBeGreaterThanOrEqual(10);
  }, 120_000);

  it("should not print a credential private key in participant evidence", () => {
    const output = python(["show.py"]).stdout;
    expect(output).toContain("publicKey");
    expect(output).not.toMatch(/"(privateKey|secretKey|password)"/);
  });
});

describe("ac26-w3-passkey-assertion: tests and verifier", () => {
  it("should fail public tests in the shipped starter state", () => {
    const result = python(["tests/public/test_assertion.py"]);
    expect(result.status).not.toBe(0);
    expect(result.stdout).toContain("FAIL");
  });

  it("should pass public tests with the reference", () => {
    const result = python(["tests/public/test_assertion.py"], LOCAL);
    const rerun = spawnSync("python3", ["tests/public/test_assertion.py"], {
      cwd: LOCAL,
      encoding: "utf8",
      env: { ...process.env, SUBMISSION_DIR: join(LOCAL, "reference"), PYTHONDONTWRITEBYTECODE: "1" },
      timeout: 180_000,
    });
    expect(result.status).not.toBe(0);
    expect(rerun.status).toBe(0);
    expect(rerun.stdout).toContain("6/6 public tests passed");
  });

  it("should kill every intended defect", () => {
    const result = python(["mutation.py"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("PASS reference implementation passes the hidden suite");
    expect(result.stdout).not.toContain("SURVIVED");
    expect(result.stdout).toContain("All 6 mutations killed");
  }, 120_000);

  it.each(CHECKPOINTS)("should accept the reference on %s", (checkpoint) => {
    expect(evaluate(checkpoint, bundle("reference"))).toBe(true);
  }, 120_000);

  it.each(CHECKPOINTS)("should reject the starter on %s", (checkpoint) => {
    expect(evaluate(checkpoint, bundle("starter"))).toBe(false);
  }, 120_000);

  it("should reject unknown checkpoints and echo known ids", () => {
    expect(evaluate("skip-policy", bundle("reference"))).toBe(false);
    expect(read("local/verifier/server.py")).toContain(
      '{"checkpointId": checkpoint_id, "correct": correct}',
    );
  });
});

describe("ac26-w3-passkey-assertion: safety and metadata", () => {
  it("should bind the only port to loopback and pin the participant image", () => {
    const compose = parseYaml(read("local/docker-compose.yml")) as {
      services: Record<string, { ports?: string[] }>;
    };
    const ports = Object.values(compose.services).flatMap((service) => service.ports ?? []);
    expect(ports).toEqual(["127.0.0.1:18121:18121"]);
    expect(read("local/docker-compose.yml")).toContain("${FLAG_SEED:?");
    expect(read("local/Dockerfile")).toMatch(/^FROM \S+@sha256:[0-9a-f]{64}( AS \S+)?$/m);
  });

  it("should sandbox source execution without building a shell command", () => {
    const verifier = read("local/verifier/server.py");
    expect(verifier).toContain("shell=False");
    expect(verifier).not.toContain("shell=True");
    expect(verifier).not.toContain("os.system");
  });

  it("should register a 200-point Week 3 transfer with exact verifier ids", () => {
    const metadata = JSON.parse(read("metadata.json")) as {
      difficulty: number;
      status: string;
      track: { order: number };
      courseAlignment: { week: number; role: string; sources: Array<{ ref: string }> };
      scoring: {
        kind: string;
        checks: Array<{ id: string; points: number; wrongAnswerPenalty: number; input: string }>;
      };
      runtime: { verifyUrl: string; challengeEndpoints?: Record<string, string> };
    };
    expect(metadata.difficulty).toBe(3);
    expect(metadata.status).toBe("draft");
    expect(metadata.track.order).toBe(350);
    expect(metadata.courseAlignment.week).toBe(3);
    expect(metadata.courseAlignment.role).toBe("transfer");
    expect(metadata.scoring.kind).toBe("multi-verify");
    expect(metadata.scoring.checks.map((check) => check.id)).toEqual([...CHECKPOINTS]);
    expect(metadata.scoring.checks.reduce((sum, check) => sum + check.points, 0)).toBe(200);
    expect(metadata.scoring.checks.every((check) => check.wrongAnswerPenalty === 10)).toBe(true);
    expect(metadata.scoring.checks.every((check) => check.input === "multiline")).toBe(true);
    expect(metadata.runtime.verifyUrl).toBe("http://127.0.0.1:18121/verify");
    expect(metadata.runtime.challengeEndpoints).toBeUndefined();
    for (const source of metadata.courseAlignment.sources) expect(source.ref).toMatch(/^[0-9a-f]{40}$/);
  });

  it("should state the incident prerequisites and primary sources without stale claims", () => {
    const docs = `${read("README.md")}\n${read("README.ja.md")}\n${read("metadata.json")}`;
    expect(docs).toContain("passwordless-authentication-security-risks");
    expect(docs).toContain("www.w3.org/TR/webauthn-3");
    expect(docs).toMatch(/Windows[\s\S]{0,80}TPM|TPM[\s\S]{0,80}Windows/);
    expect(docs).toContain("malware");
    expect(docs).toMatch(/eBay[\s\S]{0,120}(fixed|修正)/);
    expect(docs).toContain('The result is not "passkeys are broken."');
  });
});


describe("ac26-w3-passkey-assertion: participant/verifier separation (Issue 537/538)", () => {
  it("keeps fixtures/, the hidden suite and the verifier out of the participant Docker stage", () => {
    const dockerfile = read("local/Dockerfile");
    const participantStage = dockerfile.slice(
      dockerfile.indexOf("FROM base AS participant"),
      dockerfile.indexOf("FROM base AS verifier"),
    );
    // The shape this problem shipped before this fix: one stage carrying
    // `tests/hidden/check_assertion.py` -- which grades all three checkpoints, and
    // states the one-reason verdict strings the starter only describes in prose -- next
    // to `fixtures/generate.py`, which defines `signed_message` under the exact name the
    // starter's own stub asks for and labels every assertion by kind for any seed.
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
    expect(verifierStage).toContain("COPY tests/hidden/");
    expect(verifierStage).toContain("COPY verifier/");
    expect(verifierStage).not.toContain("COPY participant/");
    expect(verifierStage).not.toContain("COPY reference/");
    expect(verifierStage).not.toContain("COPY mutation.py");
  });

  it("reproduces the original leak: nothing the participant image carries reaches signed_message or the assertion kinds", () => {
    // The file list comes from the Dockerfile's participant stage, via the same
    // derivation `check-answer-reachability.ts` uses, rather than being restated here --
    // so a COPY that puts `fixtures/` or `tests/hidden/` back fails this test.
    const participantFiles = participantPythonFiles(
      join(import.meta.dir, ".."),
      "challenges/ac26-w3-passkey-assertion",
    );
    expect(participantFiles).not.toContain(
      "challenges/ac26-w3-passkey-assertion/local/fixtures/generate.py",
    );
    expect(participantFiles).not.toContain(
      "challenges/ac26-w3-passkey-assertion/local/tests/hidden/check_assertion.py",
    );
    expect(participantFiles).toContain(
      "challenges/ac26-w3-passkey-assertion/local/tests/public/test_assertion.py",
    );
    for (const file of participantFiles) {
      const source = readFileSync(join(import.meta.dir, "..", file), "utf8");
      // The one permitted mention is the lazy, function-scoped checkout/author
      // fallback: never a module-level import, which is what would fail loudly the
      // moment it ran inside a participant image that carries no `fixtures/` at all.
      expect(source).not.toMatch(/^from fixtures/m);
      expect(source).not.toMatch(/^import fixtures/m);
    }
    // The starter's own stubs stay -- that is the file the learner edits, and it never
    // held a working implementation.
    const starter = bundle("starter");
    for (const name of [
      "signed_message",
      "verify_signature",
      "user_verified",
      "find_signed_without_user_verification",
    ]) {
      expect(starter).toContain(`def ${name}(`);
      const rest = starter.slice(starter.indexOf(`def ${name}(`) + 1);
      const nextDef = rest.indexOf("\ndef ");
      const body = nextDef === -1 ? rest : rest.slice(0, nextDef);
      expect(body).toContain("raise NotImplementedError");
    }
  });

  it("keeps the Portal editor API and the fixtures import on opposite sides of the split", () => {
    const participantServer = read("local/participant/server.py");
    const hiddenServer = read("local/verifier/server.py");
    for (const endpoint of [
      "/api/config",
      "/api/inspect",
      "/api/starter",
      "/api/test",
      "/api/prepare",
    ]) {
      expect(participantServer).toContain(endpoint);
      expect(hiddenServer).not.toContain(endpoint);
    }
    expect(participantServer).not.toContain("def evaluate(");
    expect(participantServer).not.toContain("def _check_source(");
    expect(participantServer).not.toMatch(/^from fixtures/m);
    expect(participantServer).not.toContain("tests.hidden");
    expect(hiddenServer).toContain("from fixtures.generate import public_payload");
    expect(hiddenServer).toContain("/verify");
    expect(hiddenServer).toContain("/healthz");
    expect(hiddenServer).toContain("/public");
  });

  it("does not let a submission import what the participant image stopped shipping", () => {
    // The grading process runs in the image that still carries `fixtures/` and
    // `tests/hidden/`, so the split alone would leave them one `import` away from the
    // submitted file. The runner drops both packages and the problem root before
    // importing it. This is the one-import path, not the filesystem: honor-system local
    // mode is unchanged (TEMPLATE.md "Assurance scope").
    const runner = read("local/verifier/server.py");
    expect(runner).toContain("sys.modules.pop(module_name, None)");
    expect(runner).toContain("sys.path.remove({root!r})");
    for (const checkpoint of CHECKPOINTS) {
      expect(evaluate(checkpoint, "from fixtures.generate import *\n")).toBe(false);
      expect(evaluate(checkpoint, "from tests.hidden.check_assertion import *\n")).toBe(false);
    }
  }, 120_000);

  it("proxies /verify to the internal verifier and fails closed when it is unreachable", () => {
    const script = String.raw`
import json, sys
sys.path.insert(0, ".")
from participant import server
bodies = [{"checkpointId": checkpoint, "submission": "anything"} for checkpoint in server.CHECKPOINTS]
print(json.dumps({
    "missing": [server.proxy_verdict(body, "") for body in bodies],
    "unavailable": [server.proxy_verdict(body, "http://127.0.0.1:1/verify") for body in bodies],
    "hasInlineEvaluator": hasattr(server, "evaluate") or hasattr(server, "_check_source"),
}))
`;
    const result = python(["-c", script]);
    expect(result.status).toBe(0);
    const output = JSON.parse(result.stdout.trim().split("\n").at(-1) ?? "{}") as {
      missing: Array<{ checkpointId: string; correct: boolean }>;
      unavailable: Array<{ checkpointId: string; correct: boolean }>;
      hasInlineEvaluator: boolean;
    };
    const expectedVerdicts = CHECKPOINTS.map((checkpointId) => ({ checkpointId, correct: false }));
    expect(output.missing).toEqual(expectedVerdicts);
    expect(output.unavailable).toEqual(expectedVerdicts);
    expect(output.hasInlineEvaluator).toBe(false);
  });

  it("serves the deployment's public half without its kind labels, and the worked example with them", () => {
    const script = [
      "import json, sys",
      "sys.path.insert(0, '.')",
      "from fixtures.generate import public_payload",
      "payload = public_payload('public-payload-check')",
      "print(json.dumps({",
      "  'deploymentKeys': sorted(payload['deployment']),",
      "  'deploymentText': json.dumps(payload['deployment']),",
      "  'exampleKeys': sorted(payload['workedExample']),",
      "  'exampleKinds': sorted(payload['workedExample']['aliasesByKind']),",
      "}))",
    ].join("\n");
    const result = python(["-c", script]);
    expect(result.status).toBe(0);
    const payload = JSON.parse(result.stdout.trim().split("\n").at(-1) ?? "{}") as {
      deploymentKeys: string[];
      deploymentText: string;
      exampleKeys: string[];
      exampleKinds: string[];
    };
    expect(payload.deploymentKeys).toEqual(["assertions", "serverRecord"]);
    // Which assertion is which is the answer to two of the three checkpoints.
    expect(payload.deploymentText).not.toContain("aliasesByKind");
    expect(payload.deploymentText).not.toContain("no-uv");
    expect(payload.exampleKeys).toEqual(["aliasesByKind", "assertions", "seed", "serverRecord"]);
    expect(payload.exampleKinds).toEqual(["bad-signature", "honest", "no-uv", "wrong-rp"]);
  });

  it("reads the public evidence over the network, and names the missing service when it cannot", () => {
    const injected = python([
      "-c",
      [
        "import json, sys",
        "sys.path.insert(0, '.')",
        "from fixtures.generate import public_payload",
        "print(json.dumps(public_payload('injected-evidence-seed')))",
      ].join("\n"),
    ]);
    expect(injected.status).toBe(0);
    const payload = injected.stdout.trim().split("\n").at(-1) ?? "{}";
    const shown = spawnSync("python3", ["show.py"], {
      cwd: LOCAL,
      encoding: "utf8",
      env: { PATH: process.env.PATH ?? "", PUBLIC_EVIDENCE_JSON: payload },
      timeout: 180_000,
    });
    expect(shown.status).toBe(0);
    expect(shown.stdout).toContain((JSON.parse(payload) as {
      deployment: { serverRecord: { rpId: string } };
    }).deployment.serverRecord.rpId);

    const unreachable = spawnSync("python3", ["show.py"], {
      cwd: LOCAL,
      encoding: "utf8",
      env: { PATH: process.env.PATH ?? "", VERIFIER_PUBLIC_URL: "http://127.0.0.1:1/public" },
      timeout: 180_000,
    });
    expect(unreachable.status).not.toBe(0);
    expect(`${unreachable.stdout}${unreachable.stderr}`).toContain("make verifier-up");
    expect(unreachable.stderr).not.toContain("Traceback");
  }, 120_000);

  it("runs the participant path through Compose, with the verifier as a health-gated dependency", () => {
    const makefile = read("Makefile");
    for (const target of ["verifier-up:", "verifier-down:", "docker compose -f local/docker-compose.yml -p"]) {
      expect(makefile).toContain(target);
    }
    for (const target of ["test: build verifier-up", "test-one: build verifier-up", "inspect: build verifier-up"]) {
      expect(makefile).toContain(target);
    }

    const compose = read("local/docker-compose.yml");
    for (const contract of [
      "target: participant",
      "target: verifier",
      '"127.0.0.1:18121:18121"',
      "VERIFIER_URL: http://verifier:18146/verify",
      "VERIFIER_PUBLIC_URL: http://verifier:18146/public",
      "condition: service_healthy",
      "internal: true",
      'com.docker.network.bridge.enable_ip_masquerade: "false"',
    ]) {
      expect(compose).toContain(contract);
    }
    // The verifier is reachable from the Workbench and from nowhere else.
    expect(compose).not.toContain('"127.0.0.1:18146:18146"');
    const parsed = parseYaml(compose) as {
      services: Record<string, { ports?: string[]; networks?: string[] }>;
    };
    expect(Object.keys(parsed.services).sort()).toEqual(["verifier", "workbench"]);
    expect(parsed.services.verifier?.ports).toBeUndefined();
    expect(parsed.services.verifier?.networks).toEqual(["lab"]);
  });
});
