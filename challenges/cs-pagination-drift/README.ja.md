# ページは正しい。一覧が揃わない

`cs-foundations` 第 10 章。 ページ取得の合間に書き込みが届き、同じ行が 2 ページに現れ、
生きている行がどのページにも現れません。

## この問題が立っている落差

starter は public test をすべて通ります。 どのテストも止まった表に対して分割取得する
だけだからです。 止まった表の上では offset と cursor は区別が付きません。 表が動いた
瞬間に区別が生まれますが、public test は表を動かしません。

## 構成

```
local/starter/pagination.py    参加者が編集する 1 枚
local/reference/pagination.py  正解 (author image のみ)
local/tests/public/            壊れた starter でも通るテスト
local/tests/hidden/            checkpoint を実際に決める性質
local/mutants/                 mutation suite が読む author 専用 mutant
local/mutation.py              reference を 9 通り壊し、すべて検出させる
local/fixtures/generate.py     seed 由来の listing trace と MemoryStore
local/verifier/server.py       hidden 採点。 別 image かつ別 network
local/workbench/server.py      参加者の editor と証拠。 公開される唯一の port
```

## hidden 性質の判定方法

checker は store を自分で持ち、すべての書き込みをページ呼び出しの合間に自分で加えます。
timing 依存はありません。 性質は契約に対して述べられます — 新しい順が崩れない、同じ id
が 2 度届かない、生き残りは 1 回ずつ届く、古い写しから配らない、cursor が終端を偽らない、
拒否は反復を乱さない。 最後の phase は作者が書き下していない挿入・削除スケジュールを
seed から生成して走査します。 これが「不変条件を保つ paginator」と「例が通るまで直した
paginator」を分けます。 提出コードの書き方そのものは一切見ていません。

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

表のトランザクション分離を強くしたのではない。 1 つの反復の中で、各行が何回届くかを
決めた — 生き残りは必ず 1 回、消えた行は古い写しから配らない、発行していない入力は
明示的に拒否する。 これは証拠に支えられる範囲を越えない、正確で役に立つ保証である。
