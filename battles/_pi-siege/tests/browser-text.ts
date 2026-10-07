// The same participant-only path runs in each supported locale.
export const english = process.env.BROWSER_LOCALE === "en";
const translations: Record<string, string> = {
  "このラウンドの行動を終える（残りの券は持ち越さない）": "Finish this round (unused tickets do not carry over)",
  "主張を公開する（券1枚）": "Publish claim (one ticket)",
  "反例・根拠不足を指摘する（券1枚）": "Audit counterexample or insufficient evidence (one ticket)",
  "主張を公開した": "Claim published.", "監査成立。+4": "Audit succeeds. +4",
  "分数を試す（券1枚）": "Try a fraction (one ticket)",
  "数表を試す（券1枚）": "Try a table (one ticket)",
  "配置を試す（券1枚）": "Try an arrangement (one ticket)",
  "配分を試す（券1枚）": "Try an allocation (one ticket)",
  "まず分数3/1を試すと": "First try fraction 3/1",
  "研究原稿の誤りを見つける競技ではありません": "Audits target players' claims in this finite game, not errors in the manuscript.",
  "準備完了": "Ready", "相手の準備を待っています": "Waiting for opponent to be ready",
  "相手は準備完了": "opponent: Ready", "無料の式と小さい例": "Free rules and a small example",
  "q=5なら三乗の基準": "With q=5, the cubic benchmark",
  "段階ヒント（無料・券不要）": "Step-by-step hints (free)",
  "2. 式と小さい例": "2. Formula and example",
  "誤差は3/2−4/3=1/6": "error would be 3/2−4/3=1/6",
  "分母を120まで広げる（券1枚）": "Expand denominators to 120 (one ticket)",
  "通信結果を確認できません": "The response was lost.",
  "同じ操作を再送": "Resend the same operation", "探索できる分母を 120": "Denominator range expanded to 120",
  "3/1: 誤差の目安は 約0.1415927": "3/1: approximate error 0.1415927",
  "分子 p": "Numerator p", "分母 q": "Denominator q",
  "この一回は基準より良い": "this one record beats the benchmark",
  "355/113: 誤差の目安": "355/113: approximate error", "主張の範囲": "Claim scope",
  "分数そのものが間違いという判定ではない": "The fraction itself is not being declared wrong.",
  "対角の積の差 = 1/8": "Difference of diagonal products = 1/8",
  "対角の積の差 = 0": "Difference of diagonal products = 0",
  "公開する下限": "Published floor", "監査の理由": "Audit reason",
  "ゼロならこの下限は使えない": "This floor cannot be used for a zero difference.",
  "合計 = 6": "type sum + degree sum = 6", "合計 = 4": "type sum + degree sum = 4",
  "試す種類1の枚数": "Trial type-1 count", "種類と次数の配置": "Arrangement of types and degrees",
  "公開する指数": "Published exponent", "反例の種類1の枚数": "Counterexample type-1 count",
  "反例の指数": "Counterexample exponent",
  "実際の項が非零・大きいという判定ではない": "It does not establish that an actual term is nonzero or large.",
  "行を5枚へ増やす（券1枚）": "Increase to 5 rows (one ticket)", "行カードを 5 枚": "Increased row cards to 5",
  "目盛りを1/50へ細かくする（券1枚）": "Refine grid to 1/50 (one ticket)", "1/50 刻み": "grid refined to 1/50",
  "誤差側 ν(1−b)−1 = -1/10": "error ν(1−b)−1 = -1/10", "配分の分子": "Allocation numerator",
  "入口2つと調整後2つ、4つ全て正": "All four margins, two entry and two adjusted, must be positive.",
  "試合終了 · 有限の競技から論文へ": "Match over · From a finite game to the manuscript",
  "橙チームの勝ち": "橙チーム wins",
  "有限のゲームがπの指数2を証明した意味でも": "The finite game neither proves the exponent-2 theorem",
  "検証済みの新定理とは断言しない": "We do not declare a verified new theorem.",
  "研究原稿の定理を反証したことにはなりません": "A successful audit does not refute the research theorem.",
};
export function text(ja: string): string {
  if (!english || !/[\u3040-\u30ff\u4e00-\u9fff]/u.test(ja)) return ja;
  const en = translations[ja];
  if (!en) throw new Error(`Missing English browser assertion: ${ja}`);
  return en;
}
