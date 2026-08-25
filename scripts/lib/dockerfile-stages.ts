/**
 * Multi-stage Dockerfile parsing shared by the catalog-wide participant/author
 * separation guards.
 *
 * Extracted out of `author-artifact-separation.test.ts` (where these three functions
 * originated) so `check-answer-reachability.test.ts` can derive the same participant
 * stage without re-implementing — and risking re-diverging from — the same parsing.
 * Naive by the same reasoning as the original: these Dockerfiles are one `FROM ... AS
 * <name>` per stage and no `COPY --from`. A more general parser would be pretending to
 * a generality the catalog does not have.
 */

/**
 * Split a Dockerfile into its stages, keyed by stage name.
 */
export function stages(source: string): Map<string, string> {
  const found = new Map<string, string>();
  let current: string | null = null;
  const lines: string[] = [];
  const flush = () => {
    if (current !== null) found.set(current, lines.join("\n"));
    lines.length = 0;
  };
  for (const line of source.split("\n")) {
    const from = /^FROM\s+\S+(?:\s+AS\s+(\S+))?\s*$/.exec(line);
    if (from) {
      flush();
      current = from[1] ?? "";
      continue;
    }
    lines.push(line);
  }
  flush();
  return found;
}

/**
 * The source paths a stage copies in.
 *
 * Parsed rather than string-matched. `expect(stage).not.toContain("COPY reference/")`
 * reads like it checks something and does not: `COPY ./reference/ ./reference/`,
 * `COPY --chown=1000:1000 reference/ ./reference/` and `COPY . .` all ship the
 * answer and all pass it. The last one is the one that would actually happen,
 * because `COPY . .` is what somebody writes when adding a file is fiddly.
 */
export function copySources(stage: string): string[] {
  const sources: string[] = [];
  for (const line of stage.split("\n")) {
    const copy = /^\s*COPY\s+(.*)$/i.exec(line);
    if (copy === null) continue;
    const words = (copy[1] ?? "")
      .trim()
      .split(/\s+/)
      .filter((word) => !word.startsWith("--"));
    // Last word is the destination; everything before it is a source.
    sources.push(...words.slice(0, -1));
  }
  return sources;
}

/** Does this COPY source bring `artifact` into the image? */
export function brings(source: string, artifact: string): boolean {
  const normalised = source.replace(/^\.\//, "").replace(/\/$/, "");
  const target = artifact.replace(/\/$/, "");
  // A whole-context copy brings everything, including both author artifacts.
  if (normalised === "." || normalised === "./") return true;
  return normalised === target || normalised.startsWith(`${target}/`);
}
