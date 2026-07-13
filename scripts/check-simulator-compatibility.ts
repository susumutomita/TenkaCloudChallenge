#!/usr/bin/env bun

import { spawnSync } from "node:child_process";
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

interface Arguments {
  readonly simulator: string;
  readonly output: string;
}

interface SimulatorPackage {
  readonly name: string;
  readonly version: string;
}

interface PublicCoverageSummary {
  readonly total: number;
  readonly covered: number;
  readonly missing: number;
  readonly insufficient: number;
  readonly invalid: number;
}
const HELP = `Usage: bun run simulator:compatibility --simulator <TenkaCloudSimulator checkout> --output <report.json>

Generates the checked-out Simulator capability manifest and scans this catalog.
Exit 0 means covered; exit 1 means missing/insufficient/invalid; exit 2 means invocation failure.
`;

const CATALOG_ROOT = new URL("..", import.meta.url).pathname;

export function parseCompatibilityArguments(args: readonly string[]): Arguments | "help" {
  if (args.length === 1 && args[0] === "--help") return "help";
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const option = args[index];
    const value = args[index + 1];
    if (
      (option !== "--simulator" && option !== "--output") ||
      value === undefined ||
      value.startsWith("--") ||
      values.has(option)
    ) {
      throw new Error(HELP);
    }
    values.set(option, value);
  }
  const simulator = values.get("--simulator");
  const output = values.get("--output");
  if (simulator === undefined || output === undefined) throw new Error(HELP);
  return { simulator: resolve(simulator), output: resolve(output) };
}

function requiredRegularFile(path: string, label: string): void {
  let stat;
  try {
    stat = lstatSync(path);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code ?? "unknown error";
    throw new Error(`${label} is unavailable (${code}): ${path}`);
  }
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error(`${label} must be a non-symlink regular file: ${path}`);
  }
}

function runBun(script: string, args: readonly string[], cwd: string): number {
  const result = spawnSync(process.execPath, [script, ...args], {
    cwd,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) throw result.error;
  return result.status ?? 2;
}

function objectRecord(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function nonNegativeInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}

function runGit(checkout: string, args: readonly string[]): string {
  const result = spawnSync("git", ["-C", checkout, ...args], {
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `Git provenance inspection failed: ${result.stderr.trim() || `exit ${String(result.status)}`}`,
    );
  }
  return result.stdout.trim();
}

function resolveCleanCheckoutCommit(checkout: string, label: string): string {
  const commit = runGit(checkout, ["rev-parse", "--verify", "HEAD"]);
  if (!/^[0-9a-f]{40}$/.test(commit)) {
    throw new Error(`${label} HEAD is not an immutable 40-character Git SHA: ${commit}`);
  }
  const status = runGit(checkout, [
    "status",
    "--porcelain=v1",
    "--untracked-files=all",
    "--ignore-submodules=none",
    "--",
    ".",
  ]);
  if (status.length > 0) throw new Error(`${label} checkout must be clean before scanning`);
  return commit;
}

export function resolveCleanCatalogCommit(catalog: string): string {
  return resolveCleanCheckoutCommit(catalog, "catalog");
}

export function resolveCleanSimulatorCommit(simulator: string): string {
  return resolveCleanCheckoutCommit(simulator, "Simulator");
}

function readJsonObject(path: string, label: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
    const record = objectRecord(parsed);
    if (record === null) throw new Error("expected a JSON object");
    return record;
  } catch (error) {
    throw new Error(
      `${label} must contain valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function simulatorPackage(path: string): SimulatorPackage {
  const packageJson = readJsonObject(path, "Simulator package.json");
  const name = nonEmptyString(packageJson.name);
  const version = nonEmptyString(packageJson.version);
  if (name !== "tenkacloud-simulator" || version === null) {
    throw new Error(`--simulator is not a TenkaCloudSimulator checkout: ${dirname(path)}`);
  }
  return { name, version };
}

export function resolveSimulatorVersion(
  capabilitiesPath: string,
  packageVersion: string,
  simulatorCommit: string,
): string {
  const manifest = readJsonObject(capabilitiesPath, "Simulator capability manifest");
  const version = nonEmptyString(manifest.version);
  if (version === null) {
    throw new Error("Simulator capability manifest.version must be a non-empty string");
  }
  const expected = `tenkacloud-simulator-${packageVersion}+git.${simulatorCommit}`;
  if (version !== expected) {
    throw new Error(`Simulator capability manifest version ${version} does not match ${expected}`);
  }
  return version;
}

export function formatCompatibilitySummary(report: unknown): string | null {
  const record = objectRecord(report);
  if (record === null || typeof record.supported !== "boolean") return null;
  const rawSummary = objectRecord(record.summary);
  if (rawSummary === null) return null;
  const fields = ["total", "covered", "missing", "insufficient", "invalid"] as const;
  const values = Object.fromEntries(
    fields.map((field) => [field, nonNegativeInteger(rawSummary[field])]),
  ) as Record<keyof PublicCoverageSummary, number | null>;
  if (fields.some((field) => values[field] === null)) return null;
  return `Simulator compatibility: supported=${String(record.supported)} ${fields
    .map((field) => `${field}=${String(values[field])}`)
    .join(" ")}`;
}

function printSummary(output: string): void {
  try {
    const summary = formatCompatibilitySummary(JSON.parse(readFileSync(output, "utf8")));
    if (summary !== null) console.log(summary);
  } catch {
    // Scanner exit status remains authoritative when no valid summary was written.
  }
}

export function catalogScannerArguments(identity: {
  readonly capabilities: string;
  readonly catalog: string;
  readonly catalogCommit: string;
  readonly output: string;
  readonly simulatorVersion: string;
}): readonly string[] {
  return [
    "--catalog",
    identity.catalog,
    "--catalog-commit",
    identity.catalogCommit,
    "--capabilities",
    identity.capabilities,
    "--simulator-version",
    identity.simulatorVersion,
    "--output",
    identity.output,
  ];
}

export function runCompatibilityCheck(args: Arguments): 0 | 1 | 2 {
  const packagePath = join(args.simulator, "package.json");
  const manifestTool = join(args.simulator, "tools", "capability-manifest", "src", "bin.ts");
  const scannerTool = join(args.simulator, "tools", "catalog-scanner", "src", "cli.ts");
  requiredRegularFile(packagePath, "Simulator package.json");
  requiredRegularFile(manifestTool, "Simulator capability manifest tool");
  requiredRegularFile(scannerTool, "Simulator catalog scanner tool");
  const packageJson = simulatorPackage(packagePath);
  const catalogCommit = resolveCleanCatalogCommit(CATALOG_ROOT);
  const simulatorCommit = resolveCleanSimulatorCommit(args.simulator);

  mkdirSync(dirname(args.output), { recursive: true });
  const temporary = mkdtempSync(join(tmpdir(), "tenkacloud-simulator-compatibility-"));
  const capabilities = join(temporary, "capabilities.json");
  try {
    const manifestExit = runBun(
      manifestTool,
      ["--source-commit", simulatorCommit, "--output", capabilities],
      args.simulator,
    );
    if (manifestExit !== 0) return 2;
    const simulatorVersion = resolveSimulatorVersion(
      capabilities,
      packageJson.version,
      simulatorCommit,
    );
    const scannerExit = runBun(
      scannerTool,
      catalogScannerArguments({
        catalog: CATALOG_ROOT,
        catalogCommit,
        capabilities,
        simulatorVersion,
        output: args.output,
      }),
      args.simulator,
    );
    printSummary(args.output);
    return scannerExit === 0 ? 0 : scannerExit === 1 ? 1 : 2;
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  try {
    const parsed = parseCompatibilityArguments(Bun.argv.slice(2));
    if (parsed === "help") {
      process.stdout.write(HELP);
    } else {
      process.exitCode = runCompatibilityCheck(parsed);
    }
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
  }
}
