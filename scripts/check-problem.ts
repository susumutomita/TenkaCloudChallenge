#!/usr/bin/env bun
/**
 * 問題 1 つに対して走る検査 (Issue 382)。
 *
 * ```bash
 * bun run check:problem wp-exposed-backup   # 1 問だけ
 * bun run check:problem --all               # 全問の合否を一覧で
 * ```
 *
 * ## なぜ「1 問単体で走る」形が要るのか
 *
 * 問題は**利用者が追加するもの**である。第三者が PR を送る、各自が独自の問題を作る、という
 * のが想定ケースで、どちらもプラットフォーム側のレビューでは間に合わない。既存の
 * `bun run validate` はリポジトリ全体を一度に検査する形で、「自分の 1 問が出荷できる状態か」
 * を知りたい人にとっては、他人の 70 問あまりの出力の中から自分の行を探す作業になる。
 *
 * この入口は既存の検査を**置き換えない**。同じ検出ロジックを 1 問のスコープで呼び直し、
 * その問題についてだけ答える。`bun run validate` は今までどおりリポジトリ全体の gate。
 *
 * ## ここで見るもの / 見ないもの
 *
 * 見るのは「リポジトリと Docker と AWS が無くても、その問題単体で確実に分かること」だけ。
 *
 *   - metadata.json が SCHEMA に適合しているか
 *   - 参加者へ配信される HTML / script が壊れていないか (Issue 395 / 396)
 *   - local play で起動できる形か、それとも AWS 専用か (Issue 402)
 *   - local play の割り当てポートを焼き込んでいないか (Issue 399)
 *   - 静的な solvability 監査 (`--static-only` と同じもの)
 *
 * **見ないもの**は、Issue 382 が「基準の確定」として TODO に置いている 4 つのうち 3 つである。
 *
 *   - deploy が成功する
 *   - 想定解法で flag / checkpoint が通る
 *   - 想定外の抜け道が無い
 *
 * これらは実 deploy を伴い、AWS コストと実行時間がかかる。`bun run solvability` (full) と
 * `/validate-problem` の blind playthrough が担当する。**この checker が緑でも「解ける」証明に
 * はならない**ので、そう読めない出力にしてある。
 */

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
// SCHEMA.json は draft-07。`ajv/dist/2020.js` を使うと meta-schema を解決できない。
// 既存の validate-problems.ts と同じ import に揃える。
import Ajv2020 from "ajv";
import addFormats from "ajv-formats";
import { scanProblem } from "./check-local-play-urls.ts";
import { checkSource } from "./check-participant-surface.ts";
import { localPlayProblemDirs } from "./lib/local-play-problems.ts";

const CATEGORY_DIRS = ["battles", "challenges"] as const;
const SOURCE_EXTENSIONS = new Set([".mjs", ".js", ".ts", ".cjs"]);

export type CheckStatus = "pass" | "fail" | "skip";

export interface CheckResult {
  readonly name: string;
  readonly status: CheckStatus;
  readonly detail?: string;
}

export interface ProblemReport {
  readonly problemId: string;
  readonly dir: string;
  readonly results: readonly CheckResult[];
}

export function isFailing(report: ProblemReport): boolean {
  return report.results.some((r) => r.status === "fail");
}

/** 問題 ID → ディレクトリ。見つからなければ undefined (呼び出し側が名前で報告する)。 */
export function findProblemDir(problemId: string): string | undefined {
  for (const category of CATEGORY_DIRS) {
    const dir = join(category, problemId);
    if (existsSync(join(dir, "metadata.json"))) return dir;
  }
  return undefined;
}

export function listProblemIds(): string[] {
  const ids: string[] = [];
  for (const category of CATEGORY_DIRS) {
    let entries: string[];
    try {
      entries = readdirSync(category);
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (existsSync(join(category, entry, "metadata.json"))) ids.push(entry);
    }
  }
  return ids.sort();
}

function walkSources(dir: string): string[] {
  const out: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry === "node_modules" || entry === ".git") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walkSources(full));
    else if ([...SOURCE_EXTENSIONS].some((ext) => entry.endsWith(ext)) && !entry.includes(".test."))
      out.push(full);
  }
  return out;
}

export function schemaCheck(dir: string): CheckResult {
  const schema = JSON.parse(readFileSync("SCHEMA.json", "utf8"));
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  const validate = ajv.compile(schema);
  const data = JSON.parse(readFileSync(join(dir, "metadata.json"), "utf8"));
  if (validate(data)) return { name: "metadata schema", status: "pass" };
  const first = (validate.errors ?? [])[0];
  return {
    name: "metadata schema",
    status: "fail",
    detail: `${first?.instancePath || "/"} ${first?.message ?? "invalid"}`,
  };
}

export function participantSurfaceCheck(dir: string): CheckResult {
  const findings = walkSources(dir).flatMap((file) =>
    checkSource(readFileSync(file, "utf8"), file),
  );
  if (findings.length === 0) return { name: "participant surface", status: "pass" };
  const first = findings[0];
  return {
    name: "participant surface",
    status: "fail",
    detail: `${findings.length} 件 (最初: ${first?.file}:${first?.line} ${first?.rule})`,
  };
}

/**
 * local play で起動できる形か。
 *
 * AWS 専用は **欠陥ではない** ので fail にしない。`skip` で「この checker の後半は答えられない」
 * と言う。fail にすると、正しく AWS 専用として作られた問題まで赤くなり、赤が意味を失う。
 */
/**
 * local play の割り当てポートを焼き込んでいないか (Issue 399)。
 *
 * 1 問だけ起動している間は表面化しないので、作者は自分では踏まない。だからこそ authoring
 * 時の機械検査に置く価値がある。
 */
export function localPlayUrlCheck(dir: string): CheckResult {
  const findings = scanProblem(dir);
  if (findings.length === 0) return { name: "local play url", status: "pass" };
  const first = findings[0];
  return {
    name: "local play url",
    status: "fail",
    detail: `${findings.length} 件 (最初: ${first?.file} port ${first?.port})`,
  };
}

export function localPlayableCheck(dir: string): CheckResult {
  return existsSync(join(dir, "local"))
    ? { name: "local playable", status: "pass" }
    : {
        name: "local playable",
        status: "skip",
        detail: "local/ が無い = AWS 専用。local play では起動しない (Issue 402)",
      };
}

/**
 * 静的 solvability 監査 (`solvability-audit --static-only`)。
 *
 * この監査の対象は `local/verifier/server.py` を持つ問題 —— つまり学習者のコードを走らせる
 * verifier と隠しスイートを内蔵した course checkpoint 型 —— に限られる (`localPlayProblemDirs`)。
 * それ以外の問題を渡すと audit は「no problems matched」で exit 2 を返す。これは**欠陥ではなく
 * 対象外**なので、対象外を先に判定して `skip` を返す。exit code だけを見て fail にすると、
 * カタログの大半が「監査に落ちた」と表示され、赤が意味を失う。
 */
function solvabilityStaticCheck(problemId: string, dir: string): CheckResult {
  const name = "solvability (static)";
  if (!localPlayProblemDirs(".").includes(dir)) {
    return {
      name,
      status: "skip",
      detail: "local/verifier/server.py が無い = 静的 solvability 監査の対象外",
    };
  }
  try {
    execFileSync(
      "bun",
      ["run", "scripts/solvability-audit.ts", "--static-only", "--problem", problemId],
      { encoding: "utf8", stdio: "pipe" },
    );
    return { name, status: "pass" };
  } catch (error) {
    const failure = error as { stdout?: string; stderr?: string };
    const out = `${String(failure.stdout ?? "")}\n${String(failure.stderr ?? "")}`.trim();
    const last = out.split("\n").filter(Boolean).pop();
    return { name, status: "fail", detail: last ?? "audit failed" };
  }
}

export function checkProblem(problemId: string): ProblemReport {
  const dir = findProblemDir(problemId);
  if (!dir) {
    return {
      problemId,
      dir: "",
      results: [{ name: "problem exists", status: "fail", detail: "metadata.json が見つかりません" }],
    };
  }
  return {
    problemId,
    dir,
    results: [
      schemaCheck(dir),
      participantSurfaceCheck(dir),
      localPlayableCheck(dir),
      localPlayUrlCheck(dir),
      solvabilityStaticCheck(problemId, dir),
    ],
  };
}

const MARK: Record<CheckStatus, string> = { pass: "OK  ", fail: "NG  ", skip: "--  " };

function printOne(report: ProblemReport): void {
  console.log(`\n${report.problemId}${report.dir ? `  (${report.dir})` : ""}`);
  for (const r of report.results) {
    console.log(`  ${MARK[r.status]}${r.name}${r.detail ? `  — ${r.detail}` : ""}`);
  }
}

export function main(argv: readonly string[]): number {
  const all = argv.includes("--all");
  const target = argv.find((a) => !a.startsWith("--"));

  if (!all && !target) {
    console.error("usage: bun run check:problem <problemId>   |   bun run check:problem --all");
    return 1;
  }

  if (!all && target) {
    const report = checkProblem(target);
    printOne(report);
    const failed = isFailing(report);
    console.log(
      failed
        ? "\n判定: この問題は出荷できません。"
        : "\n判定: 静的検査は通りました。deploy と想定解法の確認は " +
            "`bun run solvability` と `/validate-problem` が別に必要です。",
    );
    return failed ? 1 : 0;
  }

  const reports = listProblemIds().map(checkProblem);
  const failing = reports.filter(isFailing);
  for (const report of reports) {
    const worst = isFailing(report) ? "NG" : "OK";
    const skipped = report.results.filter((r) => r.status === "skip").length;
    console.log(`${worst}  ${report.problemId}${skipped > 0 ? `  (skip ${skipped})` : ""}`);
  }
  console.log(`\n${reports.length} 問中 ${failing.length} 問が静的検査で落ちています。`);
  for (const report of failing) printOne(report);
  return failing.length > 0 ? 1 : 0;
}

if (import.meta.main) process.exit(main(process.argv.slice(2)));
