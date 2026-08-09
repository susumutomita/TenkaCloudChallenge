# 選んだことを言わずに、選ぶ

> English: [README.md](./README.md)

Week 2 の 5 問目。 track `advanced-cryptography-2026`、 order 260。

Week 2 のここまでの問題は、 すべて 「c = a·b を満たす三つ組が前もって配られている」 ところから
始まっている。 その三つ組を誰がどう作るのかは、 どこにも書かれていない。 互いに何も預けていない
2 者が、 そもそもどうやって一緒に計算を始めるのか。

oblivious transfer がその最小の答え。 送信者は 2 つのメッセージを出し、 受信者は 1 つだけ受け取る。
受信者は他方について何も知らず、 送信者はどちらが取られたかを知らない。 これがあれば、 互いに
信用していない 2 者の間で任意のブール回路が計算できる。 この問題の後半がそれ。

## 作るもの

**Part 1 — 転送そのもの。** `Z_p*` の位数 `q` の部分群で、 送信者が `A = g^a` を公開する。 受信者は

```text
B = g^t          message 0 が欲しいとき
B = A * g^t      message 1 が欲しいとき
```

を送る。 送信者はこの 2 つを区別できないまま、 message 0 を `B^a` の鍵で、 message 1 を
`(B/A)^a` の鍵で暗号化して返す。 このうちちょうど一方が `A^t` に等しく、 受信者はそれを計算できる。
もう一方を得るには離散対数が要る。

**Part 2 — AND ゲート。** `x = x0 ^ x1`、 `y = y0 ^ y1` と 2 者に分かれているとき、

```text
(x0 ^ x1) & (y0 ^ y1)  =  x0y0 ^ x1y1 ^ x0y1 ^ x1y0
```

最初の 2 項は手元で計算できる。 残る 2 項がそれぞれ転送 1 回。 XOR は share に対して線形なので
転送が要らない。

## この問題の本題

**正しく動くのに相手へ秘密を渡してしまう実装が 2 箇所ある。** どちらも公開テストを通る。

- **受信者の blind。** ここでの privacy は**分布**についての主張で、 `B` が choice によらず
  同じに見える必要がある。 `t` を `0..q-1` 全体から取ればそうなる。 秘密の指数だからと反射的に
  `0` を外すと、 `B = 1` は choice 1 でしか、 `B = A` は choice 0 でしか起こらなくなる。
  q 個のうち 2 個が choice を名指しする。
- **ゲートの mask。** 2 つの出力 share を XOR すると mask は打ち消えるので、 1 つ引いても
  2 つ引いても復元は正しい。 1 つだと各 party の出力 share が相手の秘密ビットの関数になり、
  `x0 = 0, y0 = 1` を持つ party は `z0` からそのまま `x1` を読める。

どちらも 「メッセージが届いた」 「ゲートが復元した」 では捕まらない。 1 回の実行の性質では
ないため。

## 進め方

```bash
make inspect   # 自分の群、鍵、セッション、ゲートの share
make test      # 公開テスト: shape と、転送が 1 回成功すること
make reset     # starter/ を元に戻す
```

編集するのは `local/starter/oblivious.py` だけ。 `make reference-test` は作問側の経路で、
hidden と mutation の suite をイメージ内で回す。

## checkpoint

| id | 何を見るか | 配点 |
| --- | --- | --- |
| `request` | choice を公開鍵によるずらしとして符号化できているか | 30 |
| `choice-privacy` | 2 つの choice が同じ request 集合を生む範囲を選べているか | 40 |
| `transfer` | 片方だけが復号できるか | 35 |
| `and-gate` | 転送 2 回で AND を作り、 XOR は手元と判定できているか | 45 |
| `gate-privacy` | mask が独立で、 自分の view が相手の秘密で動かないか | 30 |
| `unseen` | 見たことのない seed でも通しで成立するか | 20 |

## 講座との対応

Advanced Cryptography Program 2026 の Week 2 に対応する companion で、 `week2/README.md` と
`week2/problems/toy-mpc/README.md` に pin している。 公式課題の **Part B (oblivious transfer と
GMW の秘密 AND)** に伴走する問題で、 この track の他の Week 2 問題はそこまで届いていない。
詳細は
[`docs/curricula/advanced-cryptography-2026/curriculum.md`](../../docs/curricula/advanced-cryptography-2026/curriculum.md)。

公式の解答、 テンプレート、 テストモジュールは読まずに書いている (`spoilerPolicy` は
`independent-reimplementation`)。

パラメータは読める程度に小さく、 実用にはまったく足りない。 この群の離散対数は数百回の試し算で
解ける。 失敗を観測可能にするための選択であって、 何かに耐えるためのものではない。
