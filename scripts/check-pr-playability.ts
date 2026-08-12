#!/usr/bin/env bun

interface PlayabilityEvidenceProblem {
  readonly id: string;
  readonly tester: string;
  readonly completedAt: string;
  readonly blind: boolean;
  readonly starterFailed: boolean;
  readonly solutionPassed: boolean;
  readonly negativeCasesPassed: boolean;
  readonly cleanupPassed: boolean;
  readonly evidenceUrl: string;
}

interface PlayabilityEvidence {
  readonly schemaVersion: 1;
  readonly problems: readonly PlayabilityEvidenceProblem[];
}

export interface PlayabilityGateInput {
  readonly draft: boolean;
  readonly body: string;
  readonly labels: readonly string[];
  readonly addedProblemIds: readonly string[];
  readonly promotedReadyProblemIds: readonly string[];
}

export interface ProblemChanges {
  readonly addedProblemIds: readonly string[];
  readonly promotedReadyProblemIds: readonly string[];
}

const EVIDENCE_BLOCK =
  /<!--\s*tenkacloud-playability-v1\s*\n([\s\S]*?)\n\s*-->/gu;
const PROBLEM_METADATA = /^(?:battles|challenges)\/([^/]+)\/metadata\.json$/u;
const GITHUB_EVIDENCE_URL =
  /^https:\/\/github\.com\/susumutomita\/TenkaCloudChallenge\/(?:issues|pull)\/\d+(?:#issuecomment-\d+)?$/u;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parsePlayabilityEvidence(body: string): PlayabilityEvidence {
  const matches = [...body.matchAll(EVIDENCE_BLOCK)];
  if (matches.length === 0) {
    throw new Error("playability evidence block is missing");
  }
  if (matches.length !== 1) {
    throw new Error("expected exactly one playability evidence block");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(matches[0][1]);
  } catch {
    throw new Error("playability evidence must be valid JSON");
  }
  if (!isRecord(parsed) || parsed.schemaVersion !== 1 || !Array.isArray(parsed.problems)) {
    throw new Error("playability evidence must use schemaVersion 1 with a problems array");
  }
  return parsed as unknown as PlayabilityEvidence;
}

function parseMetadata(
  serialized: string | undefined,
  ref: "base" | "head",
  path: string,
): Record<string, unknown> | undefined {
  if (serialized === undefined) return undefined;
  try {
    const parsed: unknown = JSON.parse(serialized);
    if (!isRecord(parsed)) throw new Error("metadata root is not an object");
    return parsed;
  } catch {
    throw new Error(`cannot parse ${ref} metadata for ${path}`);
  }
}

export function classifyProblemChanges(
  nameStatus: string,
  readAtRef: (ref: "base" | "head", path: string) => string | undefined,
): ProblemChanges {
  const added = new Set<string>();
  const promoted = new Set<string>();

  for (const line of nameStatus.split("\n")) {
    if (line.trim().length === 0) continue;
    const [status, path] = line.split("\t");
    const match = path?.match(PROBLEM_METADATA);
    if (!match) continue;
    const problemId = match[1];

    if (status === "A") {
      added.add(problemId);
      continue;
    }
    if (status !== "M") continue;

    const base = parseMetadata(readAtRef("base", path), "base", path);
    const head = parseMetadata(readAtRef("head", path), "head", path);
    if (base?.status !== "ready" && head?.status === "ready") {
      promoted.add(problemId);
    }
  }

  return {
    addedProblemIds: [...added].sort(),
    promotedReadyProblemIds: [...promoted].sort(),
  };
}

function validateEvidenceProblem(problem: PlayabilityEvidenceProblem): string[] {
  const errors: string[] = [];
  if (typeof problem.tester !== "string" || problem.tester.trim().length === 0) {
    errors.push(`${problem.id}: tester must identify the human playtester`);
  }
  if (
    typeof problem.completedAt !== "string" ||
    !Number.isFinite(Date.parse(problem.completedAt))
  ) {
    errors.push(`${problem.id}: completedAt must be an ISO-8601 timestamp`);
  }
  for (const field of [
    "blind",
    "starterFailed",
    "solutionPassed",
    "negativeCasesPassed",
    "cleanupPassed",
  ] as const) {
    if (problem[field] !== true) {
      errors.push(`${problem.id}: ${field} must be true`);
    }
  }
  if (
    typeof problem.evidenceUrl !== "string" ||
    !GITHUB_EVIDENCE_URL.test(problem.evidenceUrl)
  ) {
    errors.push(
      `${problem.id}: evidenceUrl must link to the repository Issue/PR evidence comment`,
    );
  }
  return errors;
}

export function evaluatePlayabilityGate(input: PlayabilityGateInput): string[] {
  const affected = [
    ...new Set([...input.addedProblemIds, ...input.promotedReadyProblemIds]),
  ].sort();
  if (affected.length === 0) return [];

  const errors: string[] = [];
  if (input.draft) {
    errors.push("new-problem and ready-promotion PRs must not remain Draft at merge time");
  }
  if (!input.labels.includes("playtest-verified")) {
    errors.push(
      'the human-owned "playtest-verified" label is required after evidence review',
    );
  }

  let evidence: PlayabilityEvidence;
  try {
    evidence = parsePlayabilityEvidence(input.body);
  } catch (error) {
    errors.push(
      `playability evidence is invalid: ${error instanceof Error ? error.message : String(error)}`,
    );
    return errors;
  }

  const byId = new Map<string, PlayabilityEvidenceProblem>();
  for (const raw of evidence.problems) {
    if (!isRecord(raw) || typeof raw.id !== "string" || raw.id.trim().length === 0) {
      errors.push("each playability evidence entry must have a non-empty id");
      continue;
    }
    if (byId.has(raw.id)) {
      errors.push(`${raw.id}: duplicate playability evidence entry`);
      continue;
    }
    byId.set(raw.id, raw as unknown as PlayabilityEvidenceProblem);
  }

  for (const id of affected) {
    const problem = byId.get(id);
    if (!problem) {
      errors.push(`${id}: playability evidence is missing`);
      continue;
    }
    errors.push(...validateEvidenceProblem(problem));
  }
  return errors;
}

function runGit(args: readonly string[]): string {
  const result = Bun.spawnSync(["git", ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) {
    throw new Error(
      `git ${args[0]} failed: ${new TextDecoder().decode(result.stderr).trim()}`,
    );
  }
  return new TextDecoder().decode(result.stdout);
}

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.length === 0) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function main(): void {
  const baseSha = requiredEnvironment("PR_BASE_SHA");
  const headSha = requiredEnvironment("PR_HEAD_SHA");
  const nameStatus = runGit(["diff", "--name-status", `${baseSha}...${headSha}`]);
  const changes = classifyProblemChanges(nameStatus, (ref, path) => {
    const sha = ref === "base" ? baseSha : headSha;
    const result = Bun.spawnSync(["git", "show", `${sha}:${path}`], {
      stdout: "pipe",
      stderr: "pipe",
    });
    if (result.exitCode !== 0) return undefined;
    return new TextDecoder().decode(result.stdout);
  });

  const bodyValue: unknown = JSON.parse(process.env.PR_BODY_JSON ?? '""');
  const labelsValue: unknown = JSON.parse(process.env.PR_LABELS_JSON ?? "[]");
  const errors = evaluatePlayabilityGate({
    draft: process.env.PR_DRAFT === "true",
    body: typeof bodyValue === "string" ? bodyValue : "",
    labels: Array.isArray(labelsValue)
      ? labelsValue.filter((value): value is string => typeof value === "string")
      : [],
    ...changes,
  });

  if (errors.length > 0) {
    console.error("Playability gate failed:");
    for (const error of errors) console.error(`- ${error}`);
    process.exit(1);
  }
  const affected = [
    ...new Set([...changes.addedProblemIds, ...changes.promotedReadyProblemIds]),
  ];
  console.log(
    affected.length === 0
      ? "Playability gate: no new problem or ready promotion in this PR."
      : `Playability gate: verified ${affected.join(", ")}.`,
  );
}

if (import.meta.main) main();
