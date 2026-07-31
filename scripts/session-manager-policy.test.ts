import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "bun:test";

const REPO_ROOT = new URL("..", import.meta.url).pathname;
const TEMPLATE_ROOTS = ["battles", "challenges"];

function templateFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return templateFiles(path);
    return entry === "template.yaml" ? [path] : [];
  });
}

interface Violation {
  readonly path: string;
  readonly rule: string;
}

function sessionPolicyViolations(path: string): Violation[] {
  const source = readFileSync(path, "utf8");
  if (!source.includes("ssm:StartSession")) return [];

  const displayPath = relative(REPO_ROOT, path);
  const violations: Violation[] = [];

  if (!source.includes("ssmmessages:OpenDataChannel")) {
    violations.push({ path: displayPath, rule: "missing ssmmessages:OpenDataChannel" });
  }

  // The CloudFormation substitution must escape the IAM policy variable. Without
  // `!`, Fn::Sub tries to resolve `aws:userid` as a template variable instead of
  // leaving it for IAM to evaluate at authorization time.
  if (!source.includes('session/${!aws:userid}-*"')) {
    violations.push({ path: displayPath, rule: "data channel is not caller-session scoped" });
  }

  if (!/ssm:resourceTag\/aws:ssmmessages:session-id:\s*\n\s+- "\$\{aws:userid\}\*"/.test(source)) {
    violations.push({ path: displayPath, rule: "session ownership is not suffix-safe" });
  }

  if (/ssm:resourceTag\/aws:ssmmessages:session-id:\s*\n\s+- "\$\{aws:userid\}"\s*(?:\n|$)/.test(source)) {
    violations.push({ path: displayPath, rule: "exact aws:userid match rejects generated session suffixes" });
  }

  return violations;
}

describe("participant Session Manager policies", () => {
  const templates = TEMPLATE_ROOTS.flatMap((dir) => templateFiles(join(REPO_ROOT, dir)));
  const sessionTemplates = templates.filter((path) =>
    readFileSync(path, "utf8").includes("ssm:StartSession"),
  );

  it("discovers at least one StartSession template, so the guard cannot pass vacuously", () => {
    expect(sessionTemplates.length).toBeGreaterThan(0);
  });

  it("opens only the caller-owned data channel and supports caller-owned session cleanup", () => {
    expect(sessionTemplates.flatMap(sessionPolicyViolations)).toEqual([]);
  });
});
