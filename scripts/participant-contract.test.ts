import { existsSync, globSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "bun:test";
import { localPlayProblemDirs } from "./lib/local-play-problems";

/**
 * Catalog-wide invariant for the local-play participant contract.
 *
 * `docs/curricula/advanced-cryptography-2026/TEMPLATE.md` promises that the same four
 * `make` targets mean the same thing in every problem in the track, so a learner
 * learns the commands once. The assertions below cover every Makefile field that
 * names something problem-specific.
 */

const REPO_ROOT = new URL("..", import.meta.url).pathname;
const PROBLEM_DIRS = localPlayProblemDirs(REPO_ROOT);
const CONTRACT_TARGETS = ["test", "test-one", "inspect", "reset"] as const;

interface Problem {
  readonly id: string;
  readonly dir: string;
  readonly makefile: string;
}

const PROBLEMS: readonly Problem[] = PROBLEM_DIRS.map((dir) => ({
  id: dir.split("/").at(-1) ?? "",
  dir,
  makefile: readFileSync(join(REPO_ROOT, dir, "Makefile"), "utf8"),
}));

function documentedInspectVariables(problem: Problem): readonly string[] {
  const docs = ["README.md", "README.ja.md"]
    .map((name) => join(REPO_ROOT, problem.dir, name))
    .filter((path) => existsSync(path))
    .map((path) => readFileSync(path, "utf8"))
    .join("\n");
  return [...new Set([...docs.matchAll(/make inspect ([A-Z][A-Z_]*)=/g)].map((match) => match[1] as string))];
}

function inspectRecipe(problem: Problem): string {
  const lines = problem.makefile.split("\n");
  const start = lines.findIndex((line) => line.startsWith("inspect:"));
  if (start < 0) return "";
  const body: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (line.trim() === "") continue;
    if (!line.startsWith("\t")) break;
    body.push(line);
  }
  return body.join("\n").replace(/\$\((RUN[A-Z_]*)\)/g, (whole, name: string) => {
    const definition = problem.makefile.match(new RegExp(`^${name} :=([^]*?)(?=\\n\\S|\\n\\n)`, "m"));
    return definition ? definition[1] as string : whole;
  });
}

describe("local-play participant contract", () => {
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
        expect(problem.makefile).toMatch(/git checkout -- local\/starter\/\s*$/m);
        expect(problem.makefile).not.toMatch(/git checkout -- local\/starter\/\S+\.py/);
      });

      it("should keep every starter file tracked, so reset can actually restore it", () => {
        // Every file, not just `*.py`. What matters is that `make reset` can restore
        // whatever the participant edits, and that is not always Python:
        // `asm-worst-case-latency` hands over a single assembly file, because the
        // thing being graded is a machine instruction. Globbing one extension
        // silently found nothing there, which is the failure mode this assertion
        // exists to prevent.
        // `__pycache__` is created by running the problem locally and is deliberately
        // untracked; it is not something a participant edits.
        const starters = globSync(`${problem.dir}/local/starter/**/*`, { cwd: REPO_ROOT }).filter(
          (path) => statSync(join(REPO_ROOT, path)).isFile() && !path.includes("__pycache__"),
        );
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
        expect(problem.makefile).toContain(`IMAGE := ${problem.id}`);
      });

      it("should only reference files that exist", () => {
        const referenced = [...problem.makefile.matchAll(/\b((?:tests|fixtures)\/\S+\.py|\w+\.py)\b/g)]
          .map((match) => match[1] as string)
          .filter((path) => !path.startsWith("local/"));
        expect(referenced.length).toBeGreaterThan(0);
        for (const path of new Set(referenced)) {
          expect(existsSync(join(REPO_ROOT, problem.dir, "local", path))).toBe(true);
        }
      });

      it("should pass every documented inspect variable into the container", () => {
        const recipe = inspectRecipe(problem);
        for (const variable of documentedInspectVariables(problem)) {
          expect(recipe).toContain(`-e ${variable}=$(${variable})`);
        }
      });

      it("should treat an unset inspect variable as absent, not as an empty string", () => {
        const variables = documentedInspectVariables(problem);
        if (variables.length === 0) return;
        const cwd = join(REPO_ROOT, problem.dir, "local");
        const run = (env: NodeJS.ProcessEnv) =>
          execFileSync("python3", ["show.py"], {
            cwd,
            encoding: "utf8",
            env: { ...process.env, FLAG_SEED: "contract-fixed-seed", ...env },
          });
        const absent = run(Object.fromEntries(variables.map((name) => [name, undefined])));
        const empty = run(Object.fromEntries(variables.map((name) => [name, ""])));
        expect(empty).toBe(absent);
      });
    });
  }
});
