import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import Ajv2020 from "ajv";

type Metadata = Record<string, unknown>;
type ValidationError = string;
type Overlay = Record<string, unknown>;

const REPO_ROOT = new URL("..", import.meta.url).pathname;
const OVERLAY_SCHEMA_PATH = join(REPO_ROOT, "SIMULATION_SCHEMA.json");
const OVERLAY_FILENAME = "simulation.json";
const MAX_OVERLAY_BYTES = 1024 * 1024;
const MAX_ARTIFACT_BYTES = 16 * 1024 * 1024;
const overlaySchema = JSON.parse(readFileSync(OVERLAY_SCHEMA_PATH, "utf8"));
const ajv = new Ajv2020({ allErrors: true, strict: false });
const validateOverlaySchema = ajv.compile(overlaySchema);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function referencedOverlay(meta: Metadata):
  | { readonly schemaVersion: string; readonly entry: string }
  | undefined {
  if (!isRecord(meta.simulationOverlay)) return undefined;
  const schemaVersion = meta.simulationOverlay.schemaVersion;
  const entry = meta.simulationOverlay.entry;
  if (typeof schemaVersion !== "string" || typeof entry !== "string") return undefined;
  return { schemaVersion, entry };
}

function normalizedTargetIds(meta: Metadata): ReadonlySet<string> {
  if (isRecord(meta.runtime) && meta.runtime.kind === "composite") {
    const targets = Array.isArray(meta.runtime.targets) ? meta.runtime.targets : [];
    return new Set(
      targets.flatMap((target) =>
        isRecord(target) && typeof target.id === "string" ? [target.id] : [],
      ),
    );
  }
  return new Set(["default"]);
}

function isContainerRuntime(meta: Metadata): boolean {
  return (
    isRecord(meta.runtime) &&
    (meta.runtime.provider === "docker" || meta.runtime.engine === "compose")
  );
}

function safeRelativePath(root: string, path: string): string | undefined {
  if (path.length === 0 || path.includes("\0")) return undefined;
  const segments = path.split("/");
  if (segments.some((segment) => segment.length === 0 || segment === "." || segment === "..")) {
    return undefined;
  }
  const absolute = resolve(root, ...segments);
  const fromRoot = relative(root, absolute);
  if (fromRoot === "" || fromRoot === ".." || fromRoot.startsWith(`..${sep}`)) return undefined;
  return absolute;
}

function readRegularFileWithoutSymlinks(
  problemDirectory: string,
  path: string,
  label: string,
  maxBytes = MAX_ARTIFACT_BYTES,
): { readonly bytes?: Buffer; readonly errors: ValidationError[] } {
  const absolute = safeRelativePath(problemDirectory, path);
  if (absolute === undefined) {
    return { errors: [`${label}.path="${path}" must stay inside the problem directory`] };
  }
  const errors: ValidationError[] = [];
  let current = problemDirectory;
  const segments = path.split("/");
  for (const [index, segment] of segments.entries()) {
    current = join(current, segment);
    let stat;
    try {
      stat = lstatSync(current);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code ?? "unknown error";
      return { errors: [`${label}.path="${path}" cannot be read (${code})`] };
    }
    if (stat.isSymbolicLink()) {
      return { errors: [`${label}.path="${path}" must not contain a symbolic link`] };
    }
    const last = index === segments.length - 1;
    if ((!last && !stat.isDirectory()) || (last && !stat.isFile())) {
      return {
        errors: [
          `${label}.path="${path}" must resolve to a regular file with directory-only parents`,
        ],
      };
    }
    if (last && stat.size > maxBytes) {
      return { errors: [`${label}.path="${path}" exceeds the ${maxBytes}-byte limit`] };
    }
  }
  try {
    return { bytes: readFileSync(absolute), errors };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code ?? "unknown error";
    return { errors: [`${label}.path="${path}" cannot be read (${code})`] };
  }
}

function parseOverlay(
  problemDirectory: string,
  entry: string,
): { readonly overlay?: Overlay; readonly errors: ValidationError[] } {
  const read = readRegularFileWithoutSymlinks(
    problemDirectory,
    entry,
    "simulationOverlay.entry",
    MAX_OVERLAY_BYTES,
  );
  if (read.bytes === undefined) return { errors: read.errors };
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(read.bytes);
  } catch {
    return { errors: ["simulationOverlay.entry must be valid UTF-8 JSON"] };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return {
      errors: [
        `simulationOverlay.entry is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
      ],
    };
  }
  if (!validateOverlaySchema(parsed)) {
    return {
      errors: (validateOverlaySchema.errors ?? []).map(
        (error) =>
          `simulation overlay schema ${error.instancePath || "(root)"} ${error.message ?? "is invalid"}`,
      ),
    };
  }
  return { overlay: parsed as Overlay, errors: [] };
}

function artifactErrors(
  problemDirectory: string,
  artifact: unknown,
  label: string,
): ValidationError[] {
  if (!isRecord(artifact)) return [];
  const path = artifact.path;
  const expected = artifact.sha256;
  if (typeof path !== "string" || typeof expected !== "string") return [];
  const read = readRegularFileWithoutSymlinks(problemDirectory, path, label);
  if (read.bytes === undefined) return read.errors;
  const actual = createHash("sha256").update(read.bytes).digest("hex");
  return actual === expected
    ? []
    : [`${label}.sha256 is stale for "${path}" (expected ${actual})`];
}

function requirementErrors(
  problemDirectory: string,
  requirements: unknown,
  targetIds: ReadonlySet<string>,
): ValidationError[] {
  if (!Array.isArray(requirements)) return [];
  const errors: ValidationError[] = [];
  const identities = new Set<string>();
  requirements.forEach((value, index) => {
    if (!isRecord(value)) return;
    const targetId = String(value.targetId ?? "");
    if (!targetIds.has(targetId)) {
      errors.push(
        `simulation requirements[${index}].targetId="${targetId}" does not match a normalized runtime target`,
      );
    }
    const identity = [
      targetId,
      value.service,
      value.resourceType,
      value.operation,
      value.plane,
    ].join("|");
    if (identities.has(identity)) {
      errors.push(`simulation requirements[${index}] duplicates identity ${identity}`);
    }
    identities.add(identity);
    errors.push(
      ...artifactErrors(
        problemDirectory,
        value.artifact,
        `simulation requirements[${index}].artifact`,
      ),
    );
  });
  return errors;
}

function workloadErrors(
  problemDirectory: string,
  workloads: unknown,
  targetIds: ReadonlySet<string>,
): ValidationError[] {
  if (!Array.isArray(workloads)) return [];
  const errors: ValidationError[] = [];
  const ids = new Set<string>();
  workloads.forEach((value, index) => {
    if (!isRecord(value)) return;
    const id = String(value.id ?? "");
    const targetId = String(value.targetId ?? "");
    if (ids.has(id)) errors.push(`simulation workloads[${index}].id="${id}" is duplicated`);
    ids.add(id);
    if (!targetIds.has(targetId)) {
      errors.push(
        `simulation workloads[${index}].targetId="${targetId}" does not match a normalized runtime target`,
      );
    }
    if (
      Array.isArray(value.command) &&
      value.command.some((argument) => typeof argument === "string" && argument.includes("\0"))
    ) {
      errors.push(`simulation workloads[${index}].command must not contain a null byte`);
    }
    errors.push(
      ...artifactErrors(
        problemDirectory,
        value.artifact,
        `simulation workloads[${index}].artifact`,
      ),
    );
  });
  return errors;
}

export function checkSimulationOverlay(metaPath: string, meta: Metadata): ValidationError[] {
  const problemDirectory = dirname(metaPath);
  const reference = referencedOverlay(meta);
  let containsConventionalOverlay = false;
  try {
    containsConventionalOverlay = readdirSync(problemDirectory).includes(OVERLAY_FILENAME);
  } catch {
    // The surrounding metadata/README checks report an unreadable problem directory.
  }
  if (reference === undefined) {
    return containsConventionalOverlay
      ? [
          `${OVERLAY_FILENAME} exists but metadata.simulationOverlay does not reference it; unreferenced overlays are ignored by Simulator`,
        ]
      : [];
  }
  if (isContainerRuntime(meta)) {
    return [
      "simulationOverlay is for cloud runtimes only; docker/compose keeps its existing /verify contract",
    ];
  }
  if (reference.entry !== OVERLAY_FILENAME) {
    return [`simulationOverlay.entry must be "${OVERLAY_FILENAME}"`];
  }
  const parsed = parseOverlay(problemDirectory, reference.entry);
  if (parsed.overlay === undefined) return parsed.errors;
  const errors = [...parsed.errors];
  if (parsed.overlay.schemaVersion !== reference.schemaVersion) {
    errors.push(
      `simulation overlay schemaVersion="${String(parsed.overlay.schemaVersion)}" does not match metadata reference "${reference.schemaVersion}"`,
    );
  }
  const targetIds = normalizedTargetIds(meta);
  errors.push(
    ...requirementErrors(problemDirectory, parsed.overlay.requirements, targetIds),
    ...workloadErrors(problemDirectory, parsed.overlay.workloads, targetIds),
  );
  return errors;
}
