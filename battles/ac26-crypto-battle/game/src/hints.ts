import { vigenereGuide } from "./vigenere-guide.ts";
import { rotorGuide } from "./rotor-guide.ts";
import { rsaGuide } from "./rsa-guide.ts";
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
  "ssm-decrypt": [
    {id:"ssm-decrypt/1",text:()=>({ja:"暗号化で足した鍵を引くと元の数字に戻ります。AWSには鍵と、実際に値を取得したことを照合するランダムな受付コードが置かれています。",en:"Subtract the key added during encryption. AWS holds the key and a random receipt used to check the retrieved value."})},
    {id:"ssm-decrypt/2",text:()=>({ja:"平文=(暗号文−鍵)を10で割った余り。例：暗号文2、鍵5なら2−5=−3、10を足して7です。",en:"Plaintext is the remainder of ciphertext minus key divided by10. Example:2−5=−3; add10 to get7."})},
    {id:"ssm-decrypt/3",text:()=>({ja:"AWSリンクで値全体をコピーして貼ります。keyの数字を暗号文から引き、負なら10を足します。0〜9の答えを送るとアイテム獲得。次に相手を選んで使用します。",en:"Copy the whole AWS value. Subtract its key from the ciphertext; add10 if negative. Submit0–9 to acquire the item, then choose an opponent to use it."})},

  ],
  "enigma-encrypt": [
    {id:"enigma-encrypt/1",text:()=>({ja:"車輪を1進めてから、配線を往復します。反射板で折り返し、帰りは表を逆に引きます。",en:"Advance the wheel first, reflect, then use the inverse wiring on return."})},
    {id:"enigma-encrypt/2",text:()=>({ja:"Wは車輪の表、Rは反射板、W⁻¹は表の逆引き。元の数mの答えはW⁻¹(R(W(m)))。位置0の表0→1、1→3、2→0、3→2なら、0→1→0→2で答え2です。",en:"W is the wheel lookup, R the reflector, and W⁻¹ reads the lookup backward. The answer for input m is W⁻¹(R(W(m))). At position0, if W maps0→1,1→3,2→0,3→2, input0 travels0→1→0→2, giving2."})},
    {id:"enigma-encrypt/3",text:ctx=>{if(ctx.task.kind!=="enigma-encrypt")throw new Error("wrong task");const t=ctx.task,a=(t.initial+1)%4;return {ja:`元の数は${t.plaintext[0]}、初期位置は${t.initial}。${t.initial}+1を4で割った余り${a}の表を使います。${t.plaintext[0]}を左から右へ引き、反射板で0↔1、2↔3を交換。同じ表を右から左へ戻り、その数1個を入力します。`,en:`Input is ${t.plaintext[0]}, initial position ${t.initial}. Use the table at position ${a}, the remainder of ${t.initial}+1 divided by4. Read ${t.plaintext[0]} left→right, swap0↔1 or2↔3 at the reflector, then read the same table right→left. Enter that one number.`};}}],
  "rsa-decrypt": [
    {id:"rsa-decrypt/1",text:()=>({ja:"公開鍵で作った暗号を、秘密鍵dで元に戻します。この練習用の鍵はHUNT対象ではありません。",en:"Use private exponent d to recover the original. This exercise key is outside HUNT."})},
    {id:"rsa-decrypt/2",text:()=>({ja:"m=cᵈ mod n。毎回掛けたあと余りを取っても答えは同じです。例えば2³ mod5=(2×2×2) mod5=3。",en:"m=cᵈ mod n. Reduce after each multiplication. For example2³ mod5=3."})},
    {id:"rsa-decrypt/3",text:ctx=>({ja:`c=${ctx.task.kind==="rsa-decrypt"?ctx.task.ciphertext:"?"}。c²を15で割った余りにします。d=3なので、c³=c²×c。最後の余り1個を提出します。`,en:`c=${ctx.task.kind==="rsa-decrypt"?ctx.task.ciphertext:"?"}. Multiply this number by itself and take the remainder after dividing by15. Multiply that remainder by c=${ctx.task.kind==="rsa-decrypt"?ctx.task.ciphertext:"?"}, then take the remainder after dividing by15 again. Enter that one number.`})}],
  "ecdsa-sign": [
    {id:"ecdsa-sign/1",text:()=>({ja:"署名は暗号文ではありません。公開鍵で、メッセージと署名が対応するかを確認できます。",en:"A signature is not ciphertext. A public key checks that the signature matches the message."})},
    {id:"ecdsa-sign/2",text:()=>({ja:"kGは出発点Gをk回足した点。その左の数がr。逆元k⁻¹はkと掛けて7の余りが1になる数。s=k⁻¹(h+dr)の7で割った余りです。h=1,d=2,k=2ならr=1、s=4×3の余り5です。",en:"kG adds starting point G k times; r is its left coordinate. The inverse k⁻¹ multiplies k to leave remainder1 after division by7. s is the remainder of k⁻¹(h+dr) divided by7. For h=1,d=2,k=2, the table gives r=1 and inverse4; s=4×(1+2×1)=12 leaves5. The signature is(1,5)."})},
    {id:"ecdsa-sign/3",text:ctx=>({ja:`${ctx.task.kind==="ecdsa-sign"?`h=${ctx.task.hash},d=${ctx.task.d},k=${ctx.task.k}。`:""}kの列でrを読み、h+d×rを計算。逆元表のk⁻¹を掛けて7の余りにします。rとsを別々の欄へ入力します。`,en:`${ctx.task.kind==="ecdsa-sign"?`h=${ctx.task.hash}, d=${ctx.task.d}, k=${ctx.task.k}. Read r from column ${ctx.task.k}. Calculate ${ctx.task.hash}+${ctx.task.d}×r, then multiply by the inverse in column ${ctx.task.k}.`:""} Take the remainder after dividing by7 for s. Enter r and s in their separate fields.`})}],
  "anamorphic-rejection": [
    {id:"anamorphic-rejection/1",text:()=>({ja:"同じ通常メッセージを暗号化した候補から、秘密の表で目的のビットになるものを選びます。監視者は通常鍵で普通の数を読み、受信者だけが追加の表でビットを読みます。",en:"Select an ordinary ciphertext whose secret lookup matches the intended bit. The monitor decodes an ordinary message; the receiver additionally decodes the bit using the lookup."})},
    {id:"anamorphic-rejection/2",text:()=>({ja:"通常復号はs=aをx回掛けた数の7で割った余り。s×mの余りがbとなるmを探します。a=2,x=2,b=5ならs=4、4×3=12の余り5なのでm=3です。",en:"For ordinary decryption, s is a to power x, remainder7. Find m with s×m remainder7 equal to b. For a=2,x=2,b=5, s=4 and4×3=12 has remainder5, hence m=3."})},
    {id:"anamorphic-rejection/3",text:ctx=>{if(ctx.task.kind!=="anamorphic-rejection")throw new Error("wrong task");return {ja:`秘密の判定が${ctx.task.targetBit}になる最初の行番号を入力。その行のaに対応するsを下の表で読み、s×1〜6でbと同じ余りを探します。最後は目的のビットと一致する3行を見つけ、応用のくじの表にあるその行の枚数を足して入力します。`,en:`Enter the first row whose secret bit is ${ctx.task.targetBit}. Read s for its a from the power table; try s×1 through s×6 to match remainder b. Finally find the three rows matching the target bit, sum their ticket counts in the transfer table, and enter that total.`};}},
  ],
  "stark-trace": [
    {id:"stark-trace/1",text:()=>({ja:"まず実行表の各一歩が2乗の規則に合うか検査します。そのずれを式の余りへつなぎ、最後に商を折り畳みます。折り畳みが正しくても、実行表のずれは消えません。",en:"Check whether each trace step follows squaring, connect the mismatches to a remainder polynomial, then fold the quotient. A correct fold does not remove trace mismatches."})},
    {id:"stark-trace/2",text:()=>({ja:"7で割った余りにします。2→5は5−2²=1。ずれu=1,v=3なら余りの定数2u−v=−1を7で割った余り6。商の定数2、Xの係数3、β=2なら折り畳みの定数は2+2×3=8の余り1です。",en:"Take remainders by7. Step2→5 gives5−2²=1. Mismatches u=1,v=3 give remainder constant2u−v=−1, hence6. Quotient constant2, X coefficient3 and β=2 give fold constant2+2×3=8, hence1."})},
    {id:"stark-trace/3",text:ctx=>{if(ctx.task.kind!=="stark-trace")throw new Error("wrong hint task");const [a,b,c]=ctx.task.trace;return {ja:`最初は${b}−${a}²、次は${c}−${b}²の余りを入力。その答えをu,vとして2u−vの余りを3欄目へ。表示された商Qの定数に、${ctx.task.beta}×Xの係数を足した余りを最後の欄へ入れます。`,en:`Enter remainders of ${b}−${a}² and ${c}−${b}². Call them u,v and enter remainder2u−v in field3. In the final field enter Q’s displayed constant plus ${ctx.task.beta} times its X coefficient, reduced by7.`};}},
  ],
  "io-equivalence": [
    {id:"io-equivalence/1",text:()=>({ja:"まず全入力で同じ答えになるかを確認します。次に答えを保って表へ変換した結果を比べます。同じ機能なら、元がどちらかを結果から見分けられないことがiOの条件です。",en:"First compare the answers on every input. Then compare the transformed tables that preserve these answers. iO requires equivalent programs to have indistinguishable transformed results."})},
    {id:"io-equivalence/2",text:()=>({ja:"5で割った余りを使います。2×3+1=7なら余り2。表[0,1,2,3]を右へ1個回すと[3,0,1,2]で、入力2は位置(2+1)の3から答え2を読みます。",en:"Take remainders by5. 2×3+1=7 gives remainder2. Rotate [0,1,2,3] right by1 to get [3,0,1,2]; input2 reads position(2+1)=3 and returns2."})},
    {id:"io-equivalence/3",text:ctx=>{if(ctx.task.kind!=="io-equivalence")throw new Error("wrong hint task");const t=ctx.task;return {ja:`Aの空欄は${t.a}×${t.missing[0]}+${t.b}、Bの空欄は${t.a}×(${t.missing[1]}+${t.d})+${t.c}の余り。表4行を比較し、全部同じなら1、違えば0。下の回した表もrと組にして比べ、両側の確率が0でない共通の組だけを数えて最後の欄へ入れます。`,en:`For A calculate ${t.a}×${t.missing[0]}+${t.b}; for B calculate ${t.a}×(${t.missing[1]}+${t.d})+${t.c}, taking remainders. Compare all4 rows: enter1 if identical, else0. Compare each rotated table together with r and count only outcomes with nonzero probability on both sides in the last field.`};}},
  ],
  "snark-constraints": [
    {id:"snark-constraints/1",text:()=>({ja:"まず各行の計算を確かめ、次に前の出力が次の入力へ同じ値で届くか確かめます。行だけ正しくても、つなぎ方が違えば元の計算にはなりません。",en:"Check each gate, then whether the output reaches the next input unchanged. Correct individual gates alone do not establish correct wiring."})},
    {id:"snark-constraints/2",text:()=>({ja:"7で割った余りで確認します。足し算2+3−5=0なら一致。掛け算3×4−4=8は7を引いて余り1なので不一致。配線が5→6なら5−6=−1、7を足して余り6なので不一致です。",en:"Take remainders by7: 2+3−5=0 passes. Multiplication 3×4−4=8; subtract7 to get remainder1, so it fails. A wire5→6 gives5−6=−1, remainder6, so it fails."})},
    {id:"snark-constraints/3",text:ctx=>{
      if(ctx.task.kind!=="snark-constraints")throw new Error("SNARK task required");
      const [a,b,c]=ctx.task.rows;
      const steps=`${a[0]}+${a[1]}−${a[2]}; ${b[0]}×${b[1]}−${b[2]}; ${c[0]}+${c[1]}−${c[2]}; ${a[2]}−${c[0]}; ${b[2]}−${c[1]}`;
      return {ja:`この順で計算：${steps}。各結果に7を足すか引いて0〜6にし、上から5欄へ入力します。すべて0でなくても、正しく計算した余りを提出してください。`,en:`Calculate in order: ${steps}. Add or subtract7 until each result is0–6. Enter the five fields in order, even when the results are not all zero.`};
    }},
  ],
  "ec-add": [
    {id:"ec-add/1",text:()=>({ja:"曲線上の2点を通る線を考え、交点の上下を反転して答えの点を作ります。同じ点なら接線を使います。普通の座標の足し算とは違います。",en:"Use the line through two curve points, then reflect the intersection. A repeated point uses a tangent. This is not coordinate-wise addition."})},
    {id:"ec-add/2",text:()=>({ja:"すべて7で割った余り。P=(2,1),Q=(3,1)なら傾きλ=(1−1)/(3−2)=0。x=λ²−2−3=2、y=λ(2−x)−1=6。結果は(2,6)。",en:"Reduce modulo7. P=(2,1),Q=(3,1): slope λ=(1−1)/(3−2)=0; x=λ²−2−3=2, y=λ(2−x)−1=6. Result (2,6)."})},
    {id:"ec-add/3",text:ctx=>{
      if(ctx.task.kind!=="ec-add")throw new Error("EC hint requires EC task");
      const p=ctx.task.left,q=ctx.task.right,show=(v:typeof p)=>v?`(${v[0]},${v[1]})`:"O";
      const values=`P=${show(p)}, Q=${show(q)}. `;
      if(!p||!q)return {ja:values+"Oを足しても点は変わりません。もう一方の座標を半角スペースで区切って入力。両方OならOです。",en:values+"Adding O leaves the other point unchanged. Enter the other coordinates separated by a space; if both are O, enter O."};
      if(p[0]===q[0]&&(p[1]+q[1])%7===0)return {ja:values+"xが同じでyの和が7の倍数です。互いに打ち消す点なので、回答欄へOを入力します。",en:values+"The x coordinates agree and the y sum is a multiple of7. They cancel; enter O."};
      const slope=p[0]===q[0]?`(3×${p[0]}²+2)×(2×${p[1]})⁻¹`:`(${q[1]}−${p[1]})×(${q[0]}−${p[0]})⁻¹`;
      return {ja:values+`まず λ=${slope} を逆元の表で計算。次に x=λ²−${p[0]}−${q[0]}、最後に y=λ×(${p[0]}−x)−${p[1]}。それぞれ7で割った余りにして「x 半角スペース y」を入力します。`,en:values+`Use the inverse table to calculate λ=${slope}, then x=λ²−${p[0]}−${q[0]}, and y=λ×(${p[0]}−x)−${p[1]}. Reduce each modulo7 and enter x space y.`};
    }}
  ],

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
      // [Issue #740] A disclosure Order accepts LEAK alone. Its rungs must not
      // sell a PROVE route the button row does not offer: the last paragraph of
      // rung 1 and the whole of rung 3 branch on what the Order accepts.
      text: (ctx) => ({
        ja: `Order (= あなたのチームに届いた依頼) が、かけらを求めています。かけら (share) は秘密の数を ${ctx.shareCount} 個に分けたうちの 1 個。MY VAULT の #1〜#${ctx.shareCount} がそれです。
作り方は、秘密と内緒で選んだ数を入れた式に、かけらの番号を入れて計算する方法です。番号 0 の値が秘密で、番号 1 以降の値がかけらになります。すべて ${ctx.prime} で割った余りで扱います。
この試合では、同じ世代 (= 同じ秘密から作った一組) の異なる番号が ${ctx.threshold} 個あれば式が決まり、番号 0 の秘密を戻せます。${ctx.threshold - 1} 個では、0 から ${BigInt(ctx.prime) - 1n} までの秘密がどれも候補に残ります。無限の曲線ではなく、割った余りの範囲にある全 ${ctx.prime} 通りの秘密が残る、という意味です。
LEAK はかけらを公開記録に載せる操作。必要な個数を集めて秘密を戻す攻撃を HUNT と呼びます。${ctx.allowedMethods.includes("prove") ? "PROVE は別の秘密である数独の解を持つことを示し、このかけらを出さずに Order に答えます。" : "この Order は「公開が条件」です。依頼主がかけらそのものを買うので、答え方は LEAK だけ、得点は計算して答えたときと同じ満額です。代わりに、まだ公開していない番号なら公開数が増え、同じ番号なら増えません。公開専用Orderに答えた世代のROTATEは、未処理が0件でも最低1件分の失効点がかかります。"}`,
        en: `An Order (= a request sent to your team) asks for a share. A share is one of ${ctx.shareCount} pieces of your secret number: #1 to #${ctx.shareCount} in MY VAULT.
A formula combines the secret with privately chosen numbers. Put a share index into that formula: index 0 gives the secret, and later indices give shares. Keep remainders after dividing by ${ctx.prime}.
Here ${ctx.threshold} distinct indices from one generation (= one set made from the same secret) fix the formula and recover its value at 0. With ${ctx.threshold - 1} shares, every candidate secret from 0 to ${BigInt(ctx.prime) - 1n} remains possible. This is a finite set of ${ctx.prime} possible secrets, not infinitely many ordinary curves.
LEAK publishes a share. Recovering a secret from enough shares is the HUNT attack. ${ctx.allowedMethods.includes("prove") ? "PROVE instead demonstrates that you hold your separate sudoku solution, completing the Order without publishing its requested share." : "This Order requires publication: the client is buying the share itself, so LEAK is the only answer and it pays the full computing rate. A previously unpublished index increases your public count; a duplicate does not. After fulfilling a disclosure Order, ROTATE costs at least one expiry penalty even with no unfinished work."}`,
      }),
    },
    {
      id: "reveal-share/2",
      text: (ctx) => {
        if (!ctx.allowedMethods.includes("prove")) return {
          ja: `例：同じ世代の #1 と #2 が公開済みなら 2 個です。#3 を LEAK すると 2 + 1 = 3 個。同じ #2 をもう一度出すなら 2 + 0 = 2 個です。数えるのは異なる番号です。この試合では ${ctx.threshold} 個で秘密を戻せます。未回答で期限切れにすると公開数は増えず、失効の減点を受けます。ROTATE（秘密を作り直す）なら現世代の公開数は 0 個に戻りますが、未回答のお題が無効になり減点されます。`,
          en: `Example: public #1 and #2 from one generation count as 2 shares. LEAK #3: 2 + 1 = 3. Publish #2 again: 2 + 0 = 2. Count distinct indices. This match needs ${ctx.threshold} shares to recover the secret. Leaving the Order unanswered adds no exposure but incurs its expiry penalty. ROTATE (replace your secret set) resets the current generation's exposure to 0, but voids unanswered secret-bound Orders with a penalty.`,
        };

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
        // [Issue #740] The disclosure Order: LEAK alone, so rung 3 walks that
        // one action and the choice around it (ROTATE first, or not), instead
        // of a PROVE procedure the button row does not offer.
        if (canLeak && !canProve) {
          const reaches = after >= ctx.threshold;
          return {
            ja: `この Order は公開が条件です。求められているかけらは ${cards}（世代 ${ctx.vault.generation}）。
① 「公開して答える (LEAK)」を押す。得点は表示どおりの満額で、公開記録にこの値が載ります。
② 公開数を数える：${exposed.size} + ${added} = ${after} 個（公開済み + 新しい番号。同じ番号は重ねて数えない）。${reaches ? `必要な ${ctx.threshold} 個に達し、相手はあなたの秘密を戻せるようになります。` : `秘密を戻す ${ctx.threshold} 個にはまだ届きません。`}
③ ${reaches ? "届かせたくなければ、押す前に ROTATE で世代を変えます（開いている依頼は無効になり、その分の減点があります）。届かせて相手より先に相手を読み解く、という選び方もあります。" : "届く前の Order が来たら、ROTATE で世代を変えるか、届かせて相手より先に読み解くかを決めます。"}`,
            en: `This Order requires publication. Requested shares: ${cards} (generation ${ctx.vault.generation}).
(1) Press "Publish to answer (LEAK)". It pays the full rate shown, and this value goes on the public record.
(2) Count your public shares: ${exposed.size} + ${added} = ${after} distinct indices (already public + new; duplicates count once). ${reaches ? `That reaches the ${ctx.threshold} an opponent needs to recover your secret.` : `Still below the ${ctx.threshold} needed for recovery.`}
(3) ${reaches ? "To avoid that, ROTATE to a new generation before pressing (open Orders are voided and charged). Or let it happen and read the opponent first -- that is also a choice." : "When the Order that would reach it arrives, decide: ROTATE first, or let it happen and read the opponent first."}`,
          };
        }
        return {
          ja: `選んだこの1題を終えてから、次のお題のヒントへ進みます。
求められているかけらは ${cards}（世代 ${ctx.vault.generation}）。
${canLeak ? `LEAK：この値を公開して完了。公開数は ${exposed.size} + ${added} = ${after} 個（公開済み + 新しい番号）。同じ番号は重ねて数えません。${after >= ctx.threshold ? `必要な ${ctx.threshold} 個に達し、相手が秘密を戻せます。` : `秘密を戻す ${ctx.threshold} 個には未到達です。`}` : "この Order は LEAK を受け付けません。"}
${canProve ? `PROVE：かけらの代わりに、自分の数独の解を使います。① 自動で用意された「今回の置き換え」を見る。矢印は元の数字→替える数字です。② 右の空欄と同じ位置を左の解で探し、表の矢印をたどる。例：元が2で表が2→1なら1を入れる。③ 同じ表で4 マスを埋め、SUBMIT。得点と公開された1組が出れば完了です。表の再使用は解を戻される手がかりになります。` : "この Order には PROVE はありません。"}`,
          en: `Finish this selected Order before opening hints for the next one.
Requested shares: ${cards} (generation ${ctx.vault.generation}).
${canLeak ? `LEAK: publish these values to complete it. ${exposed.size} already public + ${added} new = ${after} distinct indices. Duplicates count once. ${after >= ctx.threshold ? `This reaches the ${ctx.threshold} needed to recover your secret.` : `Still below the ${ctx.threshold} needed for recovery.`}` : "This Order does not accept LEAK."}
${canProve ? `PROVE: use your sudoku solution instead of these shares. (1) Choose an unused relabelling table. An arrow means original digit → replacement. (2) Find each right-hand hole's position in your solution on the left; follow the table's arrow. Example: original 2 with 2→1 means enter 1. (3) Fill four holes using the same table and press SUBMIT. A score and one opened group confirm completion. Reusing a table can help others recover your solution.` : "This Order does not accept PROVE."}`,
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
          ja: `この Order の数で計算します。割る数 p = ${p}。① 受け取った覆面を全部足します: ${received.join(" + ")} = ${R}。② 送った覆面を全部足します: ${sent.join(" + ")} = ${S}。③ 自分の数 ${my} に ① を足して ② を引きます: ${my} + ${R} − ${S} = ？ ④ 出た数が 0 未満なら ${p} を足します (まだ 0 未満ならもう一度足す)。${p} 以上なら ${p} を引きます (まだ ${p} 以上ならもう一度引く)。0 以上 ${p - 1n} 以下に入った数が答えです。⑤ その数を「公開する小計」の欄に入力して「小計を提出」を押します。自分の数をそのまま写すのでなく、計算した小計を提出します。覆面が打ち消し合えば、結果が自分の数と同じになる場合もあります。`,
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
          ja: `① 証明の入力欄を開き（すでに開いていればそのまま）、自動で用意された「今回の置き換え」を確認します。世代は同じ秘密や解を使う一組のことです。この世代で使った表は ${used || "まだありません"}。使用済みの表は避けます。\n② 左の自分の解は、上から ${rows.join(" / ")} です。右は 12 マスが見本、4 マスが空欄です。\n③ 空欄と同じ位置を左で探します。その数字から、選んだ表の矢印の先へ読み替えて右に入力します。例の 2→1 なら、元が 2 の空欄に 1 を入れるということです。残りも同じ表で埋めます。\n④ 4 マスを入れたら SUBMIT を押します。審判は完成した 16 マスを検査し、通れば得点と、公開された 1 行・1 列・1 箱のどれか 1 組が表示されます。\n同じ表を再使用すると公開された組をつなげられます。HUNT は相手が秘密の答えを当てて得点する攻撃です。解が一つに絞られると HUNT されるので、次も新しい表が自動で用意されます。`,
          en: `(1) Open the proof input area if it is not already open, and check the automatically prepared relabelling table. A generation is one set using the same secret and solution. Tables already used this generation: ${used || "none"}. Avoid a used table.\n(2) Your solution's rows, top to bottom: ${rows.join(" / ")}. The right grid has twelve worked cells and four holes.\n(3) Find each hole's position on the left. Take that original digit through your chosen table's arrow, then enter its replacement on the right. For example, 2→1 means enter 1 in a hole whose original digit was 2. Use the same table for the remaining holes.\n(4) Fill four holes and press SUBMIT. The judge checks all sixteen cells; success shows the score and one opened row, column or box.\nReusing a table lets others connect opened groups. HUNT is an attack that scores by recovering another team’s secret answer. A uniquely determined solution can be HUNTed. A fresh table is prepared next time too.`,
        };
      },
    },
  ],
  "rotor-encrypt": ([0, 1, 2] as const).map(rung => ({ id: `rotor-encrypt/${rung + 1}`, text: (ctx: HintContext) => {
    if (ctx.task.kind !== "rotor-encrypt") throw new Error("Rotor hint on another task");
    return rotorGuide(ctx.task, rung);
  } })),
  "rsa-encrypt": ([0, 1, 2] as const).map(rung => ({ id: `rsa-encrypt/${rung + 1}`, text: (ctx: HintContext) => {
    if (ctx.task.kind !== "rsa-encrypt") throw new Error("RSA hint on another task");
    return rsaGuide(ctx.task, rung);
  } })),
  "caesar-shift": [
    {
      id: "caesar-shift/1",
      text: (ctx) => ctx.task.kind === "caesar-shift" && ctx.task.rung === "vigenere" ? vigenereGuide(ctx.task, 0) : ({
        ja: "目的：元の記号の列（平文）を、別の列（暗号文）へ変えます。記号を輪に並べ、全部を同じ数だけ先へずらすシーザー暗号です。ずらす数が秘密の『鍵』。最後の次は先頭に戻ります。\n同じ数だけ逆へ戻せば平文に戻ります。方式は公開され、秘密は鍵だけです。元と後の記号を1組知られると、その間を何個進むか数えて鍵を求められます。\nまずこの1題の3段だけ読み、計算して提出します。",
        en: "Goal: change the original row (plaintext) into an encrypted row (ciphertext). Caesar encryption arranges symbols in a circle and shifts every symbol forward by the same number: the secret key. After the last symbol, wrap to the first.\nShifting back by that key recovers the plaintext. The method is public; only the key is secret. One known original/encrypted pair reveals the shift by counting steps.\nRead this Order's three rungs, calculate and submit before moving to another Order.",
      }),
    },
    {
      id: "caesar-shift/2",
      text: (ctx) => ctx.task.kind === "caesar-shift" && ctx.task.rung === "vigenere" ? vigenereGuide(ctx.task, 1) : ({
        ja: "式：記号の並び順に0から番号をつけます。サイコロの面1〜6なら、計算用の番号は0〜5です。\n暗号の番号 = (元の番号 + 鍵) を記号の種類数で割った余り。この『割った余り』を mod と書きます。鍵も0〜種類数−1なので、足した数が種類数以上なら種類数を1回引けば足ります。\n一桁の例：5種類・鍵3・元の番号4,1なら、4+3=7→7−5=2、1+3=4。答えの番号は2,4です。本番は次の段の種類数と鍵を使います。",
        en: "Formula: number symbols from 0 in their displayed order. Die faces 1–6 have calculation values 0–5.\nEncrypted value = (original value + key), taking the remainder after dividing by the number of symbols. We write remainder as mod. The key is also between 0 and symbol-count−1, so subtracting the count once suffices whenever the sum reaches it.\nOne-digit example: 5 symbols, key 3, originals 4,1. 4+3=7→7−5=2; 1+3=4. The answer is 2,4. For your Order use the count and key in the next rung.",
      }),
    },
    {
      id: "caesar-shift/3",
      text: (ctx) => {
        if (ctx.task.kind !== "caesar-shift") throw new Error("caesar-shift/3 rendered against a non-caesar Order");
        if (ctx.task.rung === "vigenere") return vigenereGuide(ctx.task, 2);
        const n = ctx.task.symbols.length;
        const key = ctx.task.myKey;
        const values = ctx.task.plaintext;
        const jaLines = values.map((v, i) => `${i + 1} 番目: ${v} + ${key} = ？`).join("\n");
        const enLines = values.map((v, i) => `Position ${i + 1}: ${v} + ${key} = ?`).join("\n");
        const jaZero = key === 0 ? "\n鍵が 0 なので、足しても番号は変わりません。それでも正しい答えです。" : "";
        const enZero = key === 0 ? "\nYour key is 0, so adding it changes nothing. That is still the correct answer." : "";
        return {
          ja: `選んだこの1題を提出してから、次のお題のヒントへ進みます。\n自分の値：${n} 種類（番号0〜${n - 1}）・鍵 ${key}・平文の番号 ${values.join(", ")}。画面の「記号の並び順」の下の数と対応します。\n① 左から鍵を足す：\n${jaLines}\n② ${n} 以上の結果から ${n} を引く。${jaZero}\n③ できた ${values.length} 個の番号を空白区切りで「暗号にした列」へ入力し、CIPHER。受理されて得点が増えれば完了です。`,
          en: `Submit this selected Order before opening hints for the next one.\nYour values: ${n} symbols (0–${n - 1}), key ${key}, plaintext ${values.join(", ")}, matching the numbers under "the symbols, in order".\n(1) Add the key, left to right:\n${enLines}\n(2) Subtract ${n} from results of ${n} or more.${enZero}\n(3) Enter the ${values.length} numbers separated by spaces in "your encrypted row" and press CIPHER. Acceptance and a score increase confirm completion.`,
        };
      },
    },
  ],
};

/** The ladder for a task kind, in level order. */
export function hintsFor(kind: OrderTaskKind): readonly HintSpec[] {
  if(kind === "anamorphic-rejection")return HINT_LADDER[kind].map((hint,level)=>({...hint,text:(ctx:HintContext)=>{
    if(ctx.task.kind!=="anamorphic-rejection" || !ctx.task.exercise)return hint.text(ctx);
    const t=ctx.task;
    if(t.exercise==='encrypt')return [
      {ja:"同じ通常メッセージを暗号化した候補から、秘密の表で送りたいビットになるものを選ぶお題です。復号はしません。",en:"Select a ciphertext candidate whose secret lookup matches the intended bit. This Order requires no decryption."},
      {ja:"選択の条件はF(c)=b。Fは秘密の表、cは候補、bは送りたいビットです。上から最初の一致を探します。b=1、表が0,1,1なら2番です。",en:"Select the first candidate c with F(c)=b, where F is the secret lookup and b the intended bit. For b=1 and lookup0,1,1, select2."},
      {ja:`表のビットを上から${t.targetBit}と比べ、最初に一致する行の番号1個を提出します。`,en:`Compare each lookup bit with${t.targetBit} from the top. Submit only the first matching row number.`}
    ][level]!;
    if(t.exercise==='decrypt')return [
      {ja:"今回は受け取った暗号文から、通常鍵を使って元の数を戻します。送る候補の選択は不要です。",en:"Recover the ordinary message from the supplied ciphertext using its ordinary key. No candidate selection is required."},
      {ja:"sはaをx回掛けて7で割った余り。s×mの余りがbになるmを探します。s=4,b=5なら4×3の余り5なのでm=3。",en:"s is a to power x, remainder7. Find m so s×m leaves b. For s=4,b=5, m=3 since4×3 leaves5."},
      {ja:`暗号文は(${t.candidates[0]!.join(',')})、鍵x=${t.ordinaryKey}。aをx回掛けた余りsを使い、s×1〜6でbと同じ余りになる数を探して1個提出します。`,en:`Ciphertext(${t.candidates[0]!.join(',')}), key x=${t.ordinaryKey}. Compute s, then try s×1 through s×6 and submit the one number leaving remainder b.`}
    ][level]!;
    return [
      {ja:"目的のビットになる候補だけが選び直しの後に残ります。その候補に付いたくじの枚数を合計するお題です。",en:"Only trials matching the target bit survive rejection sampling. Sum their ticket counts."},
      {ja:"選び直し後の確率＝候補の枚数÷受理される合計枚数。今回は分母だけ。1枚・2枚・3枚の候補が残るなら合計6枚です。",en:"Probability after rejection = candidate tickets / total accepted tickets. Submit the denominator only: counts1,2,3 total6."},
      {ja:`秘密の表が${t.targetBit}の行だけに印を付け、その行のくじを足し、合計1個を提出します。`,en:`Mark rows whose bit is${t.targetBit}, add their tickets, and submit that total only.`}
    ][level]!;
  }}));
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
