# 半分のファイルは、ファイルではない

`cs-foundations` 第 6 章。 publisher は正しい bytes を書き、成功を報告する。
その裏で、書いている最中に読んだ側は空のファイルを掴んでいた。

## この問題が立っている落差

starter は public test をすべて通ります。 どのテストも `publish()` が返った *後* の
ファイルしか見ないからで、そこは壊れた publisher が完璧に見える唯一の瞬間です。
公開されているものは誰も途中を見ておらず、欠陥はそこにあります。

## 構成

```
local/starter/publish.py      参加者が編集する 1 枚
local/reference/publish.py    正解 (author image のみ)
local/tests/public/           壊れた starter でも通るテスト
local/tests/hidden/           checkpoint を実際に決める性質
local/mutants/                mutation suite が読む author 専用 mutant
local/mutation.py             reference を 9 通り壊し、すべて検出させる
local/fixtures/generate.py    seed 由来の reader log と crash 後の状態
local/verifier/server.py      hidden 採点。 別 image かつ別 network
local/workbench/server.py     参加者の editor と証拠。 公開される唯一の port
```

## hidden 性質の判定方法

競合には一切依存しません。 observer が提出コードの使うファイル API を包み、
書き込みの境界ごとに対象ファイルを撮ります。 読み手が覗き得た瞬間がまさにそこです。
撮れた状態はすべて丸ごとのファイル、つまり完全な古い方か完全な新しい方でなければ
なりません。 同じ observer は任意の境界で例外を出せるので、公開の途中で
プロセスが死ぬ状況を再現でき、その地点は提出コードが使う全境界を走査します。

公開の重なりも同じく決定論的に見ます。 2 本目の公開を 1 本目の書き込みの中から
開始するので、作業ファイル名を 1 つに固定した実装を、スレッドの巡り合わせに
頼らず捕まえられます。

## 作問者向けコマンド

```bash
make build           # participant + verifier image
make test            # local/starter に対する public test
make inspect         # 参加者に見える証拠を表示
make reference-test  # reference が hidden を通り、9 つの mutation がすべて死ぬ
make up / make down  # Compose lab をローカルで起動・停止
```

## 保証範囲

local modeはself-pacedなhonor-system verificationである。participantはmachine、Docker daemon、imageを管理する。
通常のparticipant imageはhidden test、reference、mutationを含まず、
hidden verifierは別imageである。それでもDockerを管理する人はauthor stageをbuildして中を読める。この分離は誤配を
防ぎ、悪意あるhost ownerから秘匿するものではない。submissionには時間・memory・process・output capをかける。
containerはnon-root、read-only、privilege無しで動き、masqueradeされたoutbound networkを持たない。

競技順位・試験・修了判定は**支えません**。その用途にはparticipantが管理しないverifierが必要で、
[#271](https://github.com/susumutomita/TenkaCloudChallenge/issues/271)で追跡している。

## 証明したこと

filesystemをtransactionalにしたのではない。1つの差し替えを同一filesystem内で不可分にし、fsyncが返った後は
durableにした。読み手が見るのは丸ごと古いファイルか丸ごと新しいファイルのどちらかで、どの時点で落ちても
そのどちらかが残り、debrisは残らない。これは証拠に支えられる範囲を越えない、正確で役に立つ保証である。
