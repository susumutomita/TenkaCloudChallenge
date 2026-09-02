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
ます。最後に、細部が 1 つずつ欠けた出題側の検査器 5 つを相手に、どれが偽造を通すかを、通る開示
そのもので示します（`lenient` checkpoint）。

## 葉に何が入っていなければならないか

| binding されるもの | 無いと |
|---|---|
| **index** | 葉が「どこから来たか」を主張しない |
| **フィールドの区切り** | `(1, 23)` と `(12, 3)` がどちらも "123" になる |
| 各段の **方向** | verifier が 2 通りに hash でき、prover が選べる |

区切り無しの弱い符号化は **fixtures 側**にあり、あなたのファイルにはありません。自分で弱くした
コードを自分で破るのは反例ではないからです。

## Participant Portal での進め方

1. Participant Portal で問題を起動する。同じ画面に問題エディタが表示される。
2. **証拠を調べる**で、この deploy 固有の fixture と公開された証拠を読む。
3. Portal のエディタで starter のソースを編集する。
4. **公開テストを実行**を押し、直接回答欄があれば証拠から埋める。
5. 各 checkpoint をそのまま提出する。Portal が現在のファイルと回答を準備して送る。

checkout、ターミナル、ローカルエディタ、別画面、コピペは不要です。code checkpoint は現在の
エディタ内容を使います。直接回答は現在の deploy seed へ結び付くため、別 deploy からコピーした
値は拒否されます。

## 採点

8 つの checkpoint を独立に採点します。誤答は 1 回 15 点減点です。

| Checkpoint | 配点 | 何を検査するか |
|---|---:|---|
| `encoding` | 30 | index と値の binding、2 組が衝突しないこと、節点の順序依存 |
| `root` | 25 | commitment と、並べ替えで変わること |
| `opening` | 40 | 正直な開示の受理と、値・index・方向・長さ・範囲の拒否 |
| `order` | 35 | commit 前の challenge、challenge 前の open の拒否 |
| `adaptive` | 40 | challenge が先に来る場合の反例 |
| `ambiguity` | 35 | 弱い符号化で衝突し、自分の符号化では衝突しない 2 組 |
| `transcript` | 35 | challenge が commitment・domain・statement に依存すること |
| `lenient` | 60 | 出題側の検査器 A〜E それぞれに、表に無い主張を通す開示か `None` を返す（5 つ全部正しいときだけ加点） |

hint は 8 つ中 6 つにあり（合計 115 点）、いずれもその checkpoint の 50% 上限内です。

## 出題側の 5 つの検査器

`lenient` checkpoint は参加者の verifier ではなく、fixtures に固定した出題側の検査器を攻めます。5 つとも
正直な開示を全部通し、葉・節の作り方と各段で兄弟をどちら側に置くかの決め方だけが違います。

| 検査器 | 葉 | 兄弟の側 | 表に無い主張 |
|---|---|---|---|
| A | index を入れない（`leaf/v1` + 値 8 バイト） | path の側フラグを信じる | 通る — 位置 j の葉と path を index i の主張に付け替えられる |
| B | 区切り無しの文字列（`weak_leaf`） | path の側フラグを信じる | 通る — 同じ文字列に描かれる別の (index, 値)。16 マスなら index 10〜15 が「1 + 残り」に読める |
| C | 正しい葉（index 4 バイト + 値 8 バイト） | path の側フラグを信じる | 通らない — 葉に index が入る |
| D | A と同じ（index を入れない） | index を 2 で割った余りで決める | 通らない — 側を index から導くので、付け替えた葉は別の側に置かれる |
| E | tag 無し、値の最小バイト列の指紋。節も tag 無しの `sha256(左 + 右)` | D と同じ | 通る — 値のバイト列を「左の子 + 右の子」にすると葉の指紋が内部節と一致し、その節を葉として短い path で提示できる |

参加者は 5 つそれぞれに、通る開示か `None` を返します。hidden の message は、通らない開示には scheme 名を
付けます（公開テストが同じ判定を出すので新情報ではありません）が、偽造が存在する scheme への `None` は
scheme 名を伏せて 1 回だけ報告します — どの検査器が健全かは verdict から分かりません。「公開テストを実行」が verifier の `POST /public/lenient` に答えを
送り、公開の練習台（16 マス）に対して「通った／通らなかった／表にある主張か」を返すのが feedback
loop です。参加者 image には検査器の実装も練習台の根もありません。

## 等価変異について

`verify_opening` の index 範囲検査と path 長検査は、**外しても検出できません**。`LEAF_TAG` と
`NODE_TAG` があるので葉のハッシュと節点のハッシュが一致することはなく、長さの違う path は root と
異なる値に再計算されて比較で落ちるからです。mutation suite には入れていません。

代わりに `Session.receive_challenge` の範囲検査を変異させています。こちらは負の index が黙って
巻き戻り、聞かれていない行が開示されるので検出できます。

殺せない変異を一覧に残すと、「SURVIVED は無視してよい」を教えることになります。だから残しません。

その代わり、path 長と側フラグが「効く」状況 — 葉が index を持たないとき、tag が無いとき — は、上の 5 つの
検査器の側で採点しています。参加者の `verify_opening` に検査を要求するのではなく、検査が抜けた出題側の検査器に
何が通るかを構成させる形です。

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

## 保証範囲

ローカル実行は**自習用の honor-system 検証**です。compose stack のすべてのコンテナと
Docker デーモンを管理する人を、中身の閲覧から止める手立てはありません。ここにある境界は
秘匿ではなく誤配送の防止です。build して動かす Workbench コンテナには starter と公開テスト
しか入っておらず、fixture も hidden test も参照解答も verifier 本体も入っていません。
それらは Workbench がネットワーク越しに話す、公開されていない second container と、
`make reference-test` が build する author 専用 image にだけあります。

verifier が実際に保証するのはもっと狭く、そして本物です。提出コードは verifier を
ハングさせたりクラッシュさせたりできません。 checkpoint は echo した id しか加点できません。
結果は期待値を漏らしません。 fixture はこのデプロイの seed 由来なので、暗記した答えは持ち越せません。

これは自習と誠実な練習を支えます。競技順位・試験・修了判定は**支えません**。
それらには participant が管理しない verifier が必要で、
[#271](https://github.com/susumutomita/TenkaCloudChallenge/issues/271) で追跡しています。

## コスト

ゼロです。クラウドアカウントも AWS リソースも使いません。

## 作問者向け

`make reference-test` が mutation suite を実行します。壊した実装 20 種類（うち 11 は `lenient` の答え
を壊すもの — 全部 `None`、C や D にも偽造を主張、E を健全と誤答、E で節でなく葉を付け替える、節の下の
段まで含めた path、tag 付きの節で作った値、正直な開示を偽造と称する、別の葉で作った path、側を反転した
path、先頭 0 の切れ目）があり、9 種類は commit・challenge・open・verify を成功させます。違いは、その
あと攻撃者に何ができるかだけです。suite はまず 5 つの検査器自体を確かめます — 5 つの seed で正直な開示
を全部通し、reference が A・B・E だけを偽造し、C・D・E が全部の付け替えを拒み、側フラグの反転を
A・B・C は拒み D・E は無視すること。
