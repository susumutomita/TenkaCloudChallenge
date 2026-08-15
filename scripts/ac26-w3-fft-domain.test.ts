import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "bun:test";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const LOCAL = join(ROOT, "challenges", "ac26-w3-fft-domain", "local");

function probe(source: string): string {
  return execFileSync("python3", ["-c", source], {
    cwd: LOCAL,
    encoding: "utf8",
    env: { ...process.env, FLAG_SEED: "repo-contract-seed", PYTHONDONTWRITEBYTECODE: "1" },
    timeout: 180_000,
  }).trim();
}

const PHASES = [
  "check_domain",
  "check_roundtrip",
  "check_ordering",
  "check_interpolate",
  "check_generalize",
];

describe("ac26-w3-fft-domain", () => {
  it("keeps the premise: the starter passes public tests and fails every hidden phase", () => {
    expect(
      execFileSync("python3", ["tests/public/test_fftdomain.py"], {
        cwd: LOCAL,
        encoding: "utf8",
        timeout: 180_000,
      }),
    ).toContain("all passed");
    const counts = JSON.parse(
      probe(`
import importlib.util, json, sys
sys.path.insert(0, ".")
import tests.hidden.check_fftdomain as check
spec = importlib.util.spec_from_file_location("sta", "starter/fftdomain.py")
sta = importlib.util.module_from_spec(spec); spec.loader.exec_module(sta)
print(json.dumps({n: len(getattr(check, n)(sta, "repo-contract-seed")) for n in ${JSON.stringify(PHASES)}}))
`),
    ) as Record<string, number>;
    expect(Object.keys(counts).toSorted()).toEqual([...PHASES].toSorted());
    for (const count of Object.values(counts)) expect(count).toBeGreaterThan(0);
  });

  it("names the element it rejected, so the failure teaches rather than just fails", () => {
    const message = probe(`
import importlib.util, sys
sys.path.insert(0, ".")
import tests.hidden.check_fftdomain as check
spec = importlib.util.spec_from_file_location("sta", "starter/fftdomain.py")
sta = importlib.util.module_from_spec(spec); spec.loader.exec_module(sta)
print("\\n".join(check.check_domain(sta, "repo-contract-seed")))
`);
    expect(message).toMatch(/called a (lower|higher)-order element a domain|accepted omega=\d+/);
  });

  it("holds across seeds, so neither verdict is luck", () => {
    // A fake omega only shows on parameter sets where the textbook rule lands in a
    // smaller subgroup, so the sets are built to contain those on purpose.
    const out = JSON.parse(
      probe(`
import importlib.util, json, sys
sys.path.insert(0, ".")
import tests.hidden.check_fftdomain as check
def load(path, name):
    spec = importlib.util.spec_from_file_location(name, path)
    m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m); return m
res = {"referenceClean": True, "starterCaught": True}
for i in range(12):
    seed = "sweep-%02d" % i
    ref = load("reference/fftdomain.py", "r%d" % i)
    sta = load("starter/fftdomain.py", "s%d" % i)
    for name in ${JSON.stringify(PHASES)}:
        if getattr(check, name)(ref, seed): res["referenceClean"] = False
        if not getattr(check, name)(sta, seed): res["starterCaught"] = False
print(json.dumps(res))
`),
    ) as Record<string, boolean>;
    expect(out).toEqual({ referenceClean: true, starterCaught: true });
  });

  it("passes the reference and kills every mutant", () => {
    const output = execFileSync("python3", ["mutation.py"], {
      cwd: LOCAL,
      encoding: "utf8",
      timeout: 300_000,
    });
    expect(output).toContain("reference: passes");
    // The near-misses that matter: each half of the order test alone, and the
    // validator that waves every well-formed triple through.
    expect(output).toContain("keeps only omega ** n == 1 and drops the primitivity half");
    expect(output).toContain("drops omega ** n == 1 and keeps only the primitivity half");
    expect(output).toContain("calls every well-formed triple a valid domain");
    expect(output).toContain("all 8 mutations killed");
    expect(output).not.toContain("SURVIVED");
  });

  it("keeps the author-only artifacts out of the participant stage", () => {
    const dockerfile = readFileSync(join(LOCAL, "Dockerfile"), "utf8");
    const afterParticipant = dockerfile.split(/^FROM .* AS participant$/m)[1];
    expect(afterParticipant, "no participant stage found").toBeDefined();
    const participant = (afterParticipant ?? "").split(/^FROM participant AS author$/m)[0] ?? "";
    expect(participant.trim().length).toBeGreaterThan(0);
    expect(participant).toContain("COPY starter/");

    const copied = [...participant.matchAll(/^COPY\s+(?:--\S+\s+)*(\S+)/gmu)].map((m) => m[1]);
    expect(copied).toContain("starter/");
    // `reference/` and `mutation.py` are the author-only artifacts, the same pair
    // scripts/author-artifact-separation.test.ts enforces across every problem.
    for (const forbidden of ["reference/", "mutation.py"]) {
      expect(copied).not.toContain(forbidden);
    }
  });

  it("does not hand the order check to the learner in the starter", () => {
    // The gap this problem is built on is "the order divides n" versus "the order is
    // exactly n". A starter that already contains the second test leaves nothing to
    // work out.
    const starter = readFileSync(join(LOCAL, "starter", "fftdomain.py"), "utf8");
    expect(starter).not.toContain("has_order");
    expect(starter).not.toContain("_prime_factors");
    // The reference does contain it; asserting that keeps this from passing because
    // the whole problem was deleted.
    const reference = readFileSync(join(LOCAL, "reference", "fftdomain.py"), "utf8");
    expect(reference).toContain("def has_order");
  });

  it("ships an inspect path about this problem, without the answer inside", () => {
    // The orientation shows one real domain and one that only looks real, both as
    // written-out constants. Nothing in the participant image may compute an order.
    const fixtures = readFileSync(join(LOCAL, "fixtures", "generate.py"), "utf8");
    const show = readFileSync(join(LOCAL, "show.py"), "utf8");
    expect(fixtures).toContain("WORKED_DOMAIN");
    expect(fixtures).toContain("BROKEN_DOMAIN");
    for (const file of [fixtures, show]) {
      expect(file).not.toContain("def has_order");
      expect(file).not.toContain("_prime_factors");
      expect(file).not.toContain("primitive_root");
    }
  });
});
