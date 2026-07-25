import { existsSync, globSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "bun:test";
import { execFileSync } from "node:child_process";

/**
 * Catalog-wide invariant for the AC26 participant contract.
 *
 * `docs/curricula/advanced-cryptography-2026/TEMPLATE.md` promises that the same four
 * `make` targets mean the same thing in every problem in the track, so a learner
 * learns the commands once. That promise is only as good as the Makefiles.
 *
 * It was not good. `make reset` was broken in **6 of 7** problems at the time this
 * test was written: every one had been scaffolded from `ac26-bridge-experiment` and
 * still ran `git checkout -- local/starter/counter.py`, a filename that exists in
 * exactly one problem. A learner who broke their starter and reset it got
 * `error: pathspec ... did not match any file(s) known to git`.
 *
 * The reason it rotted, and the reason this has to be a test rather than care:
 * `reset` is the only contract target an author never runs while authoring. `test`,
 * `test-one`, and `inspect` are how you develop a problem, so their paths get fixed
 * immediately. Nobody resets a starter they are writing.
 *
 * So the assertions below cover the whole copy-paste class — every Makefile field
 * that names something problem-specific — not just the one instance that was found.
 */

const REPO_ROOT = new URL("..", import.meta.url).pathname;
const MAKEFILES = globSync("challenges/ac26-*/Makefile", { cwd: REPO_ROOT }).sort();

/** The four targets TEMPLATE.md documents as the shared participant contract. */
const CONTRACT_TARGETS = ["test", "test-one", "inspect", "reset"] as const;

interface Problem {
  readonly id: string;
  readonly dir: string;
  readonly makefile: string;
}

const PROBLEMS: readonly Problem[] = MAKEFILES.map((relative) => {
  const dir = dirname(relative);
  return {
    id: dir.split("/").at(-1) ?? "",
    dir,
    makefile: readFileSync(join(REPO_ROOT, relative), "utf8"),
  };
});

describe("AC26 participant contract", () => {
  it("should find problems to check, so a glob matching nothing cannot pass", () => {
    expect(PROBLEMS.length).toBeGreaterThan(0);
  });

  for (const problem of PROBLEMS) {
    describe(problem.id, () => {
      it("should define every documented contract target", () => {
        for (const target of CONTRACT_TARGETS) {
          expect(problem.makefile).toMatch(new RegExp(`^${target}:`, "m"));
        }
      });

      it("should reset the starter directory rather than a named file", () => {
        // A filename here goes stale the moment the problem is scaffolded from
        // another one, and cannot cover a problem that ships two starters.
        expect(problem.makefile).toMatch(/git checkout -- local\/starter\/\s*$/m);
        expect(problem.makefile).not.toMatch(/git checkout -- local\/starter\/\S+\.py/);
      });

      it("should keep every starter file tracked, so reset can actually restore it", () => {
        // `git checkout -- <dir>` silently skips untracked files, which would make
        // reset appear to work while leaving the learner's edit in place.
        const starters = globSync(`${problem.dir}/local/starter/**/*.py`, { cwd: REPO_ROOT });
        expect(starters.length).toBeGreaterThan(0);
        const tracked = execFileSync("git", ["ls-files", "--", `${problem.dir}/local/starter`], {
          cwd: REPO_ROOT,
          encoding: "utf8",
        })
          .split("\n")
          .filter(Boolean);
        for (const starter of starters) expect(tracked).toContain(starter);
      });

      it("should tag its image with its own problem id", () => {
        // Two problems sharing an image tag means building one silently replaces the
        // other's image, and `make test` then runs the wrong problem.
        expect(problem.makefile).toContain(`IMAGE := ${problem.id}`);
      });

      it("should only reference files that exist", () => {
        // Catches a scaffolded Makefile still pointing at the template's paths.
        const referenced = [...problem.makefile.matchAll(/\b((?:tests|fixtures)\/\S+\.py|\w+\.py)\b/g)]
          .map((match) => match[1] as string)
          .filter((path) => !path.startsWith("local/"));
        expect(referenced.length).toBeGreaterThan(0);
        for (const path of new Set(referenced)) {
          expect(existsSync(join(REPO_ROOT, problem.dir, "local", path))).toBe(true);
        }
      });
    });
  }
});
