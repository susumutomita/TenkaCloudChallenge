import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import { localPlayProblemDirs } from "./lib/local-play-problems.ts";
import { findings, type Report } from "./solvability-audit.ts";
import { shardOf } from "./validate-shard.ts";

/**
 * The solvability gate.
 *
 * Every other suite in this repo asks whether an implementation is correct. This one asks
 * whether the *question* is one: does an answer exist on every seed, is it something the
 * player has to work out rather than copy or guess, does the shipped reference pass, does
 * the shipped starter still fail. See `scripts/solvability-audit.ts` for why — two live
 * defects on `ac26-bridge-experiment` cleared every existing gate, because both were
 * properties of the fixture distribution and every gate ran one seed.
 *
 * The budget here is the gate budget, not the sweep budget: enough to catch a defect that
 * hits a meaningful share of deploys, small enough to run on every push. The periodic
 * deep sweep is `make solvability-sweep`. Both print the incidence they could actually
 * have seen, so "this run found nothing" never reads as "there is nothing".
 */

const ROOT = join(import.meta.dir, "..");
const BASELINE = join(ROOT, "scripts", "solvability-baseline.json");

/**
 * This test probes the whole catalog inside one test, so being one file among many buys
 * it nothing: its CI shard ran to the 15-minute cap while the other three finished in
 * five to nine minutes, and a cancelled shard reads as flake rather than as a budget
 * that no longer fits. `scripts/validate-shard.ts` publishes which suite shard is
 * running, and the audit partitions the catalog by the same rule, so each shard audits
 * its quarter and the four together still audit everything. Nothing is dropped and no
 * probe is made cheaper; run standalone (no `SUITE_SHARD`), it still sweeps the lot.
 */
function suiteShardArgs(): string[] {
  const shard = process.env.SUITE_SHARD;
  return shard ? [`--shard=${shard}`] : [];
}

type BaselineEntry = {
  problem: string;
  checkpoint: string;
  type: string;
  reason: string;
  recordedAtSeeds: number;
};

function baseline(): BaselineEntry[] {
  const parsed = JSON.parse(readFileSync(BASELINE, "utf8")) as {
    accepted?: BaselineEntry[];
    open?: BaselineEntry[];
  };
  return [...(parsed.accepted ?? []), ...(parsed.open ?? [])];
}

describe("solvability baseline", () => {
  it("gives every recorded finding a reason and the sweep size it was recorded at", () => {
    for (const entry of baseline()) {
      expect(entry.problem.length, JSON.stringify(entry)).toBeGreaterThan(0);
      expect(entry.checkpoint.length, JSON.stringify(entry)).toBeGreaterThan(0);
      expect(entry.type.length, JSON.stringify(entry)).toBeGreaterThan(0);
      // A one-word reason is how a waiver file becomes a list of permissions nobody
      // remembers granting. Say what makes it acceptable, or fix the problem.
      expect(entry.reason.length, JSON.stringify(entry)).toBeGreaterThan(40);
      expect(entry.recordedAtSeeds, JSON.stringify(entry)).toBeGreaterThan(0);
    }
  });

  it("names only problems that exist", () => {
    const known = new Set(localPlayProblemDirs(ROOT).map((dir) => dir.split("/").pop()));
    for (const entry of baseline()) {
      expect(known.has(entry.problem), `${entry.problem} is not a local-play problem`).toBe(true);
    }
  });
});

/**
 * The numbers below are the audit's own output, replayed against `b64926b^` — the last
 * revision of `ac26-bridge-experiment` that still carried the two defects. They are here
 * because a threshold that no longer fires on the defect it was chosen for is worse than
 * no threshold: the report would say clean and mean unmeasured.
 *
 * Reproduce with:
 *   git archive b64926b^ challenges/ac26-bridge-experiment | tar -x -C /tmp/old
 *   python3 scripts/solvability/audit.py --problem /tmp/old/challenges/ac26-bridge-experiment \
 *     --mode value --seeds 2000 --expected-dir <a copy with first-broken renamed to inspect>
 */
function replayOfTheKnownDefects(): Report {
  return {
    problem: "ac26-bridge-experiment@b64926b^",
    notAudited: [],
    rows: [
      {
        // `first-broken`, then called `inspect`: on 45.5 % of seeds the corrupted trace
        // never left [0, modulus) and the only accepted answer was -1.
        checkpoint: "inspect",
        kind: "value",
        seeds: 2000,
        distinctAnswers: 9,
        mostCommonRate: 0.455,
        sentinelRate: 0.455,
        sentinelExamples: ["solvability-1", "solvability-2"],
        visibleDeclared: true,
        fixtureFieldSeeds: 2000,
        fixtureFieldRates: { step: { rate: 0.051, control: 0.065 } },
      },
      {
        // `predict`: the answer was the printed `start` on 9.5 % of seeds, against a
        // 6.25 % chance level. The whole point of the field-level probe.
        checkpoint: "predict",
        kind: "value",
        seeds: 2000,
        distinctAnswers: 23,
        mostCommonRate: 0.08,
        sentinelRate: 0,
        visibleDeclared: true,
        fixtureFieldSeeds: 2000,
        fixtureFieldRates: {
          start: { rate: 0.095, control: 0.0625 },
          step: { rate: 0.071, control: 0.064 },
          rounds: { rate: 0.0665, control: 0.0685 },
        },
      },
    ],
  };
}

describe("the gate's suite-shard partition", () => {
  it("covers every local-play problem exactly once at the shard count CI runs", () => {
    // The failure this catches: the gate quietly auditing three quarters of the catalog
    // and passing. Each shard reports "no findings" for what it looked at, so a dropped
    // quarter is invisible in the output.
    const workflow = readFileSync(join(ROOT, ".github", "workflows", "ci.yml"), "utf8");
    const totals = new Set(
      [...workflow.matchAll(/--shard=.*?\/(\d+)/g)].map((match) => Number(match[1])),
    );
    expect(totals.size).toBe(1);
    const total = [...totals][0] as number;

    const problems = localPlayProblemDirs(ROOT);
    const owner = new Map<string, number>();
    for (let index = 1; index <= total; index += 1) {
      const selected = shardOf(problems, index, total);
      // An empty shard exits 0 having probed nothing, which looks exactly like a shard
      // that probed everything and found nothing.
      expect(selected.length, `shard ${index}/${total} is empty`).toBeGreaterThan(0);
      for (const problem of selected) {
        expect(owner.has(problem), `${problem} is in two shards`).toBe(false);
        owner.set(problem, index);
      }
    }
    expect(owner.size).toBe(problems.length);
  });
});

describe("solvability thresholds still fire on the defects they were chosen for", () => {
  it("reports the sentinel-only answer as no-answer", () => {
    const types = findings(replayOfTheKnownDefects())
      .filter((finding) => finding.checkpoint === "inspect")
      .map((finding) => finding.type);
    expect(types).toContain("no-answer");
  });

  it("reports the answer that equals the printed start as answer-on-screen", () => {
    const hits = findings(replayOfTheKnownDefects()).filter(
      (finding) => finding.checkpoint === "predict" && finding.type === "answer-on-screen",
    );
    expect(hits.map((finding) => finding.detail).join(" ")).toContain("start");
    // `step` and `rounds` sit at their own control on the same rows. A rule that flagged
    // them too would be reporting the small answer space, not the leak.
    expect(hits).toHaveLength(1);
  });
});

describe("solvability gate", () => {
  it(
    "finds no unexplained solvability defect across the course catalog",
    () => {
      // ~2.5 min. This file is picked up by scripts/validate-shard.ts's `scripts/*.test.ts`
      // glob, so it shares a 15-minute CI shard with a sixth of the catalog suite; the
      // code probes are what cost, and 10 seeds of them is what fits. At that size the
      // run sees a defect present on >= 26 % of deploys, which is the gross-breakage
      // band a newly added problem lands in. Anything rarer is `make solvability-sweep`.
      const result = spawnSync(
        "bun",
        [
          "run",
          "scripts/solvability-audit.ts",
          "--seeds",
          "500",
          "--code-seeds",
          "10",
          "--screen-seeds",
          "120",
          ...suiteShardArgs(),
        ],
        {
          cwd: ROOT,
          encoding: "utf8",
          env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
          timeout: 1_500_000,
        },
      );
      expect(result.stdout + result.stderr).toContain("solvability audit");
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    },
    1_500_000,
  );
});
