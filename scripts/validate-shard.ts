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
 * Partition into `total` shards, round robin.
 *
 * Round robin rather than contiguous slices because the file list is sorted by
 * name and name order correlates with cost: `ac26-*` are the slow ones and they
 * sit together alphabetically. Contiguous slices would hand one shard most of
 * them. Round robin has no such correlation, and it is deterministic, which
 * matters more here than a perfect balance — a shard assignment that moved
 * between runs would make a failure hard to reproduce.
 *
 * `index` is 1-based to match the CI matrix values a human reads.
 */
export function shardOf(files: readonly string[], index: number, total: number): string[] {
  if (!Number.isInteger(total) || total < 1) throw new Error(`shard count must be >= 1: ${total}`);
  if (!Number.isInteger(index) || index < 1 || index > total) {
    throw new Error(`shard index must be in 1..${total}: ${index}`);
  }
  return files.filter((_, position) => position % total === index - 1);
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
  const files = suiteFiles();
  if (files.length === 0) throw new Error("no test files matched scripts/*.test.ts");
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
  // Passed down so a test file that is itself a catalog-wide sweep can partition its
  // own work the same way. `solvability-audit.test.ts` is the one that needs it: it
  // probes every problem in a single test, so it does not shard by being one file
  // among many, and its shard ran to the 15-minute cap while the other three finished
  // in five to nine minutes. With this it audits its quarter, and
  // `solvability-audit.test.ts` asserts the four quarters still cover the catalog.
  const result = spawnSync("bun", ["test", ...selected], {
    cwd: REPO_ROOT,
    stdio: "inherit",
    env: shard === null ? process.env : { ...process.env, SUITE_SHARD: label },
  });
  process.exit(result.status ?? 1);
}
