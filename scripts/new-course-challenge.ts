#!/usr/bin/env bun
/**
 * [#212] Scaffold an AC26 companion problem from the reference implementation.
 *
 * `bun run new` (scripts/new-problem.ts) scaffolds a CloudFormation problem and keeps that
 * responsibility. This is a separate command rather than a flag on that one, because a
 * container-delivered, terminal-native, seed-derived problem shares almost nothing with a CFn
 * problem beyond the metadata envelope: the participant connects a shell to the container, runs
 * a CLI there, and pastes the flag it emits. There is no file to edit and no starter to ship.
 *
 * The template source is a real, working, CI-covered problem — challenges/ac26-bridge-experiment
 * — not a skeleton, so a freshly scaffolded directory's container runs, and its tests and
 * mutation suite pass, before the author has written a line.
 *
 * It does NOT pass `bun run validate` yet, and cannot: `concept.*` and `misconception.*` node IDs
 * are shared vocabulary with no problem id embedded in them, so a copy duplicates whatever the
 * template declared. That is by design — node IDs are unique catalog-wide — and it resolves as
 * soon as the author writes their own metadata. Do not "fix" it by renaming the template's
 * concepts; reference shared ones through `relations` instead of redeclaring them.
 *
 * Usage:
 *   bun run new-course-challenge <problem-id>
 *   bun run new-course-challenge ac26-w3-field-inverse
 */

import {
  cpSync,
  existsSync,
  readFileSync,
  readdirSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

const REPO_ROOT = new URL("..", import.meta.url).pathname;
const TEMPLATE_ID = "ac26-bridge-experiment";
const CHALLENGES_DIR = join(REPO_ROOT, "challenges");

/** Kebab-case, matching the directory-name-equals-id rule the validator enforces. */
export const PROBLEM_ID_PATTERN = /^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/;

export class ScaffoldError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScaffoldError";
  }
}

/**
 * `track.order` bands come from curriculum.md. Returning the band's first slot lets the author
 * bump within the band without renumbering neighbours.
 */
export function suggestedOrder(problemId: string): number {
  const match = /^ac26-w(\d)-/.exec(problemId);
  if (match) return Number(match[1]) * 100;
  if (problemId.startsWith("ac26-bridge")) return 10;
  return 10;
}

/** Which lecture week the id implies, or undefined for bridge / unrecognized ids. */
export function weekOf(problemId: string): number | undefined {
  const match = /^ac26-w(\d)-/.exec(problemId);
  if (!match) return undefined;
  const week = Number(match[1]);
  return week >= 1 ? week : undefined;
}

/**
 * Rewrite every occurrence of the template's id, including the `lo.` / `assessment.` node ID
 * prefixes that embed it. Node IDs must be unique catalog-wide, so leaving them behind would fail
 * validation with a duplicate-ID error rather than anything that points at the real cause.
 */
export function retarget(source: string, problemId: string): string {
  return source.split(TEMPLATE_ID).join(problemId);
}

/**
 * Strip the parts of the template that are specific to the counter exercise, leaving a problem
 * that obviously needs the author's content. See the note above on why it does not yet pass
 * cross-reference validation.
 */
export function scaffoldMetadata(templateMetadata: string, problemId: string): string {
  const meta = JSON.parse(retarget(templateMetadata, problemId)) as Record<string, unknown>;
  meta.name = `TODO: ${problemId}`;
  meta.status = "draft";
  const track = meta.track as Record<string, unknown>;
  track.order = suggestedOrder(problemId);
  track.chapter = "TODO: Week N / theme";
  return `${JSON.stringify(meta, null, 2)}\n`;
}

const SKIP_ENTRIES = new Set([".git", "node_modules", "__pycache__"]);

/**
 * The template's exercise is a modular counter, and every scaffolded problem replaces it. The
 * files are RENAMED to a neutral `exercise` rather than left in place, because "replace
 * counter.py with your own file" is a trap: an author who writes `auditor.py` alongside it ships
 * a dead `counter.py` and a dead `test_counter.py` inside their image. That happened, reached
 * main, and is what `scaffold-leftover-guard.test.ts` now fails on.
 *
 * With one neutrally-named module per directory, the natural action is a rename, and a rename
 * cannot leave a leftover behind.
 *
 * The terminal-native shape (the participant runs a CLI in the container; there is no file to
 * edit) moved the exercise: `local/counter.py` is the whole participant surface, `local/lab/`
 * holds the judging behind it, and `local/reference/solve.py` is already neutral. There is no
 * `local/starter/` and no `local/tests/hidden/` to rename any more.
 */
const EXERCISE_RENAMES: ReadonlyArray<readonly [string, string]> = [
  ["local/counter.py", "local/exercise.py"],
  ["local/tests/public/test_counter.py", "local/tests/public/test_exercise.py"],
];

/**
 * Only the identifiers that name those files, plus the PATH entry point the Dockerfile installs.
 * A blind `counter` -> `exercise` sweep would also rewrite `counterexample`, which appears in the
 * template's prose.
 *
 * The entry point matters more than it looks: the portal terminal opens in no particular
 * directory, so `counter <command>` only works because the Dockerfile puts a wrapper on PATH.
 * Leave that pointing at a file the rename moved and the scaffolded problem has no participant
 * surface at all — and the failure is "command not found" in the terminal, long after authoring.
 */
const EXERCISE_REFERENCES: ReadonlyArray<readonly [string, string]> = [
  ["tests/public/test_counter.py", "tests/public/test_exercise.py"],
  ["/problem/counter.py", "/problem/exercise.py"],
  ["COPY counter.py ./counter.py", "COPY exercise.py ./exercise.py"],
  ["/usr/local/bin/counter", "/usr/local/bin/exercise"],
  ["$(RUN) counter show", "$(RUN) exercise show"],
  ["from counter import", "from exercise import"],
  // Prose that names the command, not just the code that runs it. A scaffolded Makefile
  // telling its author to "type `counter show`" is describing a command the scaffold just
  // renamed away — the kind of stale instruction that outlives the file it referred to.
  ["`counter show`", "`exercise show`"],
  ["`counter <command>`", "`exercise <command>`"],
  ["on PATH and counter.py", "on PATH and exercise.py"],
];

function renameExerciseFiles(target: string): void {
  for (const [from, to] of EXERCISE_RENAMES) {
    const source = join(target, from);
    if (existsSync(source)) renameSync(source, join(target, to));
  }
}

export function retargetExerciseReferences(source: string): string {
  let out = source;
  for (const [from, to] of EXERCISE_REFERENCES) out = out.split(from).join(to);
  return out;
}

export function scaffold(problemId: string, challengesDir: string = CHALLENGES_DIR): string {
  if (!PROBLEM_ID_PATTERN.test(problemId)) {
    throw new ScaffoldError(
      `"${problemId}" is not a valid problem id (kebab-case, 3-64 chars, no leading/trailing hyphen)`,
    );
  }
  const target = join(challengesDir, problemId);
  if (existsSync(target)) {
    throw new ScaffoldError(`challenges/${problemId} already exists`);
  }
  const template = join(challengesDir, TEMPLATE_ID);
  if (!existsSync(template)) {
    throw new ScaffoldError(`template problem challenges/${TEMPLATE_ID} is missing`);
  }

  cpSync(template, target, {
    recursive: true,
    filter: (source) => !SKIP_ENTRIES.has(source.split("/").at(-1) ?? ""),
  });
  renameExerciseFiles(target);

  for (const file of textFilesUnder(target)) {
    const original = readFileSync(file, "utf8");
    const rewritten = file.endsWith("metadata.json")
      ? scaffoldMetadata(original, problemId)
      : retargetExerciseReferences(retarget(original, problemId));
    if (rewritten !== original) writeFileSync(file, rewritten);
  }
  return target;
}

const TEXT_SUFFIXES = [".json", ".md", ".py", ".yml", ".yaml", ".svg", "Makefile", "Dockerfile"];

function textFilesUnder(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...textFilesUnder(full));
    } else if (TEXT_SUFFIXES.some((suffix) => entry.name.endsWith(suffix))) {
      files.push(full);
    }
  }
  return files;
}

function main(): void {
  const problemId = process.argv[2];
  if (!problemId) {
    console.error("usage: bun run new-course-challenge <problem-id>");
    process.exit(1);
  }
  const target = scaffold(problemId);
  const week = weekOf(problemId);
  console.log(`Scaffolded ${target} from challenges/${TEMPLATE_ID}.`);
  console.log("");
  console.log("Next:");
  console.log("  1. RENAME local/exercise.py and local/tests/public/test_exercise.py to your");
  console.log("     exercise's name, then write it. Repoint the PATH wrapper in local/Dockerfile");
  console.log("     and the `$(RUN) exercise show` line in the Makefile at the new name — the");
  console.log("     portal terminal opens in no particular directory, so that wrapper IS the");
  console.log("     participant surface. Rename rather than add: a leftover module fails");
  console.log("     scripts/scaffold-leftover-guard.test.ts.");
  console.log("  2. Replace local/lab/, local/fixtures/, local/reference/solve.py and the tests");
  console.log("     with your exercise. Keep the /verify contract and the seed-derived flag.");
  console.log("  3. Rewrite metadata.json: name, shortDescription, instructions, description,");
  console.log("     writeup, scoring, nodes, relations, track.chapter.");
  if (week !== undefined) {
    console.log(`  4. Add courseAlignment for week ${week} with a REAL 40-hex upstream commit SHA.`);
    console.log("     Never invent one — see GOVERNANCE.md §5.");
  } else {
    console.log("  4. Omit courseAlignment unless you have a real upstream commit SHA to pin.");
  }
  console.log(`  5. Copy scripts/${TEMPLATE_ID}.test.ts to scripts/${problemId}.test.ts and adapt.`);
  console.log("  6. bun run validate");
  console.log("");
  console.log("Checklist: docs/curricula/advanced-cryptography-2026/TEMPLATE.md");
}

if (import.meta.main) {
  try {
    main();
  } catch (error: unknown) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
