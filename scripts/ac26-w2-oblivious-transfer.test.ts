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

  it("は starter が privacy checkpoint を素通りしないようにする", () => {
    // 実際に開いた穴の回帰テスト。starter は offer も output_share も定数を返すので、
    // 「自分の view が相手の秘密で動かない」は何も計算しないことで完璧に成立していた。
    // solvability audit が `gate-privacy / starter-passes` を 10/10 seed で検出した。
    //
    // privacy は「動く protocol について」の主張なので、両 checkpoint は対応する
    // 正しさ phase を一緒に走らせる。ここで固定するのは checkpoint の構成そのもの。
    const server = readFileSync(join(LOCAL, "verifier", "server.py"), "utf8");
    const phases = /"choice-privacy": \(([^)]*)\)/.exec(server)?.[1] ?? "";
    expect(phases).toContain("check_request");
    const gate = /"gate-privacy": \(([^)]*)\)/.exec(server)?.[1] ?? "";
    expect(gate).toContain("check_and_gate");

    // 構成だけでなく挙動も見る: starter は両方の phase 集合で落ちること。
    const failures = hiddenFailures(STARTER);
    expect(failures.join(" ")).toContain("subgroup");
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
      "party 1's view of the gate changes with party 0's secret bits, so the two " +
        "transfers are not independently masked",
    ]);
  });

  it("は両 party の view を対称に監査する", () => {
    const partyZeroMaskFixed = mutate(
      "    return (randomness[0], randomness[1])",
      "    return (0, randomness[1])",
    );
    expect(hiddenFailures(partyZeroMaskFixed).join(" ")).toContain("party 1's view");
  });

  it("は mutation の過半数が final-output-only 検査を通る設計を固定する", () => {
    const output = execFileSync("python3", ["mutation.py"], {
      cwd: LOCAL,
      encoding: "utf8",
      timeout: 120_000,
    });
    expect(output).toContain("FINAL-OUTPUT-BLIND 8 of 13");
    expect(output).toContain("All 14 mutations killed.");
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
