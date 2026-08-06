export const INSTALL_EVENTS = Object.freeze(["preinstall", "install", "postinstall", "prepare"]);

export const OBSERVATIONS = Object.freeze([
  "unexpected_file_shipped",
  "install_lifecycle_script_added",
  "valid_attestation_on_compromised_source",
  "lockfile_resolves_compromised_version",
]);

export const REVIEW_SIGNALS = Object.freeze([
  "unexpected-file",
  "added-lifecycle-script",
  "invalid-attestation",
  "integrity-mismatch",
  "known-bad-name",
]);

export const INVENTORY_SIGNALS = Object.freeze(["unexpected-file", "added-lifecycle-script"]);
export const RESOLVE_MODES = Object.freeze(["lockfile", "manifest-range"]);
export const HOST_STATES = Object.freeze([
  "not-installed",
  "installed-scripts-disabled",
  "scripts-executed",
]);
export const RESPONSE_ACTIONS = Object.freeze([
  "monitor",
  "remove-artifact",
  "isolate",
  "hunt-indicators",
  "rotate-credentials",
]);

export const KNOWN_BAD_NAMES = Object.freeze(["flatstore"]);
export const NEEDED_SCRIPT_PACKAGES = Object.freeze([{ name: "native-hash", version: "3.4.1" }]);

export const TARGET_PACKAGE = "flatstore";
export const COMPROMISED_VERSION = "1.1.8";
export const PATCHED_VERSION = "1.1.9";

export function fixtureIntegrity(label) {
  return `sha512-${Buffer.from(`tenkacloud-synthetic:${label}`, "utf8").toString("base64url")}`;
}

export const BASELINE_FILES = Object.freeze(["LICENSE", "README.md", "dist/index.js", "package.json"]);

export function releaseArtifact(options) {
  const {
    name,
    version,
    files = [...BASELINE_FILES],
    expectedFiles = [...BASELINE_FILES],
    scripts = [],
    expectedScripts = [],
  } = options;
  const integrity = fixtureIntegrity(`${name}@${version}`);
  const attestation = Object.hasOwn(options, "attestation")
    ? options.attestation
    : {
        present: true,
        verified: true,
        subjectDigest: integrity,
        sourceRepo: `https://github.com/${name}-dev/${name}`,
        workflowRef: `${name}-dev/${name}/.github/workflows/release.yml@refs/heads/main`,
      };
  return { integrity, files, expectedFiles, scripts, expectedScripts, attestation };
}

export function packageReview(options) {
  const { id, name, declaredRange, registryVersions, lockfile = null, artifacts } = options;
  return { id, name, declaredRange, registryVersions: [...registryVersions], lockfile, artifacts };
}

const FLATSTORE_FILES = Object.freeze(["LICENSE", "README.md", "dist/index.js", "dist/store.js", "package.json"]);

const FLATSTORE_ARTIFACTS = Object.freeze({
  "1.1.7": releaseArtifact({
    name: TARGET_PACKAGE,
    version: "1.1.7",
    files: [...FLATSTORE_FILES],
    expectedFiles: [...FLATSTORE_FILES],
  }),
  [COMPROMISED_VERSION]: releaseArtifact({
    name: TARGET_PACKAGE,
    version: COMPROMISED_VERSION,
    files: [...FLATSTORE_FILES, "scripts/prepare-env.js"],
    expectedFiles: [...FLATSTORE_FILES],
    scripts: [{ event: "preinstall", command: "node scripts/prepare-env.js" }],
  }),
  [PATCHED_VERSION]: releaseArtifact({
    name: TARGET_PACKAGE,
    version: PATCHED_VERSION,
    files: [...FLATSTORE_FILES],
    expectedFiles: [...FLATSTORE_FILES],
  }),
});

const FLATSTORE_PATH = Object.freeze(["payments-service", "cachekit", TARGET_PACKAGE]);

export const PUBLIC_REVIEW_SUBJECT = Object.freeze(
  packageReview({
    id: "flatstore-locked",
    name: TARGET_PACKAGE,
    declaredRange: "^1.1.0",
    registryVersions: ["1.0.6", "1.1.7", COMPROMISED_VERSION, PATCHED_VERSION],
    lockfile: {
      version: COMPROMISED_VERSION,
      integrity: fixtureIntegrity(`${TARGET_PACKAGE}@${COMPROMISED_VERSION}`),
      path: [...FLATSTORE_PATH],
    },
    artifacts: FLATSTORE_ARTIFACTS,
  }),
);

export const PUBLIC_PATCHED_SUBJECT = Object.freeze(
  packageReview({
    id: "flatstore-upgraded",
    name: TARGET_PACKAGE,
    declaredRange: "^1.1.0",
    registryVersions: ["1.0.6", "1.1.7", COMPROMISED_VERSION, PATCHED_VERSION],
    lockfile: {
      version: PATCHED_VERSION,
      integrity: fixtureIntegrity(`${TARGET_PACKAGE}@${PATCHED_VERSION}`),
      path: [...FLATSTORE_PATH],
    },
    artifacts: FLATSTORE_ARTIFACTS,
  }),
);

export const PUBLIC_HOSTS = Object.freeze([
  {
    id: "ci-runner-7",
    artifactPresent: true,
    lifecycleExecuted: true,
    note: "install log に preinstall の実行行が残っている。",
  },
  {
    id: "dev-laptop-3",
    artifactPresent: true,
    lifecycleExecuted: false,
    note: ".npmrc が ignore-scripts=true で、実行 log は無い。",
  },
  {
    id: "prod-service-a",
    artifactPresent: false,
    lifecycleExecuted: false,
    note: "lockfile に対象 package が含まれていない。",
  },
]);

export const PUBLIC_FIXTURES = Object.freeze({
  advisory:
    "2026-08-04、上流 registry の複数 namespace が乗っ取られ、正規の publish pipeline から provenance 付きの改ざん版が公開された。fixture はすべて合成データで、実在の package・悪性 code・網羅的手口は含まない。",
  manifest: {
    name: "payments-service",
    private: true,
    dependencies: { cachekit: "^5.2.0", "native-hash": "^3.4.0", webframe: "^4.1.0" },
  },
  lockfile: {
    name: "payments-service",
    lockfileVersion: 3,
    packages: {
      "node_modules/cachekit": {
        version: "5.2.4",
        integrity: fixtureIntegrity("cachekit@5.2.4"),
        dependencies: { [TARGET_PACKAGE]: "^1.1.0" },
      },
      [`node_modules/${TARGET_PACKAGE}`]: {
        version: COMPROMISED_VERSION,
        integrity: fixtureIntegrity(`${TARGET_PACKAGE}@${COMPROMISED_VERSION}`),
      },
      "node_modules/native-hash": {
        version: "3.4.1",
        integrity: fixtureIntegrity("native-hash@3.4.1"),
        hasInstallScript: true,
      },
      "node_modules/webframe": {
        version: "4.1.2",
        integrity: fixtureIntegrity("webframe@4.1.2"),
      },
    },
  },
  attestation: {
    present: true,
    verified: true,
    subjectName: `pkg:npm/${TARGET_PACKAGE}@${COMPROMISED_VERSION}`,
    subjectDigest: fixtureIntegrity(`${TARGET_PACKAGE}@${COMPROMISED_VERSION}`),
    sourceRepo: `https://github.com/${TARGET_PACKAGE}-dev/${TARGET_PACKAGE}`,
    workflowRef: `${TARGET_PACKAGE}-dev/${TARGET_PACKAGE}/.github/workflows/release.yml@refs/heads/main`,
    builder: "https://github.com/actions/runner",
  },
  tarball: {
    package: `${TARGET_PACKAGE}@${COMPROMISED_VERSION}`,
    expectedFiles: [...FLATSTORE_FILES],
    shippedFiles: [...FLATSTORE_FILES, "scripts/prepare-env.js"],
    expectedLifecycleScripts: [],
    lifecycleScripts: [{ event: "preinstall", command: "node scripts/prepare-env.js" }],
  },
  hosts: PUBLIC_HOSTS,
});

export const STARTER_TRIAGE = Object.freeze({
  diagnosis: [],
  review: {
    resolveFrom: "manifest-range",
    treatValidAttestationAsSafe: true,
    flagOn: ["known-bad-name"],
  },
  scriptPolicy: { default: "allow", allow: [] },
  incident: {
    treatFetchAsExecuted: true,
    actions: {
      "not-installed": ["rotate-credentials"],
      "installed-scripts-disabled": ["rotate-credentials"],
      "scripts-executed": ["monitor"],
    },
  },
});

function isRecord(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function exactKeys(value, keys) {
  return isRecord(value) && Object.keys(value).sort().join("|") === [...keys].sort().join("|");
}

const PACKAGE_NAME_RE = /^[a-z][a-z0-9-]{0,63}$/;
const VERSION_RE = /^\d{1,4}\.\d{1,4}\.\d{1,4}$/;

function uniqueSubset(value, vocabulary, { allowEmpty }) {
  return (
    Array.isArray(value) &&
    (allowEmpty || value.length > 0) &&
    value.length <= vocabulary.length &&
    new Set(value).size === value.length &&
    value.every((item) => vocabulary.includes(item))
  );
}

export function validateTriage(submission) {
  if (!exactKeys(submission, ["diagnosis", "review", "scriptPolicy", "incident"])) {
    return ["submission must contain exactly diagnosis, review, scriptPolicy, and incident"];
  }
  const errors = [];
  if (!uniqueSubset(submission.diagnosis, OBSERVATIONS, { allowEmpty: true })) {
    errors.push("diagnosis must be a unique list of the documented observations");
  }
  const review = submission.review;
  if (!exactKeys(review, ["resolveFrom", "treatValidAttestationAsSafe", "flagOn"])) {
    errors.push("review must contain exactly resolveFrom, treatValidAttestationAsSafe, and flagOn");
  } else {
    if (!RESOLVE_MODES.includes(review.resolveFrom)) {
      errors.push("review.resolveFrom must be lockfile or manifest-range");
    }
    if (typeof review.treatValidAttestationAsSafe !== "boolean") {
      errors.push("review.treatValidAttestationAsSafe must be a boolean");
    }
    if (!uniqueSubset(review.flagOn, REVIEW_SIGNALS, { allowEmpty: false })) {
      errors.push("review.flagOn must be a non-empty unique list of the documented signals");
    }
  }
  const scriptPolicy = submission.scriptPolicy;
  if (!exactKeys(scriptPolicy, ["default", "allow"])) {
    errors.push("scriptPolicy must contain exactly default and allow");
  } else {
    if (scriptPolicy.default !== "deny" && scriptPolicy.default !== "allow") {
      errors.push("scriptPolicy.default must be deny or allow");
    }
    if (
      !Array.isArray(scriptPolicy.allow) ||
      scriptPolicy.allow.length > 8 ||
      !scriptPolicy.allow.every(
        (entry) =>
          exactKeys(entry, ["name", "version"]) &&
          typeof entry.name === "string" &&
          PACKAGE_NAME_RE.test(entry.name) &&
          typeof entry.version === "string" &&
          VERSION_RE.test(entry.version),
      )
    ) {
      errors.push("scriptPolicy.allow entries must pin one exact package name and version (no wildcards)");
    }
  }
  const incident = submission.incident;
  if (!exactKeys(incident, ["treatFetchAsExecuted", "actions"])) {
    errors.push("incident must contain exactly treatFetchAsExecuted and actions");
  } else {
    if (typeof incident.treatFetchAsExecuted !== "boolean") {
      errors.push("incident.treatFetchAsExecuted must be a boolean");
    }
    if (!exactKeys(incident.actions, HOST_STATES)) {
      errors.push("incident.actions must map exactly the three documented states");
    } else {
      for (const state of HOST_STATES) {
        if (!uniqueSubset(incident.actions[state], RESPONSE_ACTIONS, { allowEmpty: false })) {
          errors.push(`incident.actions[${state}] must be a non-empty unique list of the documented actions`);
        }
      }
    }
  }
  return errors;
}

function parseVersion(value) {
  const match = typeof value === "string" ? /^(\d+)\.(\d+)\.(\d+)$/.exec(value) : null;
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

function compareParsed(left, right) {
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return 0;
}

function satisfiesRange(range, version) {
  const parsed = parseVersion(version);
  if (parsed === null || typeof range !== "string") return false;
  if (range.startsWith("^")) {
    const base = parseVersion(range.slice(1));
    return base !== null && parsed[0] === base[0] && compareParsed(parsed, base) >= 0;
  }
  const exact = parseVersion(range);
  return exact !== null && compareParsed(parsed, exact) === 0;
}

export function resolveDependency(mode, subject) {
  if (mode === "lockfile") {
    if (!isRecord(subject.lockfile)) return null;
    const { version, integrity, path } = subject.lockfile;
    return { source: "lockfile", version, integrity, path: [...path] };
  }
  const inRange = subject.registryVersions
    .filter((version) => satisfiesRange(subject.declaredRange, version))
    .sort((left, right) => compareParsed(parseVersion(left), parseVersion(right)));
  const version = inRange.at(-1);
  return version === undefined ? null : { source: "manifest-range", version, integrity: null, path: null };
}

function attestationIsValid(artifact) {
  return (
    isRecord(artifact.attestation) &&
    artifact.attestation.present === true &&
    artifact.attestation.verified === true &&
    artifact.attestation.subjectDigest === artifact.integrity
  );
}

export function reviewPackage(submission, subject) {
  const errors = validateTriage(submission);
  if (errors.length > 0 || !isRecord(subject) || !isRecord(subject.artifacts)) {
    return { resolution: null, flagged: true, reasons: errors.length ? errors : ["invalid review subject"] };
  }
  const resolution = resolveDependency(submission.review.resolveFrom, subject);
  if (resolution === null) return { resolution: null, flagged: true, reasons: ["unresolved-dependency"] };
  const artifact = subject.artifacts[resolution.version];
  if (!isRecord(artifact)) return { resolution, flagged: true, reasons: ["unknown-artifact"] };
  const attestationValid = attestationIsValid(artifact);
  if (submission.review.treatValidAttestationAsSafe && attestationValid) {
    return { resolution, flagged: false, reasons: ["attestation-trusted"] };
  }
  const signals = {
    "unexpected-file": artifact.files.some((file) => !artifact.expectedFiles.includes(file)),
    "added-lifecycle-script": artifact.scripts.some(
      (script) => INSTALL_EVENTS.includes(script.event) && !artifact.expectedScripts.includes(script.event),
    ),
    "invalid-attestation": !attestationValid,
    "integrity-mismatch": resolution.integrity !== null && resolution.integrity !== artifact.integrity,
    "known-bad-name": KNOWN_BAD_NAMES.includes(subject.name),
  };
  const reasons = REVIEW_SIGNALS.filter(
    (signal) => submission.review.flagOn.includes(signal) && signals[signal],
  );
  return { resolution, flagged: reasons.length > 0, reasons };
}

export function evaluateScriptPolicy(submission, request) {
  const errors = validateTriage(submission);
  if (
    errors.length > 0 ||
    !isRecord(request) ||
    typeof request.name !== "string" ||
    typeof request.version !== "string" ||
    !INSTALL_EVENTS.includes(request.event)
  ) {
    return { allowed: false, reason: "invalid-request" };
  }
  if (submission.scriptPolicy.default === "allow") return { allowed: true, reason: "default-allow" };
  const allowed = submission.scriptPolicy.allow.some(
    (entry) => entry.name === request.name && entry.version === request.version,
  );
  return { allowed, reason: allowed ? "allowlisted" : "default-deny" };
}

export function classifyEvidence(evidence, treatFetchAsExecuted) {
  if (evidence.artifactPresent !== true) return "not-installed";
  if (treatFetchAsExecuted === true) return "scripts-executed";
  return evidence.lifecycleExecuted === true ? "scripts-executed" : "installed-scripts-disabled";
}

export function evaluateHost(submission, evidence) {
  const errors = validateTriage(submission);
  if (errors.length > 0 || !isRecord(evidence)) {
    return { state: null, actions: [], reasons: errors.length ? errors : ["invalid evidence"] };
  }
  const state = classifyEvidence(evidence, submission.incident.treatFetchAsExecuted);
  return { state, actions: [...submission.incident.actions[state]], reasons: [] };
}

export function inspectStarter() {
  const verdict = reviewPackage(STARTER_TRIAGE, PUBLIC_REVIEW_SUBJECT);
  const flagOn = STARTER_TRIAGE.review.flagOn;
  return {
    target: {
      package: `${TARGET_PACKAGE}@${COMPROMISED_VERSION}`,
      dependencyPath: [...FLATSTORE_PATH],
      attestation: "valid",
    },
    cases: [
      {
        id: "compromised-review",
        observation: "valid_attestation_on_compromised_source",
        expected: "flag",
        actual: verdict.flagged ? "flag" : "safe",
      },
      {
        id: "tarball-inventory",
        observation: "unexpected_file_shipped",
        expected: "checked",
        actual: flagOn.includes("unexpected-file") ? "checked" : "unchecked",
      },
      {
        id: "lifecycle-scripts",
        observation: "install_lifecycle_script_added",
        expected: "checked",
        actual: flagOn.includes("added-lifecycle-script") ? "checked" : "unchecked",
      },
      {
        id: "resolution",
        observation: "lockfile_resolves_compromised_version",
        expected: `lockfile ${COMPROMISED_VERSION}`,
        actual: verdict.resolution ? `${verdict.resolution.source} ${verdict.resolution.version}` : "unresolved",
      },
    ],
  };
}

export function encodeSubmission(triage) {
  const errors = validateTriage(triage);
  if (errors.length > 0) throw new Error(errors[0]);
  return Buffer.from(JSON.stringify({ version: 1, triage }), "utf8").toString("base64url");
}

export function decodeSubmission(value) {
  if (typeof value !== "string" || value.length < 8 || value.length > 16 * 1024 || /TC\{|FLAG\{/i.test(value)) {
    return null;
  }
  try {
    const decoded = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (!exactKeys(decoded, ["version", "triage"]) || decoded.version !== 1) return null;
    return validateTriage(decoded.triage).length === 0 ? decoded.triage : null;
  } catch {
    return null;
  }
}
