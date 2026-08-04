import { spawn } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { cpus } from "node:os";
import { join } from "node:path";
import { localPlayProblemDirs } from "./lib/local-play-problems.ts";

/**
 * Is every course checkpoint actually answerable, on every seed it can ship with?
 *
 * `make reference-test` and the per-problem suites ask whether a broken implementation
 * gets caught. Nothing asked whether the *question* holds up. Two defects went through
 * every existing gate on `ac26-bridge-experiment`: `first-broken` had no answer at all on
 * 47 % of seeds (the grader's only accepted value was `-1`, which no statement mentions),
 * and `predict`'s answer equalled the `start` printed on screen on 164 of 2000 seeds.
 * Both are properties of the fixture *distribution*, invisible to any single-seed test.
 *
 * This driver sweeps seeds per problem — `scripts/solvability/audit.py` does the measuring
 * — and turns the measurements into findings. Findings that have been reviewed and
 * accepted live in `scripts/solvability-baseline.json` with a reason; anything else fails
 * the run, so a new problem fails closed.
 *
 *   bun run scripts/solvability-audit.ts                     gate budget
 *   bun run scripts/solvability-audit.ts --static-only       the fast pass, no fixtures
 *   bun run scripts/solvability-audit.ts --seeds 2000 --code-seeds 40 --report out.json
 *   bun run scripts/solvability-audit.ts --problem ac26-w3-schnorr
 */

const ROOT = join(import.meta.dir, "..");
const BASELINE = join(ROOT, "scripts", "solvability-baseline.json");

/**
 * Seed budgets.
 *
 * The direct-answer probes are pure arithmetic in-process — a few thousand seeds a minute
 * per problem — so they run at a sample size where a rare-seed defect is actually visible.
 * The code probes go through each problem's own `evaluate()`, which spawns a sandboxed
 * subprocess per call (~110 ms), and 33 problems x ~7 checkpoints x 2 submissions is what
 * decides the wall clock. `code-seeds` is therefore small by default and meant to be
 * raised for a sweep.
 *
 * What a given N can see, at 95 % confidence: `p_min = 1 - 0.05^(1/N)`.
 *   N =    8  ->  31 %       N =   40  ->  7.2 %
 *   N =  500  ->  0.60 %     N = 2000  ->  0.15 %
 * Every row carries its own N so the report can state that limit instead of implying none.
 */
const DEFAULT_VALUE_SEEDS = 500;
const DEFAULT_CODE_SEEDS = 8;
const DEFAULT_SCREEN_SEEDS = 200;

/**
 * When "the answer equals this field" counts as a leak rather than arithmetic coincidence.
 *
 * A fixed margin does not work. Replayed against the `predict` defect this audit exists
 * to catch, the answer equalled the printed `start` on 9.5 % of seeds against a 6.3 %
 * chance level: real, and a 3.2-point gap that any margin loose enough to catch it would
 * also catch a dozen coincidences in a small answer space. The gap has to be judged
 * against the sample size, so it is a two-proportion z-test.
 *
 * `z >= 3` rather than 1.96 because a checkpoint compares against every declared field:
 * roughly 210 comparisons across the catalog, where 5 % would mean ten false findings and
 * 0.27 % means half of one. The floor keeps a statistically clean but practically
 * irrelevant 3 % coincidence out of the report.
 *
 * Detection limit: the `predict` defect clears z = 3 at N = 2000 (z = 3.8) and does not at
 * N = 500 (z = 1.9). A leak of that size is a sweep finding, not a gate finding.
 */
const LEAK_FLOOR = 0.05;
const LEAK_Z = 3;

/** Two-proportion z, for `hits` of `n` against `controlHits` of the same `n`. */
export function leakZ(rate: number, control: number, n: number): number {
  if (n <= 0) return 0;
  const pooled = (rate + control) / 2;
  if (pooled <= 0 || pooled >= 1) return 0;
  const se = Math.sqrt((2 * pooled * (1 - pooled)) / n);
  return se === 0 ? 0 : (rate - control) / se;
}
/** One answer covering this share of seeds is worth guessing rather than working out. */
const GUESSABLE_SHARE = 0.5;

type Rates = { rate: number; control: number };

export type Row = {
  checkpoint: string;
  kind: "value" | "code";
  seeds: number;
  distinctAnswers?: number;
  mostCommonRate?: number;
  oracleRejected?: number;
  oracleRejectedExamples?: string[];
  sentinelRate?: number;
  sentinelExamples?: string[];
  zeroRate?: number;
  visibleRate?: number;
  visibleControlRate?: number;
  screenSeeds?: number;
  fieldScope?: string;
  visibleDeclared?: boolean;
  fixtureFieldSeeds?: number;
  fixtureFieldRates?: Record<string, Rates>;
  fieldRates?: Record<string, Rates>;
  replayTested?: number;
  replayAccepted?: number;
  replayExamples?: string[];
  referenceFailures?: number;
  referenceFailureExamples?: string[];
  starterPasses?: number;
  starterPassExamples?: string[];
  starterAudited?: boolean;
  errors?: string[];
  sampleAnswers?: string[];
};

type NotAudited = { checkpoints?: string[]; reason: string; seed?: string; shapesTried?: string[] };

export type Report = {
  problem: string;
  rows: Row[];
  notAudited: NotAudited[];
  static?: { graders: string[]; seedless: string[] };
  checkpointCensus?: { all: string[]; code: string[]; value: string[] };
  submissionShape?: string;
  auditError?: string;
};

export type Finding = {
  problem: string;
  checkpoint: string;
  type: string;
  detail: string;
  seeds: number;
};

type BaselineEntry = {
  problem: string;
  checkpoint: string;
  type: string;
  reason: string;
  /** The sweep size the entry was recorded at. A smaller run cannot call it stale. */
  recordedAtSeeds: number;
};

/** Identity of a finding, for matching against the baseline. */
function key(problem: string, checkpoint: string, type: string): string {
  return [problem, checkpoint, type].join(" :: ");
}

/**
 * The baseline has two lists, and the difference between them is the whole point.
 *
 * `accepted` — the measurement is real and the design is deliberate. `environment` hands
 * the player a token to copy because it is a proof-of-container, not a question.
 *
 * `open` — the measurement is real, the design is not deliberate, and nobody has fixed it
 * yet. These suppress the gate exactly like `accepted` does, so a known defect does not
 * mask a new one, but they are printed as OPEN and counted. Emptying this list is work
 * that is owed; emptying it by moving entries into `accepted` is not.
 */
function readBaseline(): { accepted: BaselineEntry[]; open: BaselineEntry[] } {
  const parsed = JSON.parse(readFileSync(BASELINE, "utf8")) as {
    accepted?: BaselineEntry[];
    open?: BaselineEntry[];
  };
  return { accepted: parsed.accepted ?? [], open: parsed.open ?? [] };
}

function numberArg(name: string, fallback: number): number {
  const index = process.argv.indexOf("--" + name);
  if (index === -1) return fallback;
  const value = Number(process.argv[index + 1]);
  return Number.isFinite(value) ? value : fallback;
}

function stringArg(name: string): string | undefined {
  const index = process.argv.indexOf("--" + name);
  return index === -1 ? undefined : process.argv[index + 1];
}

type AuditOptions = { seeds: number; codeSeeds: number; screenSeeds: number; mode: string };

async function auditOne(dir: string, options: AuditOptions): Promise<Report> {
  return new Promise((resolve) => {
    const child = spawn(
      "python3",
      [
        "scripts/solvability/audit.py",
        "--problem",
        dir,
        "--mode",
        options.mode,
        "--seeds",
        String(options.seeds),
        "--code-seeds",
        String(options.codeSeeds),
        "--screen-seeds",
        String(options.screenSeeds),
      ],
      { cwd: ROOT, env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" } },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("close", (code) => {
      const problem = dir.split("/").pop() ?? dir;
      if (code !== 0) {
        const detail = stderr.trim().slice(-2000) || `exit ${code}`;
        resolve({ problem, rows: [], notAudited: [], auditError: detail });
        return;
      }
      try {
        resolve(JSON.parse(stdout.trim().split("\n").at(-1) ?? "{}") as Report);
      } catch (error) {
        resolve({ problem, rows: [], notAudited: [], auditError: `unparseable output: ${String(error)}` });
      }
    });
  });
}

/** Run with bounded concurrency; each audit is an independent process. */
async function pooled<T, R>(items: readonly T[], limit: number, run: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      for (let index = next++; index < items.length; index = next++) {
        const item = items[index];
        if (item === undefined) continue;
        results[index] = await run(item);
      }
    }),
  );
  return results;
}

/**
 * The measurement-to-finding rules. Each one names a way a checkpoint stops being a
 * question: no answer exists, the answer is on screen, the answer is worth guessing, the
 * answer is the same in every deployment, the reference cannot pass, or the starter
 * already does.
 */
export function findings(report: Report): Finding[] {
  const found: Finding[] = [];
  const push = (checkpoint: string, type: string, detail: string, seeds: number): void => {
    found.push({ problem: report.problem, checkpoint, type, detail, seeds });
  };
  const percent = (value: number): string => (value * 100).toFixed(1) + " %";

  if (report.auditError) push("-", "audit-failed", report.auditError, 0);

  for (const entry of report.notAudited) {
    push((entry.checkpoints ?? ["-"]).join(","), "not-audited", entry.reason, 0);
  }
  for (const grader of report.static?.seedless ?? []) {
    push(grader, "seedless-grader", "the grader never reaches SEED, so the correct answer is the same in every deployment", 0);
  }

  for (const row of report.rows) {
    if ((row.oracleRejected ?? 0) > 0) {
      push(
        row.checkpoint,
        "mirror-drift",
        `expected(seed) was rejected on ${row.oracleRejected}/${row.seeds} seeds, so this checkpoint's other numbers cannot be trusted: ` +
          (row.oracleRejectedExamples ?? []).join("; "),
        row.seeds,
      );
    }
    for (const message of row.errors ?? []) push(row.checkpoint, "probe-error", message, row.seeds);

    if ((row.sentinelRate ?? 0) > 0) {
      push(
        row.checkpoint,
        "no-answer",
        `the correct answer is a sentinel (-1 or empty) on ${percent(row.sentinelRate ?? 0)} of seeds: ` +
          (row.sentinelExamples ?? []).join(", "),
        row.seeds,
      );
    }
    if (row.kind === "value" && row.distinctAnswers === 1) {
      push(row.checkpoint, "constant-answer", `one answer over ${row.seeds} seeds: ${(row.sampleAnswers ?? [])[0]}`, row.seeds);
    } else if (row.kind === "value" && (row.mostCommonRate ?? 0) >= GUESSABLE_SHARE) {
      push(
        row.checkpoint,
        "guessable-answer",
        `the most common answer covers ${percent(row.mostCommonRate ?? 0)} of seeds (${row.distinctAnswers} distinct over ${row.seeds})`,
        row.seeds,
      );
    }
    if ((row.replayAccepted ?? 0) > 0) {
      push(
        row.checkpoint,
        "cross-seed-replay",
        `another seed's answer scored on ${row.replayAccepted}/${row.replayTested} seeds`,
        row.seeds,
      );
    }
    const fieldSeeds = row.fixtureFieldSeeds ?? row.seeds;
    for (const [label, rates] of Object.entries(row.fixtureFieldRates ?? {})) {
      const z = leakZ(rates.rate, rates.control, fieldSeeds);
      if (rates.rate >= LEAK_FLOOR && z >= LEAK_Z) {
        push(
          row.checkpoint,
          "answer-on-screen",
          `the answer equals the shown ${label} on ${percent(rates.rate)} of seeds, against a chance level of ${percent(rates.control)} (z=${z.toFixed(1)} over ${fieldSeeds} seeds)`,
          fieldSeeds,
        );
      }
    }
    if ((row.referenceFailures ?? 0) > 0) {
      push(
        row.checkpoint,
        "reference-fails",
        `the shipped reference did not pass on ${row.referenceFailures}/${row.seeds} seeds: ` +
          (row.referenceFailureExamples ?? []).join(", "),
        row.seeds,
      );
    }
    if ((row.starterPasses ?? 0) > 0) {
      push(
        row.checkpoint,
        "starter-passes",
        `the shipped starter already scored on ${row.starterPasses}/${row.seeds} seeds: ` +
          (row.starterPassExamples ?? []).join(", "),
        row.seeds,
      );
    }
    if (row.kind === "code" && row.starterAudited === false) {
      push(row.checkpoint, "not-audited", "no starter sources, so 'the starter must fail' was not checked", row.seeds);
    }
    if (row.kind === "value" && row.visibleDeclared === false) {
      push(
        row.checkpoint,
        "not-audited",
        "no VISIBLE declaration in the expected() mirror, so answer-on-screen was not measured at fixture-field precision. " +
          "The coarse token-set rate is all that ran, and replaying this audit against the defect it was built for showed " +
          "that rate at its own chance level while the defect was real — so it is not evidence of anything here",
        row.seeds,
      );
    }
  }
  return found;
}

/** The smallest defect incidence a sweep of this size would have caught, at 95 %. */
function detectableRate(seeds: number): string {
  if (seeds <= 0) return "n/a";
  return ((1 - 0.05 ** (1 / seeds)) * 100).toFixed(2) + " %";
}

async function main(): Promise<number> {
  const seeds = numberArg("seeds", DEFAULT_VALUE_SEEDS);
  const codeSeeds = numberArg("code-seeds", DEFAULT_CODE_SEEDS);
  const screenSeeds = numberArg("screen-seeds", DEFAULT_SCREEN_SEEDS);
  const only = stringArg("problem");
  const reportPath = stringArg("report");
  // The static pass needs no fixtures, no seeds and no subprocesses, so it is cheap
  // enough for the fast gate. It is also the only probe that reaches every problem
  // whether or not anybody has written an expected() mirror for it.
  const mode = process.argv.includes("--static-only")
    ? "static"
    : process.argv.includes("--code-only")
      ? "code"
      : "all";

  const dirs = localPlayProblemDirs(ROOT).filter((dir) => !only || dir.endsWith("/" + only));
  if (dirs.length === 0) {
    console.error("no problems matched" + (only ? " --problem " + only : ""));
    return 2;
  }

  const started = Date.now();
  const reports = await pooled(dirs, Math.max(2, Math.min(cpus().length, 8)), (dir) =>
    auditOne(dir, { seeds, codeSeeds, screenSeeds, mode }),
  );

  const baseline = readBaseline();
  const accepted = new Set(baseline.accepted.map((entry) => key(entry.problem, entry.checkpoint, entry.type)));
  const open = new Set(baseline.open.map((entry) => key(entry.problem, entry.checkpoint, entry.type)));

  const all = reports.flatMap(findings);
  const unexplained = all.filter((finding) => {
    const identity = key(finding.problem, finding.checkpoint, finding.type);
    return !accepted.has(identity) && !open.has(identity);
  });

  // A baseline entry that no longer matches anything means the defect was fixed and the
  // entry should have gone with it, or the file slowly becomes a list of permissions
  // nobody remembers granting. Only a run at least as large as the one that recorded the
  // entry can say that, so the gate-sized run reports nothing here.
  const seen = new Set(all.map((finding) => key(finding.problem, finding.checkpoint, finding.type)));
  const stale =
    mode === "all"
      ? [...baseline.accepted, ...baseline.open].filter(
          (entry) =>
            !seen.has(key(entry.problem, entry.checkpoint, entry.type)) &&
            seeds >= entry.recordedAtSeeds &&
            codeSeeds >= entry.recordedAtSeeds,
        )
      : [];

  let checkpoints = 0;
  let valueRows = 0;
  let codeRows = 0;
  for (const report of reports) {
    checkpoints += report.checkpointCensus?.all.length ?? 0;
    valueRows += report.rows.filter((row) => row.kind === "value").length;
    codeRows += report.rows.filter((row) => row.kind === "code").length;
  }

  console.log(`solvability audit (${mode}): ${reports.length} problems, ${checkpoints} checkpoints`);
  if (mode === "static") {
    console.log("static pass only: no seeds swept, so nothing here rules out a rare-seed defect");
  } else {
    const probed: string[] = [];
    if (valueRows > 0) probed.push(`${valueRows} direct-answer at N=${seeds} (sees >= ${detectableRate(seeds)})`);
    if (codeRows > 0) probed.push(`${codeRows} code at N=${codeSeeds} (sees >= ${detectableRate(codeSeeds)})`);
    console.log(`probed: ${probed.join("; ")}`);
    console.log("`sees` is the smallest defect incidence the sweep would have caught, at 95 % confidence");
  }
  console.log(`elapsed ${((Date.now() - started) / 1000).toFixed(1)}s\n`);

  let openSeen = 0;
  for (const finding of all) {
    const identity = key(finding.problem, finding.checkpoint, finding.type);
    let label = "FINDING ";
    if (accepted.has(identity)) label = "BY-DESIGN";
    else if (open.has(identity)) {
      label = "OPEN    ";
      openSeen += 1;
    }
    console.log(`${label} ${finding.problem} / ${finding.checkpoint} / ${finding.type}`);
    console.log(`         ${finding.detail}`);
  }
  if (all.length === 0) console.log("no findings.");
  if (openSeen > 0) {
    console.log(`\n${openSeen} known-open defect(s) still reproduce. They are tracked in ${BASELINE}, not fixed.`);
  }

  for (const entry of stale) {
    console.log(`STALE    ${entry.problem} / ${entry.checkpoint} / ${entry.type} no longer reproduces; drop the baseline entry`);
  }

  if (reportPath) {
    const payload = { seeds, codeSeeds, screenSeeds, mode, reports, findings: all, unexplained, stale };
    writeFileSync(reportPath, JSON.stringify(payload, null, 2) + "\n");
    console.log(`\nwrote ${reportPath}`);
  }

  if (unexplained.length > 0) {
    console.error(
      `\n${unexplained.length} finding(s) are not in scripts/solvability-baseline.json. ` +
        "Fix the problem, or add the entry with the reason it is acceptable.",
    );
    return 1;
  }
  return 0;
}

// Importing this module must not run the audit: scripts/solvability-audit.test.ts imports
// `findings` to pin the thresholds against the two defects that motivated them.
if (import.meta.main) process.exit(await main());
