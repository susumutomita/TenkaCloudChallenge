# 答えは合っている。それだけだ

> このトラックは Advanced Cryptography Program 2026 の非公式・独立した companion です。講座および
> その運営者とは提携しておらず、承認も受けていません。問題文、コード、fixture、図はすべて独自に
> 作成しています。このトラックに関する質問は講座運営ではなく TenkaCloud リポジトリへお願いします。

**Track:** `advanced-cryptography-2026` · **Order:** 240 · **Chapter:** Week 2 / Privacy Audit
· **Role:** `transfer` · **想定時間:** 60〜75 分 · **配点:** 300
· **必須前提:** `ac26-w2-beaver-mul` · **Status:** draft — 後述の「Week 2 の対応づけ」を参照

## ストーリー

3 つのチームが同じものを作りました。3 party の加重リスク合計を、誰も他人の数字を見ずに計算する。
3 つとも納品されました。3 つとも正しい数値を返します。correctness suite はどれも緑です。

privacy review の結果は、同じではありませんでした。

## 何を監査するのか

ここでの program は Python source ではなく**操作列**で、runtime がそれを実行し、外部から観測できる
ものを記録します。

```text
open    値が全員に公開される
peek    ある party が誰かの raw share slot を読む
emit    値を載せた log 行
fail    値を載せた失敗経路
output  protocol が宣言した結果
```

手元の算術は event を 1 つも出しません。この非対称性が主題です。protocol は、どれだけ計算したかで
はなく、何を公開したかで評価されます。

実装は 7 つ。4 つが漏らします。3 つは漏らしません。そのうち 2 つが厄介な方です。

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

7 つの checkpoint を独立に採点します。誤答は 1 回 15 点減点です。

| Checkpoint | 配点 | 何を検査するか |
|---|---:|---|
| `allowed-opens` | 35 | 仕様が公開を許す label の集合 |
| `opened-secret` | 45 | 中間値の open。種類と位置の両方 |
| `cross-party` | 45 | 自分ではなく他人の slot を読んだ party |
| `log-leak` | 45 | log 行や error message から出た raw 値 |
| `transcript` | 40 | 指摘ではなく、復元された private 値 |
| `repair` | 50 | 違反の除去と、正当な観測の保持 |
| `mutation` | 40 | rename・並べ替え・未知 seed でも同じ判定 |

hint は 7 個の checkpoint すべてに 3 段ずつあります (hint1 = 何をしたいのか / hint2 = どう考えるか / hint3 = 読めば解けるウォークスルー)。減点は各 checkpoint の配点の 50% 以内で、21 個すべてを開いても 300 点中 159 点が残ります。

## 偽陽性は見逃しと同じだけ失点する

どの checkpoint も漏れる実装と clean な実装を混ぜてあり、clean 側は「全部挙げる」を罰するように
選んであります。

- 1 つは仕様が公開している **weight** を log に出します。
- 1 つは party が**自分の** slot を読みます。party がやって当然のことです。

どちらも違反ではありません。何が公開されてよいかは仕様が決めるのであって、操作の種類が決めるので
はありません。両方を挙げる監査器は、本物の漏洩を全部見つけた上で不合格になります。

## なぜ program が code ではなく data なのか

`reconstruct` という語を grep する監査器は、rename・wrapper・helper 経由の呼び出しで破れます。
program を操作列にすると、監査対象は**実行が実際に行った操作**になります。だから mutation
checkpoint は全 label を rename し、独立な open を移動し、見たことのない seed で回せます。protocol
は変わっていないので判定も変わってはなりません。label の文字列や、前回違反があった位置を覚えた
監査器は、ここで自分自身と矛盾します。

## なぜ指摘だけでは足りないのか

過剰に open する実装の transcript には、部分和と合計の両方があります。その差は最後の party の加重
寄与であり、weight は公開されていて `p` は素数です。引き算 1 回と逆元 1 回で、その party の private
値がそのまま出ます。

復元するまでは「これは漏れている」はコードについての主張です。復元した後は、誰かのデータについての
事実になります。

## なぜ「全部消す」が修復ではないのか

観測可能な操作を全部消しても漏洩は止まり、program は合計を返し続けます。そこで repair checkpoint は、
仕様が観測を許すものが修復後も**すべて残っている**ことまで要求します。修復とは、違反だけを取り除く
ことです。

## threat model

honest-but-curious、collusion なし。toy field、3 party、手で検算できる大きさの値です。これは
simulator で観測できる leakage contract であって、security の主張でも、実運用 MPC のモデルでも
ありません。

同じ view でも、collusion を許す model の下では判定が変わります。安全性の判断は仮定に対して行うもの
であって、コードに対して行うものではありません。

## 次につながるところ

ここで引いた分離 — 出力の正しさと、生成過程の観測可能性 — は Week 6 の co-SNARK privacy audit で
そのまま使います。

## Week 2 の対応づけ

Week 2 の教材は `curriculum.md` が記録している commit の時点で未公開です。`courseAlignment` は
`week2/README.md` を `kind: "placeholder"` で pin し、`status` は `draft` のままです。この pin は
対応づけではなく、その commit 時点で教材が存在しなかったという事実を記録します。これにより
`bun run course:drift` は教材公開の日に `PUBLISHED` を報告できます。#219 が対応づけを確定してから
draft を外します。

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

`make reference-test` が mutation suite を実行します。壊した監査器 7 種類と verifier を狙った 1 種類が
あります。7 つのうち 2 つは見逃しではなく過剰検出です。見逃しだけを罰する suite は、すべての実行を
違反と判定する監査器を通してしまうためです。
