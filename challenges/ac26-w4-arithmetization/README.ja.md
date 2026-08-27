# 多項式にしただけでは証明ではない

> このトラックは Advanced Cryptography Program 2026 の非公式・独立した companion です。講座および
> その運営者とは提携しておらず、承認も受けていません。問題文、コード、fixture、図はすべて独自に
> 作成しています。このトラックに関する質問は講座運営ではなく TenkaCloud リポジトリへお願いします。

**Track:** `advanced-cryptography-2026` · **Order:** 410 · **Chapter:** Week 4 / Arithmetization
Bridge · **Role:** `transfer` · **想定時間:** 60〜90 分 · **配点:** 300
· **Status:** draft — 後述の「Week 4 の対応づけ」を参照

## ストーリー

プログラムが走ったことを証明するとき、プログラムは証明の中に入りません。実行が表になり、表の規則が
多項式関係になり、主張が「これらの関係がこれらの点で消える」になります。

機械は 2 列 2 規則です。

```text
a_{i+1} = a_i + b_i
b_{i+1} = b_i + weight*a_i     (mod p)
```

計算そのものは主題ではありません。変換が主題です。

## 2 種類の制約は別の仕事をしています

**transition** 制約は「各行が前の行から従う」と言います。**boundary** 制約は「どこから始まったか」を
言います。一方が他方を含意しません。

boundary を落とすと、系は同じ機械を**別の初期状態から**走らせた trace で完全に充足されます。遷移は
すべて成り立ち、residual はすべて 0 で、多項式は等しく正しい。そしてそれは別の文の証明です。

`underconstrained` checkpoint で構成するのが、まさにその trace です。「制約を 1 本落とす」の具体的な
意味がこれです。

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
| `trace` | 30 | 機械が実際に出す trace |
| `transition` | 40 | 隣接対ごとに 1 本、正直な trace で 0、改ざん位置で最初に非零 |
| `boundary` | 30 | 正直な trace で 0、始点をずらすと非零 |
| `interpolate` | 45 | domain 上で列を再現し、domain 外でも多項式として振る舞う |
| `compose` | 40 | 多項式を通しても関係が消える |
| `locate` | 40 | 最初に壊れた行と、制約の種類 |
| `underconstrained` | 45 | 遷移制約をすべて満たす別の trace |
| `transfer` | 30 | 見たことのない体・長さ・weight での再実行 |

hint は 8 つ中 5 つにあり、いずれもその checkpoint の 50% 上限内です。

## 実装の正否を分ける細部

**residual は何本か。** 隣接する行の対ごとに 1 本なので、行数より 1 少ない。行ごとに 1 本作る実装は、
最後の行を存在しない次の行と比べています。この mutation は `IndexError` で落ちます。

**違反はどの行のものか。** i 番目の遷移が作るのは行 `i+1` なので、最初に壊れる行は `i+1` です。`i` と
報告する実装は、読み手を 1 行ずらした場所へ案内します。

**行 0 には前の行がありません。** そこで壊れうるのは boundary だけです。それを transition 違反と呼ぶ
のも間違った場所を指すことになります。だから boundary を先に見ます。

## evaluation domain

domain は単位根の冪で、行 `i` が点 `g^i` に対応します。隣り合う行が隣り合う点になるので、遷移制約は
「`x` での多項式」と「次の点での同じ多項式」の関係として書けます。素数は `steps` が `p-1` を割るもの
だけを選んであります。そうでなければ、その位数の単位根が存在しません。

## これは証明系ではありません

commitment がなく、verifier の乱数がなく、したがって誰に対しても健全ではありません。arithmetization
までの橋であって、その先ではありません。ここで作るものを「小さな SNARK」と呼ぶのは、この問題が教えよう
としていることの正反対です。

## Week 4 の対応づけ

Week 4 の教材は pinned commit の時点で未公開です。`courseAlignment` は `week4/README.md` を
`kind: "placeholder"` で pin し、role は `transfer` にしてあります。`GOVERNANCE.md` §6 が未公開週の
companion に許す 2 つの role のうちの 1 つであり、Week 1 の constraint と Week 3 の体を新しい設定へ
転用しているという意味でも正確です。公式課題が何を要求するかについては何も主張していません。#229 が
教材公開時に対応づけを確定します。

## 保証範囲

ローカル実行は**自習用の honor-system 検証**です。Docker デーモンと compose stack の全 container を
管理する人に対しては、hidden material の閲覧を防げません。ここでの境界は誤配の防止であって、
その人に対する秘匿ではありません。あなたが build して動かす Workbench container が載せるのは
starter、public test、orientation printer だけで、fixtures、hidden test、reference、verifier は
載りません。それらは、Workbench が compose network ごしに参照する公開しない 2 つ目の container と、
`make reference-test` が build する作問者専用 image にだけ存在します。

そのため `make test`、`make test-one`、`make inspect` は先に verifier を起動します
（`make verifier-up` が自動で走ります）。`make inspect` はこのデプロイの設定・evaluation domain・
機械が実際に出す行を、ローカルで計算せずに compose network ごしに読みます。
停止は `make verifier-down` です。

verifier が実際に保証するのはもっと狭く、そして本物です。提出コードは verifier を
ハングさせたりクラッシュさせたりできません。 checkpoint は echo した id しか加点できません。
結果は期待値を漏らしません。 fixture はこのデプロイの seed 由来なので、暗記した答えは持ち越せません。
提出コードには時間・memory・process・output の上限をかけ、両 container は read-only で、
権限昇格も Linux capability も無しで動き、公開されるのは Workbench の loopback だけです。

これは自習と誠実な練習を支えます。競技順位・試験・修了判定は**支えません**。
それらには participant が管理しない verifier が必要で、
[#271](https://github.com/susumutomita/TenkaCloudChallenge/issues/271) で追跡しています。

## コスト

ゼロです。クラウドアカウントも AWS リソースも使いません。

## 作問者向け

`make reference-test` が mutation suite を実行します。壊した実装 9 種類があります。読む価値があるのは
「最後の遷移だけ検査する」と「boundary 制約を落とす」の 2 つで、どちらも完全に見える系を作り、計算では
ない trace を受理します。
