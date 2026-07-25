# 掛け算は 5 回、通信は 1 回

> このトラックは Advanced Cryptography Program 2026 の非公式・独立した companion です。講座および
> その運営者とは提携しておらず、承認も受けていません。問題文、コード、fixture、図はすべて独自に
> 作成しています。このトラックに関する質問は講座運営ではなく TenkaCloud リポジトリへお願いします。

**Track:** `advanced-cryptography-2026` · **Order:** 250 · **Chapter:** Week 2 / Private
Aggregation Synthesis · **Role:** `synthesis` · **想定時間:** 75〜105 分 · **配点:** 300
· **必須前提:** `ac26-w2-privacy-audit` · **Status:** draft — 後述の「Week 2 の対応づけ」を参照

## ストーリー

複数の組織が incident について情報交換をしています。うまくいっていません。昼食の席で、一般論として、
誰も最初に数字を言おうとしないからです。彼らが本当に欲しいのは 1 つの数値です。

```text
score = Σ_i (count_i * severity_i) + bias        （bias は公開、mod p）
```

積の両側が秘密で、しかも別々の人が持っています。この式が Week 2 のすべてです。

## 何を作るのか

公開はすべて 1 つのハンドルを通ります。

```python
io.open_batch([sharing_a, sharing_b])   # -> [value_a, value_b]   1 round
io.open_batch([sharing_a])
io.open_batch([sharing_b])              # -> 同じ値               2 rounds
```

1 回の呼び出しが 1 round です。何をどうまとめるかは設計判断であり、主張ではなく**実測**で採点され
ます。

## 遊び方

```bash
make inspect            # 設定と、渡されるものの形
make test               # 公開テスト
make reset              # starter/aggregate.py を元に戻す
```

編集するのは `local/starter/aggregate.py` の 1 ファイルです。

## 採点

8 つの checkpoint を独立に採点します。誤答は 1 回 15 点減点です。

| Checkpoint | 配点 | 何を検査するか |
|---|---:|---|
| `plan` | 35 | 実装前に見積もった乗算数・triple 数・round 数 |
| `share-inputs` | 30 | party 数ぶんの正規形 share と、秘密への復元 |
| `linear` | 30 | 公開定数を 1 party だけが畳み込む |
| `multiply` | 55 | スコアが平文計算と一致する |
| `result` | 35 | 再 share・順序反転・入力の既知変化 |
| `privacy` | 40 | mask 差を公開し、それ以外を公開しない |
| `cost` | 35 | 見積もりと実測の一致 |
| `transfer` | 40 | 見たことのない seed での再実行 |

hint は 8 つ中 6 つにあり、いずれもその checkpoint の 50% 上限内です。

## 3 つの数のうち 2 つは同じ

組織が k 個なら乗算は k 回、triple も k 個です。しかし round は k 回では**ありません**。どの積の
`d` と `e` も他の積の結果に依存しないので、全部を 1 回の open にまとめられます。

乗算ごとに open する実装は正しく、privacy も保たれ、latency だけが k 倍になります。それがこの問題の
主題です。round 数は乗算の**深さ**で決まり、個数では決まりません。この式の深さは 1 なので、幅がいくら
増えても round は 1 のままです。深さ D の回路なら D round になります。

## triple の使い回しが correctness のバグではない理由

Beaver 乗算は c = a*b を満たす任意の triple で正しく動くので、同じ triple を全積に使ってもスコアは
合います。書けるどんな correctness test も通ります。

壊れるのは privacy です。1 つの `a` が `x₁` と `x₂` の両方を覆うと、open された `d₁ - d₂` は
`x₁ - x₂` そのもの、つまり秘密の差が transcript に載ります。

hidden test は open された値の多重集合を、供給された triple が含意する mask 差と厳密に照合します。
blacklist ではなく完全一致なので、「別の積の triple を使った」「余計に何か出した」「足りない」を
1 つの検査で捕まえます。

## correctness・privacy・cost を別々に採点する理由

実装は「正しいが高い」「正しいが漏れる」「安全だが誤り」のいずれにもなり得ます。1 つの verdict に
まとめると、自分がどれを作ったのか分かりません。だから 3 つの checkpoint に分けてあります。

## 公開した出力から定義上漏れるもの

score を公開すると決めた時点で、score から導けることは公開されます。k = 1 なら `score - bias` は
その組織の積そのものです。k が小さく severity の範囲が狭ければ、count の候補はかなり絞れます。

MPC が保証するのは**計算過程**が追加の漏洩を生まないことです。出力から何も分からないことは保証
しません。それが必要なら、出力の摂動や閾値化といった別の仕組みが要ります。

## threat model

honest-but-curious、collusion なし、toy field、手で検算できる大きさの値。security の主張でも、実運用
のモデルでもありません。

## Week 2 の対応づけ

Week 2 の教材は `curriculum.md` が記録している commit の時点で未公開です。`courseAlignment` は
`week2/README.md` を `kind: "placeholder"` で pin し、`status` は `draft` のままです。この pin は
対応づけではなく、その commit 時点で教材が存在しなかったという事実を記録します。これにより
`bun run course:drift` は教材公開の日に `PUBLISHED` を報告できます。#219 が対応づけを確定してから
draft を外します。

## コスト

ゼロです。クラウドアカウントも AWS リソースも使いません。

## 作問者向け

`make reference-test` が mutation suite を実行します。壊した実装 9 種類があります。うち 2 つ
（triple の使い回しと、乗算ごとの open）は**完全に正しいスコアを返します**。答えだけを見る suite なら
両方とも通ってしまい、この問題は算術を採点しているだけになります。
