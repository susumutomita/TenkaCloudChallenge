import { globSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
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

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));

const RECORD_PATH = "docs/curricula/advanced-cryptography-2026/alignment.md";
const RECORD = readFileSync(join(REPO_ROOT, RECORD_PATH), "utf8");

/**
 * The weeks the record itself says it covers, read from its own headings.
 *
 * Derived rather than listed, because the two checks below and the record have
 * to agree and there is no reason for a human to keep three copies in step. A
 * hard-coded `[2, 4, 7]` is how the Week 7 gap below happened: the record grew a
 * third week and the guard kept checking two.
 */
const DOCUMENTED_WEEKS: readonly number[] = [...RECORD.matchAll(/^## Week (\d+) /gm)]
  .map((match) => Number(match[1]))
  .sort((a, b) => a - b);

/** `ac26-w2-beaver-mul` → 2. */
function weekOf(id: string): number | null {
  const match = /^ac26-w(\d+)-/.exec(id);
  return match === null ? null : Number(match[1]);
}

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

  it("should document at least one week as unpublished", () => {
    expect(DOCUMENTED_WEEKS.length).toBeGreaterThan(0);
  });

  it.each(DOCUMENTED_WEEKS)(
    "should still have Week %i standing on an unpublished pin",
    (week) => {
      // Per week, not `ON_UNPUBLISHED_WEEKS.length > 0`. The aggregate check
      // stays green while every Week 2 problem loses its placeholder pin, so
      // long as one Week 7 problem still has one — and the Week 2 section of
      // the record would then be describing a state no metadata claims.
      //
      // If this fails, either that week was published (the pins moved, which
      // `bun run course:drift` reports as PUBLISHED and which means the record
      // needs revisiting) or the pins were dropped. Both need a human.
      const onThisWeek = ON_UNPUBLISHED_WEEKS.filter((problem) => weekOf(problem.id) === week);
      expect(onThisWeek.length).toBeGreaterThan(0);
    },
  );

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

  it.each(DOCUMENTED_WEEKS)(
    "should not describe Week %i's material as if it had been read",
    (week) => {
      // The failure this whole record exists to prevent: writing down what a
      // week "covers" when nobody could open it.
      //
      // The week numbers come from the record's own headings rather than a
      // literal. This was `/week[24]\/…/` and the record documents three weeks,
      // so a `week7/problems/…/README.md` citation could have been added
      // without failing anything — the guard silently covered two thirds of
      // what it claimed to.
      expect(record).not.toMatch(
        new RegExp(`week${week}/problems/[a-z0-9-]+/README\\.md`),
      );
    },
  );
});
