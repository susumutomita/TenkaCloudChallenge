import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "bun:test";
import {
  findAnswerReachabilityIssues,
  isStubBody,
  parseFromImports,
  topLevelFunctions,
} from "./check-answer-reachability";
import { localPlayProblemDirs } from "./lib/local-play-problems";

/**
 * The detector's own test (Issue #537).
 *
 * Two things this file has to prove, the same way `check-participant-surface.test.ts`
 * does for its own detector: that the shapes #537 actually found get caught (fixtures
 * below reproduce the drill's `CODE_CHECKPOINTS`-empty shape and the
 * `ac26-w4-commit-open` stub-vs-implementation shape), and that the shapes that only
 * *look* similar do not (the already-separated-verifier stage, the `environment`
 * liveness token, `ac26-w2-secret-sharing`'s two-hop echo of an already-shown
 * parameter, and the `evaluate` dispatcher name collision that
 * `ac26-w4-arithmetization` produced while building this file). A detector that
 * over-fires on the second group is exactly as unhelpful as one that misses the first.
 *
 * The catalog-wide section at the bottom is the actual gate: every local-play problem's
 * findings must be covered by `answer-reachability-baseline.json`, and every baseline
 * entry must still be findable — so the list can shrink as problems get fixed but
 * cannot silently grow.
 */

const REPO_ROOT = new URL("..", import.meta.url).pathname;
const BASELINE_PATH = join(new URL(".", import.meta.url).pathname, "answer-reachability-baseline.json");

type BaselineEntry = { problem: string; issue: number; reason: string };

function baseline(): BaselineEntry[] {
  return (JSON.parse(readFileSync(BASELINE_PATH, "utf8")) as { known: BaselineEntry[] }).known;
}

// ---------------------------------------------------------------------------
// Unit tests for the pure Python-source helpers
// ---------------------------------------------------------------------------

describe("parseFromImports", () => {
  it("parses a single-line from-import", () => {
    const imports = parseFromImports("from fixtures.generate import setting, GRADED\n");
    expect(imports.get("setting")).toBe("fixtures.generate");
    expect(imports.get("GRADED")).toBe("fixtures.generate");
  });

  it("parses the parenthesised multi-line form", () => {
    const source = "from fixtures.generate import (\n    TRUTH,\n    instance,\n    health_token,\n)\n";
    const imports = parseFromImports(source);
    expect(imports.get("TRUTH")).toBe("fixtures.generate");
    expect(imports.get("instance")).toBe("fixtures.generate");
    expect(imports.get("health_token")).toBe("fixtures.generate");
  });

  it("drops an `as` alias down to the bound name", () => {
    const imports = parseFromImports("from fixtures.generate import setting as cfg\n");
    expect(imports.get("cfg")).toBe("fixtures.generate");
    expect(imports.has("setting")).toBe(false);
  });
});

describe("topLevelFunctions", () => {
  it("captures a module-level function's full body, stopping at the next top-level line", () => {
    const source = "def foo():\n    return 1\n\n\ndef bar():\n    return 2\n";
    const fns = topLevelFunctions(source);
    expect(fns.get("foo")).toContain("return 1");
    expect(fns.get("foo")).not.toContain("return 2");
    expect(fns.get("bar")).toContain("return 2");
  });

  it("does not descend into class methods (a documented Rule 2 gap)", () => {
    const source = "class Field:\n    def inverse(self):\n        return 0\n";
    expect(topLevelFunctions(source).has("inverse")).toBe(false);
  });
});

describe("isStubBody", () => {
  const stubs = [
    "def f():\n    return ()",
    "def f():\n    return []",
    "def f():\n    return {}",
    'def f():\n    return b""',
    "def f():\n    return False",
    "def f():\n    pass",
    "def f():\n    ...",
    "def f():\n    raise NotImplementedError",
    // A docstring-only body, as it looks *after* `stripTripleQuoted` has blanked the
    // docstring out — `isStubBody` is documented as operating post-strip, same as its
    // one real caller (`moduleLevelDefs`); the end-to-end fixtures below exercise the
    // actual raw-docstring case through that full pipeline.
    "def f():\n    \n",
  ];
  for (const body of stubs) {
    it(`treats ${JSON.stringify(body.split("\n")[1])} as a stub`, () => {
      expect(isStubBody(body)).toBe(true);
    });
  }

  it("treats a real implementation as not a stub", () => {
    const body = "def f(x):\n    total = x + 1\n    return total * 2";
    expect(isStubBody(body)).toBe(false);
  });

  it("treats a single non-trivial statement as not a stub", () => {
    const body = 'def f(a, b):\n    return hashlib.sha256(a + b).digest()';
    expect(isStubBody(body)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// End-to-end fixtures: a fake local-play problem laid out under a temp repo root, run
// through the whole `findAnswerReachabilityIssues` pipeline (Dockerfile parsing
// included) exactly as it runs against the real catalog.
// ---------------------------------------------------------------------------

function withFixture(files: Record<string, string>, run: (repoRoot: string, dir: string) => void): void {
  const repoRoot = mkdtempSync(join(tmpdir(), "answer-reachability-fixture-"));
  const dir = "challenges/fake-problem";
  try {
    for (const [relative, content] of Object.entries(files)) {
      const full = join(repoRoot, dir, relative);
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, content);
    }
    run(repoRoot, dir);
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
}

const SINGLE_STAGE_DOCKERFILE = `FROM python:3.13-slim AS participant
WORKDIR /problem
COPY fixtures/ ./fixtures/
COPY verifier/ ./verifier/
COPY starter/ ./starter/

CMD ["python", "verifier/server.py"]

FROM participant AS author
COPY reference/ ./reference/
`;

describe("findAnswerReachabilityIssues — direct-value-comparison", () => {
  it("catches the drill shape: CODE_CHECKPOINTS empty, expected value from a reachable fixtures function", () => {
    withFixture(
      {
        "local/Dockerfile": SINGLE_STAGE_DOCKERFILE,
        "local/fixtures/generate.py": `def setting(seed):
    return {"public": 1, "expected": {"line-a": 42}}
`,
        "local/verifier/server.py": `from fixtures.generate import setting

CODE_CHECKPOINTS = {}


def _check_line(line, submission):
    expected = setting(SEED)["expected"][line]
    return submission == expected
`,
      },
      (repoRoot, dir) => {
        const findings = findAnswerReachabilityIssues(repoRoot, dir);
        expect(findings.some((f) => f.rule === "direct-value-comparison")).toBe(true);
      },
    );
  });

  it("does not flag a checker whose verifier stage never ships to the participant", () => {
    // The `cs-async-result-binding` shape: `verifier/` is copied only in a separate
    // `verifier` stage that `participant` never inherits from.
    withFixture(
      {
        "local/Dockerfile": `FROM python:3.13-slim AS base
WORKDIR /problem

FROM base AS participant
COPY fixtures/ ./fixtures/
COPY starter/ ./starter/

FROM base AS verifier
COPY fixtures/ ./fixtures/
COPY verifier/ ./verifier/
`,
        "local/fixtures/generate.py": `def setting(seed):
    return {"expected": 42}
`,
        "local/verifier/server.py": `from fixtures.generate import setting

CODE_CHECKPOINTS = {}


def _check_line(line, submission):
    return submission == setting(SEED)["expected"]
`,
      },
      (repoRoot, dir) => {
        expect(findAnswerReachabilityIssues(repoRoot, dir)).toEqual([]);
      },
    );
  });

  it("does not flag the catalog-wide `_check_environment` liveness token", () => {
    withFixture(
      {
        "local/Dockerfile": SINGLE_STAGE_DOCKERFILE,
        "local/fixtures/generate.py": `def health_token(seed):
    return "token"
`,
        "local/verifier/server.py": `from fixtures.generate import health_token


def _check_environment(submission):
    return submission == health_token(SEED)
`,
      },
      (repoRoot, dir) => {
        expect(findAnswerReachabilityIssues(repoRoot, dir)).toEqual([]);
      },
    );
  });

  it("does not flag a two-hop echo of an already-shown parameter (ac26-w2-secret-sharing shape)", () => {
    withFixture(
      {
        "local/Dockerfile": SINGLE_STAGE_DOCKERFILE,
        "local/fixtures/generate.py": `def setting(seed):
    return {"p": 23, "n": 3}
`,
        "local/verifier/server.py": `from fixtures.generate import setting


def _check_threshold(submission):
    cfg = setting(SEED)
    p, n = cfg["p"], cfg["n"]
    if submission.get("sharesNeeded") != n:
        return False
    return True
`,
      },
      (repoRoot, dir) => {
        // \`n\` is a second hop away from the \`setting(...)\` call (it comes out of
        // \`cfg\`, not directly out of the call), which single-hop tracking does not
        // follow — matching the real problem's \`show.py\`, which already prints \`n\`
        // directly, so echoing it back is not a spoiler either way.
        expect(findAnswerReachabilityIssues(repoRoot, dir)).toEqual([]);
      },
    );
  });
});

describe("findAnswerReachabilityIssues — stub-vs-implementation", () => {
  it("catches a starter stub with a same-named complete implementation elsewhere (ac26-w4-commit-open shape)", () => {
    withFixture(
      {
        "local/Dockerfile": SINGLE_STAGE_DOCKERFILE,
        "local/starter/tree.py": `def node_hash(left, right):
    return b""
`,
        "local/fixtures/generate.py": `def node_hash(left, right):
    return hashlib.sha256(left + right).digest()
`,
        "local/verifier/server.py": `CODE_CHECKPOINTS = {}
`,
      },
      (repoRoot, dir) => {
        const findings = findAnswerReachabilityIssues(repoRoot, dir);
        expect(findings.some((f) => f.rule === "stub-vs-implementation" && f.checkpoint === "node_hash")).toBe(
          true,
        );
      },
    );
  });

  it("does not flag a stub with no same-named implementation anywhere reachable", () => {
    withFixture(
      {
        "local/Dockerfile": SINGLE_STAGE_DOCKERFILE,
        "local/starter/tree.py": `def node_hash(left, right):
    return b""
`,
        "local/fixtures/generate.py": `def unrelated_helper(x):
    return x + 1
`,
        "local/verifier/server.py": `CODE_CHECKPOINTS = {}
`,
      },
      (repoRoot, dir) => {
        expect(findAnswerReachabilityIssues(repoRoot, dir)).toEqual([]);
      },
    );
  });

  it("does not flag the catalog-wide `evaluate` dispatcher colliding with an unrelated exercise (ac26-w4-arithmetization shape)", () => {
    withFixture(
      {
        "local/Dockerfile": SINGLE_STAGE_DOCKERFILE,
        "local/starter/poly.py": `def evaluate(coefficients, x, p):
    return 0
`,
        "local/fixtures/generate.py": `def unrelated_helper(x):
    return x + 1
`,
        "local/verifier/server.py": `CODE_CHECKPOINTS = {}


def evaluate(checkpoint_id, submission):
    if checkpoint_id in CODE_CHECKPOINTS:
        return True
    return False
`,
      },
      (repoRoot, dir) => {
        expect(findAnswerReachabilityIssues(repoRoot, dir)).toEqual([]);
      },
    );
  });

  it("treats a docstring-only starter stub (real triple-quoted docstring) as a stub end to end", () => {
    withFixture(
      {
        "local/Dockerfile": SINGLE_STAGE_DOCKERFILE,
        "local/starter/tree.py": `def node_hash(left, right):
    """Combine two children. Order matters here too."""
`,
        "local/fixtures/generate.py": `def node_hash(left, right):
    return hashlib.sha256(left + right).digest()
`,
        "local/verifier/server.py": `CODE_CHECKPOINTS = {}
`,
      },
      (repoRoot, dir) => {
        const findings = findAnswerReachabilityIssues(repoRoot, dir);
        expect(findings.some((f) => f.rule === "stub-vs-implementation" && f.checkpoint === "node_hash")).toBe(
          true,
        );
      },
    );
  });

  it("does not compare a starter stub against reference/ or tests/hidden", () => {
    withFixture(
      {
        "local/Dockerfile": SINGLE_STAGE_DOCKERFILE,
        "local/starter/tree.py": `def node_hash(left, right):
    return b""
`,
        "local/tests/hidden/check_tree.py": `def node_hash(left, right):
    return left + right
`,
        "local/verifier/server.py": `CODE_CHECKPOINTS = {}
`,
      },
      (repoRoot, dir) => {
        expect(findAnswerReachabilityIssues(repoRoot, dir)).toEqual([]);
      },
    );
  });
});

// ---------------------------------------------------------------------------
// The catalog-wide gate: a shrink-only allowlist of already-known findings.
//
// Every problem the detector currently flags must be explained by a baseline entry
// (so a *new* leak fails CI instead of shipping quietly); every baseline entry must
// still be flagged (so a *fixed* problem's entry becomes a failing test until removed,
// which is what makes the list only able to shrink — see PR description for the
// removal policy).
// ---------------------------------------------------------------------------

describe("answer-reachability-baseline.json", () => {
  it("gives every entry an issue number and a reason long enough to explain itself", () => {
    for (const entry of baseline()) {
      expect(entry.problem.length, JSON.stringify(entry)).toBeGreaterThan(0);
      expect(entry.issue, JSON.stringify(entry)).toBeGreaterThan(0);
      // A one-word reason is how an allowlist becomes a list of permissions nobody
      // remembers granting. Say what leaks and where, or fix the problem.
      expect(entry.reason.length, JSON.stringify(entry)).toBeGreaterThan(40);
    }
  });

  it("names only real local-play problems", () => {
    const known = new Set(localPlayProblemDirs(REPO_ROOT).map((dir) => dir.split("/").pop()));
    for (const entry of baseline()) {
      expect(known.has(entry.problem), `${entry.problem} is not a local-play problem`).toBe(true);
    }
  });

  it("names each problem at most once", () => {
    const problems = baseline().map((entry) => entry.problem);
    expect(new Set(problems).size).toBe(problems.length);
  });
});

describe("catalog-wide answer-reachability findings are exactly the baseline", () => {
  const allowed = new Set(baseline().map((entry) => entry.problem));
  const dirs = localPlayProblemDirs(REPO_ROOT);

  it("should find local-play problems to check, so a glob matching nothing cannot pass", () => {
    expect(dirs.length).toBeGreaterThan(0);
  });

  it.each(dirs)("%s should have no answer-reachability findings beyond the baseline", (dir) => {
    const findings = findAnswerReachabilityIssues(REPO_ROOT, dir);
    const problem = dir.split("/").pop() ?? dir;
    if (findings.length === 0) return;
    // A finding on a problem not in the baseline is a *new*, unreviewed leak: fail loud
    // rather than let it merge quietly. See PR description for the two ways to clear
    // this — fix the leak, or add a baseline entry with a real issue number and reason.
    expect(
      allowed.has(problem),
      `${problem} has new answer-reachability findings not covered by ` +
        `answer-reachability-baseline.json:\n` +
        findings.map((f) => `  [${f.rule}] ${f.checkpoint} <- ${f.module}`).join("\n"),
    ).toBe(true);
  });

  it.each(baseline())(
    "$problem's baseline entry should still be a real, currently-detected finding",
    (entry) => {
      // The other half of the ratchet: a baseline entry the detector no longer finds
      // means the problem got fixed and the entry was left behind. Failing here is
      // what forces it out — the list can only shrink, never rot in place.
      const findings = findAnswerReachabilityIssues(REPO_ROOT, `challenges/${entry.problem}`);
      expect(
        findings.length,
        `${entry.problem} is in the baseline but the detector no longer finds anything — ` +
          `remove its entry from answer-reachability-baseline.json`,
      ).toBeGreaterThan(0);
    },
  );
});
