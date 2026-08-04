#!/usr/bin/env bun

import { spawnSync } from "node:child_process";
import { createServer } from "node:net";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
// @ts-expect-error The container runtime is intentionally plain JavaScript.
import { STARTER_POLICY } from "../challenges/eventbridge-delivery-discipline/local/app/engine.mjs";
// @ts-expect-error The hidden verifier is intentionally plain JavaScript.
import { CHECKPOINT_IDS } from "../challenges/eventbridge-delivery-discipline/local/verifier/grader.mjs";
// @ts-expect-error The author-only reference is intentionally plain JavaScript.
import { REFERENCE_POLICY } from "../challenges/eventbridge-delivery-discipline/local/verifier/reference.mjs";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
const LOCAL_DIR = join(REPO_ROOT, "challenges/eventbridge-delivery-discipline/local");
const project = `tcc-eventbridge-${process.pid}`;
const participantImage = `${project}-participant:local`;
const verifierImage = `${project}-verifier:local`;

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

const workbenchPort = await availablePort();
let verifyPort = await availablePort();
while (verifyPort === workbenchPort || verifyPort !== workbenchPort + 1) {
  verifyPort = workbenchPort + 1;
  const probe = createServer();
  const free = await new Promise<boolean>((resolve) => {
    probe.once("error", () => resolve(false));
    probe.listen(verifyPort, "127.0.0.1", () => probe.close(() => resolve(true)));
  });
  if (free) break;
  throw new Error(`the verifier port next to ${workbenchPort} is already in use`);
}

const environment = {
  ...process.env,
  EVENTBRIDGE_WORKBENCH_PORT: String(workbenchPort),
  EVENTBRIDGE_VERIFY_PORT: String(verifyPort),
  EVENTBRIDGE_PARTICIPANT_IMAGE: participantImage,
  EVENTBRIDGE_VERIFIER_IMAGE: verifierImage,
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
  if (!response.ok) throw new Error(`${path} returned HTTP ${response.status}: ${JSON.stringify(value)}`);
  return value;
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
    "test ! -e /app/verifier && test ! -e /app/reference && test ! -e /app/public-cases.mjs",
  ]);

  compose(["up", "-d", "--no-build"]);
  await Promise.all([
    waitFor(`http://127.0.0.1:${workbenchPort}/healthz`),
    waitFor(`http://127.0.0.1:${verifyPort}/healthz`),
  ]);

  const home = await fetch(`http://127.0.0.1:${workbenchPort}/`).then((response) => response.text());
  if (!home.includes("二度届いて、前後する")) throw new Error("Browser Workbench did not render the challenge");
  const observation = (await fetch(`http://127.0.0.1:${workbenchPort}/api/inspect`).then((response) =>
    response.json(),
  )) as { sideEffects?: number; finalState?: { version?: number } };
  if (observation.sideEffects !== 2 || observation.finalState?.version !== 1) {
    throw new Error(`starter did not reproduce duplicate charge and regression: ${JSON.stringify(observation)}`);
  }

  const starter = await post("/public-test", { policy: STARTER_POLICY }, true);
  const starterReport = starter.report as { correct?: boolean; cases?: Array<{ passed?: boolean }> };
  if (starterReport.correct !== false || starterReport.cases?.filter((item) => !item.passed).length !== 4) {
    throw new Error(`starter did not fail all four public cases: ${JSON.stringify(starter)}`);
  }

  const prepared = await post("/prepare", { policy: REFERENCE_POLICY }, true);
  const submission = prepared.submission;
  if (typeof submission !== "string" || submission.length < 16) {
    throw new Error(`reference submission was not prepared: ${JSON.stringify(prepared)}`);
  }
  for (const checkpointId of CHECKPOINT_IDS) {
    const verdict = await post("/verify", { checkpointId, submission });
    if (verdict.correct !== true || verdict.checkpointId !== checkpointId) {
      throw new Error(`${checkpointId} failed: ${JSON.stringify(verdict)}`);
    }
  }
  const invalid = await post("/verify", { checkpointId: "observe", submission: "FLAG{fixed}" });
  if (invalid.correct !== false) throw new Error("flag-like submission unexpectedly passed");

  for (const service of ["participant", "verifier"]) {
    compose(["exec", "-T", service, "node", "-e", noEgressProbe]);
  }
  compose([
    "exec",
    "-T",
    "participant",
    "sh",
    "-c",
    "test ! -w /app && test ! -e /app/verifier && test ! -e /app/reference",
  ]);
  console.log("starter negative, six reference checkpoints, image separation, read-only, and no-egress proofs passed");
} finally {
  cleanup();
}

assertNoProjectResources();
console.log("eventbridge-delivery-discipline runtime proof passed and cleaned all dedicated resources");
