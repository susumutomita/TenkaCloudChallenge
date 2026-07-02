import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "bun:test";
import { checkRequiredReadmes, checkScoringRegulation } from "./validate-problems";

const temporaryDirectories: string[] = [];

function problemDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "tenkacloud-readmes-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("checkRequiredReadmes", () => {
  it("should accept non-empty English and Japanese README files", () => {
    const directory = problemDirectory();
    writeFileSync(join(directory, "README.md"), "# English\n");
    writeFileSync(join(directory, "README.ja.md"), "# 日本語\n");

    expect(checkRequiredReadmes(directory)).toEqual([]);
  });

  it("should reject a missing English README", () => {
    const directory = problemDirectory();
    writeFileSync(join(directory, "README.ja.md"), "# 日本語\n");

    expect(checkRequiredReadmes(directory)).toContainEqual(expect.stringContaining("README.md"));
  });

  it("should reject a missing Japanese README", () => {
    const directory = problemDirectory();
    writeFileSync(join(directory, "README.md"), "# English\n");

    expect(checkRequiredReadmes(directory)).toContainEqual(
      expect.stringContaining("README.ja.md"),
    );
  });

  it("should reject empty and directory placeholders", () => {
    const directory = problemDirectory();
    writeFileSync(join(directory, "README.md"), " \n");
    mkdirSync(join(directory, "README.ja.md"));

    const errors = checkRequiredReadmes(directory);
    expect(errors).toContainEqual(expect.stringContaining("README.md must not be empty"));
    expect(errors).toContainEqual(expect.stringContaining("README.ja.md must be a regular file"));
  });

  it("should reject a symbolic link in place of a required README", () => {
    const directory = problemDirectory();
    writeFileSync(join(directory, "source.md"), "# Shared\n");
    symlinkSync(join(directory, "source.md"), join(directory, "README.md"));
    writeFileSync(join(directory, "README.ja.md"), "# 日本語\n");

    expect(checkRequiredReadmes(directory)).toContainEqual(
      expect.stringContaining("README.md must be a regular file"),
    );
  });
});

describe("checkScoringRegulation", () => {
  const challenge = (difficulty: number, scoring: Record<string, unknown>) => ({
    category: "Challenge",
    difficulty,
    scoring,
  });

  it("accepts a conforming Easy verify problem (100 / waP 5 / hints sum 50)", () => {
    const meta = challenge(2, {
      kind: "verify",
      points: 100,
      wrongAnswerPenalty: 5,
      hints: [{ penalty: 20 }, { penalty: 30 }],
    });
    expect(checkScoringRegulation(meta)).toEqual([]);
  });

  it("accepts a conforming Medium flag problem (200 / waP 10 / hints sum 100)", () => {
    const meta = challenge(3, {
      kind: "flag",
      points: 200,
      wrongAnswerPenalty: 10,
      hints: [{ penalty: 20 }, { penalty: 30 }, { penalty: 50 }],
    });
    expect(checkScoringRegulation(meta)).toEqual([]);
  });

  it("rejects points that do not match the difficulty tier", () => {
    const meta = challenge(1, { kind: "flag", points: 150, wrongAnswerPenalty: 5, hints: [] });
    expect(checkScoringRegulation(meta)).toContainEqual(
      expect.stringContaining("Easy tier standard 100"),
    );
  });

  it("rejects a wrongAnswerPenalty that is not 5% of the base", () => {
    const meta = challenge(2, {
      kind: "verify",
      points: 100,
      wrongAnswerPenalty: 10,
      hints: [{ penalty: 20 }, { penalty: 30 }],
    });
    expect(checkScoringRegulation(meta)).toContainEqual(
      expect.stringContaining("wrongAnswerPenalty"),
    );
  });

  it("rejects hint penalties summing to more than 50% of the base", () => {
    const meta = challenge(2, {
      kind: "verify",
      points: 100,
      wrongAnswerPenalty: 5,
      hints: [{ penalty: 30 }, { penalty: 40 }],
    });
    expect(checkScoringRegulation(meta)).toContainEqual(
      expect.stringContaining("exceeds 50% of points"),
    );
  });

  it("sums points and hint penalties across multi-flag checkpoints", () => {
    const ok = challenge(3, {
      kind: "multi-flag",
      flags: [
        { points: 100, hints: [{ penalty: 20 }, { penalty: 30 }] },
        { points: 100, hints: [{ penalty: 50 }] },
      ],
    });
    expect(checkScoringRegulation(ok)).toEqual([]);

    const overCap = challenge(3, {
      kind: "multi-flag",
      flags: [
        { points: 100, hints: [{ penalty: 40 }, { penalty: 40 }] },
        { points: 100, hints: [{ penalty: 40 }] },
      ],
    });
    expect(checkScoringRegulation(overCap)).toContainEqual(
      expect.stringContaining("exceeds 50% of points"),
    );
  });

  it("skips Battles (no fixed total)", () => {
    const battle = { category: "Battle", difficulty: 4, scoring: { kind: "phased-polling" } };
    expect(checkScoringRegulation(battle)).toEqual([]);
  });

  it("skips Challenges with no determinable point total (e.g. composite-probe)", () => {
    const meta = challenge(1, { kind: "composite-probe" });
    expect(checkScoringRegulation(meta)).toEqual([]);
  });
});
