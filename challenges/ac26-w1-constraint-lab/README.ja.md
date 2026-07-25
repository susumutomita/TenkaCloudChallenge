# 0 になるべき式の集まり

> このトラックは Advanced Cryptography Program 2026 の非公式・独立した companion です。講座および
> その運営者とは提携しておらず、承認も受けていません。問題文、コード、fixture、図はすべて独自に
> 作成しています。このトラックに関する質問は講座運営ではなく TenkaCloud リポジトリへお願いします。

**Track:** `advanced-cryptography-2026` · **Order:** 110 · **Chapter:** Week 1 / Arithmetic
Circuits · **Role:** `mechanism` · **想定時間:** 45〜60 分 · **配点:** 200
· **推奨前提:** `ac26-bridge-experiment`、`ac26-bridge-properties`

## ストーリー

新しい policy engine は if 文でアクセスを判断しません。判断を算術回路として表現します。そうすれば、
判断を下したサービスを信用しなくても、後から誰でも監査できるからです。

素晴らしい設計です。ただし monitor は 1 行しか出しません。`PASS` か `FAIL` かです。リクエストが拒否
され、誰かが「なぜ」と尋ねたとき、答えられる人がいません。あなたはその監査ツールを完成させます。

## この問題の主題

回路はプログラムではありません。**すべて 0 でなければならない式の集合**です。witness は各 signal へ
値を割り当てたものにすぎません。「この witness は回路を充足する」とは、すべての residual が 0 である
ということで、どれかが 0 でないとき、residual はどの主張が壊れたのかを教えてくれます。

制約は 5 種類、すべて `F_p` 上で評価します。

```text
mul      left * right - out
add      left + right - out
const    signal - value
boolean  signal * (signal - 1)
member   allowed の各要素との差の積
```

## 遊び方

```bash
make inspect              # 自分の field、circuit、正しい witness、壊れた witness
make test                 # 公開テスト
make test-one ID=trace    # 1 つだけ再実行する
make reset                # starter 3 ファイルを元に戻す
```

編集するのは 3 ファイルです。`local/starter/field.py` (F_p の演算)、
`local/starter/circuit.py` (residual と trace)、`local/starter/gadgets.py` (条件を制約へ変換)。

## 採点

5 つの checkpoint を独立に採点します。誤答は 1 回 10 点減点です。

| Checkpoint | 配点 | 何を検査するか |
|---|---:|---|
| `residuals` | 45 | 3 つの異なる素数、順序の入れ替え、signal 欠落での評価器 |
| `first-broken` | 40 | 壊れた witness で最初に違反する constraint の id |
| `boolean` | 40 | boolean gadget を field の**全要素**で総当たり |
| `membership` | 35 | membership gadget を全要素で総当たり (許可集合サイズ 1〜5) |
| `transfer` | 40 | 3 ファイルを、見たことのない seed 由来の field と circuit で実行 |

hint は 5 つ中 4 つにあります (15 / 15 / 10 / 10)。すべて開いても 200 点中 150 点が残ります。

## 公開テストでは落ちない 3 つの間違い

1. **`-1` は 0 ではなく、`p-1` も 0 ではありません。** 両者は同じ元です。引き算の結果をそのまま返す
   評価器は、中間値が負になった瞬間に壊れます。
2. **signal を `flag` と名付けても boolean にはなりません。** 値を縛るのは制約だけです。boolean
   checkpoint が field 全体を走査するのはこのためで、`2` だけを試す test なら「`b < 2` を検査する」
   実装でも通ってしまいます。
3. **正しい witness が 1 つ通っても何も示せません。** 制約が足りない回路でも、正直な witness では
   全 residual が 0 になります。`allowed[0]` だけを固定する membership gadget は、公開例がたまたま
   その値のときに通ります。

## 公式 Week 1 課題との関係

これは `mechanism` 問題です。公式課題が前提とする読解力を作り、意図的にその手前で止まります。公式課題
は underconstraint を突きますが、そのためには「どの条件がどの式になっているか」を見られる必要があり、
それがここで作る trace です。講座の式・fixture・solution は一切転載していません (`GOVERNANCE.md` §2)。

## コスト

ゼロです。クラウドアカウントも AWS リソースも使いません。手元のコンテナだけです。

## 作問者向け

`make reference-test` が mutation suite を実行します。壊した提出 6 種類と verifier を狙った 1 種類が
あり、すべて検出される必要があります。壊れた witness の混入位置は `c2` か `c3` で、`c0` は選びません。
「リストの先頭」と答えて偶然当たる状態にしないためです。
