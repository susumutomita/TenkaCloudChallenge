import { SchnorrLesson } from "./SchnorrLesson.tsx";
import { ROTOR_EXPLANATIONS } from "./RotorMaterials.tsx";
import { RSA_EXPLANATIONS } from "./RsaMaterials.tsx";
import { cipherKeyAt } from "../game/src/ladder.ts";
/** Free reading aids. They never submit a move or compute a live answer. */
import { useState } from "react";
import ConceptDiagram from "./ConceptDiagram.tsx";
import type { OrderTaskProjection } from "../game/src/types.ts";

type Locale = "ja" | "en";
export type Concept = "ec" | "schnorr" | "remainder" | "sharing" | "mpc" | "zk" | "fhe" | "caesar" | "vigenere" | "rsa" | "rotor" | "commit";
interface Step { readonly diagram?: "zk" | "relabel" | "sharing" | "mpc"; readonly title: string; readonly lines: readonly string[]; readonly table?: { readonly headers: readonly string[]; readonly rows: readonly (readonly string[])[] } }
interface Explanation { readonly name: string; readonly steps: readonly Step[] }

export const SHARE_PAIR_TABLE = [["0", "5", "4"], ["1", "0", "1"], ["2", "2", "5"], ["3", "4", "2"], ["4", "6", "6"], ["5", "1", "3"], ["6", "3", "0"]] as const;

/** Fixed teaching examples, independent of every match's private data. */
export const EXPLANATIONS: Record<Locale, Record<Concept, Explanation>> = {
  ja: {
    ec: {name:"楕円曲線の点加算",steps:[{title:"ECDSAの土台となる計算",lines:["点は座標(x,y)の組です。普通の座標同士の足し算とは別の規則で、曲線上の2点から曲線上の別の点を作ります。","このお題は点加算のみ。ECDSA署名の生成や検証全体ではありません。"]}]},
    schnorr: {name:"ゼロ知識証明（Schnorr）",steps:[]},
    rotor: ROTOR_EXPLANATIONS.ja,
    rsa: RSA_EXPLANATIONS.ja,
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
    sharing: {"name": "秘密分散とシェア", "steps": [{"title": "秘密計算との関係", "diagram": "sharing", "lines": ["秘密計算（MPC）は、互いの入力を明かさず協力して計算する技術です。", "秘密分散は、その実現方法の一つ。秘密から複数の数を作り、その1個をシェア（share）と呼びます。ここでは「秘密のかけら」とも表示しています。"]}, {"title": "まず、足し算で分ける例", "lines": ["秘密 6 → シェア 1・2・3", "戻すとき：1 + 2 + 3 = 6。計算は7で割った余りを使います。", "1と2だけでは、残りが分からず秘密を決められません。この例は3個すべて必要です。"]}, {"title": "この試合では、5個のうち3個で戻す", "lines": ["小さい例（割る数7）：秘密1を、式 1 + 番号 × 番号 で分けます。", "番号1 → 2、番号2 → 5、番号3 → 10 → 7を引いて3。", "番号1・2・3から戻す式：3×2 − 3×5 + 3 = −6 → 7を足して1。別の番号を使うと、掛ける数も変わります。"]}, {"title": "公開した情報が、攻撃の材料になる", "lines": ["LEAK：シェアを公開して得点。相手にもその数が見えます。", "HUNT：相手の同じ世代（同じ秘密から作った一組）のシェアを集め、元の秘密を計算して攻撃します。", "このゲームでは、秘密分散と、覆面で合計を出す秘密計算を別のお題で体験します。"]}]},
    mpc: {"name": "秘密計算（MPC）", "steps": [{"title": "入力を隠したまま、一緒に計算する", "diagram": "mpc", "lines": ["MPCは、複数の人が自分の入力を互いに明かさず、協力して計算する技術です。", "例：各社の売上を見せず、合計だけ知る。合計から分かる情報は隠しません。"]}, {"title": "隠す数を足し引きする模型", "lines": ["覆面＝入力を隠すため、拠点どうしで共有した数。片方が足し、もう片方が同じ数を引きます。", "A：2 + 1 − 4 = −1", "B：3 + 4 − 2 = 5", "C：1 + 2 − 1 = 2"]}, {"title": "全員分を足すと、覆面が消える", "lines": ["(2 + 1 − 4) + (3 + 4 − 2) + (1 + 2 − 1)", "+1 と −1、+4 と −4、+2 と −2 が消える → 2 + 3 + 1 = 6。", "7で割った余りでも、−1→6、6+5+2=13→6。同じ結果です。"]}, {"title": "自分の小計を送る", "lines": ["小計＝自分の入力 + 受け取った覆面 − 送った覆面。", "最後にカードの p（割る数）で割った余りを、回答欄に1個入力します。", "この画面では自分の分だけ計算します。全員の合計は審判が確認します。"]}]},
    zk: {"name": "数独の模型（旧方式）", "steps": [{"title": "秘密を送らず、正しさを証明する技術", "diagram": "zk", "lines": ["ZKは、秘密情報を明かさずに、主張が正しいと確認してもらう証明です。例えば、パスワードそのものを送らず「知っている」と証明します。", "次の数独は「見せる情報を減らす」部分を学ぶ模型です。審判は解を知るため、このゲームは本物のZKプロトコルではありません。"]}, {"title": "数独の模型：数字だけを付け替える", "diagram": "relabel", "lines": ["同じ数字は、どのマスでも同じ数字へ。上の矢印を押して確かめます。", "各行・各列・太枠の箱で、1〜4が1回ずつ現れるルールは、そのまま残ります。"]}, {"title": "見せる範囲を小さくする", "lines": ["自分 → 付け替えた16マス → 審判が確認", "相手に見えるもの → 付け替え後の1行・1列・1箱のうち1組。元の解全体は公開しません。", "本物のZKでは、秘密を知る審判に頼らず証明を検証します。模型と技術の違いはここです。"]}, {"title": "この画面でやること", "lines": ["① 今回の置き換えを矢印で確認します。未使用の表が自動で用意されます。", "② 左と同じ位置の数字を、矢印の先へ読み替えて4マス入力。", "③「答えを送る」を押す。同じ表を再利用すると解が漏れる危険があるため、次回も新しい表を自動で用意します。"]}]},
    fhe: { name: "FHE", steps: [
      { title: "中身を読まずに、計算したい", lines: ["準同型暗号は、隠した数に計算をして、あとで開くと中身に計算した結果が得られる仕組みです。FHE（完全準同型暗号）は足し算と掛け算を組み合わせられます。この問題では入口の『隠したまま足す』を体験します。", "隠した数を『暗号文』、隠すための秘密の数を『鍵』と呼びます。答えを検査する『判定側』だけが鍵を持ち、暗号文ごとに別々の鍵を使います。"] },
      { title: "小さな暗号文を作ってみる", lines: ["説明用にだけ中身と鍵を見せます。割る数は 7。暗号文は（左、右）の組です。左はくじで選ぶ 0 以外の数。右は 中身 + 鍵 × 左 を 7 で割った余り。『鍵 × 左』を隠す数と呼びます。", "1 個目：中身 1、鍵 2、左 2。隠す数は 2 × 2 = 4、右は 1 + 4 = 5。暗号文は（2、5）。", "2 個目：中身 3、鍵 1、左 3。隠す数は 1 × 3 = 3、右は 3 + 3 = 6。暗号文は（3、6）。", "本番で届くのは数の組だけです。違う鍵なら別の中身でも同じ右の数を作れるため、鍵を知らない人は中身を決められません。"] },
      { title: "閉じたまま足して、理由を確かめる", lines: ["あなたの計算：左どうしは 2 + 3 = 5。右どうしは 5 + 6 = 11、余りは 11 − 7 = 4。答えの暗号文は（5、4）です。", "判定側の確認：隠す数の合計は 4 + 3 = 7。答えの右から引くと 4 − 7 = −3。7 を足して余りに直すと 4。中身の合計 1 + 3 = 4 が戻りました。", "右の数を足すと (1 + 4) + (3 + 3) = (1 + 3) + (4 + 3)。順番を替えると、中身の合計と隠す数の合計に分けられます。", "判定側は、元の各入力の左の値と、その入力の鍵を使って隠す数を求めます。答えの左が 2 + 3 = 5 になっているかも別に確認します。答えの組だけから中身を戻すわけではありません。"] },
      { title: "この Order の左右をそれぞれ足す", lines: ["カードの左どうしを足し、p（割る数）で割った余りを『答え：左の値』へ入れます。右どうしも足し、同じ p で割った余りを『答え：右の値』へ入れます。", "両方が 0 以上 p 未満になったら『暗号文を提出』を押します。中身を開けたり、鍵を探したりする必要はありません。", "この体験用モデルで実装しているのは暗号文の足し算です。実用の FHE 全体を実装しているわけではありません。"] },
    ] },
    vigenere: { name: "Vigenère（ヴィジュネル）暗号", steps: [
      { title: "3個の鍵を繰り返す", lines: ["記号を番号0〜5で表し、秘密のずらす数（鍵）を3個用意します。左から鍵1→鍵2→鍵3→鍵1…と繰り返して使います。", "暗号の番号 = (元の番号 + 今回の鍵) を6で割った余り。暗号は中身を隠すために変換したデータです。"] },
      { title: "別の数で練習する", lines: ["例：鍵1,2,3と元の列2,0,5なら、2+1=3、0+2=2、5+3=8→6を引いて2。暗号は3,2,2です。", "元と暗号の組を公開すると、その位置の鍵は暗号−元から分かります。負なら6を足します。この繰り返す鍵は現代の実用暗号の安全性を持ちません。自分のお題の詳しい手順は、そのお題のヒントで開きます。"] },
    ] },
    caesar: { name: "シーザー暗号", steps: [
      { title: "決まった数だけずらして隠す", lines: ["シーザー暗号は、記号を決まった数だけ先へずらす方法です。ずらす数が『鍵』です。末尾まで来たら先頭に戻ります。"] },
      { title: "6 目盛りで計算する", lines: ["記号の番号を 0〜5、鍵を 2 とします。元の列が 1、4、5 なら、まず 2 を足して 3、6、7。", "6 で割った余りに直すと 3、0、1。6 は 0 に、7 は 1 に戻ります。"] },
      { title: "元と答えが見えると鍵が分かる", lines: ["元の 1 が答えの 3 になったと分かれば、3 − 1 = 2 が鍵です。元の 4 と答えの 0 でも、0 − 4 = −4、6 を足して 2 と戻せます。", "元の列と答えを一緒に公開する LEAK は、相手が鍵を求める手掛かりになります。"] },
      { title: "自分の列で同じことをする", lines: ["カードの番号一つずつに『自分の鍵』を足し、記号の個数で割った余りを取り、元と同じ順に並べて提出します。例の 6 は、カードに並ぶ記号の個数に置き換えます。"] },
    ] },
  },
  en: {
    ec: {name:"Elliptic-curve addition",steps:[{title:"Arithmetic used by ECDSA",lines:["A point is a pair of coordinates (x,y). Curve addition combines two curve points into another, using a special rule rather than adding coordinates.","This task covers point addition, not the complete ECDSA signing or verification algorithm."]}]},
    schnorr: {name:"Zero-knowledge proof (Schnorr)",steps:[]},
    rotor: ROTOR_EXPLANATIONS.en,
    rsa: RSA_EXPLANATIONS.en,
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
    zk: {"name": "Legacy Sudoku model", "steps": [{"title": "Prove a claim without sending the secret", "diagram": "zk", "lines": ["ZK proves a claim without revealing its secret information. For example, prove you know a password without sending the password.", "The sudoku below is a model for limiting what is revealed. Its judge knows the solution, so this game is not a real ZK protocol."]}, {"title": "Sudoku model: rename digits, keep positions", "diagram": "relabel", "lines": ["Rename every occurrence of a digit the same way. Select an arrow above to follow its cells.", "Every row, column and outlined box still contains 1–4 exactly once."]}, {"title": "Reveal a smaller part", "lines": ["You → sixteen renamed cells → the judge checks.", "Opponents see one renamed row, column or box, not the entire original solution.", "Real ZK verifies a proof without relying on a judge who knows the secret."]}, {"title": "What to do on this screen", "lines": ["1. Check the automatically prepared unused relabelling table.", "2. Use the left digit at each hole’s position and follow the table’s arrow. Fill four holes.", "3. Submit the answer. Reusing a table can reveal your solution; a new unused table is prepared next time."]}]},
    fhe: { name: "FHE", steps: [
      { title: "Compute without reading the contents", lines: ["Homomorphic encryption lets you compute on hidden values and later open the result of that computation. FHE (fully homomorphic encryption) combines addition and multiplication. This problem teaches the entry point: hidden addition.", "A hidden value is a ciphertext; a secret number used to hide it is a key. Only the judge that checks answers holds the keys. Each input here uses its own key."] },
      { title: "Make two tiny ciphertexts", lines: ["Only this example shows contents and keys. Divide by 7. A ciphertext is (left, right): left is a randomly chosen nonzero number; right is content + key × left, reduced to its remainder. Call key × left the hiding number.", "First: content 1, key 2, left 2. Hiding number 2 × 2 = 4; right 1 + 4 = 5. Ciphertext (2, 5).", "Second: content 3, key 1, left 3. Hiding number 1 × 3 = 3; right 3 + 3 = 6. Ciphertext (3, 6).", "In the match you only receive pairs. Different keys let different contents fit the same right value, so an observer without the keys cannot determine the contents."] },
      { title: "Add the closed pairs and check why", lines: ["Your calculation: lefts 2 + 3 = 5; rights 5 + 6 = 11 → 11 − 7 = 4. Answer ciphertext: (5, 4).", "The judge's check: hiding numbers total 4 + 3 = 7. Subtract from the answer's right: 4 − 7 = −3 → −3 + 7 = 4. This matches the content total 1 + 3 = 4.", "The right values add as (1 + 4) + (3 + 3) = (1 + 3) + (4 + 3). Rearranging separates the content total from the hiding total.", "The judge uses each original left value and its own input key to find the hiding numbers. It separately checks that the answer's left is 2 + 3 = 5. The answer pair alone is not enough to decrypt it."] },
      { title: "Add this Order's lefts and rights separately", lines: ["Add the left values; take the remainder after dividing by the card's p and enter your answer: left part. Repeat for the rights and enter your answer: right part.", "Both values must be at least 0 and smaller than p. Press SUBMIT CIPHERTEXT. You never need to open a ciphertext or find a key.", "This teaching model implements ciphertext addition, not a full practical FHE system."] },
    ] },
    vigenere: { name: "Vigenère cipher", steps: [
      { title: "Repeat three secret shifts", lines: ["Represent symbols by values 0–5. Prepare three secret shifts, called keys, and repeat key 1 → key 2 → key 3 → key 1 from left to right.", "Encrypted value = (original value + selected key), taking the remainder after dividing by 6. Encryption transforms data to hide its content."] },
      { title: "Practice with different values", lines: ["Example: keys 1,2,3 and originals 2,0,5 give 2+1=3, 0+2=2, 5+3=8→subtract 6 to get 2. Encrypted row: 3,2,2.", "Publishing an original/answer pair reveals that position’s key: encrypted minus original; add 6 if negative. Repeated keys do not offer modern encryption security. Open your Order’s hints for its detailed procedure."] },
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
    case "ec-add": return "ec";
    case "rotor-encrypt": return "rotor";
    case "rsa-encrypt": return "rsa";
    case "rps-duel": return "commit";
    case "homomorphic-sum": return "fhe";
    case "masked-total": return "mpc";
    case "zk-sudoku": return "zk";
    case "caesar-shift": return task.rung;
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
    case "caesar-shift": return task.rung === "vigenere" ? [] : [
      ...task.plaintext.map((value, i) => `${value} + ${cipherKeyAt(task.myKey, (task.keyPosition ?? 0) + i)} = ?`),
      ja ? `それぞれ ${task.symbols.length} で割った余りを、元の順に入力します。` : `Take remainders after dividing by ${task.symbols.length}; enter them in the original order.`,
    ];
    default: return [];
  }
}

export const CONCEPT_QUESTIONS: Record<Locale, Record<Concept, string>> = {"ja": {"ec":"楕円曲線の点加算とは？","schnorr":"ゼロ知識証明：なぜ秘密を送らず確かめられる？","rotor": "位置が進む車輪って何？", "rsa": "公開鍵と元に戻す鍵とは？", "remainder": "割った余りって何？", "sharing": "秘密分散・シェアって何？", "mpc": "秘密計算で何ができる？", "zk": "ZKとは？数独の模型で見る", "fhe": "暗号のまま、どう計算する？", "caesar": "ずらす暗号って何？", "vigenere": "3個の鍵を繰り返すと？", "commit": "なぜ手を先に封じる？"}, "en": {"ec":"What is curve addition?","schnorr":"Zero knowledge: verify without the secret?","rotor": "How do advancing wheels work?", "rsa": "What are public and recovery keys?", "remainder": "What is a remainder?", "sharing": "What are secret sharing and shares?", "mpc": "What does MPC do?", "zk": "What is ZK? Explore a sudoku model", "fhe": "How can encrypted values be added?", "caesar": "What is a shift cipher?", "vigenere": "What changes with three repeated keys?", "commit": "Why seal a hand first?"}};

const button = { cursor: "pointer", border: "1px solid #a4b5c6", borderRadius: 5, padding: "5px 9px", color: "#24476d", background: "#fff", fontSize: 12 } as const;
export default function ConceptExplanation({ locale, topic, task, prime, embedded = false }: {
  readonly locale: Locale; readonly topic?: Concept; readonly task?: OrderTaskProjection; readonly prime?: string; readonly embedded?: boolean;
}) {
  const [selected, setSelected] = useState<Concept | null>(null);
  const [stepIndex, setStepIndex] = useState(0);
  const copy = EXPLANATIONS[locale];
  const topics = topic ? [topic] : (["remainder", "sharing", "schnorr", "zk", "commit", "mpc", "fhe", "caesar", "vigenere", "rotor", "rsa", "ec"] as Concept[]);
  const lesson = selected ? copy[selected] : null;
  const step = lesson?.steps[stepIndex];
  const ja = locale === "ja";
  return (
    <section aria-label="crypto-concept-explanation" style={{ color: "#16212e", background: "#fff", border: embedded ? undefined : "1px solid #d6e0eb", borderRadius: 6, padding: embedded ? 0 : 8, margin: embedded ? 0 : "8px 0", fontSize: 13 }}>
      <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 6 }}>

        {topics.map((item) => <button key={item} type="button" style={button} aria-expanded={selected === item}
          onClick={() => { setSelected(selected === item ? null : item); setStepIndex(0); }}>{CONCEPT_QUESTIONS[locale][item]}</button>)}
      </div>
      {selected === "schnorr" && <SchnorrLesson locale={locale}/>}
      {lesson && step && <div style={{ border: "1px solid #bad1e8", borderRadius: 6, background: "#f5f9fe", padding: 12, marginTop: 6 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
          <strong>{lesson.name} · {stepIndex + 1} / {lesson.steps.length} — {step.title}</strong>
          <button type="button" style={button} onClick={() => setSelected(null)}>{embedded ? (ja ? "テーマを選び直す" : "Choose another topic") : (ja ? "解説を閉じる" : "Close explanation")}</button>
        </div>
        <div aria-live="polite">
          {step.diagram && <ConceptDiagram key={`${selected}:${stepIndex}`} kind={step.diagram} locale={locale} />}
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
            : <button type="button" style={button} onClick={() => setSelected(null)}>{embedded ? (ja ? "テーマを選び直す" : "Choose another topic") : (ja ? "問題に戻る" : "Back to the problem")}</button>}
        </nav>
      </div>}
    </section>
  );
}
