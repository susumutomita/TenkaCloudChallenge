#!/usr/bin/env bun
/**
 * README の配点表記が `metadata.json` の採点値と一致しているか (Issue 555)。
 *
 * ## 何が起きたか
 *
 * 配点は 2 箇所に独立して書かれている。platform が実際の採点に使うのは
 * `metadata.json` の `scoring` で、README は参加者が問題を選ぶときに読む文書にすぎない。
 * 両者を突き合わせる検査が無かったため、`rls-tenant-isolation` と `sqli-demo` の README は
 * 実際の 2 倍近い点数を掲げたまま残っていた。参加者は 300 点だと思って解き、提出すると
 * 200 点しか入らない。`sqli-demo` は誤答減点まで倍 (README 10 / metadata 5) だった。
 *
 * どちらが正かは決まっている。**`metadata.json` が正本**で、README が追随する。
 *
 * ## 何を「配点の主張」と呼ぶか
 *
 * 「README に現れる数字」ではない。数字は checkpoint の内訳、HTTP status、ヒントの減点にも
 * 現れるので、全部を見ると誤検出しか出ない。**その文が採点の合計や誤答減点を名指しで
 * 主張している形** だけを拾う:
 *
 *   - 正解時の合計   `scores N points` / `is worth N points` / `正解は N 点`
 *   - checkpoint 合計 `N points total` / `合計 N 点` / `N 点満点`
 *                     (ただし同じ文が multi-verify か checkpoint に言及していること)
 *   - 誤答減点       `a wrong … costs N` / `誤答は N 点減点`
 *   - metadata の引用 fenced code block 内の `"points": N` / `"wrongAnswerPenalty": N`
 *
 * 減点を語っている文で合計を拾わないよう、`誤答` / `減点` / `penalty` / `costs` を含む文は
 * 合計の主張から除く (`stackstack-secrets` の「誤答は各チェックポイント 2 点 (合計 10 点)」が
 * これで外れる)。同様に `hollow-invite` の「100 点満点の GameDay ルーブリック」は
 * ファシリテーターが別途採点する rubric であって自動採点の合計ではないので、
 * multi-verify / checkpoint を含まない文として外れる。
 *
 * ## この検査が捕まえられないもの
 *
 * 表記ベースなので **下限** しか出せない。上のどれとも違う書き方で配点を書けば素通りする。
 * 拾えなかった書き方が見つかったら、ここに形を足すこと — 数字の側を書き換えて検査を
 * 黙らせるのは Issue 555 が塞ごうとしている穴そのものになる。
 */

import { existsSync, globSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";

export interface ScoringFacts {
  /** 正解時の合計。`scoring.points`、multi-verify なら checks の総和。 */
  readonly points?: number;
  /** 誤答減点。checkpoint ごとに持つ形 (multi-verify) では未定義。 */
  readonly wrongAnswerPenalty?: number;
  /** checkpoint 制か (合計の主張を文脈で絞るのに使う)。 */
  readonly hasCheckpoints: boolean;
}

export interface ScoringFinding {
  readonly problemId: string;
  readonly file: string;
  readonly line: number;
  readonly field: "points" | "wrongAnswerPenalty";
  readonly expected: number;
  readonly found: number;
  readonly excerpt: string;
}

interface Claim {
  readonly field: "points" | "wrongAnswerPenalty";
  readonly value: number;
  readonly index: number;
  readonly excerpt: string;
}

/** 合計の主張を認める文脈 (checkpoint 制の合計であること)。 */
const CHECKPOINT_CONTEXT = /multi-verify|checkpoint|チェックポイント/i;
/** 減点を語っている文。合計の主張としては読まない。 */
const PENALTY_CONTEXT = /誤答|減点|penalty|costs/i;

const TOTAL_PATTERNS: readonly RegExp[] = [
  /(?:scores|is worth|are worth|worth)\s+(\d+)\s+points/gi,
  /正解は\s*(\d+)\s*点/g,
];
const CHECKPOINT_TOTAL_PATTERNS: readonly RegExp[] = [
  /(\d+)\s+points\s+total/gi,
  /合計\s*(\d+)\s*点/g,
  /(\d+)\s*点満点/g,
];
const PENALTY_PATTERNS: readonly RegExp[] = [
  /a\s+wrong\s+(?:one|answer|flag|fix|submission)\s+costs\s+(\d+)/gi,
  /誤答は\s*(\d+)\s*点減点/g,
];
/** README が引用している metadata の断片。fenced code block の中だけを見る。 */
const QUOTED_PATTERNS: readonly { readonly field: "points" | "wrongAnswerPenalty"; readonly pattern: RegExp }[] = [
  { field: "points", pattern: /"points"\s*:\s*(\d+)/g },
  { field: "wrongAnswerPenalty", pattern: /"wrongAnswerPenalty"\s*:\s*(\d+)/g },
];

/** `metadata.json` の採点値。合計は multi-verify なら checks の総和。 */
export function scoringFacts(metadata: unknown): ScoringFacts {
  const scoring = (metadata as { scoring?: Record<string, unknown> } | null)?.scoring;
  if (!scoring) return { hasCheckpoints: false };
  const checks = Array.isArray(scoring.checks) ? (scoring.checks as { points?: unknown }[]) : undefined;
  if (checks && checks.length > 0) {
    const values = checks.map((check) => check.points);
    // 1 つでも points を持たない check があれば総和は意味を持たない。
    if (values.every((value) => typeof value === "number")) {
      return { points: (values as number[]).reduce((a, b) => a + b, 0), hasCheckpoints: true };
    }
    return { hasCheckpoints: true };
  }
  return {
    points: typeof scoring.points === "number" ? scoring.points : undefined,
    wrongAnswerPenalty:
      typeof scoring.wrongAnswerPenalty === "number" ? scoring.wrongAnswerPenalty : undefined,
    hasCheckpoints: false,
  };
}

/** fenced code block の範囲 (```…```)。README が metadata を引用する場所。 */
function fencedRanges(source: string): { start: number; end: number }[] {
  const ranges: { start: number; end: number }[] = [];
  const fence = /^```.*$/gm;
  let open: number | null = null;
  for (const match of source.matchAll(fence)) {
    if (open === null) open = match.index + match[0].length;
    else {
      ranges.push({ start: open, end: match.index });
      open = null;
    }
  }
  return ranges;
}

/** 文単位に切る。日本語は `。`、英語は `. ` / 改行で切る。 */
function sentences(source: string): { text: string; offset: number }[] {
  const out: { text: string; offset: number }[] = [];
  let start = 0;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    const isBreak =
      character === "\n" ||
      character === "。" ||
      (character === "." && (source[index + 1] === " " || source[index + 1] === "\n"));
    if (!isBreak) continue;
    out.push({ text: source.slice(start, index + 1), offset: start });
    start = index + 1;
  }
  if (start < source.length) out.push({ text: source.slice(start), offset: start });
  return out;
}

function collect(
  text: string,
  offset: number,
  patterns: readonly RegExp[],
  field: "points" | "wrongAnswerPenalty",
  into: Claim[],
): void {
  for (const pattern of patterns) {
    for (const match of text.matchAll(new RegExp(pattern.source, pattern.flags))) {
      // 引用 block は複数行になるので、当たった行だけを出す (文はそのまま 1 件)。
      const lineStart = text.lastIndexOf("\n", match.index) + 1;
      const lineEnd = text.indexOf("\n", match.index);
      const excerpt = text.slice(lineStart, lineEnd === -1 ? undefined : lineEnd);
      into.push({
        field,
        value: Number(match[1]),
        index: offset + match.index,
        excerpt: excerpt.trim().slice(0, 120),
      });
    }
  }
}

/** README 本文から配点の主張を抜き出す。 */
export function scoringClaims(readme: string, facts: ScoringFacts): Claim[] {
  const claims: Claim[] = [];
  for (const { text, offset } of sentences(readme)) {
    const isPenaltySentence = PENALTY_CONTEXT.test(text);
    collect(text, offset, TOTAL_PATTERNS, "points", claims);
    collect(text, offset, PENALTY_PATTERNS, "wrongAnswerPenalty", claims);
    // checkpoint 制の合計は、その文が checkpoint の話をしているときだけ合計として読む。
    if (facts.hasCheckpoints && CHECKPOINT_CONTEXT.test(text) && !isPenaltySentence) {
      collect(text, offset, CHECKPOINT_TOTAL_PATTERNS, "points", claims);
    }
  }
  for (const { start, end } of fencedRanges(readme)) {
    const block = readme.slice(start, end);
    for (const { field, pattern } of QUOTED_PATTERNS) {
      collect(block, start, [pattern], field, claims);
    }
  }
  return claims.sort((a, b) => a.index - b.index);
}

function lineOf(source: string, index: number): number {
  let line = 1;
  for (let position = 0; position < index && position < source.length; position += 1) {
    if (source[position] === "\n") line += 1;
  }
  return line;
}

/** 1 問ぶん。README が主張する配点と metadata の採点値を突き合わせる。 */
export function scanProblem(dir: string): ScoringFinding[] {
  const metadataPath = join(dir, "metadata.json");
  if (!existsSync(metadataPath)) return [];
  const facts = scoringFacts(JSON.parse(readFileSync(metadataPath, "utf8")));
  const problemId = dir.split("/").pop() ?? dir;
  const findings: ScoringFinding[] = [];
  for (const name of ["README.md", "README.ja.md"]) {
    const path = join(dir, name);
    if (!existsSync(path)) continue;
    const source = readFileSync(path, "utf8");
    for (const claim of scoringClaims(source, facts)) {
      const expected = facts[claim.field];
      // metadata がその値を持たない形 (checkpoint ごとの減点など) は突き合わせようがない。
      if (typeof expected !== "number") continue;
      if (claim.value === expected) continue;
      findings.push({
        problemId,
        file: relative(".", path),
        line: lineOf(source, claim.index),
        field: claim.field,
        expected,
        found: claim.value,
        excerpt: claim.excerpt,
      });
    }
  }
  return findings;
}

export function scanAll(): ScoringFinding[] {
  return globSync("{battles,challenges,stackstack-base}/*/metadata.json")
    .map((metadata) => dirname(metadata))
    .sort()
    .flatMap(scanProblem);
}

function main(): number {
  const findings = scanAll();
  if (findings.length === 0) {
    console.log("OK: README の配点表記は metadata.json の採点値と一致しています。");
    return 0;
  }
  for (const finding of findings) {
    console.error(
      `NG  ${finding.file}:${finding.line}  [${finding.field}] metadata=${finding.expected} README=${finding.found}`,
    );
    console.error(`    ${finding.excerpt}`);
  }
  console.error(
    `\n${findings.length} 件。採点に使われるのは metadata.json の \`scoring\` で、README は` +
      "参加者向けの文書です。食い違うと参加者は実際と違う点数を期待して解くことになります" +
      " (Issue 555)。README 側を metadata.json に合わせてください。",
  );
  return 1;
}

if (import.meta.main) process.exit(main());
