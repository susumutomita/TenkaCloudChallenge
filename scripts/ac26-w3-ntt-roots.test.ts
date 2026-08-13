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

  it("keeps the answer and the hidden properties out of the participant image", () => {
    const dockerfile = readFileSync(join(LOCAL, "Dockerfile"), "utf8");
    const participant = (dockerfile.split("FROM base AS participant")[1] ?? "").split("FROM base AS verifier")[0] as string;
    for (const forbidden of ["reference/", "tests/hidden/", "mutation.py"]) {
      expect(participant).not.toContain(forbidden);
    }
  });
});
