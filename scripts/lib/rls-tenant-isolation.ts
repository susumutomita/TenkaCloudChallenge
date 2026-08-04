export const RLS_REGRESSION_TARGETS = {
  dockerfile: "challenges/rls-tenant-isolation/local/Dockerfile",
  compose: "challenges/rls-tenant-isolation/local/docker-compose.yml",
  schema: "challenges/rls-tenant-isolation/local/db/schema.sql",
} as const;

export function requireRlsRegressionTargets(targets: readonly string[]): void {
  if (targets.length === 0) throw new Error("rls-tenant-isolation regression target set is empty");
}

function stages(source: string): Map<string, string> {
  const found = new Map<string, string>();
  let current: string | null = null;
  let lines: string[] = [];
  const flush = () => {
    if (current !== null) found.set(current, lines.join("\n"));
    lines = [];
  };

  for (const line of source.split("\n")) {
    const from = /^FROM\s+\S+(?:\s+AS\s+(\S+))?\s*$/i.exec(line);
    if (from !== null) {
      flush();
      current = from[1] ?? "";
      continue;
    }
    lines.push(line);
  }
  flush();
  return found;
}

function copySources(stage: string): string[] {
  return stage.split("\n").flatMap((line) => {
    const copy = /^\s*COPY\s+(.*)$/i.exec(line);
    if (copy === null) return [];
    const words = (copy[1] ?? "")
      .trim()
      .split(/\s+/)
      .filter((word) => !word.startsWith("--"));
    return words.slice(0, -1);
  });
}

function copiesReference(source: string): boolean {
  const normalized = source.replace(/^\.\//, "").replace(/\/$/, "");
  return normalized === "." || normalized === "reference" || normalized.startsWith("reference/");
}

export function assertRlsDockerfileContract(source: string): void {
  const parsed = stages(source);
  const participant = parsed.get("participant");
  const author = parsed.get("author");
  if (participant === undefined) throw new Error("Dockerfile has no participant stage");
  if (author === undefined) throw new Error("Dockerfile has no author stage");
  if (!/^USER\s+postgres\s*$/m.test(participant)) {
    throw new Error("participant stage must run as USER postgres");
  }
  if (copySources(participant).some(copiesReference)) {
    throw new Error("participant stage copies the reference answer");
  }
  if (!copySources(author).some(copiesReference)) {
    throw new Error("author stage does not receive the reference answer");
  }
  if (!/^FROM\s+participant\s+AS\s+author\s*$/im.test(source)) {
    throw new Error("author stage must inherit the participant runtime");
  }
}

export function assertRlsSchemaOrder(source: string): void {
  const memberships = source.search(/create\s+table\s+if\s+not\s+exists\s+public\.memberships\b/i);
  const membershipHelpers = [
    source.search(/create\s+or\s+replace\s+function\s+app\.current_org_ids\b/i),
    source.search(/create\s+or\s+replace\s+function\s+app\.is_owner_of\b/i),
  ];
  if (memberships < 0 || membershipHelpers.some((position) => position < 0)) {
    throw new Error("schema is missing memberships or a membership-reading helper");
  }
  if (membershipHelpers.some((position) => position < memberships)) {
    throw new Error("membership-reading helpers must be declared after public.memberships");
  }
}

export function assertRlsComposeContract(source: string): void {
  if (!/^\s*target:\s*participant\s*$/m.test(source)) {
    throw new Error("compose must build the participant stage");
  }
  for (const variable of ["RLS_SOLUTION_DIR", "RLS_APP_PORT", "RLS_VERIFY_PORT"]) {
    if (!source.includes(variable)) throw new Error(`compose is missing ${variable}`);
  }
}
