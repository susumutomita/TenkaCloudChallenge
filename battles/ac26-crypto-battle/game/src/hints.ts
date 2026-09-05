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
      text: (ctx) => ({
        ja: `かけら (share) とは、あなたのチームの秘密の数を ${ctx.shareCount} 個に分けたうちの 1 個です。MY VAULT の #1〜#${ctx.shareCount} がそれです。仕組みは「点と曲線」です。秘密を、あるなめらかな曲線の「横 0 のときの高さ」にしておきます。かけら #1〜#${ctx.shareCount} は、同じ曲線の横 1〜${ctx.shareCount} での高さです。直線は 2 点で 1 本に決まります。この試合の曲線は ${ctx.threshold} 点で 1 本に決まる形です。だからかけらが ${ctx.threshold} 個そろうと曲線が 1 本に決まり、横 0 の高さ、つまり秘密が読めます。${ctx.threshold - 1} 個では、その点を通る曲線が無数にあり、横 0 の高さもばらばらなので、秘密は何も分かりません。かけらには世代 (= かけら ${ctx.shareCount} 個をまとめて作り直した回数) があり、ROTATE を押すと新しい世代になって、古い世代のかけらは数えられなくなります。公開されたかけらを同じ世代で ${ctx.threshold} 個集めた相手は、あなたの秘密を復元できます (これを HUNT と呼びます)。この Order は、指定された番号のかけらを求めています。LEAK はそのかけらを公開して即完了、PROVE は公開せずに「秘密を持っている」ことだけを示します。`,
        en: `A share is one of the ${ctx.shareCount} pieces your team's secret number was split into: #1 to #${ctx.shareCount} in MY VAULT. The mechanism is points on a curve. The secret is placed as the height of a smooth curve at position 0. Shares #1 to #${ctx.shareCount} are the heights of that same curve at positions 1 to ${ctx.shareCount}. Two points fix one straight line. The curve in this match is a shape that ${ctx.threshold} points fix. So ${ctx.threshold} shares pin down one curve, and its height at 0, the secret, can be read off. With ${ctx.threshold - 1} shares, endless curves pass through those points, each with a different height at 0, so the secret is not known at all. Shares have a generation (= how many times the set of ${ctx.shareCount} shares has been remade); pressing ROTATE starts a new generation, and shares from an old generation no longer count. An opponent who collects ${ctx.threshold} of your published shares from the same generation can rebuild your secret (this is called HUNT). This Order asks for the share with the number it names. LEAK publishes that share and completes the Order at once; PROVE shows only that you hold the secret, without publishing it.`,
      }),
    },
    {
      id: "reveal-share/2",
      text: (ctx) => ({
        ja: `曲線の式を言葉で書くと「高さ = 秘密 + (係数 1 × 横) + (係数 2 × 横 × 横)」です。係数 (= かける数) はチームごとにランダムに決まり、横 0 では秘密だけが残ります。数が大きくなりすぎないよう、計算のたびに「ある数で割った余り」だけを残します。この試合でその数は ${ctx.prime} です。例は「3 個で戻る」設定、割る数 7 で見ます。「7 で割った余り」を、これから mod 7 と書きます。例: 秘密 3、係数 2 と 5。式は 3 + 2×横 + 5×横×横。横 1: 3 + 2 + 5 = 10、mod 7 で 3 → かけら #1 = 3。横 2: 3 + 4 + 20 = 27、mod 7 で 6 → #2 = 6。横 3: 3 + 6 + 45 = 54、mod 7 で 5 → #3 = 5。次に秘密 0、係数 3 と 0 の別の式 0 + 3×横 を試すと、#1 = 3、#2 = 6 と同じになり、#3 だけ 9 mod 7 = 2 と変わります。かけら 2 個では秘密が 3 か 0 か区別できず、3 個目で初めて決まります。これが「${ctx.threshold} 個で戻り、それより少ないと何も分からない」の正体です。`,
        en: `In words, the curve is: height = secret + (coefficient 1 x position) + (coefficient 2 x position x position). The coefficients (= the numbers you multiply by) are random per team, and at position 0 only the secret remains. To stop the numbers from growing, after each calculation only the remainder of division by a fixed number is kept. In this match that number is ${ctx.prime}. The example uses a 3-share setting and 7. From here on, the remainder of division by 7 is written mod 7. Example: secret 3, coefficients 2 and 5. The curve is 3 + 2 x position + 5 x position x position. Position 1: 3 + 2 + 5 = 10, mod 7 gives 3, so share #1 = 3. Position 2: 3 + 4 + 20 = 27, mod 7 gives 6, so #2 = 6. Position 3: 3 + 6 + 45 = 54, mod 7 gives 5, so #3 = 5. Now try a different curve, secret 0 with coefficients 3 and 0: 0 + 3 x position. It gives the same #1 = 3 and #2 = 6, and only #3 differs: 9 mod 7 = 2. With two shares you cannot tell whether the secret is 3 or 0; the third share settles it. That is why ${ctx.threshold} shares rebuild the secret and fewer tell nothing.`,
      }),
    },
    {
      id: "reveal-share/3",
      text: (ctx) => {
        const indices = ctx.task.kind === "reveal-share" ? ctx.task.shareIndices : [];
        const listJa = indices.map((i) => "#" + i).join("・");
        const listEn = indices.map((i) => "#" + i).join(", ");
        const valueOf = (i: number) => ctx.vault.shares.find((share) => share.index === i)?.value;
        const cardsJa = indices
          .map((i) => {
            const value = valueOf(i);
            return value === undefined ? "#" + i + " は MY VAULT の「かけらを見る」で開いて確認" : "#" + i + " = " + value;
          })
          .join("、");
        const cardsEn = indices
          .map((i) => {
            const value = valueOf(i);
            return value === undefined ? "#" + i + " (open it under MY VAULT with show shares)" : "#" + i + " = " + value;
          })
          .join(", ");
        const n = indices.length;
        return {
          ja: `この Order が求めているかけらは ${listJa} です。MY VAULT の「かけらを見る」を押し、${listJa} のカードを開くと数が出ます。いま入っている数は ${cardsJa} (世代 ${ctx.vault.generation}) です。計算はありません。LEAK を押すと、Public Ledger (公開記録 = 全チームが見られる記録) のあなたのチーム・世代 ${ctx.vault.generation} の欄に ${cardsJa} がそのまま載り、Order は完了します。押す前に 1 つだけ確認します。画面の「危険度」レーンにあるあなたの行で、色がついた丸の数を数えてください。それが世代 ${ctx.vault.generation} で公開済みのかけらの数です。この LEAK で ${n} 個増えます。「いまの数 + ${n}」が ${ctx.threshold} 以上なら、相手はあなたの秘密を復元 (HUNT) できます。その場合は PROVE (公開せずに証明する) を選ぶか、先に ROTATE で世代を変えてから LEAK します。${ctx.threshold} 未満なら LEAK を押して完了です。`,
          en: `This Order asks for ${listEn}. Press show shares under MY VAULT and open the ${listEn} card to see the number. Right now it holds ${cardsEn} (generation ${ctx.vault.generation}). There is no calculation. Press LEAK and ${cardsEn} appears as it is under your team, generation ${ctx.vault.generation}, on the Public Ledger (the record every team can see), and the Order is complete. Check one thing before pressing. In the EXPOSURE lane, count the coloured circles in your row: that is how many of your generation ${ctx.vault.generation} shares are already public. This LEAK adds ${n}. If that count plus ${n} reaches ${ctx.threshold}, an opponent can rebuild your secret (HUNT). In that case choose PROVE (prove without publishing), or ROTATE to a new generation first and LEAK after. If it stays below ${ctx.threshold}, press LEAK and you are done.`,
        };
      },
    },
  ],
  "homomorphic-sum": [
    {
      id: "homomorphic-sum/1",
      text: () => ({
        ja: "暗号文 (= ある数を「鍵」で読めない形に閉じたもの。鍵は判定側だけが持つ秘密の数で、暗号文ごとに違ってよい) が 2 つ届いています。鍵はあなたには配られていません。閉じられている元の数を「中身」と呼びます。この Order の暗号文は (左, 右) という 2 つの数の組です。左はくじで選んだだけの数、右は中身に「隠す数」(= 鍵と左の数をかけたもの) を足した数です。鍵を知らないと隠す数がわからないので、右を見ても中身はわかりません。なぜ閉じたまま足せるのか。右は「中身 + 隠す数」という足し算だけでできています。だから 2 つの暗号文の右どうしを足すと「中身の合計 + 隠す数の合計」になります。判定側は隠す数の合計を知っているので、それを引けば中身の合計が取り出せます。つまり、閉じたまま足したものは、中身を足してから閉じたものと同じ形です。あなたは開けずに足すだけでよく、開ける必要はありません。",
        en: "You have been handed two ciphertexts (a ciphertext = a number closed with a \"key\" so it cannot be read; the key is a secret number only the judge holds, and each ciphertext may use a different one). You were never given a key. The original number that is closed away is called the \"content\". Each ciphertext on this Order is a pair of numbers (left, right). The left is just a number drawn by lot; the right is the content plus a \"hiding number\" (= the key times the left number). Without the key you cannot know the hiding number, so seeing the right tells you nothing about the content. Why can you add without opening? The right is built only from addition: content + hiding number. So adding the two rights gives content total + hiding-number total. The judge knows the hiding-number total, subtracts it, and gets the content total. In other words, adding the closed pairs gives the same shape as adding the contents first and then closing. You only add; you never open.",
      }),
    },
    {
      id: "homomorphic-sum/2",
      text: () => ({
        ja: "言葉で言うと、答えは「左どうしを足して p で割った余り」と「右どうしを足して p で割った余り」の 2 つの数です。数式で書きます。暗号文 1 を (r1, y1)、暗号文 2 を (r2, y2) とします (r が左の値、y が右の値)。答えの暗号文は、左が r1 + r2、右が y1 + y2 です。ただしこの Order の数はすべて 0 から p − 1 の範囲で、p は画面の「p (割る数)」です。足して p 以上になったら「p で割った余り」にします。例: 11 を 7 で割ると 1 あまり 4 なので、余りは 4。これを「11 mod 7 = 4」と書きます。どの数も p より小さいので、2 つ足しても p を引くのは多くても 1 回です。1 桁の例、p = 7: 暗号文 1 = (2, 5)、暗号文 2 = (3, 6)。左: 2 + 3 = 5。7 未満なのでそのまま 5。右: 5 + 6 = 11。7 以上なので 7 を引いて 4 (= 11 mod 7)。答えは (5, 4)。なぜこれでよいか: y1 = 中身1 + 隠す数1、y2 = 中身2 + 隠す数2 なので、y1 + y2 = (中身1 + 中身2) + (隠す数1 + 隠す数2)。余りをとっても足し算の形は崩れません。判定側は隠す数の合計を知っているので、中身の合計を取り出して答え合わせをします。",
        en: "In words: the answer is two numbers, \"the lefts added, then the remainder after dividing by p\" and \"the rights added, then the remainder after dividing by p\". In symbols: call ciphertext 1 (r1, y1) and ciphertext 2 (r2, y2) (r is the left value, y is the right value). The answer ciphertext has left r1 + r2 and right y1 + y2. But every number on this Order lies between 0 and p − 1, where p is the screen's \"p (the modulus)\" — the number we divide by. If a sum reaches p, replace it with \"the remainder after dividing by p\". Example: 11 divided by 7 is 1 remainder 4, so the remainder is 4. This is written \"11 mod 7 = 4\". Every number is below p, so after adding two you subtract p at most once. One-digit example, p = 7: ciphertext 1 = (2, 5), ciphertext 2 = (3, 6). Left: 2 + 3 = 5. Below 7, so it stays 5. Right: 5 + 6 = 11. That is 7 or more, so subtract 7: 4 (= 11 mod 7). The answer is (5, 4). Why this is right: y1 = content1 + hiding1 and y2 = content2 + hiding2, so y1 + y2 = (content1 + content2) + (hiding1 + hiding2). Taking the remainder keeps that addition shape. The judge knows the hiding total, so it extracts the content total and checks it.",
      }),
    },
    {
      id: "homomorphic-sum/3",
      text: (ctx) => {
        if (ctx.task.kind !== "homomorphic-sum") {
          throw new Error(`homomorphic-sum/3 rendered against a ${ctx.task.kind} Order`);
        }
        const p = ctx.prime;
        const inputs = ctx.task.inputs;
        const listJa = inputs.map((c, i) => `暗号文 ${i + 1} = (${c.r}, ${c.y})`).join("、");
        const listEn = inputs.map((c, i) => `ciphertext ${i + 1} = (${c.r}, ${c.y})`).join(", ");
        const rs = inputs.map((c) => c.r).join(" + ");
        const ys = inputs.map((c) => c.y).join(" + ");
        return {
          ja: `この Order の数で。${listJa}。p (割る数) = ${p}。① 左の値: ${rs} = ？ 結果が ${p} 以上なら ${p} を引く。その数を「答え: 左の値」の箱に入れる。② 右の値: ${ys} = ？ 結果が ${p} 以上なら ${p} を引く。その数を「答え: 右の値」の箱に入れる。③ どちらの箱も ${p} より小さい数になっていることを確かめて、「暗号文を提出」を押す。暗号文を開ける必要はなく、鍵も使いません。足して余りをとるだけで、判定側が中身の合計を確かめます。`,
          en: `With this Order's numbers. ${listEn}. p (the modulus) = ${p}. (1) Left value: ${rs} = ? If the result is ${p} or more, subtract ${p}. Type that number into the "your answer: left part" box. (2) Right value: ${ys} = ? If the result is ${p} or more, subtract ${p}. Type that number into the "your answer: right part" box. (3) Check that both boxes hold a number smaller than ${p}, then press SUBMIT CIPHERTEXT. You never open a ciphertext and never use a key. You only add and take the remainder; the judge checks the content total.`,
        };
      },
    },
  ],
  "masked-total": [
    {
      id: "masked-total/1",
      text: (ctx) => {
        if (ctx.task.kind !== "masked-total") throw new Error("masked-total/1 rendered against a " + ctx.task.kind + " Order");
        const n = ctx.task.partyCount;
        return {
          ja: `この Order には ${n} つの拠点 (会社) がいて、あなたはその 1 つです。${n} 社は「数の合計」だけを知りたいのですが、自分の数は誰にも見せたくありません。そこで使うのが「覆面」です。覆面とは、2 つの拠点が内緒で決めた数のことです。この Order では、その数はもうあなたのカードに書いてあります。各拠点は自分の数そのものではなく「小計」(提出する数) を出します。覆面を送った側はその数を自分の小計から引き、受け取った側は自分の小計に足します。つまりあなたが提出する「覆面をかけた小計」は、自分の数に受け取った覆面を足し、送った覆面を引いた数です。なぜうまくいくのでしょうか。${n} 社の小計を全部足すと、どの覆面も「足された 1 回」と「引かれた 1 回」がそろって消え、本当の数の合計だけが残ります。そして小計 1 つだけを見ても、中の覆面を知らない相手にはでたらめな数にしか見えません。だから自分の数は隠れたまま、合計だけが出ます。`,
          en: `This Order has ${n} offices (companies), and you are one of them. The ${n} offices want to know only the total of their numbers, and none of them wants to show its own number. The tool for that is a "mask". A mask is a number that two offices agreed on in secret. In this Order those numbers are already written on your card. Each office publishes not its own number but a "subtotal" (the number it submits). The office that sent a mask subtracts it from its subtotal; the office that received it adds it to its subtotal. So the "masked subtotal" you submit is your own number, plus the masks you received, minus the masks you sent. Why does it work? When all ${n} subtotals are added together, every mask was added once and subtracted once, so it disappears, and only the total of the real numbers remains. And one subtotal on its own looks like a random number to anyone who does not know the masks inside it. So your number stays hidden and only the total comes out.`,
        };
      },
    },
    {
      id: "masked-total/2",
      text: () => ({
        ja: "言葉で書くと「小計 = 自分の数 + 受け取った覆面の合計 − 送った覆面の合計」です。ただしこのゲームでは、答えを「割る数 p で割った余り」に直します。余りとは、割り算で割り切れずに残る数のことです (9 を 7 で割ると 1 回割れて 2 が残るので、余りは 2)。余りに直す作業は「p を何回か足す、または引く」だけです。p を足しても引いても p で割った余りは変わらないので、余りに直しても覆面の打ち消し合いはそのまま成り立ち、合計の余りも変わりません。p = 7 の例で見ます。自分の数 3、受け取った覆面 1 と 2、送った覆面 6 と 5。3 + (1 + 2) − (6 + 5) = 3 + 3 − 11 = −5。負の数になったら 7 を足します: −5 + 7 = 2。0 以上 6 以下に入ったので、答えは 2 です。まだ負なら 7 をもう一度足し、7 以上なら 7 を引きます。0 以上 6 以下になるまで繰り返します。この「7 で割った余り」を、これから mod 7 と書きます。つまり −5 mod 7 = 2 です。",
        en: "In words: subtotal = your own number + the total of the masks you received − the total of the masks you sent. But in this game the answer is turned into \"the remainder when divided by the divisor p\". A remainder is what is left over when a division does not come out even (9 divided by 7 goes 1 time with 2 left over, so the remainder is 2). Turning a number into its remainder only means adding or subtracting p some number of times, and adding or subtracting p never changes the remainder when divided by p. So the masks still cancel, and the remainder of the total is untouched. Example with p = 7: your number 3, masks received 1 and 2, masks sent 6 and 5. 3 + (1 + 2) − (6 + 5) = 3 + 3 − 11 = −5. It went negative, so add 7: −5 + 7 = 2. That is between 0 and 6 (both included), so the answer is 2. If it is still negative, add 7 again; if it is 7 or more, subtract 7. Repeat until it is between 0 and 6, both included. From here on, this \"remainder when divided by 7\" is written mod 7. So −5 mod 7 = 2.",
      }),
    },
    {
      id: "masked-total/3",
      text: (ctx) => {
        if (ctx.task.kind !== "masked-total") throw new Error("masked-total/3 rendered against a " + ctx.task.kind + " Order");
        const p = Number(ctx.prime);
        const received = ctx.task.incomingMasks.map(Number);
        const sent = ctx.task.outgoingMasks.map(Number);
        const sum = (xs: readonly number[]) => xs.reduce((acc, x) => acc + x, 0);
        const R = sum(received);
        const S = sum(sent);
        const my = ctx.task.myInput;
        return {
          ja: `この Order の数で計算します。割る数 p = ${p}。① 受け取った覆面を全部足します: ${received.join(" + ")} = ${R}。② 送った覆面を全部足します: ${sent.join(" + ")} = ${S}。③ 自分の数 ${my} に ① を足して ② を引きます: ${my} + ${R} − ${S} = ？ ④ 出た数が 0 未満なら ${p} を足します (まだ 0 未満ならもう一度足す)。${p} 以上なら ${p} を引きます (まだ ${p} 以上ならもう一度引く)。0 以上 ${p - 1} 以下に入った数が答えです。⑤ その数を「覆面をかけた小計」の欄に入力して「小計を提出」を押します。自分の数 ${my} そのものは提出しません。`,
          en: `Now with this Order's numbers. Divisor p = ${p}. (1) Add up every mask you received: ${received.join(" + ")} = ${R}. (2) Add up every mask you sent: ${sent.join(" + ")} = ${S}. (3) Take your own number ${my}, add (1) and subtract (2): ${my} + ${R} − ${S} = ? (4) If the result is below 0, add ${p} (if it is still below 0, add ${p} again). If it is ${p} or more, subtract ${p} (if it is still ${p} or more, subtract ${p} again). The number that lands between 0 and ${p - 1} (both included) is your answer. (5) Type it into the "your masked subtotal" field and press SUBMIT SUBTOTAL. Never submit your own number ${my} itself.`,
        };
      },
    },
  ],
  "caesar-shift": [
    {
      id: "caesar-shift/1",
      text: () => ({
        ja: "「暗号」とは、文をほかの人に読めない形に変えることです。もとの文を「平文（ひらぶん）」、変えたあとの文を「暗号文」といいます。この Order の文は、サイコロの目のような「記号」の列です。\n変え方はかんたんです。記号を決まった並び順に置き、どの記号も同じ数だけ後ろへずらします。このずらす数を「鍵（かぎ）」といいます。いちばん後ろの記号の次は、先頭に戻ります。\nなぜ元に戻せるのか。全部の記号を同じ数だけずらしたので、受け取った人は同じ数だけ前に戻せば平文になります。だから鍵を知っている人だけが読めます。\nずらすというやり方（方式）は全チームが知っています。秘密は鍵の数だけです。だから平文と暗号文の組が 1 つ漏れると、暗号文の記号の番号から平文の記号の番号を引くだけで、ずらした数、つまり鍵がわかってしまいます。それがこの暗号の弱点です。",
        en: "A \"cipher\" changes a message into a form other people cannot read. The original message is the \"plaintext\"; the changed one is the \"ciphertext\". The message on this Order is a row of \"symbols\" that look like die faces.\nThe change is simple. Put the symbols in a fixed order, and move every symbol the same number of places forward. That number is the \"key\". After the last symbol you go back to the first.\nWhy can it be undone? Every symbol was moved by the same amount, so the receiver moves each one back by that amount and gets the plaintext. So only someone who knows the key can read it.\nThe method (shifting) is known to every team. The only secret is the key. That is why one leaked pair of plaintext and ciphertext gives the key away: subtract the plaintext symbol's number from the ciphertext symbol's number and you get the shift, which is the key. That is this cipher's weakness.",
      }),
    },
    {
      id: "caesar-shift/2",
      text: () => ({
        ja: "記号に、並び順のとおり 0 から番号をつけます。記号が 6 種類なら 0, 1, 2, 3, 4, 5 です。\n暗号にする計算は「番号に鍵を足す」です。足した答えが記号の種類数以上になったら、種類数を引きます。これが「先頭に戻る」の意味です。\nこれは「足した答えを種類数で割った余り」と同じです。たとえば 7 を 5 で割った余りは 2 で、これを 7 mod 5 = 2 と書きます。式にすると「(番号 + 鍵) mod 種類数」です。\n例（この Order の数字ではありません）。記号が 5 種類（番号 0〜4）、鍵が 3、平文の番号が 4 と 1 のとき。\n1 番目: 4 + 3 = 7。5 以上なので 5 を引いて 2。\n2 番目: 1 + 3 = 4。5 より小さいのでそのまま 4。\n暗号文の番号は 2, 4 です。",
        en: "Number the symbols from 0 in the order they are shown. With 6 symbols the numbers are 0, 1, 2, 3, 4, 5.\nEncrypting means \"add the key to the number\". If the sum reaches the number of symbols or more, subtract the number of symbols. That is what \"go back to the first\" means.\nThis is the same as \"the remainder when the sum is divided by the number of symbols\". For example, 7 divided by 5 leaves remainder 2, and we write this as 7 mod 5 = 2. As a formula: (number + key) mod number-of-symbols.\nExample (not this Order's numbers). 5 symbols (numbers 0 to 4), key 3, plaintext numbers 4 and 1.\nPosition 1: 4 + 3 = 7. That is 5 or more, so subtract 5: 2.\nPosition 2: 1 + 3 = 4. That is below 5, so it stays 4.\nThe ciphertext numbers are 2, 4.",
      }),
    },
    {
      id: "caesar-shift/3",
      text: (ctx) => {
        if (ctx.task.kind !== "caesar-shift") throw new Error("caesar-shift/3 rendered against a non-caesar Order");
        const n = ctx.task.symbols.length;
        const key = ctx.task.myKey;
        const values = ctx.task.plaintext;
        const jaLines = values.map((v, i) => `${i + 1} 番目: ${v} + ${key} = ？`).join("\n");
        const enLines = values.map((v, i) => `Position ${i + 1}: ${v} + ${key} = ?`).join("\n");
        const jaZero = key === 0 ? "\n鍵が 0 なので、足しても番号は変わりません。それでも正しい答えです。" : "";
        const enZero = key === 0 ? "\nYour key is 0, so adding it changes nothing. That is still the correct answer." : "";
        return {
          ja: `この Order の記号は ${n} 種類で、番号は 0 から ${n - 1} までです。あなたの鍵は ${key} です。\n平文を番号にすると: ${values.join(", ")}（画面の「記号の並び順」で、各記号の下に書いてある数に読みかえたものです）。\n左から 1 つずつ、番号に ${key} を足します。答えが ${n} 以上なら ${n} を引きます。${jaZero}\n${jaLines}\nできた ${values.length} 個の番号を、空白で区切って「暗号にした列」の入力欄に入れ、CIPHER を押します。番号のかわりに記号でも入力できます。`,
          en: `This Order has ${n} symbols, numbered 0 to ${n - 1}. Your key is ${key}.\nThe plaintext as numbers: ${values.join(", ")} (each symbol replaced by the number written under it in "the symbols, in order" on screen).\nGo left to right and add ${key} to each number. If the result is ${n} or more, subtract ${n}.${enZero}\n${enLines}\nType the ${values.length} numbers you get, separated by spaces, into the "your encrypted row" box and press CIPHER. You may type the symbols instead of the numbers.`,
        };
      },
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
