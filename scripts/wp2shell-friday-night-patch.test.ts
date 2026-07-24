import { describe, expect, it } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * wp2shell-friday-night-patch is the AWS half of the training pair with
 * wp2shell-local-lab. Its 7 flags are all `multi-flag` (kind=multi-flag), which
 * -- unlike the container-only `multi-verify` kind -- has NO automated
 * `flagOutputKey` -> `Outputs:` cross-reference check in
 * scripts/validate-problems.ts today (checkScoringOutputRefs only handles
 * kind="flag" and "attack-detection"). This file closes that specific gap for
 * this problem so a future edit that renames/removes an Output, or changes the
 * flag string the embedded Lambda computes, fails the build instead of
 * silently breaking scoring at deploy time.
 */

const ROOT = join(import.meta.dir, "..", "challenges", "wp2shell-friday-night-patch");

function read(relativePath: string): string {
  return readFileSync(join(ROOT, relativePath), "utf8");
}

function metadata() {
  return JSON.parse(read("metadata.json")) as {
    cfnTemplate: string;
    scoring: {
      kind: string;
      flags: Array<{ id: string; label: string; flagOutputKey: string; points: number }>;
    };
  };
}

/** Extracts the Lambda's inline Python source from the CFn `Code: ZipFile: |` block. */
function extractLambdaSource(template: string): string {
  const match = template.match(/ {6}Code:\n {8}ZipFile: \|\n((?: {10}.*\n|\n)+)/);
  if (!match) throw new Error("could not locate the Lambda ZipFile block in template.yaml");
  return match[1]
    .split("\n")
    .map((line) => (line.startsWith(" ".repeat(10)) ? line.slice(10) : line))
    .join("\n");
}

describe("wp2shell-friday-night-patch catalog contract", () => {
  it("should ship every required artifact", () => {
    for (const file of ["metadata.json", "README.md", "README.ja.md", "diagram.svg", "template.yaml"]) {
      expect(existsSync(join(ROOT, file)), `missing ${file}`).toBe(true);
    }
  });

  it("should declare a cfnTemplate (no local/container runtime)", () => {
    const value = metadata();
    expect(value.cfnTemplate).toBe("template.yaml");
  });

  it("should declare exactly the 7 multi-flag checkpoints the issue asked for, summing to the Hard tier (300 pts)", () => {
    const value = metadata();
    expect(value.scoring.kind).toBe("multi-flag");
    const ids = value.scoring.flags.map((f) => f.id);
    expect(ids).toEqual([
      "timeline-iocs",
      "waf-containment",
      "patched-workload",
      "persistence-removal",
      "credential-rotation",
      "evidence-preservation",
      "uptime-and-legit-traffic",
    ]);
    const total = value.scoring.flags.reduce((sum, f) => sum + f.points, 0);
    expect(total).toBe(300);
  });

  it("should point every flagOutputKey at a real Outputs: entry in template.yaml (multi-flag has no built-in cross-ref check)", () => {
    const template = read("template.yaml");
    const value = metadata();
    for (const flag of value.scoring.flags) {
      expect(
        template,
        `flagOutputKey "${flag.flagOutputKey}" (flag "${flag.id}") must exist as an Outputs: key`,
      ).toMatch(new RegExp(`^  ${flag.flagOutputKey}:`, "m"));
    }
  });

  it("should derive every Output flag value with the exact same formula the embedded Lambda uses (TC{<id>-${FlagSeed}})", () => {
    const template = read("template.yaml");
    const value = metadata();
    for (const flag of value.scoring.flags) {
      if (flag.id === "timeline-iocs") continue; // discovery flag, checked separately below
      const outputBlock = new RegExp(`${flag.flagOutputKey}:\\n(?:.*\\n)*? {4}Value: (.*)`).exec(
        template,
      );
      expect(outputBlock, `could not find Value: for ${flag.flagOutputKey}`).not.toBeNull();
      expect(outputBlock?.[1]).toBe(`!Sub "TC{${flag.id}-\${FlagSeed}}"`);
    }
  });

  it("should implement a grade() dispatch entry for every non-discovery flag id in the Lambda source", () => {
    const lambdaSource = extractLambdaSource(read("template.yaml"));
    const value = metadata();
    for (const flag of value.scoring.flags) {
      if (flag.id === "timeline-iocs") continue; // discovery-only, no grade() entry needed
      expect(
        lambdaSource,
        `Lambda CHECKS table must dispatch "${flag.id}"`,
      ).toContain(`"${flag.id}":`);
    }
  });

  it("should never derive a flag with a hash CloudFormation cannot reproduce in !Sub", () => {
    // Regression guard for the bug this problem's Lambda originally shipped
    // with: flag_for() used sha256(...) which a CFn Outputs: Value: cannot
    // reproduce with plain string interpolation. flag_for must stay a pure
    // string join of FLAG_SEED, matching every Output's `!Sub "TC{...}"`.
    const lambdaSource = extractLambdaSource(read("template.yaml"));
    const flagForBody = /def flag_for\(check_id\):\n((?: {4}.*\n?)+)/.exec(lambdaSource)?.[1] ?? "";
    expect(flagForBody).not.toMatch(/sha256/i);
    expect(flagForBody).toContain('"TC{%s-%s}" % (check_id, FLAG_SEED)');
  });

  it("should compare check_persistence_removal's theme baseline against a constant, not an unset SSM parameter", () => {
    // Regression guard: an earlier draft read a non-existent
    // /<prefix>/site/theme-functions-baseline parameter and could never pass.
    const lambdaSource = extractLambdaSource(read("template.yaml"));
    expect(lambdaSource).not.toContain("theme-functions-baseline");
    expect(lambdaSource).toContain("THEME_FUNCTIONS_BASELINE");
  });

  it("should keep the ThemeFunctionsBaseline Output byte-for-byte identical to the Lambda's constant", () => {
    const template = read("template.yaml");
    const lambdaSource = extractLambdaSource(template);
    const constant = /THEME_FUNCTIONS_BASELINE = "([^"]*)"/.exec(lambdaSource)?.[1];
    expect(constant, "could not find THEME_FUNCTIONS_BASELINE in the Lambda source").toBeDefined();
    expect(template).toContain(`Value: "${constant}"`);
  });

  it("should grant the participant role least-privilege WAF access (no wafv2 wildcard, scoped to this stack's own WebACL)", () => {
    const template = read("template.yaml");
    expect(template).toContain("wafv2:GetWebACL");
    expect(template).toContain("wafv2:UpdateWebACL");
    expect(template).toContain("Resource: !GetAtt WafWebAcl.Arn");
    // Never grant these on the wildcard scope this problem does not need
    // (unlike waf-classic-kuyo, this WebACL's ARN is known at author time).
    expect(template).not.toMatch(/wafv2:\*/);
  });

  it("should never grant cloudformation:DescribeStacks or lambda:GetFunction* to the participant role", () => {
    // Matches an actual YAML list-item grant (`- cloudformation:DescribeStacks`),
    // not the explanatory comment that documents its deliberate absence.
    const template = read("template.yaml");
    expect(template).not.toMatch(/^\s*-\s*cloudformation:DescribeStacks\s*$/m);
    expect(template).not.toMatch(/^\s*-\s*lambda:GetFunction/m);
  });

  it("should scope the API Gateway to REGIONAL (required for a WAFv2 REGIONAL WebACL association)", () => {
    const template = read("template.yaml");
    expect(template).toMatch(/EndpointConfiguration:\s*\n\s*Types:\s*\n\s*-\s*REGIONAL/);
    expect(template).toContain("Scope: REGIONAL");
  });

  it("should tag every per-team resource with TenkaCloud:NamePrefix", () => {
    const template = read("template.yaml");
    // checkResourceTagging (validate-problems.ts) only enforces this for EC2
    // types; this problem has none, so assert it by hand for every taggable
    // resource type it does declare.
    for (const marker of [
      "Type: AWS::S3::Bucket",
      "Type: AWS::Lambda::Function",
      "Type: AWS::WAFv2::WebACL",
    ]) {
      expect(template).toContain(marker);
    }
    expect(template.match(/Key: TenkaCloud:NamePrefix/g)?.length ?? 0).toBeGreaterThanOrEqual(6);
  });
});
