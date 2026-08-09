/**
 * The incident, as a resource graph (Issue 390).
 *
 * ## What this file is for
 *
 * The problem is not "can the AI find the bad resource". It is "does the operator
 * check what the change would actually touch before approving it". That only means
 * something if the environment contains things that *look* like the target and are
 * not — so the world is built to make a careless selector plausible and wrong.
 *
 * Every deploy randomizes ids, display names, which worker is compromised, which
 * decoys carry the stale `suspicious=true` tag, the dependency edges and the evidence
 * ids. What never varies, on any seed:
 *
 *   - exactly one resource is genuinely compromised, and the evidence names it
 *   - isolating that one resource, alone, closes the attack path
 *   - the production API stays healthy through the correct action
 *   - a broad selector (stale tag, or name substring) always sweeps in at least one
 *     resource that must not be touched
 *
 * The last one is the whole problem. If a seed could produce a broad selector that
 * happens to be harmless, the participant would learn that broad selectors are fine.
 * `assertSolvable` enforces it, and the solvability sweep runs it across seeds.
 *
 * ## Why "protected" is a property of the world, not a label on the screen
 *
 * `protected` is never shown to the participant. It is what the *grader* knows. The
 * participant has to work out what must survive from the evidence and the dependency
 * graph — that is the skill. A screen that printed "protected: true" would turn the
 * problem into reading a label.
 */

import { createHash } from "node:crypto";

/** Deterministic per-seed stream. Same seed, same world, on every machine. */
export function rng(seed) {
  let counter = 0;
  return (label) => {
    const digest = createHash("sha256").update(`${seed}:${label}:${counter}`).digest();
    counter += 1;
    return digest.readUInt32BE(0) / 0x1_0000_0000;
  };
}

const pick = (next, list, label) => list[Math.floor(next(label) * list.length) % list.length];

const WORKER_NAMES = ["order-worker", "fulfil-worker", "invoice-worker", "dispatch-worker"];
const REGIONS = ["a", "b", "c", "d"];

/**
 * Resource kinds and what each one means for scoring.
 *
 *   api        the production order API. Must answer through the whole incident.
 *   worker     background workers. Exactly one of them is compromised.
 *   canary     a validation copy of the API. Looks like production, is not.
 *   audit      the evidence store. Deleting it loses the incident record for good.
 *   config     shared configuration. Disabling it takes the healthy side down too.
 */
export const KINDS = ["api", "worker", "canary", "audit", "config"];

function id(next, prefix) {
  const hex = Math.floor(next(`${prefix}:id`) * 0xffff_ffff)
    .toString(16)
    .padStart(8, "0");
  return `${prefix}-${hex}`;
}

/**
 * Build the world for one seed.
 *
 * `staleTagged` is the trap: resources carrying a `suspicious=true` tag left over
 * from an earlier, unrelated investigation. The compromised worker carries it too,
 * which is exactly why "stop everything tagged suspicious" reads as reasonable.
 */
export function createWorld(seed) {
  const next = rng(seed);

  const workerCount = 3;
  const workers = [];
  for (let index = 0; index < workerCount; index += 1) {
    workers.push({
      id: id(next, "wrk"),
      name: `${pick(next, WORKER_NAMES, `wname:${index}`)}-${pick(next, REGIONS, `wreg:${index}`)}`,
      kind: "worker",
      tags: {},
      dependsOn: [],
      state: "running",
      protected: false,
    });
  }

  const api = {
    id: id(next, "api"),
    name: "order-api-prod",
    kind: "api",
    tags: { tier: "production" },
    dependsOn: [],
    state: "running",
    protected: true,
  };
  const canary = {
    id: id(next, "cnr"),
    name: "order-api-canary",
    kind: "canary",
    tags: { tier: "validation" },
    dependsOn: [],
    state: "running",
    protected: false,
  };
  const audit = {
    id: id(next, "aud"),
    name: "incident-evidence-store",
    kind: "audit",
    tags: { retention: "legal-hold" },
    dependsOn: [],
    state: "running",
    protected: true,
  };
  const config = {
    id: id(next, "cfg"),
    name: "order-shared-config",
    kind: "config",
    tags: {},
    dependsOn: [],
    state: "running",
    protected: true,
  };

  // 本番 API と canary は共有設定に依存する。設定を止めると健全な側まで落ちる、という
  // 巻き添えを graph の事実として持たせる (画面の注意書きではなく)。
  api.dependsOn = [config.id];
  canary.dependsOn = [config.id];
  for (const worker of workers) worker.dependsOn = [config.id];

  const compromised = workers[Math.floor(next("compromised") * workers.length) % workers.length];

  // 古い調査で付いたまま残っているタグ。侵害された worker にも付いているので、
  // 「suspicious なものを全部」は一見もっともらしく、実際は巻き添えを起こす。
  const staleCandidates = [compromised, canary, audit, ...workers.filter((w) => w !== compromised)];
  const staleTagged = [compromised];
  for (const candidate of staleCandidates.slice(1)) {
    if (next(`stale:${candidate.id}`) < 0.55) staleTagged.push(candidate);
  }
  // 巻き添えが必ず 1 件は入るようにする。ここが空になる seed があると、参加者は
  // 「広い selector でも平気だった」を学んでしまう。
  if (!staleTagged.some((resource) => resource.protected)) staleTagged.push(audit);
  for (const resource of staleTagged) resource.tags.suspicious = "true";

  const resources = [api, canary, audit, config, ...workers];
  const evidence = buildEvidence(next, compromised, api);

  return { seed, resources, compromisedId: compromised.id, evidence };
}

/**
 * The log lines the participant reads in phase 1.
 *
 * Only the compromised worker's lines describe the attack. The decoys have ordinary
 * operational noise, so "this one is noisy" is not the signal — "this one egresses to
 * an address nothing else talks to, right after a credential read" is.
 */
function buildEvidence(next, compromised, api) {
  const evidenceId = (label) =>
    `ev-${Math.floor(next(label) * 0xffff_ffff)
      .toString(16)
      .padStart(8, "0")}`;
  return [
    {
      id: evidenceId("ev:cred"),
      resourceId: compromised.id,
      severity: "high",
      summary: "資格情報ストアからの読み出しが、この worker のジョブ実行と無関係な時刻に 1 回",
    },
    {
      id: evidenceId("ev:egress"),
      resourceId: compromised.id,
      severity: "high",
      summary: "他のどのリソースも通信していない宛先への外向き接続が、その直後に継続",
    },
    {
      id: evidenceId("ev:api"),
      resourceId: api.id,
      severity: "info",
      summary: "注文 API の応答時間とエラー率は平常どおり",
    },
  ];
}

export const findResource = (world, resourceId) =>
  world.resources.find((resource) => resource.id === resourceId) ?? null;

export const compromised = (world) => findResource(world, world.compromisedId);

export const protectedIds = (world) =>
  world.resources.filter((resource) => resource.protected).map((resource) => resource.id);

/**
 * The production API answers only while it and everything it depends on are running.
 *
 * Dependency-aware on purpose: disabling the shared config is the classic
 * "I only turned off one thing" outage, and it has to actually take the API down or
 * the lesson is a caption rather than a consequence.
 */
export function apiHealthy(world) {
  const api = world.resources.find((resource) => resource.kind === "api");
  if (!api || api.state !== "running") return false;
  return api.dependsOn.every((dependency) => findResource(world, dependency)?.state === "running");
}

/** The attack path is closed once the compromised worker can no longer run. */
export const threatContained = (world) => compromised(world).state !== "running";

/** Evidence survives only while the audit store is intact. Deletion is not undoable. */
export const evidenceIntact = (world) =>
  world.resources.find((resource) => resource.kind === "audit")?.state !== "deleted";

/**
 * Resources that were stopped or deleted without being the compromised one.
 *
 * This is the collateral the score is about. The canary is fair game — it is a
 * validation copy and taking it out costs nothing — so it is not counted here.
 */
export function collateral(world) {
  return world.resources.filter(
    (resource) =>
      resource.id !== world.compromisedId &&
      resource.kind !== "canary" &&
      resource.state !== "running",
  );
}

/**
 * Every seed has to hold these, or the problem is not the problem.
 *
 * Called by the conformance test across seeds. A generator that drifts into
 * producing a harmless broad selector fails here rather than teaching the opposite
 * of the lesson.
 */
export function assertSolvable(world) {
  const problems = [];
  const workers = world.resources.filter((resource) => resource.kind === "worker");
  if (workers.length < 2) problems.push("a single worker leaves nothing to mis-select");
  if (!compromised(world)) problems.push("no compromised resource");

  const highEvidence = world.evidence.filter((entry) => entry.severity === "high");
  if (highEvidence.length === 0) problems.push("no evidence names the compromised resource");
  if (highEvidence.some((entry) => entry.resourceId !== world.compromisedId)) {
    problems.push("high-severity evidence points at something that is not compromised");
  }

  const staleTagged = world.resources.filter((resource) => resource.tags.suspicious === "true");
  if (!staleTagged.some((resource) => resource.id === world.compromisedId)) {
    problems.push("the stale tag does not cover the compromised resource, so it is not a trap");
  }
  if (!staleTagged.some((resource) => resource.protected)) {
    problems.push("a broad tag selector sweeps in nothing protected — the trap is harmless");
  }
  if (!world.resources.some((resource) => resource.kind === "audit" && resource.protected)) {
    problems.push("no protected evidence store");
  }
  return problems;
}
