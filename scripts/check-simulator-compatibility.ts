#!/usr/bin/env bun

import { spawnSync } from "node:child_process";
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

interface Arguments {
  readonly simulator: string;
  readonly output: string;
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

function printSummary(output: string): void {
  let report: unknown;
  try {
    report = JSON.parse(readFileSync(output, "utf8"));
  } catch {
    return;
  }
  if (report === null || typeof report !== "object" || Array.isArray(report)) return;
  const summary = Reflect.get(report, "summary");
  const status = Reflect.get(report, "status");
  if (summary === null || typeof summary !== "object" || Array.isArray(summary)) return;
  const fields = [
    "problems",
    "targets",
    "requirements",
    "covered",
    "missing",
    "insufficient",
    "invalid",
  ];
  const rendered = fields
    .map((field) => `${field}=${String(Reflect.get(summary, field))}`)
    .join(" ");
  console.log(`Simulator compatibility: status=${String(status)} ${rendered}`);
}

export function runCompatibilityCheck(args: Arguments): 0 | 1 | 2 {
  const packagePath = join(args.simulator, "package.json");
  const manifestTool = join(args.simulator, "tools", "capability-manifest", "src", "bin.ts");
  const scannerTool = join(args.simulator, "tools", "catalog-scanner", "src", "cli.ts");
  requiredRegularFile(packagePath, "Simulator package.json");
  requiredRegularFile(manifestTool, "Simulator capability manifest tool");
  requiredRegularFile(scannerTool, "Simulator catalog scanner tool");
  const packageJson = JSON.parse(readFileSync(packagePath, "utf8"));
  if (packageJson?.name !== "tenkacloud-simulator") {
    throw new Error(`--simulator is not a TenkaCloudSimulator checkout: ${args.simulator}`);
  }

  mkdirSync(dirname(args.output), { recursive: true });
  const temporary = mkdtempSync(join(tmpdir(), "tenkacloud-simulator-compatibility-"));
  const capabilities = join(temporary, "capabilities.json");
  try {
    const manifestExit = runBun(manifestTool, ["--output", capabilities], args.simulator);
    if (manifestExit !== 0) return 2;
    const scannerExit = runBun(
      scannerTool,
      ["--catalog", CATALOG_ROOT, "--capabilities", capabilities, "--output", args.output],
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
