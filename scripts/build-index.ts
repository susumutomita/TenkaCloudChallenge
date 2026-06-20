#!/usr/bin/env bun
/**
 * Regenerate index.json from every problems/{battles,challenges}/<id>/metadata.json.
 *
 * index.json is the lightweight catalog index the platform reads to render the
 * problem list without parsing each full metadata.json. It is NOT validated by
 * CI, so it drifts when problems are added by hand; this script rebuilds it as
 * the single source of truth = the union of metadata.json files that actually
 * exist on disk (stale entries for deleted problems are dropped).
 *
 * Fields mirrored per problem (Japanese top-level, not i18n.en):
 *   id, name, category, status, visibility (default "public"), difficulty,
 *   estimatedDuration, shortDescription, tags, scoringKind (= scoring.kind),
 *   cost (= #87 Phase B: select-time コスト可視化。estimate-cost.ts が template から
 *   導出する perHour / 放置時 $/day / free-tier 可否 / always-on リソース)。
 *
 * Usage:
 *   bun run scripts/build-index.ts          # write index.json
 *   bun run scripts/build-index.ts --check  # exit 1 if index.json is stale
 *
 * cost は estimate-cost.ts の buildReport() から導出するため、template の課金リソースを
 * 変えたら `bun run scripts/build-index.ts` を再実行する (CI が --check で drift を止める)。
 */

import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildReport, type ProblemCost } from "./estimate-cost";

const REPO_ROOT = new URL("..", import.meta.url).pathname;
const CATEGORY_DIRS = ["battles", "challenges"] as const;
const INDEX_PATH = join(REPO_ROOT, "index.json");

/** index.json に載せる軽量コスト要約 (= select 時にカタログ/管理コンソールが読む)。 */
interface IndexCost {
  perHourUsd: number;
  perDayIfLeftRunningUsd: number;
  freeTierEligible: boolean;
  alwaysOnResources: string[];
}

interface IndexEntry {
  id: string;
  name: string;
  category: string;
  status: string;
  visibility: string;
  difficulty: number;
  estimatedDuration: string;
  shortDescription: string;
  tags: string[];
  scoringKind: string;
  cost: IndexCost;
}

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

function toEntry(meta: Record<string, unknown>, costById: Map<string, ProblemCost>): IndexEntry {
  const scoring = (meta.scoring ?? {}) as Record<string, unknown>;
  const c = costById.get(String(meta.id));
  return {
    id: String(meta.id),
    name: String(meta.name),
    category: String(meta.category),
    status: String(meta.status),
    visibility: typeof meta.visibility === "string" ? meta.visibility : "public",
    difficulty: Number(meta.difficulty),
    estimatedDuration: String(meta.estimatedDuration),
    shortDescription: String(meta.shortDescription),
    tags: Array.isArray(meta.tags) ? (meta.tags as string[]) : [],
    scoringKind: typeof scoring.kind === "string" ? scoring.kind : "none",
    cost: {
      perHourUsd: c?.perHourUsd ?? 0,
      perDayIfLeftRunningUsd: c?.ifLeftRunningUsd.oneDay ?? 0,
      freeTierEligible: c?.freeTierEligible ?? true,
      alwaysOnResources: c ? [...c.alwaysOnResources] : [],
    },
  };
}

function buildIndex(): { version: string; problems: IndexEntry[] } {
  const costById = new Map(buildReport().problems.map((p) => [p.id, p] as const));
  const problems = collectMetadataFiles()
    .map((f) => toEntry(JSON.parse(readFileSync(f, "utf8")), costById))
    .sort((a, b) => a.id.localeCompare(b.id));
  return { version: "1", problems };
}

function main(): void {
  const index = buildIndex();
  const json = `${JSON.stringify(index, null, 2)}\n`;
  if (process.argv.includes("--check")) {
    const current = readFileSync(INDEX_PATH, "utf8");
    if (current !== json) {
      console.error("index.json is stale. Run: bun run scripts/build-index.ts");
      process.exit(1);
    }
    console.log(`index.json is up to date (${index.problems.length} problems).`);
    return;
  }
  writeFileSync(INDEX_PATH, json);
  console.log(`Wrote index.json with ${index.problems.length} problems.`);
}

main();
