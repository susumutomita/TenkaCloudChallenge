import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const challengeRoot = join(root, "challenges", "asm-worst-case-latency");

function readText(path: string): string {
  return existsSync(path) ? readFileSync(path, "utf8") : "";
}

describe("asm-worst-case-latency playable contract", () => {
  test("declares a draft native-amd64 runtime before any timing result can be trusted", () => {
    const metadataPath = join(challengeRoot, "metadata.json");
    expect(existsSync(metadataPath)).toBe(true);

    const metadata = JSON.parse(readText(metadataPath) || "{}") as {
      status?: string;
      runtime?: {
        compatibility?: {
          nativeArchitectures?: string[];
          cpuFlags?: string[];
        };
      };
    };

    expect(metadata.status).toBe("draft");
    expect(metadata.runtime?.compatibility?.nativeArchitectures).toEqual(["amd64"]);
    expect(metadata.runtime?.compatibility?.cpuFlags).toEqual(
      expect.arrayContaining(["rdtscp", "constant_tsc", "nonstop_tsc"]),
    );
  });

  test("ships separate participant, verifier, and reference boundaries", () => {
    for (const path of [
      "local/docker-compose.yml",
      "participant/README.md",
      "verifier/grader.py",
      "reference/solution.S",
      "tests/mutations.test.ts",
    ]) {
      expect(existsSync(join(challengeRoot, path))).toBe(true);
    }
  });

  test("the public starter cannot satisfy the hidden exact-one-instruction contract", () => {
    const starter = readText(join(challengeRoot, "participant", "candidate.S"));
    const verifier = readText(join(challengeRoot, "verifier", "grader.py"));

    expect(starter.length).toBeGreaterThan(0);
    expect(verifier).toContain("exactly_one_instruction");
    expect(verifier).toContain("normalized_score");
    expect(verifier).toContain("reject_migration_or_interrupt");
  });

  test("the runtime is loopback-only, non-root, read-only, and bounded", () => {
    const compose = readText(join(challengeRoot, "local", "docker-compose.yml"));

    expect(compose).toContain("127.0.0.1:");
    expect(compose).toContain("read_only: true");
    expect(compose).toContain("no-new-privileges:true");
    expect(compose).toContain("cap_drop:");
    expect(compose).toContain("- ALL");
    expect(compose).toContain("pids_limit:");
    expect(compose).toContain("network_mode: none");
  });
});
