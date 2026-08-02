# 誰も witness を持たないまま、証明の半分を組み立てる

秘密分散された witness の上で、 co-SNARK prover の線形部分を share のまま計算する。 witness は一度も組み立てられず、 通信は 1 round も起きない。

Week 6 の最初の問題。 co-SNARK は、 **どの prover も単独では持っていない** witness についての証明を作る。 witness は party 間に秘密分散され、 prover の計算は MPC の上で走る。 この問題はその計算のうち、 通信を 1 round も必要としない半分を書く。

```text
A = Σ_j a_j w_j        B = Σ_j b_j w_j        (mod p)
```

`a` と `b` は公開係数、 `w` は秘密。 加法的 sharing では `Σ_j a_j [w_j]_party = [Σ_j a_j w_j]_party` が party ごとに独立に成り立つので、 公開定数倍と同一 party の share 同士の加算だけで済む。 誰も何も送らない。 次の問題の乗算でこれが崩れることが、 co-SNARK のコストが乗算の数で決まる理由になる。

Week 2 の 2 問 (`ac26-w2-secret-sharing` / `ac26-w2-linear-shares`) は支給される。 違うのは share の型で、 Week 2 が `list[int]` だったのに対しここでは `Share` が party・field・id を持ち、 値は runtime 越しに読む。 誰が何を読んでよいかが授業内容になった時点で、 share を int にしておくことはできない。

participant が受け取る runtime には `reconstruct` が無い。 「再構成して平文で計算して share し直す」 が、 お願いではなく API として書けない形にしてある。 ただしこれは security boundary ではなく instrument で、 `Share._value` は属性 1 つ分の距離にある。 audit が証明できるのは 「その結果が runtime によって、 その party 自身の入力だけから作られた」 ことであって、 「witness が一度も組み立てられなかった」 ことではない。 その差は writeup で明示する。

採点の設計として、 この問題は 24 個の壊れた実装を同梱していて、 そのうち **18 個は A と B を全 shape で正しく復元する**。 `make reference-test` が毎回この数を測る。 内訳は 「値は正しいが正準形でない」 「値は正しいが検めていない」 「値は正しいが自己申告が嘘」 の 3 種で、 prover の出力を見るテストにはどれも見えない。 だから checkpoint は最終値ではなく stage ごとに置く。 なかでも 「witness を再構成して平文で畳んで share し直す」 実装は、 全 seed・全 shape で完璧な A と B を返しながら **audit checkpoint だけ**が落とす。

toy であることも明示しておく。 field は列挙可能な小さい素数、 party は 2〜5、 semi-honest かつ通信路も無い。

## ブラウザでの進め方

1. Participant Portal で問題を起動し、**Browser Workbench** を開く。
2. `inspect` で deploy 固有の fixture と公開された証拠を読む。
3. 画面内の starter を編集し、`test` で公開テストを実行する。
4. 表示された直接回答欄を、inspect と実験結果から埋める。
5. `prepare` で全 checkpoint の提出値を作り、Portal へ貼る。

直接回答は `prepare` により現在の deploy seed へ結び付けられます。

## 学習目標

- public coefficient と secret-shared witness の責任境界を説明できる
- witness vector の shape / field / party count を値を読まずに検証できる
- share 上の加算と公開定数倍だけで線形結合を実装できる
- intermediate A / B を reconstruct せず share として維持できる
- operation DAG から communication round 0 を予測できる
- runtime trace から local operation と communication event を区別できる
- plain-reference 計算と shared computation の意味的一致を確認できる
- coefficient order・witness index・field mismatch の欠陥を診断できる
- provenance の audit が証明できる範囲と、 できない範囲を言い分けられる

## Checkpoint

| Checkpoint | 内容 | Points |
| --- | --- | ---: |
| `relation` | 行を読み、 体の言葉に直す | 30 |
| `witness` | 値を見ずに sharing を検める | 30 |
| `combine-a` | share のまま線形結合を組む | 40 |
| `combine-b` | 行の両半分を、 別々の係数から | 40 |
| `audit` | 結果がどこから来たかを辿る | 50 |
| `trace` | log が言っていることを報告する | 45 |
| `equivalence` | 平文の関係式と一致させる | 40 |
| `transfer` | 見たことのない設定で成立させる | 25 |

## 解説

## 正しい A と B は、 正しい prover の証拠にならない

この問題は 24 個の壊れた実装を同梱していて、 そのうち **18 個は A と B を全 shape・全 label で正しく復元します**。 `make reference-test` が毎回この数を測り、 数が動いたら数のほうを直します。

内訳は 3 つ。 **値は正しいが正準形でない** (`-3` を `94` に直さないまま relation を保存する)。 **値は正しいが検めていない** (party 順が入れ替わった sharing、 別の体の share、 同じ sharing が 2 箇所に入った witness を、 そのまま畳む)。 **値は正しいが自己申告が嘘** (`rounds: 0` を log ではなく信念から返す、 issued を訊かずに主張する)。

このうち 1 つが本題です。

## witness を組み立ててから畳む実装は、 値のテストを 1 つも落とさない

各 sharing を足して `w` を復元し、 平文で `A` と `B` を計算し、 結果を share し直す実装は、 全 seed・全 shape で **完璧に正しい A と B** を返します。 復元値の一致、 rerandomize 不変性、 sparse も signed も unit も、 すべて通ります。

実測すると、 この実装を落とす checkpoint は `audit` **1 つだけ**です (`transfer` が同じ検査を別 seed で再実行する分を除く)。 出力を見るテストで捕まえる方法はありません。 `issued` と `ancestry` が見ているのは値ではなく出自だからです。

## audit が証明できることと、 できないこと

証明できるのは次です。 結果の share は runtime が発行したものであり、 その ancestry を辿ると **その party 自身の入力 share** にしか行き着かず、 refused read は 1 件も無い。 これは本物の性質で、 上の shortcut はここで落ちます。

証明できないのは 「witness が一度も組み立てられなかった」 です。 各 party の scope を順に開いて自分の share を読むのは合法で、 それを全 party 分やれば `w` が手に入り、 そのあと正直に畳めば trace は完全に無害に見えます。 `Share._value` に至っては属性 1 つ分の距離です。 runtime は sandbox ではなく instrument で、 記録しているのは 「その計算が何を消費したか」 であって 「書いた人が何を見たか」 ではありません。

これは実装の穴ではなく、 本物の MPC prover でも同じです。 transcript が示すのは protocol の message pattern であって、 ある party の運用者が witness の写しを持っていなかったことではありません。 後者は暗号ではなく信頼境界と運用の問題で、 混同すると 「MPC を使ったのだから漏れない」 という結論に着地します。

## 「0 round」 は答えであって、 測定ではない

この問題の答えが 0 round であることは、 1 行も書く前に全員が知っています。 だからこそ `rounds: 0` と書いて返す報告には点がありません。 `trace` checkpoint は毎回、 通信 event を含む log を渡します。 3 通の message を 1 round で運んだ log、 5 通を 2 round で運んだ log、 何も運ばなかった round、 この行の委員会の外の party からの message。 信念ではなく log を読んでいれば全部通ります。

`rounds` と `messages` が別の数であることも同じ理由です。 1 round が何通運ぶかは protocol 次第で、 「通信したか」 は違います。

## sparse が dense より難しい理由

`a_j` が掛かるのは witness の位置 `j` であって、 「非零な係数のうち何番目か」 ではありません。 dense な係数ベクトルではこの 2 つは一致するので、 dense だけで書いたコードは静かに通ります。 零係数を飛ばす最適化それ自体は正しく、 飛ばしたぶん `shares` の側も進めてしまうのが誤りです。

## 負の係数は間違いではない

`-3` は `F_97` の元の名前として完全に正しく、 正準な名前ではありません。 下流の演算は毎回 mod p するので `A` と `B` は正しく出ます。 正しく出ないのは、 保存された relation を別の prover が書いた同じ relation と比較したときです。 「同じ主張を証明しているか」 の照合は、 まさにその比較です。

## toy と production の差

ここで書いたものは機構の toy です。 field は列挙できる小さい素数、 party は 2〜5、 敵対者は semi-honest ですらなく単に不在で、 通信路も committed randomness も preprocessing もありません。 本物の co-SNARK は乗算に Beaver triple を使い、 その triple をどこから調達するかが設計の中心になります。 それが次の問題です。

## 対象外

実際の SNARK proof 生成、 malicious-secure MPC、 network transport、 prover 性能最適化。

## 作問・検証

参加者は checkout を必要としません。リポジトリ保守者向けの検証手順は Makefile と CI を正とします。
