# 誰も持っていない 2 つの値を、1 round だけ話して掛ける

秘密分散された `[A]` と `[B]` から、fresh Beaver triple を使って `[C] = [A] × [B]` を 1 round で構成する。 open するのは d と e だけで、 witness も A も B も C も平文にならない。

Week 6 の 2 問目。 前の問題 (`ac26-w6-cosnark-linear`) が作った co-SNARK prover の線形部分は 0 round で済んだ。 この問題はその続きで、 **通信が要る側**を書く。

```text
A = Σ_j a_j w_j        B = Σ_j b_j w_j        C = A × B        (mod p)
```

`[A]` と `[B]` は組み立て済みで支給される。 和の積は積の和ではないので、 局所演算をどう並べても `[C]` は出ない。 代価は通信 1 round で、 それを 1 round に抑えるのが Beaver の trick である。

```text
[d] = [A] - [x]        [e] = [B] - [y]        どちらも local
d, e を open                                   1 round、 2 値
[C] = [z] + d[y] + e[x] + de
```

Week 2 の `ac26-w2-beaver-mul` が general MPC の乗算として作ったものを、 co-SNARK prover という上位 layer に正しく組み込む transfer 問題である。 triple の消費、 d/e の batch、 公開定数 `de` を 1 party だけが畳むこと — Week 2 で学んだ 3 つが、 ここでは prover の privacy に直結する。

runtime は前問と同じ instrument で、 `open` だけが通信する。 round は 「開いた値の数」 ではなく **distinct な roundId** として数える。 だから 「2 値を 1 round で」 は主張ではなく測定になり、 それが checkpoint `open` の採点対象である。 `reserve_triple` は消費する: 同じ triple を 2 度予約すると例外になる。 mask が uniform なのはちょうど 1 回だけ、 という一文がこの step の安全性の全部だからである。

採点の設計として、 この問題は 31 個の壊れた実装を同梱していて、 そのうち **24 個は全 shape で `C` を `A × B` に正しく復元する**。 `make reference-test` が毎回この数を測る。 なかでも本題は 「`[A]` と `[B]` をそのまま open して平文で掛け、 答えを share し直す」 実装で、 これは全 seed・全 shape で完璧な `C` を返し、 round も 1、 triple もちゃんと消費する。 実測すると、 これを落とす checkpoint は `audit` **1 つだけ**である (別 seed で再実行する `transfer` を除く)。

toy であることも明示しておく。 field は列挙可能な小さい素数、 party は 2〜5、 semi-honest ですらなく敵対者は不在、 triple は trusted dealer が配る。 dealer は `z = x*y` を自分で検算するが、 **本物の protocol はそれができない** — party は share しか持たず、 積を確認することは 3 つとも再構成することだからである。

## ブラウザでの進め方

1. Participant Portal で問題を起動し、**Browser Workbench** を開く。
2. `inspect` で deploy 固有の fixture と公開された証拠を読む。
3. 画面内の starter を編集し、`test` で公開テストを実行する。
4. 表示された直接回答欄を、inspect と実験結果から埋める。
5. `prepare` で全 checkpoint の提出値を作り、Portal へ貼る。

直接回答は `prepare` により現在の deploy seed へ結び付けられます。

## 学習目標

- prover relation の非線形部分だけが interactive multiplication を必要とする理由を説明できる
- fresh triple の field / party / 積の整合を検め、 一度だけ消費できる
- [d] = [A] - [x] と [e] = [B] - [y] を局所演算だけで構成できる
- d と e を同一 round へ batch し、 round 数を開示数と区別できる
- [C] = [z] + d[y] + e[x] + de を share として構成し、 公開定数を 1 party だけが畳める
- witness も A / B / C の平文も含まない proof artifact の形を守れる
- 開示記録から mask のある開示と無い開示を見分け、 privacy を測定できる
- linear-only relation と multiplicative relation の通信コスト差を予測できる
- triple の再利用・field mismatch・過剰 open を診断できる

## Checkpoint

| Checkpoint | 内容 | Points |
| --- | --- | ---: |
| `plan` | 通信する前に、 何回話すかを数える | 30 |
| `triple` | mask は一度きり | 35 |
| `masks` | 共有値を覆う。 まだ誰も話さない | 40 |
| `open` | 2 つの値を、 1 度の待ち合わせで | 45 |
| `product` | 4 つの項のうち、 1 つだけ性質が違う | 45 |
| `artifact` | 次の段が受け取れる形にする | 30 |
| `audit` | 何が公開されたのかを、 記録から測る | 50 |
| `transfer` | 見たことのない設定で成立させる | 25 |

## 解説

## 正しい C は、 正しい prover の証拠にならない

この問題は 31 個の壊れた実装を同梱していて、 そのうち **24 個は全 shape で `C` を `A × B` に正しく復元します**。 `make reference-test` が毎回この数を測り、 数が動いたら数のほうを直します。

## `[A]` と `[B]` を開いてから掛ける実装は、 値のテストを 1 つも落とさない

`[A]` と `[B]` をそのまま open すれば平文の `A` と `B` が手に入ります。 掛けて、 答えを share し直す。 出てくる `C` は全 seed・全 shape で完璧に正しく、 round は 1 のまま (2 つの開示を同じ roundId に入れれば済む)、 triple もちゃんと 1 つ消費できます。 `prove_product` の契約 — 「C が正しく、 schedule が 1 round」 — を、 この実装は完全に満たします。

満たしていないのは 「公開された値が mask されたものだけだった」 ことです。 実測すると、 これを落とす checkpoint は `audit` **1 つだけ**です (`transfer` が同じ検査を別 seed で再実行する分を除く)。 `openings()` の各記録が持つ `maskedBy` — その開示の祖先に予約済み triple share があったか — だけが見ています。

これが 「d と e を開いても A と B は漏れない」 という主張の実際の中身です。 主張は `d = A - x` の `x` が uniform で、 かつ **1 度しか使われない**ことに全部乗っています。 mask のない開示はその条件を満たさないので、 同じ `open` という操作でも意味が違います。 runtime はそれを拒否せず、 記録します。 拒否したら shortcut は 「不可能」 になり、 「見える」 にはならないからです。

## audit が証明できることと、 できないこと

証明できるのは、 この runtime 上で公開された値がどれも予約済み mask の下にあり、 refused read が無く、 triple が ledger の通りに消費されたことです。

証明できないのは 「A と B が誰の目にも触れなかった」 ことです。 前問と同じで、 各 party の scope を開いて自分の share を読むのは合法で、 全 party 分やれば `A` が手に入ります。 `Share._value` は属性 1 つ分の距離です。 runtime は sandbox ではなく instrument で、 記録しているのは 「その計算が何を公開したか」 であって 「書いた人が何を見たか」 ではありません。

## 「1 round」 は答えであって、 測定ではない

答えが 1 round であることは、 1 行も書く前から分かっています。 だから `rounds: 1` と書いて返す報告には点がありません。 `open` と `product` の checkpoint は毎回、 **すでに何かを開示した後の** runtime を渡します。 そこでの正解は 1 ではなく、 「この step が足した round が 1」 です。

round が開示の数ではないことも同じ理由です。 2 値を 1 round で運ぶ schedule と 2 round で運ぶ schedule は出力が同一で、 違いは latency にしか出ません。 本物の prover では、 その差が回路の乗算 layer の数だけ積み上がります。

## 公開定数は 1 party だけが畳む

`de` は全員が知っている数です。 `[de]` という共有値は存在しません。 全 party の share に足すと `value + parties × de` の sharing になり、 2 party なら `de` 1 個分ずれます。 Week 2 が checkpoint 1 つを割いた話が、 ここでは 「`C` が `A × B` にならない」 という形で返ってきます。 実測でずれは正確に `(parties - 1) × d × e` です。

## triple を 2 度使うと何が起きるか

何も壊れません。 `C` は正しく出ます。 壊れるのは mask のほうで、 同じ `x` で 2 つの値を隠すと、 その 2 つの差が公開されます。 だから `reserve_triple` は 2 度目を例外にします — docstring での注意ではなく、 API として。 「triple の再利用は性能の話」 という誤解は、 性能の話であるうちは何も起きないので生き延びます。

## dealer が検算できて、 本物の protocol ができないこと

`reserve_triple` は `z == x * y` を確認してから triple を渡します。 **本物の protocol はこれができません。** party は share しか持たず、 積を確認することは 3 つとも再構成することで、 それは mask を破壊します。 本物の preprocessing は triple をもう 1 つ潰して 1 つを検査する (sacrificing) か、 malicious-secure な protocol で triple を生成します。 ここでは trusted dealer が自分の仕事を検算しているだけで、 その限界は暗黙にせず書いてあります。

## artifact に平文を入れない

`[C]` はあと 1 回 `open` すれば `C = A × B` を満たす整数になり、 それらしい proof artifact に見えます。 入れてはいけません。 本物の prover の次の段は sharing を消費しますし、 平文の `C` は witness 由来の値を理由なく公開したものです。 `d` と `e` は公開値で transcript には属しますが、 artifact には属しません。

metadata も飾りではありません。 どの relation の、 どの体の、 何 party 分かを言わない artifact は何とも突き合わせられず、 別の relation の名札が付いた `C` は誰もしていない主張の valid な proof です。

## toy と production の差

field は列挙できる小さい素数、 party は 2〜5、 敵対者は不在、 triple は trusted dealer が配ります。 本物の co-SNARK では triple の調達が設計の中心で、 online phase の 1 round はその preprocessing を前提にした数字です。 コストは消えたのではなく、 input に依存しない側へ移動しただけです。

## 対象外

実際の proof encoding / verification、 複数の乗算 layer の scheduling 最適化、 malicious-secure triple、 network transport。

## 作問・検証

参加者は checkout を必要としません。リポジトリ保守者向けの検証手順は Makefile と CI を正とします。
