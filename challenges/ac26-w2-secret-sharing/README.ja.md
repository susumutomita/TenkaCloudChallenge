# 分けても、まだ何も分からない

> このトラックは Advanced Cryptography Program 2026 の非公式・独立した companion です。講座および
> その運営者とは提携しておらず、承認も受けていません。問題文、コード、fixture、図はすべて独自に
> 作成しています。このトラックに関する質問は講座運営ではなく TenkaCloud リポジトリへお願いします。

**Track:** `advanced-cryptography-2026` · **Order:** 210 · **Chapter:** Week 2 / Additive Secret
Sharing · **Role:** `mechanism` · **想定時間:** 40〜60 分 · **配点:** 200
· **Status:** draft — 後述の「Week 2 の対応づけ」を参照

## ストーリー

5 人の監査人が、互いの帳簿の数字を知られずに合計を出す必要があります。ホワイトボードの計画は単純です。
各数値を人数分に分け、全部を足したときだけ意味を持つようにする、というものです。

分割はもう誰かが書いています。足せば正しく合います。そして、書かれているままでは役に立ちません。
「足せば合う」と「秘密を守る」の差が、この問題のすべてです。

## 考え方

`F_p` 上の加法的分散です。秘密 `s` を、和が `s` になる `n` 個の値にします。算術は 3 行で終わります。
これを暗号にしているのは、**そのうち任意の n-1 個が秘密と独立である**という性質のほうで、これは主張
するものではなく、示すものです。

## 遊び方

```bash
make inspect            # 自分の設定と、n-1 人が互いに見せ合ったときに見えるもの
make test               # 公開テスト
make reset              # starter/sharing.py を元に戻す
```

編集するのは `local/starter/sharing.py` の 1 ファイルです。`share()`・`reconstruct()`・
`complete_shares()`・`rerandomize()`。

## 採点

5 つの checkpoint を独立に採点します。誤答は 1 回 10 点減点です。

| Checkpoint | 配点 | 何を検査するか |
|---|---:|---|
| `share-and-reconstruct` | 50 | 4 つの設定での round trip、**および**自明な分割でないこと |
| `hides-the-secret` | 45 | 補完が field の**すべての**秘密に対して成功すること |
| `threshold` | 45 | 必要数と、2 つの証人 |
| `rerandomize` | 30 | 秘密が保たれ、全 share が動くこと |
| `transfer` | 30 | 未知の modulus と人数での再実行 |

hint は 5 つ中 3 つにあります (20 / 20 / 15)。すべて開いても 200 点中 145 点が残ります。

## この問題を支える 2 つの checkpoint

**`hides-the-secret`** は field 全体を走査します。同じ n-1 個を持ったまま、**どの秘密に対しても**
辻褄の合う最後の 1 個を作れるなら、その n-1 個は秘密の証拠になっていません。これが「漏れない」の
実行可能な定義であり、どれだけ文章で説明するより強い証拠です。

**`threshold`** は数字だけでは通りません。必要数**と**、同じ n-1 個と両立する相異なる 2 つの秘密を
提出します。数を当てるのは簡単ですが、2 つの証人を作るのは理解が要ります。

## 公開テストが教えてくれないこと

公開テストは round trip を見ます。部分集合が何かを隠しているかは一度も問いません。そのため自明な
分割 (party 0 に秘密をそのまま渡し、残りを 0 にする) はきれいに通ります。party 0 は最初から全部
知っているのにです。hidden test はこのケースを名指しで落とします。

## Week 2 の対応づけ

Week 2 の教材は、`curriculum.md` が記録している commit の時点で**未公開**です。そのためこの問題は
`week2/README.md` を `kind: "placeholder"` で pin します。これは対応づけではなく、その commit 時点で
教材が存在しなかったという事実の記録です。`status` は `draft` のままです。

この pin があることで `bun run course:drift` は教材公開の日に `DRIFT` ではなく `PUBLISHED` を報告
できます。その後 Week 2 の course-sync issue が計画行とこの問題の対応づけを確定し、draft を外します。

## コスト

ゼロです。クラウドアカウントも AWS リソースも使いません。

## 作問者向け

`make reference-test` が mutation suite を実行します。壊した提出 6 種類と verifier を狙った 1 種類が
あります。そのうち 1 つ、`reconstruct` が剰余を忘れる変異は、**hidden test の初版では生き残りました**。
`check_roundtrip` が比較の前に learner の答えを正規化していたためです。現在は正準元であることを要求
しています。mutation suite が、提出ではなくテストのほうを検査した例です。
