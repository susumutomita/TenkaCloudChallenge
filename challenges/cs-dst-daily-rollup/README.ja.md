# 年に 2 日だけ、日次レポートが合わない

`cs-foundations` 第 9 章。 台帳も、それを集計するコードも誰も変えていません。
それでも年に 2 日、公開された日次レポートが台帳と一致しません。
現地の 1 日が、いつも 24 時間とは限らないからです。

## この問題が立っている落差

starter は public test をすべて通ります。 どのテストも切替のない普通の週を集計するだけで、
範囲の先頭で offset を 1 回読んですべての瞬間に足す実装は、その週なら正しいからです。

## 構成

```
local/starter/rollup.py       参加者が編集する 1 枚
local/reference/rollup.py     正解 (author image のみ)
local/tests/public/           壊れた starter でも通るテスト
local/tests/hidden/           checkpoint を実際に決める性質
local/mutants/                mutation suite が読む author 専用 mutant
local/mutation.py             reference を 10 通り壊し、すべて検出させる
local/fixtures/generate.py    seed 由来の日次レポートと台帳の値
local/verifier/server.py      hidden 採点。 別 image かつ別 network
local/workbench/server.py     参加者の editor と証拠。 公開される唯一の port
```

## hidden 性質の判定方法

zone も日付も system の tz database から取り、verifier seed とともに動きます。 public test で
見た週に特別対応しても通りません。 checker は契約が名指しするのと同じ暦で期待値を独立に組み立て、
日ごとに突き合わせます。

偶然に任せている部分はありません。 offset を間違えた実装が event を取り違えるのは、切替の瞬間を
またぐときではなく**日境界**をまたぐときです。 そのため生成される各日の最初と最後の 1 分は必ず
埋めます。 ここを乱数に任せると、checkpoint が欠陥を捕まえるかどうかが参加者の引いた seed 次第に
なってしまいます。 両方向を試すのも同じ理由で、時計が戻る日は短くなった日の終わりが、
進む日は翌日の始まりがあふれます。

誤答は意図的に 2 つに分けています。 固定 offset は目に見えて誤りです。 UTC の日で束ねてから
ラベルだけ現地日付に付け替える実装は、ラベルこそ本物の現地日付になりますが、そのラベルが指す
中身は名乗っている日ではないので、やはり誤りです。 これが `local/mutants/` の author 専用 mutant です。

切替が 0 時から離れて起きる zone だけを使うので、現地の 0 時は必ず存在します。 ここで扱うのは
1 日が 23 時間や 25 時間になることであって、壁時計時刻が存在しなくなることではありません。

## 作問者向けコマンド

```bash
make build           # participant + verifier image
make test            # local/starter に対する public test
make inspect         # 参加者に見える証拠を表示
make reference-test  # reference が hidden を通り、10 個の mutation がすべて死ぬ
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

すべての時刻計算を正しくしたのではない。 1 つの日次レポートと 1 つの範囲について、複数の zone と
両方向の切替を含めて、各 event がどの現地日に属するかを決めた。 存在しない壁時計時刻や、2 回起きる
壁時計時刻はこの主張に含まれない。 この問題はそれを一度も尋ねていない。
