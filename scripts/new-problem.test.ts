import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "bun:test";
import { localPlayableCheck, participantSurfaceCheck, schemaCheck } from "./check-problem";
import { parseArgs, scaffoldProblem } from "./new-problem";
import { checkRequiredReadmes } from "./validate-problems";

// #135 remaining item: prove the scaffold path always emits both READMEs, so a
// new problem passes `checkRequiredReadmes` the moment it is created — the CI
// gate can never be defeated by scaffolding from a starter that lost its JA
// mirror. Scaffolding is a recursive copy of a starter, and the main validator
// already enforces both READMEs on *every* catalog problem, so `--from <any
// existing problem>` is covered transitively; here we pin the two defaults the
// `bun run new` script resolves to when no `--from` is given.
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_STARTERS = [
  { category: "challenges", starter: "hello-world" },
  { category: "battles", starter: "hello-world-battle" },
] as const;

const temporaryDirectories: string[] = [];

function scratchRoot(): string {
  const directory = mkdtempSync(join(tmpdir(), "tenkacloud-scaffold-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("new-problem scaffold ships both READMEs", () => {
  for (const { category, starter } of DEFAULT_STARTERS) {
    it(`the default ${category} starter (${starter}) satisfies the README contract`, () => {
      expect(checkRequiredReadmes(join(REPO_ROOT, category, starter))).toEqual([]);
    });

    it(`scaffolding a new ${category} emits both READMEs that pass the validator`, () => {
      const parsed = parseArgs([category, `scaffold-smoke-${starter}`]);
      if ("error" in parsed) throw new Error(parsed.error);
      // from defaults to the category's starter (== `starter`), so this
      // exercises the real `bun run new <category> <id>` resolution.
      expect(parsed.from).toBe(starter);

      const dest = scaffoldProblem(parsed, { srcRoot: REPO_ROOT, destRoot: scratchRoot() });

      expect(existsSync(join(dest, "README.md"))).toBe(true);
      expect(existsSync(join(dest, "README.ja.md"))).toBe(true);
      expect(checkRequiredReadmes(dest)).toEqual([]);
    });
  }
});

/**
 * 雛形が出荷ゲートを最初から満たすか (Issue 382)。
 *
 * 「問題作成テンプレートが、最初から検査を満たす雛形を吐く」が受け入れ基準にある。starter が
 * 検査に落ちる形になると、`bun run new` した人は自分が壊したのか元から壊れていたのか区別
 * できず、検査を無視する動機になる。実 deploy を伴わない 3 つをここで固定する
 * (solvability の静的監査は course checkpoint 型だけが対象で、starter は対象外)。
 */
describe("new-problem scaffold passes the shipping gate", () => {
  for (const { category, starter } of DEFAULT_STARTERS) {
    it(`a scaffolded ${category} passes schema / participant surface out of the box`, () => {
      const parsed = parseArgs([category, `gate-smoke-${starter}`]);
      if ("error" in parsed) throw new Error(parsed.error);
      const dest = scaffoldProblem(parsed, { srcRoot: REPO_ROOT, destRoot: scratchRoot() });

      expect(schemaCheck(dest)).toMatchObject({ status: "pass" });
      expect(participantSurfaceCheck(dest)).toMatchObject({ status: "pass" });
      // starter が local/ を持つかは starter 次第。どちらでも「落ちない」ことだけを固定する。
      expect(localPlayableCheck(dest).status).not.toBe("fail");
    });
  }
});
