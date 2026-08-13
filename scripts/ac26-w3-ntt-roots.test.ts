import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "bun:test";

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
    const participant = (afterParticipant ?? "").split(/^FROM participant AS author$/m)[0] ?? "";
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
