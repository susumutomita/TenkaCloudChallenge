# その domain、本当に割り切れますか

`advanced-cryptography-2026` Week 3。 evaluation domain を渡され、等式を 1 本だけ確かめ、
繰り返す点の上にすべてが静かに載ります。

## この問題が立っている落差

starter は ``omega ** n == 1`` だけを確かめます。 その等式は、より小さい部分群のすべての
元が満たします。 1 さえ満たします。 public test の domain はどれも本物なので、等式だけの
starter は全部通ります。 hidden phase は、等式と位数が食い違う omega を、public test に
出ない素数の上で渡してきます。

これは `ac26-w3-ntt-roots` の消費者側です。 あちらは自分で omega を**導出**する問題、
こちらは**渡された** omega を信じてよいか判定し、そのうえで変換・逆変換・index の並び・
補間を成り立たせる問題です。

## 構成

```
local/starter/fftdomain.py    参加者が編集する 1 枚
local/reference/fftdomain.py  正解 (author image のみ)
local/tests/public/           壊れた starter でも通るテスト
local/tests/hidden/           checkpoint を実際に決める性質
local/mutation.py             reference を 8 通り壊し、すべて検出させる
local/fixtures/generate.py    orientation: field family と、本物・偽物の domain 各 1 つ
local/participant/server.py   Workbench: Portal editor API と、内側へ転送する /verify
local/verifier/server.py      /verify と GET /public。公開しない 2 つ目の container に載る
local/show.py                 `make inspect` — 参加者に見える orientation のみ
```

## hidden 性質の判定方法

checker は位数の検査を定義から書き下して自分で持ちます (reference から import しません)。
どのパラメータ集合も、教科書式 ``3 ** ((p-1)/n)`` がたまたま正しい素数と、形だけの元を
返す素数を半々以上で混ぜてあり、等式 1 本を信じた実装は運ではなく必然で落ちます。
ordering phase は ``f(x) = x`` と単位係数を変換するので、bit-reversal や再帰順の漏れは
そのまま見えます。 補間 phase は domain 上の点を一覧の値と、外の点を checker 自身の
逆変換と突き合わせます。

## 作問者向けコマンド

```bash
make build           # participant image
make test            # local/starter に対する public test
make inspect         # 参加者に見える orientation を表示
make reference-test  # reference が hidden を通り、8 つの mutation がすべて死ぬ
make verifier-up     # 上の 2 つが読む verifier container を起動
make verifier-down   # それを停止
```

## 保証範囲

local modeはself-pacedなhonor-system verificationである。Docker daemonとcompose stackの全containerを
管理する人に対しては、hidden materialの閲覧を防げない。ここでの境界は誤配の防止であって、その人に対する
秘匿ではない。participantがbuildして動かすWorkbench containerが載せるのはstarter、public test、
orientation printerだけで、fixtures、hidden test、reference、verifierは載らない。それらは、Workbenchが
compose networkごしに参照する公開しない2つ目のcontainerと、`make reference-test`がbuildする
author専用imageにだけ存在する。

そのため`make test`、`make test-one`、`make inspect`は先にverifierを起動する（`make verifier-up`が
自動で走る）。`make inspect`はこのdeploymentのfield familyと2つの例domainを、ローカルで計算せずに
compose networkごしに読む。停止は`make verifier-down`。

submissionには時間・memory・process・output capをかける。両containerはnon-root、read-only、
privilege無しで動き、公開されるのはWorkbenchのloopbackのみ。

競技順位・試験・修了判定は**支えません**。その用途にはparticipantが管理しないverifierが必要で、
[#271](https://github.com/susumutomita/TenkaCloudChallenge/issues/271)で追跡している。

## 証明したこと

FFT を速くしたのではない。 渡された domain が本物か — 位数がちょうど n で、n が p-1 を
割るか — を判定し、変換・逆変換・補間が本物の上でだけ成り立つようにした。 これは証拠に
支えられる範囲を越えない、正確で役に立つ保証である。
