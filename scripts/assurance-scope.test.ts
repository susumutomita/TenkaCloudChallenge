import { readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { describe, expect, it } from "bun:test";
import { localPlayProblemDirs } from "./lib/local-play-problems";

/**
 * Catalog-wide guard on what local mode is allowed to claim about itself.
 *
 * The arrangement is: the participant's submission, `tests/hidden/`, `reference/`, and the
 * mutation suite all live in one Docker image, and the participant owns the machine, the
 * daemon, and the image. Everything follows from that. `reference/` not being bind-mounted
 * keeps it out of the learner's git checkout; it does not keep it from someone who wants to
 * look, and the verifier's child process loads the submission and the hidden checker into
 * one Python module graph.
 *
 * That is fine — local mode is self-paced honor-system verification and says so. What is
 * not fine is wording that reads as a confidentiality or tamper-resistance guarantee,
 * because a reader who believes it might put a local result behind a competition ranking or
 * a completion certificate. Every AC26 problem said exactly that ("a learner cannot read
 * the answer") until #271, so this is a guard against a claim that has already drifted once.
 *
 * The remaining structural work — separating author-only artifacts out of the
 * participant-facing image, and running the submission outside the checker's process — is
 * tracked in #271. This file only holds the line on what is claimed.
 */

const REPO_ROOT = new URL("..", import.meta.url).pathname;
const TEMPLATE = join(REPO_ROOT, "docs/curricula/advanced-cryptography-2026/TEMPLATE.md");

const PROBLEM_DIRS = localPlayProblemDirs(REPO_ROOT);

/**
 * Wording that asserts more than the arrangement can deliver. Each of these was in the
 * catalog before #271 and each reads as a security boundary rather than as tidiness.
 */
const OVERSTATED = [
  /cannot read the answer/i,
  /never mounted/i,
  /never reaches the host/i,
  /hidden tests are (?:confidential|secret)/i,
  /tamper[- ]resistant/i,
] as const;

function read(path: string): string {
  return readFileSync(join(REPO_ROOT, path), "utf8");
}

describe("local-play assurance scope", () => {
  it("should find problems to check, so a glob matching nothing cannot pass", () => {
    expect(PROBLEM_DIRS.length).toBeGreaterThan(0);
  });

  describe("TEMPLATE.md", () => {
    const template = readFileSync(TEMPLATE, "utf8");

    it("should carry an assurance-scope section, since it is the normative source", () => {
      expect(template).toContain("## Assurance scope");
    });

    it("should state that the participant controls the host, the daemon and the image", () => {
      // The one fact every limitation follows from. Without it the section is a list of
      // caveats a reader can talk themselves out of.
      expect(template).toMatch(/participant owns the machine, the Docker daemon, and the image/i);
    });

    it("should name what local results may not stand behind", () => {
      for (const use of ["Competition ranking", "examination", "certification"]) {
        expect(template.toLowerCase()).toContain(use.toLowerCase());
      }
    });

    it("should link the issue tracking trusted verification", () => {
      expect(template).toContain("issues/271");
    });
  });

  for (const dir of PROBLEM_DIRS) {
    describe(basename(dir), () => {
      it("should carry an assurance-scope section in both languages", () => {
        // Participant-facing, because the participant is the one who might otherwise
        // mistake a local pass for a graded one.
        expect(read(`${dir}/README.md`)).toContain("## Assurance scope");
        expect(read(`${dir}/README.ja.md`)).toContain("## 保証範囲");
      });

      it("should say plainly that local mode is honor-system verification", () => {
        expect(read(`${dir}/README.md`)).toMatch(/honor-system verification/i);
        expect(read(`${dir}/README.ja.md`)).toContain("honor-system");
      });

      it("should refuse the competition, examination and certification claims", () => {
        expect(read(`${dir}/README.md`)).toMatch(
          /does \*\*not\*\* support competition ranking,\s*\n?\s*examination, or completion certification/i,
        );
        expect(read(`${dir}/README.ja.md`)).toContain("競技順位・試験・修了判定は**支えません**");
      });

      it("should never claim the reference or the hidden tests are out of reach", () => {
        // The Dockerfile and Makefile comments are where the claim lived, and where an
        // author scaffolding from a sibling problem would copy it forward again.
        for (const file of [
          `${dir}/README.md`,
          `${dir}/README.ja.md`,
          `${dir}/Makefile`,
          `${dir}/local/Dockerfile`,
        ]) {
          const text = read(file);
          for (const pattern of OVERSTATED) {
            expect(text).not.toMatch(pattern);
          }
        }
      });

      it("should point at the assurance scope from the files that describe the layout", () => {
        // A future author reads the Dockerfile comment, not this test. The pointer is what
        // keeps the correction from being undone by the next copy-paste.
        expect(read(`${dir}/local/Dockerfile`)).toContain('TEMPLATE.md "Assurance scope"');
        expect(read(`${dir}/Makefile`)).toContain('TEMPLATE.md "Assurance scope"');
      });
    });
  }
});
