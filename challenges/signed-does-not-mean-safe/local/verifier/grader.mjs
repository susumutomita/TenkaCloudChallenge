import {
  classifyEvidence,
  evaluateHost,
  evaluateScriptPolicy,
  fixtureIntegrity,
  INVENTORY_SIGNALS,
  NEEDED_SCRIPT_PACKAGES,
  OBSERVATIONS,
  packageReview,
  PUBLIC_PATCHED_SUBJECT,
  PUBLIC_REVIEW_SUBJECT,
  releaseArtifact,
  reviewPackage,
  validateTriage,
} from "../app/engine.mjs";
import { REFERENCE_TRIAGE } from "./reference.mjs";

export const CHECKPOINT_IDS = Object.freeze([
  "artifact-inventory",
  "provenance-boundary",
  "resolved-dependency",
  "install-policy",
  "incident-scope",
  "replay-resistance",
]);

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

const QUICKMEMO_EXTRA_FILE = packageReview({
  id: "quickmemo-extra-file",
  name: "quickmemo",
  declaredRange: "^0.9.0",
  registryVersions: ["0.9.0", "0.9.1"],
  lockfile: { version: "0.9.1", integrity: fixtureIntegrity("quickmemo@0.9.1"), path: ["payments-service", "quickmemo"] },
  artifacts: {
    "0.9.1": releaseArtifact({
      name: "quickmemo",
      version: "0.9.1",
      files: ["LICENSE", "README.md", "dist/index.js", "dist/telemetry-init.js", "package.json"],
      expectedFiles: ["LICENSE", "README.md", "dist/index.js", "package.json"],
    }),
  },
});

const METRICLINE_INLINE_PREINSTALL = packageReview({
  id: "metricline-inline-preinstall",
  name: "metricline",
  declaredRange: "^2.4.0",
  registryVersions: ["2.4.5", "2.4.6"],
  lockfile: { version: "2.4.6", integrity: fixtureIntegrity("metricline@2.4.6"), path: ["payments-service", "metricline"] },
  artifacts: {
    "2.4.6": releaseArtifact({
      name: "metricline",
      version: "2.4.6",
      scripts: [{ event: "preinstall", command: 'node -e "process.exit(0)"' }],
    }),
  },
});

const WEBFRAME_CLEAN = packageReview({
  id: "webframe-clean",
  name: "webframe",
  declaredRange: "^4.1.0",
  registryVersions: ["4.1.0", "4.1.1", "4.1.2"],
  lockfile: { version: "4.1.2", integrity: fixtureIntegrity("webframe@4.1.2"), path: ["payments-service", "webframe"] },
  artifacts: { "4.1.2": releaseArtifact({ name: "webframe", version: "4.1.2" }) },
});

function loglineSubject(id, version, attestation) {
  return packageReview({
    id,
    name: "logline",
    declaredRange: `^${version}`,
    registryVersions: [version],
    lockfile: { version, integrity: fixtureIntegrity(`logline@${version}`), path: ["payments-service", "logline"] },
    artifacts: { [version]: releaseArtifact({ name: "logline", version, attestation }) },
  });
}

const LOGLINE_TAMPERED = loglineSubject("logline-tampered-attestation", "2.3.4", {
  present: true,
  verified: true,
  subjectDigest: fixtureIntegrity("logline@2.3.4-republished"),
  sourceRepo: "https://github.com/logline-dev/logline",
  workflowRef: "logline-dev/logline/.github/workflows/release.yml@refs/heads/main",
});

const LOGLINE_UNVERIFIED = loglineSubject("logline-unverified-attestation", "2.3.5", {
  present: true,
  verified: false,
  subjectDigest: fixtureIntegrity("logline@2.3.5"),
  sourceRepo: "https://github.com/logline-dev/logline",
  workflowRef: "logline-dev/logline/.github/workflows/release.yml@refs/heads/main",
});

const LOGLINE_MISSING = loglineSubject("logline-missing-attestation", "2.3.6", { present: false });

const CACHEKIT_INTEGRITY_MISMATCH = packageReview({
  id: "cachekit-integrity-mismatch",
  name: "cachekit",
  declaredRange: "^5.2.0",
  registryVersions: ["5.2.4"],
  // lockfile が固定した digest と registry が今返す artifact の digest が一致しない
  // (= locked した物とは別物が届いた)。 attestation はその「別物」に対しては valid。
  lockfile: {
    version: "5.2.4",
    integrity: fixtureIntegrity("cachekit@5.2.4-as-locked"),
    path: ["payments-service", "cachekit"],
  },
  artifacts: { "5.2.4": releaseArtifact({ name: "cachekit", version: "5.2.4" }) },
});

const NOTEDOWN_RENAMED = packageReview({
  id: "notedown-renamed-compromise",
  name: "notedown",
  declaredRange: "^0.8.0",
  registryVersions: ["0.8.2", "0.8.3"],
  lockfile: { version: "0.8.3", integrity: fixtureIntegrity("notedown@0.8.3"), path: ["payments-service", "notedown"] },
  artifacts: {
    "0.8.3": releaseArtifact({
      name: "notedown",
      version: "0.8.3",
      files: ["LICENSE", "README.md", "dist/index.js", "package.json", "scripts/agent-setup.js"],
      expectedFiles: ["LICENSE", "README.md", "dist/index.js", "package.json"],
      scripts: [{ event: "postinstall", command: "node scripts/agent-setup.js" }],
    }),
  },
});

const SPANSTORE_RANGE_TRAP = packageReview({
  id: "spanstore-range-trap",
  name: "spanstore",
  declaredRange: "^2.0.0",
  registryVersions: ["2.0.3", "2.1.0"],
  lockfile: { version: "2.0.3", integrity: fixtureIntegrity("spanstore@2.0.3"), path: ["payments-service", "spanstore"] },
  artifacts: {
    "2.0.3": releaseArtifact({ name: "spanstore", version: "2.0.3" }),
    "2.1.0": releaseArtifact({
      name: "spanstore",
      version: "2.1.0",
      files: ["LICENSE", "README.md", "dist/index.js", "package.json", "scripts/postinstall.js"],
      expectedFiles: ["LICENSE", "README.md", "dist/index.js", "package.json"],
      scripts: [{ event: "postinstall", command: "node scripts/postinstall.js" }],
    }),
  },
});

const TRACEPACK_UNLOCKED = packageReview({
  id: "tracepack-unlocked",
  name: "tracepack",
  declaredRange: "^1.4.0",
  registryVersions: ["1.4.2"],
  lockfile: null,
  artifacts: { "1.4.2": releaseArtifact({ name: "tracepack", version: "1.4.2" }) },
});

const INVENTORY_MATRIX = Object.freeze([
  { subject: QUICKMEMO_EXTRA_FILE, expected: true },
  { subject: METRICLINE_INLINE_PREINSTALL, expected: true },
  { subject: PUBLIC_REVIEW_SUBJECT, expected: true },
  { subject: WEBFRAME_CLEAN, expected: false },
]);

const PROVENANCE_MATRIX = Object.freeze([
  { subject: PUBLIC_REVIEW_SUBJECT, expected: true },
  { subject: LOGLINE_TAMPERED, expected: true },
  { subject: LOGLINE_UNVERIFIED, expected: true },
  { subject: LOGLINE_MISSING, expected: true },
  { subject: WEBFRAME_CLEAN, expected: false },
]);

const RESOLVED_MATRIX = Object.freeze([
  { subject: PUBLIC_REVIEW_SUBJECT, expected: true },
  { subject: CACHEKIT_INTEGRITY_MISMATCH, expected: true },
  { subject: SPANSTORE_RANGE_TRAP, expected: false },
  { subject: TRACEPACK_UNLOCKED, expected: true },
]);

const SCRIPT_REQUESTS = Object.freeze([
  { request: { name: "native-hash", version: "3.4.1", event: "preinstall" }, expected: true },
  { request: { name: "native-hash", version: "3.4.0", event: "preinstall" }, expected: false },
  { request: { name: "flatstore", version: "1.1.8", event: "preinstall" }, expected: false },
  { request: { name: "webframe", version: "4.1.2", event: "postinstall" }, expected: false },
  { request: { name: "metricline", version: "2.4.6", event: "install" }, expected: false },
]);

const EVIDENCE_MATRIX = Object.freeze([
  { id: "prod-service-a", evidence: { artifactPresent: false, lifecycleExecuted: false } },
  { id: "dev-laptop-3", evidence: { artifactPresent: true, lifecycleExecuted: false } },
  { id: "build-cache-9", evidence: { artifactPresent: true, lifecycleExecuted: false } },
  { id: "ci-runner-7", evidence: { artifactPresent: true, lifecycleExecuted: true } },
]);

const EXPECTED_ACTIONS = Object.freeze({
  "not-installed": "monitor",
  "installed-scripts-disabled": "remove-artifact",
  "scripts-executed": "hunt-indicators|isolate|rotate-credentials",
});

function graftSignals(projected, submission, signals) {
  projected.review.flagOn = [
    ...projected.review.flagOn.filter((signal) => !signals.includes(signal)),
    ...submission.review.flagOn.filter((signal) => signals.includes(signal)),
  ];
}

function matrixHolds(triage, matrix) {
  return matrix.every(({ subject, expected }) => reviewPackage(triage, subject).flagged === expected);
}

function gradeInventory(submission) {
  const diagnosisComplete =
    submission.diagnosis.length === OBSERVATIONS.length &&
    OBSERVATIONS.every((item) => submission.diagnosis.includes(item));
  const projected = clone(REFERENCE_TRIAGE);
  graftSignals(projected, submission, INVENTORY_SIGNALS);
  return diagnosisComplete && matrixHolds(projected, INVENTORY_MATRIX);
}

function gradeProvenance(submission) {
  const projected = clone(REFERENCE_TRIAGE);
  projected.review.treatValidAttestationAsSafe = submission.review.treatValidAttestationAsSafe;
  graftSignals(projected, submission, ["invalid-attestation"]);
  return matrixHolds(projected, PROVENANCE_MATRIX);
}

function gradeResolved(submission) {
  const projected = clone(REFERENCE_TRIAGE);
  projected.review.resolveFrom = submission.review.resolveFrom;
  graftSignals(projected, submission, ["integrity-mismatch"]);
  if (!matrixHolds(projected, RESOLVED_MATRIX)) return false;
  const verdict = reviewPackage(projected, PUBLIC_REVIEW_SUBJECT);
  const locked = PUBLIC_REVIEW_SUBJECT.lockfile;
  return (
    verdict.resolution !== null &&
    verdict.resolution.source === "lockfile" &&
    verdict.resolution.version === locked.version &&
    verdict.resolution.integrity === locked.integrity &&
    JSON.stringify(verdict.resolution.path) === JSON.stringify(locked.path)
  );
}

function gradeInstallPolicy(submission) {
  const projected = clone(REFERENCE_TRIAGE);
  projected.scriptPolicy = clone(submission.scriptPolicy);
  const behaviorHolds = SCRIPT_REQUESTS.every(
    ({ request, expected }) => evaluateScriptPolicy(projected, request).allowed === expected,
  );
  const minimal = submission.scriptPolicy.allow.every((entry) =>
    NEEDED_SCRIPT_PACKAGES.some((needed) => needed.name === entry.name && needed.version === entry.version),
  );
  return behaviorHolds && minimal;
}

function gradeIncidentScope(submission) {
  const projected = clone(REFERENCE_TRIAGE);
  projected.incident = clone(submission.incident);
  return EVIDENCE_MATRIX.every(({ evidence }) => {
    const truth = classifyEvidence(evidence, false);
    const outcome = evaluateHost(projected, evidence);
    return outcome.state === truth && [...outcome.actions].sort().join("|") === EXPECTED_ACTIONS[truth];
  });
}

function shuffledSubject(subject) {
  return {
    ...subject,
    id: `${subject.id}-shuffled`,
    registryVersions: [...subject.registryVersions].reverse(),
    artifacts: Object.fromEntries(Object.entries(subject.artifacts).reverse()),
  };
}

function dressedSubject(subject) {
  const copy = clone(subject);
  copy.id = `${subject.id}-dressed`;
  for (const artifact of Object.values(copy.artifacts)) {
    artifact.scripts = [
      ...artifact.scripts,
      { event: "test", command: "node --test" },
      { event: "lint", command: "node scripts/lint.mjs" },
    ];
  }
  return copy;
}

const HIDDEN_REVIEW_MATRIX = Object.freeze([
  { subject: PUBLIC_REVIEW_SUBJECT, expected: true },
  { subject: PUBLIC_PATCHED_SUBJECT, expected: false },
  { subject: QUICKMEMO_EXTRA_FILE, expected: true },
  { subject: METRICLINE_INLINE_PREINSTALL, expected: true },
  { subject: LOGLINE_TAMPERED, expected: true },
  { subject: LOGLINE_UNVERIFIED, expected: true },
  { subject: LOGLINE_MISSING, expected: true },
  { subject: WEBFRAME_CLEAN, expected: false },
  { subject: CACHEKIT_INTEGRITY_MISMATCH, expected: true },
  { subject: NOTEDOWN_RENAMED, expected: true },
  { subject: SPANSTORE_RANGE_TRAP, expected: false },
  { subject: TRACEPACK_UNLOCKED, expected: true },
]);

export const REPLAY_MATRIX = Object.freeze([
  ...HIDDEN_REVIEW_MATRIX,
  ...HIDDEN_REVIEW_MATRIX.map(({ subject, expected }) => ({ subject: shuffledSubject(subject), expected })),
  ...HIDDEN_REVIEW_MATRIX.map(({ subject, expected }) => ({ subject: dressedSubject(subject), expected })),
]);

export function gradeReplay(submission, evaluate = reviewPackage) {
  const baseline = REPLAY_MATRIX.map((item) => ({
    id: item.subject.id,
    flagged: evaluate(submission, item.subject).flagged,
    expected: item.expected,
  }));
  if (!baseline.every((item) => item.flagged === item.expected)) return false;
  const verdictById = new Map(baseline.map((item) => [item.id, item.flagged]));
  const permutations = [
    REPLAY_MATRIX,
    [...REPLAY_MATRIX].reverse(),
    [...REPLAY_MATRIX.slice(7), ...REPLAY_MATRIX.slice(0, 7)],
    [...REPLAY_MATRIX, ...REPLAY_MATRIX],
  ];
  return permutations.every((matrix) =>
    matrix.every((item) => evaluate(submission, item.subject).flagged === verdictById.get(item.subject.id)),
  );
}

const graders = Object.freeze({
  "artifact-inventory": gradeInventory,
  "provenance-boundary": gradeProvenance,
  "resolved-dependency": gradeResolved,
  "install-policy": gradeInstallPolicy,
  "incident-scope": gradeIncidentScope,
  "replay-resistance": (submission) => gradeReplay(submission),
});

export function gradeCheckpoint(triage, checkpointId) {
  const errors = validateTriage(triage);
  if (errors.length > 0 || !CHECKPOINT_IDS.includes(checkpointId)) {
    return { checkpointId, correct: false, errors: errors.length ? errors : ["unknown checkpoint"] };
  }
  const correct = graders[checkpointId](triage) === true;
  return {
    checkpointId,
    correct,
    errors: correct ? [] : [`${checkpointId} still has a hidden counterexample`],
  };
}

export function gradeAll(triage) {
  const checks = CHECKPOINT_IDS.map((checkpointId) => gradeCheckpoint(triage, checkpointId));
  return { correct: checks.every((item) => item.correct), checks };
}
