#!/usr/bin/env bun
/**
 * Evaluate catalog CloudFormation templates against local Kumo.
 *
 * This script is deliberately hard-wired to a localhost endpoint and dummy AWS
 * credentials. It must never be used as a live AWS deploy/smoke path.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { parseDocument } from "yaml";

type Metadata = {
  id?: unknown;
  cfnTemplate?: unknown;
  cfnParameters?: unknown;
};

type Problem = {
  id: string;
  dir: string;
  metadataPath: string;
  templatePath: string;
  parameters: Record<string, string>;
};

const REPO_ROOT = resolve(new URL("..", import.meta.url).pathname);
const CATEGORY_DIRS = ["battles", "challenges"];
const DEFAULT_ENDPOINT = "http://127.0.0.1:4566";
const DEFAULT_REGION = "us-east-1";
const DEFAULT_CLOUDFORMATION_HOST = "cloudformation.localhost";
const RANDOM_PASSWORD_SENTINEL = "__RANDOM_PASSWORD__";
const DETERMINISTIC_PASSWORD = "KumoLocalPassword1234567890";

const args = process.argv.slice(2);

if (args.includes("--help") || args.includes("-h")) {
  printHelp();
  process.exit(0);
}

const endpoint = readOption("--endpoint") ?? process.env.KUMO_ENDPOINT ?? DEFAULT_ENDPOINT;
const region = readOption("--region") ?? process.env.KUMO_REGION ?? DEFAULT_REGION;
const cloudFormationHost =
  readOption("--cloudformation-host") ??
  process.env.KUMO_CLOUDFORMATION_HOST ??
  DEFAULT_CLOUDFORMATION_HOST;
const keepStacks = args.includes("--keep-stacks");
const createStacks = !args.includes("--template-only");
const targets = args.filter((arg) => !arg.startsWith("--") && !optionValueIndexes().has(args.indexOf(arg)));

assertLocalEndpoint(endpoint);
assertLocalCloudFormationHost(cloudFormationHost);

const problems = resolveProblems(targets);
if (problems.length === 0) {
  console.error("No problems found.");
  process.exit(1);
}

let failures = 0;
for (const problem of problems) {
  const stackName = localStackName(problem.id);
  console.log(`== ${problem.id} ==`);
  try {
    const templateBody = cloudFormationJsonTemplate(problem.templatePath);
    await cloudFormation("ValidateTemplate", { TemplateBody: templateBody });
    console.log("  OK validate-template");

    if (createStacks) {
      await cleanupLocalStack(stackName, false);
      await cloudFormation("CreateStack", {
        StackName: stackName,
        TemplateBody: templateBody,
        "Capabilities.member.1": "CAPABILITY_NAMED_IAM",
        ...parameterMembers(problem.parameters),
      });
      await waitForCreateComplete(stackName);
      console.log("  OK create-stack (local Kumo)");
      if (!keepStacks) {
        await cleanupLocalStack(stackName, true);
      }
    }
  } catch (error) {
    failures += 1;
    console.error(`  FAIL ${error instanceof Error ? error.message : String(error)}`);
    if (createStacks && !keepStacks) {
      await cleanupLocalStack(stackName, false);
    }
  }
}

if (failures > 0) {
  console.error(`\nKumo evaluation failed: ${failures}/${problems.length}`);
  process.exit(1);
}

console.log(`\nKumo evaluation passed: ${problems.length}/${problems.length}`);

function printHelp(): void {
  console.log(`Usage:
  bun run scripts/kumo-evaluate-problems.ts [problem-dir-or-id ...]

Options:
  --endpoint URL       Kumo endpoint. Must be localhost. Default: ${DEFAULT_ENDPOINT}
  --region REGION     Local AWS region. Default: ${DEFAULT_REGION}
  --cloudformation-host HOST
                       Host header used for Kumo CloudFormation routing.
                       Must be local. Default: ${DEFAULT_CLOUDFORMATION_HOST}
  --template-only      Run local CloudFormation validate-template only.
  --keep-stacks        Leave local Kumo stacks in the emulator state.

Examples:
  bun run kumo:up
  bun run validate:kumo -- battles/stackstack
  bun run validate:kumo -- --template-only
`);
}

function readOption(name: string): string | undefined {
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${name} requires a value`);
  }
  return value;
}

function optionValueIndexes(): Set<number> {
  const indexes = new Set<number>();
  for (const option of ["--endpoint", "--region", "--cloudformation-host"]) {
    const index = args.indexOf(option);
    if (index >= 0) indexes.add(index + 1);
  }
  return indexes;
}

function assertLocalEndpoint(value: string): void {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`Kumo endpoint is not a valid URL: ${value}`);
  }
  const localHosts = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
  if (!localHosts.has(url.hostname)) {
    throw new Error(
      `Refusing non-local Kumo endpoint "${value}". This evaluator is local-only by design.`,
    );
  }
  if (url.protocol !== "http:") {
    throw new Error(`Kumo endpoint must use http://, got ${value}`);
  }
}

function assertLocalCloudFormationHost(value: string): void {
  const localSuffixes = [
    "localhost",
    "127.0.0.1",
    "cloudformation.localhost",
    "cloudformation.amazonaws.com",
    "cloudformation.us-east-1.amazonaws.com",
  ];
  if (!localSuffixes.includes(value)) {
    throw new Error(`Refusing non-local Kumo CloudFormation host "${value}"`);
  }
}

function resolveProblems(targets: string[]): Problem[] {
  const metadataFiles = findMetadataFiles(REPO_ROOT);
  const allProblems = metadataFiles.map(readProblem);
  if (targets.length === 0) return allProblems;

  const selected: Problem[] = [];
  for (const target of targets) {
    const normalized = resolve(REPO_ROOT, target);
    const match = allProblems.find(
      (problem) =>
        problem.id === target ||
        problem.dir === normalized ||
        problem.metadataPath === normalized ||
        problem.templatePath === normalized,
    );
    if (!match) {
      throw new Error(`Unknown problem target: ${target}`);
    }
    selected.push(match);
  }
  return selected;
}

function findMetadataFiles(root: string): string[] {
  const found: string[] = [];
  for (const category of CATEGORY_DIRS) {
    const categoryDir = join(root, category);
    if (!existsSync(categoryDir)) continue;
    collectMetadata(categoryDir, found);
  }
  return found.sort();
}

function collectMetadata(dir: string, found: string[]): void {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (entry === "node_modules" || entry === ".git") continue;
    if (statSync(full).isDirectory()) {
      collectMetadata(full, found);
    } else if (entry === "metadata.json") {
      found.push(full);
    }
  }
}

function readProblem(metadataPath: string): Problem {
  const meta = JSON.parse(readFileSync(metadataPath, "utf8")) as Metadata;
  const id = typeof meta.id === "string" ? meta.id : dirname(metadataPath).split("/").at(-1);
  if (!id) throw new Error(`metadata id missing: ${metadataPath}`);
  const dir = dirname(metadataPath);
  const templateName = typeof meta.cfnTemplate === "string" ? meta.cfnTemplate : "template.yaml";
  const templatePath = resolve(dir, templateName);
  if (!existsSync(templatePath)) {
    throw new Error(`template not found for ${id}: ${templatePath}`);
  }
  return {
    id,
    dir,
    metadataPath,
    templatePath,
    parameters: buildParameters(id, meta),
  };
}

function buildParameters(id: string, meta: Metadata): Record<string, string> {
  const prefix = localNamePrefix(id);
  const params: Record<string, string> = {
    NamePrefix: prefix,
    TenkaCloudAccountId: "000000000000",
    ExternalId: `${prefix}-external-id`,
  };

  if (meta.cfnParameters && typeof meta.cfnParameters === "object") {
    for (const [key, value] of Object.entries(meta.cfnParameters as Record<string, unknown>)) {
      params[key] =
        value === RANDOM_PASSWORD_SENTINEL
          ? DETERMINISTIC_PASSWORD
          : String(value);
    }
  }
  return params;
}

function cloudFormationJsonTemplate(templatePath: string): string {
  const source = readFileSync(templatePath, "utf8");
  const doc = parseDocument(source, {
    customTags: [
      { tag: "!Ref", resolve: (value: string) => ({ Ref: value }) },
      { tag: "!Sub", resolve: (value: string) => ({ "Fn::Sub": value }) },
      {
        tag: "!GetAtt",
        resolve: (value: string) => ({ "Fn::GetAtt": String(value).split(".") }),
      },
      { tag: "!GetAZs", resolve: (value: string) => ({ "Fn::GetAZs": value }) },
      {
        tag: "!Select",
        collection: "seq",
        resolve: (value: { items: Array<{ toJSON: () => unknown }> }) => ({
          "Fn::Select": value.items.map((item) => item.toJSON()),
        }),
      },
    ],
  });
  if (doc.errors.length > 0) {
    throw new Error(doc.errors.map((error) => error.message).join("; "));
  }
  return JSON.stringify(doc.toJSON());
}

function localNamePrefix(id: string): string {
  const prefix = `tc-${id}-kumo`.toLowerCase().replace(/[^a-z0-9-]/g, "-");
  if (prefix.length <= 44) return prefix;
  return `tc-${id.slice(0, 31)}-kumo`.replace(/-+$/g, "");
}

function localStackName(id: string): string {
  return localNamePrefix(id);
}

async function cloudFormation(action: string, params: Record<string, string>): Promise<string> {
  const body = new URLSearchParams({
    Action: action,
    Version: "2010-05-15",
    ...params,
  }).toString();
  const response = await postQuery(body);
  if (response.statusCode < 200 || response.statusCode >= 300) {
    const text = response.body;
    throw new Error(`${action} failed: ${extractXmlMessage(text) ?? text}`);
  }
  return response.body;
}

function postQuery(body: string): Promise<{ statusCode: number; body: string }> {
  const result = spawnSync("curl", [
    "-sS",
    "-i",
    "-X",
    "POST",
    endpoint,
    "-H",
    `Host: ${cloudFormationHost}`,
    "-d",
    "@-",
  ], {
    input: body,
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 16,
  });
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || "curl failed");
  }
  const raw = result.stdout;
  const splitAt = raw.indexOf("\r\n\r\n");
  if (splitAt === -1) {
    throw new Error(`invalid Kumo response: ${raw}`);
  }
  const headers = raw.slice(0, splitAt);
  const responseBody = raw.slice(splitAt + 4);
  const statusMatch = headers.match(/^HTTP\/\d(?:\.\d)?\s+(\d+)/);
  return Promise.resolve({
    statusCode: statusMatch ? Number(statusMatch[1]) : 0,
    body: responseBody,
  });
}

function parameterMembers(parameters: Record<string, string>): Record<string, string> {
  const result: Record<string, string> = {};
  let index = 1;
  for (const [key, value] of Object.entries(parameters)) {
    result[`Parameters.member.${index}.ParameterKey`] = key;
    result[`Parameters.member.${index}.ParameterValue`] = value;
    index += 1;
  }
  return result;
}

async function waitForCreateComplete(stackName: string): Promise<void> {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const status = await describeStackStatus(stackName);
    if (status === "CREATE_COMPLETE") return;
    if (status.includes("FAILED") || status.includes("ROLLBACK")) {
      throw new Error(`local stack ${stackName} ended in ${status}`);
    }
    Bun.sleepSync(1000);
  }
  throw new Error(`timed out waiting for local stack ${stackName}`);
}

async function describeStackStatus(stackName: string): Promise<string> {
  const xml = await cloudFormation("DescribeStacks", { StackName: stackName });
  return extractXmlTag(xml, "StackStatus") ?? "";
}

async function cleanupLocalStack(stackName: string, logSuccess: boolean): Promise<void> {
  try {
    await cloudFormation("DeleteStack", { StackName: stackName });
  } catch {
    return;
  }
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    let status = "";
    try {
      status = await describeStackStatus(stackName);
    } catch {
      if (logSuccess) console.log("  OK cleanup local stack");
      return;
    }
    if (status === "DELETE_COMPLETE") {
      if (logSuccess) console.log("  OK cleanup local stack");
      return;
    }
    Bun.sleepSync(1000);
  }
}

function extractXmlTag(xml: string, tag: string): string | undefined {
  const match = xml.match(new RegExp(`<${tag}>([^<]+)</${tag}>`));
  return match?.[1];
}

function extractXmlMessage(xml: string): string | undefined {
  return extractXmlTag(xml, "Message");
}
