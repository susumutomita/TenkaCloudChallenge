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
mkdirSync(starterDirectory);
mkdirSync(referenceDirectory);
writeFileSync(join(starterDirectory, "policies.sql"), "-- intentionally vulnerable starter\n");
writeFileSync(
  join(referenceDirectory, "policies.sql"),
  readFileSync(join(LOCAL_DIR, "reference/policies.sql"), "utf8"),
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

async function verdict(): Promise<{ correct?: boolean; message?: string }> {
  const response = await fetch(`http://127.0.0.1:${verifyPort}/verify`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  if (!response.ok) throw new Error(`/verify returned HTTP ${response.status}`);
  return (await response.json()) as { correct?: boolean; message?: string };
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
  console.log(`reference verdict: correct=true (${positive.message ?? "no message"})`);
} finally {
  cleanup();
  rmSync(temporary, { recursive: true, force: true });
}

assertNoProjectResources();
console.log("rls-tenant-isolation runtime proof passed and cleaned all project resources");
