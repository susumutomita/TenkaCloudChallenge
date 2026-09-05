/** Free reading aids. They never submit a move or compute a live answer. */
import { useState } from "react";
import type { OrderTaskProjection } from "../game/src/types.ts";

type Locale = "ja" | "en";
export type Concept = "remainder" | "sharing" | "mpc" | "zk" | "fhe" | "caesar" | "commit";
interface Step { readonly title: string; readonly lines: readonly string[]; readonly table?: { readonly headers: readonly string[]; readonly rows: readonly (readonly string[])[] } }
interface Explanation { readonly name: string; readonly steps: readonly Step[] }

export const SHARE_PAIR_TABLE = [["0", "5", "4"], ["1", "0", "1"], ["2", "2", "5"], ["3", "4", "2"], ["4", "6", "6"], ["5", "1", "3"], ["6", "3", "0"]] as const;

/** Fixed teaching examples, independent of every match's private data. */
export const EXPLANATIONS: Record<Locale, Record<Concept, Explanation>> = {
  ja: {
    commit: { name: "手を先に封じる", steps: [
      { title: "相手の手を見る前に、数字を出す", lines: ["先に手を言うと相手に勝つ手を選ばれるため、手と『隠す数』を混ぜた数字を先に出します。この数字をコミットメントと呼びます。", "手の番号 m はグー 1・チョキ 2・パー 3。隠す数 r は 0〜10 のくじから毎回引き直します。0〜10 の紙を 1 枚ずつ用意し、毎回戻して引けば均等に選べます。"] },
      { title: "掛け算で手を封じる", lines: ["4^m は 4 を m 回掛ける意味。9^r は 9 を r 回掛け、0 回の場合は 1 とします。両方を掛けて、23 で割った余りを c とします。", "m=1、r=1 なら、4×9=36。36−23=13。まず 13 だけを出します。手と r は紙に控えます。", "画面の表は 4^m と 9^r をそれぞれ 23 で割った余りです。例えば 4^3=64→18。途中で 23 の倍数を引いても、積から 23 の倍数が減るだけで、最後の余りは変わりません。"] },
      { title: "両者が封じたら、審判へ開く", lines: ["両者の c がそろったら、控えた m と r を審判へ渡します。審判が同じ計算をして c と一致するか確かめます。不一致なら修正でき、減点はありません。開封した手と r が受理された後は、その開封内容を変更できません。", "片方だけの開封は相手へ渡さず、両方そろってから同時に公開します。グーはチョキ、チョキはパー、パーはグーに勝ちます。"] },
      { title: "何が隠れ、何に審判が必要か", lines: ["r を 0〜10 から同じ確率で選ぶと、この計算で実際に出てくるどの c にも 3 種類すべての手が対応します。c だけで手を絞れません。0 を除くと、例えば c=4 のグーは候補から外れます。グーで c=4 にするには r=0 が必要だからです。", "この教材の小さい数では、同じ c へ別の手でも開ける値を探せます。すり替えを暗号だけで防ぐ実用的な安全性はありません。相手の開封を見て後出しできないよう、審判が同時公開を守ります。", "commit-reveal は先に封じて後で開く手順です。それ自体は ZK（秘密を明かさず正しさを示す証明）ではありません。r を使い回すと別の回の記録を手掛かりに手を読まれるため、毎回くじを引き直します。"] },
    ] },
    remainder: { name: "割った余り", steps: [
      { title: "0〜6 の時計で考える", lines: ["0、1、2、3、4、5、6 の次は 0 に戻る、7 目盛りの時計を考えます。7 で割った余りだけを残す計算です。カードでは『割る数』を p と書きます。"] },
      { title: "大きくなったら 7 を引く", lines: ["5 + 4 = 9。9 は 7 が 1 個と、残り 2 個なので、9 − 7 = 2。時計でも 5 → 6 → 0 → 1 → 2 と進みます。", "『7 で割った余りは 2』を 9 mod 7 = 2 と書きます。mod は余りの短い書き方です。"] },
      { title: "負になったら 7 を足す", lines: ["2 − 5 = −3。0 より小さいので −3 + 7 = 4。時計を逆に進めても、2 → 1 → 0 → 6 → 5 → 4 です。", "7 以上なら 7 を引き、負なら 7 を足します。0〜6 に入るまで繰り返せば余りになります。"] },
      { title: "今の問題へ", lines: ["例の 7 を、カードの『p（割る数）』に置き換えます。まず計算し、0 以上 p 未満になるまで p を足すか引いてから入力します。p そのものは 0 に戻るので、答えの範囲に含めません。"] },
    ] },
    sharing: { name: "秘密のかけら", steps: [
      { title: "1 個では秘密を決められない", lines: ["秘密分散は、秘密をいくつかの数（かけら・share）に分け、決めた個数がそろうと戻せるようにする方法です。", "まず足し算だけの例です。かけらが 1、2、3 なら、秘密は 1 + 2 + 3 = 6。計算結果は 7 で割った余りを使います。", "1 と 2 だけ見えても、残りは 0〜6 のどれでもありえます。秘密の候補は 3、4、5、6、0、1、2。7 通りすべてが残り、秘密を絞れません。"] },
      { title: "本番は番号を式に入れて作る", lines: ["足し算の例は 3 個すべてが必要でした。本番では 5 個のうちどの 3 個でも戻せるよう、別の分け方を使います。ここでは『3 個で戻る』設定を説明します。", "秘密を 1、内緒で選ぶ数を 0 と 1 とします。かけらの値 = 1 + 0 × 番号 + 1 × 番号 × 番号。最後に 7 で割った余りを取ります。番号 0 なら秘密 1 だけが残ります。", "#1：1 + 1 = 2。#2：1 + 4 = 5。#3：1 + 9 = 10 → 10 − 7 = 3。"] },
      { title: "2 個からは、どの秘密も候補に残る", lines: ["内緒の 2 つの数を A、B と呼ぶと、式は 秘密 + A × 番号 + B × 番号 × 番号 です。A と B は 0〜6 からそれぞれ同じ確率で選びます。", "#1 = 2、#2 = 5 を見ただけなら、下のどの行もありえます。例えば秘密 2、A = 2、B = 5 でも、#1 は 2 + 2 + 5 = 9 → 2、#2 は 2 + 4 + 20 = 26 → 5。同じ 2 個のかけらになりました。", "秘密 0〜6 のどれにも、条件に合う A と B が 1 組ずつあります。だから 2 個を知っても、どの秘密が本物か選べません。"], table: { headers: ["秘密の候補", "内緒の数 A", "内緒の数 B"], rows: SHARE_PAIR_TABLE } },
      { title: "番号 1・2・3 から戻す", lines: ["この番号なら、秘密 = 3 × #1 − 3 × #2 + #3 を計算して、7 で割った余りに直せます。", "例では 3 × 2 − 3 × 5 + 3 = 6 − 15 + 3 = −6。負なので 7 を足して、−6 + 7 = 1。元の秘密が戻りました。", "理由：秘密に掛かる数は 3 − 3 + 1 = 1。番号に掛かる数は 3 × 1 − 3 × 2 + 3 = 0。番号の 2 乗に掛かる数も 3 × 1 − 3 × 4 + 9 = 0。内緒で選んだ数の項が消え、秘密だけが残ります。"] },
      { title: "公開すると何が起きるか", lines: ["LEAK は指定されたかけらを公開記録（PUBLIC LEDGER）へ載せます。同じ世代（同じ秘密から作った一組）のかけらが必要な個数そろうと、相手が秘密を戻して HUNT できます。危険度の丸は公開済みの個数です。", "ROTATE は新しい秘密で作り直します。古いかけらとは混ぜられません。上の戻し方は『3 個で戻る設定の #1・#2・#3』専用で、別の番号には使えません。", "LEAK 自体に復元計算は不要です。PROVE を選ぶ場合は ZK の解説へ進みます。"] },
    ] },
    mpc: { name: "MPC", steps: [
      { title: "自分の数を隠して、合計だけ知りたい", lines: ["MPC は、複数の人が秘密を持ったまま協力して計算する方法です。ここでは 3 つの拠点 A・B・C の合計を、p で割った余りで求めます。例えば p = 7 で合計が 9 なら、得られる数は 9 − 7 = 2 です。", "2 社の間だけで内緒の数を決め、これを『覆面』と呼びます。片方が足し、もう片方が同じ数を引けば、合計では消えます。", "足す側のカードでは『受け取った覆面』、引く側では『送った覆面』です。各社が提出する数を『小計』と呼びます。"] },
      { title: "一桁の数字で、覆面を掛ける", lines: ["説明用にだけ全社の内訳を見せます。自分の数は A = 2、B = 3、C = 1。覆面は A → B が 4、B → C が 2、C → A が 1 の 3 本を使います。", "小計 = 自分の数 + 受け取った覆面 − 送った覆面。", "A：2 + 1 − 4 = −1。B：3 + 4 − 2 = 5。C：1 + 2 − 1 = 2。", "本番では各社が自分の分だけを見ます。小計だけを見た人には、どれだけ足し引きしたか分かりません。"] },
      { title: "余りに直しても、覆面は消える", lines: ["7 で割った余りに直します。A の −1 は 7 を足して 6。B は 5、C は 2 のままです。負なら 7 を足し、7 以上なら 7 を引いて、0〜6 に入れます。", "小計の合計は 6 + 5 + 2 = 13 → 13 − 7 = 6。元の数の合計 2 + 3 + 1 = 6 と一致しました。", "途中の式は (2 + 1 − 4) + (3 + 4 − 2) + (1 + 2 − 1)。覆面の +1 と −1、+4 と −4、+2 と −2 がそれぞれ消えます。"] },
      { title: "この Order の小計を作る", lines: ["カードの『自分の数』に『受け取った覆面』を全部足し、『送った覆面』を全部引きます。", "p は割る数です。負なら p を足し、p 以上なら p を引き、0 以上 p 未満にして『あなたの小計』へ入れます。提出するのは自分の小計 1 個で、全社の合計ではありません。"] },
    ] },
    zk: { name: "ZK", steps: [
      { title: "答えを知られずに、持っていると示す", lines: ["ZK（ゼロ知識証明）は、秘密の答えを相手に教えず、『その答えを持っている』と納得してもらう考え方です。ここでは 4 × 4 の数独で体験します。", "数独のルールは、各行・各列・太枠の 2 × 2 の箱に 1、2、3、4 が一度ずつ入ること。自分の完成した解は左に表示されます。"] },
      { title: "数字の名前を入れ替える", lines: ["表を 1 → 3、2 → 1、3 → 4、4 → 2 と決めます。矢印は、左の数字を右の数字に読み替える意味です。", "元の行が 2、1、3、4 なら、2 → 1、1 → 3、3 → 4、4 → 2 と替えて、1、3、4、2 になります。", "同じ元の数字には、どのマスでも同じ表を使います。1〜4 を一対一に読み替えるので、行・列・箱の『一度ずつ』は崩れません。"] },
      { title: "一部だけを見せる理由", lines: ["ゲームの審判は元の解を持ち、提出した盤面がその読み替えかを検査します。相手には、読み替え後の 1 行・1 列・1 箱のうち 1 組だけを公開します。", "相手に見えるのは 1〜4 が一度ずつ並んだ組です。表を知らなければ、この 1 組だけでは元の数字を決められません。", "これは審判を信頼する体験版です。本来の ZK では審判にも解を渡さず検査します。このゲームでは『隠して、一部だけ確かめる』仕組みを体験します。"] },
      { title: "表を選び、4 マスだけ埋める", lines: ["付け替え表を選ぶと、12 マスが見本として埋まります。空欄の位置にある左の数字を見て、矢印の先の数字を入れます。4 マスとも入れたら SUBMIT を押します。", "同じ世代で同じ表を繰り返すと、公開された別々の組をつなげられます。解が一つに絞られると HUNT されるので、次回は『使用済み』と付いていない表を選びます。"] },
    ] },
    fhe: { name: "FHE", steps: [
      { title: "中身を読まずに、計算したい", lines: ["準同型暗号は、隠した数に計算をして、あとで開くと中身に計算した結果が得られる仕組みです。FHE（完全準同型暗号）は足し算と掛け算を組み合わせられます。この問題では入口の『隠したまま足す』を体験します。", "隠した数を『暗号文』、隠すための秘密の数を『鍵』と呼びます。答えを検査する『判定側』だけが鍵を持ち、暗号文ごとに別々の鍵を使います。"] },
      { title: "小さな暗号文を作ってみる", lines: ["説明用にだけ中身と鍵を見せます。割る数は 7。暗号文は（左、右）の組です。左はくじで選ぶ 0 以外の数。右は 中身 + 鍵 × 左 を 7 で割った余り。『鍵 × 左』を隠す数と呼びます。", "1 個目：中身 1、鍵 2、左 2。隠す数は 2 × 2 = 4、右は 1 + 4 = 5。暗号文は（2、5）。", "2 個目：中身 3、鍵 1、左 3。隠す数は 1 × 3 = 3、右は 3 + 3 = 6。暗号文は（3、6）。", "本番で届くのは数の組だけです。違う鍵なら別の中身でも同じ右の数を作れるため、鍵を知らない人は中身を決められません。"] },
      { title: "閉じたまま足して、理由を確かめる", lines: ["あなたの計算：左どうしは 2 + 3 = 5。右どうしは 5 + 6 = 11、余りは 11 − 7 = 4。答えの暗号文は（5、4）です。", "判定側の確認：隠す数の合計は 4 + 3 = 7。答えの右から引くと 4 − 7 = −3。7 を足して余りに直すと 4。中身の合計 1 + 3 = 4 が戻りました。", "右の数を足すと (1 + 4) + (3 + 3) = (1 + 3) + (4 + 3)。順番を替えると、中身の合計と隠す数の合計に分けられます。", "判定側は、元の各入力の左の値と、その入力の鍵を使って隠す数を求めます。答えの左が 2 + 3 = 5 になっているかも別に確認します。答えの組だけから中身を戻すわけではありません。"] },
      { title: "この Order の左右をそれぞれ足す", lines: ["カードの左どうしを足し、p（割る数）で割った余りを『答え：左の値』へ入れます。右どうしも足し、同じ p で割った余りを『答え：右の値』へ入れます。", "両方が 0 以上 p 未満になったら『暗号文を提出』を押します。中身を開けたり、鍵を探したりする必要はありません。", "この体験用モデルで実装しているのは暗号文の足し算です。実用の FHE 全体を実装しているわけではありません。"] },
    ] },
    caesar: { name: "シーザー暗号", steps: [
      { title: "決まった数だけずらして隠す", lines: ["シーザー暗号は、記号を決まった数だけ先へずらす方法です。ずらす数が『鍵』です。末尾まで来たら先頭に戻ります。"] },
      { title: "6 目盛りで計算する", lines: ["記号の番号を 0〜5、鍵を 2 とします。元の列が 1、4、5 なら、まず 2 を足して 3、6、7。", "6 で割った余りに直すと 3、0、1。6 は 0 に、7 は 1 に戻ります。"] },
      { title: "元と答えが見えると鍵が分かる", lines: ["元の 1 が答えの 3 になったと分かれば、3 − 1 = 2 が鍵です。元の 4 と答えの 0 でも、0 − 4 = −4、6 を足して 2 と戻せます。", "元の列と答えを一緒に公開する LEAK は、相手が鍵を求める手掛かりになります。"] },
      { title: "自分の列で同じことをする", lines: ["カードの番号一つずつに『自分の鍵』を足し、記号の個数で割った余りを取り、元と同じ順に並べて提出します。例の 6 は、カードに並ぶ記号の個数に置き換えます。"] },
    ] },
  },
  en: {
    commit: { name: "Commit-reveal", steps: [
      { title: "Seal before seeing the opponent's hand", lines: ["Combine hand m (rock 1, scissors 2, paper 3) with a hiding number r drawn uniformly from 0–10. The combined number is a commitment. Draw from eleven slips marked 0–10, returning the slip before each draw."] },
      { title: "Multiply, then take a remainder", lines: ["4^m means m factors of 4; 9^r means r factors of 9, with the zeroth power defined as 1. c is their product's remainder after division by 23.", "For m=1, r=1: 4×9=36; 36−23=13. Send only 13 and keep m and r in your notes.", "The on-screen tables are remainders of 4^m and 9^r after division by 23; for example 4^3=64→18. Removing a multiple of 23 before multiplying only removes a multiple of 23 from the product, preserving its final remainder."] },
      { title: "Both seal, then both open", lines: ["After both commitments arrive, give the judge your m and r. The judge recomputes c. A mismatch can be corrected without a penalty; an accepted opening cannot be replaced.", "The judge keeps each opening private until both arrive, then publishes them together and scores the hands. Rock beats scissors, scissors beats paper, paper beats rock."] },
      { title: "What the toy and judge guarantee", lines: ["With uniform r from 0–10, every c that this calculation can produce is compatible with all three hands. c alone does not narrow the hand. Excluding r=0 would rule out rock when c=4, because rock produces c=4 only with r=0.", "These tiny numbers let you find alternative openings, so the toy has no practical binding security. Simultaneous publication prevents adapting after seeing the other opening. Commit-reveal is not itself a zero-knowledge proof. Reusing r makes other rounds informative; draw again each time."] },
    ] },
    remainder: { name: "Remainders", steps: [
      { title: "Imagine a clock numbered 0–6", lines: ["After 0, 1, 2, 3, 4, 5, 6 comes 0 again. We keep the remainder after dividing by 7. The card calls this divisor p."] },
      { title: "Subtract 7 when you reach it", lines: ["5 + 4 = 9; 9 contains one 7 with 2 left, so 9 − 7 = 2. On the clock: 5 → 6 → 0 → 1 → 2.", "Write this as 9 mod 7 = 2. mod simply means remainder."] },
      { title: "Add 7 when negative", lines: ["2 − 5 = −3, so −3 + 7 = 4. Five steps backwards from 2 also end at 4.", "Add 7 while negative; subtract 7 while at least 7. Stop between 0 and 6."] },
      { title: "Use your card's divisor", lines: ["Replace 7 with the card's p. Calculate first, then add or subtract p until the result is at least 0 and smaller than p. p itself wraps to 0 and is outside the answer range."] },
    ] },
    sharing: { name: "Secret shares", steps: [
      { title: "One piece does not determine the secret", lines: ["Secret sharing splits a secret into numbers called shares. A specified number of shares can reconstruct it.", "Start with an addition-only example, taking remainders after dividing by 7: shares 1, 2, 3 give secret 1 + 2 + 3 = 6.", "Seeing only 1 and 2 leaves the last share anywhere from 0 to 6. Possible secrets are 3, 4, 5, 6, 0, 1, 2: all seven remain."] },
      { title: "The match uses a numbered formula", lines: ["That example needed all three pieces. The match uses a different construction so any three of five shares work. Here we explain the three-share setting.", "Secret 1, privately chosen numbers 0 and 1: share = 1 + 0 × index + 1 × index × index, then remainder after dividing by 7. At index 0, only the secret remains.", "#1: 1 + 1 = 2. #2: 1 + 4 = 5. #3: 1 + 9 = 10 → 3."] },
      { title: "Two shares leave every secret possible", lines: ["Call the two private numbers A and B: share = secret + A × index + B × index × index, reduced after dividing by 7. Choose A and B independently and equally from 0–6.", "Every row below fits #1 = 2 and #2 = 5. For secret 2, A = 2, B = 5: #1 is 2 + 2 + 5 = 9 → 2; #2 is 2 + 4 + 20 = 26 → 5. The same two shares fit a different secret.", "Each candidate secret 0–6 has exactly one matching pair A, B. The two shares do not select any one secret."], table: { headers: ["Candidate secret", "Private A", "Private B"], rows: SHARE_PAIR_TABLE } },
      { title: "Recover from indices 1, 2, 3", lines: ["For these indices, compute 3 × #1 − 3 × #2 + #3, then take the remainder after dividing by 7.", "3 × 2 − 3 × 5 + 3 = 6 − 15 + 3 = −6 → −6 + 7 = 1. The original secret returns.", "Why? The secret's multiplier is 3 − 3 + 1 = 1. The index multiplier is 3 × 1 − 3 × 2 + 3 = 0. The squared-index multiplier is 3 × 1 − 3 × 4 + 9 = 0. The privately chosen terms disappear."] },
      { title: "What publication changes", lines: ["LEAK writes a requested share to the PUBLIC LEDGER, the record everyone can read. Enough shares from one generation (a set made from the same secret) allow recovery and HUNT. Exposure circles count published pieces.", "ROTATE starts a new secret; old and new pieces cannot be mixed. The shortcut above is only for indices 1, 2, 3 with a three-share threshold, not other indices.", "LEAK itself needs no recovery calculation. Read ZK for the PROVE option."] },
    ] },
    mpc: { name: "MPC", steps: [
      { title: "Reveal the total, keep the inputs private", lines: ["MPC means multiple parties computing together while keeping their own inputs private. Here three offices A, B and C want the remainder of their total after dividing by p. If p = 7 and the total is 9, the result is 9 − 7 = 2.", "Two offices agree on a private number called a mask. One adds it, the other subtracts it, so it disappears from the total.", "The adding side calls it received; the subtracting side calls it sent. Each office submits a subtotal."] },
      { title: "Apply one-digit masks", lines: ["Only this example shows all offices' data. Inputs: A = 2, B = 3, C = 1. Use three masks: A → B is 4, B → C is 2, C → A is 1.", "Subtotal = own input + received masks − sent masks.", "A: 2 + 1 − 4 = −1. B: 3 + 4 − 2 = 5. C: 1 + 2 − 1 = 2.", "In the match each office sees only its own data. A public observer cannot tell which masks were added and subtracted."] },
      { title: "Remainders preserve cancellation", lines: ["Divide by 7 and keep remainders. A's −1 becomes −1 + 7 = 6. B stays 5, C stays 2. Add 7 while negative and subtract 7 while at least 7.", "The published total is 6 + 5 + 2 = 13 → 6, matching the real total 2 + 3 + 1 = 6.", "Expand the original subtotals: (2 + 1 − 4) + (3 + 4 − 2) + (1 + 2 − 1). Mask pairs +1/−1, +4/−4 and +2/−2 cancel."] },
      { title: "Build this Order's subtotal", lines: ["Start with your number, add every received mask and subtract every sent mask.", "p is the divisor. Add p while negative; subtract p while at least p. Enter the result into your masked subtotal. Submit your one subtotal, not the total of all offices."] },
    ] },
    zk: { name: "ZK", steps: [
      { title: "Show you hold an answer without revealing it", lines: ["ZK, or zero-knowledge proof, means convincing someone you hold a secret answer without teaching them that answer. Here you explore it with a 4 × 4 sudoku.", "Every row, column and outlined 2 × 2 box holds 1, 2, 3, 4 once. Your completed solution appears on the left."] },
      { title: "Rename each digit", lines: ["Choose 1 → 3, 2 → 1, 3 → 4, 4 → 2. An arrow replaces its left digit with its right digit.", "Original row 2, 1, 3, 4 becomes 1, 3, 4, 2: apply 2 → 1, then 1 → 3, then 3 → 4, then 4 → 2.", "Use the same table in every cell. One-to-one renaming preserves the once-each rule in rows, columns and boxes."] },
      { title: "Why reveal only one group?", lines: ["The trusted game judge holds your original solution and checks that your submission renames it correctly. Others see one renamed row, column or box.", "That group has 1–4 once each. Without the table, this single group does not determine the original digits.", "This is a trusted-judge teaching model. A full ZK protocol also hides the solution from the verifier. Here you explore hiding data and checking one small revealed part."] },
      { title: "Choose a table and fill four cells", lines: ["Selecting a table fills twelve worked cells. For each hole, look at the original digit at that position on the left, then enter the digit after its arrow. Fill all four holes and SUBMIT.", "Reusing a table lets opponents connect opened groups. Once only one solution remains, they can HUNT. Next time choose a table without a used label."] },
    ] },
    fhe: { name: "FHE", steps: [
      { title: "Compute without reading the contents", lines: ["Homomorphic encryption lets you compute on hidden values and later open the result of that computation. FHE (fully homomorphic encryption) combines addition and multiplication. This problem teaches the entry point: hidden addition.", "A hidden value is a ciphertext; a secret number used to hide it is a key. Only the judge that checks answers holds the keys. Each input here uses its own key."] },
      { title: "Make two tiny ciphertexts", lines: ["Only this example shows contents and keys. Divide by 7. A ciphertext is (left, right): left is a randomly chosen nonzero number; right is content + key × left, reduced to its remainder. Call key × left the hiding number.", "First: content 1, key 2, left 2. Hiding number 2 × 2 = 4; right 1 + 4 = 5. Ciphertext (2, 5).", "Second: content 3, key 1, left 3. Hiding number 1 × 3 = 3; right 3 + 3 = 6. Ciphertext (3, 6).", "In the match you only receive pairs. Different keys let different contents fit the same right value, so an observer without the keys cannot determine the contents."] },
      { title: "Add the closed pairs and check why", lines: ["Your calculation: lefts 2 + 3 = 5; rights 5 + 6 = 11 → 11 − 7 = 4. Answer ciphertext: (5, 4).", "The judge's check: hiding numbers total 4 + 3 = 7. Subtract from the answer's right: 4 − 7 = −3 → −3 + 7 = 4. This matches the content total 1 + 3 = 4.", "The right values add as (1 + 4) + (3 + 3) = (1 + 3) + (4 + 3). Rearranging separates the content total from the hiding total.", "The judge uses each original left value and its own input key to find the hiding numbers. It separately checks that the answer's left is 2 + 3 = 5. The answer pair alone is not enough to decrypt it."] },
      { title: "Add this Order's lefts and rights separately", lines: ["Add the left values; take the remainder after dividing by the card's p and enter your answer: left part. Repeat for the rights and enter your answer: right part.", "Both values must be at least 0 and smaller than p. Press SUBMIT CIPHERTEXT. You never need to open a ciphertext or find a key.", "This teaching model implements ciphertext addition, not a full practical FHE system."] },
    ] },
    caesar: { name: "Caesar cipher", steps: [
      { title: "Hide a position by shifting it", lines: ["A Caesar cipher moves every symbol forward by a fixed number called the key. After the last symbol, wrap to the first."] },
      { title: "Try six positions", lines: ["Number symbols 0–5, key 2. Original row 1, 4, 5 becomes 3, 6, 7 after adding 2.", "Take remainders after dividing by 6: answer 3, 0, 1. Position 6 wraps to 0; 7 wraps to 1."] },
      { title: "An original and answer reveal the key", lines: ["Seeing 1 become 3 gives key 3 − 1 = 2. Seeing 4 become 0 gives 0 − 4 = −4 → −4 + 6 = 2.", "LEAK publishes the original beside its answer, giving opponents a way to recover the key."] },
      { title: "Apply it to your row", lines: ["Add your private key to each original number, then take the remainder after dividing by the symbol count. Submit in the same order. Replace the example's 6 with the number of symbols on your card."] },
    ] },
  },
};

export function conceptForTask(task: OrderTaskProjection): Concept {
  switch (task.kind) {
    case "rps-duel": return "commit";
    case "homomorphic-sum": return "fhe";
    case "masked-total": return "mpc";
    case "zk-sudoku": return "zk";
    case "caesar-shift": return "caesar";
    case "reveal-share": return "sharing";
  }
}

/** Copies only already-projected operands; leaves the result to the reader. */
export function orderCalculation(task: OrderTaskProjection, prime: string, locale: Locale): readonly string[] {
  const ja = locale === "ja";
  switch (task.kind) {
    case "homomorphic-sum": return [
      `${ja ? "左" : "Left"}: ${task.inputs.map((c) => c.r).join(" + ")} = ?`,
      `${ja ? "右" : "Right"}: ${task.inputs.map((c) => c.y).join(" + ")} = ?`,
      ja ? `それぞれ ${prime} で割った余りを、下の左右の欄へ入力します。` : `Take each remainder after dividing by ${prime} and enter the left and right fields below.`,
    ];
    case "masked-total": return [
      `${task.myInput} + (${task.incomingMasks.join(" + ") || "0"}) − (${task.outgoingMasks.join(" + ") || "0"}) = ?`,
      ja ? `${prime} で割った余りを、下の小計の欄へ入力します。` : `Take the remainder after dividing by ${prime} and enter the subtotal below.`,
    ];
    case "caesar-shift": return [
      ...task.plaintext.map((value) => `${value} + ${task.myKey} = ?`),
      ja ? `それぞれ ${task.symbols.length} で割った余りを、元の順に入力します。` : `Take remainders after dividing by ${task.symbols.length}; enter them in the original order.`,
    ];
    default: return [];
  }
}

const button = { cursor: "pointer", border: "1px solid #a4b5c6", borderRadius: 5, padding: "5px 9px", color: "#24476d", background: "#fff", fontSize: 12 } as const;
export default function ConceptExplanation({ locale, topic, task, prime }: {
  readonly locale: Locale; readonly topic?: Concept; readonly task?: OrderTaskProjection; readonly prime?: string;
}) {
  const [selected, setSelected] = useState<Concept | null>(null);
  const [stepIndex, setStepIndex] = useState(0);
  const copy = EXPLANATIONS[locale];
  const topics = topic ? [topic] : Object.keys(copy) as Concept[];
  const lesson = selected ? copy[selected] : null;
  const step = lesson?.steps[stepIndex];
  const ja = locale === "ja";
  return (
    <section aria-label="crypto-concept-explanation" style={{ color: "#16212e", background: "#fff", border: "1px solid #d6e0eb", borderRadius: 6, padding: 8, margin: "8px 0", fontSize: 13 }}>
      <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 6 }}>
        <span style={{ fontSize: 12 }}>{ja ? "しくみを解説（無料）" : "How it works (free)"}</span>
        {topics.map((item) => <button key={item} type="button" style={button} aria-expanded={selected === item}
          onClick={() => { setSelected(selected === item ? null : item); setStepIndex(0); }}>{copy[item].name}</button>)}
      </div>
      {lesson && step && <div style={{ border: "1px solid #bad1e8", borderRadius: 6, background: "#f5f9fe", padding: 12, marginTop: 6 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
          <strong>{lesson.name} · {stepIndex + 1} / {lesson.steps.length} — {step.title}</strong>
          <button type="button" style={button} onClick={() => setSelected(null)}>{ja ? "解説を閉じる" : "Close explanation"}</button>
        </div>
        <div aria-live="polite">
          {step.lines.map((line) => <p key={line} style={{ margin: "8px 0", lineHeight: 1.7 }}>{line}</p>)}
          {step.table && <table style={{ borderCollapse: "collapse", fontSize: 12, margin: "8px 0" }}>
            <thead><tr>{step.table.headers.map((header) => <th key={header} scope="col" style={{ padding: "4px 12px", borderBottom: "1px solid #bad1e8" }}>{header}</th>)}</tr></thead>
            <tbody>{step.table.rows.map((row) => <tr key={row.join(",")}>{row.map((value, index) => <td key={index} style={{ textAlign: "center", padding: "3px 12px" }}>{value}</td>)}</tr>)}</tbody>
          </table>}
          {stepIndex === lesson.steps.length - 1 && task && prime && conceptForTask(task) === selected &&
            <div style={{ borderLeft: "3px solid #5597cd", paddingLeft: 10 }}>
              {orderCalculation(task, prime, locale).map((line) => <p key={line} style={{ margin: "6px 0" }}>{line}</p>)}
            </div>}
        </div>
        <nav aria-label={ja ? "解説のステップ" : "Explanation steps"} style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button type="button" style={button} disabled={stepIndex === 0} onClick={() => setStepIndex((n) => n - 1)}>{ja ? "前へ" : "Previous"}</button>
          <span>{stepIndex + 1} / {lesson.steps.length}</span>
          {stepIndex < lesson.steps.length - 1
            ? <button type="button" style={button} onClick={() => setStepIndex((n) => n + 1)}>{ja ? "次へ" : "Next"}</button>
            : <button type="button" style={button} onClick={() => setSelected(null)}>{ja ? "問題に戻る" : "Back to the problem"}</button>}
        </nav>
      </div>}
    </section>
  );
}
