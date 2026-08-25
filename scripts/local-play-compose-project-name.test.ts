import { globSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import { parse as parseYaml } from "yaml";

/**
 * Every local-play compose file must declare its own Compose project `name:` (Issue 521).
 *
 * Docker Compose falls back to the *current directory's basename* as the project name
 * when neither `name:` nor `COMPOSE_PROJECT_NAME` is set. Every problem in this catalog
 * names its local-play directory `local/`, so 94 unrelated compose files all resolved to
 * the same project, `local`. Two problems started at once collide under that one name,
 * and `docker compose down --remove-orphans` — the command this repository's own
 * `make local` / `make reset` instructions tell participants to run — treats the other
 * problem's containers as orphans of *its own* project and removes them. This happened
 * for real during authoring work on this repository (`stackstack-ship`'s teardown took
 * down an unrelated `db-a11-replication-lag` primary/replica pair) and is reproducible on
 * demand (see the Issue #521 comment thread for the experiment). It is not
 * agent-specific: Database Track drills (#431) ask participants to run two problems at
 * once by design, and a participant who leaves one problem up while trying another hits
 * the exact same collision.
 *
 * `name:` fixes this unconditionally because it is read by `docker compose` itself,
 * regardless of who invokes it or how (`make`, a raw `docker compose` command, CI). The
 * fix is only real if it reaches every problem, so this guard checks structurally —
 * every `local/docker-compose.yml` under `challenges/` and `battles/` — rather than by
 * name, the same way `local-play-publish-reachability.test.ts` does. A problem added
 * tomorrow is covered the day it lands, and one added without `name:` fails immediately
 * instead of surviving until it collides with something at runtime.
 */

const REPO_ROOT = new URL("..", import.meta.url).pathname;

interface ComposeFile {
  name?: unknown;
}

const COMPOSE_FILES = [
  ...globSync("challenges/*/local/docker-compose.yml", { cwd: REPO_ROOT }),
  ...globSync("battles/*/local/docker-compose.yml", { cwd: REPO_ROOT }),
].sort();

/** `challenges/<problem-id>/local/docker-compose.yml` -> `<problem-id>`. */
function problemId(relativePath: string): string {
  const id = relativePath.split("/")[1];
  if (id === undefined) throw new Error(`unexpected compose path shape: ${relativePath}`);
  return id;
}

function compose(relativePath: string): ComposeFile {
  return (parseYaml(readFileSync(join(REPO_ROOT, relativePath), "utf8")) as ComposeFile) ?? {};
}

describe("local-play compose files declare an isolated project name", () => {
  it("should find compose files to check, so a glob matching nothing cannot pass", () => {
    expect(COMPOSE_FILES.length).toBeGreaterThan(0);
  });

  it.each(COMPOSE_FILES)("%s should declare name: matching its problem id", (relativePath) => {
    const file = compose(relativePath);
    expect(
      typeof file.name === "string" && file.name.length > 0,
      `${relativePath}: no top-level "name:" declared. Without it, Compose falls back to the ` +
        'directory basename ("local" for every problem here), so this problem\'s containers ' +
        "collide with every other problem's under the same project name, and " +
        "`docker compose down --remove-orphans` in one problem removes the other's containers " +
        "(Issue 521). Add `name: " +
        problemId(relativePath) +
        "` near the top of the file.",
    ).toBe(true);
    expect(
      file.name,
      `${relativePath}: declares name: ${JSON.stringify(file.name)}, but its problem id is ` +
        `"${problemId(relativePath)}". A name that does not match its own directory either ` +
        "collides with another problem's project or stops identifying which problem is " +
        "running in `docker ps`.",
    ).toBe(problemId(relativePath));
  });
});
