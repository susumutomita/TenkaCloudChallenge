# 先に聞かれたら、何でも通せる

> このトラックは Advanced Cryptography Program 2026 の非公式・独立した companion です。講座および
> その運営者とは提携しておらず、承認も受けていません。問題文、コード、fixture、図はすべて独自に
> 作成しています。このトラックに関する質問は講座運営ではなく TenkaCloud リポジトリへお願いします。

**Track:** `advanced-cryptography-2026` · **Order:** 420 · **Chapter:** Week 4 /
Commit–Challenge–Open · **Role:** `transfer` · **想定時間:** 60〜90 分 · **配点:** 300
· **必須前提:** `ac26-w4-arithmetization` · **Status:** draft — 後述の「Week 4 の対応づけ」を参照

## ストーリー

証明系の骨格は 3 手です。

```text
1. prover がデータに commit する
2. verifier が何を聞くか選ぶ
3. prover がその箇所を open する
```

1 と 2 を入れ替えると、protocol は何も証明しません。正しい版を作ったあと、その攻撃を自分で実演し
ます。`adaptive` checkpoint で構成する vector は 16 要素中 15 要素が嘘で、それでも開示は検証を通り
ます。

## 葉に何が入っていなければならないか

| binding されるもの | 無いと |
|---|---|
| **index** | 葉が「どこから来たか」を主張しない |
| **フィールドの区切り** | `(1, 23)` と `(12, 3)` がどちらも "123" になる |
| 各段の **方向** | verifier が 2 通りに hash でき、prover が選べる |

区切り無しの弱い符号化は **fixtures 側**にあり、あなたのファイルにはありません。自分で弱くした
コードを自分で破るのは反例ではないからです。

## 遊び方

```bash
make inspect            # vector、木、root、聞かれる index と path
make test               # 公開テスト
make reset              # starter/commit.py を元に戻す
```

編集するのは `local/starter/commit.py` の 1 ファイルです。

## 採点

8 つの checkpoint を独立に採点します。誤答は 1 回 15 点減点です。

| Checkpoint | 配点 | 何を検査するか |
|---|---:|---|
| `encoding` | 35 | index と値の binding、2 組が衝突しないこと、節点の順序依存 |
| `root` | 30 | commitment と、並べ替えで変わること |
| `opening` | 45 | 正直な開示の受理と、値・index・方向・長さ・範囲の拒否 |
| `order` | 40 | commit 前の challenge、challenge 前の open の拒否 |
| `adaptive` | 45 | challenge が先に来る場合の反例 |
| `ambiguity` | 40 | 弱い符号化で衝突し、自分の符号化では衝突しない 2 組 |
| `transcript` | 35 | challenge が commitment・domain・statement に依存すること |
| `transfer` | 30 | 見たことのない長さ・query・seed での再実行 |

hint は 8 つ中 5 つにあり、いずれもその checkpoint の 50% 上限内です。

## 等価変異について

`verify_opening` の index 範囲検査と path 長検査は、**外しても検出できません**。`LEAF_TAG` と
`NODE_TAG` があるので葉のハッシュと節点のハッシュが一致することはなく、長さの違う path は root と
異なる値に再計算されて比較で落ちるからです。mutation suite には入れていません。

代わりに `Session.receive_challenge` の範囲検査を変異させています。こちらは負の index が黙って
巻き戻り、聞かれていない行が開示されるので検出できます。

殺せない変異を一覧に残すと、「SURVIVED は無視してよい」を教えることになります。だから残しません。

## これは polynomial commitment ではありません

Merkle root は**列**に commit します。多項式の評価を証明するものではなく、1 箇所の開示は聞かれ
なかった行について何も言いません。query は 1 回だけなので、当てずっぽうの prover は `1/length` で
勝ちます。健全性の増幅は範囲外です。

## binding と hiding は別です

Merkle root は **binding** を与えます。**hiding** は与えません。値の空間が小さければ、root から
中身を総当たりで復元できます。隠したければ葉ごとに randomness が要ります。

## Week 4 の対応づけ

Week 4 の教材は pinned commit の時点で未公開です。`courseAlignment` は `week4/README.md` を
`kind: "placeholder"` で pin し、role は `transfer` です。`GOVERNANCE.md` §6 が未公開週の companion
に許す 2 つの role のうちの 1 つで、公式課題が何を要求するかについては何も主張していません。#229 が
教材公開時に対応づけを確定します。

## コスト

ゼロです。クラウドアカウントも AWS リソースも使いません。

## 作問者向け

`make reference-test` が mutation suite を実行します。壊した実装 9 種類があり、そのすべてが commit・
challenge・open・verify を成功させます。違いは、そのあと攻撃者に何ができるかだけです。
