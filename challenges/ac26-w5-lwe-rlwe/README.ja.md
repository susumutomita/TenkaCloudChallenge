# 符号 1 つと、その下流すべて

LWE と RLWE は同じ形で算術だけが違う。 X^N = -1 の符号 1 つが negacyclic と cyclic を分け、cyclic な環も立派な環なので自分の往復テストは全部通る。だから往復を交差させる。

Week 5 の 2 問目。 TFHE の後段をブラックボックスにしないため、 negacyclic な多項式環と toy LWE / RLWE の暗号化・復号をまず自分で書く。

2 つの方式は同じ形をしている。 秘密に何かを掛けたもの、 符号化したメッセージ、 noise。 違うのは演算と積載量で、 LWE はベクトルの内積、 RLWE は多項式の negacyclic 積、 そして RLWE の暗号文 1 つは N 個のメッセージを運ぶ。 RLWE は長いベクトルの LWE ではない。

環は R_q = Z_q[X] / (X^N + 1) で、 要点は X^N = -1 の 1 つ。 次数 N を越えて巻き戻る係数は符号が反転して戻る。 この符号 1 つが negacyclic と cyclic を分ける。 そして cyclic な環も立派な環で、 公理をすべて満たし分配し可換で、 participant 自身のテストを喜んで通る。 間違った積は fixtures.generate.cyclic_mul として書き出してあり、 反例を自分で壊したコードではなく明示された弱点に対して作れるようにしてある。

採点の設計として、 hidden test の往復はすべて交差させる。 こちらで暗号化して fixture 側で復号し、 その逆も行う。 符号を反転した内積は符号を反転した phase と打ち消し合い、 平文を自分の中に持つ暗号文は本物より上手に復号し、 cyclic な環は自己整合的で、 どれも同じコードで往復するテストなら通ってしまう。 交差させると通らない。

暗号化は mask と noise を引数で受け取る。 この問題の主題ではない CSPRNG を持ち込まずに再現性を確保するため。 実装は本来どちらも sample し、 1 つの鍵の下で mask を使い回すのは破綻になる。

fixture の不変条件として、 生成される secret は少なくとも 1 つ 1 を含むよう強制してある。 全ゼロの secret では mask の項が消え、 実装が secret に何をしたかに関わらず b = encode(m) + e になる。 強制する前に 3 つの mutation がまさにこれで生き残った。

これは安全ではない。 n・N・q は全列挙できる大きさで、 secret は数個の sample から線形代数で復元できる。

## ブラウザでの進め方

1. Participant Portal で問題を起動し、**Browser Workbench** を開く。
2. `inspect` で deploy 固有の fixture と公開された証拠を読む。
3. 画面内の starter を編集し、`test` で公開テストを実行する。
4. 表示された直接回答欄を、inspect と実験結果から埋める。
5. `prepare` で全 checkpoint の提出値を作り、Portal へ貼る。

直接回答は `prepare` により現在の deploy seed へ結び付けられます。

## 学習目標

- R_q = Z_q[X] / (X^N + 1) の元を正規化できる
- negacyclic な加算・乗算を実装できる
- cyclic convolution との違いを反例で示せる
- toy LWE の鍵生成・暗号化・復号を実装できる
- RLWE でスカラーとベクトルが多項式へ置き換わる対応を説明できる
- phase から符号化メッセージと noise を分離して追える
- modulus・dimension・degree・noise の役割を区別できる
- toy の correctness と production の security を混同しない

## Checkpoint

| Checkpoint | 内容 | Points |
| --- | --- | ---: |
| `normalize` | 環の元へ畳む | 30 |
| `ring` | negacyclic に掛ける | 45 |
| `lwe` | ベクトルの秘密で暗号化する | 40 |
| `rlwe` | 多項式の秘密で暗号化する | 40 |
| `correspondence` | 2 つを並べて違いを名指す | 30 |
| `boundary` | 予算を越える最初の 1 つ | 40 |
| `transfer` | 見たことのない環で成立させる | 30 |
| `defense` | 壊れた暗号文を断る | 45 |

## 解説

## cyclic な環も立派な環である

X^N = +1 の環は公理をすべて満たし、 分配し、 可換で、 暗号化と復号が往復する。 ただこの環ではない。 だから 「自分のテストが通った」 は negacyclic かどうかについて何も言わない。 間違った積は fixtures.generate.cyclic_mul として書き出してあるので、 反例は明示された弱点に対して作る。

## 自己整合的な間違いは交差させないと見えない

符号を反転した内積は、 符号を反転した phase と打ち消し合う。 平文を自分の中に持っている暗号文は、 本物より上手に復号する。 mask を無視する実装は、 mask を無視する復号と完璧に往復する。 どれも同じコードで暗号化して復号するテストなら通る。

hidden test の往復はすべて交差させてある。 こちらで暗号化して fixture 側で復号し、 その逆も行う。 自己整合的なだけの方式はこれを越えられず、 本当に正しい方式は何も気づかない。

## 巻き戻りは 2 回で戻る

次数 i の係数は i % N へ、 符号 (-1)^(i // N) で落ちる。 1 回巻き戻れば負、 2 回巻き戻れば正に戻る。 「N を越えたら負にする」 と書いた実装は、 長さ 2N を越える入力で間違える。 ring_mul が渡すのは長さ 2N-1 なので 1 回で足りるが、 normalize は任意長を受け取る。

## RLWE は長いベクトルの LWE ではない

積が別の積で、 暗号文 1 つが運ぶメッセージが 1 個ではなく N 個になる。 correspondence checkpoint が operation と payload_size をラベルとして採点するのはそのため。 RLWE の演算を inner-product と名指すのは、 この誤解を書き下したものになる。

## 全ゼロの secret は方式を退化させる

生成される secret は少なくとも 1 つ 1 を含むよう強制してある。 全ゼロなら mask の項が消え、 実装が secret に何をしたかに関わらず b = encode(m) + e になる。 符号を反転した内積も、 phase を足す復号も、 mask を無視する暗号化も、 すべて正しく見える。 強制する前に 3 つの mutation がこれで生き残った。

## mask を使い回すと破綻する

暗号化が mask と noise を引数で受け取るのは再現性のためで、 実装は本来どちらも sample する。 1 つの鍵の下で同じ mask を 2 回使うと、 2 つの暗号文の差で mask の項が消え、 2 つの平文の差と少しの noise が残る。

## 対象外

具体的な security parameter の選定、 CSPRNG や constant-time 実装、 NTT / FFT、 実用ライブラリ。 schoolbook 乗算は意図的で、 NTT は同じ符号規約を教えなければ動かない変換の裏に巻き戻りを隠す。

## これは安全ではない

n・N・q は全列挙でき、 secret は数個の sample から線形代数で復元できる。 機構の toy であって困難性の toy ではない。

## 出典との対応

Week 5 の教材は公開済みなので、 courseAlignment は `week5/README.md` を lecture、 `week5/problems/tfhe-toy-python/README.md` を assignment として pin してある。 spoilerPolicy は independent-reimplementation で、 API・パラメータ生成・方式の記述は独自、 公式課題から関数名も fixture も skeleton も取っていない。

## 作問・検証

参加者は checkout を必要としません。リポジトリ保守者向けの検証手順は Makefile と CI を正とします。
