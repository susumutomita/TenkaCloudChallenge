# 1 行打って、出た値を貼る — 有限体から nonce 再利用まで 12 行

> このトラックは Advanced Cryptography Program 2026 の非公式・独立した companion です。講座および
> その運営者とは提携しておらず、承認も受けていません。問題文、コード、fixture、図はすべて独自に
> 作成しています。このトラックに関する質問は講座運営ではなく TenkaCloud リポジトリへお願いします。

**Track:** `advanced-cryptography-2026` · **Order:** 305 · **Chapter:** Week 3 / Drill: twelve lines
from field to nonce reuse · **Role:** `mechanism` · **想定時間:** 40〜60 分 · **配点:** 200
· **Status:** draft — 新規 companion は人間のプレイ証拠（#465）が揃うまで draft

## これは何か

関数を書く問題ではありません。自分の `python3` を開き、Portal の「証拠を調べる」に出た数を貼り、
**1 行打って、出た値を貼る**を 12 回繰り返します。

```
1  (-t) % p                 負の数は 0..p-1 に住む                （回答欄なし）
2  pow(t, p - 2, p)         逆元 — 掛けて 1 になる相手              field-inv
3  lam = ...                G と Q を通る直線の傾き               （回答欄なし）
4  (x3, y3)                 G + Q — 3 つ目の交点を折り返す          add-points
5  (x3, y3)                 2G — 接線                             double
6  def ec_add ... ; k       G を足し続けて O に戻る回数 = 位数 n    order
7  P = ec_mul(x, G)         公開鍵                                （回答欄なし）
8  R = ec_mul(r, G)         commitment                            （回答欄なし）
9  s = (r + e*x) % n        response                              response
10 ec_mul(s, G)             検証式 s*G = R + e*P の左辺            verify
11 (s1-s2)/(e1-e2) mod n    同じ nonce の 2 署名から秘密            nonce-reuse
12 同じことを曲線 2 で        転移                                  transfer
```

各行に「この行の意味」が付き、値が合うと「合ったら読む」が開きます。結果と解説が隣にある — それが
この形式の狙いで、この問題がある理由です（`metadata.json` の description を参照）。12 行のうち
回答欄があるのは 8 行（platform の 1 問あたりの上限）。残り 4 行は次の行の材料で、間違いはそこで
表に出ます（λ の間違いは 4 行目で、P や R の間違いは 10 行目で）。

## なぜ数が小さく、seed 由来なのか

曲線は検証済みの素数位数の小曲線（p ≤ 31、n ≤ 43）なので、どの行も 1 画面の計算で、`ec_mul` は
素朴なループで済みます。曲線・t・Q・x・r・e・攻撃鍵・転移曲線はすべてこの deploy の `FLAG_SEED`
から決まります。1 行につき正解は 1 つ、通るのは自分の Python が出した値だけで、別 deploy から
写した値は拒否されます。公式課題のテスト値は使いません。

## Participant Portal での進め方

1. Participant Portal で問題を起動する。同じ画面に問題エディタが出る。
2. **「証拠を調べる」**を押す。数が Python の代入文で出るので、まず `python3` に貼る。
3. 1 行目を打ち、出た値を `field-neg` の回答欄に貼って提出。その値の 1 文を読む。12 行目まで続ける。
   **回答欄は 1 行の入力欄です。**
4. Python を開けないとき: エディタの `schnorr_drill.py` の 12 関数を埋めて**「公開テストを実行」**。
   この deploy の数での自分の関数の値が出る — REPL が出すのと同じ値です。

checkout・ターミナル（自分の Python 以外）・ローカルエディタ・画面間のコピペは不要です。直接回答は
現在の deploy seed に結び付くため、別 deploy からコピーした値は拒否されます。

## 採点

8 つの checkpoint を独立に採点します。誤答は 1 回 10 点減点です。

| Checkpoint | 配点 | 証拠の種類 | 何を検査するか |
|---|---:|---|---|
| `field-inv` | 15 | predict | t の逆元 |
| `add-points` | 25 | construct | G + Q（3 行目の λ の間違いはここで出る） |
| `double` | 20 | construct | 2G |
| `order` | 25 | trace | O に戻るまで足して数えた位数 n |
| `response` | 25 | predict | s = r + e·x mod n |
| `verify` | 30 | trace | 検証式の左辺 s·G（7〜8 行目の P・R の間違いはここで出る） |
| `nonce-reuse` | 30 | counterexample | 同じ nonce の 2 署名から取り出した秘密 |
| `transfer` | 30 | transfer | 位数を数え直した 2 本目の曲線での s |

hint は各 checkpoint に 1 つ（減点 6）。その行で起きやすい打ち間違いを名指しします。

## 保証範囲

ローカル実行は**自習用の honor-system 検証**です。マシンも Docker デーモンも image も
あなたの管理下にあるので、 image の中身はあなたに対して秘匿されていません。
`reference/` と `tests/hidden/` を bind-mount しないのは、あなたの git checkout に
紛れ込ませないためであって、手が届かなくするためではありません。

verifier が実際に保証するのはもっと狭く、そして本物です。提出コードは verifier を
ハングさせたりクラッシュさせたりできません。 checkpoint は echo した id しか加点できません。
結果は期待値を漏らしません。 fixture はこのデプロイの seed 由来なので、暗記した答えは持ち越せません。

これは自習と誠実な練習を支えます。競技順位・試験・修了判定は**支えません**。
それらには participant が管理しない verifier が必要で、
[#271](https://github.com/susumutomita/TenkaCloudChallenge/issues/271) で追跡しています。

## コスト

ゼロです。クラウドアカウントも AWS リソースも使いません。

## 作問者向け

`make reference-test` が mutation suite を実行します。壊した reference 9 種類（s を mod p で取る、
接線の a を忘れる、折り返しを忘れる、位数を 0 から数える、…）を hidden suite が落とすこと、
verifier を狙った near-miss 10 種類（画面に出ている値、別の行の値、折り返す前の点、mod p で
取った s、真偽値、別 deploy の答え）を値の採点器が拒否することを確かめます。
`scripts/solvability/expected/ac26-w3-schnorr-drill.py` が採点する 8 行の答えを solvability sweep
用に写しています。
