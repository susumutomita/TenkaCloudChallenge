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

/** Curriculum position, mirrored from `track` when the problem declares one. */
interface IndexTrack {
  id: string;
  order: number;
  chapter: string;
}

/**
 * [#211] The participant-safe half of `courseAlignment`.
 *
 * `spoilerPolicy` is deliberately absent: it describes how the content was
 * produced, which is authoring metadata, and an `embargoed` problem is dropped
 * from the projection entirely rather than shipped carrying a label that says so.
 * `sources` is kept, because a learner already enrolled in the course benefits
 * from a pinned pointer to the material a challenge sits beside.
 */
interface IndexCourseAlignment {
  courseId: string;
  edition: string;
  week: number;
  role: string;
  sources?: Array<{ repository: string; ref: string; path: string; kind: string }>;
}

interface IndexEntry {
  id: string;
  name: string;
  category: string;
  status: string;
  visibility: string;
  onboardingOrder?: number;
  track?: IndexTrack;
  courseAlignment?: IndexCourseAlignment;
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

function toTrack(meta: Record<string, unknown>): IndexTrack | undefined {
  const track = meta.track as Record<string, unknown> | undefined;
  if (!track) return undefined;
  return { id: String(track.id), order: Number(track.order), chapter: String(track.chapter) };
}

/**
 * [#211] Project only the participant-safe fields of `courseAlignment`.
 *
 * An `embargoed` problem projects nothing at all: the catalog index is read by
 * the participant portal, so "not yet releasable" must mean absent, not hidden
 * behind a flag the client could ignore.
 */
export function toCourseAlignment(
  meta: Record<string, unknown>,
): IndexCourseAlignment | undefined {
  const alignment = meta.courseAlignment as Record<string, unknown> | undefined;
  if (!alignment || alignment.spoilerPolicy === "embargoed") return undefined;
  const sources = Array.isArray(alignment.sources)
    ? (alignment.sources as Array<Record<string, unknown>>).map((s) => ({
        repository: String(s.repository),
        ref: String(s.ref),
        path: String(s.path),
        kind: String(s.kind),
      }))
    : undefined;
  return {
    courseId: String(alignment.courseId),
    edition: String(alignment.edition),
    week: Number(alignment.week),
    role: String(alignment.role),
    ...(sources && sources.length > 0 ? { sources } : {}),
  };
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
    // Optional onboarding-track position (getting-started rail); omitted from
    // the entry when unset so only track members carry it.
    onboardingOrder: typeof meta.onboardingOrder === "number" ? meta.onboardingOrder : undefined,
    // Curriculum position + course alignment; both omitted when the problem
    // declares neither, so untracked problems keep their existing entry shape.
    track: toTrack(meta),
    courseAlignment: toCourseAlignment(meta),
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

// CLI 実行時のみ index.json を書く (test から import しても副作用が起きないように)。
if (import.meta.main) main();
