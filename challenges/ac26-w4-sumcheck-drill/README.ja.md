# 1 行打って、出た値を貼る — SumCheck を 2 ラウンド回して嘘を数える

> このトラックは Advanced Cryptography Program 2026 の非公式・独立した companion です。講座および
> その運営者とは提携しておらず、承認も受けていません。問題文、コード、fixture、図はすべて独自に
> 作成しています。このトラックに関する質問は講座運営ではなく TenkaCloud リポジトリへお願いします。

**Track:** `advanced-cryptography-2026` · **Order:** 405 · **Chapter:** Week 4 / Drill: SumCheck
by hand · **Role:** `mechanism` · **想定時間:** 40〜60 分 · **配点:** 200
· **Status:** draft — 新規 companion は人間のプレイ証拠（#465）が揃うまで draft

## これは何か

関数を書く問題ではありません。自分の `python3` を開き、Portal の「証拠を調べる」に出た数を貼り、
**1 行打って、出た値を貼る**を 12 回繰り返します。前半 9 行はあなたが検証者、後半 3 行は嘘の証明者です。

```
1  (y0, y1, out)                回路 — 2 つのゲートと出力              circuit
2  W1 = ...; (W1(0),W1(1),W1(2))  表を直線に伸ばす（MLE）              mle
3  g0 = ...; 格子点 4 つ         配線を式にする                        grid
4  格子点全部の和                4 項の和                             （回答欄なし）
5  P1 = ...; P1(0)+P1(1)        証明者の p₁ を 2 点の和で検査          （回答欄なし）
6  全点の検算                    p₁ は本物か（検証者はやらない検算）     （回答欄なし）
7  P1(r1)                       ランダムな 1 点 — 次の主張             round1
8  P2 = ...; P2(0)+P2(1)        証明者の p₂ を 2 点の和で検査          （回答欄なし）
9  (P2(r2), g0(r1, r2))         最後の 1 点 — 検証者が g₀ を自分で計算  final-check
10 P1c = P1 + d*(1-t); ...      主張を d だけ水増し                    lie
11 P2c = ...; 3 つ組            辻褄合わせの果てに最後の 1 点で落ちる    lie-caught
12 sorted(見逃し)               どの r₂ なら見逃したか                  miss-points
```

各行に「この行の意味」が付き、値が合うと「合ったら読む」が開きます。12 行のうち回答欄があるのは
8 行（platform の 1 問あたりの上限）。残り 4 行は、直前に出した値と一致するか、次の行の材料です。

## なぜ数が小さく、seed 由来なのか

体は小さな素数（11〜23）なので、どの行も 1 画面の計算で、全点の検算もリスト内包 1 つで済みます。
回路は講義の GKR の 2 ゲートの例そのもの。入力・検証者の乱数・証明者の係数メッセージ・嘘のパラメータは
すべてこの deploy の `FLAG_SEED` から決まります。1 行につき正解は 1 つ、通るのは自分の Python が
出した値だけで、見逃しの 2 点も deploy ごとに変わります。

## Participant Portal での進め方

1. Participant Portal で問題を起動する。同じ画面に問題エディタが出る。
2. **「証拠を調べる」**を押す。数が Python の代入文で出るので、まず `python3` に貼る。
3. 1 行目を打ち、出た値を `circuit` の回答欄に貼って提出。その値の 1 文を読む。12 行目まで続ける。
   **回答欄は 1 行の入力欄です。**
4. Python を開けないとき: エディタの `sumcheck_drill.py` の 12 関数を埋めて**「公開テストを実行」**。
   この deploy の数での自分の関数の値が出る — REPL が出すのと同じ値です。

直接回答は現在の deploy seed に結び付くため、別 deploy からコピーした値は拒否されます。

## 採点

8 つの checkpoint を独立に採点します。誤答は 1 回 10 点減点です。

| Checkpoint | 配点 | 証拠の種類 | 何を検査するか |
|---|---:|---|---|
| `circuit` | 20 | construct | (y₀, y₁, 出力) |
| `mle` | 25 | construct | 表を伸ばした (W₁(0), W₁(1), W₁(2)) |
| `grid` | 25 | predict | 格子点 4 つでの g₀ |
| `round1` | 25 | predict | 検証者の乱数 r₁ での p₁ |
| `final-check` | 25 | trace | (p₂(r₂), 検証者自身の g₀(r₁, r₂)) |
| `lie` | 25 | counterexample | 水増しした p₁′ — 和の検査と r₁ での値 |
| `lie-caught` | 30 | counterexample | 細工した p₂′ — 和の検査は通り、最後の 1 点で落ちる |
| `miss-points` | 25 | trace | 見逃しになる r₂ の正確な一覧 |

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

`make reference-test` が mutation suite を実行します。壊した reference 8 種類（MLE の表を逆に
貼る、(1−a)·b の角を間違える、t² を落とす、細工を t 側に付ける、見逃しを 2 から数える、…）を
hidden suite が落とすこと、verifier を狙った near-miss 12 種類（画面に出ている値、別の行の値、
順序や長さの違う組、真偽値、別 deploy の答え）を値の採点器が拒否することを確かめます。
`scripts/solvability/expected/ac26-w4-sumcheck-drill.py` が採点する 8 行の答えを solvability
sweep 用に写しています。
