import { globSync } from "node:fs";
import { dirname } from "node:path";

/**
 * Which problems the local-play template contract applies to.
 *
 * Three catalog-wide guards — the assurance-scope wording, the participant `make` contract,
 * and the verifier verdict-spoofing fix — used to select their subjects with
 * `challenges/ac26-*`, because at the time every template-contract problem happened to be an
 * AC26 companion. That is a coincidence of naming, not the invariant: what makes those guards
 * apply is the arrangement (a verifier that runs learner code, a hidden suite and a reference
 * inside the image, a shared `make` contract), and a problem outside the AC26 track can be
 * built exactly that way. The first one that was, `sha256-bytes-padding`, would have sat
 * outside all three guards while shipping all three of the failure modes they exist to catch.
 *
 * So select on the structure instead. `local/verifier/server.py` is the marker: it is what
 * makes a problem one of these, and it cannot be present without the rest of the arrangement.
 * A problem with a `local/` directory but no verifier (`ai-riscv-*`, `wp2shell-local-lab`)
 * follows a different contract and is correctly excluded.
 */
export function localPlayProblemDirs(repoRoot: string): readonly string[] {
  return globSync("challenges/*/local/verifier/server.py", { cwd: repoRoot })
    .map((relative) => dirname(dirname(dirname(relative))))
    .sort();
}

/** The same problems, as paths to their verifier. */
export function localPlayVerifiers(repoRoot: string): readonly string[] {
  return globSync("challenges/*/local/verifier/server.py", { cwd: repoRoot }).sort();
}
