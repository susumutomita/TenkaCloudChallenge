import { describe, expect, it } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const PROBLEM = join(ROOT, "challenges/signed-does-not-mean-safe");
const read = (path: string) => {
  const target = join(PROBLEM, path);
  return existsSync(target) ? readFileSync(target, "utf8") : "";
};
const readRoot = (path: string) => readFileSync(join(ROOT, path), "utf8");

const CHECKPOINTS = [
  ["artifact-inventory", 30],
  ["provenance-boundary", 35],
  ["resolved-dependency", 35],
  ["install-policy", 35],
  ["incident-scope", 35],
  ["replay", 30],
] as const;

describe("signed-does-not-mean-safe red contract", () => {
  it("ships one self-contained bilingual Browser Workbench problem", () => {
    for (const path of [
      "README.md",
      "README.ja.md",
      "metadata.json",
      "local/Dockerfile",
      "local/docker-compose.yml",
      "local/seccomp-no-connect.json",
      "local/app/engine.mjs",
      "local/app/server.mjs",
      "local/verifier/grader.mjs",
      "local/verifier/public-cases.mjs",
      "local/verifier/reference.mjs",
      "local/verifier/mutation.mjs",
      "local/verifier/server.mjs",
    ]) {
      expect(read(path).length, path).toBeGreaterThan(20);
    }
  });

  it("defines six non-vacuous checkpoints worth exactly 200 points", () => {
    const raw = read("metadata.json");
    expect(raw.length).toBeGreaterThan(20);
    const metadata = JSON.parse(raw);
    expect(metadata.id).toBe("signed-does-not-mean-safe");
    expect(metadata.runtime).toMatchObject({ provider: "docker", engine: "compose", secretEnv: [] });
    expect(metadata.scoring.kind).toBe("multi-verify");
    expect(
      metadata.scoring.checks.map((check: { id: string; points: number }) => [
        check.id,
        check.points,
      ]),
    ).toEqual(CHECKPOINTS);
    expect(
      metadata.scoring.checks.reduce(
        (total: number, check: { points: number }) => total + check.points,
        0,
      ),
    ).toBe(200);
  });

  it("keeps provenance validity separate from source safety", () => {
    const engine = read("local/app/engine.mjs");
    const publicCases = read("local/verifier/public-cases.mjs");
    const reference = read("local/verifier/reference.mjs");
    expect(engine).toContain("provenance");
    expect(publicCases).toMatch(/valid[\s\S]*provenance/i);
    expect(publicCases).toMatch(/malicious|unsafe|unexpected/i);
    expect(reference).toMatch(/source|artifact|inventory/i);
    expect(reference).toMatch(/lock|resolved|integrity/i);
  });

  it("distinguishes install state from lifecycle execution evidence", () => {
    const grader = read("local/verifier/grader.mjs");
    const publicCases = read("local/verifier/public-cases.mjs");
    expect(grader).toContain("install-policy");
    expect(grader).toContain("incident-scope");
    expect(publicCases).toMatch(/not-installed|not installed/i);
    expect(publicCases).toMatch(/script-disabled|script disabled/i);
    expect(publicCases).toMatch(/script-executed|script executed/i);
    expect(publicCases).toMatch(/deny|allowlist/i);
  });

  it("uses only inert synthetic fixtures and never executes a package lifecycle script", () => {
    const dockerfile = read("local/Dockerfile");
    const compose = read("local/docker-compose.yml");
    const allRuntimeText = [
      dockerfile,
      compose,
      read("local/app/engine.mjs"),
      read("local/app/server.mjs"),
      read("local/verifier/grader.mjs"),
      read("local/verifier/public-cases.mjs"),
      read("local/verifier/reference.mjs"),
      read("local/verifier/mutation.mjs"),
    ].join("\n");

    expect(allRuntimeText).toMatch(/synthetic/i);
    expect(allRuntimeText).not.toMatch(/npm\s+(install|ci|rebuild|exec)|bun\s+install/i);
    expect(allRuntimeText).not.toMatch(/child_process|spawn\(|exec\(/);
    expect(allRuntimeText).not.toMatch(/AWS_(ACCESS_KEY_ID|SECRET_ACCESS_KEY)|NPM_TOKEN/);
  });

  it("isolates participant and verifier images with no egress", () => {
    const dockerfile = read("local/Dockerfile");
    const participant = dockerfile.slice(
      dockerfile.indexOf("FROM base AS participant"),
      dockerfile.indexOf("FROM base AS verifier"),
    );
    expect(participant).not.toContain("verifier/");
    expect(participant).not.toContain("reference");
    expect(participant).not.toContain("mutation");

    const compose = read("local/docker-compose.yml");
    expect(compose.match(/127\.0\.0\.1/g)?.length).toBe(2);
    expect(compose.match(/read_only: true/g)?.length).toBe(2);
    expect(compose.match(/cap_drop:/g)?.length).toBe(2);
    expect(compose.match(/no-new-privileges:true/g)?.length).toBe(2);
    expect(compose.match(/seccomp=\.\/seccomp-no-connect\.json/g)?.length).toBe(2);
    expect(dockerfile.match(/USER node/g)?.length).toBe(2);
  });

  it("documents official guarantee boundaries and separates CI from human proof", () => {
    for (const path of ["README.md", "README.ja.md"]) {
      const text = read(path);
      expect(text).toContain("docs.npmjs.com/generating-provenance-statements");
      expect(text).toContain("docs.npmjs.com/cli");
      expect(text).toMatch(/USD 0|0 USD/);
      expect(text).toMatch(/human[\s\S]*playtest|人間[\s\S]*プレイ/i);
      expect(text).toMatch(/synthetic|合成/);
    }
  });

  it("makes the clean Docker proof a required CI dependency", () => {
    const workflow = readRoot(".github/workflows/ci.yml");
    expect(workflow).toContain("signed-does-not-mean-safe-runtime:");
    expect(workflow).toContain("bun run signed-does-not-mean-safe:runtime");
    expect(workflow).toContain("needs:");
    expect(workflow).toContain("signed-does-not-mean-safe-runtime");
  });
});
