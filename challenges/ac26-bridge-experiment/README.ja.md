# 予測してから走らせる

> このトラックは Advanced Cryptography Program 2026 の非公式・独立した companion です。講座および
> その運営者とは提携しておらず、承認も受けていません。問題文、コード、fixture、図はすべて独自に
> 作成しています。このトラックに関する質問は講座運営ではなく TenkaCloud リポジトリへお願いします。

**Track:** `advanced-cryptography-2026` · **Order:** 10 · **Chapter:** Bridge 0 / Experimental
Workflow · **Role:** `diagnostic` · **想定時間:** 20〜30 分 · **配点:** 100

## なぜこの問題があるのか

普通の整数は「大きさ」で喋ってしまいます。足し算の結果が 5000 だと分かれば、何回足したのかの見当が
ついてしまう。大きさそのものが手がかりだからです。`mod 17` で計算すると、答えは必ず 0〜16 のどれかに
なります。大きさからは何も読み取れない。暗号が数を有限に閉じ込めるのは、この漏れを消すためであり、
このトラックの以降がほぼすべて「mod 何か」で書かれている理由でもあります。

その最も単純な形が、これから完成させるカウンタです。`start` から `step` を `rounds` 回足し、毎回
mod で折り返しながら輪の上を歩く。プログラムはそれだけです。

ただしこれはまだ暗号になりません。そして、ならない理由をここで見ておく価値があります。この歩き方は
逆算できてしまいます。最終値さえ分かれば、`step` に掛けると mod で 1 になる数を求めて掛け直すだけで、
歩数が戻ってくる。`inspect` が自分のデプロイの walk で実際にやって見せます。大きさの漏れは塞げても、
抜け道はまだ空いたままです。

だから Week 3 は、この歩き方をそのまま残して、歩く対象のほうを楕円曲線に替えます。点を自分自身に
足していく操作は同じですが、そちらでは歩数の逆算が現実的にできない。署名が意味を持つのは、ひとえに
その差のためです。ここはその差を最も安く見に行ける場所です — 逆算を自分の手で 1 行で回せるので。

7 週間続く暗号の輪読会に参加することになった、と考えてください。ノート PC を渡す人はこう言います。
「ここでは当てずっぽうでデバッグしない。何が起きるかを先に言って、それから走らせる。その差分が学びだ」。
そのためこの問題は、実行前に値を予測すること、trace を読んで最初に壊れた場所を言うこと、見たことのない
入力でも成立するコードを書くことも同時に要求します。この後の全問題は、あなたがすでにそう働くことを
前提に置いています。

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

Participant Portal で問題を起動し、表示された **Browser Workbench** を開きます。`inspect`、
`counter.py` の編集、公開テスト、`prepare` までブラウザ内で完結します。ホスト側のターミナルや
checkout のファイル操作は必要ありません。

`inspect` は証拠を表示するコマンドの名前です。同じ名前の checkpoint はないので、この文書で
`inspect` と書いてあれば必ずコマンドのほうを指します。

編集するのは `local/starter/counter.py` の 1 ファイルです。`advance(start, step, rounds, modulus)`
は trace を返します。各 round 後の値を、**毎 round** 剰余を適用して、`step` の符号によらず常に
`[0, modulus)` に収めます。

リポジトリから直接作問・検証する場合だけ、同じ 4 つが問題ディレクトリの make target としても
使えます。

```bash
make inspect             # 自分の fixture、health token、逆算できる walk、壊れた trace
make test                # 公開テスト
make test-one ID=range   # 反復中に 1 つのテストだけ再実行する
make reset               # starter/counter.py を元に戻す
```

## 採点

4 つの checkpoint を独立に採点します。誤答は 1 回 5 点減点です。

4 つのうち 2 つは Workbench の `prepare` が値を作ってくれるので、それを写します。残りの 2 つは
自分で求めて Portal へ直接入力します。問題側はこの 2 つを計算しません。意図的にそうしています。

| Checkpoint | 配点 | 値の出どころ | 提出するもの |
|---|---:|---|---|
| `environment` | 20 | `prepare` | health token をそのまま |
| `predict` | 25 | **自分で計算して手入力** | 最後の round の後の値を整数 1 個で。走らせる**前**に求めます |
| `first-broken` | 25 | **自分で読んで手入力** | 壊れた trace が最初に `[0, modulus)` を外れる 0 始まりの index を整数 1 個で |
| `generalize` | 30 | `prepare` | 自分の `counter.py` 全文。見たことのないパラメータで検証されます |

hint は `first-broken` に 1 つ (10 点)、`generalize` に 2 つ (10 点・5 点) あります。すべて開いても
100 点中 75 点が残ります。

`predict` について。先にコードを走らせて答えを写せば簡単に通ります。誰にも咎められません。ただし
この checkpoint が測っている唯一のものも同時に失われます。これが効くのは、暗号は出力を見ても正しさが
分からないからです。壊れた暗号文ももっともらしいバイト列に見えるし、穴のある回路も正直な witness なら
通ってしまう。走らせる前に「何が成り立つべきか」を決めておくこと以外に、どちらも見えるようにする
方法がありません。失敗しても安いのは、このトラックではこの問題だけです。

## この問題が扱っているもう 1 つのこと

公開テストは、間違った実装でも通ります。

公開テストは正の step の fixture を 1 つしか使いません。負の結果を正規化しない実装でも通りますし、
一部の round で剰余適用を飛ばす実装でも通ります。hidden test は複数 modulus・負の step・zero step・
modulus より大きい start・zero rounds を使い、さらに固定値ではなく**関係**を検査します。1 回分の
出力を覚えても通りません。

「テストが緑」と「コードが正しい」の間にあるこの隙間が、このトラック全体が立脚する作法です。
Week 1 では「充足しているが under-constrained な constraint」として、Week 3 では「無限遠点以外では
動く曲線演算」として、Week 5 では「例では budget 内だが他では溢れる noise」として再登場します。

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

ゼロです。クラウドアカウントも AWS リソースも使いません。手元のコンテナだけです。

## 作問者向け

`make reference-test` が mutation suite を実行します。reference を 7 通りに壊して hidden test が
すべて検出することを確認し、加えて verifier 自体を狙った 2 つの mutation も検証します。

一見それらしい mutation を 2 つ、意図的に**除外**してあります。末尾で一括して剰余を取る実装と、
`start` を事前正規化しない実装は、Python の floored `%` の下で reference と数学的に同値であり、
正しいテストでは区別できません。詳細は `local/mutation.py` 冒頭のコメントにあります。

`corrupted_trace` は「剰余を飛ばす round」を、実際に wrap する round の中から選びます。無条件に
選んでも同じに見えますが、同じではありませんでした。飛ばした round が wrap しない round だと、
壊れた trace は clean な trace と一致し、`[0, modulus)` を外れる entry が 1 つも出ません。つまり
`first-broken` は、seed のおよそ半数で答えの存在しない設問でした。公開テストが 200 seed でこの
性質を固定しています。

この問題の `courseAlignment` は `week: 1` (Bridge 0 は Week 1 の門) を宣言し、`sources[]` を
**持ちません**。これは記載漏れではなく意図的です。引用しうる upstream 資料は `week0/slide.pdf` だけ
ですが、`curriculum.md` はこれを対象外と記録しています。どの週の README からも参照されておらず、
このトラックは mapping も参照も派生もしません。schema はまさにこの場合のために `sources` を任意に
しています。埋めるために commit SHA を捏造してはいけません。詳細は
`docs/curricula/advanced-cryptography-2026/GOVERNANCE.md` §5 を参照してください。
