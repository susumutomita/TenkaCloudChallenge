# その domain、本当に割り切れますか

## 重複する点では、元の式に戻せない

あなたは、証明に使う計算表の入力検査を担当します。渡された点の並びに重複があると、計算結果から元の式を取り戻せません。`fftdomain.py`の判定を直し、使える並びだけで計算するようにします。

**最初の操作：**「起動」→ 問題エディタの「証拠を確認」。点の並びを見比べ、`fftdomain.py`の`_domain_ok`を編集します。「公開テストを実行」は下見、各項目の「提出」は採点です。公開テストは最初のコードでも通るので、緑だけで入力検査の完成とは判断しません。

## 前提 — まず、4個の点を作る

数は素数`p`で割った余りにします（`mod p`、Pythonでは`% p`）。例えば`7 % 5 = 2`。以下の表も毎回5で割った余りです。

`omega`（ω）は繰り返し掛ける数、`n`は欲しい点数です。1から始めて並べます。

| 掛けた回数 | 0 | 1 | 2 | 3 | 4 |
|---|---:|---:|---:|---:|---:|
| omega=2 | 1 | 2 | 4 | 3 | 1 |
| omega=4 | 1 | 4 | 1 | 4 | 1 |

**位数**は、初めて1へ戻るまでの回数です。2の位数は4、4の位数は2。4個欲しいなら上の列は使え、下の列は重複して使えません。どちらも4回後には1なので、それだけ確かめる判定では足りません。

**評価点**は式に代入する数。その並びを**評価領域（evaluation domain）**と呼びます。使う点は`[1, omega, omega², …, omegaの(n−1)乗]`。`…`は同じ規則の続きです。

一般には、素数pで位数nのomegaが存在する条件は、nがp−1を割り切ること。ただし条件を満たすnでも、渡されたomegaが正しいとは限りません。**1からomegaを掛け、初めて1へ戻る回数がnか確かめます。** n回までに戻らない、途中で戻る、omegaの余りが0、はいずれも使えません。n=1ならomegaの余りが1のときだけ使えます。

## 係数 ↔ 点での値

`f(x)=1+2x+3x²+4x³`のように、数とxの累乗を足した式が**多項式**。掛ける数`[1,2,3,4]`が**係数**です。最大の指数3を**次数**と呼びます。係数がn個なら、次数はn未満です。

```text
係数 [1,2,3,4] ── 各点を式に代入 ─→ 値 [0,4,3,2]
               ←── 逆変換 ──────
                   点 [1,2,4,3] / p=5
```

例えば`f(2)=1+4+12+32=49`、5で割った余りは4なので、2番目の値は4です。

一般の式は`f(x)=a0+a1×x+…+a(n−1)×xの(n−1)乗`。位置iを0から数え、`values[i]=f(omegaのi乗)`の余りにします。値を並べ替えてはいけません。

逆変換では、**逆元**（掛けると余りが1になる数）を使います。Pythonでは`pow(t,-1,p)`。omegaの逆元をu、nの逆元をvとすると、係数の位置jは、

```text
a[j] = v × (values[0] + values[1]×uのj乗
             + values[2]×uの(2j)乗 + …)
       をpで割った余り
```

括弧内は、値の列を係数と見て、点uのj乗を代入した計算です。例えばp=5,n=2,omega=4で、係数[1,2]→値[3,4]。u=4,v=3なので、戻す係数は`(3+4)×3`の余り1と`(3+4×4)×3`の余り2です。

**補間**は点での値から式を取り戻すこと。`ifft`で係数へ戻し、その式を`_evaluate`でpointに代入すれば、元の点でも別の点でも答えられます。

この変換を速く計算する方法が**FFT（高速フーリエ変換）**です。この課題の関数名は`fft`ですが、各点を順に代入する実装で構いません。速さより、点の検査と正しい往復を扱います。深めるなら、`f(x)=E(x²)+x×O(x²)`と偶数番・奇数番の係数に分けると、xと−xで同じ部分計算を使い回せます。これは答えを変えずに計算回数を減らす工夫です。

## 編集する関数と返す値

編集するのは`fftdomain.py`だけです。入力検査、`_evaluate`、4関数の骨組みは用意されています。辞書の`ok`は処理できたか、`valid`は点の並びが使えるかを表します。

| 関数 | 成功したときの辞書 |
|---|---|
| validate_domain(prime,order,omega) | {"ok": True, "valid": TrueまたはFalse} |
| fft(coefficients,omega,prime) | {"ok": True, "values": 値の列} |
| ifft(values,omega,prime) | {"ok": True, "coefficients": 係数の列} |
| interpolate_and_evaluate(values,omega,point,prime) | {"ok": True, "value": pointでの値} |

不正な形式は`{"ok": False, "error": 名前}`で返します。True/Falseは整数入力に含めません。

| 名前 | 条件 |
|---|---|
| invalid_prime | primeが3〜1,000,003の素数の整数でない |
| invalid_order | orderが1〜4096の整数でない |
| invalid_omega | validate_domainのomegaが整数でない |
| invalid_coefficients / invalid_values | 対応する列が長さ1〜4096のリストでない、または要素が0以上prime未満の整数でない |
| invalid_point | pointが0以上prime未満の整数でない |
| invalid_domain | fft/ifft/補間で、omegaから必要な個数の違う点を作れない |

形式が正しい`validate_domain(5,3,2)`はエラーではなく`valid: False`です。omegaの整数は先にprimeで割った余りへ直して扱います。

## 5つの採点項目

| 項目 | なぜ必要か | 得点 |
|---|---|---:|
| domain | 重複する点を拒否し、偽物では計算しない | 40 |
| roundtrip | 変換して戻すと元の係数になる | 40 |
| ordering | 点と値の位置を対応させる | 30 |
| interpolate | 元の点以外にも同じ式で答える | 45 |
| generalize | 別の素数・長さ・入力形式にも同じ規則を適用する | 45 |

各「提出」は、その時点のエディタのコードを送ります。後の項目は前の性質も確認します。失敗時は示された性質を直して再提出します（誤答減点は項目に表示）。5項目すべて通れば完了です。

「証拠を確認」では、使う素数、使えるn、本物と重複する例が見えます。表の意味は上と同じなので、大きい数でも各段階で余りを取りながら追えます。「初期状態に戻す」は編集を最初へ戻します。

この検査は証明そのものではなく、証明の計算に使う土台の検査です。次のWeek 4では、このような点の並びに計算表を載せて式へ直します。


---

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


## 実行環境

Python標準ライブラリの次のモジュールを使えます：`collections, copy, dataclasses, decimal, enum, fractions, functools, hashlib, hmac, itertools, json, math, operator, random, re, statistics, time, typing`。追加パッケージのインストールは不要です。採点用のファイルや別プロセスの内容へのアクセス、外部通信、新しいプロセスの作成はできません。この一覧以外のモジュールは読み込めない場合があります。


## 作問者の実行検証とリソース

`make runtime-test`は正しい解答と不正な出力の境界を検査し、`make reference-test`は実際の採点器で誤実装を検出します。公開・非公開テストの親プロセスが判定し、提出コードからは関数の結果だけを受け取ります。計算25秒、子プロセスのアドレス空間512 MiB、プロセス数64、出力64 KiBを上限とします。HTTP本文の読み込みは15秒、採点の転送は計算時間を含めて30秒です。実施内容と限界はlocal/tests/hidden/READER.mdに記録しています。

ローカルではDockerホストのCPU・メモリ・イメージ領域を使います。プラットフォームへの配置では、ホストのAWS計算資源・ストレージ・設定されたログ資源も使います。実AWSの配置や料金はここでは検証していません。イベントのRegionと終了手順に従ってください。`make verifier-down`でローカルの両サービスを止められますが、イメージは残ります。コンテナ停止だけでイベント用ホストも停止したとは判断しません。
