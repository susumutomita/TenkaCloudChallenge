import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import { costOfFile } from "./lib/shard-cost-table.ts";
import {
  parseShard,
  SEPARATELY_SCHEDULED_FILES,
  shardOf,
  shardsByCost,
  shardableFiles,
  suiteFiles,
} from "./validate-shard.ts";

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

/** The slice of `text` from the first line containing `start` up to the next `end`. */
function between(text: string, start: string, end: string): string {
  const from = text.indexOf(start);
  if (from === -1) return "";
  const to = text.indexOf(end, from);
  return to === -1 ? text.slice(from) : text.slice(from, to);
}

describe("the shard partition", () => {
  const files = suiteFiles();

  it("should discover exactly what is on disk, not a subset it remembers", () => {
    // `length > 0` on its own would still pass if `suiteFiles()` regressed to a
    // hard-coded list that happened to be non-empty — which is the very failure
    // this whole file exists to remove, since a hand-maintained list is what
    // `package.json` used to hold. Compare against an independent listing so an
    // omitted catalog test fails here.
    expect(files.length).toBeGreaterThan(0);
    expect(files).toEqual(
      readdirSync(join(REPO_ROOT, "scripts"))
        .filter((entry) => entry.endsWith(".test.ts"))
        .map((entry) => `scripts/${entry}`)
        .sort(),
    );
  });

  it.each([1, 2, 3, 4, 5, 8, 13])(
    "should place every file in exactly one of %i shards",
    (total) => {
      const seen = Array.from({ length: total }, (_, offset) => shardOf(files, offset + 1, total));
      expect(seen.flat().sort()).toEqual([...files].sort());
    },
  );

  it("should keep every shard's total cost within one file's cost of every other (the LPT bound)", () => {
    // This replaces an older assertion that no two alphabetically-adjacent files
    // shared a shard — a proxy for "the slow ac26-* files, which sit together
    // alphabetically, don't pile into one shard" that was true only because the
    // old partition was `position % total` round robin. It stopped being the
    // right thing to assert once the partition started reading actual cost
    // (scripts/lib/shard-cost-table.ts): round robin's failure mode was never
    // "adjacent files share a shard", it was "shard TOTALS are uneven" — and
    // round robin's own docstring incident is proof the two are not the same
    // thing. `scripts/ac26-w5-pbs-homnand.test.ts` and
    // `scripts/ac26-w6-cosnark-privacy.test.ts` are not alphabetically adjacent
    // (several files sort between them) and still landed in the same shard,
    // because round robin never looked at cost, only position.
    //
    // The property cost-aware packing actually buys is the LPT bound proved in
    // shardsByCost's docstring: greedy least-loaded-shard assignment can never
    // leave two shards more than one file's cost apart. Assert that directly
    // against the real cost table, on the real file set, at the real shard
    // count CI uses.
    const shardable = shardableFiles();
    const total = workflowShardTotal();
    const bins = shardsByCost(shardable, total);
    const totals = bins.map((bin) => bin.reduce((sum, file) => sum + costOfFile(file), 0));
    const heaviestFile = Math.max(...shardable.map((file) => costOfFile(file)));
    expect(Math.max(...totals) - Math.min(...totals)).toBeLessThanOrEqual(heaviestFile + 1e-9);
  });

  it("should assign the same shards on repeated calls (determinism)", () => {
    // shardsByCost has no source of randomness or wall-clock input of its own —
    // it reads a table fixed at import time — but a partition that is
    // deterministic in principle and flaky in practice (e.g. an unstable sort,
    // or a tie-break that reads Map iteration order) would be worse than an
    // honest round robin, because a shard assignment that moves between runs
    // makes a CI failure hard to reproduce locally.
    const shardable = shardableFiles();
    const total = workflowShardTotal();
    expect(shardsByCost(shardable, total)).toEqual(shardsByCost(shardable, total));
  });

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
    // pass, but the count that matters is the one in the workflow. What CI
    // partitions is `shardableFiles()`, not every test file.
    const shardable = shardableFiles();
    for (let index = 1; index <= workflowShardTotal(); index += 1) {
      expect(shardOf(shardable, index, workflowShardTotal()).length).toBeGreaterThan(0);
    }
  });

  it("should give every separately scheduled file a job that names it", () => {
    // Keeping a file out of the matrix is how a test stops running while every
    // check stays green. The exception is only safe while something else runs it.
    expect(SEPARATELY_SCHEDULED_FILES.length).toBeGreaterThan(0);
    for (const file of SEPARATELY_SCHEDULED_FILES) {
      expect(files).toContain(file);
      expect(shardableFiles()).not.toContain(file);
      expect(WORKFLOW).toContain(file);
    }
  });
});

describe("cost-aware packing catches what alphabetical-adjacency avoidance could not", () => {
  it("does not let two heavy files collide the way position % total did", () => {
    // Reconstructs the shape of the actual incident: two heavy files whose
    // positions in the sorted file list differ by exactly `total`, so the old
    // `position % total` round robin placed both in the same shard regardless
    // of how expensive either one was. `a-heavy` and `e-heavy` sit 4 apart in
    // an 8-file, 4-shard list — the same relationship `ac26-w5-pbs-homnand`
    // and `ac26-w6-cosnark-privacy` happened to have.
    const files = [
      "a-heavy.test.ts",
      "b.test.ts",
      "c.test.ts",
      "d.test.ts",
      "e-heavy.test.ts",
      "f.test.ts",
      "g.test.ts",
      "h.test.ts",
    ];
    const total = 4;
    const cost = (file: string): number => (file.includes("heavy") ? 100 : 1);

    // Prove the fixture actually reproduces the incident before proving the fix:
    // the old algorithm, restated here rather than imported, since the whole
    // point is that it no longer exists to import.
    const oldRoundRobin = (index: number): string[] =>
      files.filter((_, position) => position % total === index);
    expect(oldRoundRobin(0)).toEqual(["a-heavy.test.ts", "e-heavy.test.ts"]);

    // The replacement must not reproduce that collision: each heavy file should
    // land in a shard of its own.
    const bins = shardsByCost(files, total, cost);
    const heavyOwners = bins
      .map((bin, index) => (bin.some((file) => file.includes("heavy")) ? index : null))
      .filter((index): index is number => index !== null);
    expect(heavyOwners.length).toBe(2);
    expect(new Set(heavyOwners).size).toBe(2);
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
    //
    // The job list is read out of the workflow rather than repeated here. A
    // hand-written copy is the same defect this file exists for: adding a job and
    // forgetting the gate leaves every check green and the new job unenforced,
    // and a stale list in the test is exactly what would hide it.
    const jobs = [...WORKFLOW.slice(WORKFLOW.indexOf("\njobs:\n")).matchAll(/^ {2}([\w-]+):$/gmu)]
      .map((match) => match[1])
      .filter((job) => job !== "validate");
    expect(jobs.length).toBeGreaterThan(1);
    expect(jobs).toContain("suite");

    const needs = /needs:\s*\[([^\]]+)\]/.exec(WORKFLOW);
    expect(needs).not.toBeNull();
    const listed = (needs?.[1] ?? "").split(",").map((entry) => entry.trim());
    expect(listed.sort()).toEqual([...jobs].sort());

    // Match the decision, not the mention. Every job result is also echoed for the
    // log, and a `toContain("needs.checks.result")` was satisfied by that echo alone —
    // deleting the line that actually gated on it left this test green. So require two
    // things per job: its result is bound to an environment variable of its own, and
    // that variable is named in one of the aggregation job's two assertion lists.
    const strict = between(WORKFLOW, 'for pair in "changes:', "done");
    const tolerant = between(WORKFLOW, 'for pair in "rls-runtime:', "done");
    for (const job of jobs) {
      const binding = new RegExp(String.raw`^\s+([A-Z_]+): \$\{\{ needs\.${job}\.result \}\}$`, "mu").exec(
        WORKFLOW,
      );
      expect(binding, `${job}'s result is not bound to an environment variable`).not.toBeNull();
      const term = `"${job}:$${binding?.[1]}"`;
      expect(
        strict.includes(term) || tolerant.includes(term),
        `${job} is never asserted — it is bound to ${binding?.[1]} but that never reaches the verdict`,
      ).toBe(true);
    }

    // `skipped` counts as a pass only in the tolerant list, and only the jobs gated on
    // `changes` may appear there. A job that always runs must not drift into it, or a
    // real skip (a cancelled dependency, a bad `if:`) would read as a pass.
    const gated = new Set(
      jobs.filter((job) => {
        const start = WORKFLOW.indexOf(`\n  ${job}:\n`);
        const rest = WORKFLOW.slice(start + 1);
        const next = /^ {2}[\w-]+:$/mu.exec(rest.slice(rest.indexOf("\n")));
        const block = next === null ? rest : rest.slice(0, rest.indexOf("\n") + next.index);
        return block.includes("if: needs.changes.outputs.");
      }),
    );
    expect(gated.size).toBeGreaterThan(0);
    for (const job of jobs) {
      if (gated.has(job)) continue;
      expect(tolerant, `${job} is not gated on changes, so skipped must not pass for it`).not.toContain(
        `"${job}:$`,
      );
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
