import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "bun:test";

/**
 * Every ac26 problem must start from school math (#493).
 *
 * The problems were written by someone who already knew the vocabulary, and a
 * learner who does not reads "F_p", "witness", "commitment" in the first line
 * and stops. #493 fixed the shape: before "はじめに" comes a "前提" section with
 * four fixed bullets — what school already taught, where in the course
 * material this sits, a one-digit worked example, and the words in plain
 * language. The same four bullets in English.
 *
 * This test is the machine-checkable half of #493's acceptance criteria. It
 * covers every `ac26-*` problem in the catalog: the two Bridge 0 diagnostics
 * (`ac26-bridge-experiment`, `ac26-bridge-properties`), Weeks 1–6 (34
 * problems), and — since 2026-08-24 — the two Week 7 capstones as well.
 *
 * Week 7's "教材のどこ" bullet cannot name a lecture slide or assignment
 * function the way Weeks 1–6 do: `courseAlignment.sources` pins the upstream
 * repository's `README.md` with `kind: "roadmap"` because no `week7/`
 * directory exists there (see the publication table in `curriculum.md`). The
 * bullet names that pin honestly instead of pretending to a course section
 * that does not exist — a roadmap line is a real, checkable citation, just a
 * thin one. If `week7/` is ever published upstream, replace the citation with
 * the real material; do not drop the section.
 *
 * EXCLUDE lists a problem out of this contract only with a reason attached.
 * There are currently none — every ac26-* directory in `challenges/` is
 * covered.
 */

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
const CHALLENGES = join(REPO_ROOT, "challenges");

// problemId -> reason. Keep empty unless a specific ac26-* problem genuinely
// cannot carry this section (e.g. it is withdrawn). Excluding a problem here
// must not be how a hard case gets out of the contract — fix the problem
// instead, the way Bridge 0 and Week 7 were fixed rather than excluded.
const EXCLUDE: Record<string, string> = {};

const problems = readdirSync(CHALLENGES)
  .filter((name) => name.startsWith("ac26-") && !(name in EXCLUDE))
  .sort();

const JA_HEADING = "## 前提 — 中学・高校の数学から";
const EN_HEADING = "## Before you start — from school math";
const JA_BULLETS = ["**学校で習ったこと**", "**教材のどこ**", "**1 桁の例**", "**言葉**"];
const EN_BULLETS = ["**What you already know**", "**Where in the course**", "**A one-digit example**", "**Words**"];
const JA_NEXT = "## はじめに";
const EN_NEXT = "## Start here";

function section(text: string, heading: string, next: string): string {
  const i = text.indexOf(heading);
  if (i < 0) return "";
  const j = text.indexOf(next, i);
  return j < 0 ? text.slice(i) : text.slice(i, j);
}

describe("ac26 problems start from school math (#493)", () => {
  it("covers the expected problems", () => {
    expect(problems.length).toBeGreaterThanOrEqual(38);
  });

  for (const id of problems) {
    const meta = JSON.parse(readFileSync(join(CHALLENGES, id, "metadata.json"), "utf8"));
    const ja: string = meta.instructions ?? "";
    const en: string = meta.i18n?.en?.instructions ?? "";

    describe(id, () => {
      it("ja instructions open with the 前提 section, before はじめに", () => {
        expect(ja.trimStart().startsWith(JA_HEADING)).toBe(true);
        expect(ja.indexOf(JA_HEADING)).toBeLessThan(ja.indexOf(JA_NEXT));
        const pre = section(ja, JA_HEADING, JA_NEXT);
        for (const b of JA_BULLETS) expect(pre).toContain(b);
      });

      it("en instructions open with the Before-you-start section, before Start here", () => {
        expect(en.trimStart().startsWith(EN_HEADING)).toBe(true);
        expect(en.indexOf(EN_HEADING)).toBeLessThan(en.indexOf(EN_NEXT));
        const pre = section(en, EN_HEADING, EN_NEXT);
        for (const b of EN_BULLETS) expect(pre).toContain(b);
      });

      it("the one-digit example is a concrete example, not a restatement", () => {
        // Concrete means: it names actual numbers and is long enough to have worked something.
        const pre = section(ja, JA_HEADING, JA_NEXT);
        const line = pre.split("\n").find((l) => l.includes("**1 桁の例**")) ?? "";
        expect(/\d/.test(line)).toBe(true);
        expect(line.length).toBeGreaterThan(60);
      });
    });
  }
});
