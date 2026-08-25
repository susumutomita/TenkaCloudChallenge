import { globSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { copySources, stages } from "./dockerfile-stages";

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

/**
 * The same problems, as paths to their verifier — derived from the directory list so the
 * two stay in the same order. Sorting the full paths would not: `ac26-w3-schnorr-drill/`
 * sorts before `ac26-w3-schnorr/` as a path (`-` < `/`) and after it as a name.
 */
export function localPlayVerifiers(repoRoot: string): readonly string[] {
  return localPlayProblemDirs(repoRoot).map((dir) => `${dir}/local/verifier/server.py`);
}

/** The stage a learner's `make build` produces — kept in sync with the guard that owns it. */
const PARTICIPANT_STAGE = "participant";

/**
 * Every Python file one problem's participant stage copies in, as repo-root-relative paths.
 *
 * Derived from the `participant` stage's own COPY sources rather than a hand-written glob
 * pair, for the reason `author-artifact-separation.test.ts` derives its combined
 * `PARTICIPANT_SOURCES` the same way: a hand-written list drifts from what the Dockerfile
 * actually ships (it missed `local/show.py` once), and this cannot, because it reads the
 * same COPY lines a learner's `docker build` does. `check-answer-reachability.test.ts` needs
 * this per-problem rather than flattened across the whole catalog, to ask "reachable from
 * *this* problem's image" instead of "reachable from some image somewhere".
 */
export function participantPythonFiles(repoRoot: string, dir: string): readonly string[] {
  const relativeDockerfile = `${dir}/local/Dockerfile`;
  const parsed = stages(readFileSync(join(repoRoot, relativeDockerfile), "utf8"));
  const sources = copySources(parsed.get(PARTICIPANT_STAGE) ?? "");
  const local = `${dir}/local`;
  return [
    ...new Set(
      sources.flatMap((source) => {
        const cleaned = source.replace(/^\.\//, "").replace(/\/$/, "");
        return globSync(`${local}/${cleaned}/**/*.py`, { cwd: repoRoot }).concat(
          cleaned.endsWith(".py") ? [`${local}/${cleaned}`] : [],
        );
      }),
    ),
  ].sort();
}
