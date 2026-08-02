# 暗号文のまま関数を引き、鍵を新品に戻す

Week 5 の 5 問が作った部品を 1 本の Programmable Bootstrapping につなぎ、 最後に暗号文のまま NAND を評価する。 復号は 1 回も起きない。

Week 5 の総合問題。 encoding/noise・LWE/RLWE・RGSW/external product・CMUX/blind rotation・sample extraction/key switching の 5 問が作った部品はすべて支給され、 この問題はそれらをつなぐ pipeline そのものと、 その上で 1 つのゲートを評価する部分を書く。

bootstrapping を「noise を消す処理」とだけ覚えると、 なぜ関数が引けるのかも、 なぜ引ける関数に条件があるのかも説明できない。 実際に起きているのは、 暗号化された phase に対して lookup 関数を評価し、 出力を新しい鍵と domain へ戻す一連の変換で、 出てくる暗号文の noise が入力の noise を一切含まないことが「refresh」の中身。

encoding が前問までと変わる。 `encode(1) = +q/8`、 `encode(0) = -q/8` の balanced encoding では復号が符号判定そのものになり、 符号判定は negacyclic rotation が `X^N = -1` によって無料で計算してくれる。 「PBS は任意の関数を評価できるわけではない」の具体的な中身はここにある。

lookup table の上半分には `f(0)` ではなく `1 - f(0)` を書く。 rotation の巻き戻りが係数 0 に負号を付けて渡すからで、 balanced encoding では `-encode(x)` が `encode(1 - x)` になる。 これを間違えると 4 つの unary 関数のうち出力が定数でないものが `m = 0` 側だけ反転し、 真理値表の半分だけが壊れる。

各 stage は数値だけでなく「その数値がどこに属するか」も返す。 kind・keyId・dimension・modulus・parameterSetId・noiseBound の 6 つで、 うち 2 つは pipeline の途中で変わる。 extraction は暗号文を ring secret の側 (次元 degree) へ移し、 key switching が元へ戻す。 正しい数値に間違ったラベルを付けた stage は、 次の stage が合わない暗号文と黙って結合する材料を作る。

HomNAND は前処理が本体になる。 `(0, q/8) - c1 - c2` という 1 回の線形結合で、 4 通りの入力に対する phase が `3q/8, q/8, q/8, -q/8` になり、 `(1,1)` のときだけ負になる。 あとは identity table で 1 回 bootstrap するだけ。 平文の NAND はどこにも現れず、 lookup table の中にゲートは無い。

採点の設計として、 この問題は 37 個の壊れた実装を同梱していて、 そのうち **21 個は真理値表が完全に通る**。 全 unary 関数・両 message・NAND 全 4 行を、 全 parameter set で。 それでも 21 個とも壊れた pipeline のままで、 内訳は「数値は正しいがラベルが違う」「答えは正しいが自己申告が嘘」「たまたま当たっている」の 3 種。 最終ビットを見るテストにはどれも見えない。 だから採点は最終ビットではなく stage をその場で見て、 trace は artifact の digest で照合する。 pipeline の stage は 10 個で hidden test は 10 個すべてを別々に採点し、 scored checkpoint はそのうち結び付きの強い 2 組をまとめた 8 個 (multi-verify 契約の上限)。

これは安全ではない。 パラメータは全列挙でき、 両方の secret は線形代数で復元できる。

## ブラウザでの進め方

1. Participant Portal で問題を起動し、**Browser Workbench** を開く。
2. `inspect` で deploy 固有の fixture と公開された証拠を読む。
3. 画面内の starter を編集し、`test` で公開テストを実行する。
4. 表示された直接回答欄を、inspect と実験結果から埋める。
5. `prepare` で全 checkpoint の提出値を作り、Portal へ貼る。

直接回答は `prepare` により現在の deploy seed へ結び付けられます。

## 学習目標

- input LWE ciphertext の phase と lookup accumulator の対応を説明できる
- target function を accumulator polynomial へ encode できる
- blind rotation で暗号化された入力に応じた lookup 位置を選択できる
- sample extraction と key switching で output LWE へ戻せる
- PBS 前後で message function f(m) が正しく評価されることを確認できる
- toy noise metric で input noise と output noise を比較できる
- bootstrapping が復号ではないことを説明できる
- HomNAND の前処理・PBS lookup・decode を一続きで構成できる
- 全 4 入力と未知のパラメータで一般化できる
- toy implementation の省略点と production TFHE との差を明示できる

## Checkpoint

| Checkpoint | 内容 | Points |
| --- | --- | ---: |
| `lut` | 関数を多項式に書く | 30 |
| `domain` | 回転の単位へ移す | 25 |
| `rotate` | 暗号化されたまま回す | 40 |
| `relabel` | 鍵の所属を付け替える | 50 |
| `evaluate` | 暗号文のまま関数を引く | 40 |
| `refresh` | 何が起きたかを記録する | 30 |
| `nand` | ゲートを組んで真理値表をそろえる | 60 |
| `transfer` | 見たことのない設定で成立させる | 25 |

## 解説

## 真理値表が通っても、 通っただけ

この問題は 37 個の壊れた実装を同梱しています。 そのうち **21 個は真理値表が完全に通ります**。 全 unary 関数、 両 message、 NAND の全 4 行を、 全 parameter set で。 それでも 21 個とも壊れた pipeline です。 `make reference-test` は毎回この数を測り、 動いたら落ちます。

内訳は 3 つ。 **数値は正しいがラベルが違う** (extraction が入力の keyId を残す、 次元を入力側で報告する、 出力を RLWE と名乗る)。 **答えは正しいが自己申告が嘘** (trace の noise が全部 0、 accumulator が message を持つと主張、 出力 bound が入力 noise とともに増える)。 **たまたま当たっている** (係数 1 を取り出しても lookup table が半分ごとに定数なので大抵同じ値、 切り捨てても correctness budget が吸収する)。

stage 単位の checkpoint を 10 個も置いているのは、 この 21 という実測値が理由です。 22 個目 — `nand_combine` の `q/8` 落ち — は seed によって見えたり見えなかったりするので、 固定の数には入れていません。

## identity table は何も見せない

`f = identity` の lookup table は下半分が `encode(f(1)) = encode(1)`、 上半分が `encode(1 - f(0)) = encode(1)` で、 全係数が同じ値になります。 定数多項式は rotation がどこに着地したかを区別できないので、 半分の入れ替えも、 取り出す係数の間違いも、 丸めではなく切り捨ても、 すべて通ります。 public test が全部 identity なのはそれを見せるためです。

## refresh は「noise が減ること」ではない

出力の noise bound は blind rotation の分と key switch の分の和で、 入力の noise は項として現れません。 減るのではなく**入力に依存しなくなる**。 だから出力をもう一度 bootstrap できて、 だから回路が組めます。 trace の noise 列を上から読むと、 どの行で入力への依存が切れるかが見えます。

## 正解を返しても domain が違えば壊れている

extraction が入力の keyId をそのまま残すと、 数値は正しいのにラベルが違う暗号文ができます。 その switching key がたまたま合っているので pipeline は端から端まで動き、 回路の中で別の暗号文と結合された瞬間に壊れます。 artifact の envelope はこの種の欠陥のために存在していて、 真理値表からは見えません。

## ゲートは lookup table の中に無い

HomNAND の lookup table は identity です。 4 通りの入力すべてで同じ table を使い、 4 行を分けているのは前処理の線形結合が作った phase の符号だけ。 bootstrap は符号を新しい暗号文に変換しているだけで、 ゲートそのものは `(0, q/8) - c1 - c2` の側にあります。

この `q/8` を落とすと `(0,1)` と `(1,0)` の phase がちょうど 0 になり、 答えが noise の転び方で決まります。 40 seed で測ると、 この 2 行への 80 回の試行のうち 12 回が誤り、 残り 2 行は 1 度も間違いません。 7 回に 1 回落ちる定数の書き忘れは、 バグではなく flakiness に見えます。

## 3 行で正しいのは正しさではない

NAND の 4 行のうち 0 を返すのは `(1,1)` だけなので、 定数 1 を返す実装は 75% 正しい。 hidden test が毎回 4 行すべてを回すのはそのためです。

## correctness bound を超えたときに起きること

入力の noise が bound を超えると bootstrap は劣化しません。 **逆のビット**を、 自信を持って、 新しい小さな noise とともに返します。 壊れた暗号文ではなく、 間違った答えの正しい暗号文が出てくる。 FHE の failure mode として覚えておく価値があるのはこちらです。

## toy と production の差

ここで書いたものは機構の toy です。 production の TFHE は FFT/NTT で多項式積を回し、 bootstrapping key を圧縮し、 パラメータは lattice reduction に対する安全性から逆算します。 この問題のパラメータは全列挙でき、 両方の secret は線形代数で復元できます。 gate 1 回あたりの計算量も、 実用的な bootstrapping key のサイズも、 任意の多ゲート回路のコンパイルも対象外です。

## 対象外

production TFHE の security / performance、 最適化された FFT / NTT / SIMD、 bootstrapping key のサイズ最適化、 任意の multi-gate circuit compiler。

## 作問・検証

参加者は checkout を必要としません。リポジトリ保守者向けの検証手順は Makefile と CI を正とします。
