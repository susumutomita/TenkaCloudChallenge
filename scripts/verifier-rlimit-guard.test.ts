import { readFileSync } from "node:fs";
import { globSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";

/**
 * Catalog-wide invariant for every local-play verifier that caps address space.
 *
 * `preexec_fn` runs in the child between fork and exec, so anything it raises
 * aborts the exec and the submission never runs at all — the verifier then reports
 * a failed checkpoint for code that was never executed, including the reference.
 * Darwin aliases RLIMIT_AS onto RLIMIT_RSS and refuses to set it while still
 * reporting RLIM_INFINITY, so an unconditional `setrlimit(RLIMIT_AS, ...)` makes
 * every checkpoint fail on a macOS checkout (#255).
 *
 * Per-problem tests cannot hold this line. `bun run new-course-challenge` copies
 * a whole problem directory, so a fix to the template does not reach a branch that
 * was cut before it landed — this bug reached main three separate times that way,
 * once per problem authored in parallel. This test is deliberately catalog-wide and
 * pattern-based: a new problem carrying an unguarded copy fails here on its own PR,
 * whether or not anyone remembered to look.
 *
 * It reads source rather than executing it, so it costs nothing and does not depend
 * on the host platform.
 */

const REPO_ROOT = new URL("..", import.meta.url).pathname;
const VERIFIERS = globSync("challenges/*/local/verifier/server.py", { cwd: REPO_ROOT }).sort();

describe("local-play verifier resource caps", () => {
  it("should find verifiers to check, so a glob that silently matches nothing cannot pass", () => {
    expect(VERIFIERS.length).toBeGreaterThan(0);
  });

  for (const relative of VERIFIERS) {
    const source = readFileSync(join(REPO_ROOT, relative), "utf8");
    if (!source.includes("RLIMIT_AS")) continue;

    it(`should guard the address-space cap by platform in ${relative}`, () => {
      // The cap must be reachable only where it can actually be applied. Without
      // the guard the failure is silent and deceptive: it presents as a broken
      // problem rather than a broken cap.
      expect(source).toContain("_ADDRESS_SPACE_CAPPABLE");
      expect(source).toMatch(/_ADDRESS_SPACE_CAPPABLE\s*=\s*sys\.platform\.startswith\("linux"\)/);
      expect(source).toMatch(
        /if _ADDRESS_SPACE_CAPPABLE:\s*\n\s*resource\.setrlimit\(resource\.RLIMIT_AS/,
      );
    });

    it(`should keep the caps the guard does not cover in ${relative}`, () => {
      // Removing the address-space cap entirely would also make this file "pass"
      // a naive check, so assert the other two caps are still unconditional.
      expect(source).toContain("resource.RLIMIT_NPROC");
      expect(source).toContain("resource.RLIMIT_FSIZE");
    });
  }
});
