#!/usr/bin/env bun

import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
const LOCAL_DIR = join(REPO_ROOT, "challenges/rls-tenant-isolation/local");
const SERVICE = "rls-tenant-isolation";
const project = `tcc-rls-${process.pid}`;
// Keep the bind source under Docker's already-shared build context. Docker
// Desktop may accept a /private/tmp mount while exposing an empty directory.
const temporary = mkdtempSync(join(LOCAL_DIR, ".rls-runtime-"));
const starterDirectory = join(temporary, "starter");
const referenceDirectory = join(temporary, "reference");
const unpinnedUpdateDirectory = join(temporary, "unpinned-update");
mkdirSync(starterDirectory);
mkdirSync(referenceDirectory);
mkdirSync(unpinnedUpdateDirectory);
writeFileSync(join(starterDirectory, "policies.sql"), "-- intentionally vulnerable starter\n");
writeFileSync(
  join(referenceDirectory, "policies.sql"),
  readFileSync(join(LOCAL_DIR, "reference/policies.sql"), "utf8"),
);

// Issue #542: a WRONG answer that the 7-assertion grader scored as fully
// correct. SELECT is scoped to "my org's documents, plus documents I created"
// and UPDATE carries a WITH CHECK that forgot to pin organization_id — so the
// caller can hand one of their own rows to the other tenant, and because the
// moved row is still visible to its creator, nothing else in the policy set
// stops it. Every other assertion passes on this policy set, which is what makes
// it the regression fixture for the 8th.
writeFileSync(
  join(unpinnedUpdateDirectory, "policies.sql"),
  `-- Issue #542 regression fixture: NOT a reference answer. Deliberately leaves
-- organization_id reassignable on UPDATE while satisfying every other rule.
alter table public.documents enable row level security;
alter table public.documents force row level security;

create policy documents_select_own_or_authored on public.documents
  for select
  using (
    app.is_authenticated()
    and (
      organization_id in (select app.current_org_ids())
      or created_by = app.current_user_id()
    )
  );

create policy documents_insert_own_org on public.documents
  for insert
  with check (
    app.is_authenticated()
    and organization_id in (select app.current_org_ids())
  );

-- The gap: WITH CHECK is present but does not constrain organization_id.
create policy documents_update_unpinned on public.documents
  for update
  using (
    app.is_authenticated()
    and organization_id in (select app.current_org_ids())
  )
  with check (app.is_authenticated());

create policy documents_delete_owner_only on public.documents
  for delete
  using (
    app.is_authenticated()
    and app.is_owner_of(organization_id)
  );
`,
);

async function availablePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        server.close();
        reject(new Error("could not allocate a loopback port"));
        return;
      }
      server.close((error) => (error === undefined ? resolve(address.port) : reject(error)));
    });
  });
}

const appPort = await availablePort();
let verifyPort = await availablePort();
while (verifyPort === appPort) verifyPort = await availablePort();
const environment = {
  ...process.env,
  RLS_APP_PORT: String(appPort),
  RLS_VERIFY_PORT: String(verifyPort),
  RLS_SOLUTION_DIR: starterDirectory,
};

function run(command: string, args: string[], capture = false): string {
  console.log(`+ ${command} ${args.join(" ")}`);
  const result = spawnSync(command, args, {
    cwd: LOCAL_DIR,
    env: environment,
    encoding: "utf8",
    stdio: capture ? "pipe" : "inherit",
  });
  if (result.status !== 0) {
    const detail = capture ? `\n${result.stdout ?? ""}${result.stderr ?? ""}` : "";
    throw new Error(`${command} exited with ${result.status ?? "no status"}${detail}`);
  }
  return capture ? String(result.stdout ?? "").trim() : "";
}

function compose(args: string[], capture = false): string {
  return run("docker", ["compose", "-p", project, ...args], capture);
}

function cleanup(): void {
  const result = spawnSync(
    "docker",
    ["compose", "-p", project, "down", "--volumes", "--remove-orphans", "--rmi", "local"],
    { cwd: LOCAL_DIR, env: environment, encoding: "utf8", stdio: "inherit" },
  );
  if (result.status !== 0) console.warn(`cleanup exited with ${result.status ?? "no status"}`);
}

async function waitForHealth(): Promise<void> {
  const deadline = Date.now() + 90_000;
  let last = "no response";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${appPort}/healthz`);
      if (response.ok) return;
      last = `HTTP ${response.status}`;
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
    }
    await Bun.sleep(1_000);
  }
  throw new Error(`RLS app did not become healthy: ${last}`);
}

type Verdict = {
  correct?: boolean;
  message?: string;
  results?: { id: string; passed: boolean }[];
};

async function verdict(): Promise<Verdict> {
  const response = await fetch(`http://127.0.0.1:${verifyPort}/verify`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  if (!response.ok) throw new Error(`/verify returned HTTP ${response.status}`);
  return (await response.json()) as Verdict;
}

function assertNoProjectResources(): void {
  const filter = `label=com.docker.compose.project=${project}`;
  for (const [noun, args] of [
    ["containers", ["ps", "-aq", "--filter", filter]],
    ["networks", ["network", "ls", "-q", "--filter", filter]],
    ["volumes", ["volume", "ls", "-q", "--filter", filter]],
  ] as const) {
    const remaining = run("docker", [...args], true);
    if (remaining !== "") throw new Error(`cleanup left ${noun}: ${remaining}`);
  }
}

try {
  compose(["build", "--no-cache"]);

  const image = `${project}-${SERVICE}:latest`;
  run("docker", ["image", "inspect", image], true);
  run("docker", ["run", "--rm", "--entrypoint", "sh", image, "-c", "test ! -e /app/reference"]);

  compose(["up", "-d", "--no-build"]);
  await waitForHealth();
  const negative = await verdict();
  if (negative.correct !== false) {
    throw new Error(`starter unexpectedly passed: ${JSON.stringify(negative)}`);
  }
  console.log(`starter verdict: correct=false (${negative.message ?? "no message"})`);
  compose(["down", "--volumes", "--remove-orphans"]);

  // Issue #542 regression: a policy set that leaves organization_id reassignable
  // on UPDATE must be rejected, and rejected on exactly that assertion — it
  // satisfies every other rule, so any other failure means the fixture drifted.
  environment.RLS_SOLUTION_DIR = unpinnedUpdateDirectory;
  compose(["up", "-d", "--no-build"]);
  await waitForHealth();
  const unpinned = await verdict();
  const unpinnedFailures = (unpinned.results ?? []).filter((r) => !r.passed).map((r) => r.id);
  if (unpinned.correct !== false) {
    throw new Error(`reassignable organization_id unexpectedly passed: ${JSON.stringify(unpinned)}`);
  }
  if (unpinnedFailures.length !== 1 || unpinnedFailures[0] !== "a-owner-cannot-move-doc-to-b") {
    throw new Error(
      `reassignable organization_id failed the wrong assertions: ${JSON.stringify(unpinnedFailures)}`,
    );
  }
  console.log("unpinned-UPDATE verdict: correct=false, failing only a-owner-cannot-move-doc-to-b");
  compose(["down", "--volumes", "--remove-orphans"]);

  environment.RLS_SOLUTION_DIR = referenceDirectory;
  compose(["up", "-d", "--no-build"]);
  await waitForHealth();
  compose([
    "exec",
    "-T",
    SERVICE,
    "sh",
    "-c",
    "grep -q 'alter table public.documents enable row level security' /app/solution/policies.sql",
  ]);
  const positive = await verdict();
  if (positive.correct !== true) {
    throw new Error(`reference solution failed: ${JSON.stringify(positive)}`);
  }
  if (!(positive.results ?? []).some((r) => r.id === "a-owner-cannot-move-doc-to-b" && r.passed)) {
    throw new Error(
      `reference verdict did not report a passing a-owner-cannot-move-doc-to-b: ${JSON.stringify(positive.results)}`,
    );
  }
  console.log(`reference verdict: correct=true (${positive.message ?? "no message"})`);
} finally {
  cleanup();
  rmSync(temporary, { recursive: true, force: true });
}

assertNoProjectResources();
console.log("rls-tenant-isolation runtime proof passed and cleaned all project resources");
