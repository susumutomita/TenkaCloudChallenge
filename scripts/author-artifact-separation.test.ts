import { globSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "bun:test";

/**
 * The reference solution does not ship to learners.
 *
 * Every AC26 problem used to build one image containing the fixtures, the tests,
 * the verifier, the starter, the reference implementation, and the mutation
 * suite — and that is the image `make build` produced and a learner ran. The
 * answer to the problem was sitting in `/problem/reference/` on their own
 * machine, one `docker run ... cat` away, with nothing about the workflow
 * suggesting it was there.
 *
 * Be precise about what this fixes, because the surrounding claim is easy to
 * overstate and `scripts/assurance-scope.test.ts` exists to stop that. The
 * participant owns the machine, the daemon and the image; they can build the
 * author stage themselves, and the source is in the repository either way. This
 * is **misdelivery prevention**, not confidentiality. What changes is that
 * handing over the answer now takes a deliberate act rather than being the
 * default state of the thing they were told to run.
 *
 * The split is clean rather than a compromise: nothing on the participant path
 * loads `reference/`. Only `mutation.py` does — verified across all thirty
 * problems — so the participant stage loses no capability by not having it.
 *
 * Tracked by #271, together with the threat model in TEMPLATE.md's "Assurance
 * scope" that this sits underneath.
 */

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));

const DOCKERFILES = globSync("challenges/ac26-*/local/Dockerfile", { cwd: REPO_ROOT }).sort();

/** Artifacts that exist to serve the author, not the learner. */
const AUTHOR_ONLY = ["reference/", "mutation.py"] as const;

/** The stage a learner's `make build` produces. */
const PARTICIPANT_STAGE = "participant";

/**
 * Split a Dockerfile into its stages, keyed by stage name.
 *
 * Naive, because these Dockerfiles are: one `FROM ... AS <name>` per stage and no
 * `COPY --from`. A more general parser would be pretending to a generality the
 * catalog does not have.
 */
function stages(source: string): Map<string, string> {
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

describe("author-only artifacts do not ship in the participant image", () => {
  it("should find the AC26 images to check, so a glob matching nothing cannot pass", () => {
    expect(DOCKERFILES.length).toBeGreaterThan(0);
  });

  it.each(DOCKERFILES)("%s should name a participant stage", (relative) => {
    const parsed = stages(readFileSync(join(REPO_ROOT, relative), "utf8"));
    expect([...parsed.keys()]).toContain(PARTICIPANT_STAGE);
  });

  it.each(DOCKERFILES)("%s should keep the answer out of the participant stage", (relative) => {
    const parsed = stages(readFileSync(join(REPO_ROOT, relative), "utf8"));
    const participant = parsed.get(PARTICIPANT_STAGE) ?? "";
    for (const artifact of AUTHOR_ONLY) {
      expect(participant).not.toContain(`COPY ${artifact}`);
    }
  });

  it.each(DOCKERFILES)("%s should still give the author what the suite needs", (relative) => {
    // The separation must not quietly delete the mutation suite's inputs. If
    // `reference/` stopped being copied anywhere, `make reference-test` would
    // fail for a reason that looks like a problem bug.
    const source = readFileSync(join(REPO_ROOT, relative), "utf8");
    for (const artifact of AUTHOR_ONLY) {
      expect(source).toContain(`COPY ${artifact}`);
    }
    expect(source).toMatch(/^FROM participant AS author$/m);
  });

  it.each(DOCKERFILES)("%s should have a Makefile that builds the right stage", (relative) => {
    const makefile = readFileSync(join(REPO_ROOT, dirname(dirname(relative)), "Makefile"), "utf8");
    // `docker build` with no --target builds the LAST stage, which is the author
    // one — so an un-targeted build would hand the learner exactly what this
    // separation removed, and nothing would look wrong.
    expect(makefile).toMatch(/docker build --target participant -t \$\(IMAGE\) local/);
    expect(makefile).toMatch(/docker build --target author -t \$\(IMAGE\)-author local/);
    expect(makefile).not.toMatch(/docker build -t \$\(IMAGE\) local/);
  });
});

describe("the participant path does not need what was removed", () => {
  /**
   * `reference/` used as a PATH COMPONENT, or imported as a module.
   *
   * The distinction matters and a looser pattern gets it wrong: one hidden
   * checker has a result column literally named `reference`
   * (`row["reference"] != expected["reference"]`), which is data about the
   * problem and has nothing to do with the directory. Requiring the string to
   * sit next to a path separator — `Path(...) / "reference" / "prover.py"`, the
   * form every mutation suite uses — separates loading the directory from
   * mentioning the word.
   */
  const LOADS_REFERENCE =
    /\/\s*"reference"|"reference"\s*\/|["']reference\/|\/reference\/|^\s*(?:from|import)\s+reference\b/m;

  const PARTICIPANT_SOURCES = [
    ...globSync("challenges/ac26-*/local/verifier/*.py", { cwd: REPO_ROOT }),
    ...globSync("challenges/ac26-*/local/tests/**/*.py", { cwd: REPO_ROOT }),
  ].sort();

  it("should find the participant-path modules to check", () => {
    expect(PARTICIPANT_SOURCES.length).toBeGreaterThan(0);
  });

  it("should not load the reference implementation from the participant path", () => {
    // This is what makes the split safe rather than a gamble. If a verifier ever
    // starts loading `reference/`, the participant image stops working and this
    // says so here rather than at `make test` time on someone else's machine.
    const offenders = PARTICIPANT_SOURCES.filter((relative) => {
      const source = readFileSync(join(REPO_ROOT, relative), "utf8");
      return source
        .split("\n")
        .some((line) => !line.trim().startsWith("#") && LOADS_REFERENCE.test(line));
    });
    expect(offenders).toEqual([]);
  });

  it("should keep the mutation suite as the only thing that loads it", () => {
    const suites = globSync("challenges/ac26-*/local/mutation.py", { cwd: REPO_ROOT });
    expect(suites.length).toBeGreaterThan(0);
    for (const relative of suites) {
      expect(readFileSync(join(REPO_ROOT, relative), "utf8")).toMatch(LOADS_REFERENCE);
    }
  });
});
