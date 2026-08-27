import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "bun:test";
import { parse as parseYaml } from "yaml";
import { participantPythonFiles } from "./lib/local-play-problems";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const LOCAL = join(ROOT, "challenges", "ac26-w3-ntt-roots", "local");

function probe(source: string): string {
  return execFileSync("python3", ["-c", source], {
    cwd: LOCAL,
    encoding: "utf8",
    env: { ...process.env, FLAG_SEED: "repo-contract-seed", PYTHONDONTWRITEBYTECODE: "1" },
    timeout: 180_000,
  }).trim();
}

const PHASES = ["check_roots", "check_transform", "check_roundtrip", "check_errors", "check_odd_order", "check_transfer"];

describe("ac26-w3-ntt-roots", () => {
  it("keeps the premise: the starter passes public tests and fails every hidden phase", () => {
    expect(
      execFileSync("python3", ["tests/public/test_ntt.py"], { cwd: LOCAL, encoding: "utf8", timeout: 180_000 }),
    ).toContain("all passed");
    const counts = JSON.parse(
      probe(`
import importlib.util, json, sys
sys.path.insert(0, ".")
import tests.hidden.check_ntt as check
spec = importlib.util.spec_from_file_location("sta", "starter/ntt.py")
sta = importlib.util.module_from_spec(spec); spec.loader.exec_module(sta)
print(json.dumps({n: len(getattr(check, n)(sta, "repo-contract-seed")) for n in ${JSON.stringify(PHASES)}}))
`),
    ) as Record<string, number>;
    expect(Object.keys(counts).toSorted()).toEqual([...PHASES].toSorted());
    for (const count of Object.values(counts)) expect(count).toBeGreaterThan(0);
  });

  it("names the omega it rejected, so the failure teaches rather than just fails", () => {
    const message = probe(`
import importlib.util, sys
sys.path.insert(0, ".")
import tests.hidden.check_ntt as check
spec = importlib.util.spec_from_file_location("sta", "starter/ntt.py")
sta = importlib.util.module_from_spec(spec); spec.loader.exec_module(sta)
print("\\n".join(check.check_roots(sta, "repo-contract-seed")))
`);
    expect(message).toMatch(/returned omega=\d+, which does not have order \d+/);
  });

  it("holds across seeds, so neither verdict is luck", () => {
    // A wrong omega only shows on parameter sets the textbook rule gets wrong, so the
    // sets are built to contain those on purpose rather than by chance.
    const out = JSON.parse(
      probe(`
import importlib.util, json, sys
sys.path.insert(0, ".")
import tests.hidden.check_ntt as check
def load(path, name):
    spec = importlib.util.spec_from_file_location(name, path)
    m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m); return m
res = {"referenceClean": True, "starterCaught": True}
for i in range(12):
    seed = "sweep-%02d" % i
    ref = load("reference/ntt.py", "r%d" % i)
    sta = load("starter/ntt.py", "s%d" % i)
    for name in ${JSON.stringify(PHASES)}:
        if getattr(check, name)(ref, seed): res["referenceClean"] = False
        if not getattr(check, name)(sta, seed): res["starterCaught"] = False
print(json.dumps(res))
`),
    ) as Record<string, boolean>;
    expect(out).toEqual({ referenceClean: true, starterCaught: true });
  });

  it("passes the reference and kills every mutant", () => {
    const output = execFileSync("python3", ["mutation.py"], { cwd: LOCAL, encoding: "utf8", timeout: 300_000 });
    expect(output).toContain("reference: passes");
    // The near-miss that matters: the formula is right and the check is missing.
    expect(output).toContain("keeps the textbook base-3 rule and never checks the result");
    expect(output).toContain("accepts any element whose order merely divides n");
    expect(output).toContain("all 9 mutations killed");
    expect(output).not.toContain("SURVIVED");
  });

  it("keeps the author-only artifacts out of the participant stage", () => {
    // This assertion used to split on `FROM base AS participant` / `FROM base AS
    // verifier`, markers this Dockerfile does not contain. Both splits missed, the
    // section under test was the empty string, and every `not.toContain` passed while
    // inspecting nothing. Slice on the markers that are actually there, and fail if the
    // slice is empty, so a stage rename cannot make this silent again.
    const dockerfile = readFileSync(join(LOCAL, "Dockerfile"), "utf8");
    const afterParticipant = dockerfile.split(/^FROM .* AS participant$/m)[1];
    expect(afterParticipant, "no participant stage found").toBeDefined();
    const participant =
      (afterParticipant ?? "").split(/^FROM \S+ AS (?:verifier|author)$/m)[0] ?? "";
    expect(participant.trim().length).toBeGreaterThan(0);
    expect(participant).toContain("COPY starter/");

    // Read the COPY sources rather than the section's text: the stage's own comment
    // explains what it deliberately leaves out, so a substring search over the prose
    // matches the word "reference/" in the explanation and says the opposite.
    const copied = [...participant.matchAll(/^COPY\s+(?:--\S+\s+)*(\S+)/gmu)].map((m) => m[1]);
    expect(copied).toContain("starter/");
    // `reference/` and `mutation.py` are the author-only artifacts, the same pair
    // scripts/author-artifact-separation.test.ts enforces across every problem.
    for (const forbidden of ["reference/", "mutation.py"]) {
      expect(copied).not.toContain(forbidden);
    }
  });

  it("does not hand the order check to the learner in the starter", () => {
    // The gap this problem is built on is "the order divides n" versus "the order is n".
    // A starter that already contains the second test leaves nothing to work out, which
    // is what it shipped with: a complete `has_order`, docstring and all.
    const starter = readFileSync(join(LOCAL, "starter", "ntt.py"), "utf8");
    expect(starter).not.toContain("has_order");
    expect(starter).not.toContain("_prime_factors");
    // The reference does contain it; asserting that keeps this from passing because the
    // whole problem was deleted.
    const reference = readFileSync(join(LOCAL, "reference", "ntt.py"), "utf8");
    expect(reference).toContain("def has_order");
  });

  it("ships an inspect path about this problem", () => {
    // Both files started as copies of ac26-w3-field-inverse's and still described
    // extended Euclid over prime and composite moduli, so `make inspect` taught a
    // different problem than the one being graded.
    const fixtures = readFileSync(join(LOCAL, "fixtures", "generate.py"), "utf8");
    const show = readFileSync(join(LOCAL, "show.py"), "utf8");
    for (const foreign of ["egcd", "composite_modulus", "non_invertible"]) {
      expect(fixtures).not.toContain(foreign);
      expect(show).not.toContain(foreign);
    }
    // ...and the participant image must still not be able to derive a primitive root,
    // which is the answer. The worked example carries omega as a written-out constant.
    expect(fixtures).not.toContain("def primitive_root_of_unity");
    expect(fixtures).not.toContain("def has_order");
    expect(fixtures).toContain("WORKED_EXAMPLE");
  });
});

const DIR = "challenges/ac26-w3-ntt-roots";
const CHECKPOINTS = ["roots", "transform", "roundtrip", "errors", "odd-order", "transfer"] as const;

function read(relativePath: string): string {
  return readFileSync(join(ROOT, DIR, relativePath), "utf8");
}

function evaluate(checkpointId: string, submission: string): boolean {
  const script = [
    "import json, sys",
    "sys.path.insert(0, '.')",
    "from verifier.server import evaluate",
    "print(json.dumps(evaluate(sys.argv[1], sys.argv[2])))",
  ].join("\n");
  const stdout = execFileSync("python3", ["-c", script, checkpointId, submission], {
    cwd: LOCAL,
    encoding: "utf8",
    env: { ...process.env, FLAG_SEED: "repo-contract-seed", PYTHONDONTWRITEBYTECODE: "1" },
    timeout: 300_000,
  });
  return JSON.parse(stdout.trim().split("\n").at(-1) ?? "null") === true;
}

/**
 * The mechanical half of the transcription probe below. The starter's `primitive_root_of_unity`
 * already knows the textbook candidate is suspect; what it cannot do is decide. This scans for
 * an element the copied predicate accepts, and rejects a handed omega the same way. Nothing here
 * is derived from the mathematics -- that is the point. It is kept out of `local/` because it is
 * a probe, not a reference solution.
 */
const TRANSCRIBED_SCAN = [
  "    for candidate in range(2, prime):",
  "        if has_order(candidate, order, prime):",
  "            return candidate",
  "    return None",
].join("\n");

describe("ac26-w3-ntt-roots: the participant image carries nothing that grades", () => {
  it("keeps fixtures/, the hidden suite and the verifier out of the participant Docker stage", () => {
    const dockerfile = readFileSync(join(LOCAL, "Dockerfile"), "utf8");
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
    expect(verifierStage).toContain("COPY tests/hidden/");
    expect(verifierStage).toContain("COPY verifier/");
    // Unlike ac26-w2-private-aggregate there is no supplied half here: the starter asks
    // the learner to build every name the hidden suite calls, so the verifier stage must
    // not pull `participant/` in at all.
    expect(verifierStage).not.toContain("COPY participant/");
    expect(verifierStage).not.toContain("COPY reference/");
    expect(verifierStage).not.toContain("COPY mutation.py");
  });

  it("reproduces the original leak: no file the participant image carries reaches the order test", () => {
    // The file list comes from the Dockerfile's participant stage, via the same
    // derivation `check-answer-reachability.ts` uses, rather than being restated here --
    // so a COPY that puts `fixtures/` or `tests/hidden/` back fails this test.
    const participantFiles = participantPythonFiles(ROOT, DIR);
    expect(participantFiles).not.toContain(`${DIR}/local/fixtures/generate.py`);
    expect(participantFiles).not.toContain(`${DIR}/local/tests/hidden/check_ntt.py`);
    expect(participantFiles).not.toContain(`${DIR}/local/verifier/server.py`);
    expect(participantFiles).toContain(`${DIR}/local/tests/public/test_ntt.py`);
    expect(participantFiles).toContain(`${DIR}/local/participant/server.py`);
    for (const file of participantFiles) {
      const source = readFileSync(join(ROOT, file), "utf8");
      // The one permitted mention is the lazy, function-scoped checkout/author fallback
      // in show.py: never a module-level import, which is what would fail loudly the
      // moment it ran inside a participant image that carries no `fixtures/` at all.
      expect(source).not.toMatch(/^from fixtures/m);
      expect(source).not.toMatch(/^import fixtures/m);
      expect(source).not.toMatch(/^from tests\.hidden/m);
      expect(source).not.toMatch(/^from verifier/m);
      // The starter says the learner has to add this themselves because "nothing else in
      // the image computes it for you". Nothing in the image may compute it.
      expect(source).not.toContain("def has_order");
      expect(source).not.toContain("def naive_omega");
    }
  });

  it("publishes only the Workbench, and reaches the verifier over an internal network", () => {
    const compose = parseYaml(read("local/docker-compose.yml")) as {
      services: Record<string, Record<string, unknown>>;
      networks: Record<string, Record<string, unknown>>;
    };
    expect(Object.keys(compose.services).sort()).toEqual(["verifier", "workbench"]);
    // The published port and the /verify URL are what metadata.json's runtime declares,
    // and they did not move: the Workbench answers on 18130 and forwards inward.
    expect(compose.services.workbench.ports).toEqual(["127.0.0.1:18130:18130"]);
    expect(compose.services.verifier.ports).toBeUndefined();
    expect(compose.networks.lab.internal).toBe(true);
    expect(compose.services.verifier.networks).toEqual(["lab"]);
    const runtime = JSON.parse(read("metadata.json")).runtime as { verifyUrl: string };
    expect(runtime.verifyUrl).toBe("http://127.0.0.1:18130/verify");
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

describe("ac26-w3-ntt-roots: what the split does and does not close", () => {
  it("scores zero for a submission that imports the graded material at grading time", () => {
    // Issue 591: `fixtures/` and `tests/hidden/` are on the runner's sys.path because
    // grading needs them, so the guard in verifier/server.py's RUNNER -- not the Docker
    // split -- is what closes this path. Measured, not assumed.
    for (const checkpoint of CHECKPOINTS) {
      expect(evaluate(checkpoint, "from fixtures.generate import *\n")).toBe(false);
    }
  }, 300_000);

  it("scores zero for the module the participant image ships", () => {
    // The other probe: the participant reads what their own container carries and
    // pastes it, so the RUNNER guard -- which only blocks `import` -- is not in the
    // path. The reference passing every checkpoint (below) is this probe's positive
    // control (docs/AGENT_LOOP_CONSTRAINTS.md §5), because the guard-removal control is
    // flat here: nothing the participant stage ships defines either contract name, so
    // without the reference a silently broken probe would report the same zero.
    const shipped = readFileSync(join(LOCAL, "participant", "workbench.py"), "utf8");
    for (const checkpoint of CHECKPOINTS) {
      expect(evaluate(checkpoint, shipped)).toBe(false);
    }
  }, 300_000);

  it("is a probe that can score: the reference passes every checkpoint", () => {
    // The positive control for both zeros above. Without it, a probe broken in some way
    // that has nothing to do with the split reports the same 0 as a closed problem.
    const reference = readFileSync(join(LOCAL, "reference", "ntt.py"), "utf8");
    for (const checkpoint of CHECKPOINTS) {
      expect(evaluate(checkpoint, reference)).toBe(true);
    }
  }, 300_000);

  it("scores the whole problem for a submission transcribed out of the hidden checker", () => {
    // The third probe (docs/AGENT_LOOP_CONSTRAINTS.md §5, as on ac26-w2-privacy-audit,
    // ac26-w3-ec-group and ac26-w3-fft-domain): neither standard probe says anything here,
    // because the leaked material is a predicate nobody imports by name. `has_order` is
    // the "order exactly n" decision written from the definition -- the one thing the
    // starter says the learner has to add -- so the starter with that predicate copied in
    // and scanned over passes everything.
    //
    // This is what the split closes, and it is asserted from the checker's own source so
    // the test cannot drift from it: the transcription still scores, and the file it was
    // transcribed from is no longer in the participant image (the test above).
    const checker = readFileSync(join(LOCAL, "tests", "hidden", "check_ntt.py"), "utf8");
    const transcribed = checker.slice(
      checker.indexOf("def _prime_factors(value: int)"),
      checker.indexOf("def orders_of(prime: int)"),
    );
    expect(transcribed).toContain("def has_order(candidate: int, order: int, prime: int) -> bool:");
    const starter = readFileSync(join(LOCAL, "starter", "ntt.py"), "utf8");
    const rewired = starter
      .replace(
        "def primitive_root_of_unity(prime: int, order: int) -> int | None:",
        `${transcribed}def primitive_root_of_unity(prime: int, order: int) -> int | None:`,
      )
      .replace("    return pow(3, (prime - 1) // order, prime)", TRANSCRIBED_SCAN)
      .replace(
        '    if type(omega) is not int or omega % prime == 0:\n        return _error("invalid_omega")',
        "    if type(omega) is not int or omega % prime == 0 or not has_order(omega, order, prime):\n" +
          '        return _error("invalid_omega")',
      );
    expect(rewired).not.toEqual(starter);
    for (const checkpoint of CHECKPOINTS) {
      expect(evaluate(checkpoint, rewired)).toBe(true);
    }
  }, 300_000);
});

describe("ac26-w3-ntt-roots: the public half survives the split", () => {
  it("serves show.py every value it used to import, and withholds the rest", () => {
    const script = [
      "import json, sys",
      "sys.path.insert(0, '.')",
      "from fixtures.generate import public_payload, PRIMES, MAX_ORDER",
      "from fixtures.generate import lab_fields, worked_example, health_token",
      "seed = sys.argv[1]",
      "payload = public_payload(seed)",
      "print(json.dumps({",
      "  'health': payload['healthToken'] == health_token(seed),",
      "  'primes': payload['primes'] == list(PRIMES),",
      "  'maxOrder': payload['maxOrder'] == MAX_ORDER,",
      "  'labFields': payload['labFields'] == lab_fields(seed),",
      "  'worked': payload['workedExample'] == worked_example(),",
      // The decision procedure is the half that must not travel. `legalOrders` is
      // divisibility -- necessary, not sufficient, and always printed by `make inspect`.
      "  'noProcedure': 'has_order' not in json.dumps(payload),",
      "}))",
    ].join("\n");
    const stdout = execFileSync("python3", ["-c", script, "repo-contract-seed"], {
      cwd: LOCAL,
      encoding: "utf8",
      env: { ...process.env, FLAG_SEED: "repo-contract-seed", PYTHONDONTWRITEBYTECODE: "1" },
      timeout: 180_000,
    });
    expect(JSON.parse(stdout.trim().split("\n").at(-1) ?? "{}")).toEqual({
      health: true,
      primes: true,
      maxOrder: true,
      labFields: true,
      worked: true,
      noProcedure: true,
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
    const stdout = execFileSync("python3", ["-c", script], {
      cwd: LOCAL,
      encoding: "utf8",
      env: { ...process.env, FLAG_SEED: "repo-contract-seed", PYTHONDONTWRITEBYTECODE: "1" },
      timeout: 180_000,
    });
    expect(JSON.parse(stdout.trim().split("\n").at(-1) ?? "null")).toEqual({ disagreed: [] });
  });

  it("tells a learner which service is missing when the verifier is not running", () => {
    // show.py inside a participant image has no `fixtures/` to fall back to, so an
    // unreachable verifier must say so rather than raise a urllib traceback at somebody
    // trying to read their own fixtures.
    const result = spawnSync("python3", ["show.py"], {
      cwd: LOCAL,
      encoding: "utf8",
      env: {
        ...process.env,
        FLAG_SEED: "repo-contract-seed",
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
