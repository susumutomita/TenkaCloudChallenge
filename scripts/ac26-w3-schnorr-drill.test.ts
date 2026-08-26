import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import { parse as parseYaml } from "yaml";
import { participantPythonFiles } from "./lib/local-play-problems";

/**
 * ac26-w3-schnorr-drill is a drill: twelve lines typed into the learner's own Python, eight
 * of them direct-answer checkpoints (the platform's per-problem maximum), each the value
 * one line prints against this deployment's numbers. No checkpoint runs learner code, so
 * the contract tested here is the value grader — exact, seed-bound, refusing the
 * near-misses a learner would paste — plus the participant surface every AC26 problem
 * ships.
 */

const ROOT = join(import.meta.dir, "..", "challenges", "ac26-w3-schnorr-drill");
const LOCAL = join(ROOT, "local");
const SEED = "ci-fixed-seed";

/** The eight graded lines, in drill order. */
const LINES = [
  "field-inv",
  "add-points",
  "double",
  "order",
  "response",
  "verify",
  "nonce-reuse",
  "transfer",
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

/**
 * This seed's expected values and public numbers, as JSON.
 *
 * `expected_for` lives only in `verifier/expected.py` (Issue 543/537): reading it here
 * from the checkout, rather than the participant Docker image, is deliberate -- this
 * helper is test-only tooling with full repository access, the same way
 * `mutation.py` and `tests/hidden/check_schnorr_drill.py` are. What must NOT resolve
 * `expected_for` is the participant image itself; that boundary is asserted separately
 * in the "participant/verifier separation" describe block below.
 */
function deployment(seed = SEED): { expected: Record<string, unknown>; public: Record<string, unknown> } {
  const script = [
    "import json, sys",
    "sys.path.insert(0, '.')",
    "from fixtures.generate import setting",
    "from verifier.expected import expected_for",
    "pub = setting(sys.argv[1])['public']",
    "print(json.dumps({'expected': expected_for(sys.argv[1]), 'public': pub}))",
  ].join("\n");
  const result = python(["-c", script, seed]);
  expect(result.status).toBe(0);
  return JSON.parse(result.stdout.trim().split("\n").at(-1) ?? "{}");
}

describe("ac26-w3-schnorr-drill: participant contract", () => {
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
      "local/tests/public/test_schnorr_drill.py",
      "local/tests/hidden/check_schnorr_drill.py",
      "local/verifier/server.py",
      "local/verifier/expected.py",
      "local/participant/server.py",
      "local/participant/workbench.py",
      "local/starter/schnorr_drill.py",
      "local/reference/schnorr_drill.py",
    ]) {
      expect(existsSync(join(ROOT, path)), path).toBe(true);
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

  it("keeps the author-only artifacts out of the participant stage", () => {
    const dockerfile = read("local/Dockerfile");
    const [participant, author] = dockerfile.split(/^FROM participant AS author$/m);
    expect(author).toBeDefined();
    const participantCopies = participant.split("\n").filter((line) => line.startsWith("COPY "));
    expect(participantCopies.some((line) => line.includes("starter/"))).toBe(true);
    expect(participantCopies.some((line) => line.includes("reference/"))).toBe(false);
    expect(participantCopies.some((line) => line.includes("mutation.py"))).toBe(false);
    expect(author).toContain("COPY --chown=lab:lab reference/ ./reference/");
    expect(author).toContain("COPY --chown=lab:lab mutation.py ./mutation.py");
  });
});

describe("ac26-w3-schnorr-drill: container safety", () => {
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

describe("ac26-w3-schnorr-drill: participant/verifier separation (Issue 543/537)", () => {
  it("keeps the answer derivation and hidden suite out of the participant Docker stage", () => {
    const dockerfile = read("local/Dockerfile");
    const participantStage = dockerfile.slice(
      dockerfile.indexOf("FROM base AS participant"),
      dockerfile.indexOf("FROM base AS verifier"),
    );
    expect(participantStage).not.toContain("tests/hidden");
    expect(participantStage).not.toContain("COPY --chown=lab:lab verifier/");
    expect(participantStage).not.toContain("COPY --chown=lab:lab reference/");
    expect(participantStage).not.toContain("COPY --chown=lab:lab mutation.py");
    // Issue 543 option B2: `fixtures/` is on the verifier's side of the boundary too.
    expect(participantStage).not.toContain("COPY --chown=lab:lab fixtures/");
    expect(participantStage).toContain("COPY --chown=lab:lab tests/public/");
    expect(participantStage).toContain("COPY --chown=lab:lab participant/");

    const verifierStage = dockerfile.slice(
      dockerfile.indexOf("FROM base AS verifier"),
      dockerfile.indexOf("FROM participant AS author"),
    );
    expect(verifierStage).toContain("COPY --chown=lab:lab fixtures/");
    expect(verifierStage).toContain("COPY --chown=lab:lab tests/hidden/");
    expect(verifierStage).toContain("COPY --chown=lab:lab verifier/");
    expect(verifierStage).not.toContain("COPY --chown=lab:lab participant/");
    expect(verifierStage).not.toContain("COPY --chown=lab:lab reference/");
    expect(verifierStage).not.toContain("COPY --chown=lab:lab mutation.py");

    // The author target is `FROM participant`, so dropping fixtures/ above takes it out
    // of the author image too unless it is copied back -- and mutation.py, the hidden
    // suite and the 2000-seed sweep all need it.
    const authorStage = dockerfile.slice(dockerfile.indexOf("FROM participant AS author"));
    expect(authorStage).toContain("COPY --chown=lab:lab fixtures/");
  });

  it("reproduces the original leak: the drill's own functions are no longer in the participant image", () => {
    // Before Issue 543's option B2, `fixtures/generate.py` shipped in the participant
    // stage. It has to define working `ec_add`, `ec_mul` and `order_of` to derive this
    // deployment's public numbers -- the same names `starter/schnorr_drill.py` asks the
    // learner to write -- so `add-points`, `double` and `order` were one import away,
    // with no comparison anywhere near them. The file list below comes from the
    // Dockerfile via the same derivation `check-answer-reachability.ts` uses, so a COPY
    // that puts `fixtures/` back fails this test.
    const repoRoot = join(import.meta.dir, "..");
    const participantFiles = participantPythonFiles(repoRoot, "challenges/ac26-w3-schnorr-drill");
    expect(participantFiles).not.toContain(
      "challenges/ac26-w3-schnorr-drill/local/fixtures/generate.py",
    );
    expect(participantFiles).toContain(
      "challenges/ac26-w3-schnorr-drill/local/tests/public/test_schnorr_drill.py",
    );
    expect(participantFiles).toContain("challenges/ac26-w3-schnorr-drill/local/show.py");
    for (const file of participantFiles) {
      const source = readFileSync(join(repoRoot, file), "utf8");
      // The one permitted mention is the lazy, function-scoped checkout/author
      // fallback: never a module-level import, which is what would fail loudly the
      // moment it ran inside a participant image that carries no `fixtures/` at all.
      expect(source).not.toMatch(/^from fixtures/m);
      expect(source).not.toMatch(/^import fixtures/m);
      // `starter/schnorr_drill.py` is the one file that may define these names -- as the
      // empty stubs the learner fills in. Anywhere else in the participant image, a
      // definition of the same name is a working implementation of the drill.
      if (file.includes("/starter/")) continue;
      expect(source).not.toContain("def ec_add");
      expect(source).not.toContain("def ec_mul");
      expect(source).not.toContain("def order_of");
    }

    // And the leak is real, not hypothetical: with fixtures/ on the path those three
    // functions still reproduce three graded checkpoints exactly.
    const probe = [
      "import json, sys",
      "sys.path.insert(0, '.')",
      "from fixtures.generate import ec_add, order_of, setting",
      "from verifier.expected import expected_for",
      "pub = setting(sys.argv[1])['public']",
      "G, Q, p, a = tuple(pub['G']), tuple(pub['Q']), pub['p'], pub['a']",
      "exp = expected_for(sys.argv[1])",
      "print(json.dumps({",
      "  'add-points': list(ec_add(G, Q, p, a)) == list(exp['add-points']),",
      "  'double': list(ec_add(G, G, p, a)) == list(exp['double']),",
      "  'order': order_of(G, p, a) == exp['order'],",
      "}))",
    ].join("\n");
    const result = python(["-c", probe, SEED]);
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout.trim().split("\n").at(-1) ?? "{}")).toEqual({
      "add-points": true,
      double: true,
      order: true,
    });
  });

  it("serves the public half over GET /public, and only the public half", () => {
    const hiddenServer = read("local/verifier/server.py");
    expect(hiddenServer).toContain("/public");
    expect(hiddenServer).toContain("public_payload");

    // The payload must be exactly the surface show.py already printed before the split:
    // adding a field here is how a graded value would slip across the boundary. A
    // value-by-value comparison against the answers would prove nothing -- every number
    // lives on a curve with p < 32, so small integers collide by chance.
    const probe = [
      "import json, sys",
      "sys.path.insert(0, '.')",
      "from fixtures.generate import GRADED, LINES, assignments, public_payload, setting",
      "seed = sys.argv[1]",
      "payload = public_payload(seed)",
      "print(json.dumps({",
      "  'keys': sorted(payload),",
      "  'publicMatchesSetting': payload['public'] == json.loads(json.dumps(setting(seed)['public'])),",
      "  'assignmentsUnchanged': payload['assignments'] == assignments(seed),",
      "  'linesUnchanged': payload['lines'] == list(LINES),",
      "  'carriesOrderN': 'n' in payload['public'],",
      "  'gradedIdsInPublic': sorted(set(GRADED) & set(payload['public'])),",
      "}))",
    ].join("\n");
    const result = python(["-c", probe, SEED]);
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout.trim().split("\n").at(-1) ?? "{}")).toEqual({
      keys: ["assignments", "lines", "pointKeys", "public"],
      publicMatchesSetting: true,
      assignmentsUnchanged: true,
      linesUnchanged: true,
      carriesOrderN: false,
      gradedIdsInPublic: [],
    });
  });

  it("routes show.py and the public tests through the verifier, with a checkout-only fallback", () => {
    for (const path of ["local/show.py", "local/tests/public/test_schnorr_drill.py"]) {
      const source = read(path);
      expect(source).toContain("PUBLIC_EVIDENCE_JSON");
      expect(source).toContain("VERIFIER_PUBLIC_URL");
      // The fixtures fallback is function-scoped, so it resolves in a checkout or the
      // author stage and is simply never reached inside a participant image.
      expect(source).toContain("    from fixtures.generate import public_payload");
    }
    // `make test` / `make inspect` need a live verifier now, so they run through Compose
    // rather than a bare `docker run` against a standalone image.
    const makefile = read("Makefile");
    expect(makefile).toContain("docker compose -f local/docker-compose.yml -p $(IMAGE)");
    expect(makefile).toContain("verifier-up:");
    expect(makefile).toContain("verifier-down:");
    expect(makefile).toContain("test: build verifier-up");
    expect(makefile).toContain("inspect: build verifier-up");
  });

  it("never defines expected_for outside verifier/expected.py", () => {
    const fixtures = read("local/fixtures/generate.py");
    const participantServer = read("local/participant/server.py");
    const participantWorkbench = read("local/participant/workbench.py");
    for (const source of [fixtures, participantServer, participantWorkbench]) {
      expect(source).not.toContain("def expected_for");
      expect(source).not.toContain("tests.hidden");
    }
    expect(read("local/verifier/expected.py")).toContain("def expected_for");
  });

  it("keeps the Portal editor API out of the hidden verifier and grading out of the Workbench", () => {
    const participantServer = read("local/participant/server.py");
    const hiddenServer = read("local/verifier/server.py");
    for (const endpoint of ["/api/config", "/api/inspect", "/api/starter", "/api/test", "/api/prepare"]) {
      expect(participantServer).toContain(endpoint);
      expect(hiddenServer).not.toContain(endpoint);
    }
    expect(participantServer).not.toContain("def evaluate(");
    expect(participantServer).not.toContain("from verifier");
    expect(hiddenServer).toContain("from verifier.expected import expected_for");
    expect(hiddenServer).toContain("/verify");
    expect(hiddenServer).toContain("/healthz");
  });

  it("proxies /verify to the internal verifier and fails closed when it is unreachable", () => {
    const probe = String.raw`
import json, sys
sys.path.insert(0, ".")
from participant import server
bodies = [{"checkpointId": checkpoint, "submission": "anything"} for checkpoint in server.CHECKPOINTS]
print(json.dumps({
    "missing": [server.proxy_verdict(body, "") for body in bodies],
    "unavailable": [server.proxy_verdict(body, "http://127.0.0.1:1/verify") for body in bodies],
    "hasInlineEvaluator": hasattr(server, "expected_for") or hasattr(server, "_check_line"),
}))
`;
    const result = python(["-c", probe]);
    expect(result.status).toBe(0);
    const output = JSON.parse(result.stdout.trim().split("\n").at(-1) ?? "{}") as {
      missing: Array<{ checkpointId: string; correct: boolean }>;
      unavailable: Array<{ checkpointId: string; correct: boolean }>;
      hasInlineEvaluator: boolean;
    };
    const expectedVerdicts = LINES.map((checkpointId) => ({ checkpointId, correct: false }));
    expect(output.missing).toEqual(expectedVerdicts);
    expect(output.unavailable).toEqual(expectedVerdicts);
    expect(output.hasInlineEvaluator).toBe(false);
  });

  it("compose builds the right target for each service, publishes only the Workbench port, and isolates the verifier network", () => {
    const compose = read("local/docker-compose.yml");
    for (const contract of [
      "target: participant",
      "target: verifier",
      '"127.0.0.1:18132:18132"',
      "VERIFIER_URL: http://verifier:18138/verify",
      "VERIFIER_PUBLIC_URL: http://verifier:18138/public",
      "read_only: true",
      "cap_drop:",
      "- ALL",
      "no-new-privileges:true",
      "healthcheck:",
      "internal: true",
      'com.docker.network.bridge.enable_ip_masquerade: "false"',
    ]) {
      expect(compose).toContain(contract);
    }
    expect(compose).not.toContain('"127.0.0.1:18138:18138"');
    expect(compose.match(/ports:/g)).toHaveLength(1);
  });
});

describe("ac26-w3-schnorr-drill: fixtures are seed-derived", () => {
  it("should keep the reference passing every line across 2000 fixture seeds", () => {
    const script = [
      "import importlib.util, sys",
      "sys.path.insert(0, '.')",
      "from tests.hidden import check_schnorr_drill",
      "from fixtures.generate import setting, on_curve, order_of, TOY_GROUPS",
      "spec = importlib.util.spec_from_file_location('ref', 'reference/schnorr_drill.py')",
      "ref = importlib.util.module_from_spec(spec); spec.loader.exec_module(ref)",
      "def table_order(p, a, b, gx, gy):",
      "    return next(n for (p_, a_, b_, gx_, gy_, n) in TOY_GROUPS if (p_, a_, b_, gx_, gy_) == (p, a, b, gx, gy))",
      "bad = {}",
      "for i in range(2000):",
      "    seed = f'solvability-{i}'",
      "    failures = check_schnorr_drill.run(ref, seed)",
      "    pub = setting(seed)['public']",
      "    if not on_curve(pub['Q'], pub['p'], pub['a'], pub['b']) or pub['Q'][0] == pub['Gx']:",
      "        failures.append('Q degenerate')",
      "    if pub['e1'] == pub['e2']:",
      "        failures.append('e1 == e2')",
      "    n = table_order(pub['p'], pub['a'], pub['b'], pub['Gx'], pub['Gy'])",
      "    n2 = table_order(pub['p2'], pub['a2'], pub['b2'], pub['G2'][0], pub['G2'][1])",
      "    if order_of(pub['G'], pub['p'], pub['a']) != n or order_of(pub['G2'], pub['p2'], pub['a2']) != n2:",
      "        failures.append('order table wrong')",
      "    if failures:",
      "        bad[seed] = failures",
      "print(bad)",
    ].join("\n");
    const result = python(["-c", script]);
    expect(result.status).toBe(0);
    expect(result.stdout.trim().split("\n").at(-1)).toBe("{}");
  });

  it("should produce different numbers for different seeds", () => {
    const alpha = deployment("seed-alpha");
    const beta = deployment("seed-beta");
    expect(JSON.stringify(alpha.expected)).not.toBe(JSON.stringify(beta.expected));
    expect(JSON.stringify(deployment("seed-alpha").expected)).toBe(JSON.stringify(alpha.expected));
  });

  it("should vary the curve across seeds, so p and n are never assumed", () => {
    const script = [
      "import sys",
      "sys.path.insert(0, '.')",
      "from fixtures.generate import setting",
      "print(','.join(str(setting(f'vary-{i}')['public']['p']) for i in range(40)))",
    ].join("\n");
    const primes = new Set(python(["-c", script]).stdout.trim().split(","));
    expect(primes.size).toBeGreaterThan(1);
  });
});

describe("ac26-w3-schnorr-drill: the problem is solvable and actually fails", () => {
  it("should fail the public tests in the shipped starter state", () => {
    const result = python(["tests/public/test_schnorr_drill.py"]);
    expect(result.status).not.toBe(0);
    expect(result.stdout).toContain("FAIL");
  });

  it("should kill every intended defect in the mutation suite", () => {
    const result = python(["mutation.py"]);
    expect(result.stdout).toContain("PASS reference implementation passes the hidden tests");
    expect(result.stdout).not.toContain("SURVIVED");
    expect(result.status).toBe(0);
  });

  it("does not hand the answers to the learner in the starter", () => {
    const starter = read("local/starter/schnorr_drill.py");
    const reference = read("local/reference/schnorr_drill.py");
    for (const giveaway of ["pow(t, p - 2, p)", "(r + e * x) % n", "pow(e1 - e2, n - 2, n)"]) {
      expect(starter).not.toContain(giveaway);
      expect(reference).toContain(giveaway);
    }
  });

  it("ships an inspect path that shows the numbers but never a line's value", () => {
    const shown = python(["show.py"]).stdout;
    const { expected, public: pub } = deployment();
    expect(shown).toContain(`t = ${pub.t}`);
    expect(shown).not.toMatch(/order n\s*[:=]\s*\d/);
    // The twelve values are not printed as labelled answers anywhere on the screen.
    for (const line of LINES) expect(shown).not.toContain(`${line} = ${JSON.stringify(expected[line])}`);
  });
});

describe("ac26-w3-schnorr-drill: /verify contract", () => {
  const { expected, public: pub } = deployment();
  const asText = (value: unknown): string =>
    Array.isArray(value) ? JSON.stringify(value) : String(value);

  it.each([...LINES])("should accept this deployment's value on %s", (line) => {
    expect(evaluate(line, asText(expected[line]))).toBe(true);
  });

  it("should accept a point in tuple form and in bare form", () => {
    const [x, y] = expected["add-points"] as [number, number];
    expect(evaluate("add-points", `(${x}, ${y})`)).toBe(true);
    expect(evaluate("add-points", `${x}, ${y}`)).toBe(true);
  });

  it.each([...LINES])("should reject another deployment's value on %s", (line) => {
    const other = deployment("another-deployment").expected[line];
    if (JSON.stringify(other) === JSON.stringify(expected[line])) return; // coincidence: nothing to test
    expect(evaluate(line, asText(other))).toBe(false);
  });

  it("should reject a shown fixture value pasted in place of the answer", () => {
    expect(evaluate("field-inv", String(pub.t))).toBe(false);
    expect(evaluate("order", String(pub.p))).toBe(false);
    expect(evaluate("double", JSON.stringify(pub.Q))).toBe(false);
  });

  it("should reject an ungraded line's value offered to a graded checkpoint", () => {
    // P and R are typed but not graded; they must not score the checkpoint they feed.
    expect(evaluate("verify", JSON.stringify(expected["pubkey"]))).toBe(false);
    expect(evaluate("verify", JSON.stringify(expected["commit"]))).toBe(false);
    expect(evaluate("pubkey", JSON.stringify(expected["pubkey"]))).toBe(false);
  });

  it("should reject the right point with a wrong shape, a boolean, and junk", () => {
    const [x, y] = expected["double"] as [number, number];
    expect(evaluate("double", `${x}`)).toBe(false);
    expect(evaluate("double", `[${x}, ${y}, 0]`)).toBe(false);
    expect(evaluate("response", "true")).toBe(false);
    expect(evaluate("response", "")).toBe(false);
    expect(evaluate("response", "not a number")).toBe(false);
  });

  it("should reject an unknown checkpoint id instead of crediting it", () => {
    expect(evaluate("line-13", "0")).toBe(false);
  });

  it("should echo the checkpointId so the platform can fail closed", () => {
    expect(read("local/verifier/server.py")).toContain(
      '{"checkpointId": checkpoint_id, "correct": correct}',
    );
  });
});

describe("ac26-w3-schnorr-drill: metadata contracts", () => {
  const metadata = JSON.parse(read("metadata.json")) as {
    difficulty: number;
    status: string;
    scoring: {
      kind: string;
      checks: { id: string; points: number; wrongAnswerPenalty: number; input?: string; hints?: { penalty: number }[] }[];
    };
    courseAlignment: { week: number; role: string; sources: unknown[] };
    i18n: { en: { checks: { id: string }[] } };
  };

  it("should total the Medium tier's 200 points across eight direct-answer lines", () => {
    expect(metadata.scoring.kind).toBe("multi-verify");
    expect(metadata.difficulty).toBe(3);
    expect(metadata.scoring.checks.map((check) => check.id)).toEqual([...LINES]);
    expect(metadata.scoring.checks.reduce((sum, check) => sum + check.points, 0)).toBe(200);
    for (const check of metadata.scoring.checks) {
      expect(check.wrongAnswerPenalty).toBe(10);
      expect(check.input ?? "text").toBe("text");
    }
    const hintPenalty = metadata.scoring.checks.reduce(
      (sum, check) => sum + (check.hints ?? []).reduce((inner, hint) => inner + hint.penalty, 0),
      0,
    );
    expect(hintPenalty).toBeLessThanOrEqual(100);
    expect(metadata.i18n.en.checks.map((check) => check.id)).toEqual([...LINES]);
  });

  it("should pin week 3's published material and stay draft until played", () => {
    expect(metadata.courseAlignment.week).toBe(3);
    expect(metadata.courseAlignment.role).toBe("mechanism");
    expect(metadata.courseAlignment.sources).toEqual([
      {
        repository: "zk-tokyo/advanced-cryptography-2026",
        ref: "a3aa4b56fa88fbe803b57d320fbc87c1a203b480",
        path: "week3/README.md",
        kind: "lecture",
      },
      {
        repository: "zk-tokyo/advanced-cryptography-2026",
        ref: "a3aa4b56fa88fbe803b57d320fbc87c1a203b480",
        path: "week3/problems/schnorr-from-scratch/README.md",
        kind: "assignment",
      },
      {
        repository: "zk-tokyo/advanced-cryptography-2026",
        ref: "b1b46669949b5615be7941b2b62da4ea635e9c30",
        path: "week3/week3_zksnark_slides.pdf",
        kind: "slide",
      },
    ]);
    expect(metadata.status).toBe("draft");
  });
});
