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

import { handWorkSteps } from "./commitment.ts";
import type { SubmissionMethod } from "./methods.ts";
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
  readonly allowedMethods: readonly SubmissionMethod[];
  /** Distinct, already-public indices from only this team and generation. */
  readonly exposedShareIndices: readonly number[];
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
 * [Issue #712] Each ladder climbs the same three rungs -- what this is and how
 * it works, the formula with a one-digit example, this Order's own numbers one
 * line at a time -- and the last rung stops at the final expression the reader
 * evaluates themselves. That is the owner's bar from a live run: a reader with
 * junior-high maths and no vocabulary must be able to open the rungs and finish
 * the Order. Twelve junior-high-role readers answered 12/12 real Orders from
 * these rungs alone (three seeds x four kinds) before this landed.
 */
export const HINT_LADDER: Readonly<Record<OrderTaskKind, readonly HintSpec[]>> = {
  /**
   * The share Order is the one place where the hint is about the GAME rather
   * than the arithmetic: LEAK is one click while PROVE uses the four-cell sudoku scaffold, and the whole difficulty
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
  "rps-duel": [
    { id: "rps-duel/1", text: () => ({
      ja: "相手とじゃんけんをします。先に手を言うと相手に勝つ手を選ばれるので、手に『隠す数』を混ぜた数字だけを先に出します。この数字をコミットメントと呼びます。両者が出したあとに、手と隠す数を審判へ渡します。審判は数字が一致するか確かめ、両方の開封がそろってから同時に公開します。隠す数は毎回くじで選び直します。",
      en: "Play rock-paper-scissors. Announcing your hand first would let your opponent counter it. First send a number combining your hand with a hiding number: a commitment. Once both arrive, give the judge your hand and hiding number. The judge checks them, holds each opening privately, and publishes both together. Draw a fresh hiding number every round.",
    }) },
    { id: "rps-duel/2", text: () => ({
      ja: "手の番号 m はグー 1・チョキ 2・パー 3。隠す数 r は 0〜10 のくじから毎回選びます。封じる数字 c は『4 を m 回掛けた数 × 9 を r 回掛けた数』を 23 で割った余り。4^m × 9^r mod 23 と書き、0 回掛ける場合は 1 とします。例：m=1、r=1 なら 4×9=36、36−23=13。まず 13 だけ送り、あとで (1,1) を渡します。この小さな数では別の開け方も探せるため、審判が両開封を同時公開して後出しを防ぎます。commit-reveal は『先に封じて後で開く』手順で、それだけでゼロ知識証明になるわけではありません。",
      en: "m is rock 1, scissors 2, paper 3. Draw r uniformly from 0–10. Multiply m factors of 4 and r factors of 9, then multiply those results and keep the remainder after division by 23: c = 4^m × 9^r mod 23. A zeroth power is 1. For m=1, r=1: 4×9=36; 36−23=13. Send 13, then open with (1,1). Tiny numbers permit alternative openings, so the judge publishes both together to prevent adapting after seeing the other hand. Commit-reveal is not itself a zero-knowledge proof.",
    }) },
    { id: "rps-duel/3", text: () => ({
      ja: `「手の番号」と「隠す数」を選び、紙に控えます。表から 4^m と 9^r をそれぞれ 23 で割った余りを読み、掛けて 23 で割った余りを「封じる数字」に入れます。審判はあなたの選択をまだ知らないため、見本 m=2・r=2 で行を追います。\n${handWorkSteps(2, 2).join('\n').replaceAll('mod 23', '23 で割った余り')}\n自分の値で計算して「数字を封じる」。両者の数字がそろったら、控えた手と隠す数を入れて「手を審判へ渡す」。待ち表示なら相手の操作待ちです。`,
      en: `Choose and write down your hand and hiding number. Read the remainders of 4^m and 9^r after division by 23 from the table, multiply, and enter the remainder after division by 23 in Sealed number. The judge does not know your choice yet, so this is a sample m=2, r=2:\n${handWorkSteps(2, 2).join('\n')}\nCalculate with your choice and press Seal the number. When both arrive, use your notes and press Give my opening to the judge. A waiting message means the opponent must act.`,
    }) },
  ],
  "reveal-share": [
    {
      id: "reveal-share/1",
      text: (ctx) => ({
        ja: `Order (= あなたのチームに届いた依頼) が、かけらを求めています。かけら (share) は秘密の数を ${ctx.shareCount} 個に分けたうちの 1 個。MY VAULT の #1〜#${ctx.shareCount} がそれです。
作り方は、秘密と内緒で選んだ数を入れた式に、かけらの番号を入れて計算する方法です。番号 0 の値が秘密で、番号 1 以降の値がかけらになります。すべて ${ctx.prime} で割った余りで扱います。
この試合では、同じ世代 (= 同じ秘密から作った一組) の異なる番号が ${ctx.threshold} 個あれば式が決まり、番号 0 の秘密を戻せます。${ctx.threshold - 1} 個では、0 から ${BigInt(ctx.prime) - 1n} までの秘密がどれも候補に残ります。無限の曲線ではなく、割った余りの範囲にある全 ${ctx.prime} 通りの秘密が残る、という意味です。
LEAK はかけらを公開記録に載せる操作。必要な個数を集めて秘密を戻す攻撃を HUNT と呼びます。PROVE は別の秘密である数独の解を持つことを示し、このかけらを出さずに Order に答えます。`,
        en: `An Order (= a request sent to your team) asks for a share. A share is one of ${ctx.shareCount} pieces of your secret number: #1 to #${ctx.shareCount} in MY VAULT.
A formula combines the secret with privately chosen numbers. Put a share index into that formula: index 0 gives the secret, and later indices give shares. Keep remainders after dividing by ${ctx.prime}.
Here ${ctx.threshold} distinct indices from one generation (= one set made from the same secret) fix the formula and recover its value at 0. With ${ctx.threshold - 1} shares, every candidate secret from 0 to ${BigInt(ctx.prime) - 1n} remains possible. This is a finite set of ${ctx.prime} possible secrets, not infinitely many ordinary curves.
LEAK publishes a share. Recovering a secret from enough shares is the HUNT attack. PROVE instead demonstrates that you hold your separate sudoku solution, completing the Order without publishing its requested share.`,
      }),
    },
    {
      id: "reveal-share/2",
      text: (ctx) => {
        const termsJa = Array.from({ length: ctx.threshold - 1 }, (_, i) => `係数${i + 1} × ${Array(i + 1).fill("番号").join(" × ")}`);
        const termsEn = Array.from({ length: ctx.threshold - 1 }, (_, i) => `coefficient${i + 1} × ${Array(i + 1).fill("index").join(" × ")}`);
        return {
          ja: `この試合の式は「かけら = 秘密${termsJa.length ? " + " + termsJa.join(" + ") : ""}」を ${ctx.prime} で割った余りです。係数は内緒で選ぶ『掛ける数』で、${ctx.threshold - 1} 個使います。番号 0 を入れると、秘密以外の項は全部 0 になります。
ここからは『3 個で戻る・割る数 7』の小さい例です。本番の設定 (${ctx.threshold} 個・割る数 ${ctx.prime}) とは区別してください。秘密 1、係数 0 と 1 なら、式は 1 + 0 × 番号 + 1 × 番号 × 番号。#1: 1 + 1 = 2、#2: 1 + 4 = 5、#3: 1 + 9 = 10、7 を引いて 3。これを 10 mod 7 = 3 と書き、mod は『割った余り』の意味です。
例の秘密を戻すと、3 × 2 − 3 × 5 + 3 = −6、7 を足して 1。これは『番号 1・2・3』専用の戻し方です。係数に掛かる数が 3 × 1 − 3 × 2 + 3 = 0 と、3 × 1 − 3 × 4 + 9 = 0 になり、秘密だけ残ります。
2 個だけではなぜ足りないか。秘密 2、係数 2 と 5 でも、#1 は 2 + 2 + 5 = 9 → 2、#2 は 2 + 4 + 20 = 26 → 5 と同じです。無料の『秘密のかけら』解説には、0〜6 の全候補に対応する係数の表があります。`,
          en: `This match uses share = secret${termsEn.length ? " + " + termsEn.join(" + ") : ""}, taking the remainder after dividing by ${ctx.prime}. A coefficient is a privately chosen multiplier; this setting uses ${ctx.threshold - 1} of them. At index 0 every term except the secret disappears.
The following small example uses a THREE-share setting and divisor 7, separate from this match's ${ctx.threshold}-share setting and divisor ${ctx.prime}. Secret 1, coefficients 0 and 1: 1 + 0 × index + 1 × index × index. #1: 1 + 1 = 2; #2: 1 + 4 = 5; #3: 1 + 9 = 10 → 10 − 7 = 3. Write this as 10 mod 7 = 3; mod means remainder.
Recover the example secret: 3 × 2 − 3 × 5 + 3 = −6 → −6 + 7 = 1. This shortcut is ONLY for indices 1, 2, 3. The coefficient multipliers cancel: 3 × 1 − 3 × 2 + 3 = 0 and 3 × 1 − 3 × 4 + 9 = 0, leaving only the secret.
Why not two shares? Secret 2 with coefficients 2 and 5 gives #1: 2 + 2 + 5 = 9 → 2 and #2: 2 + 4 + 20 = 26 → 5: the same two shares. The free Secret shares explanation lists the coefficients for every possible secret 0–6.`,
        };
      },
    },
    {
      id: "reveal-share/3",
      text: (ctx) => {
        if (ctx.task.kind !== "reveal-share") throw new Error("reveal-share/3 needs a share Order");
        const indices = [...new Set(ctx.task.shareIndices)];
        const cards = indices.map((index) => {
          const share = ctx.vault.shares.find((piece) => piece.index === index);
          if (!share) throw new Error(`missing own share #${index}`);
          return `#${index} = ${share.value}`;
        }).join(", ");
        const exposed = new Set(ctx.exposedShareIndices);
        const added = indices.filter((index) => !exposed.has(index)).length;
        const after = exposed.size + added;
        const canLeak = ctx.allowedMethods.includes("leak");
        const canProve = ctx.allowedMethods.includes("prove");
        const prove = canProve ? HINT_LADDER["zk-sudoku"][2]!.text(ctx) : undefined;
        return {
          ja: `この Order が求めるのは ${cards} (世代 ${ctx.vault.generation}) です。自分の保管庫 MY VAULT の『かけらを見る』でも確認できます。
${canLeak ? `LEAK を選ぶと、この値がそのまま公開記録へ載ります。すでに公開した異なる番号は ${exposed.size} 個。今回新しく増えるのは ${added} 個なので、${exposed.size} + ${added} = ${after} 個になります。同じ番号をもう一度出しても増えません。${after >= ctx.threshold ? `必要な ${ctx.threshold} 個に達するため、相手は秘密を復元できます。` : `必要な ${ctx.threshold} 個にはまだ達しません。`} 公開してよければ LEAK を押すだけで完了です。` : "この Order は LEAK を受け付けません。かけらの値を提出する操作は使えません。"}
${prove ? `公開せずに答える PROVE の手順：${prove.ja}` : "この Order には PROVE はありません。カードに表示された方法で答えます。"}
ROTATE は新しい世代を作りますが、いまの Order を無効にして期限切れと同じ減点にします。ROTATE してからこの Order に答えることはできません。`,
          en: `This Order asks for ${cards} (generation ${ctx.vault.generation}). You can also see them in MY VAULT under show shares.
${canLeak ? `LEAK publishes those values unchanged. ${exposed.size} distinct indices are already public; this Order adds ${added} new ones: ${exposed.size} + ${added} = ${after}. Repeating an already-public index adds nothing. ${after >= ctx.threshold ? `That reaches the ${ctx.threshold} needed to recover your secret.` : `That is still below the required ${ctx.threshold}.`} If you accept publication, pressing LEAK completes the Order with no calculation.` : "This Order does not accept LEAK. You cannot submit the raw share values."}
${prove ? `To answer without the shares, use PROVE: ${prove.en}` : "This Order does not accept PROVE. Use a method shown on its card."}
ROTATE creates a fresh generation but voids this Order at the same penalty as expiry. You cannot ROTATE and then answer this same Order.`,
        };
      },
    },
  ],
  "homomorphic-sum": [
    {
      id: "homomorphic-sum/1",
      text: () => ({
        ja: "Order (= あなたのチームに届いた依頼) です。ある数を、読めない形に閉じたものを「暗号文」といいます。閉じるのに使う秘密の数が「鍵」です。この試合で答え合わせをするのはゲーム側で、これを「判定側」と呼びます。鍵は判定側だけが持ち、暗号文ごとに別の鍵です。その暗号文が 2 つ、あなたに届いています。鍵はあなたには配られていません。閉じられている元の数を「中身」と呼びます。この Order の暗号文は (左, 右) という 2 つの数の組です。入力の左は 1〜p−1 からくじで選んだ数です。p は画面の割る数で、0 は選びません。右は中身に「隠す数」(= 鍵と左の数をかけたもの) を足し、p で割った余りです。鍵を知らないと隠す数がわからないので、右を見ても中身はわかりません。なぜ閉じたまま足せるのか。右は「中身 + 隠す数」という足し算だけでできています。だから 2 つの暗号文の右どうしを足すと、余りを取る前の「中身の合計 + 隠す数の合計」と同じ余りになります。判定側は隠す数の合計を知っているので、それを引けば中身の合計が取り出せます。つまり、閉じたまま足しても「中身の合計」は壊れずに中に残っていて、判定側だけがそれを取り出せます。あなたは開けずに足すだけでよく、開ける必要はありません。このように暗号文のまま計算する考え方が準同型暗号です。FHE (= 完全準同型暗号) は掛け算なども扱いますが、この教材は足し算の部分を小さい数で体験するモデルです。",
        en: "This is an Order (= a request sent to your team). A number closed into an unreadable form is called a \"ciphertext\". The secret number used to close it is the \"key\". In this match the side that checks answers is the game itself; we call it the \"judge\". Only the judge holds keys, and each ciphertext has its own key. Two such ciphertexts have been handed to you. You were never given a key. The original number that is closed away is called the \"content\". Each ciphertext on this Order is a pair of numbers (left, right). Each input’s left is drawn from 1 to p−1, where p is the divisor on screen; never 0. The right is the remainder after dividing content plus a \"hiding number\" (= key times left) by p. Without the key you cannot know the hiding number, so seeing the right tells you nothing about the content. Why can you add without opening? The right is built only from addition: content + hiding number. So adding the two rights gives the same remainder as content total plus hiding-number total. The judge knows the hiding-number total, subtracts it, and gets the content total. In other words, adding the closed pairs keeps the content total intact inside, and only the judge can take it out. You only add; you never open. This is the idea of homomorphic encryption. FHE (fully homomorphic encryption) also supports multiplication; this teaching model demonstrates the addition part with small numbers.",
      }),
    },
    {
      id: "homomorphic-sum/2",
      text: () => ({
        ja: "言葉で言うと、答えは「左どうしを足して p で割った余り」と「右どうしを足して p で割った余り」の 2 つの数です。数式で書きます。暗号文 1 を (r1, y1)、暗号文 2 を (r2, y2) とします (r が左の値、y が右の値)。答えの暗号文は、左が r1 + r2、右が y1 + y2 です。ただしこの Order の数はすべて 0 から p − 1 の範囲で、p は画面の「p (割る数)」です。足して p 以上になったら「p で割った余り」にします。例: 11 を 7 で割ると 1 あまり 4 なので、余りは 4。これを「11 mod 7 = 4」と書きます。どの数も p より小さいので、2 つ足しても p を引くのは多くても 1 回です。1 桁の例、p = 7: 暗号文 1 = (2, 5)、暗号文 2 = (3, 6)。左: 2 + 3 = 5。7 未満なのでそのまま 5。右: 5 + 6 = 11。7 以上なので 7 を引いて 4 (= 11 mod 7)。答えは (5, 4)。なぜこれでよいか: y1 は 1 個目の「中身 + 隠す数」を p で割った余り、y2 は 2 個目の同じ余りです。y1 + y2 を p で割った余りは、「中身の合計 + 隠す数の合計」を p で割った余りと同じです。余りをとっても足し算の形は崩れません。判定側は隠す数の合計を知っているので、中身の合計を取り出して答え合わせをします。",
        en: "In words: the answer is two numbers, \"the lefts added, then the remainder after dividing by p\" and \"the rights added, then the remainder after dividing by p\". In symbols: call ciphertext 1 (r1, y1) and ciphertext 2 (r2, y2) (r is the left value, y is the right value). The answer ciphertext has left r1 + r2 and right y1 + y2. But every number on this Order lies between 0 and p − 1, where p is the screen's \"p (the divisor)\" — the number we divide by. If a sum reaches p, replace it with \"the remainder after dividing by p\". Example: 11 divided by 7 is 1 remainder 4, so the remainder is 4. This is written \"11 mod 7 = 4\". Every number is below p, so after adding two you subtract p at most once. One-digit example, p = 7: ciphertext 1 = (2, 5), ciphertext 2 = (3, 6). Left: 2 + 3 = 5. Below 7, so it stays 5. Right: 5 + 6 = 11. That is 7 or more, so subtract 7: 4 (= 11 mod 7). The answer is (5, 4). Why this is right: y1 and y2 are each input’s content plus hiding number, reduced to its remainder after division by p. The remainder of y1+y2 equals the remainder of content total plus hiding-number total. Taking the remainder keeps that addition shape. The judge knows the hiding total, so it extracts the content total and checks it.",
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
          en: `With this Order's numbers. ${listEn}. p (the divisor) = ${p}.\n(1) Left value: ${rs} = ? If the result is ${p} or more, subtract ${p}. Type that number into the "your answer: left part" box.\n(2) Right value: ${ys} = ? If the result is ${p} or more, subtract ${p}. Type that number into the "your answer: right part" box.\n(3) Check that both boxes hold a number smaller than ${p}, then press SUBMIT CIPHERTEXT. You never open a ciphertext and never use a key. You only add and take the remainder; the judge checks the content total.`,
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
          ja: `この Order (= あなたのチームに届いた依頼) には ${n} つの拠点 (会社) がいて、あなたはその 1 つです。${n} 社は「数の合計」だけを知りたいのですが、自分の数は誰にも見せたくありません。そこで使うのが「覆面」です。覆面とは、2 つの拠点が内緒で決めた数のことです。この Order では、その数はもうあなたのカードに書いてあります。各拠点は自分の数そのものではなく「小計」(提出する数) を出します。覆面 1 つにつき、決めた 2 社のうち片方が足し、もう片方が引くと先に決めておきます。足す側から見るとその覆面は「受け取った覆面」、引く側から見ると「送った覆面」です。あなたのカードの「受け取った覆面」「送った覆面」は、この決めごとをあなたの側から見た名前です。つまりあなたが提出する「覆面をかけた小計」は、自分の数に受け取った覆面を足し、送った覆面を引いた数です。なぜうまくいくのでしょうか。${n} 社の小計を全部足すと、どの覆面も「足された 1 回」と「引かれた 1 回」がそろって消え、本当の数の合計だけが残ります。そして小計 1 つだけを見ても、中の覆面を知らない相手にはでたらめな数にしか見えません。だから自分の数は隠れたまま、合計だけが出ます。`,
          en: `This Order (= a request sent to your team) has ${n} offices (companies), and you are one of them. The ${n} offices want to know only the total of their numbers, and none of them wants to show its own number. The tool for that is a "mask". A mask is a number that two offices agreed on in secret. In this Order those numbers are already written on your card. Each office publishes not its own number but a "subtotal" (the number it submits). For each mask, the two offices decide in advance which one adds it and which one subtracts it. Seen from the adding side that mask is a "received mask"; seen from the subtracting side it is a "sent mask". The "received masks" and "sent masks" on your card are those decisions, named from your side. So the "masked subtotal" you submit is your own number, plus the masks you received, minus the masks you sent. Why does it work? When all ${n} subtotals are added together, every mask was added once and subtracted once, so it disappears, and only the total of the real numbers remains. And one subtotal on its own looks like a random number to anyone who does not know the masks inside it. So your number stays hidden and only the total comes out.`,
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
        const p = BigInt(ctx.prime);
        const received = ctx.task.incomingMasks.map(BigInt);
        const sent = ctx.task.outgoingMasks.map(BigInt);
        const sum = (xs: readonly bigint[]) => xs.reduce((acc, x) => acc + x, 0n);
        const R = sum(received);
        const S = sum(sent);
        const my = ctx.task.myInput;
        return {
          ja: `この Order の数で計算します。割る数 p = ${p}。① 受け取った覆面を全部足します: ${received.join(" + ")} = ${R}。② 送った覆面を全部足します: ${sent.join(" + ")} = ${S}。③ 自分の数 ${my} に ① を足して ② を引きます: ${my} + ${R} − ${S} = ？ ④ 出た数が 0 未満なら ${p} を足します (まだ 0 未満ならもう一度足す)。${p} 以上なら ${p} を引きます (まだ ${p} 以上ならもう一度引く)。0 以上 ${p - 1n} 以下に入った数が答えです。⑤ その数を「覆面をかけた小計」の欄に入力して「小計を提出」を押します。自分の数をそのまま写すのでなく、計算した小計を提出します。覆面が打ち消し合えば、結果が自分の数と同じになる場合もあります。`,
          en: `Now with this Order's numbers. Divisor p = ${p}.\n(1) Add up every mask you received: ${received.join(" + ")} = ${R}.\n(2) Add up every mask you sent: ${sent.join(" + ")} = ${S}.\n(3) Take your own number ${my}, add (1) and subtract (2): ${my} + ${R} − ${S} = ? (4) If the result is below 0, add ${p} (if it is still below 0, add ${p} again). If it is ${p} or more, subtract ${p} (if it is still ${p} or more, subtract ${p} again). The number that lands between 0 and ${p - 1n} (both included) is your answer.\n(5) Type it into the "your masked subtotal" field and press SUBMIT SUBTOTAL. Submit the calculated subtotal, not an unworked copy of your input; cancelling masks can legitimately make those two numbers equal.`,
        };
      },
    },
  ],
  /**
   * [Issue #709] The ZK sudoku Order. Same three steps as the others -- what
   * the pieces are, the rule, the first move -- and it stops short of doing
   * the relabelling, which is the team's own work.
   */
  "zk-sudoku": [
    {
      id: "zk-sudoku/1",
      text: () => ({
        ja: "ZK（ゼロ知識証明）は、答えそのものを相手に教えず、答えを持っていると示す考え方です。ここでは 4×4 の数独を使います。どの行・列・太枠の 2×2 の箱にも 1〜4 が 1 回ずつ入るのがルールです。\n自分の完成した解を数字の読み替え表で隠し、相手には読み替え後の 1 組だけを見せます。数字の名前を一対一に替えても、同じ数字が重ならない性質は残るからです。ゲームの審判は元の解を持って全体を検査します。本来の ZK は審判にも解を渡しませんが、ここはその考え方を体験する仕組みです。",
        en: "ZK (zero-knowledge proof) means showing you hold an answer without teaching another person the answer itself. Here a 4×4 sudoku has 1–4 once each in every row, column and outlined 2×2 box.\nHide your completed solution with a digit-renaming table and show others one renamed group. A one-to-one renaming preserves the once-each rule. The trusted game judge knows your original solution and checks the whole grid; a full ZK protocol also hides the solution from its verifier. This is a teaching model of that idea.",
      }),
    },
    {
      id: "zk-sudoku/2",
      text: () => ({
        ja: "一桁の例で見ます。表を 1→3、2→1、3→4、4→2 と選びます。矢印は左の数字を右の数字に読み替える意味です。\n元の行が 2・1・3・4 なら、2→1、1→3、3→4、4→2 と替えて 1・3・4・2 になります。1〜4 を一度ずつ使う性質は同じです。\n表の右側で同じ数字を 2 回使うと、一つの行にも同じ数字が 2 回出てしまいます。だから 1〜4 を右側にちょうど 1 回ずつ使い、全マスに同じ表を使います。",
        en: "One-digit example: choose 1→3, 2→1, 3→4, 4→2. An arrow means rename its left digit to its right digit.\nOriginal row 2,1,3,4 becomes 1,3,4,2: apply 2→1, 1→3, 3→4, 4→2 in order. It still contains 1–4 once each.\nIf two original digits share a replacement, a row repeats that replacement. That is why the table must use each of 1–4 exactly once on the right and be applied identically to every cell.",
      }),
    },
    {
      id: "zk-sudoku/3",
      text: (ctx) => {
        const rows = Array.from({ length: 4 }, (_, i) => ctx.vault.sudokuSolution.slice(i * 4, i * 4 + 4).join(" "));
        const used = ctx.vault.usedPermutations.map((table) => table.map((digit, i) => `${i + 1}→${digit}`).join(" ")).join(" / ");
        return {
          ja: `① 証明の入力欄を開き（すでに開いていればそのまま）、『1. 付け替え表を選ぶ』で表を一つ選びます。世代は同じ秘密や解を使う一組のことです。この世代で使った表は ${used || "まだありません"}。使用済みの表は避けます。\n② 左の自分の解は、上から ${rows.join(" / ")} です。右は 12 マスが見本、4 マスが空欄です。\n③ 空欄と同じ位置を左で探します。その数字から、選んだ表の矢印の先へ読み替えて右に入力します。例の 2→1 なら、元が 2 の空欄に 1 を入れるということです。残りも同じ表で埋めます。\n④ 4 マスを入れたら SUBMIT を押します。審判は完成した 16 マスを検査し、通れば得点と、公開された 1 行・1 列・1 箱のどれか 1 組が表示されます。\n同じ表を再使用すると公開された組をつなげられます。HUNT は相手が秘密の答えを当てて得点する攻撃です。解が一つに絞られると HUNT されるので、次も新しい表を選びます。`,
          en: `(1) Open the proof input area if it is not already open, and choose a table under '1. Choose a relabelling table'. A generation is one set using the same secret and solution. Tables already used this generation: ${used || "none"}. Avoid a used table.\n(2) Your solution's rows, top to bottom: ${rows.join(" / ")}. The right grid has twelve worked cells and four holes.\n(3) Find each hole's position on the left. Take that original digit through your chosen table's arrow, then enter its replacement on the right. For example, 2→1 means enter 1 in a hole whose original digit was 2. Use the same table for the remaining holes.\n(4) Fill four holes and press SUBMIT. The judge checks all sixteen cells; success shows the score and one opened row, column or box.\nReusing a table lets others connect opened groups. HUNT is an attack that scores by recovering another team’s secret answer. A uniquely determined solution can be HUNTed. Choose a fresh table next time too.`,
        };
      },
    },
  ],
  "caesar-shift": [
    {
      id: "caesar-shift/1",
      text: () => ({
        ja: "この Order (= あなたのチームに届いた依頼) は暗号を作る依頼です。「暗号」とは、文をほかの人に読めない形に変えることです。もとの文を「平文（ひらぶん）」、変えたあとの文を「暗号文」といいます。この Order の文は、サイコロの目のような「記号」の列です。\n変え方はかんたんです。記号を決まった並び順に置き、どの記号も同じ数だけ後ろへずらします。このずらす数を「鍵（かぎ）」といいます。いちばん後ろの記号の次は、先頭に戻ります。\nなぜ元に戻せるのか。全部の記号を同じ数だけずらしたので、受け取った人は同じ数だけ前に戻せば平文になります。同じ鍵を使えば元に戻せます。ただし、この暗号は鍵を全部試したり、公開情報から鍵を求めたりすることもできます。\nずらすというやり方（方式）は全チームが知っています。秘密は鍵の数だけです。だから「この記号がこの記号に変わった」という組が 1 つでも外に知られると、平文の記号から並び順を後ろへたどって暗号文の記号まで何個進むか数えるだけで、ずらした数、つまり鍵がわかってしまいます (いちばん後ろまで来たら先頭に戻って数えます)。それがこの暗号の弱点です。",
        en: "This Order (= a request sent to your team) asks you to make a cipher. A \"cipher\" changes a message into a form other people cannot read. The original message is the \"plaintext\"; the changed one is the \"ciphertext\". The message on this Order is a row of \"symbols\" that look like die faces.\nThe change is simple. Put the symbols in a fixed order, and move every symbol the same number of places forward. That number is the \"key\". After the last symbol you go back to the first.\nWhy can it be undone? Every symbol was moved by the same amount, so the receiver moves each one back by that amount and gets the plaintext. Knowing the key lets you undo it, but this cipher also allows trying every possible key or recovering it from public evidence.\nThe method (shifting) is known to every team. The only secret is the key. That is why one leaked pair -- \"this symbol became that symbol\" -- gives the key away: start at the plaintext symbol, count forward along the row until you reach the ciphertext symbol (going back to the first after the last), and the count is the shift, which is the key. That is this cipher's weakness.",
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
