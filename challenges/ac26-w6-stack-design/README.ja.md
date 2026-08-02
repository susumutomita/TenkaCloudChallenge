# 部品はどれも正しい。 つないだものが正しくない

primitive が検証できるのは **渡されたものの形** だけである。 MPC engine は share かどうかを見るが、 それが secret のはずだったかは知らない。 zkVM は guest が走ったことを言うが、 journal が読み手の持っている program の話かは言わない。 部品の test は全部通り、 architecture は壊れている。 その **composition failure** を 9 通りの角度から診断する。

Week 6 の最後、 track の synthesis 問題である。 前の 5 問はそれぞれ **動く部品** を 1 つ作った。 この問題はその**あいだの配線**を扱う。

出発点は 1 行である。

```text
primitive が検証できるのは、 渡されたものの「形」だけである
```

これは primitive の欠陥ではない。 primitive とはそういうものである。 MPC engine は届いたものが share であることを検証する。 それが secret のはずだったか、 相手が同じ field だと思っているか、 復元してよいと open policy が言ったかは、 知りようがない。 zkVM は guest が走ったことを検証する。 その journal が読み手の持っている program についてのものかは検証しない。 FHE の評価は渡された鍵の下で正しく、 その鍵が間違っていたことは教えられない。

だから **部品の test は全部通り、 architecture は壊れている**。

## 3 段の contract

```text
LICENCE      その transformation が何を変えてよいか
policy       その node がその transformation を持つことをこの architecture が承認したか
obligations  この architecture が「どの wire に何を届ける」と約束したか
```

3 段は別の段である。 licensed な変更が correct な変更とは限らない — key switch は key domain を変えてよいが、 **何に変えるべきかを間違えない**こととは別である。 そして違反した box を承認し直せば contract は 1 手で満たされる。 それは repair ではなく、 deployment が自分で合格基準を書き換えたということである。

## 13 の deployment

毎 seed、 3 つの健全な architecture と、 そこから **1 箇所だけ**変えた 13 の deployment が引かれる。 11 個は 11 の boundary class をちょうど 1 つずつ踏む。 12 個目は licensed でない operation を承認されていない node に置く。 13 個目は **contract を 1 つも破らない** — すべての境界が成立していて、 primitive が消費できない形を握らされている。 contract が design review の代わりにならないことを、 1 つの deployment で言い切るためにある。

## 採点の設計

この問題は 53 個の壊れた stack を同梱していて、 そのうち **47 個は 「健全な architecture には何も出さず、 壊れた architecture には何か出す」 という誰でも書く 2 問に正しく答える**。 `make reference-test` が毎回この数を測り直す。 その 2 つは問題文にそのまま書いてあるので誰も発見する必要がない。 残りが checkpoint になっているのはそのためである。

## checkpoint が 9 でなく 8 である理由

Issue #244 は 9 つ要求している。 multi-verify の上限は 8 で、 catalog 側の SCHEMA.json と platform 側 `packages/problem-sdk` の両方で強制され、 **9 個目は truncate されず scoring object ごと破棄される** — つまり 9 つ宣言すると残り 8 つも一緒に落ちて問題が採点不能になる。 そこで 2 つを 1 つの checkpoint に束ねた。 隣り合っていたからではない: 「どの wire が何を運んでいるか」 と 「primitive の保証がどこで終わるか」 は、 同じ typed graph を読む 1 つの行為である。 hidden phase は 9 のままで、 `dataflow` だけが 2 つ動く。

## ブラウザでの進め方

1. Participant Portal で問題を起動し、**Browser Workbench** を開く。
2. `inspect` で deploy 固有の fixture と公開された証拠を読む。
3. 画面内の starter を編集し、`test` で公開テストを実行する。
4. 表示された直接回答欄を、inspect と実験結果から埋める。
5. `prepare` で全 checkpoint の提出値を作り、Portal へ貼る。

直接回答は `prepare` により現在の deploy seed へ結び付けられます。

## 学習目標

- primitive implementation と primitive の上の application computation を区別できる
- zkVM guest・MPC 上の prover computation・FHE 上の encrypted evaluation の実行場所を比較できる
- public input・private witness・secret share・ciphertext・proof artifact の domain を追跡できる
- correctness・soundness・privacy・binding・availability を別の end-to-end property として評価できる
- operation が何を変えてよいか (licence) と、 どの node がそれを持ってよいか (policy) を別の段として扱える
- architecture が届けると約束したものを、 licensed な変更と別に検証できる
- fan-in node で classification・identity・その他の merge 規則を使い分けられる
- primitive 間の serialization / field / key / statement mismatch を検出できる
- primitive 単体が安全でも composition が安全とは限らないことを counterexample で示せる
- 複数の downstream error があるとき、 値が届く順で最初に破れた boundary を特定できる
- policy と約束を書き換えない範囲で、 最小の変更で property を回復できる
- trust domain の分離と通信量の予算を、 値ではなく配置についての boundary として扱える
- use case から primitive 選定・公開情報・秘密情報・trust assumption・主要 cost を導ける
- 見たことのない deployment で同じ判断がすべて成立することを確かめられる

## Checkpoint

| Checkpoint | 内容 | Points |
| --- | --- | ---: |
| `dataflow` | 何がその wire を渡っていて、 primitive の保証はどこで終わるか | 45 |
| `properties` | どの wire がどの property を担っているか | 30 |
| `contracts` | 5 種類の違反があり、 それは 5 種類である | 50 |
| `diagnosis` | どれが最初に壊れたのか | 30 |
| `counterexample` | どの部品も壊さずに 1 つ落とす | 45 |
| `repair` | 要求を下げずに戻す | 45 |
| `selection` | まだ誰も作っていないものに stack を選ぶ | 30 |
| `transfer` | 見たことのない field・statement・program・brief で | 25 |

## 解説

## 部品が検証できないもの

MPC engine は届いたものが share であることを検証します。 それが secret のはずだったか、 相手が同じ field だと思っているか、 復元してよいと open policy が言ったかは検証できません。 zkVM は guest が走ったことを検証し、 journal が読み手の持っている program についてのものかは検証しません。 FHE の評価は渡された鍵の下で正しく、 鍵が間違っていたことは言えません。

この問題の 9 つの角度はすべてその 1 行の帰結です。

## 3 段を混ぜないこと

`LICENCE` は operation についての事実、 `policy` は誰がそれを実行してよいかについての事実、 `obligations` は何を届けると約束したかについての事実です。 3 つが別々であることは repair checkpoint で効いてきます。 secret を開いた node を承認し直せば contract は 1 手で満たされ、 それは repair ではありません。 obligations を削っても同じで、 同じ手口です。

## fan-in には fan-in の規則がある

node が 2 入力を持つとき、 それは値を変換していません。 **merge** しています。

```text
classification  secret が勝つ。 secret の関数は secret だから
identity        持ち越してよいが、 発明してはいけない
それ以外         持っている入力どうしが一致していなければならない
```

`zkvm-exploit` がこれを具体化します。 public な statement と secret な witness が 1 つの node で出会い、 出ていく値は secret でその statement についてのものです。 出力を入力 1 つずつと比べる contract は、 この edge を 2 件の違反と呼びます。 それはモデル化しようとしている architecture を表現できないモデルです。

## 「最初」は id 順ではありません

stack は 1 度壊れ、 そのあと壊れ続けます。 下流の症状はどれも本物で、 そこを狙った repair は何もしません。 3 つの deployment では、 値が届く順の最初と id 順の最初が**違う edge** です。 偶然の一致に寄りかかった解は、 より小さい問題の解です。

## counterexample は「壊す」ことではありません

部品の自前の check は `CONSUMES` がすべてです。 届いたものの**形**を読み、 それ以外は何も読みません。 classification も key domain も identity も dialect も、 部品を素通りします。 だから 1 箇所変えるだけで、 **すべての部品が満足したまま** end-to-end property を落とせます。 counterexample とは何かが動かなくなったことではなく、 **どの部品も見ていなかった**ことです。

## 5 つ目の property

property map は 5 つの key を返します。 そのうち 1 つは、 この 3 つの architecture のどの wire も運んでいません。 flight 中の値に何をしても失われないからで、 それを失うには計算を別の場所に置くしかありません。 空の tuple がその答えです。 **常に何かを見つける監査は、 読んでいるのではありません。**

## contract を 1 つも破らない deployment

13 個のうち 1 つは、 すべての境界が成立していて、 primitive が消費できない形を握らされています。 licensed でない変更はなく、 破られた約束もなく、 それでも動きません。 repair checkpoint が「すべての contract が成立する」ことと「すべての部品が渡されたものを実行できる」ことを別々に要求するのはこのためです。 前者だけで止まる repair は、 contract を design review の代わりにしています。

## 実測

この問題は 53 個の壊れた stack を同梱していて、 そのうち **47 個は 「健全な architecture には何も出さず、 壊れた architecture には何か出す」 に正しく答えます**。 `make reference-test` が毎回測り直します。 その 2 つは問題文にそのまま書いてあるカテゴリで、 誰も発見する必要がありません。

## 監査が証明できることと、 できないこと

証明できるのは、 同梱された 53 個の欠陥をこの 8 checkpoint が捕まえること、 reference が全部を通ること、 出荷される starter が 1 つも通らないことです。 証明できないのは 「このモデルに他の穴が無い」 ことです。

## toy と production の差

node は 8〜9 個、 edge は 7〜9 本、 attribute は 5 つ、 boundary class は 11 個です。 実際の stack では node は数百あり、 attribute は proof system と ciphertext scheme のパラメータすべてで、 boundary class はその deployment が書き下した数だけあります。 主張しているのは 「境界の contract は exact に書ける」 ことであって、 「ここに書いたものが完全である」 ことではありません。

## 対象外

実際の MPC / zkVM / FHE の実行、 特定 protocol の security proof、 proof system の soundness、 実運用の鍵管理、 network レベルの可用性。

## 作問・検証

参加者は checkout を必要としません。リポジトリ保守者向けの検証手順は Makefile と CI を正とします。
