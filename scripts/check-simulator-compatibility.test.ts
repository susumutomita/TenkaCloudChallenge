import { describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  catalogScannerArguments,
  formatCompatibilitySummary,
  parseCompatibilityArguments,
  resolveCleanCatalogCommit,
  resolveCleanSimulatorCommit,
  resolveSimulatorVersion,
} from "./check-simulator-compatibility";

function git(cwd: string, ...args: readonly string[]): string {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr);
  return result.stdout.trim();
}

describe("Simulator compatibility CLI argument", () => {
  it("pinned Simulator checkout と report path を受け取る", () => {
    const parsed = parseCompatibilityArguments([
      "--simulator",
      "../TenkaCloudSimulator",
      "--output",
      "reports/simulator-coverage.json",
    ]);
    expect(parsed).not.toBe("help");
    if (parsed === "help") return;
    expect(parsed.simulator).toEndWith("TenkaCloudSimulator");
    expect(parsed.output).toEndWith("reports/simulator-coverage.json");
  });

  it("help だけを副作用なしで処理する", () => {
    expect(parseCompatibilityArguments(["--help"])).toBe("help");
  });

  it("missing、unknown、duplicate option を拒否する", () => {
    expect(() => parseCompatibilityArguments([])).toThrow(/Usage/);
    expect(() => parseCompatibilityArguments(["--unknown", "value"])).toThrow(/Usage/);
    expect(() =>
      parseCompatibilityArguments([
        "--simulator",
        "one",
        "--simulator",
        "two",
        "--output",
        "report.json",
      ]),
    ).toThrow(/Usage/);
  });
});

describe("Simulator compatibility provenance", () => {
  it("should accept exact clean catalog and Simulator commits", () => {
    const checkout = mkdtempSync(join(tmpdir(), "tenkacloud-compat-clean-"));
    try {
      git(checkout, "init", "--quiet");
      git(checkout, "config", "user.name", "TenkaCloud Test");
      git(checkout, "config", "user.email", "test@example.invalid");
      writeFileSync(join(checkout, "README.md"), "clean\n");
      git(checkout, "add", "README.md");
      git(checkout, "commit", "--quiet", "-m", "test: initialize checkout");
      const commit = git(checkout, "rev-parse", "HEAD");

      expect(resolveCleanCatalogCommit(checkout)).toBe(commit);
      expect(resolveCleanSimulatorCommit(checkout)).toBe(commit);
    } finally {
      rmSync(checkout, { recursive: true, force: true });
    }
  });

  it("should reject dirty catalog and Simulator provenance", () => {
    const checkout = mkdtempSync(join(tmpdir(), "tenkacloud-compat-dirty-"));
    try {
      git(checkout, "init", "--quiet");
      git(checkout, "config", "user.name", "TenkaCloud Test");
      git(checkout, "config", "user.email", "test@example.invalid");
      writeFileSync(join(checkout, "README.md"), "clean\n");
      git(checkout, "add", "README.md");
      git(checkout, "commit", "--quiet", "-m", "test: initialize checkout");
      writeFileSync(join(checkout, "dirty.txt"), "dirty\n");

      expect(() => resolveCleanCatalogCommit(checkout)).toThrow(/catalog checkout must be clean/);
      expect(() => resolveCleanSimulatorCommit(checkout)).toThrow(
        /Simulator checkout must be clean/,
      );
    } finally {
      rmSync(checkout, { recursive: true, force: true });
    }
  });

  it("should bind manifest and scanner arguments to immutable identities", () => {
    const directory = mkdtempSync(join(tmpdir(), "tenkacloud-capabilities-"));
    const manifest = join(directory, "capabilities.json");
    const simulatorCommit = "a".repeat(40);
    try {
      writeFileSync(
        manifest,
        JSON.stringify({ version: `tenkacloud-simulator-0.1.0+git.${simulatorCommit}` }),
      );
      const version = resolveSimulatorVersion(manifest, "0.1.0", simulatorCommit);
      expect(version).toBe(`tenkacloud-simulator-0.1.0+git.${simulatorCommit}`);
      expect(() => resolveSimulatorVersion(manifest, "0.2.0", simulatorCommit)).toThrow(
        /does not match/,
      );
      expect(
        catalogScannerArguments({
          catalog: "/catalog",
          catalogCommit: "b".repeat(40),
          capabilities: manifest,
          simulatorVersion: version,
          output: "/catalog/report.json",
        }),
      ).toEqual([
        "--catalog",
        "/catalog",
        "--catalog-commit",
        "b".repeat(40),
        "--capabilities",
        manifest,
        "--simulator-version",
        version,
        "--output",
        "/catalog/report.json",
      ]);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("should render only the public supported and binding summary fields", () => {
    expect(
      formatCompatibilitySummary({
        supported: false,
        summary: { total: 12, covered: 9, missing: 1, insufficient: 1, invalid: 1 },
      }),
    ).toBe(
      "Simulator compatibility: supported=false total=12 covered=9 missing=1 insufficient=1 invalid=1",
    );
    expect(formatCompatibilitySummary({ supported: true, summary: { covered: 1 } })).toBeNull();
  });
});
