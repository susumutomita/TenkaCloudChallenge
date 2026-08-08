import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";

const ROOT = new URL("..", import.meta.url).pathname;
const TRACK_ID = "absolute-beginner-to-stackstack";

const EXPECTED_ROUTE = [
  ["challenges/sqli-demo", 10],
  ["challenges/stackstack-onboarding", 20],
  ["challenges/wp-exposed-backup", 30],
  ["challenges/wix-exposure-audit", 40],
  ["challenges/xss-demo", 50],
  ["challenges/csrf-demo", 60],
  ["battles/hello-world-battle", 70],
  ["challenges/wp-harden-leaks", 80],
  ["challenges/wp-midnight-admin", 90],
  ["challenges/stackstack-ship", 100],
  ["challenges/stackstack-vibe-build", 110],
  ["challenges/stackstack-defend", 120],
  ["challenges/stackstack-safe-exposure", 130],
  ["challenges/stackstack-observability", 140],
  ["challenges/stackstack-secrets", 150],
  ["challenges/stackstack-recover", 160],
  ["battles/stackstack", 170],
  ["challenges/wp2shell-local-lab", 180],
] as const;

function metadata(directory: string): {
  id: string;
  track?: { id: string; order: number; chapter: string };
} {
  return JSON.parse(readFileSync(join(ROOT, directory, "metadata.json"), "utf8"));
}

describe("absolute beginner to StackStack learning path", () => {
  it("pins the reviewed problem order as machine-readable metadata", () => {
    const actual = EXPECTED_ROUTE.map(([directory]) => {
      const entry = metadata(directory);
      return [entry.id, entry.track?.id, entry.track?.order, entry.track?.chapter];
    });

    expect(actual).toEqual(
      EXPECTED_ROUTE.map(([directory, order]) => {
        const entry = metadata(directory);
        return [entry.id, TRACK_ID, order, expect.any(String)];
      }),
    );
  });

  it("matches the platform's pinned zero-progress drill to the track's first problem", () => {
    const first = EXPECTED_ROUTE.toSorted((a, b) => a[1] - b[1])[0];
    expect(metadata(first[0]).id).toBe("sqli-demo");
  });

  it("documents the prerequisite gaps instead of claiming a continuous curriculum", () => {
    const curriculum = readFileSync(
      join(ROOT, "docs", "curricula", "stackstack-learning-path.md"),
      "utf8",
    );
    expect(curriculum).toContain("Before `sqli-demo`");
    expect(curriculum).toContain("Before `xss-demo` / `csrf-demo`");
    expect(curriculum).toContain("Before `wp-harden-leaks`");
    expect(curriculum).toContain("Before the `stackstack` capstone");
    expect(curriculum).toContain("Platform recommendation after the pinned drill");
  });
});
