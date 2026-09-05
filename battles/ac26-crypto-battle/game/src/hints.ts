/**
 * [Issue #659 §9/§13] The hint ladder: what a team may buy when an Order is in
 * front of them and they do not know how to start.
 *
 * ## Why a Battle needs one at all
 *
 * Every other move in this game is a TRADE against another team. LEAK buys
 * five minutes and pays for it with a published pair; ROTATE buys safety and
 * pays for it with a batch. None of them EXPLAIN anything — a team that does
 * not know how a masked subtotal is built learns nothing from leaking it, and
 * the Order after that one is the same wall.
 *
 * #659 §9 names that gap when it picks the booster (「ヒントを開いても減点なし」)
 * as the handicap for the last-place team, over the two alternatives it
 * rejects: 「下位に自動計算機を配る」 skips the calculation, so 「一番学ぶ必要の
 * あるチームが計算を飛ばす」. A hint is the only aid on the list that leaves the
 * player doing the work. That is what makes it the right handicap, and it is
 * also why the mechanism has to exist BEFORE the item that waives its price —
 * §13's ordering, 「ヒント機構の新設 → ブースター / ライトニング」.
 *
 * ## Why the text lives here and not in the Portal
 *
 * Every other participant-facing string in this Battle lives in the Portal's
 * locale tables (see `portal/orderTask.ts`). A hint cannot: the Portal bundle
 * is delivered to the browser in full, so a hint compiled into it is readable
 * in devtools by anyone willing to look, and its price — the entire mechanism —
 * would apply only to players who did not think to look. Priced content has to
 * be withheld by the side that holds the state, so hint text ships on the
 * projection, and only for the levels a team has actually opened
 * (`projectForTeam`). Both locales travel together because `projectForTeam` has
 * no locale to choose by; the Portal picks.
 *
 * ## What a hint may and may not say
 *
 * [Issue #712] A hint is rendered against the Order in front of the reader
 * ({@link HintContext}): the public payload, the reader's own private inputs
 * (which their projection already shows them), and their own vault. The owner's
 * bar, set on a live run: a reader with junior-high maths and no vocabulary must
 * be able to open the rungs and complete the Order. So the rungs climb
 * **what this is → how it works → the formula, with a one-digit example → this
 * Order's numbers, one line at a time**, and the last rung ends where the
 * reader writes the answer. That is not a leak: everything the last rung quotes
 * is on the same screen already.
 *
 * What a hint must never carry is ANOTHER team's material, and the context
 * makes that structural -- nothing about other teams is in it. `hints.test.ts`
 * renders every rung in a field big enough for a substring search to mean
 * something and checks no other team's secret or un-leaked share appears.
 */

import type { OrderTaskKind, OrderTaskProjection, VaultProjection } from "./types.ts";

/**
 * [Issue #712] What a hint may read when it is rendered: the Order in front of
 * the reader -- INCLUDING the private inputs their own projection already
 * carries (an MPC office's number, a ladder key) -- and the reader's own vault.
 *
 * Everything here is already on the projection handed to this team, so a hint
 * that quotes it reveals nothing the screen does not. What it must never
 * contain is another team's material, and it cannot: nothing about other
 * teams is in this context, and `hints.test.ts` projects a hint in a field
 * large enough for a substring search to be meaningful and checks that no
 * other team's secret or un-leaked share appears in any rendered rung.
 */
export interface HintContext {
  readonly task: OrderTaskProjection;
  readonly vault: VaultProjection;
  /** The match's modulus, as the Order shows it. */
  readonly prime: string;
  readonly threshold: number;
  readonly shareCount: number;
}

/** The two locales this Battle ships copy in (see `portal/orderTask.ts`). */
export type HintLocale = "ja" | "en";

export type HintText = Readonly<Record<HintLocale, string>>;

export interface HintSpec {
  /**
   * Stable identifier, `<task kind>/<level+1>`. Carried on the projection so an
   * operator reading a raw payload — or a replay — can tell which hint a team
   * bought without diffing prose.
   */
  readonly id: string;
  /**
   * [Issue #712] Rendered against the Order the reader is looking at, so the
   * last rung can walk the calculation with THEIR numbers. A rung that needs no
   * numbers simply ignores its argument.
   */
  readonly text: (ctx: HintContext) => HintText;
}

/**
 * How many hints every Order carries.
 *
 * Fixed across task kinds on purpose. A team choosing between two Orders is
 * already weighing points, deadline, privacy rule and method; "and this one has
 * more help available than that one" is a fifth axis that buys nothing and
 * makes the price of a hint depend on which Order you are looking at.
 * `hints.test.ts` pins every ladder to this length, and pins
 * `ScoreRules.hintCosts` to it too — a level with no price is a free hint.
 */
export const HINT_LEVELS = 3;

/**
 * The ladders, by task kind. Level order is array order: 0 is opened first.
 *
 * Each ladder is the same three steps — where to look, the rule, the first
 * move — because that is the shape that leaves the player something to do. A
 * level that finished the calculation would make the hint a substitute for the
 * Order rather than a way into it, and would put this file on the wrong side of
 * the repository's answer-reachability rule.
 */
export const HINT_LADDER: Readonly<Record<OrderTaskKind, readonly HintSpec[]>> = {
  /**
   * The share Order is the one place where the hint is about the GAME rather
   * than the arithmetic: both methods are one click, and the whole difficulty
   * is knowing what each one costs you later.
   *
   * [Issue #702] Level 1 used to open with the decision -- "hand it over or
   * answer without doing so" -- which is the second question, not the first. A
   * live player read all three levels (-14) and came back with 「Share って
   * そもそもなに？」 and 「このヒントが全く解ける状態じゃない」. A hint that
   * assumes the noun is not a hint for the person who bought it. Level 1 now
   * names the thing and names the move; the card carries the same definition
   * for free (`shareWhat` in FastMovePanel.tsx), so a player who never buys a
   * hint is not the one left out.
   */
  "reveal-share": [
    {
      id: "reveal-share/1",
      text: () => ({
        ja: "かけら (share) は、あなたの秘密を 5 個に分けたうちの 1 個 — MY VAULT の #1〜#5 がそれ。この Order はそのうち指定された番号を要求している。計算は要らない。LEAK を押せば、その 1 個がそのまま公開記録に載って Order は完了する。",
        en: "A share is one of the five pieces your secret was split into -- #1 to #5 in MY VAULT. This Order asks for the ones it names. There is no calculation: pressing LEAK publishes that piece as it is and completes the Order.",
      }),
    },
    {
      id: "reveal-share/2",
      text: () => ({
        ja: "では、なぜ LEAK を押さない選択があるのか。公開したかけらは消えない。同じ世代のかけらが 3 個そろうと、相手はあなたの秘密を復元できる (= HUNT)。PROVE はかけらを渡さずに「秘密を持っている」ことだけを示す方法で、得点が高いのはそのぶん公開量が少ないから。",
        en: "LEAK publishes the requested share to the public record as it is. PROVE shows only that you hold the secret and publishes no share. The two pay differently because they expose different amounts.",
      }),
    },
    {
      id: "reveal-share/3",
      text: () => ({
        ja: "判断材料は画面の「危険度」レーンにある。あなたの行の丸が何個埋まっているかが、公開済みのかけらの数。あと 1 個で 3 個に届くなら LEAK は危険で、PROVE を選ぶか、ROTATE で世代を変えてから LEAK する。まだ 0〜1 個なら LEAK が速くて安全な手。",
        en: "LEAK needs no calculation — pressing it publishes the requested share to the public record and completes the Order. PROVE means building a proof from your vault's secret yourself and submitting that. Which one to press is a question for the EXPOSURE lane: how many more shares fill your row. Once it is full, ROTATE moves you to a fresh generation.",
      }),
    },
  ],
  "homomorphic-sum": [
    {
      id: "homomorphic-sum/1",
      text: () => ({
        ja: "暗号文を元に戻そうとしない。中身が読めないまま足せることがこの Order の主題で、鍵は配られていない。",
        en: "Do not try to turn the ciphertexts back into numbers. Adding them while they stay unreadable is the whole point of this Order, and you were never given the key.",
      }),
    },
    {
      id: "homomorphic-sum/2",
      text: () => ({
        ja: "暗号文は 2 つの数の組 (r, y)。足し算は組どうしを位置ごとに足すだけ ― r は r と、y は y と ― そして割る数で割った余りをとる。",
        en: "A ciphertext is a pair (r, y). Adding two of them means adding them position by position — r with r, y with y — and taking the remainder modulo the published modulus.",
      }),
    },
    {
      id: "homomorphic-sum/3",
      text: () => ({
        ja: "まず r どうしを足して余りをとる。それが答えの組の左側。同じことを y にもすれば右側になる。判定は復号してから行われるので、自己申告では点にならない。",
        en: "Add the r components first and take the remainder: that is the left half of your answer. Do the same with the y components for the right half. The judge decrypts before scoring, so claiming you did the addition earns nothing.",
      }),
    },
  ],
  "masked-total": [
    {
      id: "masked-total/1",
      text: () => ({
        ja: "自分の数そのものは絶対に出さない。出すのは覆面をかけた小計で、覆面は Order と一緒に渡されている ― 受け取った分と、送った分の 2 種類。",
        en: "Your own number never leaves your hands. What you publish is a masked subtotal, and the masks came with the Order — the ones you received, and the ones you sent.",
      }),
    },
    {
      id: "masked-total/2",
      text: () => ({
        ja: "小計 = 自分の数 + 受け取った覆面の合計 − 送った覆面の合計、を割る数で割った余り。送った分を引くのは、相手側でそれが足されるから。",
        en: "Subtotal = your own number, plus every mask you received, minus every mask you sent, all modulo the published modulus. You subtract what you sent because the office you sent it to is adding it.",
      }),
    },
    {
      id: "masked-total/3",
      text: () => ({
        ja: "受け取った覆面をぜんぶ足し、送った覆面をぜんぶ足し、その 2 つの差を自分の数に足す。引き算で負になったら割る数を足して戻す。全拠点の小計を足すと覆面は打ち消し合い、合計だけが残る ― 誰の数も見えないまま。",
        en: "Total the masks you received, total the masks you sent, and add the difference to your own number. If a subtraction goes below zero, add the modulus back. When every office publishes, the masks cancel and only the total survives — with nobody's number ever visible.",
      }),
    },
  ],
  "caesar-shift": [
    {
      id: "caesar-shift/1",
      text: () => ({
        ja: "どの記号も同じ数だけ進む。進む量が自分の鍵で、それは Order の中に自分だけに見える形で書いてある。方式は全チームが知っている ― 秘密は鍵だけ。",
        en: "Every symbol moves forward by the same amount. That amount is your key, shown on the Order to you and to nobody else. Every team knows the method — the key is the only secret.",
      }),
    },
    {
      id: "caesar-shift/2",
      text: () => ({
        ja: "記号には表示された並び順のとおり 0 から番号がついている。答えの各位置は「その記号の番号 + 鍵」を、記号の種類数で割った余り。",
        en: "The symbols are numbered from 0 in the order they are shown. Each position of the answer is that symbol's number plus your key, taken modulo the number of symbols.",
      }),
    },
    {
      id: "caesar-shift/3",
      text: () => ({
        ja: "左端から 1 つずつ。番号に鍵を足し、記号の種類数以上になったらその数だけ引く。残りの位置も同じ計算の繰り返しで、位置によって規則は変わらない ― それがこの段が 1 組の公開で割れる理由でもある。",
        en: "Work left to right. Add your key to the symbol's number, and if the result reaches the number of symbols, subtract that count. Every remaining position is the same calculation — the rule never changes with position, which is also why one published pair is enough to break this rung.",
      }),
    },
  ],
};

/** The ladder for a task kind, in level order. */
export function hintsFor(kind: OrderTaskKind): readonly HintSpec[] {
  return HINT_LADDER[kind];
}

/**
 * What the `level`-th hint costs, given the match's configured prices.
 *
 * Returns `undefined` for a level the price list does not cover, rather than
 * `NaN`-ing a team's score the way an out-of-range index would: a config that
 * has fewer prices than a ladder has levels is a misconfiguration, and the
 * reducer refuses the op instead of charging an unknown amount. `hints.test.ts`
 * pins `DEFAULT_CONFIG` against that ever being the shipped case.
 */
export function hintCostAt(costs: readonly number[], level: number): number | undefined {
  if (!Number.isInteger(level) || level < 0) return undefined;
  return costs[level];
}
