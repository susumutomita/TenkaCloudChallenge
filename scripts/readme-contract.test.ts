import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "bun:test";
import { checkRequiredReadmes } from "./validate-problems";

// #135 copy-drift detector. `validate-problems.ts` is a *verbatim copy* shared
// with the platform (see .github/workflows/ci.yml). A shared behavioral contract
// — fixtures/readme-contract.json — pins what checkRequiredReadmes() must do.
// This test drives THIS repo's copy against that contract; the platform mirror
// (TenkaCloud#2254) ships the identical JSON + this harness and drives ITS copy.
// If either verbatim copy drifts (renamed error, dropped rule), that repo's CI
// fails here — so a one-sided edit to the validator can't merge silently.

interface FileSpec {
  readonly type: "file" | "dir" | "symlink";
  readonly content?: string;
  readonly target?: string;
}
interface ContractCase {
  readonly name: string;
  readonly files: Readonly<Record<string, FileSpec>>;
  readonly expectErrorSubstrings: readonly string[];
}

const CONTRACT_PATH = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "readme-contract.json");
const contract = JSON.parse(readFileSync(CONTRACT_PATH, "utf8")) as { cases: ContractCase[] };

const temporaryDirectories: string[] = [];

/** Materialize a case's files into a scratch dir (symlinks last so targets exist). */
function materialize(files: Readonly<Record<string, FileSpec>>): string {
  const directory = mkdtempSync(join(tmpdir(), "tenkacloud-readme-contract-"));
  temporaryDirectories.push(directory);
  const entries = Object.entries(files).sort(
    ([, a], [, b]) => Number(a.type === "symlink") - Number(b.type === "symlink"),
  );
  for (const [name, spec] of entries) {
    const path = join(directory, name);
    if (spec.type === "file") writeFileSync(path, spec.content ?? "");
    else if (spec.type === "dir") mkdirSync(path);
    else symlinkSync(join(directory, spec.target ?? ""), path);
  }
  return directory;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("README contract (shared drift detector — TenkaCloud#2254 mirrors this)", () => {
  it("ships the canonical case set (guard against an emptied contract)", () => {
    expect(contract.cases.length).toBeGreaterThanOrEqual(6);
  });

  for (const testCase of contract.cases) {
    it(`case: ${testCase.name}`, () => {
      const errors = checkRequiredReadmes(materialize(testCase.files));
      if (testCase.expectErrorSubstrings.length === 0) {
        expect(errors).toEqual([]);
      } else {
        for (const substring of testCase.expectErrorSubstrings) {
          expect(errors.some((error) => error.includes(substring))).toBe(true);
        }
      }
    });
  }
});
