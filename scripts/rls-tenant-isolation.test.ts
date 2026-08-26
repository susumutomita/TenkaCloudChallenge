import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import {
  RLS_REGRESSION_TARGETS,
  assertRlsComposeContract,
  assertRlsDockerfileContract,
  assertRlsSchemaOrder,
  requireRlsRegressionTargets,
} from "./lib/rls-tenant-isolation";

const REPO_ROOT = new URL("..", import.meta.url).pathname;
const targets = Object.values(RLS_REGRESSION_TARGETS);
const read = (relative: string) => readFileSync(join(REPO_ROOT, relative), "utf8");

describe("rls-tenant-isolation startup regression contract", () => {
  it("rejects an empty target set instead of passing vacuously", () => {
    expect(() => requireRlsRegressionTargets([])).toThrow("target set is empty");
    expect(() => requireRlsRegressionTargets(targets)).not.toThrow();
  });

  it("keeps initdb unprivileged and author artifacts out of the participant image", () => {
    expect(() => assertRlsDockerfileContract(read(RLS_REGRESSION_TARGETS.dockerfile))).not.toThrow();
  });

  it("detects the regression that removes USER postgres", () => {
    const mutated = read(RLS_REGRESSION_TARGETS.dockerfile).replace(/^USER postgres$/m, "");
    expect(() => assertRlsDockerfileContract(mutated)).toThrow("USER postgres");
  });

  it("declares membership-reading helpers after public.memberships", () => {
    expect(() => assertRlsSchemaOrder(read(RLS_REGRESSION_TARGETS.schema))).not.toThrow();
  });

  it("detects the regression that moves a membership helper before the table", () => {
    const schema = read(RLS_REGRESSION_TARGETS.schema);
    const start = schema.indexOf("create or replace function app.current_org_ids");
    const end = schema.indexOf("-- True when the current user is an OWNER", start);
    const table = schema.indexOf("create table if not exists public.memberships");
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    expect(table).toBeGreaterThan(-1);
    const helper = schema.slice(start, end);
    const withoutHelper = `${schema.slice(0, start)}${schema.slice(end)}`;
    const mutated = `${withoutHelper.slice(0, table)}${helper}\n${withoutHelper.slice(table)}`;
    expect(() => assertRlsSchemaOrder(mutated)).toThrow("after public.memberships");
  });

  it("routes compose through the participant stage and injectable test endpoints", () => {
    expect(() => assertRlsComposeContract(read(RLS_REGRESSION_TARGETS.compose))).not.toThrow();
  });
});

describe("rls-tenant-isolation Docker proof is a required CI job", () => {
  const workflow = read(".github/workflows/ci.yml");

  it("runs the clean runtime verifier", () => {
    expect(workflow).toContain("rls-runtime:");
    expect(workflow).toContain("run: bun run rls:runtime");
  });

  it("gates the stable validate check on the runtime proof", () => {
    // Assert this job's own dependency, not the whole list. Pinning every job name
    // here made adding one unrelated job fail four unrelated suites, and the
    // exhaustive "every job is listed and gated" check lives in
    // scripts/validate-shard.test.ts, which reads the list out of the workflow.
    expect(/needs:\s*\[([^\]]+)\]/.exec(workflow)?.[1]?.split(",").map((job) => job.trim())).toContain(
      "rls-runtime",
    );
    // `validate` no longer asserts this job with an inline expression: the runtime jobs
    // are now skipped when the diff cannot reach them, so the aggregation reads each
    // result from an environment binding and decides in a list. Require both halves --
    // the binding, and the name actually reaching the verdict -- because either one
    // alone can be present while the job goes ungated.
    expect(workflow).toContain("RLS: ${{ needs.rls-runtime.result }}");
    expect(workflow).toContain('"rls-runtime:$RLS"');
  });
});
