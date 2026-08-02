# 多項式にしただけでは証明ではない

「プログラムを証明する」とき、実行そのものは証明に入らない。小さな状態機械の trace を有限体上の多項式関係へ変換し、変換が何を失わないか、何を保証しないかを確かめる。

Week 4 の 1 問目。 Week 4 の教材は pinned commit 時点で未公開のため、 公開されている主題 (ZKP) だけを手がかりに、 Week 1 の constraint と Week 3 の有限体を新しい設定へ転用する bridge 問題として作ってある。 role は transfer で、 GOVERNANCE.md §6 が未公開週の companion に許す 2 つの role のうちの 1 つ。 公式課題が何を要求するかについては何も主張しない。

題材は 2 列・2 規則の状態機械。 計算そのものは重要ではなく、 「これが走ったことを証明する」 が 「これらの多項式関係が これらの点で消える」 へ変換される過程が主題。

中心にあるのは 2 種類の制約が別の仕事をしていること。 transition 制約は 「各行が前の行から従う」 としか言わない。 boundary 制約が 「どこから始まったか」 を言う。 一方が他方を含意しないので、 boundary を落とした系は同じ機械を別の初期状態から走らせた trace で完全に充足される — 多項式は等しく正しく、 別の文の証明になっている。 underconstrained checkpoint はこの trace を participant に構成させる。

evaluation domain は単位根の冪で、 行と点が順序どおり対応する。 素数は steps が p-1 を割るものだけを選んである。

これは証明系ではない。 commitment も verifier の乱数も無く、 何に対しても健全ではない。 arithmetization への橋であって、 その先ではない。

## ブラウザでの進め方

1. Participant Portal で問題を起動し、**Browser Workbench** を開く。
2. `inspect` で deploy 固有の fixture と公開された証拠を読む。
3. 画面内の starter を編集し、`test` で公開テストを実行する。
4. 表示された直接回答欄を、inspect と実験結果から埋める。
5. `prepare` で全 checkpoint の提出値を作り、Portal へ貼る。

直接回答は `prepare` により現在の deploy seed へ結び付けられます。

## 学習目標

- 決定的な計算から execution trace を生成できる
- 状態遷移を隣接行の制約として書ける
- 初期状態の固定を boundary 制約として分離できる
- trace の列を有限体上の多項式へ補間できる
- 制約違反がどの行・どちらの制約に現れるかを追跡できる
- trace を 1 箇所改ざんした反例を検出できる
- 多項式にしただけでは証明にならないことを説明できる

## Checkpoint

| Checkpoint | 内容 | Points |
| --- | --- | ---: |
| `trace` | 実行 trace を作る | 30 |
| `transition` | 隣り合う行の関係を式にする | 40 |
| `boundary` | どこから始まったかを固定する | 30 |
| `interpolate` | 列を多項式にする | 45 |
| `compose` | domain 上で関係が消えることを見る | 40 |
| `locate` | 最初に壊れた行を特定する | 40 |
| `underconstrained` | 多項式が正しくても文が違う例を作る | 45 |
| `transfer` | 見たことのない設定でも成立させる | 30 |

## 解説

## 変換は健全性を足さない

trace を多項式に補間しても、 それだけでは何も保証されない。 補間は表現を変える操作であって、 検証の力は制約が担っている。 「多項式になったから証明だ」 は、 表を CSV から JSON にしたら正しくなった、 と言うのに近い。

## 2 種類の制約は別の仕事をしている

transition 制約は 「各行が前の行から従う」 と言う。 boundary 制約は 「どこから始まったか」 と言う。 一方が他方を含意しない。

boundary を落とすと、 系は同じ機械を**別の初期状態から**走らせた trace で完全に充足される。 遷移はすべて成り立ち、 residual はすべて 0 で、 多項式は等しく正しい。 それは別の文の証明である。 underconstrained checkpoint で構成するのはこの trace で、 これが 「制約を 1 本落とす」 の具体的な意味になる。

## residual の本数

transition residual は隣接する行の対ごとに 1 本なので、 行数より 1 少ない。 行ごとに 1 本作る実装は、 最後の行を存在しない次の行と比べている。 mutation suite の 1 つはこれで、 IndexError で落ちる。

## 違反はどの行に現れるか

i 番目の遷移が作るのは行 i+1 なので、 最初に壊れる行は i+1 である。 i と報告する実装は、 直す場所を 1 行間違えて教える。

行 0 には前の行が無い。 そこで壊れうるのは boundary だけで、 それを transition 違反と呼ぶと、 やはり間違った場所を指す。 だから boundary を先に見る。

## evaluation domain

domain は単位根の冪で、 行 i が点 g^i に対応する。 隣り合う行が隣り合う点になるので、 遷移制約は 「x での多項式」 と 「次の点での同じ多項式」 の関係として書ける。 素数は steps が p-1 を割るものだけを選んである。 そうでなければ、 その位数の単位根が存在しない。

## これは証明系ではない

commitment が無く、 verifier の乱数が無く、 したがって何に対しても健全ではない。 arithmetization までの橋であって、 その先ではない。 ここで作ったものを 「小さな SNARK」 と呼ぶのは、 この問題が教えようとしていることの正反対である。

## Week 4 の対応づけ

Week 4 の教材は pinned commit 時点で未公開。 courseAlignment は `week4/README.md` を `kind: "placeholder"` で pin し、 role は transfer にしてある。 GOVERNANCE.md §6 が未公開週の companion に許すのは diagnostic と transfer で、 この問題は Week 1 の constraint と Week 3 の体を新しい設定へ転用しているので transfer が正確でもある。 公式課題が何を要求するかについては何も主張していない。

## 作問・検証

参加者は checkout を必要としません。リポジトリ保守者向けの検証手順は Makefile と CI を正とします。
