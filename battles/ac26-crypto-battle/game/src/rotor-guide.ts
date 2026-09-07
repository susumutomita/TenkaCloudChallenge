import type { RotorTaskProjection } from "./rotor.ts";

/** Paid rungs only. The free surface separately states every needed formula. */
export function rotorGuide(
  task: RotorTaskProjection,
  rung: 0 | 1 | 2,
): { readonly ja: string; readonly en: string } {
  if (rung === 0)
    return {
      ja: "目的：元の数字の列（平文）を、車輪の対応表で別の列（暗号文）へ変えます。車輪は数字を一対一に読み替える表です。2つの表P・Qを通し、1文字出すたびに位置を進めます。同じ数字でも位置が違うと別の数字になります。\n初期位置は自分と審判だけが知ります。同じ世代のお題は毎回同じ初期位置から始まります。CIPHERは答えを審判だけへ送り、LEAKは元の列と答えを公開します。公開1組だけで初期位置が分かる場合もあります。",
      en: "Goal: transform an original row (plaintext) into another row (ciphertext) using wheels. Each wheel assigns one output to each input, with no two inputs sharing an output. Pass through public tables P and Q, then advance their positions after each output. A digit can change differently at different positions.\nOnly your team and the judge know the initial positions. Each Order in the same generation starts from those same positions. CIPHER sends the answer only to the judge; LEAK publishes the original and encrypted rows. One public pair can sometimes reveal the initial positions.",
    };
  if (rung === 1)
    return {
      ja: "式：4で割った余りを mod 4 と書き、負なら4を足して0〜3へ戻します。表の左から0番、1番、2番、3番です。P=[1,3,0,2]、Q=[3,0,2,1]。\nu=(P[(m+a) mod 4]−a) mod 4、c=(Q[(u+b) mod 4]−b) mod 4。mは元の数字、aは速い車輪、bは遅い車輪の今の位置、uは途中の数字、cは出力です。\n別の一桁例：m=3,a=0,b=1ならP[3]=2なのでu=2。Q[3]=1から1を引いてc=0。出力してからaを1へ進め、bは1のまま。aが3→0に戻るときだけbも1進め、bも3の次は0です。",
      en: "Formula: write the remainder after division by 4 as mod 4; if negative, add 4 to return to 0–3. Table entries are numbered 0,1,2,3 from the left. P=[1,3,0,2], Q=[3,0,2,1].\nu=(P[(m+a) mod 4]−a) mod 4; c=(Q[(u+b) mod 4]−b) mod 4. m is the original digit; a and b are the current fast and slow positions; u is the intermediate digit; c is the output.\nSeparate one-digit example: m=3,a=0,b=1 gives P[3]=2, so u=2. Q[3]=1 minus 1 gives c=0. Output first, then advance a to 1; b stays 1. Only when a wraps 3→0 does b advance too, also wrapping 3→0.",
    };
  return {
    ja: `この1題を計算してから次へ進みます。元の列は ${task.plaintext.join(" ")}、初期位置はa=${task.myInitial.a}, b=${task.myInitial.b}。\n① 表に4行を作り、各行へ元の数字m、今のa・bを書きます。② その行のmをPの式に入れてuを計算し、uをQの式に入れてcを書きます。③ cを出してからaを1進めます。aが3→0ならbも1進め、次の行へ写します。④ 出したcだけを上から4個、CIPHER欄へ入れて提出。完了表示と得点を確認します。\n先に誤答していた場合、期限内に正答しても0点で完了します。未入力・範囲外は誤答に数えません。再挑戦も最初のa・bから始めます。`,
    en: `Finish this Order before moving on. Original row: ${task.plaintext.join(" ")}; initial positions a=${task.myInitial.a}, b=${task.myInitial.b}.\n(1) Make four worksheet rows for m and current a,b. (2) Use m in the P formula to calculate u, then u in the Q formula to write c. (3) Output c before advancing a by 1; if a wraps 3→0, advance b too. Copy the new positions to the next row. (4) Enter only the four outputs c, top to bottom, in CIPHER. Check completion and points.\nAfter an earlier wrong answer, a correct answer before the deadline completes for 0 points. Empty/out-of-range input is not a wrong answer. Every retry starts from the original a,b.`,
  };
}
