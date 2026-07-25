import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";

/**
 * `bun run new-course-challenge` copies a whole working problem, so an author who *adds* their
 * exercise instead of renaming the template's ships the template's too — a dead `counter.py` in
 * `starter/` and `reference/`, and dead `test_counter.py` / `check_counter.py` in the test
 * directories, all baked into the image.
 *
 * That happened to ac26-w2-privacy-audit and reached main. The scaffolder now hands out one
 * neutrally-named `exercise.py` so the natural action is a rename, and this guard fails the build
 * if a leftover ever appears again — including in problems scaffolded before that change.
 *
 * The invariant is not "one file per problem": ac26-bridge-properties and ac26-w1-constraint-lab
 * legitimately ship several starter modules. It is that starter/ and reference/ describe the same
 * set of modules, and that each problem has exactly one public-test entry point and exactly one
 * hidden-check module.
 */

const CHALLENGES = join(import.meta.dir, "..", "challenges");

function pythonFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".py"))
    .map((entry) => entry.name)
    .sort();
}

const CONTAINER_PROBLEMS = readdirSync(CHALLENGES, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .filter((name) => existsSync(join(CHALLENGES, name, "local", "starter")))
  .sort();

describe("container problems ship no scaffold leftovers", () => {
  it("should find the container-delivered problems to check", () => {
    expect(CONTAINER_PROBLEMS.length).toBeGreaterThan(0);
  });

  it.each(CONTAINER_PROBLEMS)(
    "%s should have reference/ mirror starter/ exactly",
    (problem) => {
      const local = join(CHALLENGES, problem, "local");
      expect(pythonFiles(join(local, "reference"))).toEqual(pythonFiles(join(local, "starter")));
    },
  );

  it.each(CONTAINER_PROBLEMS)(
    "%s should have exactly one public test entry point",
    (problem) => {
      const files = pythonFiles(join(CHALLENGES, problem, "local", "tests", "public"));
      expect(files).toHaveLength(1);
      expect(files[0]).toMatch(/^test_[a-z0-9_]+\.py$/);
    },
  );

  it.each(CONTAINER_PROBLEMS)(
    "%s should have exactly one hidden check module",
    (problem) => {
      const files = pythonFiles(join(CHALLENGES, problem, "local", "tests", "hidden"));
      expect(files).toHaveLength(1);
      expect(files[0]).toMatch(/^check_[a-z0-9_]+\.py$/);
    },
  );

  // The template's own exercise name. Any other problem carrying it is carrying a copy.
  it.each(CONTAINER_PROBLEMS.filter((name) => name !== "ac26-bridge-experiment"))(
    "%s should not carry the template's counter exercise",
    (problem) => {
      const local = join(CHALLENGES, problem, "local");
      for (const [dir, name] of [
        ["starter", "counter.py"],
        ["reference", "counter.py"],
        ["tests/public", "test_counter.py"],
        ["tests/hidden", "check_counter.py"],
      ] as const) {
        expect(existsSync(join(local, ...dir.split("/"), name))).toBe(false);
      }
    },
  );
});
