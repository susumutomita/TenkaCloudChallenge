import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";

/**
 * Red contract for #390.
 *
 * This test intentionally fails until the problem is usable from the participant
 * surface. It does not accept "the reference code passes" as evidence that a
 * first-time participant can solve the Battle.
 */
const ROOT = new URL("..", import.meta.url).pathname;
const PROBLEM = join(ROOT, "battles", "agent-approval-gameday");

const requiredArtifacts = [
  "metadata.json",
  "README.md",
  "README.ja.md",
  "local/.dockerignore",
  "local/Dockerfile",
  "local/docker-compose.yml",
  "local/seccomp-no-connect.json",
  "local/app/server.mjs",
  "local/verifier/server.mjs",
  "local/verifier/reference.mjs",
  "local/verifier/mutation.mjs",
] as const;

function read(path: string): string {
  return readFileSync(join(PROBLEM, path), "utf8");
}

function readMetadata(): any | null {
  const path = join(PROBLEM, "metadata.json");
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8"));
}

describe("agent-approval-gameday red contract", () => {
  it("should ship every artifact needed by the participant and verifier runtimes", () => {
    const missing = requiredArtifacts.filter((path) => !existsSync(join(PROBLEM, path)));
    expect(missing).toEqual([]);
  });

  it("should expose six independent scored decisions without making the answer visible", () => {
    const metadata = readMetadata();
    expect(metadata).not.toBeNull();
    if (metadata === null) return;

    expect(metadata.id).toBe("agent-approval-gameday");
    expect(metadata.category).toBe("Battle");
    expect(metadata.status).toBe("draft");
    expect(metadata.scoring.kind).toBe("multi-verify");
    expect(metadata.scoring.checks).toHaveLength(6);
    expect(metadata.scoring.checks.reduce((sum: number, check: any) => sum + check.points, 0)).toBe(
      200,
    );

    const visible = JSON.stringify({
      shortDescription: metadata.shortDescription,
      instructions: metadata.instructions,
      hints: metadata.scoring.checks.flatMap((check: any) => check.hints ?? []),
    }).toLowerCase();
    for (const leak of ["reference.mjs", "hidden", "expectedproposal", "approvaltoken"]) {
      expect(visible).not.toContain(leak);
    }
  });

  it("should make phase capability an enforced boundary, not a UI label", () => {
    if (!existsSync(join(PROBLEM, "local/app/server.mjs"))) {
      expect(existsSync(join(PROBLEM, "local/app/server.mjs"))).toBe(true);
      return;
    }

    const runtime = read("local/app/server.mjs");
    expect(runtime).toContain("investigate");
    expect(runtime).toContain("propose");
    expect(runtime).toContain("execute");
    expect(runtime).toContain("verify");
    expect(runtime).toContain("revoke");
    expect(runtime).toMatch(/read.?only/i);
    expect(runtime).toMatch(/write/i);
    expect(runtime).toMatch(/expired|revoked/i);
  });

  it("should fail closed unless a proposal names target, diff, blast radius and rollback", () => {
    if (!existsSync(join(PROBLEM, "local/verifier/server.mjs"))) {
      expect(existsSync(join(PROBLEM, "local/verifier/server.mjs"))).toBe(true);
      return;
    }

    const verifier = read("local/verifier/server.mjs");
    for (const field of ["target", "diff", "blast", "rollback", "postCondition"]) {
      expect(verifier).toContain(field);
    }
    expect(verifier).toMatch(/ambiguous|wildcard/i);
    expect(verifier).toMatch(/reject|denied/i);
  });

  it("should keep reference and grader material outside the participant build context", () => {
    if (!existsSync(join(PROBLEM, "local/.dockerignore"))) {
      expect(existsSync(join(PROBLEM, "local/.dockerignore"))).toBe(true);
      return;
    }

    const dockerignore = read("local/.dockerignore");
    expect(dockerignore).toMatch(/verifier/);
    expect(dockerignore).toMatch(/reference/);

    const compose = read("local/docker-compose.yml");
    expect(compose).toMatch(/read_only:\s*true/);
    expect(compose).toMatch(/cap_drop:/);
    expect(compose).toMatch(/no-new-privileges/);
    expect(compose).not.toMatch(/network_mode:\s*host/);
  });

  it("should require a spoiler-firewalled blind playtest record before ready", () => {
    const playtestPath = join(PROBLEM, "PLAYTEST.md");
    expect(existsSync(playtestPath)).toBe(true);
    if (!existsSync(playtestPath)) return;

    const evidence = readFileSync(playtestPath, "utf8");
    expect(evidence).toMatch(/participant surface/i);
    expect(evidence).toMatch(/first score/i);
    expect(evidence).toMatch(/completion/i);
    expect(evidence).toMatch(/reset/i);
    expect(evidence).toMatch(/without.*reference/i);
  });
});
