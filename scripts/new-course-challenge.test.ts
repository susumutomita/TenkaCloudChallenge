import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "bun:test";
import {
  PROBLEM_ID_PATTERN,
  ScaffoldError,
  scaffold,
  scaffoldMetadata,
  suggestedOrder,
  weekOf,
} from "./new-course-challenge";

const REPO_ROOT = join(import.meta.dir, "..");
const TEMPLATE_ID = "ac26-bridge-experiment";
const temporaryDirectories: string[] = [];

/** A throwaway `challenges/` containing only the template, so scaffolding cannot touch the repo. */
function isolatedChallengesDir(): string {
  const directory = mkdtempSync(join(tmpdir(), "ac26-scaffold-"));
  temporaryDirectories.push(directory);
  cpSync(join(REPO_ROOT, "challenges", TEMPLATE_ID), join(directory, TEMPLATE_ID), {
    recursive: true,
  });
  return directory;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("problem id validation", () => {
  it.each(["ac26-w3-field-inverse", "ac26-bridge-experiment", "abc"])(
    "should accept %s",
    (id) => {
      expect(PROBLEM_ID_PATTERN.test(id)).toBe(true);
    },
  );

  it.each(["-leading", "trailing-", "Upper", "has space", "a", "with/slash", "../escape"])(
    "should reject %s",
    (id) => {
      expect(PROBLEM_ID_PATTERN.test(id)).toBe(false);
    },
  );

  it("should refuse to scaffold an invalid id", () => {
    expect(() => scaffold("../escape", isolatedChallengesDir())).toThrow(ScaffoldError);
  });

  it("should refuse to overwrite an existing problem", () => {
    const challenges = isolatedChallengesDir();
    expect(() => scaffold(TEMPLATE_ID, challenges)).toThrow("already exists");
  });
});

describe("track order suggestion", () => {
  it.each([
    ["ac26-w1-circuit-lab", 100],
    ["ac26-w3-field-inverse", 300],
    ["ac26-w7-capstone-build", 700],
    ["ac26-bridge-experiment", 10],
    ["some-other-problem", 10],
  ])("should suggest %s -> %i", (id, expected) => {
    expect(suggestedOrder(id)).toBe(expected);
  });

  it.each([
    ["ac26-w4-commit-open", 4],
    ["ac26-bridge-properties", undefined],
    ["ac26-w0-something", undefined],
  ])("should derive the week of %s", (id, expected) => {
    expect(weekOf(id)).toBe(expected);
  });
});

describe("metadata scaffolding", () => {
  function templateMetadata(): string {
    return readFileSync(join(REPO_ROOT, "challenges", TEMPLATE_ID, "metadata.json"), "utf8");
  }

  it("should retarget the id and every node ID that embeds it", () => {
    const meta = JSON.parse(scaffoldMetadata(templateMetadata(), "ac26-w3-field-inverse")) as {
      id: string;
      nodes: { learning_objectives: Array<{ id: string }>; assessment_criteria: Array<{ id: string }> };
      relations: Array<{ source: string; target: string }>;
    };

    expect(meta.id).toBe("ac26-w3-field-inverse");
    for (const node of [...meta.nodes.learning_objectives, ...meta.nodes.assessment_criteria]) {
      expect(node.id).toContain("ac26-w3-field-inverse");
      expect(node.id).not.toContain(TEMPLATE_ID);
    }
    for (const relation of meta.relations) {
      expect(`${relation.source}${relation.target}`).not.toContain(TEMPLATE_ID);
    }
  });

  it("should leave shared concept and misconception IDs untouched", () => {
    const meta = JSON.parse(scaffoldMetadata(templateMetadata(), "ac26-w3-field-inverse")) as {
      nodes: { concepts: Array<{ id: string }>; misconceptions: Array<{ id: string }> };
    };

    // These are catalog-wide IDs; renaming them per problem would fragment the graph.
    expect(meta.nodes.concepts.map((node) => node.id)).toContain("concept.modular-arithmetic");
    expect(meta.nodes.misconceptions.map((node) => node.id)).toContain(
      "misconception.public-tests-are-complete",
    );
  });

  it("should mark the scaffold as needing authoring rather than shipping the template's story", () => {
    const meta = JSON.parse(scaffoldMetadata(templateMetadata(), "ac26-w3-field-inverse")) as {
      name: string;
      status: string;
      track: { order: number; chapter: string };
    };

    expect(meta.name).toContain("TODO");
    expect(meta.status).toBe("draft");
    expect(meta.track.order).toBe(300);
    expect(meta.track.chapter).toContain("TODO");
  });
});

describe("scaffold", () => {
  it("should produce a complete problem directory", () => {
    const challenges = isolatedChallengesDir();
    const target = scaffold("ac26-w3-field-inverse", challenges);

    for (const path of [
      "metadata.json",
      "README.md",
      "README.ja.md",
      "Makefile",
      "local/docker-compose.yml",
      "local/Dockerfile",
      "local/starter/counter.py",
      "local/reference/counter.py",
      "local/verifier/server.py",
      "local/mutation.py",
    ]) {
      expect(existsSync(join(target, path))).toBe(true);
    }
  });

  it("should retarget the image name in the Makefile so two problems cannot collide", () => {
    const challenges = isolatedChallengesDir();
    const target = scaffold("ac26-w3-field-inverse", challenges);

    const makefile = readFileSync(join(target, "Makefile"), "utf8");
    expect(makefile).toContain("IMAGE := ac26-w3-field-inverse");
    expect(makefile).not.toContain(TEMPLATE_ID);
  });

  it("should not modify the template it copied from", () => {
    const challenges = isolatedChallengesDir();
    const before = readFileSync(join(challenges, TEMPLATE_ID, "metadata.json"), "utf8");

    scaffold("ac26-w3-field-inverse", challenges);

    expect(readFileSync(join(challenges, TEMPLATE_ID, "metadata.json"), "utf8")).toBe(before);
  });

  it("should produce metadata that still parses as JSON", () => {
    const challenges = isolatedChallengesDir();
    const target = scaffold("ac26-w5-lwe-rlwe", challenges);

    expect(() =>
      JSON.parse(readFileSync(join(target, "metadata.json"), "utf8")),
    ).not.toThrow();
  });
});
