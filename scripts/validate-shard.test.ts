import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import { parseShard, shardOf, suiteFiles } from "./validate-shard.ts";

/**
 * The sharded suite still runs everything.
 *
 * Sharding trades one guarantee for wall time: a single `bun test` invocation
 * obviously ran the files you handed it, whereas four of them only run
 * everything if the partition is exhaustive and the CI matrix agrees with the
 * denominator each job passes. Both halves of that are silent when wrong — a
 * missing shard, or a matrix of three jobs each passing `/4`, drops a quarter of
 * the catalog and every job still goes green.
 *
 * This is the check that makes the trade safe. It is deliberately paranoid
 * about the workflow file rather than only about the partition function,
 * because the partition function is the part that was written carefully and the
 * YAML is the part that gets edited in a hurry.
 */

const REPO_ROOT = new URL("..", import.meta.url).pathname;
const WORKFLOW = readFileSync(join(REPO_ROOT, ".github/workflows/ci.yml"), "utf8");

describe("the shard partition", () => {
  const files = suiteFiles();

  it("should find the suite, so a glob matching nothing cannot pass", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each([1, 2, 3, 4, 5, 8, 13])(
    "should place every file in exactly one of %i shards",
    (total) => {
      const seen = Array.from({ length: total }, (_, offset) => shardOf(files, offset + 1, total));
      expect(seen.flat().sort()).toEqual([...files].sort());
    },
  );

  it("should reject a shard index outside the range", () => {
    expect(() => shardOf(files, 0, 4)).toThrow();
    expect(() => shardOf(files, 5, 4)).toThrow();
    expect(() => shardOf(files, 1, 0)).toThrow();
  });

  it("should read a shard flag and reject a malformed one", () => {
    expect(parseShard(["--shard=2/4"])).toEqual({ index: 2, total: 4 });
    expect(parseShard([])).toBeNull();
    expect(() => parseShard(["--shard=2"])).toThrow();
    expect(() => parseShard(["--shard=x/4"])).toThrow();
  });

  it("should not leave a shard empty at the count CI uses", () => {
    // An empty shard exits 0 having run nothing. The runner throws rather than
    // pass, but the count that matters is the one in the workflow.
    for (let index = 1; index <= workflowShardTotal(); index += 1) {
      expect(shardOf(files, index, workflowShardTotal()).length).toBeGreaterThan(0);
    }
  });
});

/** The denominator every shard job passes to the runner. */
function workflowShardTotal(): number {
  const totals = new Set(
    // The numerator is `${{ matrix.shard }}`, spaces and all, so it cannot be
    // matched as a bare token. Only the denominator is asserted here; the
    // numerators are what the matrix check below covers.
    [...WORKFLOW.matchAll(/--shard=.*?\/(\d+)/g)].map((match) => Number(match[1])),
  );
  expect(totals.size).toBe(1);
  return [...totals][0] as number;
}

describe("the CI workflow agrees with the partition", () => {
  it("should run as many shard jobs as the denominator claims", () => {
    // The failure this catches: bumping the matrix to five entries and leaving
    // `--shard=${{ matrix.shard }}/4`, or the reverse. Either drops files, and
    // every job still passes.
    const matrix = /shard:\s*\[([^\]]+)\]/.exec(WORKFLOW);
    expect(matrix).not.toBeNull();
    const values = (matrix?.[1] ?? "")
      .split(",")
      .map((entry) => Number(entry.trim()))
      .sort((a, b) => a - b);
    expect(values).toEqual(
      Array.from({ length: workflowShardTotal() }, (_, offset) => offset + 1),
    );
  });

  it("should gate on every job, so a failing shard cannot be ignored", () => {
    // The aggregation job exists to keep one stable required-check name in front
    // of a matrix. It is only worth having if it actually fails when a shard
    // does — `needs:` alone does not, once `if: always()` is set.
    expect(WORKFLOW).toMatch(/needs:\s*\[suite, checks\]/);
    // Match the assertion, not the mention. Both job results are also echoed
    // for the log, and a `toContain("needs.checks.result")` was satisfied by
    // that echo alone — deleting the line that actually gates on it left this
    // test green.
    for (const job of ["suite", "checks"]) {
      expect(WORKFLOW).toContain(`test "\${{ needs.${job}.result }}" = "success"`);
    }
  });
});

describe("the suite is enumerated rather than listed", () => {
  it("should not hand-maintain the test file list in package.json", () => {
    // It used to, and a test file left out of that string never ran in CI: it
    // existed, passed locally, and guarded nothing. Enumeration removes the
    // failure mode instead of documenting it.
    const scripts = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8")).scripts as
      Record<string, string>;
    expect(scripts.validate).toContain("validate-shard.ts");
    expect(scripts.validate).not.toMatch(/scripts\/[\w.-]+\.test\.ts/);
  });
});
