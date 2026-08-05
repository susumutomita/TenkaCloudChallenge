# 暗号文のまま関数を引き、鍵を新品に戻す

> このトラックは Advanced Cryptography Program 2026 の非公式・独立した companion です。
> 講座およびその運営とは提携も推奨関係もありません。問題文・コード・fixture・図はすべて
> 独自に書かれています。このトラックへの質問は講座運営ではなく TenkaCloud リポジトリへ。

**トラック:** `advanced-cryptography-2026` · **順序:** 560 · **章:** Week 5 /
Programmable Bootstrapping and HomNAND · **役割:** `synthesis` · **想定時間:** 105〜150 分 ·
**配点:** 300 · **前提:** Week 5 の 5 問すべて · **ステータス:** draft

## この問題の話

Week 5 の 5 問はそれぞれ 1 つの部品を作りました。その 5 つはすべてここで支給されます。
環と encoding、LWE と RLWE、gadget と external product、CMUX と monomial rotation、
sample extraction と key switching。どれも再実装しません。

足りないのは、それらが部品だったところの本体です。

```text
LWE(次元 n, 鍵 s_lwe)
  -> rotation domain      2N/q 倍して丸める
  -> LUT accumulator      trivial な RLWE 暗号文。mask も noise も message も持たない
  -> blind rotation       X^(-phase) 倍。phase は最後まで計算されない
  -> RLWE(ring 鍵)
  -> sample extraction    係数 0 を、次元 N の ring 鍵の下で取り出す
  -> key switching        次元 n の s_lwe へ戻す
  -> LWE(次元 n, 鍵 s_lwe)
```

出力の鍵は**入力の鍵**です。これが one-way な評価ではなく bootstrapping である理由で、
hidden test は bootstrap の出力をもう一度 bootstrap します。

## encoding が変わっていて、それが要点

```text
encode(1) =  q/8        encode(0) = -q/8        decode(c) = centered(c) > 0
```

`m * delta` ではなく balanced。この下では復号が**符号判定そのもの**になり、符号判定は
negacyclic rotation が `X^N = -1` によって無料で計算します。前問までの encoding では
これが表現できません。「PBS は任意の関数を評価できるわけではない」の具体的な中身はここです。

lookup table の上半分には `f(0)` ではなく `1 - f(0)` を書きます。巻き戻りが係数 0 に
負号を付けて渡すからで、balanced encoding では `-encode(x)` が `encode(1 - x)` になります。

## 各 stage は数値の所属を stamp する

```text
kind             "lwe" か "rlwe"
keyId            どの secret の下の暗号文か
dimension        その secret の mask 係数の本数
modulus          どの整数環の数か
parameterSetId   どの parameter set のものか
noiseBound       この stage が足しうる量の上限
```

このうち 2 つは pipeline の途中で変わります。extraction は暗号文を **ring** secret の側
(次元 `degree`) へ移し、key switching が元へ戻します。正しい数値に間違ったラベルを付けた
stage は、次の stage が合わない暗号文と黙って結合する材料を作ります。結果は両方の鍵で
noise に復号されます。

## 真理値表が通っても、通っただけ

この問題は 37 個の壊れた実装を同梱しています。そのうち **21 個は真理値表が完全に通ります**。
全 unary 関数、両 message、NAND の全 4 行を、全 parameter set で。それでも 21 個とも
壊れた pipeline です。`make reference-test` は毎回この数を測り、動いたら落ちます。
この文書が引用しているからです。

最終ビットではなく stage をその場で採点しているのは、この実測値が理由です。内訳は 3 つ。

- **数値は正しいがラベルが違う。** extraction が入力の keyId を残す、次元を入力側で
  報告する、出力を RLWE と名乗る。switching key がたまたま合っているので pipeline は
  端から端まで動き、回路の中で別の暗号文と結合された瞬間に壊れます。
- **答えは正しいが自己申告が嘘。** trace の noise が全部 0、accumulator が message を
  持つと主張、出力 bound が入力 noise とともに増える。pipeline は正しくて、それが語る
  自分の話だけが嘘 — そして学ぶべきだったのはその話のほうです。
- **たまたま当たっている。** 係数 1 を取り出しても lookup table が半分ごとに定数なので
  大抵同じ値。切り捨てても correctness budget が吸収する。どちらも頼りたい性質ではなく、
  どちらも最終ビットからは見えません。

22 個目は、seed によって見えたり見えなかったりします。`nand_combine` の `q/8` を落とした
もので、真理値表が捕まえられるかどうかが noise の転び方次第。いちばん厄介な種類の欠陥で、
下でもう一度触れます。

trace を digest で照合するのも同じ理由です。digest は最終ビットから逆算できません。

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

8 個の checkpoint を独立に採点します。誤答は 1 回 15 点。

| Checkpoint | 配点 | 何を見るか |
|---|---:|---|
| `lut` | 30 | 4 つの unary 関数すべて、上半分の負号、mask も noise も無い trivial 暗号文 |
| `domain` | 25 | `Z_2N` へ丸めて移す、切り捨てでない、範囲内、丸め誤差の報告 |
| `rotate` | 40 | 全関数・全 message で係数 0 が `f(m)` に復号、規定のループ順 |
| `relabel` | 50 | extraction と key switch。係数 0、phase の完全保存、ring 鍵・次元 `degree` へ、そして入力と同じ鍵へ戻す。合わない鍵は拒否 |
| `evaluate` | 40 | 未知の 1 つを含む全 unary 関数、出力の再 bootstrap、乱数を変えても同じ |
| `refresh` | 30 | 6 行の trace を digest で照合、入力 noise を変えても後段の bound が動かない、契約の境目 |
| `nand` | 60 | offset の存在、NAND が 1 のときだけ正、鍵違いの拒否、全 4 行を全 parameter set で、bootstrap 済みビット同士でも |
| `transfer` | 25 | 見たことのない parameter set・鍵・table・入力ビット |

8 個中 7 個にヒントがあり、それぞれ配点の 50% 以内に収まっています。

pipeline の stage は **10** 個で、hidden test は 10 個すべてを別々に、それぞれの失敗
メッセージ付きで採点します。scored checkpoint が 8 個なのは multi-verify 契約の上限で、
`SCHEMA.json` と platform 側の `problem-sdk` の両方に入っています (9 個目は切り捨てではなく
scoring 全体が捨てられます)。なので結び付きの強い 2 組が checkpoint を共有します。
`relabel` は extraction と key switch、`nand` は線形結合とゲート。どちらの組も 1 つの考えで、
分けて採点するとそうでないかのように見えてしまいます。

## refresh は「noise が減ること」ではない

出力の noise bound は blind rotation の分と key switch の分の和で、入力の noise は項として
現れません。減るのではなく**依存しなくなる**。だから出力をもう一度 bootstrap できて、
だから回路が組めます。

trace の noise 列を上から読むと、どの行で入力への依存が切れるかが見えます。
`refresh_report` は同じことを式で言います。`outputNoiseBound` を違う入力で 2 回読んでも
数が動きません。

## ゲートは lookup table の中に無い

HomNAND の lookup table は identity です。4 通りの入力すべてで同じ table を使い、4 行を
分けているのは前処理の線形結合が作った phase の符号だけ。bootstrap は符号を新しい暗号文に
変換しているだけで、ゲートそのものは `(0, q/8) - c1 - c2` の側にあります。

この `q/8` を落とすと `(0,1)` と `(1,0)` の phase がちょうど 0 になり、答えが noise の
転び方で決まります。40 seed で測ると、この 2 行への 80 回の試行のうち 12 回が誤りで、
残りの 2 行は 1 度も間違いません。7 回に 1 回落ちる書き忘れは、バグではなく flakiness に
見えます。落ちきってくれるより厄介です。

## correctness bound を超えたときに起きること

入力の noise が bound を超えても bootstrap は劣化しません。**逆のビット**を、自信を持って、
新しい小さな noise とともに返します。壊れた暗号文ではなく、間違った答えの正しい暗号文。
FHE の failure mode として覚えておく価値があるのはこちらで、ある入力がそもそも契約の内側に
いるかどうかを言う場所が `refresh_report` です。

## 構造的に存在しない近道

あなたが書く関数には、どちらの端でも secret が渡りません。ring secret も LWE secret も。
だから「入力を復号し、`f` を適用し、答えを再暗号化する」はこの API で表現できる実装では
ありません。**候補にあった mutation が 2 つ、書けないという理由で落ちています**。
今の 1 つと、「出力の平文を artifact の metadata に入れる」— こちらも同じ理由で、
どの stage も `m` や `f(m)` を知りません。

それでも hidden suite は返された artifact すべてを両方の secret で走査します。将来の作問者が
secret を通してしまったら気づけるようにです。

## toy と production の差

ここにあるのは機構の toy です。production の TFHE は多項式積を FFT / NTT で回し、
bootstrapping key を圧縮し、パラメータはコメントに収まる大きさからではなく lattice
reduction に対する安全性から逆算します。gate 1 回あたりの計算量も、実用的な bootstrapping
key のサイズも、任意の多ゲート回路のコンパイルも対象外です。

## 対象外

production TFHE の security / performance、最適化された FFT / NTT / SIMD、bootstrapping
key のサイズ最適化、任意の multi-gate circuit compiler。

## これは安全ではない

パラメータは全列挙できる大きさで、両方の secret は線形代数で復元できます。
機構の toy であって、困難性の toy ではありません。

## 出典との対応

Week 5 の教材は公開済みなので、`courseAlignment` は `week5/README.md` を `lecture`、
`week5/problems/tfhe-toy-python/README.md` を `assignment` として pin しています。
宣言する役割は `synthesis` です。schema は役割を 1 つしか取らず、この問題を規定する性質は
1 つの機構を切り出すことではなく週全体を統合することだからです。`spoilerPolicy` は
`independent-reimplementation` で、API・パラメータ生成・記述は独自であり、公式課題から
関数名も fixture も skeleton も取っていません。

## 保証範囲

ローカル実行は**自習用の honor-system 検証**です。マシンも Docker デーモンも image も
あなたの管理下にあるので、image の中身はあなたに対して秘匿されていません。
`reference/` と `tests/hidden/` を bind-mount しないのは、あなたの git checkout に
紛れ込ませないためであって、手が届かなくするためではありません。

verifier が実際に保証するのはもっと狭く、そして本物です。提出コードは verifier を
ハングさせたりクラッシュさせたりできません。checkpoint は echo した id しか加点できません。
結果は期待値を漏らしません。fixture はこのデプロイの seed 由来なので、暗記した答えは
持ち越せません。

これは自習と誠実な練習を支えます。競技順位・試験・修了判定は**支えません**。
それらには participant が管理しない verifier が必要で、
[#271](https://github.com/susumutomita/TenkaCloudChallenge/issues/271) で追跡しています。

## コスト

ゼロ。クラウドアカウントも AWS リソースも不要です。

## 作問者向け

`make reference-test` が mutation suite を走らせます。37 個の壊れた実装、すべて kill 済み。
そのうち 21 個は真理値表が完全に通ります。この 21 という数が、stage ごとに checkpoint を
10 個置くという高くつく構成を正当化しているものです。suite が毎回測って、動いたら落ちるので、
README と metadata が reference から離れていくことはありません。
