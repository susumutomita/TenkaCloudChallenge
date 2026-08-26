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
  // The runtime proof used to be an unconditional job inside ci.yml, gated
  // through the `validate` aggregate. It now lives in its own path-filtered
  // workflow (the mcp-origin-guardian-runtime.yml shape) so an unrelated PR
  // does not boot this Postgres RLS Docker Compose lab.
  const ciWorkflow = read(".github/workflows/ci.yml");
  const workflow = read(".github/workflows/rls-tenant-isolation-runtime.yml");

  it("runs the clean runtime verifier", () => {
    expect(workflow).toContain("rls-runtime:");
    expect(workflow).toContain("run: bun run rls:runtime");
  });

  it("moved out of the shared ci.yml aggregate instead of being duplicated into it", () => {
    // Leaving the job in both places would silently reintroduce the double-run
    // cost this split exists to remove.
    expect(ciWorkflow).not.toContain("rls-runtime:");
  });

  it("only runs when this problem, its verifier, or the workflow itself change", () => {
    // A path filter narrower than what the proof depends on lets a real
    // regression merge unchecked, which is worse than no filter at all.
    expect(workflow).toContain("challenges/rls-tenant-isolation/**");
    expect(workflow).toContain("scripts/verify-rls-tenant-isolation.ts");
    expect(workflow).toContain(".github/workflows/rls-tenant-isolation-runtime.yml");
  });

  it("scopes push to main and cancels a superseded run", () => {
    expect(workflow).toMatch(/push:\s*\n\s*branches:\s*\n\s*-\s*main/);
    expect(workflow).toContain("concurrency:");
    expect(workflow).toMatch(/cancel-in-progress:\s*true/);
  });
});
