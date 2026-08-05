#!/usr/bin/env bun

import { spawnSync } from "node:child_process";
import { createServer } from "node:net";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
// @ts-expect-error The container runtime is intentionally plain JavaScript.
import { inspectStarter, STARTER_POLICY } from "../challenges/github-oidc-trust-boundary/local/app/engine.mjs";
// @ts-expect-error The hidden verifier is intentionally plain JavaScript.
import { CHECKPOINT_IDS } from "../challenges/github-oidc-trust-boundary/local/verifier/grader.mjs";
// @ts-expect-error The author-only reference is intentionally plain JavaScript.
import { REFERENCE_POLICY } from "../challenges/github-oidc-trust-boundary/local/verifier/reference.mjs";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
const LOCAL_DIR = join(REPO_ROOT, "challenges/github-oidc-trust-boundary/local");
const project = `tcc-github-oidc-${process.pid}`;
const participantImage = `${project}-participant:local`;
const verifierImage = `${project}-verifier:local`;

async function portPair(): Promise<[number, number]> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const first = await new Promise<number>((resolve, reject) => {
      const server = createServer();
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        const address = server.address();
        if (address === null || typeof address === "string") {
          server.close();
          reject(new Error("could not allocate a loopback port"));
          return;
        }
        server.close(() => resolve(address.port));
      });
    });
    if (first >= 65_535) continue;
    const probe = createServer();
    const secondFree = await new Promise<boolean>((resolve) => {
      probe.once("error", () => resolve(false));
      probe.listen(first + 1, "127.0.0.1", () => probe.close(() => resolve(true)));
    });
    if (secondFree) return [first, first + 1];
  }
  throw new Error("could not allocate adjacent loopback ports");
}

const [workbenchPort, verifyPort] = await portPair();
const environment = {
  ...process.env,
  GITHUB_OIDC_WORKBENCH_PORT: String(workbenchPort),
  GITHUB_OIDC_VERIFY_PORT: String(verifyPort),
  GITHUB_OIDC_PARTICIPANT_IMAGE: participantImage,
  GITHUB_OIDC_VERIFIER_IMAGE: verifierImage,
};

function run(command: string, args: string[], capture = false, allowFailure = false) {
  console.log(`+ ${command} ${args.join(" ")}`);
  const result = spawnSync(command, args, {
    cwd: LOCAL_DIR,
    env: environment,
    encoding: "utf8",
    stdio: capture ? "pipe" : "inherit",
  });
  if (!allowFailure && result.status !== 0) {
    const detail = capture ? `\n${result.stdout ?? ""}${result.stderr ?? ""}` : "";
    throw new Error(`${command} exited with ${result.status ?? "no status"}${detail}`);
  }
  return result;
}

function compose(args: string[], capture = false, allowFailure = false) {
  return run("docker", ["compose", "-p", project, ...args], capture, allowFailure);
}

function cleanup(): void {
  compose(["down", "--volumes", "--remove-orphans"], false, true);
  run("docker", ["image", "rm", participantImage, verifierImage], false, true);
}

async function waitFor(url: string): Promise<void> {
  const deadline = Date.now() + 90_000;
  let last = "no response";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
      last = `HTTP ${response.status}`;
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
    }
    await Bun.sleep(1_000);
  }
  throw new Error(`${url} did not become healthy: ${last}`);
}

async function post(path: string, body: unknown, browserRequest = false) {
  const response = await fetch(`http://127.0.0.1:${verifyPort}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(browserRequest ? { origin: `http://127.0.0.1:${workbenchPort}` } : {}),
    },
    body: JSON.stringify(body),
  });
  const value = (await response.json()) as Record<string, unknown>;
  return { status: response.status, value };
}

function assertNoProjectResources(): void {
  const filter = `label=com.docker.compose.project=${project}`;
  for (const [noun, args] of [
    ["containers", ["ps", "-aq", "--filter", filter]],
    ["networks", ["network", "ls", "-q", "--filter", filter]],
    ["volumes", ["volume", "ls", "-q", "--filter", filter]],
  ] as const) {
    const result = run("docker", [...args], true);
    if (String(result.stdout).trim() !== "") throw new Error(`cleanup left ${noun}: ${String(result.stdout).trim()}`);
  }
  for (const image of [participantImage, verifierImage]) {
    const result = run("docker", ["image", "inspect", image], true, true);
    if (result.status === 0) throw new Error(`cleanup left image ${image}`);
  }
}

const noEgressProbe = [
  "const net=require('node:net')",
  "const socket=net.connect({host:'1.1.1.1',port:443})",
  "socket.once('connect',()=>process.exit(2))",
  "socket.once('error',(error)=>process.exit(error.code==='EPERM'?0:3))",
  "setTimeout(()=>process.exit(4),3000)",
].join(";");

try {
  compose(["build", "--no-cache"]);
  run("docker", ["image", "inspect", participantImage], true);
  run("docker", ["image", "inspect", verifierImage], true);
  run("docker", [
    "run",
    "--rm",
    "--entrypoint",
    "sh",
    participantImage,
    "-c",
    "test ! -e /app/verifier && test ! -e /app/reference && test ! -e /app/mutation.mjs",
  ]);

  compose(["up", "-d", "--no-build"]);
  await Promise.all([
    waitFor(`http://127.0.0.1:${workbenchPort}/healthz`),
    waitFor(`http://127.0.0.1:${verifyPort}/healthz`),
  ]);

  const home = await fetch(`http://127.0.0.1:${workbenchPort}/`).then((response) => response.text());
  if (!home.includes("そのトークンは、どのworkflowのもの？")) throw new Error("Browser Workbench did not render");
  const observation = (await fetch(`http://127.0.0.1:${workbenchPort}/api/inspect`).then((response) =>
    response.json(),
  )) as ReturnType<typeof inspectStarter>;
  if (
    observation.cases.length !== 4 ||
    !observation.cases.every((item: { actual?: string }) => item.actual === "allow")
  ) {
    throw new Error(`starter did not reproduce all unintended allows: ${JSON.stringify(observation)}`);
  }

  const starter = await post("/public-test", { policy: STARTER_POLICY }, true);
  const starterReport = starter.value.report as { correct?: boolean; cases?: Array<{ passed?: boolean }> };
  if (starter.status !== 200 || starterReport.correct !== false) {
    throw new Error(`starter unexpectedly passed: ${JSON.stringify(starter)}`);
  }

  const prepared = await post("/prepare", { policy: REFERENCE_POLICY }, true);
  const submission = prepared.value.submission;
  if (prepared.status !== 200 || typeof submission !== "string" || submission.length < 16) {
    throw new Error(`reference submission was not prepared: ${JSON.stringify(prepared)}`);
  }
  for (const checkpointId of CHECKPOINT_IDS) {
    const verdict = await post("/verify", { checkpointId, submission });
    if (verdict.status !== 200 || verdict.value.correct !== true || verdict.value.checkpointId !== checkpointId) {
      throw new Error(`${checkpointId} failed: ${JSON.stringify(verdict)}`);
    }
  }

  for (const body of [
    { checkpointId: "observe", submission: "TC{fixed}" },
    { checkpointId: "observe", submission: "not-base64-json" },
    { checkpointId: "unknown", submission },
  ]) {
    const verdict = await post("/verify", body);
    if (verdict.status !== 200 || verdict.value.correct !== false) {
      throw new Error(`invalid submission unexpectedly passed: ${JSON.stringify(verdict)}`);
    }
  }
  const oversized = await post("/verify", { checkpointId: "observe", submission: "a".repeat(17 * 1024) });
  if (oversized.status !== 400) throw new Error(`oversized body did not fail closed: ${JSON.stringify(oversized)}`);

  compose(["exec", "-T", "verifier", "node", "verifier/mutation.mjs"]);
  for (const service of ["participant", "verifier"]) compose(["exec", "-T", service, "node", "-e", noEgressProbe]);
  compose(["exec", "-T", "participant", "sh", "-c", "test ! -w /app && test ! -e /app/verifier && test ! -e /app/reference"]);
  console.log("starter negative, six checkpoints, mutations, malformed inputs, separation, read-only, and no-egress passed");
} finally {
  cleanup();
}

assertNoProjectResources();
console.log("github-oidc-trust-boundary runtime proof passed and cleaned all dedicated resources");
