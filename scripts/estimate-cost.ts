#!/usr/bin/env bun
/**
 * #87 Phase A — 問題テンプレートの **AWS コスト概算** と **落とし忘れ課金リスク** を、
 * deploy せずに静的算出するツール。
 *
 * template.yaml を line-walk して billable リソース (EC2 / RDS / ALB / NAT / EIP /
 * Route53 HostedZone) を拾い、`scripts/lib/cost-rates.ts` の静的料金表で USD/hour を出す。
 * CloudFormation の `!Ref` short-tag で YAML parser が壊れるため、validate-problems.ts と
 * 同じく構造 parse ではなく行ベースで読む。
 *
 * 生成物は `cost-report.json` (= build-index.ts → index.json と同じ「生成して commit、CI で
 * --check」パターン)。各 metadata.json は触らないので、並行作業との衝突を避けられる。
 *
 * Usage:
 *   bun run scripts/estimate-cost.ts                 # 全問の表を人間可読で表示
 *   bun run scripts/estimate-cost.ts <id>            # 1 問の内訳を表示
 *   bun run scripts/estimate-cost.ts --json [<id>]   # JSON で出力
 *   bun run scripts/estimate-cost.ts --write         # cost-report.json を再生成
 *   bun run scripts/estimate-cost.ts --check         # cost-report.json が古ければ exit 1 (CI 用)
 */

import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  ALWAYS_ON_TYPES,
  DEFAULT_REGION,
  EC2_HOURLY,
  FALLBACK_INSTANCE_TYPE,
  FLAT_HOURLY,
  FREE_TIER_INSTANCE_TYPES,
  KNOWN_REGIONS,
  type Region,
  RDS_HOURLY,
  round,
} from "./lib/cost-rates";

const REPO_ROOT = new URL("..", import.meta.url).pathname;
const CATEGORY_DIRS = ["battles", "challenges"] as const;
const REPORT_PATH = join(REPO_ROOT, "cost-report.json");

const ASSUMPTIONS =
  "概算 on-demand 価格 (USD/hour, Linux/single-AZ)。厳密な請求額ではなく桁感と落とし忘れリスクの可視化用。" +
  "EBS root / データ転送 / ALB LCU / S3・Lambda・SSM・CloudWatch の従量分は短時間セッション前提で無視。" +
  "region は metadata.defaultRegion (未知/未宣言は ap-northeast-1 にフォールバック)。" +
  "1 template 内の EC2 は単一 InstanceType 前提で解決する。";

interface BillableLine {
  readonly resource: string;
  readonly count: number;
  readonly unit: string;
  readonly hourlyUsdEach: number;
}

export interface ProblemCost {
  readonly id: string;
  readonly category: string;
  readonly region: Region;
  readonly estimatedSessionMinutes: number;
  readonly perHourUsd: number;
  readonly perSessionUsd: number;
  readonly ifLeftRunningUsd: { readonly oneDay: number; readonly oneWeek: number; readonly oneMonth: number };
  readonly freeTierEligible: boolean;
  readonly alwaysOnResources: readonly string[];
  readonly billable: readonly BillableLine[];
}

export interface CostReport {
  readonly version: string;
  readonly assumptions: string;
  readonly problems: readonly ProblemCost[];
}

/** ALWAYS_ON / billable 表示用の短いラベル。 */
const SHORT_LABEL: Record<string, string> = {
  "AWS::EC2::Instance": "EC2",
  "AWS::RDS::DBInstance": "RDS",
  "AWS::ElasticLoadBalancingV2::LoadBalancer": "ALB",
  "AWS::EC2::NatGateway": "NAT Gateway",
  "AWS::EC2::EIP": "EIP",
  "AWS::Route53::HostedZone": "Route53 HostedZone",
};

function collectMetadataFiles(): string[] {
  const files: string[] = [];
  for (const cat of CATEGORY_DIRS) {
    const dir = join(REPO_ROOT, cat);
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      continue;
    }
    for (const entry of entries) {
      const meta = join(dir, entry, "metadata.json");
      try {
        if (statSync(meta).isFile()) files.push(meta);
      } catch {
        /* not a problem dir */
      }
    }
  }
  return files;
}

/** estimatedDuration ("30〜45 分" / "1 分") → 最大整数を分とみなす (保守的=上限)。 */
export function parseDurationMinutes(estimatedDuration: string): number {
  const nums = estimatedDuration.match(/\d+/g);
  if (!nums || nums.length === 0) return 60;
  return Math.max(...nums.map(Number));
}

/** Parameters セクションの {name: Default} を拾う (param 名は 2-space indent 前提)。 */
export function parseParameterDefaults(yaml: string): Record<string, string> {
  const defaults: Record<string, string> = {};
  const lines = yaml.split("\n");
  let inParams = false;
  let current: string | null = null;
  for (const line of lines) {
    if (/^Parameters:\s*$/.test(line)) {
      inParams = true;
      continue;
    }
    if (inParams && /^\S/.test(line)) break; // 次の top-level key で Parameters を抜ける
    if (!inParams) continue;
    const name = line.match(/^ {2}(\w+):\s*$/);
    if (name) {
      current = name[1];
      continue;
    }
    const def = line.match(/^\s+Default:\s*(.+?)\s*$/);
    if (def && current && !(current in defaults)) {
      defaults[current] = stripQuotes(def[1]);
    }
  }
  return defaults;
}

function stripQuotes(v: string): string {
  return v.replace(/^['"]|['"]$/g, "").trim();
}

/** `!Ref Name` を Parameters の Default に解決。literal はそのまま返す。 */
export function resolveValue(raw: string, params: Record<string, string>): string {
  const v = stripQuotes(raw);
  const ref = v.match(/^!Ref\s+(\w+)$/);
  if (ref) return params[ref[1]] ?? FALLBACK_INSTANCE_TYPE;
  return v;
}

function countType(yaml: string, type: string): number {
  const escaped = type.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return (yaml.match(new RegExp(`^\\s*Type:\\s*${escaped}\\s*$`, "gm")) ?? []).length;
}

function rateFor(table: Record<string, number>, key: string): number {
  return table[key] ?? 0;
}

function estimate(metaPath: string): ProblemCost {
  const meta = JSON.parse(readFileSync(metaPath, "utf8")) as Record<string, unknown>;
  const id = String(meta.id);
  const region: Region = KNOWN_REGIONS.has(String(meta.defaultRegion))
    ? (meta.defaultRegion as Region)
    : DEFAULT_REGION;
  // [#2054] container (local) problems deploy nothing to AWS — zero cost, no CFn
  // template to walk.
  const runtime = meta.runtime as { engine?: unknown } | undefined;
  if (typeof runtime?.engine === "string" && runtime.engine !== "cloudformation") {
    return {
      id,
      category: String(meta.category),
      region,
      estimatedSessionMinutes: parseDurationMinutes(String(meta.estimatedDuration ?? "")),
      perHourUsd: 0,
      perSessionUsd: 0,
      ifLeftRunningUsd: { oneDay: 0, oneWeek: 0, oneMonth: 0 },
      freeTierEligible: true,
      alwaysOnResources: [],
      billable: [],
    };
  }
  const cfnTemplate = typeof meta.cfnTemplate === "string" ? meta.cfnTemplate : "template.yaml";
  const yaml = readFileSync(join(metaPath, "..", cfnTemplate), "utf8");
  const params = parseParameterDefaults(yaml);

  const billable: BillableLine[] = [];
  const alwaysOn = new Set<string>();

  // --- EC2 instances ---
  const instanceCount = countType(yaml, "AWS::EC2::Instance");
  if (instanceCount > 0) {
    const usages = [...yaml.matchAll(/^[ \t]*InstanceType:[ \t]+(.+?)[ \t]*$/gm)].map((m) =>
      resolveValue(m[1], params),
    );
    const types = usages.length > 0 ? usages : Array(instanceCount).fill(FALLBACK_INSTANCE_TYPE);
    const byType = groupCount(types);
    for (const [type, count] of byType) {
      billable.push({
        resource: "AWS::EC2::Instance",
        count,
        unit: type,
        hourlyUsdEach: rateFor(EC2_HOURLY[region], type),
      });
    }
  }

  // --- RDS instances (always-on) ---
  const rdsClasses = [...yaml.matchAll(/^[ \t]*DBInstanceClass:[ \t]+(.+?)[ \t]*$/gm)].map((m) =>
    resolveValue(m[1], params),
  );
  for (const [cls, count] of groupCount(rdsClasses)) {
    billable.push({
      resource: "AWS::RDS::DBInstance",
      count,
      unit: cls,
      hourlyUsdEach: rateFor(RDS_HOURLY[region], cls),
    });
    alwaysOn.add(SHORT_LABEL["AWS::RDS::DBInstance"]);
  }

  // --- flat-rate resources (ALB / NAT / EIP / Route53 HostedZone) ---
  for (const type of Object.keys(FLAT_HOURLY[region])) {
    const count = countType(yaml, type);
    if (count === 0) continue;
    billable.push({ resource: type, count, unit: "-", hourlyUsdEach: rateFor(FLAT_HOURLY[region], type) });
    if (ALWAYS_ON_TYPES.has(type)) alwaysOn.add(SHORT_LABEL[type] ?? type);
  }

  const perHourUsd = round(
    billable.reduce((sum, b) => sum + b.count * b.hourlyUsdEach, 0),
    4,
  );
  const sessionMinutes = parseDurationMinutes(String(meta.estimatedDuration ?? ""));
  const ec2Types = billable.filter((b) => b.resource === "AWS::EC2::Instance").map((b) => b.unit);
  const freeTierEligible =
    alwaysOn.size === 0 && ec2Types.every((t) => FREE_TIER_INSTANCE_TYPES.has(t));

  return {
    id,
    category: String(meta.category),
    region,
    estimatedSessionMinutes: sessionMinutes,
    perHourUsd,
    perSessionUsd: round((perHourUsd * sessionMinutes) / 60, 4),
    ifLeftRunningUsd: {
      oneDay: round(perHourUsd * 24, 2),
      oneWeek: round(perHourUsd * 24 * 7, 2),
      oneMonth: round(perHourUsd * 730, 2),
    },
    freeTierEligible,
    alwaysOnResources: [...alwaysOn].sort(),
    billable: billable.sort((a, b) => a.resource.localeCompare(b.resource) || a.unit.localeCompare(b.unit)),
  };
}

function groupCount(items: string[]): [string, number][] {
  const m = new Map<string, number>();
  for (const it of items) m.set(it, (m.get(it) ?? 0) + 1);
  return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
}

export function buildReport(): CostReport {
  const problems = collectMetadataFiles()
    .map(estimate)
    .sort((a, b) => a.id.localeCompare(b.id));
  return { version: "1", assumptions: ASSUMPTIONS, problems };
}

function serialize(report: CostReport): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}

function printTable(problems: readonly ProblemCost[]): void {
  const rows = problems.map((p) => ({
    id: p.id,
    "$/h": p.perHourUsd.toFixed(4),
    "$/session": p.perSessionUsd.toFixed(4),
    "$/day idle": p.ifLeftRunningUsd.oneDay.toFixed(2),
    freeTier: p.freeTierEligible ? "yes" : "no",
    alwaysOn: p.alwaysOnResources.join(", ") || "-",
  }));
  console.table(rows);
}

function printOne(p: ProblemCost): void {
  console.log(`# ${p.id} (${p.category}, ${p.region})`);
  console.log(`  session ~${p.estimatedSessionMinutes} min`);
  console.log(`  perHour:    $${p.perHourUsd.toFixed(4)}`);
  console.log(`  perSession: $${p.perSessionUsd.toFixed(4)}`);
  console.log(
    `  if left running: $${p.ifLeftRunningUsd.oneDay}/day  $${p.ifLeftRunningUsd.oneWeek}/week  $${p.ifLeftRunningUsd.oneMonth}/month`,
  );
  console.log(`  free tier eligible: ${p.freeTierEligible ? "yes" : "no"}`);
  console.log(`  always-on (idle でも課金): ${p.alwaysOnResources.join(", ") || "none"}`);
  for (const b of p.billable) {
    console.log(`    - ${b.count}x ${SHORT_LABEL[b.resource] ?? b.resource} (${b.unit}) @ $${b.hourlyUsdEach}/h`);
  }
}

function main(): void {
  const argv = process.argv.slice(2);
  const report = buildReport();

  if (argv.includes("--check")) {
    const expected = serialize(report);
    let current: string;
    try {
      current = readFileSync(REPORT_PATH, "utf8");
    } catch {
      console.error("cost-report.json is missing. Run: bun run scripts/estimate-cost.ts --write");
      process.exit(1);
    }
    if (current !== expected) {
      console.error("cost-report.json is stale. Run: bun run scripts/estimate-cost.ts --write");
      process.exit(1);
    }
    console.log(`cost-report.json is up to date (${report.problems.length} problems).`);
    return;
  }

  if (argv.includes("--write")) {
    writeFileSync(REPORT_PATH, serialize(report));
    console.log(`Wrote cost-report.json with ${report.problems.length} problems.`);
    return;
  }

  const id = argv.find((a) => !a.startsWith("--"));
  const wantJson = argv.includes("--json");
  const selected = id ? report.problems.filter((p) => p.id === id) : report.problems;
  if (id && selected.length === 0) {
    console.error(`Unknown problem id: ${id}`);
    process.exit(1);
  }

  if (wantJson) {
    console.log(JSON.stringify(id ? selected[0] : report, null, 2));
    return;
  }
  if (id) {
    printOne(selected[0]);
    return;
  }
  printTable(selected);
}

// 直接実行されたときだけ CLI を動かす。build-index.ts などから import したときは
// buildReport() だけ使い、main() は走らせない (= index.json と cost を同じ estimator
// から導出して二重メンテを避ける)。
if (import.meta.main) {
  main();
}
