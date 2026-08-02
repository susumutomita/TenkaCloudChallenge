# 誰も知らない角度で回す

暗号化されたビットで 2 つの暗号文から一方を選び、 それを繰り返して暗号化された量だけ多項式を回す。 回転量はループの中の誰も知らない。

Week 5 の 4 問目。 CMUX と単項式回転を実装し、 その 2 つを鎖にして blind rotation を完成させる。

環・RLWE・RGSW・external product は支給される。 それらは ac26-w5-lwe-rlwe と ac26-w5-rgsw-external の成果物で、 この問題は選択そのものと、 その選択が積み上がる先。

CMUX は `ct0 + ExternalProduct(c, ct1 - ct0)` の 1 行。 selector 0 なら ct0、 1 なら ct1 の平文になり、 分岐は存在しない。 両方の候補を毎回計算するのは無駄ではなく機構そのもので、 片方だけ計算するにはどちらが要るかを知る必要がある。

平文 modulus は 4 にしてある。 これは判定を担う。 negacyclic な回転は degree N を跨ぐたびに係数を反転させるが、 平文 modulus が 2 だと `-delta == delta (mod q)` で符号反転が**見えない**。 `X^N = -1` を完全に無視した実装が満点を取れてしまう。 4 なら反転は `m -> (-m) mod 4` として平文に出る。

回転の指数は 2N を法として正規化する。 `X^(2N) = 1` だから N ではなく 2N であり、 N で割った余りを取ると失われるのはちょうど符号。 それが circular shift との差。

blind rotation は LWE sample `(mask, body)` を Z_(2N) の上で受け取り、 `phase = body - <mask, secret>` の指数へ辿り着く。 secret は渡らない。 body は公開値なので最初の offset 回転に CMUX は要らず、 残りは bootstrapping key の各行が担う。

採点の設計として、 回転方向をすべての場所で一貫して逆にした実装は自分自身とは完全に整合し、 ループを自分の部品と突き合わせても通る。 だから blind rotation は phase から平文で計算した別モデルと比較する。 そのモデルは submission の関数を 1 つも呼ばない。

これは安全ではない。 パラメータは全列挙でき、 secret は線形代数で復元できる。

## ブラウザでの進め方

1. Participant Portal で問題を起動し、**Browser Workbench** を開く。
2. `inspect` で deploy 固有の fixture と公開された証拠を読む。
3. 画面内の starter を編集し、`test` で公開テストを実行する。
4. 表示された直接回答欄を、inspect と実験結果から埋める。
5. `prepare` で全 checkpoint の提出値を作り、Portal へ貼る。

直接回答は `prepare` により現在の deploy seed へ結び付けられます。

## 学習目標

- CMUX を external product の 1 行として実装できる
- selector 0 / 1 で選ばれる分岐が切り替わることを確認できる
- 単項式の積が negacyclic な回転になることを説明できる
- 回転の指数を 2N を法として正規化できる
- 暗号化されたビットで回転するか保持するかを選べる
- LWE mask を使った conditional rotation を積み重ねられる
- blind rotation の結果を平文の参照モデルと突き合わせられる
- toy 実装と production の blind rotation の差を明記できる

## Checkpoint

| Checkpoint | 内容 | Points |
| --- | --- | ---: |
| `combine` | 暗号文を足し引きする | 25 |
| `cmux` | 暗号化されたビットで選ぶ | 45 |
| `constant` | 平文で分岐していないことを示す | 35 |
| `rotate` | 単項式で回す | 40 |
| `conditional` | 回すか保つかを選ぶ | 35 |
| `blind` | 誰も知らない量だけ回す | 55 |
| `trace` | 積み上がりを見せる | 35 |
| `transfer` | 見たことのない設定で成立させる | 30 |

## 解説

## 両方計算することが機構

CMUX は `ct0 + ExternalProduct(c, ct1 - ct0)`。 external product が `RLWE(0) + mu * (ct1 - ct0)` を返すので、 和は mu が 0 なら ct0、 1 なら ct1 になる。 どちらの場合も fresh noise が乗るため出力は新しい暗号文であり、 入力のどちらでもない。

必要な候補だけ計算する実装は、 どちらが必要かを知っていなければ書けない。 両方計算するのは無駄ではなく、 暗号化されたまま選べる理由そのもの。

## 平文 modulus 4 は判定を担う

negacyclic な回転は degree を跨ぐたびに係数を反転する。 平文 modulus が 2 だと `-delta` と `delta` が mod q で同じ値なので、 この反転は平文に出ない。 `X^N = -1` を無視して circular shift を書いた実装が全部通ってしまう。 4 にすると反転は `m -> (-m) mod 4` として現れ、 1 と 3 が動く。

## 2N であって N ではない

`X^(2N) = 1` なので指数の法は 2N。 N で割った余りを取ると、 落ちるのはちょうど「何回巻いたか」の偶奇 — つまり符号。 circular shift との差は全部そこにある。

## 一貫して逆な実装は自分では捕まらない

`monomial_rotate` の方向とループの方向を両方逆にすると、 ループを自分の `conditional_rotate` と突き合わせるテストは通る。 public test の最後の 1 つがまさにそれで、 何も証明していない。

だから hidden test は phase から平文で回転を計算した別モデルと比較する。 そのモデルは submission の関数を 1 つも呼ばない。

## 候補が一致する退化ケース

mask の係数が 0 のとき 2 つの候補は同じ暗号文になり、 差はゼロ、 その桁もゼロ、 external product はゼロ暗号文そのものになる。 出力は候補と bit 単位で一致する。 これは平文分岐ではなく、 分岐する対象が最初から無かったということ。 mask の係数は Z_(2N) から引くので、 これは 2N 回に 1 回起きる。

## body は公開値

secret は LWE の秘密ビットだけで、 body は違う。 だから最初の offset 回転に CMUX は要らない。 trace の step 0 が `phase-offset` なのはそれを示すためで、 公開部分と暗号化された部分の境目がそこにある。

## 対象外

sample extraction と key switching (次の問題)、 programmable bootstrapping と HomNAND (その次)、 modulus switching、 constant-time 保証、 最適化された blind rotation。

## これは安全ではない

パラメータは全列挙でき、 secret は線形代数で復元できる。 機構の toy であって困難性の toy ではない。

## 作問・検証

参加者は checkout を必要としません。リポジトリ保守者向けの検証手順は Makefile と CI を正とします。
