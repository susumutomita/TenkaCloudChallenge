#!/usr/bin/env bun
/**
 * `local/verifier/workbench.py` の vendoring 不変条件を守る gate。
 *
 * この repo の問題は 1 問ずつ独立して deploy できなければならない。 だから
 * `PortalEditorSupport` を共有 package に切り出さず、 各問題へ同じ実装を複製している。
 * 複製は重複ではなく **仕様**である。
 *
 * 仕様である以上、 全複製が同一であることは誰かが保証しないといけない。 保証が無いと:
 *
 *   - 1 問だけ手で直した修正が他の問題に届かず、 問題ごとに挙動が違う workbench ができる
 *   - どれが正しい版か分からなくなり、 再配布のたびにどれかが巻き戻る
 *   - 「複製だから触っていい」 と 「複製だから揃えないといけない」 の区別が消える
 *
 * 揃っていることを人が見て回るのは無理なので、 ここで落とす。
 *
 * この gate は中身を判定しない。 「全部同じか」 だけを見る。 実装を変えたいときは 1 箇所を
 * 直して全複製へ配り直す — その配り直しが漏れたことを、 この gate が検出する。
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, relative } from "node:path";

const REPO_ROOT = new URL("..", import.meta.url).pathname;
const CATEGORY_DIRS = ["battles", "challenges"] as const;
const VENDORED_PATH = join("local", "verifier", "workbench.py");

export interface VendoredCopy {
  readonly path: string;
  readonly digest: string;
}

/** `<category>/<problem>/local/verifier/workbench.py` を持つ問題を列挙する。 */
export function findVendoredCopies(root: string): VendoredCopy[] {
  const copies: VendoredCopy[] = [];
  for (const category of CATEGORY_DIRS) {
    const categoryDir = join(root, category);
    let problems: string[];
    try {
      problems = readdirSync(categoryDir);
    } catch {
      continue; // category ごと無い repo 状態 (= submodule 未 checkout) でも落とさない。
    }
    for (const problem of problems.sort()) {
      const file = join(categoryDir, problem, VENDORED_PATH);
      let contents: Buffer;
      try {
        if (!statSync(file).isFile()) continue;
        contents = readFileSync(file);
      } catch {
        continue; // workbench を持たない問題のほうが多い。 持たないことは違反ではない。
      }
      copies.push({
        path: relative(root, file),
        digest: createHash("sha256").update(contents).digest("hex"),
      });
    }
  }
  return copies;
}

/**
 * 複製を digest でまとめる。 揃っていれば 1 群、 割れていれば 2 群以上になる。
 * 多数派を「現行版」 と決めつけない — どちらが正しいかは人にしか判断できないので、
 * 群をそのまま出して選ばせる。
 */
export function groupByDigest(copies: readonly VendoredCopy[]): Map<string, string[]> {
  const groups = new Map<string, string[]>();
  for (const copy of copies) {
    groups.set(copy.digest, [...(groups.get(copy.digest) ?? []), copy.path]);
  }
  return groups;
}

export function formatReport(copies: readonly VendoredCopy[]): {
  readonly ok: boolean;
  readonly lines: readonly string[];
} {
  if (copies.length === 0) {
    // 1 つも無いのは、 まだ誰も vendoring していないだけで違反ではない。
    return { ok: true, lines: ["workbench.py を持つ問題はありません (skip)"] };
  }

  const groups = groupByDigest(copies);
  if (groups.size === 1) {
    return {
      ok: true,
      lines: [`workbench.py ${copies.length} 複製はすべて同一です (${[...groups.keys()][0]?.slice(0, 12)})`],
    };
  }

  const lines = [
    `workbench.py の複製が ${groups.size} 群に割れています (計 ${copies.length} 複製)。`,
    "",
    "vendoring は仕様であり、 全複製が同一でなければならない。 1 箇所を直して全複製へ",
    "配り直してください (= どれか 1 群を選び、 他の群をそれで上書きする)。",
    "",
  ];
  for (const [digest, paths] of [...groups.entries()].sort((a, b) => b[1].length - a[1].length)) {
    lines.push(`  ${digest.slice(0, 12)} — ${paths.length} 複製`);
    for (const path of paths) lines.push(`    ${path}`);
    lines.push("");
  }
  return { ok: false, lines };
}

function main(): void {
  const { ok, lines } = formatReport(findVendoredCopies(REPO_ROOT));
  const log = ok ? console.log : console.error;
  for (const line of lines) log(line);
  if (!ok) process.exit(1);
}

if (import.meta.main) main();
