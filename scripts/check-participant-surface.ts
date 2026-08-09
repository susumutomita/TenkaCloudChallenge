#!/usr/bin/env bun
/**
 * 参加者の画面で問題が完走するかを、authoring 時に機械で検査する (Issue 398)。
 *
 * ## なぜ既存の gate では足りなかったか
 *
 * 2026-08-08 に local play を実ブラウザで一周したところ、`bun run validate` も CI も
 * 通っている問題に、参加者から見て致命的な欠陥が 2 クラス残っていた。どちらも
 * **ソースを読むと正しく見える**種類で、既存の検査は「参加者が実際に見る画面」を
 * 一度も見ていなかった。
 *
 * この file はその 2 クラスだけを対象にする。汎用の HTML linter ではない。
 *
 * ## クラス A: 生成された script が構文エラー (Issue 395)
 *
 * `stackstack-base/app/server.mjs:471` にこう書かれていた。
 *
 * ```js
 * return `<!doctype html>...<script>
 *   output.textContent = response.status + " " + response.statusText + "\n\n" + text;
 * </script>...`;
 * ```
 *
 * この `\n` は **外側のテンプレートリテラルが先に消費する**。配信される HTML では実際の
 * 改行になり、JS の文字列リテラルが行をまたいで **SyntaxError** になる。結果 API コンソール
 * 全体が死に、問題文が「ターミナル不要、この画面から実行する」と書いている経路が動かない。
 * StackStack 系 8 問が影響した。
 *
 * ソースだけ見ると `\n` は正しく見えるので、目視レビューでは通ってしまう。同じ file の
 * `${JSON.stringify(...)}` が正しい書き方で、それが正典。
 *
 * ## クラス B: 参加者の実行環境で読めない (Issue 396)
 *
 * `color-scheme` と背景色の未指定により、ダークモードのブラウザで黒背景に黒文字になる。
 * HTML を返す 14 問のうち 11 問が未対応だった。作者の環境がライトモードだと気付けない。
 *
 * ## 意図的にやらないこと
 *
 * 実ブラウザでの操作 (console error の有無、問題文が指す UI が動くか) はここでは見ない。
 * それは Docker と実 browser が要り、`/validate-problem` skill の手順が担当する。この file は
 * **その手前で、静的に確実に分かるものだけ**を落とす。両方が必要で、片方では足りない。
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative } from "node:path";

const SOURCE_DIRS = ["battles", "challenges", "stackstack-base"];
const SOURCE_EXTENSIONS = new Set([".mjs", ".js", ".ts", ".cjs"]);

export interface SurfaceFinding {
  readonly file: string;
  readonly line: number;
  readonly rule: "script-escape" | "color-scheme" | "body-color-pair";
  readonly message: string;
}

/** `<script>` ... `</script>` の中身と、その開始 offset。 */
interface ScriptBlock {
  readonly body: string;
  readonly offset: number;
}

function scriptBlocks(source: string): ScriptBlock[] {
  const blocks: ScriptBlock[] = [];
  const re = /<script\b[^>]*>([\s\S]*?)<\/script>/g;
  let match = re.exec(source);
  while (match !== null) {
    const body = match[1] ?? "";
    blocks.push({ body, offset: match.index + match[0].length - body.length - "</script>".length });
    match = re.exec(source);
  }
  return blocks;
}

/**
 * テンプレートリテラルの `${...}` を同じ長さの空白へ伏せる。
 *
 * 改行だけは残す — 伏せた後も行番号が元のままでなければ、報告位置が実際とずれる。
 * ネストした `{}` を数えるので、`${cond ? {a:1} : {b:2}}` のような式でも境界を誤らない。
 */
function maskInterpolations(body: string): string {
  const out = [...body];
  for (let i = 0; i < body.length - 1; i += 1) {
    if (body[i] !== "$" || body[i + 1] !== "{") continue;
    let depth = 0;
    let j = i + 1;
    for (; j < body.length; j += 1) {
      if (body[j] === "{") depth += 1;
      else if (body[j] === "}") {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    for (let k = i; k <= Math.min(j, body.length - 1); k += 1) {
      if (out[k] !== "\n") out[k] = " ";
    }
    i = j;
  }
  return out.join("");
}

function lineOf(source: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset && i < source.length; i += 1) {
    if (source[i] === "\n") line += 1;
  }
  return line;
}

/**
 * inline script の中に、外側のテンプレートリテラルが食べてしまうエスケープが無いか。
 *
 * `\\n` (= 出力に `\n` の 2 文字が残る) は正しいので除外する。判定しているのは
 * 「バックスラッシュが偶数個続いた後の `\n` / `\t` / `\r`」だけ。
 */
export function findScriptEscapeIssues(source: string, file: string): SurfaceFinding[] {
  const findings: SurfaceFinding[] = [];
  for (const block of scriptBlocks(source)) {
    // `${...}` の中は外側テンプレートリテラルの **補間式** で、JS として評価される。
    // `${JSON.stringify("\n\n")}` はまさに正しい書き方 (Issue 398 がこれを正典と呼んでいる)
    // なので、ここを見ると正解を不正解と言うことになる。長さを保ったまま伏せて offset をずらさない。
    const body = maskInterpolations(block.body);
    const re = /\\+[ntr]/g;
    let match = re.exec(body);
    while (match !== null) {
      const backslashes = match[0].length - 1;
      // 奇数個 = エスケープが 1 つ残らない = 外側のテンプレートリテラルに消費される。
      if (backslashes % 2 === 1) {
        findings.push({
          file,
          line: lineOf(source, block.offset + match.index),
          rule: "script-escape",
          message:
            `inline script の中で \`${match[0]}\` が使われています。外側のテンプレート` +
            "リテラルがこれを先に消費するため、配信される script は構文エラーになります " +
            "(Issue 395)。`\\\\n` と書くか、`${JSON.stringify(value)}` で埋め込んでください。",
        });
      }
      match = re.exec(body);
    }
  }
  return findings;
}

/**
 * HTML を返すのに `color-scheme` を宣言していないか。
 *
 * 宣言が無いとブラウザはダークモードで文字色だけを反転させ、明示された背景色との組み合わせで
 * 黒背景に黒文字になる。`<meta name="color-scheme">` でも CSS の `color-scheme:` でもよい。
 */
export function findColorSchemeIssues(source: string, file: string): SurfaceFinding[] {
  const docMatch = /<!doctype html>/i.exec(source);
  if (!docMatch) return [];
  if (/color-scheme/i.test(source)) return [];
  return [
    {
      file,
      line: lineOf(source, docMatch.index),
      rule: "color-scheme",
      message:
        "HTML を返しますが `color-scheme` の宣言がありません。ダークモードのブラウザで " +
        "黒背景に黒文字になり読めなくなります (Issue 396)。`<meta name=\"color-scheme\" " +
        'content="light dark">` か CSS の `color-scheme: light dark;` を入れてください。',
    },
  ];
}

/**
 * `body` に文字色だけを書いて、背景を書いていないか (Issue 400 の実プレイで判明)。
 *
 * ## なぜ `color-scheme` の宣言だけでは足りなかったか
 *
 * Issue 396 への最初の対処は「`color-scheme` が宣言されているか」だけを見ていた。ところが
 * 2026-08-09 に実ブラウザで一周したところ、**宣言済みの問題が 2 つ、ダークモードで読めない
 * ままだった**。
 *
 *   hollow-invite       `body{...color:#1b2733}`  背景の指定なし  → 対比 1.38
 *   wix-exposure-audit  `body{...color:#1b2a3a}`  背景の指定なし  → 対比 1.44
 *
 * `color-scheme: light dark` は「両方に対応している」という**宣言**であって実装ではない。
 * 宣言するとブラウザはダークモードで canvas を暗く塗る。そこへ明示的な暗い文字色だけを置くと、
 * 暗い背景に暗い文字になる。宣言が無かったとき (Issue 396 の元の形) と結果は同じで、
 * **宣言を足したことで直ったように見えていた**。
 *
 * 検査するのはその組み合わせだけ。`body` に明示的な `color` があり、同じ規則に `background`
 * が無い場合に落とす。両方書いてあるか、どちらも書いていない (= ブラウザ既定の組) なら問題ない。
 */
export function findBodyColorPairIssues(source: string, file: string): SurfaceFinding[] {
  const docMatch = /<!doctype html>/i.exec(source);
  if (!docMatch) return [];

  const findings: SurfaceFinding[] = [];
  // `body{...}` の CSS 規則と、`<body style="...">` の両方を見る。
  const rules = [
    ...source.matchAll(/\bbody\s*\{([^}]*)\}/gi),
    ...source.matchAll(/<body\b[^>]*\bstyle\s*=\s*"([^"]*)"/gi),
  ];
  for (const rule of rules) {
    const declarations = rule[1] ?? "";
    const hasColor = /(?:^|;|\s)color\s*:/i.test(declarations);
    const hasBackground = /(?:^|;|\s)background(?:-color)?\s*:/i.test(declarations);
    if (!hasColor || hasBackground) continue;
    findings.push({
      file,
      line: lineOf(source, rule.index ?? 0),
      rule: "body-color-pair",
      message:
        "`body` に文字色だけを指定し、背景色を指定していません。`color-scheme` を宣言すると " +
        "ダークモードのブラウザは canvas を暗く塗るので、明示した暗い文字色と重なって読めなく " +
        "なります (Issue 400 の実プレイで hollow-invite / wix-exposure-audit がこれでした)。" +
        "背景色も明示するか、`Canvas` / `CanvasText` のシステム色を組で使ってください。",
    });
  }
  return findings;
}

export function checkSource(source: string, file: string): SurfaceFinding[] {
  return [
    ...findScriptEscapeIssues(source, file),
    ...findColorSchemeIssues(source, file),
    ...findBodyColorPairIssues(source, file),
  ];
}

function walk(dir: string): string[] {
  const out: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry === "node_modules" || entry === ".git") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (SOURCE_EXTENSIONS.has(extname(entry))) out.push(full);
  }
  return out;
}

function main(): number {
  const findings: SurfaceFinding[] = [];
  for (const dir of SOURCE_DIRS) {
    for (const file of walk(dir)) {
      // test file は参加者へ配信されない。
      if (file.includes(".test.")) continue;
      findings.push(...checkSource(readFileSync(file, "utf8"), relative(".", file)));
    }
  }
  if (findings.length === 0) {
    console.log("OK: 参加者の画面に配信される HTML / script に既知の欠陥はありません。");
    return 0;
  }
  for (const finding of findings) {
    console.error(`NG  ${finding.file}:${finding.line}  [${finding.rule}]`);
    console.error(`    ${finding.message}`);
  }
  console.error(`\n${findings.length} 件の欠陥が見つかりました。`);
  return 1;
}

if (import.meta.main) process.exit(main());
