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
 *
 * `ac26-w7-capstone-demo` came off it on the same pairing. Its supplied half — the `Setting`
 * object, the vocabulary, the tiny settings and the randomness contract, all of which
 * `starter/capstone.py`'s own stubs name — moved to `participant/lab.py`, which the runner
 * preloads ahead of the guard and which the guard does not evict. Verified against the
 * reference rather than by inspection: 8/8 (300/300) with the guard in place, and a
 * `from fixtures.generate import *` submission at 0/8 with it and without it (this problem's
 * `fixtures/generate.py` defines none of the graded names, so the guard-removal control is
 * flat here — the reference is the usable positive control, as with ac26-w2-beaver-mul).
 *
 * `ac26-w7-capstone-design` came off it on the same pairing as its Week 7 twin. Its supplied
 * half — the property vocabulary and the option table, all four of which `starter/design.py`'s
 * own docstring names — moved to `participant/lab.py`, which the runner preloads ahead of the
 * guard and which the guard does not evict. Verified against the reference rather than by
 * inspection: 8/8 (300/300) with the guard in place, and a `from fixtures.generate import *`
 * submission at 0/8 with it and without it (this problem's `fixtures/generate.py` defines none
 * of the eight graded names, so the guard-removal control is flat here — the reference is the
 * usable positive control, as with ac26-w2-beaver-mul).
 *
 * `ac26-w6-zkvm-exploit-predicate` came off it on the same pairing. Its supplied half — the
 * vocabulary, the two shapes and the domain check, all of which `starter/guest.py`'s own
 * docstring names — moved to `participant/lab.py`, beside the eight practice guests in
 * `participant/guests.py` the same docstring names; the runner preloads both ahead of the
 * guard and the guard evicts neither. Verified against the reference rather than by
 * inspection: 8/8 (300/300) with the guard in place, and a `from fixtures.generate import *`
 * submission at 0/8 with it and without it (this problem's `fixtures/generate.py` defines none
 * of the seven graded names, so the guard-removal control is flat here — the reference is the
 * usable positive control, as with ac26-w2-beaver-mul).
 *
 * `ac26-w6-zkvm-witness-binding` came off it on the same pairing as its Week 6 twin. Its
 * supplied half — the vocabulary, the semantics profiles, the commitment, the image decoder,
 * the two encoders and the toy `Env`, all of which `starter/guest.py`'s own docstring names —
 * moved to `participant/lab.py`, which the runner preloads ahead of the guard and which the
 * guard does not evict. Verified against the reference rather than by inspection: 8/8
 * (300/300) with the guard in place, and a `from fixtures.generate import *` submission at 0/8
 * with it and without it (this problem's `fixtures/generate.py` defines none of the eight
 * graded names, so the guard-removal control is flat here — the reference is the usable
 * positive control, as with ac26-w2-beaver-mul).
 *
 * `ac26-w6-stack-design` came off it on the same pairing, and it is the last one but one. Its
 * supplied half — the closed vocabularies, the three levels of contract, the eleven boundary
 * classes and what breaking one costs, and four accessors for walking a typed graph, all of
 * which `starter/stack.py`'s own docstring names — moved to `participant/lab.py`, which the
 * runner preloads ahead of the guard and which the guard does not evict. Verified against the
 * reference rather than by inspection: 8/8 (300/300) with the guard in place.
 *
 * It is also the one to read for **why a flat `from fixtures.generate import *` control proves
 * nothing**. That submission reads 0/8 here with the guard and without it, which on every
 * earlier problem on this list meant the fixtures defined none of the graded names. Here it
 * means something else: this `fixtures/generate.py` defines all eight answers under *different*
 * names — `constrained` is `carried`, `underwritten` is `underwrites`, `load_bearing` is
 * `property_map`, `violations` is `contract_violations`, `first_broken` is `first_failure`,
 * `selection_truth` is `select`, and `_one_change_neighbours` with `local_checks_pass` and
 * `_whole` is the search the remaining two are graded on. A submission whose import renames them
 * (`from fixtures.generate import constrained as carried, ...`) scores **8/8, 300/300 with the
 * guard removed and 0/8 with it in place**. So the submission-side path this exception left open
 * was worth the whole problem, and the standard probe could not see it. When a problem's
 * `fixtures/` holds the answers under other names, rename the import before concluding the
 * control is flat.
 *
 * `ac26-bridge-properties` is the one entry left, and it was re-measured on that reading
 * rather than inherited: its `fixtures/generate.py` carries `TRUTH`, the property matrix
 * `classify` is graded on, and its reference imports that exact name, so it looks like the same
 * shape. It is not. Four of its five checkpoints are *answer* checkpoints, which no
 * submission-side import reaches; only `transfer` (40 of 200) is code, and `transfer` re-runs
 * the learner's own counterexample generators. Measured: shipped starter 0/200, a
 * `from fixtures.generate import TRUTH` submission beside the shipped generators **0/200**,
 * the same submission beside correct generators 40/200, the reference 40/200, the star import
 * 0/200. The 40 is only reachable by having already done the other four checkpoints' work for
 * real, so the exception is what it says it is.
 *
 * `ac26-w6-cosnark-privacy` completes the Week 6 co-SNARK trio. Its split moved three
 * modules rather than one -- `participant/mpc.py` (the supplied sharing runtime, sink and
 * policy vocabulary), `participant/specimens.py` (the eight provers as runnable objects,
 * without `GROUND_TRUTH`) and `participant/lab.py` (the bench) -- and its reference imports
 * from two of them at module level, so all three are preloaded ahead of the guard. Verified
 * against the reference rather than by inspection: 8/8 (300/300) with the guard in place.
 */
const FIXTURES_DEPENDENT_SUBMISSION_EXCEPTIONS = ["ac26-bridge-properties"];

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
