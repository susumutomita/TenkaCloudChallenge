import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "bun:test";
import { brings, copySources, stages } from "./lib/dockerfile-stages";
import { localPlayProblemDirs, participantPythonFiles } from "./lib/local-play-problems";

/**
 * The reference solution does not ship to learners.
 *
 * Every local-play problem used to build one image containing the fixtures, the tests,
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

const DOCKERFILES = localPlayProblemDirs(REPO_ROOT).map((dir) => `${dir}/local/Dockerfile`);

/** Artifacts that exist to serve the author, not the learner. */
const AUTHOR_ONLY = ["reference/", "mutation.py"] as const;

/** The stage a learner's `make build` produces. */
const PARTICIPANT_STAGE = "participant";

/** The stage `make reference-test` produces. */
const AUTHOR_STAGE = "author";

// `stages`, `copySources` and `brings` now live in `./lib/dockerfile-stages` — moved
// there so `check-answer-reachability.test.ts` can derive the same participant stage
// without re-implementing (and risking re-diverging from) this parsing.

describe("author-only artifacts do not ship in the participant image", () => {
  it("should find the local-play images to check, so a glob matching nothing cannot pass", () => {
    expect(DOCKERFILES.length).toBeGreaterThan(0);
  });

  it.each(DOCKERFILES)("%s should name a participant stage", (relative) => {
    const parsed = stages(readFileSync(join(REPO_ROOT, relative), "utf8"));
    expect([...parsed.keys()]).toContain(PARTICIPANT_STAGE);
  });

  it.each(DOCKERFILES)("%s should keep the answer out of the participant stage", (relative) => {
    const parsed = stages(readFileSync(join(REPO_ROOT, relative), "utf8"));
    const sources = copySources(parsed.get(PARTICIPANT_STAGE) ?? "");
    for (const artifact of AUTHOR_ONLY) {
      const leaking = sources.filter((source) => brings(source, artifact));
      expect(leaking).toEqual([]);
    }
  });

  it.each(DOCKERFILES)("%s should give the author stage what the suite needs", (relative) => {
    // The separation must not quietly delete the mutation suite's inputs. If
    // `reference/` stopped being copied anywhere, `make reference-test` would
    // fail for a reason that looks like a problem bug.
    //
    // Asserted against the `author` stage specifically, not the file: copying
    // them into some third stage nothing builds would satisfy a whole-file
    // check while `make reference-test` still had nothing to run against.
    const parsed = stages(readFileSync(join(REPO_ROOT, relative), "utf8"));
    expect([...parsed.keys()]).toContain(AUTHOR_STAGE);
    const sources = copySources(parsed.get(AUTHOR_STAGE) ?? "");
    for (const artifact of AUTHOR_ONLY) {
      expect(sources.some((source) => brings(source, artifact))).toBe(true);
    }
    expect(readFileSync(join(REPO_ROOT, relative), "utf8")).toMatch(
      /^FROM participant AS author$/m,
    );
  });

  it.each(DOCKERFILES)("%s should have a compose file that builds the right stage", (relative) => {
    // The one that mattered. `make build` is not the only way a learner gets an
    // image: the READMEs and `make local` bring the problem up with
    // `docker compose up`, and a compose `build:` with no `target:` builds the
    // LAST stage — `author`. Every one of the thirty compose files omitted it,
    // so the answer still shipped through the path participants actually use,
    // while the Makefile check above passed and the PR claimed the class closed.
    //
    // Checking the Makefile and not compose is how a fix ends up covering the
    // path nobody takes.
    const compose = readFileSync(
      join(REPO_ROOT, dirname(relative), "docker-compose.yml"),
      "utf8",
    );
    const build = /^\s*build:\s*$/m.test(compose);
    if (!build) return; // an image-only service builds nothing to get wrong
    expect(compose).toMatch(new RegExp(`^\\s*target:\\s*${PARTICIPANT_STAGE}\\s*$`, "m"));
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

  /**
   * Every Python file the participant stage copies in.
   *
   * Derived from the stage's own COPY sources rather than listed, because a
   * hand-written glob pair missed `local/show.py` — which `make inspect` runs,
   * and which a future `from reference import ...` would break with nothing here
   * to say so. The starter is included for the same reason: it is executable and
   * it ships.
   */
  const PARTICIPANT_SOURCES = [
    ...new Set(
      localPlayProblemDirs(REPO_ROOT).flatMap((dir) => participantPythonFiles(REPO_ROOT, dir)),
    ),
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
    const suites = localPlayProblemDirs(REPO_ROOT).map((dir) => `${dir}/local/mutation.py`);
    expect(suites.length).toBeGreaterThan(0);
    for (const relative of suites) {
      expect(readFileSync(join(REPO_ROOT, relative), "utf8")).toMatch(LOADS_REFERENCE);
    }
  });
});
