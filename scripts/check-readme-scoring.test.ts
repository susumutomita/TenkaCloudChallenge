import { existsSync, globSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "bun:test";
import { scanAll, scoringClaims, scoringFacts } from "./check-readme-scoring";

/**
 * 検出器そのものの test (Issue 555)。
 *
 * 実際に残っていたずれを fixture として持つ。`rls-tenant-isolation` の README は 300 点、
 * `metadata.json` は 200 点で、`sqli-demo` は点数も誤答減点も倍だった。検出器が
 * 「常に空配列」に退化していないこと、そして正しい README を violation と教えないことの
 * 両方を固定する。誤検出の側は catalog に実在した形をそのまま使う。
 */

const NO_CHECKPOINTS = { hasCheckpoints: false } as const;
const CHECKPOINTS = { hasCheckpoints: true } as const;

describe("scoringFacts", () => {
  it("should read a flat verify scoring block", () => {
    const facts = scoringFacts({ scoring: { kind: "verify", points: 200, wrongAnswerPenalty: 10 } });
    expect(facts).toEqual({ points: 200, wrongAnswerPenalty: 10, hasCheckpoints: false });
  });

  it("should total a multi-verify block from its checks", () => {
    const facts = scoringFacts({
      scoring: { kind: "multi-verify", checks: [{ points: 50 }, { points: 50 }, { points: 100 }] },
    });
    expect(facts.points).toBe(200);
    expect(facts.hasCheckpoints).toBe(true);
  });

  it("should expose no top-level penalty for a checkpoint problem", () => {
    // multi-verify は減点を checkpoint ごとに持つ。合計に相当する値は無いので、
    // README の「誤答は各チェックポイント 2 点」を突き合わせる相手が存在しない。
    const facts = scoringFacts({
      scoring: { kind: "multi-verify", checks: [{ points: 100, wrongAnswerPenalty: 2 }] },
    });
    expect(facts.wrongAnswerPenalty).toBeUndefined();
  });

  it("should not invent a total when a check carries no points", () => {
    const facts = scoringFacts({ scoring: { kind: "multi-verify", checks: [{ points: 50 }, {}] } });
    expect(facts.points).toBeUndefined();
    expect(facts.hasCheckpoints).toBe(true);
  });

  it("should tolerate a problem with no scoring block", () => {
    expect(scoringFacts({})).toEqual({ hasCheckpoints: false });
  });
});

describe("scoringClaims", () => {
  it("should read the English prose that was wrong on rls-tenant-isolation", () => {
    const claims = scoringClaims(
      "All eight must pass. A correct fix scores 300 points; a wrong submission costs 10.\n",
      NO_CHECKPOINTS,
    );
    expect(claims.filter((claim) => claim.field === "points").map((claim) => claim.value)).toEqual([300]);
    expect(
      claims.filter((claim) => claim.field === "wrongAnswerPenalty").map((claim) => claim.value),
    ).toEqual([10]);
  });

  it("should read the Japanese prose that was wrong on sqli-demo", () => {
    const claims = scoringClaims("正解は200点、誤答は10点減点です。\n", NO_CHECKPOINTS);
    expect(claims.map((claim) => [claim.field, claim.value])).toEqual([
      ["points", 200],
      ["wrongAnswerPenalty", 10],
    ]);
  });

  it("should read a quoted metadata fragment inside a fenced block", () => {
    // README が metadata を引用している箇所も配点が書かれた 2 つ目の場所で、
    // 散文だけ直して引用を置き去りにするのが実際に起きたずれの片方だった。
    const readme = '```jsonc\n"scoring": { "kind": "verify", "points": 300, "wrongAnswerPenalty": 10 }\n```\n';
    expect(scoringClaims(readme, NO_CHECKPOINTS).map((claim) => [claim.field, claim.value])).toEqual([
      ["points", 300],
      ["wrongAnswerPenalty", 10],
    ]);
  });

  it("should ignore a JSON-looking fragment outside any fenced block", () => {
    expect(scoringClaims('"points": 300 は例です。\n', NO_CHECKPOINTS)).toEqual([]);
  });

  it("should read a checkpoint total only for a checkpoint problem", () => {
    const readme = "`multi-verify`, five checkpoints, 200 points total (Medium tier).\n";
    expect(scoringClaims(readme, CHECKPOINTS).map((claim) => claim.value)).toEqual([200]);
    expect(scoringClaims(readme, NO_CHECKPOINTS)).toEqual([]);
  });

  it("should not read a penalty subtotal as the score total", () => {
    // stackstack-secrets の実文。「合計 10 点」は減点の合計であって配点ではない。
    const readme = "誤答は各チェックポイント 2 点 (合計 10 点)。\n";
    expect(scoringClaims(readme, CHECKPOINTS).filter((claim) => claim.field === "points")).toEqual([]);
  });

  it("should not read a facilitator rubric as the graded total", () => {
    // hollow-invite の実文。100 点満点はファシリテーターが別途採点する rubric で、
    // container が自動採点する 200 点とは別の数字。
    const readme = "ヒントには減点が付く。 100 点満点の GameDay ルーブリックは別途採点する。\n";
    expect(scoringClaims(readme, CHECKPOINTS).filter((claim) => claim.field === "points")).toEqual([]);
  });

  it("should not read a checkpoint breakdown row as a total", () => {
    // 内訳の「50 点」や表の中の数字を拾い始めると誤検出しか出ない。
    const readme = "| 1 | A-user GET own doc | 200 |\n各チェックポイント 50 点。\n";
    expect(scoringClaims(readme, CHECKPOINTS)).toEqual([]);
  });
});

describe("the catalog", () => {
  it("should state the same score in every README as in metadata.json", () => {
    expect(scanAll()).toEqual([]);
  });

  it("should still be checking a meaningful number of claims", () => {
    // 検出器が全問素通りになる (パターンが壊れる / 対象 glob が空になる) 退化を捕まえる。
    // 突き合わせが成立している主張の件数を数えるので、0 になったら規則が死んでいる。
    const claimed = scanAllClaimCount();
    expect(claimed).toBeGreaterThanOrEqual(30);
  });
});

/** catalog 全体で実際に突き合わせが成立した配点の主張の件数。 */
function scanAllClaimCount(): number {
  let total = 0;
  for (const metadata of globSync("{battles,challenges,stackstack-base}/*/metadata.json")) {
    const facts = scoringFacts(JSON.parse(readFileSync(metadata, "utf8")));
    for (const name of ["README.md", "README.ja.md"]) {
      const path = join(dirname(metadata), name);
      if (!existsSync(path)) continue;
      for (const claim of scoringClaims(readFileSync(path, "utf8"), facts)) {
        if (typeof facts[claim.field] === "number") total += 1;
      }
    }
  }
  return total;
}
