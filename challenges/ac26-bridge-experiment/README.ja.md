# ずれた計数器

**Advanced Cryptography 2026** companion track の Bridge 0。このチャレンジに暗号は
出てこない。出てくるのは、以後のチャレンジがすべて「もう身についている」前提にする
ループである — 観察し、予測を書き、実行し、突き合わせ、最初にずれた場所を見つける。

> TenkaCloud のこのトラックは Advanced Cryptography Program 2026 の学習者向けに
> 独立して作られた非公式の補助教材です。講座運営とは無関係で、公式教材の解答は
> 含みません。

## はじめに

小さな計数器がある。`start` から始めて、round ごとに `step` を足し、そのたびに値を
`[0, modulus)` へ丸め直して記録していく。round `i` (1 起算) で記録される値は

```text
(start + step * i) を [0, modulus) へ丸めた値
```

題材はこれだけである。すでに理解できているものを意図的に選んでいる。ここで練習する
のは数学ではなく、方法そのものだからである。

## 最初の一手

```bash
cd local
docker compose up -d --wait
make test
```

`make test` は Python の version と、この環境固有の marker を印字する。まだ何も
実装していなくても動く — これは意図したもので、「ラボが壊れている」と「まだ実装して
いない」が同じ見え方にならないようにしている。

続いて:

```bash
make inspect
```

round ごとの値、checkpoint 2 用の parameter、checkpoint 3 用の published trace を
印字する。

## ゴール

`local/solution/counter.py` の `advance()` を実装する。編集するのはこの 1 ファイル
だけである。

```python
def advance(start: int, step: int, rounds: int, modulus: int) -> list[int]:
    ...
```

`rounds` 個の記録値を順番に、それぞれ `[0, modulus)` の中に収めて返す。

## 採点

4 つの checkpoint を、loopback の `/verify` 経由で独立に採点する。

| checkpoint | 点 | 提出するもの |
| --- | ---: | --- |
| `environment` | 10 | `make test` が印字した marker |
| `predict` | 30 | predict case で、**最後の round** が記録する値 |
| `first-divergence` | 30 | published trace で、最初に規則が破れる round 番号 (1 起算) |
| `general-counter` | 30 | 提出値は使わない。`counter.py` 自体が未公開 case で走る |

参加者ポータルから提出するか、直接叩く:

```bash
curl -s -X POST http://127.0.0.1:18311/verify \
  -H 'Content-Type: application/json' \
  -d '{"checkpointId":"predict","submission":"12"}'
```

応答は送った `checkpointId` をそのまま返す。打ち間違いが「不正解」として黙って
処理されず、目に見えるようにするためである。

## この 4 つがこの順に並んでいる理由

**`predict` は実行する前に答えさせる checkpoint である。** predict case の parameter
は公開 case と違うので、先に動かして出力を写しても通らない。予測を先に書いておく
ことが、予測と実測の差を情報に変える。

**`first-divergence` は最終値からは解けない。** published trace は 1 round だけ規則
を破っており、その後ろの round は壊れた値を出発点として規則どおりに進む。だから
tail は自己整合している。先頭から隣り合う値を突き合わせることになる。

**`general-counter` は答えではなく code を走らせる。** 未公開の case を使う。公開
case 1 件に合う実装と、定義に合う実装は別物であり、この checkpoint はその差が出る
場所である。

## participant contract

以下の 4 target は、AC26 のどのチャレンジでも同じ意味を持つ。

```bash
make test      # 公開テスト — 反復中に回すもの
make inspect   # 中間値と published trace
make reset     # solution/ を初期状態へ戻す
make shell     # ラボ container 内の shell
```

`make reference-test` は用意していない。reference 実装は image 内にあり、host へ
展開されることはない。

## 安全境界

- 2 つの port はどちらも `127.0.0.1` に bind されている。このマシンの外へは出ない。
- `solution/` は read-only mount。verifier は import する前に private な一時
  workspace へ copy するので、検証が source tree へ書き込むことはなく、実行中の
  編集で内容が変わることもない。
- 提出 code は spawn した別 process で、10 秒の wall-clock kill 付きで実行される。
  無限ループはその checkpoint が失敗するだけで、ラボは止まらない。`fork` ではなく
  `spawn` なので、子 process は期待値を引き継がない。
- container は read-only、非 root、`cap_drop: ALL`、`no-new-privileges`、memory /
  CPU / process 数に上限がある。

container は**ネットワークに出られる**。published port は routable な network 経由
で DNAT する必要があり、bridge はインターネットに到達する。ここには参加者に対して
秘密にしているものが無いので、出られないという主張はしていない。

## コスト

ゼロ。ローカル container 1 つだけで、クラウドアカウントも AWS リソースも使わない。

## parameter についての注意

値が読みやすいように modulus は小さくしてある。暗号的な安全性とは無関係であり、
このトラックの以後のチャレンジで扱う toy parameter も同様である。
