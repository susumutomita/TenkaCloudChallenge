import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { describe, expect, it } from "bun:test";
import { localPlayVerifiers } from "./lib/local-play-problems";

/**
 * Catalog-wide guard against a submission importing `fixtures` or `tests.hidden` through
 * the verifier's own RUNNER (Issue 591).
 *
 * Issue 543 option B2 moved `fixtures/` and `tests/hidden/` out of the *participant* image,
 * but grading still runs inside a *verifier* image that has both on disk. Every RUNNER
 * imports the hidden checker (and, transitively, `fixtures.generate`) before it imports the
 * submission:
 *
 *     sys.path.insert(0, {root!r})       # /problem -- fixtures/ and tests/hidden/ live here
 *     sys.path.insert(0, {workspace!r})
 *     from tests.hidden import check_xxx  # loads fixtures.generate as a side effect
 *     import <submission>                 # <-- could import fixtures.generate too
 *
 * `root` still being on `sys.path` at that point means a one-line submission --
 * `from fixtures.generate import *` -- can pull in whatever the hidden checker needs to grade
 * against, and satisfy a checkpoint without implementing anything. Removing `root` from
 * `sys.path` is not sufficient by itself: `from tests.hidden import check_xxx` already
 * resolved `fixtures` and `fixtures.generate` into `sys.modules`, and Python's import
 * statement checks that cache *before* consulting `sys.path` -- so the submission's own
 * `import fixtures` returns the cached module regardless of the path removal. The fix has to
 * evict both `tests` and `fixtures` from `sys.modules` as well, immediately before importing
 * the submission, then restore both afterward so any of the hidden checker's own (possibly
 * lazy, function-body-scoped) fixtures imports still resolve once grading proper begins.
 *
 * The precedent this follows (`cs-transaction-visibility-audit`) originally evicted only
 * `tests`, which -- as this file's end-to-end check demonstrates for a different problem --
 * left the `fixtures` half of the leak open through the same sys.modules cache-hit. It has
 * since been widened to cover `fixtures` too, alongside every other verifier that had the
 * `tests`-only precedent and every verifier that had no such guard at all.
 *
 * What this file does NOT claim: honor-system boundaries are unchanged. A submission that
 * puts `root` back on `sys.path` itself, or that hides the import inside a function the
 * checker calls after grading begins, still reaches the file. See TEMPLATE.md "Assurance
 * scope". This closes the one-import-at-module-scope path Issue 591 measured, nothing wider.
 */

const REPO_ROOT = new URL("..", import.meta.url).pathname;

const VERIFIERS = localPlayVerifiers(REPO_ROOT);

/** `asm-worst-case-latency`'s verifier is reviewed native code with no Python RUNNER at all
 * -- `verifier-spoof-guard.test.ts` documents the same exception for the same reason. */
const NO_RUNNER_EXCEPTION = "asm-worst-case-latency";

/**
 * Problems that pre-date the Issue 543 option B2 split: their Dockerfile still copies
 * `fixtures/` and `tests/` directly into a single `participant` stage (`grep -L "AS verifier"`
 * over their Dockerfiles confirms this), so a learner's own build already has full
 * filesystem access to `fixtures.generate` -- the guard below would close nothing real for
 * them. Worse, each one's own reference solution imports `fixtures.generate` directly for a
 * supplied public helper (not a graded secret), which is legitimate for these problems' design
 * the same way `starter.py` shipping in the participant image is; evicting `fixtures` from
 * `sys.modules` before the submission import breaks that top-level import and fails every
 * checkpoint, reference solution included (confirmed against each one below).
 *
 * Closing this properly means giving these problems the same public/hidden fixtures split
 * the already-guarded problems have, which is a larger, separate change than a sys.path/
 * sys.modules guard -- left open here and called out in the Issue 591 PR body as a known
 * limitation, not silently dropped.
 *
 * `ac26-w2-oblivious-transfer` came off this list when it got that split: the supplied
 * helper its starter and reference imported (`derive_key`) moved to `participant/ot.py`,
 * which is not what the guard evicts, so the guard closes the submission-side path there
 * without breaking the reference. Take a problem off this list only together with its
 * split -- never to make the guard test go green.
 *
 * `ac26-w6-cosnark-beaver` came off it the same way: the whole supplied sharing layer, the
 * `field_id` its reference imports included, moved to `participant/mpc.py`. That module is
 * preloaded in the runner before the guard runs and stays in `sys.modules` across it, so
 * the reference still grades 8/8 with the guard in place -- verified against the reference,
 * not by inspection, because the guard drops the problem root from `sys.path` during the
 * submission import and a supplied module can then resolve only through the module cache.
 *
 * `ac26-w6-cosnark-linear` is the same pairing again, on the same shape: `field_id` and the
 * rest of the supplied layer moved to `participant/mpc.py`, the runner preloads it ahead of
 * the guard, and the reference measured 8/8 (300/300) with the guard in place.
 */
const FIXTURES_DEPENDENT_SUBMISSION_EXCEPTIONS = [
  "ac26-bridge-properties",
  "ac26-w6-cosnark-privacy",
  "ac26-w6-stack-design",
  "ac26-w6-zkvm-exploit-predicate",
  "ac26-w6-zkvm-witness-binding",
  "ac26-w7-capstone-demo",
  "ac26-w7-capstone-design",
];

/**
 * The three exact shapes this guard takes across the catalog, rather than one loose regex
 * trying to approximate all of them: the dict-comprehension form this issue introduced, and
 * the two for-loop forms earlier PRs (ac26-w3-passkey-assertion, ac26-w3-field-inverse, and
 * the cs-* problems derived from the cs-transaction-visibility-audit precedent) already used
 * -- each already evicting both `tests` and `fixtures`.
 */
const GUARD_SHAPES = [
  'if name in ("tests", "fixtures") or name.startswith(("tests.", "fixtures."))',
  'if module_name == "tests" or module_name.startswith("tests.") or module_name == "fixtures" or module_name.startswith("fixtures."):',
  'if module_name in ("fixtures", "tests") or module_name.startswith(("fixtures.", "tests.")):',
];

function hasFixturesAndTestsGuard(source: string): boolean {
  return GUARD_SHAPES.some((shape) => source.includes(shape));
}

describe("local-play verifier submission-side fixtures/tests guard", () => {
  it("should find verifiers to check, so a glob matching nothing cannot pass", () => {
    expect(VERIFIERS.length).toBeGreaterThan(0);
  });

  for (const relative of VERIFIERS) {
    const problem = basename(dirname(dirname(dirname(relative))));
    describe(problem, () => {
      const source = readFileSync(join(REPO_ROOT, relative), "utf8");

      if (!source.includes("sys.path.insert(0, {root!r})")) {
        it("should be the one verifier this guard does not apply to", () => {
          expect(problem).toBe(NO_RUNNER_EXCEPTION);
        });
        return;
      }

      if (FIXTURES_DEPENDENT_SUBMISSION_EXCEPTIONS.includes(problem)) {
        it("should still be a documented exception whose own reference imports fixtures", () => {
          // Canary: if a future change makes this problem's reference solution stop
          // depending on fixtures.generate directly, this assertion starts failing --
          // that is the signal to add the guard here and drop the exception, not to
          // relax this check.
          const referenceDir = join(REPO_ROOT, "challenges", problem, "local", "reference");
          const referenceFiles = readdirSync(referenceDir).filter((name) => name.endsWith(".py"));
          expect(referenceFiles.length).toBeGreaterThan(0);
          const anyImportsFixtures = referenceFiles.some((name) =>
            /^\s*(?:from|import)\s+fixtures\b/m.test(
              readFileSync(join(referenceDir, name), "utf8"),
            ),
          );
          expect(anyImportsFixtures).toBe(true);
        });
        return;
      }

      it("should evict both tests and fixtures from sys.modules before importing the submission", () => {
        expect(hasFixturesAndTestsGuard(source)).toBe(true);
      });

      it("should remove the problem root from sys.path before importing the submission", () => {
        expect(source).toContain("while {root!r} in sys.path:\n    sys.path.remove({root!r})");
      });

      const usesNewGuardShape = source.includes(GUARD_SHAPES[0]);
      if (usesNewGuardShape) {
        it("should restore the problem root to sys.path once the submission import is resolved", () => {
          // Not every verifier's hidden checker needs fixtures again after grading begins,
          // but several do it lazily inside a checker function (ac26-w5-extract-key-switch,
          // ac26-w5-cmux-blind-rotation, ac26-w5-rgsw-external, ac26-w3-nonce-reuse) -- so
          // this shape restores access uniformly rather than special-casing which problems
          // need it. The older for-loop guard shapes (the cs-transaction-visibility-audit
          // precedent and its derivatives) never restore, because none of their hidden
          // checkers import fixtures lazily after grading begins -- confirmed per-file, not
          // required here.
          expect(source).toContain(
            "sys.path.insert(0, {root!r})\nsys.modules.update(_hidden_modules)",
          );
        });
      }
    });
  }

  // One end-to-end run rather than 31: the guard is the same shape everywhere and the
  // static assertions above cover the rest. ac26-w5-extract-key-switch is the problem
  // Issue 591 measured at a full 300/300 free score before this fix, and its hidden checker
  // is one of the ones with a lazy fixtures import inside a checker function -- so it also
  // exercises the restore path, not just the eviction.
  describe("end to end", () => {
    const problem = "ac26-w5-extract-key-switch";
    const local = join(REPO_ROOT, "challenges", problem, "local");

    function evaluate(checkpoint: string, submission: string): boolean {
      const script = [
        "import json, sys",
        "sys.path.insert(0, '.')",
        "from verifier.server import evaluate",
        "print(json.dumps(evaluate(sys.argv[1], sys.argv[2])))",
      ].join("\n");
      const result = spawnSync("python3", ["-c", script, checkpoint, submission], {
        cwd: local,
        encoding: "utf8",
        env: { ...process.env, FLAG_SEED: "ci-fixed-seed", PYTHONDONTWRITEBYTECODE: "1" },
        timeout: 180_000,
      });
      expect(result.status).toBe(0);
      return JSON.parse(result.stdout.trim().split("\n").at(-1) ?? "null") === true;
    }

    it("should reject a submission that only imports fixtures.generate", () => {
      expect(evaluate("phase", "from fixtures.generate import *\n")).toBe(false);
    }, 60_000);

    it("should still accept the reference, so the guard did not break the happy path", () => {
      const reference = readFileSync(join(local, "reference", "extract.py"), "utf8");
      expect(evaluate("phase", reference)).toBe(true);
    }, 60_000);
  });
});
