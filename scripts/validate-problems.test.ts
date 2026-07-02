import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "bun:test";
import { checkRequiredReadmes } from "./validate-problems";

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
