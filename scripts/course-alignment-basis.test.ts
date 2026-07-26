import { globSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "bun:test";

/**
 * What a companion problem is allowed to claim about a week that has not been
 * published.
 *
 * Three weeks of the Advanced Cryptography Program 2026 had no material when
 * this track was authored. `GOVERNANCE.md` and `SYNC.md` record that state at a
 * real pinned commit, and the problems for those weeks pin the placeholder
 * itself — `kind: "placeholder"` for Weeks 2 and 4, `kind: "roadmap"` for
 * Week 7, which had no directory to pin at all. That records a fact rather than
 * a guess: at this commit, this week had no material, and the companion was
 * written from the publicly stated theme alone.
 *
 * The rule that follows is the one the alignment issues (#219, #229, #245) all
 * state in prose: a problem may not call itself an `assignment-companion` while
 * the assignment it claims to accompany does not exist publicly. Saying so would
 * claim a correspondence with official coursework that nobody can check — and a
 * learner reading "assignment-companion" reasonably concludes there is an
 * assignment on the other side of it.
 *
 * It held at the time of writing. Nothing enforced it, so the next author to
 * add a Week 2 problem could have broken it silently. This is that enforcement,
 * and it is why those issues can close on a deliverable rather than on a date:
 * the decision is recorded in `alignment.md`, and the part of it a machine can
 * check is checked here.
 */

const REPO_ROOT = new URL("..", import.meta.url).pathname;

/** A pin that records the absence of material rather than material. */
const UNPUBLISHED_KINDS = new Set(["placeholder", "roadmap"]);

/** Claims a correspondence with official coursework a reader could go and find. */
const CLAIMS_OFFICIAL_ASSIGNMENT = "assignment-companion";

interface Source {
  readonly path?: string;
  readonly kind?: string;
  readonly ref?: string;
}

interface Problem {
  readonly id: string;
  readonly file: string;
  readonly role?: string;
  readonly sources: readonly Source[];
}

const PROBLEMS: readonly Problem[] = globSync("challenges/*/metadata.json", { cwd: REPO_ROOT })
  .sort()
  .map((relative) => {
    const meta = JSON.parse(readFileSync(join(REPO_ROOT, relative), "utf8")) as {
      id: string;
      courseAlignment?: { role?: string; sources?: Source[] };
    };
    return {
      id: meta.id,
      file: relative,
      role: meta.courseAlignment?.role,
      sources: meta.courseAlignment?.sources ?? [],
    };
  })
  .filter((problem) => problem.sources.length > 0);

/** Problems every one of whose pins records an absence. */
const ON_UNPUBLISHED_WEEKS = PROBLEMS.filter((problem) =>
  problem.sources.every((source) => UNPUBLISHED_KINDS.has(source.kind ?? "")),
);

describe("what a companion may claim about an unpublished week", () => {
  it("should find problems pinned to material, so a glob matching nothing cannot pass", () => {
    expect(PROBLEMS.length).toBeGreaterThan(0);
  });

  it("should find the problems standing on an unpublished week", () => {
    // Weeks 2, 4 and 7 were unpublished when this track was authored. If this
    // ever reaches zero, either the weeks were published — in which case the
    // pins moved and the alignment record needs revisiting, which is what
    // `bun run course:drift` reports as PUBLISHED — or the pins were dropped.
    expect(ON_UNPUBLISHED_WEEKS.length).toBeGreaterThan(0);
  });

  it.each(ON_UNPUBLISHED_WEEKS.map((problem) => [problem.id, problem] as const))(
    "%s should not claim to accompany an assignment that is not published",
    (_id, problem) => {
      expect(problem.role).not.toBe(CLAIMS_OFFICIAL_ASSIGNMENT);
    },
  );

  it("should let a problem claim it once its week is really published", () => {
    // The guard keys on the pin's kind, not on the week number, so it stops
    // applying by itself the moment an author repins to real material. Without
    // this, the rule would have to be relaxed by hand later — and a rule that
    // needs a human to remember to relax it gets relaxed for the wrong reason.
    const published = PROBLEMS.filter((problem) =>
      problem.sources.some((source) => !UNPUBLISHED_KINDS.has(source.kind ?? "")),
    );
    expect(published.length).toBeGreaterThan(0);
    expect(published.some((problem) => problem.role === CLAIMS_OFFICIAL_ASSIGNMENT)).toBe(true);
  });

  it("should pin every unpublished-week source at the same commit the record names", () => {
    // The alignment record states one commit as the point at which those weeks
    // were checked. A pin at some other commit would mean the record describes
    // a state nobody verified.
    const record = readFileSync(
      join(REPO_ROOT, "docs/curricula/advanced-cryptography-2026/alignment.md"),
      "utf8",
    );
    const refs = new Set(
      ON_UNPUBLISHED_WEEKS.flatMap((problem) => problem.sources.map((source) => source.ref ?? "")),
    );
    expect(refs.size).toBe(1);
    const [ref] = [...refs];
    expect(ref).toMatch(/^[0-9a-f]{40}$/);
    expect(record).toContain(ref as string);
  });
});

describe("the alignment record says what was checked", () => {
  const record = readFileSync(
    join(REPO_ROOT, "docs/curricula/advanced-cryptography-2026/alignment.md"),
    "utf8",
  );

  it("should name every problem standing on an unpublished week", () => {
    // A problem missing from the record is one whose basis nobody wrote down.
    for (const problem of ON_UNPUBLISHED_WEEKS) {
      expect(record).toContain(problem.id);
    }
  });

  it("should not describe unpublished material as if it had been read", () => {
    // The failure this whole record exists to prevent: writing down what a week
    // "covers" when nobody could open it.
    expect(record).not.toMatch(/week[24]\/problems\/[a-z0-9-]+\/README\.md/);
  });
});
