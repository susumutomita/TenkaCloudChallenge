# 1 行打って、出た値を貼る — x を知らないまま済む足し算

> このトラックは Advanced Cryptography Program 2026 の非公式・独立した companion です。講座および
> その運営者とは提携しておらず、承認も受けていません。問題文、コード、fixture、図はすべて独自に
> 作成しています。このトラックに関する質問は講座運営ではなく TenkaCloud リポジトリへお願いします。

**Track:** `advanced-cryptography-2026` · **Order:** 12 · **Chapter:** Bridge 0 /
Computing Under a Cover · **Role:** `diagnostic` · **想定時間:** 20〜30 分 · **配点:** 100
· **Status:** draft — 新規 companion は人間のプレイ証拠（#465）が揃うまで draft

## これは何か

カタログの入口に置く難易度 1 の 1 段目です。関数を書く問題ではありません。自分の `python3` を
開き、Portal の「証拠を確認」に出た数を貼り、**1 行打って、出た値を貼る**を 11 回繰り返します。
主題は中学 1 年の文字式 1 行 — `(a + x) + (b + x) = (a + b) + 2x` — コースの全部が立つ、
「x を知らないまま済む足し算」です。

```
1  c1, c2 = a + x, b + x       覆いをかぶせる                     covered
2  c1 + c2                     知らないまま足す                   sum-covered
3  (a + b) + 2 * x             全部知っている人の式               （回答欄なし）
4  c1 + c2 == ...              一致の確認                        （回答欄なし）
5  x の代わりに huge           15 桁の覆いを、差 1 本で           huge
6  held = c1 + c2; (held, 2x)  相手の手元にあるもの               held
7  held - 2 * x                覆いを外す                        recover
8  候補を数える                 1 つも絞れない                    guesses
9  c1 - c2                     共通の覆いが漏らす差               gap
10 (c1*c2, ab+(a+b)x, 差)      掛け算は x² を残す                product
11 差 == x * x                 名前のつく前の壁                  （回答欄なし）
```

各行に「この行の意味」が付き、値が合うと「合ったら読む」が開きます。11 行のうち回答欄があるのは
8 行（platform の 1 問あたりの上限）。残り 3 行のうち 2 行は直前の行が内容を担う True を見るだけの行、
3 行目は 2 行目と同じ数が出るのを見る行です。

## なぜ数が小さく、seed 由来なのか

a と b は 1 桁、小さい覆いは高々 2 桁、8 行目の候補の数も 60 未満 — どの行も手か目で確かめられる
大きさです。huge だけが 15 桁なのは「目で確かめられないこと」自体がその行の主題だからです。
数はすべてこの deploy の `FLAG_SEED` から決まり、問題文の例（a = 5, b = 3, x = 2, huge = 10⁶,
n = 13）は生成範囲外（x は 3 以上、huge は常に 15 桁、n は 17 以上）なので、問題文を写すだけ
では解けません。1 行につき正解は 1 つ、通るのは自分の Python が出した値だけです。

mod はこの問題では主題にしません: 8 行目の `% n` はインラインの 1 文注だけで済ませます。
時計の世界そのものは次の問題（`ac26-bridge-clock`）が教えます。

## Participant Portal での進め方

1. Participant Portal で問題を起動する。同じ画面に問題エディタが出る。
2. **「証拠を確認」**を押す。数が Python の代入文で出るので、まず `python3` に貼る。
3. 1 行目を打ち、出た値を 1 番目の回答欄に貼って提出。その値の 1 文を読む。11 行目まで続ける。
   **回答欄は 1 行の入力欄です。**
4. Python を開けないとき: エディタの `unknown_x_drill.py` の関数を埋めて**「公開テストを実行」**。
   この deploy の数での自分の関数の値が出る — REPL が出すのと同じ値です。

直接回答は現在の deploy seed に結び付くため、別 deploy からコピーした値は拒否されます。

## 採点

8 つの checkpoint を独立に採点します。誤答は 1 回 5 点減点です。

| Checkpoint | 配点 | 証拠の種類 | 何を検査するか |
|---|---:|---|---|
| `covered` | 10 | construct | 組 (a + x, b + x) — 相手が受け取る全部 |
| `sum-covered` | 10 | construct | c1 + c2。x を知らないままの足し算 |
| `huge` | 15 | predict | 覆いを 15 桁にしたときの両辺の差 |
| `held` | 10 | construct | 返ってくる数と、覆いの総量 2x の組 |
| `recover` | 10 | construct | 覆いを外した a + b — 誰にも見せていない合計 |
| `guesses` | 15 | trace | 候補の数え上げ: 1 つも絞れない |
| `gap` | 15 | counterexample | c1 − c2。同じ覆いの 2 つの値が漏らす差 |
| `product` | 15 | counterexample | 掛け算の余りもの — ちょうど x² |

hint は各 checkpoint に 1 つ（減点 3〜5）。その行で起きやすい打ち間違いを名指しします。

## 保証範囲

ローカル実行は**自習用の honor-system 検証**です。マシンも Docker デーモンも compose stack の
全 image もあなたの管理下にあるので、その人物に対して中身を秘匿することはできません。ここでの
境界は誤配防止であり、その人物に対する秘匿ではありません。参加者用 Workbench image に入るのは
Portal editor API・starter・公開 test だけです。この問題の `fixtures/generate.py` は期待値を
公開値と同じ関数で導くため、module ごと別の非公開 verifier image にだけ載せます（Issue 537/543
option B2）。Workbench はこの deploy の公開値を Compose 内部 network 上の verifier の
`GET /public` から取得します。`reference/` と `mutation.py` は `author` stage にだけ追加します。

host の `127.0.0.1:18140` に公開するのは Workbench だけで、verifier に host port はありません。
両 service は non-root、read-only filesystem、capabilities なし、no-new-privileges、
メモリ・PID 上限つきで動きます。checkpoint は echo した id しか加点できません。結果は期待値を
漏らしません。fixture はこの deploy の seed 由来なので、暗記した答えは持ち越せません。

これは自習と誠実な練習を支えます。競技順位・試験・修了判定は**支えません**。
それらには participant が一切管理しない verifier が必要で、
[#271](https://github.com/susumutomita/TenkaCloudChallenge/issues/271) で追跡しています。

## コスト

ゼロです。クラウドアカウントも AWS リソースも使いません。

## 作問者向け

`make reference-test` が mutation suite を実行します。壊した reference 11 種類（覆いをかぶせ
忘れる、覆いを 1 回しか数えない×3 か所、候補の数え上げで折り返しを忘れる、展開の交差項を
落とす、壁を 2x と比べる、…）を hidden suite が落とすこと、verifier を狙った near-miss 14 種類
（素の組、開けていない合計、「1 つに絞れるはず」、長さの違う組、真偽値、別 deploy の答え）を
値の採点器が拒否することを確かめます。participant image に `fixtures/` が無いため、`make test`
と `make inspect` は Compose 経由で動き、公開値は verifier の `GET /public` から来ます。
