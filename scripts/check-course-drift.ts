#!/usr/bin/env bun
/**
 * [#214] Detect upstream drift for course-aligned problems.
 *
 * Every `courseAlignment.sources[]` entry pins a course file to a 40-hex commit
 * SHA (see `docs/curricula/<track>/GOVERNANCE.md` §5). Upstream keeps moving, so
 * a pin silently becomes a claim about a version nobody has re-read.
 *
 * This reports, per pinned file, whether the upstream content at the repository's
 * default branch still matches the pinned commit's content. It deliberately
 * does NOT auto-update anything: a changed exercise may mean "re-pin", but it may
 * equally mean "the assignment was revised and our companion is now wrong".
 * A human decides which.
 *
 * Usage:
 *   bun run course:drift            # report; exit 1 when drift is found
 *   bun run course:drift --json     # machine-readable report on stdout
 *   bun run course:drift --no-fail  # report only; always exit 0
 *
 * Requires network access and reads only public GitHub content. Offline, it exits
 * 2 with a clear message rather than pretending everything is in sync.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const REPO_ROOT = new URL("..", import.meta.url).pathname;
const CATEGORY_DIRS = ["battles", "challenges"] as const;
const GITHUB_API = "https://api.github.com";

interface PinnedSource {
  readonly problemId: string;
  readonly repository: string;
  readonly ref: string;
  readonly path: string;
  readonly kind: string;
}

type DriftStatus = "in-sync" | "drifted" | "missing-upstream" | "unreachable";

interface DriftRow {
  readonly problemId: string;
  readonly repository: string;
  readonly path: string;
  readonly pinnedRef: string;
  readonly upstreamRef?: string;
  readonly status: DriftStatus;
  readonly detail?: string;
}

function collectPinnedSources(): PinnedSource[] {
  const sources: PinnedSource[] = [];
  for (const category of CATEGORY_DIRS) {
    let entries: string[];
    try {
      entries = readdirSync(join(REPO_ROOT, category));
    } catch {
      continue;
    }
    for (const entry of entries) {
      const file = join(REPO_ROOT, category, entry, "metadata.json");
      try {
        if (!statSync(file).isFile()) continue;
      } catch {
        continue;
      }
      const meta = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
      const alignment = meta.courseAlignment as { sources?: unknown } | undefined;
      if (!Array.isArray(alignment?.sources)) continue;
      for (const raw of alignment.sources as Array<Record<string, unknown>>) {
        sources.push({
          problemId: String(meta.id),
          repository: String(raw.repository),
          ref: String(raw.ref),
          path: String(raw.path),
          kind: String(raw.kind),
        });
      }
    }
  }
  return sources;
}

function githubHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "tenkacloud-course-drift",
  };
  // CI passes GITHUB_TOKEN purely to raise the anonymous rate limit. The source
  // repositories are public; no token means fewer requests, not less access.
  const token = process.env.GITHUB_TOKEN;
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

/** Content SHA (git blob id) of one path at one ref, or undefined when absent. */
async function blobShaAt(
  repository: string,
  ref: string,
  path: string,
): Promise<string | undefined> {
  const url = `${GITHUB_API}/repos/${repository}/contents/${path}?ref=${ref}`;
  const response = await fetch(url, { headers: githubHeaders() });
  if (response.status === 404) return undefined;
  if (!response.ok) {
    throw new Error(`GitHub API ${response.status} for ${repository}@${ref}:${path}`);
  }
  const body = (await response.json()) as { sha?: unknown };
  return typeof body.sha === "string" ? body.sha : undefined;
}

async function defaultBranch(repository: string): Promise<string> {
  const response = await fetch(`${GITHUB_API}/repos/${repository}`, { headers: githubHeaders() });
  if (!response.ok) throw new Error(`GitHub API ${response.status} for ${repository}`);
  const body = (await response.json()) as { default_branch?: unknown };
  return typeof body.default_branch === "string" ? body.default_branch : "main";
}

async function inspect(source: PinnedSource, branch: string): Promise<DriftRow> {
  const base = {
    problemId: source.problemId,
    repository: source.repository,
    path: source.path,
    pinnedRef: source.ref,
  };
  try {
    const [pinned, current] = await Promise.all([
      blobShaAt(source.repository, source.ref, source.path),
      blobShaAt(source.repository, branch, source.path),
    ]);
    if (pinned === undefined) {
      return { ...base, status: "unreachable", detail: "pinned commit no longer serves this path" };
    }
    if (current === undefined) {
      return { ...base, status: "missing-upstream", detail: "path was removed or renamed upstream" };
    }
    return pinned === current
      ? { ...base, status: "in-sync", upstreamRef: current }
      : { ...base, status: "drifted", upstreamRef: current };
  } catch (error) {
    return { ...base, status: "unreachable", detail: (error as Error).message };
  }
}

function report(rows: readonly DriftRow[]): void {
  const bySeverity: Record<DriftStatus, DriftRow[]> = {
    drifted: [],
    "missing-upstream": [],
    unreachable: [],
    "in-sync": [],
  };
  for (const row of rows) bySeverity[row.status].push(row);

  for (const row of bySeverity.drifted) {
    console.log(`DRIFT      ${row.problemId}  ${row.repository}:${row.path}`);
    console.log(`           pinned ${row.pinnedRef} -> upstream content is now ${row.upstreamRef}`);
  }
  for (const row of bySeverity["missing-upstream"]) {
    console.log(`REMOVED    ${row.problemId}  ${row.repository}:${row.path}  (${row.detail})`);
  }
  for (const row of bySeverity.unreachable) {
    console.log(`UNKNOWN    ${row.problemId}  ${row.repository}:${row.path}  (${row.detail})`);
  }
  console.log(
    `\n${bySeverity["in-sync"].length} in sync, ${bySeverity.drifted.length} drifted, ` +
      `${bySeverity["missing-upstream"].length} removed upstream, ` +
      `${bySeverity.unreachable.length} unreachable.`,
  );
  if (bySeverity.drifted.length > 0 || bySeverity["missing-upstream"].length > 0) {
    console.log(
      "\nDo not auto-update the pin. Re-read the changed source, then either re-pin the SHA " +
        "(the alignment still holds) or open an issue (the exercise was revised or retired). " +
        "See docs/curricula/<track>/GOVERNANCE.md §5.",
    );
  }
}

async function main(): Promise<void> {
  const sources = collectPinnedSources();
  if (sources.length === 0) {
    console.log("No course-aligned problems pin an upstream source yet. Nothing to check.");
    return;
  }

  const repositories = [...new Set(sources.map((s) => s.repository))];
  const branches = new Map<string, string>();
  for (const repository of repositories) {
    try {
      branches.set(repository, await defaultBranch(repository));
    } catch (error) {
      console.error(`Cannot reach ${repository}: ${(error as Error).message}`);
      console.error("Course drift needs network access to public GitHub. Aborting.");
      process.exit(2);
    }
  }

  const rows: DriftRow[] = [];
  for (const source of sources) {
    rows.push(await inspect(source, branches.get(source.repository) ?? "main"));
  }

  if (process.argv.includes("--json")) {
    console.log(JSON.stringify({ checkedAt: new Date().toISOString(), rows }, null, 2));
  } else {
    report(rows);
  }

  const actionable = rows.some((r) => r.status === "drifted" || r.status === "missing-upstream");
  if (actionable && !process.argv.includes("--no-fail")) process.exit(1);
}

if (import.meta.main) await main();

export { collectPinnedSources, inspect, report };
export type { DriftRow, DriftStatus, PinnedSource };
