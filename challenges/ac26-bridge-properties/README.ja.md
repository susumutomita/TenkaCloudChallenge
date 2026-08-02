# 満たす性質、破る性質

> このトラックは Advanced Cryptography Program 2026 の非公式・独立した companion です。講座および
> その運営者とは提携しておらず、承認も受けていません。問題文、コード、fixture、図はすべて独自に
> 作成しています。このトラックに関する質問は講座運営ではなく TenkaCloud リポジトリへお願いします。

**トラック:** `advanced-cryptography-2026` · **順序:** 20 · **章:** Bridge 0 / Security
Properties · **役割:** `diagnostic` · **所要:** 30〜45 分 · **配点:** 200
· **推奨前提:** `ac26-bridge-experiment`

## 物語

3 つの toy verifier が監査に持ち込まれました。書いたのは別々のチーム、どれも本番に出ていて、どれも
自分たちのテストは緑でした。あなたの仕事は「どれが壊れているか」を言うことではありません ── 全部
壊れています。**それぞれが今も保証しているものと、もう保証していないもの**を言い、その主張を一つ
残らず証明することです。

この区別がこの問題のすべてです。Week 1 以降、completeness / soundness / privacy /
zero-knowledge は「みんな意味が一致している」前提で使われます。定義の暗記は実物のプロトコルに接触
した時点で保ちません。ある性質だけを壊し、残りが無傷であることを示せる状態は保ちます。

## 主張

3 つの verifier はどれも同じ形の statement を渡されます。

```text
a*w + b == c  (mod p)   かつ   lo <= w <= hi   を満たす w を知っている
```

意図的に小さな整数演算です。証明系もライブラリもありません ── 考える対象はすべて 1 画面に収まる
ので、難しさは配管ではなく性質のほうにあります。

## 何がデプロイされるか

コンテナが 1 つです。AWS アカウントもクラウドリソースもインストールも要りません。このデプロイの
statement と verifier (デプロイごとの `FLAG_SEED` から導出されるので、他の人とは違う値です) と、
遊ぶための `review` コマンドが入っています。公開されるポートは platform が flag を POST する
loopback の `/verify` だけで、あなたが触ることはありません。

## 遊び方

portal で問題を起動し、**コンテナのターミナルに接続**してください。すべてそこで、1 行ずつ進みます。
編集するファイルも、開くエディタも、clone するものもありません。

```bash
review                            # コマンド一覧
review show                       # 主張・statement・3 つの verifier・次に打つコマンド
review run <verifier> <w>         # 無料: verdict と record を両 statement について表示
review reject <w>
review recover <w>
review forge <w>
review classify p1=<性質> p2=<性質> p3=<性質>
review transfer reject=<w> recover=<w> forge=<w>
review status                     # 通した段階
review flag                       # 5 段階すべて通ると TC{...}
```

`python /problem/review.py <command>` も同じものです。

`review show` は「それだけ読めば足りる」ように書いてあります。迷ったら何度でも戻ってください。

### `run` は無料で、そこが要点です

`review run` は verifier の verdict **と record** を両方の statement について表示し、何も記録しま
せん。採点されるのは提出だけで、run は採点されません。以下の反例はどれも、当てずっぽうで払うので
はなく実験で見つけるように作ってあります。

### 2 つの statement

panel には `main` と `edge` の 2 つの statement があります。edge のほうは honest witness が範囲の
**片方の端ちょうど**にあります。どちらの端かはあなたが見つけるもので、run を 2 回通せば決まります。
これは飾りではありません。範囲境界が strict なだけの verifier は、witness が範囲の内側にある
statement では正しい verifier と *1 入力たりとも* 挙動が違いません。

### 3 つの反例

| 段階 | 提出するもの |
|---|---|
| `reject` | statement が **真** である witness で、3 つのうち 1 つが拒否するもの |
| `recover` | honest run が使った値を、record から読み戻したもの |
| `forge` | statement が **偽** である witness で、3 つのうち 1 つが受理するもの |

### `classify` ── そのあとで

3 つの break が出揃ってから、各 verifier が**今も守っている**性質を言います。

```bash
review classify p1=sound,private p2=complete,private p3=complete,sound
```

示せないラベルは数えません。だからこの段階は反例が揃うまで開きません。そして実際に測っているものに
注意してください。あなたの反例で 9 マスのうち 3 マスはすでに埋まっています。問われているのは残りの
6 マスです ── ここにある verifier はどれも壊れていて、どれも 3 つのうち 2 つを今も保証しています。

### `transfer` ── 見たことのない panel で同じ 3 つ

4 段階を通すと 2 つ目の panel が渡されます。欠陥は別の verifier に載っており、strict な境界は範囲の
逆端にあり、合同式の使える側は逆で、record の数え方も逆です。問いは意図的に同じ 3 つのままです。
測っているのは、読み方が形の変化を越えて通用するかどうかだからです。

## 配点

| | |
|---|---:|
| flag 正解 | **200** |
| 誤答 | 1 回 −10 |
| hint 1 | −40 |
| hint 2 | −60 |

hint を両方開いても 200 点中 100 点が残ります。flag はこのデプロイの seed から導出される `TC{...}`
で、他人の実行結果を暗記しても当て推量でも通りません。どの verifier がどの欠陥を持つかも同じ seed
から引くので、分類の答えは人づてに持ち回れる 1 文にはなりません。

## 進捗はコンテナの中にあります

`review status` は `/tmp` 配下のファイルを読みます。コンテナ内で書き込めるのはそこだけです
(他はすべて read-only)。コンテナを作り直すと 5 段階は最初からになります。読み方が分かっていれば
数分でやり直せますし、永続ボリュームは壊れうるものが 1 つ増えるだけです。

## 講座との関係

これは `diagnostic` です。教材に併走するのではなく、教材の**前**に置かれ、トラックの入口を担い
ます。上流の `sources` を pin していないのもそのためです ── 特定の講義や課題に対して書かれた問題
ではなく、欄を埋めるために commit SHA を捏造するのは空欄より悪いからです (`CATALOG.md` の
`courseAlignment` の節)。

講座の式・fixture・solution は一切転載していません (`GOVERNANCE.md` §2 および §4)。

## 保証範囲

ローカル実行は**自習用の honor-system 検証**です。マシンも Docker デーモンも image もあなたの管理下に
あるので、image の中身はあなたに対して秘匿されていません。具体的に書きます。

- flag の導出元である `FLAG_SEED` はコンテナの環境変数に入っています。どの段階も通さずに flag は
  計算できます。
- `fixtures/generate.py` は image の中にあります (`review show` の表示がそこから作られるためです)。
  そこには各 statement の honest witness が入っており、読めば 5 つのうち 3 つの答えが手に入ります。

5 つの段階は解錠すべき鍵ではなく順路であり、飛ばして困るのはあなただけです。`author` stage の分離が
買っているのはもっと狭いことです。reference の解答とそれを採点する suite があなたの動かす image に
入っていないので、問題を解いてしまうファイルから目を逸らす必要がありません。seed が買っているのは
本物です。statement も欠陥の配置も flag もこのデプロイ由来なので、他人の実行結果を暗記しても持ち越せ
ません。そして分類は保存された答えとの照合ではなく、判定器が verifier を実際に走らせて計算した表と
突き合わせています。

これは自習と誠実な練習を支えます。競技順位・試験・修了判定は**支えません**。
それらには participant が管理しない verifier が必要で、
[#271](https://github.com/susumutomita/TenkaCloudChallenge/issues/271) で追跡しています。

## コスト

ゼロです。クラウドアカウントも AWS リソースも使いません。

## 作問者向け

この問題はコンテナのターミナルから遊ぶので、参加者が編集するファイルを一切持ちません。
[`TEMPLATE.md`](../../docs/curricula/advanced-cryptography-2026/TEMPLATE.md) の 4 target の参加者
契約には違反しているのではなく、その対象外にいます。Makefile は作問者の道具で、参加者の目に触れる
ことはありません。`make play` は participant image の中でシェルを開きます (portal のターミナルが
繋がるのと同じ場所です)。`make test` は公開の自己検査 (インタフェースの性質だけで、答えは含みません)
を実行します。

本命は `make reference-test` です。8 seed で reference の解答を通し、際どい誤答のカタログを全部
落とし、判定器を 1 要件ずつ壊してカタログがそれを全部殺すことを確認し、120 seed を sweep して
「問いが成立しない panel」が無いことを見て、さらに CLI 経由で run が何も記録しないこと・2 つの
lock・32 通りの進捗状態のうち 1 つでだけ flag が出ることを確認します。

この suite が検査ではなく問題そのものを変えた点が 2 つあります。

- 2 つの statement は独立に引かれるので、約 40 seed に 1 回 honest witness が**一致**していました。
  `reject` と `recover` の答えが同じになり、1 つの読み取りしかしていない参加者が 2 つ分の credit を
  得ていたことになります。今は edge を witness がずれるまで引き直します。
- `reject` は当初 edge statement だけで採点していました。そのせいで「3 つとも受理した」分岐が到達
  不能になり、「実際に誰かが拒否すること」という要件を削除しても verdict が 1 つも変わりませんでした。
  今は両方の statement で採点するので、main の witness がその要件のための際どい誤答になります。
