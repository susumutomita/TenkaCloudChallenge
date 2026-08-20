# 1 行打って、出た値を貼る — PLONK の 2 本の制約と大積

> このトラックは Advanced Cryptography Program 2026 の非公式・独立した companion です。講座および
> その運営者とは提携しておらず、承認も受けていません。問題文、コード、fixture、図はすべて独自に
> 作成しています。このトラックに関する質問は講座運営ではなく TenkaCloud リポジトリへお願いします。

**Track:** `advanced-cryptography-2026` · **Order:** 435 · **Chapter:** Week 4 / Drill: PLONK's
two constraints · **Role:** `mechanism` · **想定時間:** 40〜60 分 · **配点:** 200
· **Status:** draft — 新規 companion は人間のプレイ証拠（#465）が揃うまで draft

## これは何か

関数を書く問題ではありません。自分の `python3` を開き、Portal の「証拠を調べる」に出た数を貼り、
**1 行打って、出た値を貼る**を 12 回繰り返します。まず正直なゲート表で、次に自分で作った嘘の表で。

```
1  (o0, o1, o2)               3 つのゲートの出力                      outputs
2  ゲート方程式 × 3 行          [0, 0, 0] — 全行が型どおり             （回答欄なし）
3  配線 2 本                   (True, True)                          （回答欄なし）
4  bad2 = (o0+g, o1, ...)     嘘の行 — ゲートは通り配線が破れる        bad-row
5  嘘の表のゲートと配線          ([0,0,0], (False, True))             （回答欄なし）
6  9 マスの番地                 ω^行 · (列+1)                         addresses
7  σ で付け替えた番地            2 組だけ入れ替わる                     sigma-addresses
8  指紋                        (値 + β·番地 + γ) の最初の 3 つ        marks
9  大積                        正直な表では両辺一致                    grand-product
10 嘘の表の大積                 配線の破れが積に出る                    bad-product
11 集合で並べて見る              (True, False)                        （回答欄なし）
12 見逃しを数える               指紋が 0 に潰れるときだけ               miss-count
```

各行に「この行の意味」が付き、値が合うと「合ったら読む」が開きます。12 行のうち回答欄があるのは
8 行（platform の 1 問あたりの上限）。残り 4 行は構成上の定数で、意味は問題文がその場で説明します。

## なぜ数が小さく、seed 由来なのか

ゲート用の体は小さな素数（11〜23）、大積用の体は 3 桁の素数（101〜113）なので、どの行も 1 画面の
計算で、見逃しの全数カウントも数秒で終わります。表・σ・大積の手順は講義の PLONK の数値例そのもの。
入力・2 つの体・番地の底・β・γ・嘘のずらし幅 g はすべてこの deploy の `FLAG_SEED` から決まります。
1 行につき正解は 1 つ、通るのは自分の Python が出した値だけで、見逃しの個数も deploy ごとに変わります。

## Participant Portal での進め方

1. Participant Portal で問題を起動する。同じ画面に問題エディタが出る。
2. **「証拠を調べる」**を押す。数が Python の代入文で出るので、まず `python3` に貼る。
3. 1 行目を打ち、出た値を `outputs` の回答欄に貼って提出。その値の 1 文を読む。12 行目まで続ける。
   **回答欄は 1 行の入力欄です。**
4. Python を開けないとき: エディタの `plonk_drill.py` の 12 関数を埋めて**「公開テストを実行」**。
   この deploy の数での自分の関数の値が出る — REPL が出すのと同じ値です。

直接回答は現在の deploy seed に結び付くため、別 deploy からコピーした値は拒否されます。

## 採点

8 つの checkpoint を独立に採点します。誤答は 1 回 10 点減点です。

| Checkpoint | 配点 | 証拠の種類 | 何を検査するか |
|---|---:|---|---|
| `outputs` | 20 | construct | 3 つのゲートの出力 |
| `bad-row` | 20 | counterexample | 嘘の gate 2 の行 — ゲートは通り配線が破れる |
| `addresses` | 25 | construct | 9 マス全部の番地 ω^行 · (列 + 1) |
| `sigma-addresses` | 25 | predict | σ で付け替えた番地 |
| `marks` | 25 | predict | 指紋 (値 + β·番地 + γ) の最初の 3 つ |
| `grand-product` | 25 | trace | 2 通りの積 — 正直な表では一致 |
| `bad-product` | 30 | counterexample | 2 通りの積 — 配線の破れで割れる |
| `miss-count` | 30 | trace | 見逃しになる (β, γ) の組の個数 |

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

`make reference-test` が mutation suite を実行します。壊した reference 8 種類（掛け算ゲートを
足し算で書く、番地の (列+1) を 列 にする、σ の 2 組目を忘れる、`% q` を落とす、β = 0 を数える、…）を
hidden suite が落とすこと、verifier を狙った near-miss 12 種類（σ 前の番地列、嘘の行に正直な積、
入れ替えた組、長さの違う組、真偽値、別 deploy の答え）を値の採点器が拒否することを確かめます。
server 側の見逃しカウントは因数分解で高速に数え（見逃し = 共有指紋のどれかが 0 で両辺が 0 に潰れる
とき）、learner が打つ全数ループと一致することを問題別テストが証明しています。
`scripts/solvability/expected/ac26-w4-plonk-drill.py` が採点する 8 行の答えを solvability sweep
用に写しています。
