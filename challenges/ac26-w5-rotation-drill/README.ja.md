# 1 行打って、出た値を貼る — ブートストラップを "Programmable" にする回転と表引き

> このトラックは Advanced Cryptography Program 2026 の非公式・独立した companion です。講座および
> その運営者とは提携しておらず、承認も受けていません。問題文、コード、fixture、図はすべて独自に
> 作成しています。このトラックに関する質問は講座運営ではなく TenkaCloud リポジトリへお願いします。

**Track:** `advanced-cryptography-2026` · **Order:** 563 · **Chapter:** Week 5 / Drill:
Blind rotation readout · **Role:** `mechanism` · **想定時間:** 40〜60 分 · **配点:** 200
· **Status:** draft — 新規 companion は人間のプレイ証拠（#465）が揃うまで draft

## これは何か

関数を書く問題ではありません。自分の `python3` を開き、Portal の「証拠を確認」に出た数を貼り、
**1 行打って、出た値を貼る**を 12 回繰り返します。12 行で Programmable Bootstrapping の核
（講義スライド 21〜26 と 42）を出します: ノイズの入った暗号文から、復号せずに、答えを並べた
多項式を暗号文が指す量だけ回して、定数項を読む。

```
1  (p, q, n, D)                この deploy の 4 定数                  params
2  ph = (b - a·s) % q          位相 — 復号の中間地点                  phase
3  divmod(ph, D)               平文とノイズ、見るだけ                （回答欄なし）
4  slot = 2n // p              平文 1 つぶんの幅                     （回答欄なし）
5  v = [f(...)...]; 4 点       テスト多項式、中央寄せの幅            testpoly
6  round(x * 2n / q)           2n/q 倍に丸める: D̂, â[0], b̂           rescale
7  (b̂ - â·s) % 2n              回す量 — n ではなく 2n の余り          index
8  c(idx)                      回して 0 番地を読む                    readout
9  f(m)                        答え合わせ: readout == f(m)           （回答欄なし）
10 idx の周りで同値を数える     答えが変わらない幅                     window
11 初めて変わる d − 1           境界まであと何位置                     edge
12 使える平文ぜんぶ掃く         全部で readout == f(m)               （回答欄なし）
```

各行に「この行の意味」が付き、値が合うと「合ったら読む」が開きます。12 行のうち回答欄があるのは
8 行（platform の 1 問あたりの上限）。残り 4 行は答え合わせ・構成の定数・次の行の材料です。

問題文が意図して運ぶ肝が 3 つあります。いずれも講義スライドの読み方として本質的です:

- **平文は下半分しか使えない。** 回転先が n を超えると定数項の符号が裏返り、f(m) ∈ [0, p) とは
  一致しようがない。スライド 26 が平文空間を Z_8 と書き「実際に使うのは0~3」と添えているのは
  この制約であって、簡略化ではない。
- **テスト多項式は同じ値を slot 幅で並べ、狙いを領域の真ん中に置く。** a と b は別々に丸められる
  ので index は誤差を持つ。スライド 24 の見出し「ポイントは幅を持たせること」がこれ。
- **回す量は 2n で割った余り。** n にすると符号の話が丸ごと消える。clean な deploy では数が偶然
  一致することすらあるため、作問側の suite はこの mutant を deploy の値ではなく行き過ぎ probe で
  仕留める。

## なぜ数が小さく、seed 由来なのか

環の次数は 32〜128、平文 modulus は 8 か 16、q = 2n·2^k なので、どの行も 1 画面の計算で、
締めの総当たりも `all(...)` 1 つで済みます。手順は講義のもの、modulus・秘密鍵・暗号文・関数 f は
すべてこの deploy の `FLAG_SEED` から決まります。講義自身の例 (p=8, n=16, q=64) は生成から除外して
あるので、教材を写すだけでは解けません。生成器は readout が全 usable 平文で f(m) に一致する mask
だけを採る（clean-mask 再抽選）ため、丸めの話は正直なまま、丸めで壊れた deploy は出ません。
1 行につき正解は 1 つ、通るのは自分の Python が出した値だけです。

秘密鍵 s は意図して見せています: 学習者はブートストラップ装置の中の人で、blind rotation が
暗号文の中でやる算数を、鍵を見ながら平文でなぞります。隠れているのは期待値のほうで、
それを自分で出すのがこのドリルです。

## Participant Portal での進め方

1. Participant Portal で問題を起動する。同じ画面に問題エディタが出る。
2. **「証拠を確認」**を押す。数が Python の代入文で出るので、まず `python3` に貼る。
3. 1 行目を打ち、出た値を 1 番目の回答欄に貼って提出。その値の 1 文を読む。12 行目まで続ける。
   **回答欄は 1 行の入力欄です。**
4. Python を開けないとき: エディタの `rotation_drill.py` の関数を埋めて**「公開テストを実行」**。
   この deploy の数での自分の関数の値が出る — REPL が出すのと同じ値です。

直接回答は現在の deploy seed に結び付くため、別 deploy からコピーした値は拒否されます。

## 採点

8 つの checkpoint を独立に採点します。誤答は 1 回 10 点減点です。

| Checkpoint | 配点 | 証拠の種類 | 何を検査するか |
|---|---:|---|---|
| `params` | 20 | construct | (p, q, n, D)。この構成では q ≠ 2n |
| `phase` | 30 | construct | b − a·s mod q。復号せずに mask を剥がす |
| `testpoly` | 30 | construct | f(m) を中央寄せの slot 幅で並べ、境界 4 点で読む |
| `rescale` | 25 | construct | round(x·2n/q) を D, a[0], b に — 3 つの別々の丸め |
| `index` | 30 | construct | b̂ − â·s を mod 2n で。n ではない |
| `readout` | 25 | predict | 回した後の定数項 — f(m) に一致する値 |
| `window` | 20 | trace | index の周りで同じ値が出続ける位置の数 |
| `edge` | 20 | trace | ノイズがあと何位置押しても答えが変わらないか |

hint は各 checkpoint に 1 つ（減点 6）。その行で起きやすい打ち間違いを名指しします。

## 保証範囲

ローカル実行は**自習用の honor-system 検証**です。マシンも Docker デーモンも compose stack の
全 image もあなたの管理下にあるので、その人物に対して中身を秘匿することはできません。ここでの
境界は誤配防止であり、その人物に対する秘匿ではありません。参加者用 Workbench image に入るのは
Portal editor API・starter・公開 test だけです。兄弟の ac26-w5-negacyclic-drill と同じく、
この問題の `fixtures/generate.py` は期待値を公開値と同じ関数で導くため、module ごと別の非公開
verifier image にだけ載せます（Issue 537/543 option B2）。Workbench はこの deploy の公開値を
Compose 内部 network 上の verifier の `GET /public` から取得します。`reference/` と
`mutation.py` は `author` stage にだけ追加します。

host の `127.0.0.1:18138` に公開するのは Workbench だけで、verifier に host port はありません。
両 service は non-root、read-only filesystem、capabilities なし、no-new-privileges、
メモリ・PID 上限つきで動きます。checkpoint は echo した id しか加点できません。結果は期待値を
漏らしません。fixture はこの deploy の seed 由来なので、暗記した答えは持ち越せません。

これは自習と誠実な練習を支えます。競技順位・試験・修了判定は**支えません**。
それらには participant が一切管理しない verifier が必要で、
[#271](https://github.com/susumutomita/TenkaCloudChallenge/issues/271) で追跡しています。

## コスト

ゼロです。クラウドアカウントも AWS リソースも使いません。

## 作問者向け

`make reference-test` が mutation suite を実行します。壊した reference 13 種類（位相で内積を
足す、テスト多項式の中央寄せを忘れる、round を // にする、idx を % n にする、c(i) の負側を
忘れる、掃引を平文空間全体に広げる、…）を hidden suite が落とすこと — % n と負側忘れの 2 つは
clean な deploy の index が n を跨がないため、deploy の値ではなく行き過ぎ probe で仕留めます —
と、verifier を狙った near-miss 13 種類（画面に出ている値、別の行の値、f(m) の欄に平文、長さの
違う組、真偽値、別 deploy の答え）を値の採点器が拒否することを確かめます。participant image に
`fixtures/` が無いため、`make test` と `make inspect` は Compose 経由で動き、公開値は verifier の
`GET /public` から来ます。
