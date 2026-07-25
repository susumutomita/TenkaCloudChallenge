#!/usr/bin/env bun
/**
 * [#212] Scaffold an AC26 companion problem from the reference implementation.
 *
 * `bun run new` (scripts/new-problem.ts) scaffolds a CloudFormation problem and keeps that
 * responsibility. This is a separate command rather than a flag on that one, because a
 * container-delivered, multi-verify, seed-derived problem shares almost nothing with a CFn
 * problem beyond the metadata envelope.
 *
 * The template source is a real, working, CI-covered problem — challenges/ac26-bridge-experiment
 * — not a skeleton, so a freshly scaffolded directory passes `bun run validate` and its container
 * runs before the author has written a line. The author then replaces the counter with their
 * cryptography.
 *
 * Usage:
 *   bun run new-course-challenge <problem-id>
 *   bun run new-course-challenge ac26-w3-field-inverse
 */

import { cpSync, existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
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
 * Strip the parts of the template that are specific to the counter exercise, leaving the author a
 * problem that still validates but obviously needs their content.
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

const SKIP_ENTRIES = new Set([".git", "node_modules"]);

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

  for (const file of textFilesUnder(target)) {
    const original = readFileSync(file, "utf8");
    const rewritten = file.endsWith("metadata.json")
      ? scaffoldMetadata(original, problemId)
      : retarget(original, problemId);
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
  console.log("  1. Replace local/starter, local/reference, local/fixtures and the tests with");
  console.log("     your exercise. Keep the /verify contract and the seed-derived fixtures.");
  console.log("  2. Rewrite metadata.json: name, shortDescription, instructions, description,");
  console.log("     writeup, checks, nodes, relations, track.chapter.");
  if (week !== undefined) {
    console.log(`  3. Add courseAlignment for week ${week} with a REAL 40-hex upstream commit SHA.`);
    console.log("     Never invent one — see GOVERNANCE.md §5.");
  } else {
    console.log("  3. Omit courseAlignment unless you have a real upstream commit SHA to pin.");
  }
  console.log(`  4. Copy scripts/${TEMPLATE_ID}.test.ts to scripts/${problemId}.test.ts and adapt.`);
  console.log("  5. bun run validate");
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
