# 予測してから走らせる

> このトラックは Advanced Cryptography Program 2026 の非公式・独立した companion です。講座および
> その運営者とは提携しておらず、承認も受けていません。問題文、コード、fixture、図はすべて独自に
> 作成しています。このトラックに関する質問は講座運営ではなく TenkaCloud リポジトリへお願いします。

**Track:** `advanced-cryptography-2026` · **Order:** 10 · **Chapter:** Bridge 0 / Experimental
Workflow · **Role:** `diagnostic` · **想定時間:** 20〜30 分 · **配点:** 100

## ストーリー

7 週間続く暗号の輪読会に参加することになりました。初回講義の前に、誰かがノート PC を差し出して
こう言います。「ここでは当てずっぽうでデバッグしない。何が起きるかを先に言って、それから走らせる。
その差分が学びだ」。

そして建物内で最も面白くないプログラムを渡されます。ある数を何度も足すだけの、剰余付きカウンタです。

暗号の問題ではありません。それが狙いです。この後の全問題は、実行前に値を予測すること、trace を読んで
最初に壊れた場所を言うこと、見たことのない入力でも成立するコードを書くことを要求します。この 3 つの
作法を楕円曲線と同時に習得しようとすると、どちらも身につきません。

## 何がデプロイされるか

コンテナが 1 つだけです。クラウドアカウントも、外部ネットワーク面もありません。

```text
local/
├── starter/counter.py    ← 編集するのはこのファイルだけ
├── fixtures/generate.py     全 fixture を deploy ごとの seed から導出する
├── tests/public/            読めるテスト
├── tests/hidden/            verifier が実行するテスト (image 内のみ)
├── reference/               解答 (image 内のみ。host へは mount しない)
├── verifier/server.py       POST /verify。127.0.0.1:18091
└── mutation.py              hidden test が誤答を本当に落とせるかを証明する
```

fixture は deploy 時に注入される `FLAG_SEED` から導出されます。同じ seed なら同じ数値なので、
自分のセッションは再現でき、デバッグできます。seed が違えば数値も変わるので、他の人の実行結果から
写した値は役に立ちません。

## 遊び方

```bash
make inspect             # 自分の fixture、health token、壊れた trace
make test                # 公開テスト
make test-one ID=range   # 反復中に 1 つのテストだけ再実行する
make reset               # starter/counter.py を元に戻す
```

`local/starter/counter.py` を開きます。`advance(start, step, rounds, modulus)` は trace を返します。
各 round 後の値を、**毎 round** 剰余を適用して、`step` の符号によらず常に `[0, modulus)` に収めます。

## 採点

4 つの checkpoint を独立に採点します。誤答は 1 回 5 点減点です。

| Checkpoint | 配点 | 提出するもの |
|---|---:|---|
| `environment` | 20 | `make inspect` が出す health token |
| `predict` | 25 | 走らせる**前**に紙で求めた最終値 |
| `inspect` | 25 | 壊れた trace が最初に `[0, modulus)` を外れる 0 始まりの index |
| `generalize` | 30 | 自分の `counter.py`。見たことのないパラメータで検証されます |

hint は `inspect` に 1 つ (10 点)、`generalize` に 2 つ (10 点・5 点) あります。すべて開いても
100 点中 75 点が残ります。

`predict` について。先にコードを走らせて答えを写せば簡単に通ります。誰にも咎められません。ただし
この checkpoint が測っている唯一のものも同時に失われます。失敗しても安いのは、このトラックでは
この問題だけです。

## この問題が本当に扱っていること

公開テストは、間違った実装でも通ります。

公開テストは正の step の fixture を 1 つしか使いません。負の結果を正規化しない実装でも通りますし、
一部の round で剰余適用を飛ばす実装でも通ります。hidden test は複数 modulus・負の step・zero step・
modulus より大きい start・zero rounds を使い、さらに固定値ではなく**関係**を検査します。1 回分の
出力を覚えても通りません。

「テストが緑」と「コードが正しい」の間にあるこの隙間が、このトラック全体が立脚する作法です。
Week 1 では「充足しているが under-constrained な constraint」として、Week 3 では「無限遠点以外では
動く曲線演算」として、Week 5 では「例では budget 内だが他では溢れる noise」として再登場します。

## コスト

ゼロです。クラウドアカウントも AWS リソースも使いません。手元のコンテナだけです。

## 作問者向け

`make reference-test` が mutation suite を実行します。reference を 7 通りに壊して hidden test が
すべて検出することを確認し、加えて verifier 自体を狙った 2 つの mutation も検証します。

一見それらしい mutation を 2 つ、意図的に**除外**してあります。末尾で一括して剰余を取る実装と、
`start` を事前正規化しない実装は、Python の floored `%` の下で reference と数学的に同値であり、
正しいテストでは区別できません。詳細は `local/mutation.py` 冒頭のコメントにあります。

この問題の `courseAlignment` は `week: 1` (Bridge 0 は Week 1 の門) を宣言し、`sources[]` を
**持ちません**。これは記載漏れではなく意図的です。引用しうる upstream 資料は `week0/slide.pdf` だけ
ですが、`curriculum.md` はこれを対象外と記録しています。どの週の README からも参照されておらず、
このトラックは mapping も参照も派生もしません。schema はまさにこの場合のために `sources` を任意に
しています。埋めるために commit SHA を捏造してはいけません。詳細は
`docs/curricula/advanced-cryptography-2026/GOVERNANCE.md` §5 を参照してください。
