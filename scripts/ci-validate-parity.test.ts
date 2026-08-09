import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * CI が `bun run validate` から取りこぼしていないか (Issue 382)。
 *
 * ## なぜこの test が要るか
 *
 * `bun run validate` は検査を 1 本の chain で並べているが、`.github/workflows/ci.yml` の
 * `checks` job は同じ検査を **step ごとに手で並べ直している**。失敗した検査名がそのまま
 * check 名として出るという利点があるかわりに、片方だけ増える形になっていた。
 *
 * 実際にずれていた。Issue 395 / 396 の検出器 (`check-participant-surface.ts`) と
 * `generate-course-workbenches.py --check` は `validate` にはあり、CI には無かった。
 * つまり「ローカルで `make validate` を回した人だけが気付く」状態で、Issue 382 が
 * 落としたい「人がレビューで気づく前に落ちる」に一致しない。
 *
 * この test は chain の各コマンドが CI のどこかに現れることを機械で見る。CI 側が
 * `bun run check:participant-surface` のような alias を使っていてもよいように、
 * package.json の script 名は展開してから突き合わせる。
 *
 * ## 除外について
 *
 * shard の test suite (`scripts/*.test.ts`) が実行している検査は、CI の step としては
 * 現れない。除外は **理由付きでここに列挙**する形にしてあり、黙って通る経路は無い。
 */

const ROOT = join(import.meta.dir, "..");
const SCRIPT_PATH_RE = /scripts\/[\w./-]+\.(?:ts|py)/g;

interface PackageJson {
  readonly scripts: Readonly<Record<string, string>>;
}

/**
 * shard の test suite が代わりに担保している検査。
 *
 * 除外の条件は「CI で実際に走っている別経路がある」ことだけで、「重いから」「落ちるから」
 * は理由にならない。
 */
const COVERED_BY_SUITE: Readonly<Record<string, string>> = {
  "scripts/solvability-audit.ts":
    "scripts/solvability-audit.test.ts が shard 内で --seeds 500 の実行を回しており、" +
    "static pass はその部分集合。",
};

/** `bun run <name>` を package.json の定義で展開する (alias 越しでも同じ物として扱うため)。 */
export function expandScriptAliases(
  command: string,
  scripts: Readonly<Record<string, string>>,
  depth = 0,
): string {
  if (depth > 5) return command;
  return command.replace(/bun run ([\w:.@/-]+)/g, (match, name: string) => {
    const body = scripts[name];
    return body ? `${match} ${expandScriptAliases(body, scripts, depth + 1)}` : match;
  });
}

/** chain を `&&` で分解する。`||` は使われていないので単純分割でよい。 */
export function chainCommands(chain: string): string[] {
  return chain
    .split("&&")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

describe("CI と bun run validate の対応 (Issue 382)", () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as PackageJson;
  const ci = readFileSync(join(ROOT, ".github/workflows/ci.yml"), "utf8");
  const expandedCi = expandScriptAliases(ci, pkg.scripts);

  it("should run every command of the validate chain somewhere in ci.yml", () => {
    const missing: string[] = [];
    for (const command of chainCommands(pkg.scripts.validate ?? "")) {
      const expanded = expandScriptAliases(command, pkg.scripts);
      const paths = [...new Set(expanded.match(SCRIPT_PATH_RE) ?? [])];
      if (paths.length === 0) {
        // scripts/ を指さない検査 (別 workspace の test など) は、alias 名そのもので照合する。
        if (!expandedCi.includes(command)) missing.push(command);
        continue;
      }
      const uncovered = paths.filter(
        (path) => !expandedCi.includes(path) && !(path in COVERED_BY_SUITE),
      );
      if (uncovered.length > 0) missing.push(`${command}  (${uncovered.join(", ")})`);
    }
    expect(
      missing,
      `ci.yml に現れない validate の検査があります。step を足すか、shard の test が代わりに` +
        ` 担保しているなら COVERED_BY_SUITE に理由付きで足してください:\n  ${missing.join("\n  ")}`,
    ).toEqual([]);
  });

  it("should not carry a stale exemption for a check CI already runs", () => {
    // 除外が残ったまま CI 側に step が足されると、除外の一覧が実態と食い違って読み手を誤らせる。
    const stale = Object.keys(COVERED_BY_SUITE).filter((path) => expandedCi.includes(path));
    expect(stale).toEqual([]);
  });

  it("should keep the per-problem shipping gate itself in CI", () => {
    // Issue 382 の受け入れ基準そのもの。ここが外れると「解けない問題がマージできない」が
    // 静かに成立しなくなる。
    expect(expandedCi).toContain("scripts/check-problem.ts");
  });
});
