# 1 行打って、出た値を貼る — FRI の折り畳みとクエリ検査

> このトラックは Advanced Cryptography Program 2026 の非公式・独立した companion です。講座および
> その運営者とは提携しておらず、承認も受けていません。問題文、コード、fixture、図はすべて独自に
> 作成しています。このトラックに関する質問は講座運営ではなく TenkaCloud リポジトリへお願いします。

**Track:** `advanced-cryptography-2026` · **Order:** 425 · **Chapter:** Week 4 / Drill: FRI
folding · **Role:** `mechanism` · **想定時間:** 40〜60 分 · **配点:** 200
· **Status:** draft — 新規 companion は人間のプレイ証拠（#465）が揃うまで draft

## これは何か

関数を書く問題ではありません。自分の `python3` を開き、Portal の「証拠を調べる」に出た数を貼り、
**1 行打って、出た値を貼る**を 12 回繰り返します。まず正直な FRI を 1 周、次に嘘の折り畳みを自分で捕まえます。

```
1  Q = ...; (Q(0),Q(1),Q(2))     コミット済みの Q₀                      poly
2  Qe, Qo                        偶数次と奇数次に分ける                 （回答欄なし）
3  全点で検算                     all True                             （回答欄なし）
4  Q1 = Qe + beta*Qo             折り畳み — 次数が半分                  fold
5  c + beta2*d                   もう 1 回折ると定数                    fold2
6  (Q(x), Q(-x))                 2 点の開示                            query
7  (re, ro, Qe(x²), Qo(x²))      両半分を復元                          recover
8  (re + beta*ro, Q1(x²))        クエリ検査 — 正直なら一致              consistency
9  Q1c = Q1 + d0 + d1*Y          すり替えたコミット                    （回答欄なし）
10 (re + beta*ro, Q1c(x²))       同じ検査が嘘を捕まえる                 cheat-caught
11 sorted(見逃し)                ±x の 1 組だけ                        miss-points
12 正直なら全点で通る             []                                   （回答欄なし）
```

各行に「この行の意味」が付き、値が合うと「合ったら読む」が開きます。12 行のうち回答欄があるのは
8 行（platform の 1 問あたりの上限）です。

## なぜ数が小さく、seed 由来なのか

体は小さな奇素数（17〜31）なので、どの行も 1 画面の計算で、全点の検算もリスト内包 1 つで済みます。
手順は講義の FRI の節そのもので、講義の F₁₇ の数値例（Q₀ = 15 + 5X + 5X²、Q₁ = 5Y + 13、x = 8）は
公開テスト part 1 にそのまま入っています。deploy の Q₀（次数ちょうど 3）・β・β₂・x・すり替えの差分は
すべて seed 由来。すり替えは d0 = −d1·s² の形で作るので、見逃しは必ず ±x の 1 組で、deploy ごとに
変わります。

## Participant Portal での進め方

1. Participant Portal で問題を起動する。同じ画面に問題エディタが出る。
2. **「証拠を調べる」**を押す。数が Python の代入文で出るので、まず `python3` に貼る。
3. 1 行目を打ち、出た値を `poly` の回答欄に貼って提出。その値の 1 文を読む。12 行目まで続ける。
   **回答欄は 1 行の入力欄です。**
4. Python を開けないとき: エディタの `fri_drill.py` の 12 関数を埋めて**「公開テストを実行」**。
   この deploy の数での自分の関数の値が出る — REPL が出すのと同じ値です。

直接回答は現在の deploy seed に結び付くため、別 deploy からコピーした値は拒否されます。

## 採点

8 つの checkpoint を独立に採点します。誤答は 1 回 10 点減点です。

| Checkpoint | 配点 | 証拠の種類 | 何を検査するか |
|---|---:|---|---|
| `poly` | 20 | construct | コミット済みの Q₀ を 0, 1, 2 で |
| `fold` | 25 | construct | Q₁ = Q_even + β·Q_odd — 次数が半分 |
| `fold2` | 25 | construct | もう 1 回折った定数 c + β₂·d |
| `query` | 20 | predict | 2 点の開示 (Q₀(x), Q₀(−x)) |
| `recover` | 25 | predict | 開示から復元した両半分と、直接計算の並記 |
| `consistency` | 25 | trace | 正直な折り畳みのクエリ検査 — 一致 |
| `cheat-caught` | 30 | counterexample | すり替えた Q₁′ への同じ検査 — 捕まる |
| `miss-points` | 30 | trace | 見逃しになる ±x の 1 組 |

hint は各 checkpoint に 1 つ（減点 6）。その行で起きやすい打ち間違いを名指しします。

## 保証範囲

ローカル実行は**自習用の honor-system 検証**です。マシンも Docker デーモンも compose stack の
全 image もあなたの管理下にあるので、その人物に対して中身を秘匿することはできません。ここでの
境界は誤配防止であり、その人物に対する秘匿ではありません。参加者用 Workbench image に入るのは
公開 fixture・公開 test・starter だけです。8 行の期待値導出（`verifier/expected.py`）と hidden
suite は、Compose 内部 network 上でしか到達できない別の verifier image に置きます。`reference/`
と `mutation.py` は `author` stage にだけ追加します。

host の `127.0.0.1:18135` に公開するのは Workbench だけで、verifier に host port はありません。
両 service は non-root、read-only filesystem、capabilities なし、no-new-privileges、
メモリ・PID 上限つきで動きます。提出コードは verifier をハングさせたりクラッシュさせたりできません。
checkpoint は echo した id しか加点できません。結果は期待値を漏らしません。fixture はこのデプロイの
seed 由来なので、暗記した答えは持ち越せません。

これは自習と誠実な練習を支えます。競技順位・試験・修了判定は**支えません**。
それらには participant が一切管理しない verifier が必要で、
[#271](https://github.com/susumutomita/TenkaCloudChallenge/issues/271) で追跡しています。

## コスト

ゼロです。クラウドアカウントも AWS リソースも使いません。

## 作問者向け

`make reference-test` が mutation suite を実行します。壊した reference 8 種類（奇数部分を偶数の
係数で作る、折り畳みで両半分を逆にする、(2x)⁻¹ を x⁻¹ にする、2 点目を Q(x) にする、2 回目の
折り畳みで β を使い回す、…）を hidden suite が落とすこと、verifier を狙った near-miss 10 種類
（折る前の値、入れ替え・切り詰めた組、正直な行に嘘の組・その逆、真偽値、別 deploy の答え）を
値の採点器が拒否することを確かめます。
`scripts/solvability/expected/ac26-w4-fri-drill.py` が採点する 8 行の答えを solvability sweep
用に写しています。
