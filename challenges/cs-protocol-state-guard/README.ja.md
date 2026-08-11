# ハンドシェイクは、結局なくてもよかった

`cs-foundations` 第 8 章。 client が文書化された順序を無視し、server は ok を返し続けます。

## この問題が立っている落差

starter は public test をすべて通ります。 どのテストも決められた順序で会話するからです。
メッセージ型で分岐するだけの handler は行儀の良い client を完璧にさばき、
自分がいまどの状態かを一度も見ません。

## 構成

```
local/starter/session.py      参加者が編集する 1 枚
local/reference/session.py    正解 (author image のみ)
local/tests/public/           壊れた starter でも通るテスト
local/tests/hidden/           checkpoint を実際に決める性質
local/mutants/                mutation suite が読む author 専用 mutant
local/mutation.py             reference を 9 通り壊し、すべて検出させる
local/fixtures/generate.py    seed 由来の session transcript
local/verifier/server.py      hidden 採点。 別 image かつ別 network
local/workbench/server.py     参加者の editor と証拠。 公開される唯一の port
```

## hidden 性質の判定方法

checker は protocol の写しを自分で持ちます。 reference から import せず書き下しているので、
提出は「ある実装」ではなく「仕様」と比較されます。

採点は書き方ではなく振る舞いで行います。 最後の phase は到達可能な状態とメッセージ型
(プロトコル外の型を含む) の全組合せを走査し、1 セルずつ model と突き合わせます。
拒否のたびに session を動かし直すので、拒否はするのに状態が進む handler も捕まります。
これが「全空間に答える handler」と「例が通るまで if を足した handler」を分けます。
提出コードの書き方そのものは一切見ていません。

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

認証そのものを強くしたのではない。 1 つの session の中で、状態とメッセージ型の全組合せに
ついてどの操作がいつ許されるかを決め、拒否が状態も受理済みデータも動かさないようにした。
これは証拠に支えられる範囲を越えない、正確で役に立つ保証である。
