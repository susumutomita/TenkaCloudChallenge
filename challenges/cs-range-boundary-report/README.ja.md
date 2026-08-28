# 先週の数字に、先週じゃない日が入っている

`cs-foundations` 第 0 章、この track の入口。 「直近 7 日」を求められた日次レポートが、
正しい期間を印字しながら 8 日ぶんを合計する。

必要なのは日付と足し算だけです。 time zone は出てきません (それは order 90 の
`cs-dst-daily-rollup`)。 浮動小数点も出てきません (それは order 70 の
`cs-numeric-aggregation-order`)。 扱うのは範囲の端をどちらまで数えるか、その 1 点です。

## この問題が立っている落差

starter は public test をすべて通ります。 どのテストも範囲の内側、範囲より前、
レポート日より後には行を置き、返り値の start / end も、重複も、順序も、
記載どおりのエラーも確かめます。 それでもレポート当日にだけは 1 行も置きません。
starter と契約が食い違う日は、そこだけです。

返している範囲は正しく、数えている日が違う。 これがこの問題の主題です。
データが端に触れないテストは、端について何も証明しません。

## 構成

```
local/starter/report.py       参加者が編集する 1 枚
local/reference/report.py     正解 (author image のみ)
local/tests/public/           壊れた starter でも通るテスト
local/tests/hidden/           checkpoint を実際に決める性質
local/mutants/                mutation suite が読む author 専用 mutant
local/mutation.py             reference を 14 通り壊し、すべて検出させる
local/fixtures/generate.py    seed 由来のレポートと台帳
local/verifier/server.py      hidden 採点。 別 image かつ別 network
local/workbench/server.py     参加者の editor と証拠。 公開される唯一の port
```

## Checkpoint

| id | 配点 | 誤答減点 | 何を判定するか |
| --- | --- | --- | --- |
| `environment` | 10 | 5 | この deploy の Workbench 合言葉 |
| `observe` | 20 | 5 | 合計に入っている「直近 7 日ではない日」と、その日を除いた合計 |
| `repair` | 35 | 5 | 既定の 7 日窓が、レポート日の直前 7 日だけを覆う |
| `generalize` | 35 | 5 | 期間の長さが変わっても、月・年・うるう日をまたいでも、台帳に空の日があっても同じ規則を保ち、呼び出し側の行を書き換えない |

difficulty 2 の Challenge として満点 100、誤答減点は一律 5、ヒント減点は合計 32 です
(AGENTS.md §14)。

## hidden 性質の判定方法

標本化も競合も一切ありません。 どの case も暦の日を 1 つ名指しし、その日が契約の窓の
内側かどうかを言い、一致していなければ出せない数を要求します。 境界の probe は
1 日に 1 行だけを渡します — レポート当日、その翌日、窓の最終日、窓の初日、その前日 —
ので、端の間違いが合計の中に紛れることがありません。

基準日も各行の数も run の seed 由来です。 別 deploy の合計を書き写した提出は、
最初の case で落ちます。

`generalize` は、もっともらしい誤った直し方が生き延びる case を足します。 7 以外の
期間長、月・年・うるう日をまたぐ窓、窓の内側に 1 行も無い日がある台帳
(窓はデータのある直近数日ではなく暦の連続した日で決まります)、重複、順序の入れ替え、
そして呼び出し側の list が書き換えられずに返ること。

## 作問者向けコマンド

```bash
make build           # participant + verifier image
make test            # local/starter に対する public test
make inspect         # 参加者に見える証拠を表示
make reference-test  # reference が hidden を通り、14 の mutation がすべて死ぬ
make up / make down  # Compose lab をローカルで起動・停止
```

## 費用の出るリソース

ありません。 この問題は cloud リソースを一切 deploy せず、`local/Dockerfile` から
build した container 2 つを Compose で動かすだけで、`make down` で削除されます。
host へ公開されるのは `127.0.0.1:18590` の Workbench だけで、verifier は host port を
持ちません。 何も provision しないので、teardown 後に課金が続くものもありません。

## 保証範囲

local modeはself-pacedなhonor-system verificationである。participantはmachine、Docker daemon、imageを管理する。
通常のparticipant imageはhidden test、reference、mutationを含まず、
hidden verifierは別imageである。それでもDockerを管理する人はauthor stageをbuildして中を読める。この分離は誤配を
防ぎ、悪意あるhost ownerから秘匿するものではない。submissionには時間・memory・process・output capをかける。
containerはnon-root、read-only、privilege無しで動き、masqueradeされたoutbound networkを持たない。

競技順位・試験・修了判定は**支えません**。その用途にはparticipantが管理しないverifierが必要で、
[#271](https://github.com/susumutomita/TenkaCloudChallenge/issues/271)で追跡している。

## 証明したこと

日付演算を安全にしたのではない。 1 つの範囲について、名乗っている日と数えている日を
同じ集合にした。 期間の長さが変わっても、窓が暦のどこに来ても成り立つ。 その「暦の日」が
zone によって何時間になるか、足し算が精度に何をするかは、まだ開いたままで、
次の 2 つの章が扱う。
