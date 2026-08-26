#!/usr/bin/env bun
/**
 * Run the catalog test suite, optionally one shard of it.
 *
 * Two problems, one fix.
 *
 * **The suite outgrew a single CI job.** `bun run validate` executes every
 * container problem's starter, reference implementation, mutation suite and
 * `/verify` contract for real, so its wall time tracks the size of the catalog
 * rather than the size of a change. It was around five minutes at 13 problems
 * and eight at 43; at 63 test files it reached the 25-minute cap and the job was
 * cancelled. A cancelled run shows up as a red X with no failing assertion,
 * which is the worst signal available — it reads as flake. Sharding makes the
 * per-job wall time a function of the shard count instead of the catalog size,
 * so the answer to a slower suite is one more shard rather than a bigger number
 * in `timeout-minutes`.
 *
 * **The file list was hand-maintained.** It lived as a 63-entry string inside
 * `package.json`'s `validate` script, and adding a test file without editing
 * that string meant the file never ran in CI — a test that exists, passes
 * locally, and guards nothing. The list turned out to be exactly
 * `scripts/*.test.ts` anyway, so enumerating it removes the drift rather than
 * documenting it.
 *
 * Bun has no `--shard`, so the partition happens here and the file list is
 * passed to `bun test` explicitly.
 */

import { globSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { costOfFile } from "./lib/shard-cost-table.ts";

/**
 * `fileURLToPath` rather than `.pathname`, which keeps percent-encoding: a
 * checkout under a directory with a space in it arrives as `Code%20Repo`, and
 * `globSync` then matches nothing. It fails loudly rather than silently — the
 * runner throws on an empty file list — but "no test files matched" is a
 * confusing way to learn that your directory has a space in its name.
 */
const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));

/** Every test file the catalog suite runs, in a stable order. */
export function suiteFiles(cwd: string = REPO_ROOT): string[] {
  return globSync("scripts/*.test.ts", { cwd }).sort();
}

/**
 * Files that get their own CI job instead of a share of a shard.
 *
 * Sharding by file only spreads cost when the cost is spread across files. The
 * solvability gate is one file that probes the whole catalog inside a single
 * test, so it lands wholly in one shard and grows with the catalog: shard 1 ran
 * to the 15-minute cap while the other three finished in five to nine minutes.
 * Splitting the gate's own work by the suite shard does not help either, because
 * the file is only ever executed by the one shard that owns it — the other three
 * would probe nothing, and each would still report "no findings".
 *
 * So it runs as its own job with its own budget. That is a named exception, and
 * a named exception is a way to drop a test silently, so `validate-shard.test.ts`
 * requires every entry here to be named by a job in `ci.yml`. An unsharded run
 * (`bun run validate`, `make agent-gate`) still runs these files.
 */
export const SEPARATELY_SCHEDULED_FILES = ["scripts/solvability-audit.test.ts"] as const;

/** The files the CI matrix partitions: everything except the separately scheduled ones. */
export function shardableFiles(cwd: string = REPO_ROOT): string[] {
  const separate = new Set<string>(SEPARATELY_SCHEDULED_FILES);
  return suiteFiles(cwd).filter((file) => !separate.has(file));
}

/**
 * Partition into `total` shards by estimated wall-clock cost, heaviest file
 * first (Longest Processing Time / LPT), packed onto the currently
 * least-loaded shard.
 *
 * This used to be `position % total` round robin over the alphabetically
 * sorted file list — deliberately not contiguous slicing, because the slow
 * `ac26-*` files sit together alphabetically and a contiguous slice would hand
 * one shard most of them. Round robin fixed clustering but not coincidence: it
 * balances FILE COUNT, not wall time, so two slow files landing at the same
 * `position % total` still collide in one shard purely by chance. That
 * happened — see `scripts/lib/shard-cost-table.ts`'s docstring for the
 * measured incident this replaces.
 *
 * ## Why greedy-least-loaded-first (LPT) rather than something more clever
 *
 * Bin packing for minimal makespan is NP-hard in general, but LPT (sort
 * heaviest-first, always place the next item on the lightest bin) has a
 * simple, provable bound that is exactly the property that matters here: for
 * any two shards, their final totals differ by at most the cost of the single
 * heaviest file assigned to either one.
 *
 * Proof sketch: consider the shard S with the largest final total, and let `c`
 * be the cost of the last file placed on it. At the moment that file was
 * placed, S was chosen because its running total was then <= every other
 * shard's running total at that same moment (a tie is broken by lowest index,
 * which does not affect the inequality). Every other shard's total can only
 * grow after that moment, so every other shard's FINAL total is >= S's total
 * immediately before `c` was added, i.e. >= S's final total minus `c`. So no
 * other shard's final total can be more than `c` below S's — and `c` is at
 * most the heaviest single cost in the whole file list.
 *
 * That bound holds for greedy-least-loaded assignment regardless of
 * processing order; sorting heaviest-first (true LPT) additionally tends to
 * produce a tighter result in practice, because it resolves the
 * hardest-to-place items while every shard is still empty.
 *
 * ## Determinism
 *
 * `costOf` is a pure function of the file's name against a table fixed at
 * import time; ties in cost are broken by filename; and ties in shard load are
 * broken by which shard has fewer files so far, then by lowest shard index —
 * so this function is a pure function of (`files`, `total`, the cost table),
 * independent of `files`' input order and of anything about the environment
 * it runs in. A file the cost table does not name (a new test, or a stale
 * table) falls back to a fixed default rather than throwing or silently
 * weighing zero — see `costOfFile`'s docstring.
 *
 * The file-count tie-break matters for a run of exactly tied costs (every
 * default-weighted file ties with every other one): comparing only shard
 * totals would let the very first shard "win" every tie forever, since adding
 * a cost that ties with everyone else's never changes who looks least loaded.
 * Breaking ties by count instead makes an all-tied run degenerate to plain
 * round robin — the LPT bound above still holds either way, since it only
 * requires the chosen shard to be among the minimum-cost ones, not which one.
 *
 * `index` is 1-based to match the CI matrix values a human reads.
 */
export function shardsByCost(
  files: readonly string[],
  total: number,
  costOf: (file: string) => number = costOfFile,
): string[][] {
  if (!Number.isInteger(total) || total < 1) throw new Error(`shard count must be >= 1: ${total}`);
  const heaviestFirst = [...files].sort((a, b) => costOf(b) - costOf(a) || a.localeCompare(b));
  const shards: { cost: number; files: string[] }[] = Array.from({ length: total }, () => ({
    cost: 0,
    files: [],
  }));
  for (const file of heaviestFirst) {
    // Tie-break on file count, not just "keep the incumbent", so a run of
    // exactly tied costs still cycles through every shard instead of
    // collapsing onto shard 0 forever. Ties in cost are common by
    // construction (every file `SHARD_COST_SECONDS` does not name shares
    // `DEFAULT_SECONDS`), and a tie of exactly 0 -- an empty table, or a
    // legitimately near-instant file -- would otherwise never move the
    // reduce's running "lightest" candidate away from its very first pick,
    // since adding a zero-cost item never changes what "least loaded" means.
    const shard = shards.reduce((lightest, candidate) => {
      if (candidate.cost !== lightest.cost) return candidate.cost < lightest.cost ? candidate : lightest;
      return candidate.files.length < lightest.files.length ? candidate : lightest;
    });
    shard.files.push(file);
    shard.cost += costOf(file);
  }
  return shards.map((shard) => [...shard.files].sort());
}

/** The one shard `shardsByCost` assigns to `index` — see its docstring for the algorithm. */
export function shardOf(files: readonly string[], index: number, total: number): string[] {
  if (!Number.isInteger(total) || total < 1) throw new Error(`shard count must be >= 1: ${total}`);
  if (!Number.isInteger(index) || index < 1 || index > total) {
    throw new Error(`shard index must be in 1..${total}: ${index}`);
  }
  return shardsByCost(files, total)[index - 1] ?? [];
}

/** `--shard=2/4` → `{index: 2, total: 4}`; absent → the whole suite. */
export function parseShard(argv: readonly string[]): { index: number; total: number } | null {
  const flag = argv.find((argument) => argument.startsWith("--shard="));
  if (flag === undefined) return null;
  const match = /^--shard=(\d+)\/(\d+)$/.exec(flag);
  if (match === null) throw new Error(`expected --shard=<index>/<total>, got: ${flag}`);
  return { index: Number(match[1]), total: Number(match[2]) };
}

if (import.meta.main) {
  const shard = parseShard(process.argv.slice(2));
  const all = suiteFiles();
  if (all.length === 0) throw new Error("no test files matched scripts/*.test.ts");
  // Unsharded means "run everything", so a local `bun run validate` still covers the
  // separately scheduled files that CI gives their own job.
  const files = shard === null ? all : shardableFiles();
  const selected = shard === null ? files : shardOf(files, shard.index, shard.total);
  // An empty shard would exit 0 having run nothing, which is the failure mode
  // this whole file exists to remove. More shards than files is a configuration
  // mistake, so say so rather than pass.
  if (selected.length === 0) {
    throw new Error(
      `shard ${shard?.index}/${shard?.total} is empty: ${files.length} files cannot fill ${shard?.total} shards`,
    );
  }
  const label = shard === null ? "all" : `${shard.index}/${shard.total}`;
  console.log(`running ${selected.length} of ${files.length} test files (shard ${label})`);
  const result = spawnSync("bun", ["test", ...selected], { cwd: REPO_ROOT, stdio: "inherit" });
  process.exit(result.status ?? 1);
}
