# 誰も数字を変えていないのに、合計が変わった

`cs-foundations` 第 7 章。 同じ明細を同じコードに 2 回通したら、違う合計が出た。
違ったのは、行が届いた順序だけです。

## この問題が立っている落差

starter は public test をすべて通ります。 どのテストも似た桁の金額を 1 通りの順序で
合計するだけで、float が負けるのは桁が離れたときだけだからです。 配分のずれも、
割り切れない比率で初めて見えます。

## 構成

```
local/starter/aggregate.py    参加者が編集する 1 枚
local/reference/aggregate.py  正解 (author image のみ)
local/tests/public/           壊れた starter でも通るテスト
local/tests/hidden/           checkpoint を実際に決める性質
local/mutants/                mutation suite が読む author 専用 mutant
local/mutation.py             reference を 9 通り壊し、すべて検出させる
local/fixtures/generate.py    seed 由来の再集計ログと配分表
local/verifier/server.py      hidden 採点。 別 image かつ別 network
local/workbench/server.py     参加者の editor と証拠。 公開される唯一の port
```

## hidden 性質の判定方法

すべての数値は checker 側で独立に decimal 演算した結果と比較します。 入力は verifier seed
由来なので、public test で見た数字に特別対応しても通りません。

誤答は意図的に 2 つに分けています。 float の累算は順序依存かつ不正確です。 math.fsum や
事前ソートは順序依存を消しますが、それでも不正確です。 失われたのは加算ではなく、
decimal 文字列が float になった瞬間だからです。 通るのは厳密な演算だけです。 配分も同様で、
合計がちょうど 100.00 になることに加え、**どの行も本当の割合から 1 cent 以上離れない**ことを
要求します。 これが「余りを配った」と「余りを 1 行へ押し付けた」を分けます。

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

任意の実数演算を厳密にしたのではない。 2 桁の金額という 1 つの定義域で、合計を厳密にし、
行の順序に依存させず、各行の割合を本当の値から 1 cent 以内に収めたうえで全体へ戻した。
これは証拠に支えられる範囲を越えない、正確で役に立つ保証である。
