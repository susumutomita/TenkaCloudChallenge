import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "bun:test";

/**
 * `ac26-w2-oblivious-transfer` — the Week 2 Part B companion (Issue 412).
 *
 * ## Why this problem exists
 *
 * The official Week 2 exercise has two halves. This track accompanied only the first
 * (arithmetic MPC: sharing, local addition, Beaver multiplication) and had nothing at
 * all for the second — oblivious transfer and the GMW secret AND. A learner who
 * finished the track met OT for the first time in the official assignment.
 *
 * ## What is pinned here
 *
 * The two properties the problem is actually about, and neither is "does it produce
 * the right answer". Both failures below are **correct on every input** and still hand
 * a secret to the other side, which is precisely why a test that only reconstructs
 * cannot see them:
 *
 *   - drawing the receiver's blind from `1..q-1` instead of `0..q-1` makes two group
 *     elements reachable under one choice and not the other, naming the choice bit;
 *   - reusing one mask across the gate's two transfers still cancels under XOR, while
 *     turning each party's output share into a readout of the other party's bits.
 *
 * The mutation suite is the load-bearing check and it runs inside the image, so it is
 * not reachable here. What is reachable without Docker is the hidden suite itself, run
 * against the reference and against those two mutations — which is the part that would
 * silently rot if someone "simplified" the privacy checks into the correctness ones.
 */

const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const PROBLEM = join(REPO_ROOT, "challenges", "ac26-w2-oblivious-transfer");
const LOCAL = join(PROBLEM, "local");

/** Run the hidden suite against a source string, the way `/verify` does. */
function hiddenFailures(source: string): string[] {
  const script = `
import json, sys, types
sys.path.insert(0, ${JSON.stringify(LOCAL)})
from tests.hidden.check_oblivious import run
module = types.ModuleType("candidate")
exec(compile(sys.stdin.read(), "<candidate>", "exec"), module.__dict__)
print(json.dumps(run(module, "pinned-suite-seed")))
`;
  const out = execFileSync("python3", ["-c", script], {
    input: source,
    encoding: "utf8",
    timeout: 120_000,
  });
  return JSON.parse(out.trim().split("\n").at(-1) as string) as string[];
}

const REFERENCE = readFileSync(join(LOCAL, "reference", "oblivious.py"), "utf8");
const STARTER = readFileSync(join(LOCAL, "starter", "oblivious.py"), "utf8");

/** Apply a mutation and prove it applied — a no-op replace would pass vacuously. */
function mutate(from: string, to: string): string {
  const mutated = REFERENCE.replace(from, to);
  expect(mutated, `mutation did not apply: ${from}`).not.toBe(REFERENCE);
  return mutated;
}

describe("ac26-w2-oblivious-transfer: the problem holds up (Issue 412)", () => {
  it("は reference が hidden suite を通る", () => {
    expect(hiddenFailures(REFERENCE)).toEqual([]);
  });

  it("は starter のままでは通らない", () => {
    // 配布状態で満点が出る問題は問題ではない。
    expect(hiddenFailures(STARTER).length).toBeGreaterThan(0);
  });

  it("は blind から 0 を外した実装を、正しく動いていても落とす", () => {
    // 1 回の転送は成功し続ける。落ちるのは分布の検査だけ。
    const failures = hiddenFailures(
      mutate('    return (0, grp["q"] - 1)', '    return (1, grp["q"] - 1)'),
    );
    expect(failures.join(" ")).toContain("distribution");
  });

  it("は mask を 1 つに使い回した実装を、復元が正しくても落とす", () => {
    const leaky = mutate(
      "    return (randomness[0], randomness[1])",
      "    return (randomness[0], randomness[0])",
    );
    const failures = hiddenFailures(leaky);
    // 「復元は正しいのに落ちる」ことがこの問題の主張なので、両方を固定する。
    // 正しさの検査まで落ちていたら、それは privacy を教えていることにならない。
    expect(failures).toEqual([
      "party 0's view of the gate changes with party 1's secret bits, so the two " +
        "transfers are not independently masked",
    ]);
  });

  it("は公式課題の Part B に対応する pin を持つ", () => {
    const meta = JSON.parse(readFileSync(join(PROBLEM, "metadata.json"), "utf8")) as {
      courseAlignment: { week: number; sources: { path: string; kind: string }[] };
      scoring: { checks: { id: string; points: number }[] };
    };
    expect(meta.courseAlignment.week).toBe(2);
    expect(meta.courseAlignment.sources.map((s) => s.kind).toSorted()).toEqual([
      "assignment",
      "lecture",
    ]);
    expect(meta.scoring.checks.reduce((sum, c) => sum + c.points, 0)).toBe(200);
  });

  it("は参加者に配る面へ reference を混ぜない", () => {
    // starter と公開テストしか読めない参加者が、答えを読めてはいけない。
    const surface = [
      readFileSync(join(LOCAL, "starter", "oblivious.py"), "utf8"),
      readFileSync(join(LOCAL, "tests", "public", "test_oblivious.py"), "utf8"),
      readFileSync(join(PROBLEM, "README.md"), "utf8"),
      readFileSync(join(PROBLEM, "README.ja.md"), "utf8"),
    ].join("\n");
    expect(surface).not.toContain("(randomness[0], randomness[1])");
    expect(surface).not.toContain("mask ^ own_bit");
    expect(surface).not.toContain("(own_x & own_y) ^ own_mask ^ received");
  });
});
