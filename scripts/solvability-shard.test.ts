import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "bun:test";
import { localPlayProblemDirs } from "./lib/local-play-problems";
import { shardOf } from "./validate-shard.ts";

/**
 * The deep sweep is sharded, and a sharded gate is only worth having if the shards
 * together still cover everything.
 *
 * Two ways that goes wrong silently, both of which this file exists to catch:
 *
 *   - **The matrix and the denominator disagree.** Three jobs each passing `/4` drops a
 *     quarter of the catalog, and every job still passes.
 *   - **A shard is empty.** It exits 0 having probed nothing, which looks exactly like
 *     a shard that probed everything and found nothing.
 *
 * The partition itself is `scripts/validate-shard.ts`'s, already covered by
 * `validate-shard.test.ts`. What is new here is the population being partitioned — the
 * local-play problems rather than the test files — and the workflow that drives it.
 */

const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const WORKFLOW = readFileSync(
  join(REPO_ROOT, ".github", "workflows", "solvability-sweep.yml"),
  "utf8",
);

const PROBLEMS = localPlayProblemDirs(REPO_ROOT);

/** The denominator every shard job passes to the audit. */
function workflowShardTotal(): number {
  // The numerator is `${{ matrix.shard }}`, spaces and all, so it cannot be matched as
  // a bare token. Only the denominator is asserted here.
  const totals = new Set(
    [...WORKFLOW.matchAll(/--shard=.*?\/(\d+)/g)].map((match) => Number(match[1])),
  );
  expect(totals.size).toBe(1);
  return [...totals][0] as number;
}

describe("the sweep partition", () => {
  it("は問題を 1 つも取りこぼさず、二重にも数えない", () => {
    const total = workflowShardTotal();
    const owner = new Map<string, number>();
    for (let index = 1; index <= total; index += 1) {
      for (const problem of shardOf(PROBLEMS, index, total)) {
        expect(owner.has(problem), `${problem} が 2 つの shard に入っている`).toBe(false);
        owner.set(problem, index);
      }
    }
    expect([...owner.keys()].toSorted()).toEqual([...PROBLEMS].toSorted());
  });

  it("は CI が使う分割数で空の shard を作らない", () => {
    // 空の shard は「何も探索せずに exit 0」で、全部探索して finding が無かった run と
    // 見分けが付かない。
    for (let index = 1; index <= workflowShardTotal(); index += 1) {
      expect(shardOf(PROBLEMS, index, workflowShardTotal()).length).toBeGreaterThan(0);
    }
  });
});

describe("CI workflow が分割と一致している", () => {
  it("は denominator と同じ数だけ shard job を走らせる", () => {
    const matrix = /shard:\s*\[([^\]]+)\]/.exec(WORKFLOW);
    expect(matrix).not.toBeNull();
    const values = (matrix?.[1] ?? "")
      .split(",")
      .map((entry) => Number(entry.trim()))
      .toSorted((a, b) => a - b);
    expect(values).toEqual(Array.from({ length: workflowShardTotal() }, (_, i) => i + 1));
  });

  it("は shard ごとに別の report artifact へ書く", () => {
    // 同じ path へ 3 job が書くと、artifact は最後に上がったものだけになり、
    // 残り 2 shard の測定値が黙って消える。
    expect(WORKFLOW).toContain("SOLVABILITY_REPORT=reports/solvability-${{ matrix.shard }}.json");
    expect(WORKFLOW).toContain("name: solvability-report-${{ matrix.shard }}");
  });

  it("は 1 つの shard が落ちても他を止めない", () => {
    // fail-fast だと、最初に落ちた shard 以外の測定値が取れない。sweep は「どこが
    // 壊れているか」を測るものなので、1 件目で打ち切ると目的を果たさない。
    expect(WORKFLOW).toMatch(/fail-fast:\s*false/);
  });
});
