import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "bun:test";

// `.pathname` leaves a URL-encoded path, so a checkout under a directory with a
// space or a non-ASCII character resolves to a directory that does not exist and
// the scan silently finds nothing. The rest of this suite already uses
// `fileURLToPath` for that reason.
const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
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

  // Issue #320 lists TerminateSession/ResumeSession as part of the documented
  // end-user policy, and the case below is named for supporting session
  // cleanup -- but nothing here checked that those actions exist. Deleting the
  // whole TerminateOwnSession statement left this green, so a participant would
  // be denied on exit and the guard would say the policy was fine.
  for (const action of ["ssm:TerminateSession", "ssm:ResumeSession"]) {
    if (!source.includes(action)) {
      violations.push({ path: displayPath, rule: `missing ${action}` });
    }
  }

  // Instance scoping is an acceptance criterion of #320 ("instance scoping ...
  // remain intact") and the one regression here that widens blast radius rather
  // than breaking a participant: `Resource: "*"` on StartSession lets a caller
  // open a shell on any instance in the account. Rewriting the resource list to
  // `"*"` also left this green.
  if (!/-\s+ssm:StartSession\s*\n\s+Resource:\s*\n(?:\s+-\s+.*\n)*?\s+-\s+!Sub\s+"arn:aws:ec2:[^"]*instance\/\$\{[A-Za-z0-9]+\}"/.test(source)) {
    violations.push({ path: displayPath, rule: "StartSession is not scoped to this problem's instance" });
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
