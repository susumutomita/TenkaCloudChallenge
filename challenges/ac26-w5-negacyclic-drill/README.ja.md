# 1 行打って、出た値を貼る — negacyclic の裏返りを、事故として、次に仕掛けとして

> このトラックは Advanced Cryptography Program 2026 の非公式・独立した companion です。講座および
> その運営者とは提携しておらず、承認も受けていません。問題文、コード、fixture、図はすべて独自に
> 作成しています。このトラックに関する質問は講座運営ではなく TenkaCloud リポジトリへお願いします。

**Track:** `advanced-cryptography-2026` · **Order:** 565 · **Chapter:** Week 5 / Drill:
Negacyclic flip and HomNAND · **Role:** `mechanism` · **想定時間:** 40〜60 分 · **配点:** 200
· **Status:** draft — 新規 companion は人間のプレイ証拠（#465）が揃うまで draft

## これは何か

関数を書く問題ではありません。自分の `python3` を開き、Portal の「証拠を確認」に出た数を貼り、
**1 行打って、出た値を貼る**を 12 回繰り返します。前半 5 行は negacyclic の符号反転（`x^n = -1`）を
**事故**として出します — 講義スライド 35 が問いのまま残した箇所です。後半 7 行は同じ反転を、
HomNAND を動かす**仕掛け**として出します（スライド 43〜45）。

```
1  (p, q, n, D)                環の定数、q = 2n                      params
2  E = lo + hi; ...            指数のはみ出しを畳む                   wrap
3  c = lambda i: ...; probes   6 か所の定数項                        signs
4  min(i ... if c(i) < 0)      符号の境界 — ちょうど n               boundary
5  (lo + n, c(lo + n))         n だけ行き過ぎた読み出し               hazard
6  (p - 1, 1)                  bit の対応、実質 ±1                  （回答欄なし）
7  r = 1 - m1 - m2 mod p       4 通りの位相                         （回答欄なし）
8  D*r - noise mod q           4 通りの回転量                        rotations
9  tuple(c(i) for i in rots)   回した後の定数項 — 真理値表            constants
10 NAND(a, b) の 4 通り        答え合わせ                           （回答欄なし）
11 全ノイズ 0..dmax の掃引     表は閉じたまま                        （回答欄なし）
12 n - 3*D                     境界までの余裕                        margin
```

各行に「この行の意味」が付き、値が合うと「合ったら読む」が開きます。12 行のうち回答欄があるのは
8 行（platform の 1 問あたりの上限）。残り 4 行は構成の定数・答え合わせ・次の行の材料です。

## なぜ数が小さく、seed 由来なのか

環の次数は 16〜64、平文 modulus は 8〜32 なので、どの行も 1 画面の計算で、ノイズ掃引も
`all(...)` 1 つで済みます。手順は講義のもの、環・ノイズ・probe の位置はすべてこの deploy の
`FLAG_SEED` から決まります。課題自身の toy パラメータ (p=8, n=16) は生成から除外してあるので、
教材を写すだけでは解けません。1 行につき正解は 1 つ、通るのは自分の Python が出した値だけです。

このドリルが意図して運ぶ訂正が 1 つあります: スライド 44 は HomNAND の条件を「3 < n < p−1」と
書いていますが、講義自身の例で成り立ちません。生成器は実際に効く条件 — 3D < n かつ dmax ≤ D —
を満たす (n, p, dmax) だけを列挙し、`margin` 行でその余裕を学習者自身が測ります。

## Participant Portal での進め方

1. Participant Portal で問題を起動する。同じ画面に問題エディタが出る。
2. **「証拠を確認」**を押す。数が Python の代入文で出るので、まず `python3` に貼る。
3. 1 行目を打ち、出た値を 1 番目の回答欄に貼って提出。その値の 1 文を読む。12 行目まで続ける。
   **回答欄は 1 行の入力欄です。**
4. Python を開けないとき: エディタの `negacyclic_drill.py` の関数を埋めて**「公開テストを実行」**。
   この deploy の数での自分の関数の値が出る — REPL が出すのと同じ値です。

直接回答は現在の deploy seed に結び付くため、別 deploy からコピーした値は拒否されます。

## 採点

8 つの checkpoint を独立に採点します。誤答は 1 回 10 点減点です。

| Checkpoint | 配点 | 証拠の種類 | 何を検査するか |
|---|---:|---|---|
| `params` | 20 | construct | (p, q, n, D)。q = 2n、D = q/p |
| `wrap` | 25 | construct | x^(lo+hi) の簡約: 余り・符号・簡約前の指数 |
| `signs` | 25 | predict | x^(−i)·v(x) の定数項を 6 つの probe で |
| `boundary` | 20 | trace | 定数項が初めて負になる i — ちょうど n |
| `hazard` | 30 | counterexample | lo から n 行き過ぎた読み出し: 同じ係数、反対の符号 |
| `rotations` | 30 | construct | 4 通りの D·r − noise mod q |
| `constants` | 30 | predict | 回した後の定数項 — ±1 の NAND 列 |
| `margin` | 20 | trace | n − 3D。実条件が残す余裕 |

hint は各 checkpoint に 1 つ（減点 6）。その行で起きやすい打ち間違いを名指しします。

## 保証範囲

ローカル実行は**自習用の honor-system 検証**です。マシンも Docker デーモンも compose stack の
全 image もあなたの管理下にあるので、その人物に対して中身を秘匿することはできません。ここでの
境界は誤配防止であり、その人物に対する秘匿ではありません。参加者用 Workbench image に入るのは
Portal editor API・starter・公開 test だけです。Week 4 のドリルと違い、この問題の
`fixtures/generate.py` は期待値を公開値と同じ関数で導くため、module ごと別の非公開 verifier
image にだけ載せます（Issue 537/543 option B2）。Workbench はこの deploy の公開値を
Compose 内部 network 上の verifier の `GET /public` から取得します。`reference/` と
`mutation.py` は `author` stage にだけ追加します。

host の `127.0.0.1:18136` に公開するのは Workbench だけで、verifier に host port はありません。
両 service は non-root、read-only filesystem、capabilities なし、no-new-privileges、
メモリ・PID 上限つきで動きます。checkpoint は echo した id しか加点できません。結果は期待値を
漏らしません。fixture はこの deploy の seed 由来なので、暗記した答えは持ち越せません。

これは自習と誠実な練習を支えます。競技順位・試験・修了判定は**支えません**。
それらには participant が一切管理しない verifier が必要で、
[#271](https://github.com/susumutomita/TenkaCloudChallenge/issues/271) で追跡しています。

## コスト

ゼロです。クラウドアカウントも AWS リソースも使いません。

## 作問者向け

`make reference-test` が mutation suite を実行します。壊した reference 13 種類（符号を逆の
偶奇で付ける、c(i) の負側を忘れる、境界を n 未満だけ探す、ノイズを足す、スライド 44 の字面
どおり n − 3 にする、…）を hidden suite が落とすこと、verifier を狙った near-miss 12 種類
（画面に出ている値、別の行の値、定数項の欄に NAND の列、長さの違う組、真偽値、別 deploy の
答え）を値の採点器が拒否することを確かめます。participant image に `fixtures/` が無いため、
`make test` と `make inspect` は Compose 経由で動き、公開値は verifier の `GET /public` から
来ます。
