#!/usr/bin/env bun
/**
 * Re-measure `scripts/lib/shard-cost-table.ts`.
 *
 * Runs every `shardableFiles()` entry through `bun test <file>` ONE AT A TIME
 * (not batched, and not in parallel with anything else) and wall-clock times
 * each one, matching the methodology documented in
 * `scripts/lib/shard-cost-table.ts`'s docstring: one file per invocation to
 * avoid the CPU contention that skews timings when several `bun test`
 * processes compete for the same CPUs, at the cost of paying Bun's per-process
 * startup overhead once per file instead of once per (batched) CI shard. That
 * overstatement is close to uniform across files, so it preserves relative
 * ranking, which is the only thing `shardsByCost` in `validate-shard.ts` uses.
 *
 * This intentionally has no `--check` mode, unlike `estimate-cost.ts` /
 * `build-index.ts`'s "generate, commit, gate CI on staleness" pattern: those
 * generators are deterministic functions of committed files, so a stale
 * output is unambiguously a bug. Wall-clock cost is not deterministic — it
 * legitimately drifts with catalog content, CI hardware, and even this
 * sandbox's own load — so a hard "must match measured reality" gate would
 * fail an unrelated PR for timing drift it did not cause. Re-measuring is a
 * human decision (this catalog's cost distribution has visibly shifted), not
 * a CI gate.
 *
 * Usage:
 *   bun run scripts/measure-shard-costs.ts            # print progress + a
 *                                                      # ready-to-paste table
 *   bun run scripts/measure-shard-costs.ts --json      # print {file: seconds}
 *                                                      # JSON instead
 *
 * Prints progress to stderr as it goes (this takes several minutes — the
 * catalog is dozens of container-problem test files deep) and the result to
 * stdout, so `bun run scripts/measure-shard-costs.ts > table.txt` captures
 * only the table.
 */

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { shardableFiles } from "./validate-shard.ts";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));

/** Wall-clock seconds for one `bun test <file>` invocation, run alone. */
function measure(file: string): number {
  const start = performance.now();
  spawnSync("bun", ["test", file], {
    cwd: REPO_ROOT,
    stdio: "ignore",
    env: { ...process.env, CI: "true", npm_config_ignore_scripts: "true" },
  });
  return (performance.now() - start) / 1000;
}

/** The middle value of a non-empty list — robust to the handful of multi-minute outliers a mean is not. */
function median(values: readonly number[]): number {
  if (values.length === 0) throw new Error("median of an empty list is undefined");
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const middleValue = sorted[middle];
  if (middleValue === undefined) throw new Error("unreachable: middle index out of range");
  return sorted.length % 2 === 1 ? middleValue : (sorted[middle - 1] ?? middleValue + middleValue) / 2;
}

if (import.meta.main) {
  const asJson = process.argv.includes("--json");
  const files = shardableFiles();
  const seconds: Record<string, number> = {};
  files.forEach((file, index) => {
    const elapsed = measure(file);
    seconds[file] = Math.round(elapsed * 10) / 10;
    console.error(`[${index + 1}/${files.length}] ${file} -> ${elapsed.toFixed(1)}s`);
  });

  if (asJson) {
    console.log(JSON.stringify(seconds, null, 2));
  } else {
    const values = Object.values(seconds);
    console.log("export const SHARD_COST_SECONDS: Readonly<Record<string, number>> = {");
    for (const file of Object.keys(seconds).sort()) {
      console.log(`  "${file}": ${seconds[file]},`);
    }
    console.log("};");
    console.log("");
    console.log(`// median of the table above, for DEFAULT_SECONDS: ${median(values)}`);
  }
}
