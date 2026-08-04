import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import { localPlayProblemDirs } from "./lib/local-play-problems.ts";

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

describe("solvability gate", () => {
  it(
    "finds no unexplained solvability defect across the course catalog",
    () => {
      const result = spawnSync(
        "bun",
        ["run", "scripts/solvability-audit.ts", "--seeds", "500", "--code-seeds", "6", "--screen-seeds", "120"],
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
