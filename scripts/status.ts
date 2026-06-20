#!/usr/bin/env bun
/**
 * #87 Phase C（運用タイミング）— 稼働中の CloudFormation stack を一覧し、`cost-report.json`
 * の見積もりで **放置コスト（$/day）** を注釈する read-only モニタ。「落とし忘れ防止」の一次情報。
 *
 * stack を破壊しないので安全（teardown は別 script に分ける）。実 AWS への問い合わせは
 * `aws cloudformation list-stacks` を 1 回呼ぶだけ。--from-json でその出力をファイルから読めば
 * 認証情報なしでパイプライン（parse → 問題マッチ → コスト注釈 → 集計）を確認できる。
 *
 * Usage:
 *   bun run scripts/status.ts                       # aws を呼んで一覧
 *   bun run scripts/status.ts --region us-east-1    # region 指定
 *   bun run scripts/status.ts --json                # JSON 出力
 *   bun run scripts/status.ts --from-json stacks.json   # aws を呼ばずファイルから（offline/CI）
 *     ファイルは `aws cloudformation list-stacks` の生 JSON。
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const REPO_ROOT = new URL("..", import.meta.url).pathname;
const COST_REPORT_PATH = join(REPO_ROOT, "cost-report.json");

/** list-stacks の生 JSON から拾う、 monitor に必要な最小フィールド。 */
export interface RawStack {
  readonly StackName: string;
  readonly StackStatus: string;
  readonly CreationTime?: string;
}

/** 稼働中とみなす status（DELETE_COMPLETE 等の終端は除外）。 */
export const ACTIVE_STATUSES: ReadonlySet<string> = new Set([
  "CREATE_COMPLETE",
  "UPDATE_COMPLETE",
  "UPDATE_ROLLBACK_COMPLETE",
  "ROLLBACK_COMPLETE",
  "IMPORT_COMPLETE",
  "CREATE_IN_PROGRESS",
  "UPDATE_IN_PROGRESS",
]);

export interface AnnotatedStack {
  readonly stackName: string;
  readonly status: string;
  readonly creationTime: string | null;
  /** マッチした問題 id（cost-report 上）。 名前から推定できなければ null。 */
  readonly problemId: string | null;
  /** 放置コスト見積もり $/day（マッチ時のみ）。 */
  readonly perDayUsd: number | null;
  /** idle でも課金が続くリソース（マッチ時のみ）。 */
  readonly alwaysOnResources: readonly string[];
}

interface CostInfo {
  readonly perDayUsd: number;
  readonly alwaysOnResources: readonly string[];
}

/** list-stacks JSON → 稼働中 RawStack[]。`StackSummaries` 配下を読む。 */
export function parseStacks(listStacksJson: string): RawStack[] {
  const parsed = JSON.parse(listStacksJson) as { StackSummaries?: RawStack[] };
  const summaries = Array.isArray(parsed.StackSummaries) ? parsed.StackSummaries : [];
  return summaries.filter((s) => ACTIVE_STATUSES.has(s.StackStatus));
}

/** cost-report.json → {id: {perDay, alwaysOn}}。 */
export function buildCostIndex(reportJson: string): Map<string, CostInfo> {
  const report = JSON.parse(reportJson) as {
    problems?: { id: string; ifLeftRunningUsd?: { oneDay?: number }; alwaysOnResources?: string[] }[];
  };
  const idx = new Map<string, CostInfo>();
  for (const p of report.problems ?? []) {
    idx.set(p.id, {
      perDayUsd: p.ifLeftRunningUsd?.oneDay ?? 0,
      alwaysOnResources: p.alwaysOnResources ?? [],
    });
  }
  return idx;
}

/**
 * stack 名に含まれる問題 id を推定する。 複数該当時は **最長一致** を採る
 * (例 "tc-stackstack-lite-x" は "stackstack" ではなく "stackstack-lite")。
 */
export function matchProblemId(stackName: string, ids: readonly string[]): string | null {
  const hits = ids.filter((id) => stackName.includes(id));
  if (hits.length === 0) return null;
  return hits.reduce((longest, id) => (id.length > longest.length ? id : longest));
}

export function annotate(stacks: readonly RawStack[], cost: Map<string, CostInfo>): AnnotatedStack[] {
  const ids = [...cost.keys()];
  return stacks.map((s) => {
    const problemId = matchProblemId(s.StackName, ids);
    const info = problemId ? cost.get(problemId) : undefined;
    return {
      stackName: s.StackName,
      status: s.StackStatus,
      creationTime: s.CreationTime ?? null,
      problemId,
      perDayUsd: info ? info.perDayUsd : null,
      alwaysOnResources: info ? info.alwaysOnResources : [],
    };
  });
}

export interface Summary {
  readonly stackCount: number;
  readonly knownCount: number;
  readonly totalPerDayUsd: number;
  readonly alwaysOnCount: number;
}

export function summarize(annotated: readonly AnnotatedStack[]): Summary {
  const round2 = (n: number) => Math.round(n * 100) / 100;
  return {
    stackCount: annotated.length,
    knownCount: annotated.filter((a) => a.problemId).length,
    totalPerDayUsd: round2(annotated.reduce((sum, a) => sum + (a.perDayUsd ?? 0), 0)),
    alwaysOnCount: annotated.filter((a) => a.alwaysOnResources.length > 0).length,
  };
}

function formatReport(annotated: readonly AnnotatedStack[], s: Summary): string {
  if (annotated.length === 0) return "稼働中の CloudFormation stack はありません。";
  const lines = annotated.map((a) => {
    const cost = a.perDayUsd === null ? "?      " : `$${a.perDayUsd.toFixed(2)}/day`;
    const on = a.alwaysOnResources.length ? ` [always-on: ${a.alwaysOnResources.join(", ")}]` : "";
    const prob = a.problemId ?? "(unknown problem)";
    return `  ${cost}  ${a.stackName}  — ${prob} (${a.status})${on}`;
  });
  const header = `${s.stackCount} stacks live | 推定 $${s.totalPerDayUsd.toFixed(2)}/day | コスト判明 ${s.knownCount}/${s.stackCount} | always-on ${s.alwaysOnCount}`;
  return `${header}\n${lines.join("\n")}`;
}

function readListStacks(argv: string[]): string {
  const fromIdx = argv.indexOf("--from-json");
  if (fromIdx !== -1) {
    const file = argv[fromIdx + 1];
    if (!file) {
      console.error("--from-json にはファイルパスが必要です。");
      process.exit(1);
    }
    return readFileSync(file, "utf8");
  }
  const regionIdx = argv.indexOf("--region");
  const region = regionIdx !== -1 ? argv[regionIdx + 1] : process.env.AWS_REGION;
  const args = ["cloudformation", "list-stacks", "--output", "json"];
  if (region) args.push("--region", region);
  try {
    return execFileSync("aws", args, { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  } catch (err) {
    console.error(
      "aws CLI の呼び出しに失敗しました（CLI 未導入 / 認証情報なし / region 未設定）。" +
        "offline で試すには: aws cloudformation list-stacks --output json > stacks.json && bun run scripts/status.ts --from-json stacks.json",
    );
    console.error(String(err instanceof Error ? err.message : err).slice(0, 300));
    process.exit(1);
  }
}

function main(): void {
  const argv = process.argv.slice(2);
  const stacks = parseStacks(readListStacks(argv));
  const cost = buildCostIndex(readFileSync(COST_REPORT_PATH, "utf8"));
  const annotated = annotate(stacks, cost).sort((a, b) => (b.perDayUsd ?? -1) - (a.perDayUsd ?? -1));
  const summary = summarize(annotated);
  if (argv.includes("--json")) {
    console.log(JSON.stringify({ summary, stacks: annotated }, null, 2));
    return;
  }
  console.log(formatReport(annotated, summary));
}

if (import.meta.main) {
  main();
}
