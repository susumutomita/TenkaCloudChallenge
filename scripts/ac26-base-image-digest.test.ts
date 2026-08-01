import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";

const REPO_ROOT = join(import.meta.dir, "..");
const CHALLENGES_ROOT = join(REPO_ROOT, "challenges");
const RESOLVABLE_PYTHON_INDEX_DIGEST =
  "sha256:6771159cd4fa5d9bba1258caf0b82e6b73458c694d178ad97c5e925c2d0e1a91";

function ac26Dockerfiles(): string[] {
  return readdirSync(CHALLENGES_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith("ac26-"))
    .map((entry) => join(CHALLENGES_ROOT, entry.name, "local", "Dockerfile"));
}

describe("AC26 container base image", () => {
  it("pins every AC26 Dockerfile to the verified multi-platform Python index", () => {
    const dockerfiles = ac26Dockerfiles();
    expect(dockerfiles.length).toBeGreaterThan(0);

    const mismatches = dockerfiles
      .filter((path) => !readFileSync(path, "utf8").includes(`python:3.13-slim@${RESOLVABLE_PYTHON_INDEX_DIGEST}`))
      .map((path) => path.slice(REPO_ROOT.length + 1));

    expect(mismatches).toEqual([]);
  });
});
