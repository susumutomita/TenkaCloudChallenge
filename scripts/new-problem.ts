/**
 * Scaffold a new problem so contributors can add one with a single command.
 *
 * Why: previously "add a problem" meant hand-creating a directory, hand-writing a
 * schema-valid metadata.json, and then remembering to run build-index + estimate-cost
 * (CI fails with --check if you forget). This copies a known-good sample as the
 * starting point (so it validates immediately) and regenerates the catalog index, so
 * the only manual work left is editing the two files to describe your problem.
 *
 * Usage:
 *   bun run new <battles|challenges> <id> [--from <sampleId>]
 *   bun run scripts/new-problem.ts battles my-cool-battle
 *
 * After it runs: edit <category>/<id>/{metadata.json,template.yaml}, then
 * `bun run validate`. The index is regenerated for you (and the pre-commit hook keeps
 * it fresh on every commit).
 */

import { cpSync, existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CATEGORIES = ["battles", "challenges"] as const;
type Category = (typeof CATEGORIES)[number];
const DEFAULT_SAMPLE: Record<Category, string> = {
  battles: "hello-world-battle",
  challenges: "hello-world",
};
const ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

interface Args {
  readonly category: Category;
  readonly id: string;
  readonly from: string;
}

export function parseArgs(argv: readonly string[]): Args | { readonly error: string } {
  const positional = argv.filter((a) => !a.startsWith("--"));
  const fromIdx = argv.indexOf("--from");
  const from = fromIdx >= 0 ? argv[fromIdx + 1] : undefined;
  const [category, id] = positional;
  if (category !== "battles" && category !== "challenges") {
    return { error: `category must be 'battles' or 'challenges' (got ${category ?? "nothing"})` };
  }
  if (!id || !ID_RE.test(id)) {
    return { error: `id must be lowercase kebab-case (got ${id ?? "nothing"})` };
  }
  return { category, id, from: from && from.length > 0 ? from : DEFAULT_SAMPLE[category] };
}

/** sample の metadata.json を新 id 向けに書き換える (= 即 validate を通る draft skeleton)。 */
export function rewriteMetadata(raw: string, id: string): string {
  const meta = JSON.parse(raw) as Record<string, unknown>;
  meta.id = id;
  meta.name = `TODO: ${id}`;
  meta.status = "draft"; // 公開前提を外す (= レビューまで catalog に "ready" で出さない)。
  meta.shortDescription = "TODO: one-line description shown in the catalog.";
  return `${JSON.stringify(meta, null, 2)}\n`;
}

function reindex(io: { log: (m: string) => void }): void {
  for (const [script, args] of [
    ["scripts/build-index.ts", []],
    ["scripts/estimate-cost.ts", ["--write"]],
  ] as const) {
    const r = spawnSync("bun", ["run", script, ...args], { cwd: REPO_ROOT, stdio: "inherit" });
    if (r.status !== 0) io.log(`[new-problem] WARN ${script} exited ${r.status}; run it manually.`);
  }
}

function main(): void {
  const parsed = parseArgs(process.argv.slice(2));
  if ("error" in parsed) {
    console.error(`[new-problem] ${parsed.error}`);
    console.error("Usage: bun run new <battles|challenges> <id> [--from <sampleId>]");
    process.exit(1);
  }
  const { category, id, from } = parsed;
  const dest = join(REPO_ROOT, category, id);
  const src = join(REPO_ROOT, category, from);
  if (existsSync(dest)) {
    console.error(`[new-problem] ${category}/${id} already exists.`);
    process.exit(1);
  }
  if (!existsSync(src)) {
    console.error(
      `[new-problem] sample ${category}/${from} not found. Available: ${readdirSync(join(REPO_ROOT, category)).join(", ")}`,
    );
    process.exit(1);
  }

  cpSync(src, dest, { recursive: true });
  const metaPath = join(dest, "metadata.json");
  writeFileSync(metaPath, rewriteMetadata(readFileSync(metaPath, "utf8"), id));
  console.log(`[new-problem] created ${category}/${id} (copied from ${from}).`);

  reindex({ log: console.log });

  console.log(
    [
      "",
      "Next:",
      `  1. Edit ${category}/${id}/metadata.json (name, description, scoring, endpoints, disruptions).`,
      `  2. Edit ${category}/${id}/template.yaml (your CloudFormation deploy body).`,
      "  3. bun run validate   # schema + cross-ref check",
      "  4. Set status to \"ready\" when done, then open a PR.",
      "The catalog index.json / cost-report.json were regenerated for you.",
    ].join("\n"),
  );
}

if (import.meta.main) main();
