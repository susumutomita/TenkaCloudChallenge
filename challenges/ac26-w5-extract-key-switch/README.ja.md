# 同じ数を、別の鍵の言葉で言う

blind rotation が残した多項式から 1 係数を LWE sample として取り出し、 別の鍵・別の次元へ移す。 どちらの段階でも復号は 1 回も起きない。

Week 5 の 5 問目。 blind rotation が残した RLWE 暗号文から目的の係数を LWE sample として取り出し、 それを別の secret key・別の次元へ key switching で移す。

blind rotation までは支給される。 環・RLWE・RGSW・external product・CMUX・回転ループはすべて前 3 問の成果物で、 この問題はその後の 2 段。

sample extraction は phase 多項式 `b - a*s` の係数 k を、 環の secret の係数を並べた vector に対する LWE phase として書き直す。 `(a*s)_k` に集まる積のうち添字が degree を跨いだものは符号が反転しているので、 mask の該当スロットもその反転を持たなければならない。 これは回転問題の `X^N = -1` を反対側から見たもの。 復号は起きず noise も増えず、 取り出した phase は多項式の係数そのものになる。

そして取り出した sample の secret は環の secret を vector として読んだもの。 これがシステムの他の部分が使う鍵ではないことが、 次の段が必要な理由。

key switching key は old index j と level l ごとに `LWE_new(B^l * s_old[j])` を持つ。 mask を分解して対応する entry を引くと、 phase から `<mask, s_old>` がちょうど消える。 ここでも復号は起きない。 s_old は switching key の暗号文の中にしか現れず、 s_new はどこにも現れない。 decrypt して re-encrypt する操作ではない。

採点の設計として、 mask のスロットが巻き戻るのはその添字が取り出す index より上のときだけなので、 最後の係数では巻き戻りが起きない。 そこだけ正しい実装は 1 つの index で止まるテストをすべて通る。 だから extraction は全 index で検査する。 また digit の順序と switching key の読み順を両方逆にした実装は自分自身と完全に整合するので、 検査は交差させる。

これは安全ではない。 パラメータは全列挙でき、 両方の secret は線形代数で復元できる。

## ブラウザでの進め方

1. Participant Portal で問題を起動し、**Browser Workbench** を開く。
2. `inspect` で deploy 固有の fixture と公開された証拠を読む。
3. 画面内の starter を編集し、`test` で公開テストを実行する。
4. 表示された直接回答欄を、inspect と実験結果から埋める。
5. `prepare` で全 checkpoint の提出値を作り、Portal へ貼る。

直接回答は `prepare` により現在の deploy seed へ結び付けられます。

## 学習目標

- RLWE ciphertext の指定係数に対応する LWE phase を導出できる
- negacyclic ring の符号を含む extracted mask の並びを実装できる
- extraction の前後で平文の意味が一致することを確認できる
- old-key の LWE mask を digit decomposition できる
- switching key を用いて new-key sample へ変換できる
- 鍵と次元だけが変わり message が変わらないことを説明できる
- source key・target key・ring key を取り違えた欠陥を特定できる
- key switching が decrypt と re-encrypt ではないことを説明できる

## Checkpoint

| Checkpoint | 内容 | Points |
| --- | --- | ---: |
| `phase` | 保つべき数を書き下す | 30 |
| `extract` | 1 係数を取り出す | 50 |
| `trace` | 対応を見せる | 35 |
| `decompose` | mask を桁へ分解する | 25 |
| `switch` | 別の鍵へ移す | 55 |
| `domains` | どの鍵の話かを分類する | 35 |
| `endtoend` | 3 通りが同じ答えになる | 40 |
| `transfer` | 見たことのない設定で成立させる | 30 |

## 解説

## 最後の係数は例外的に易しい

mask のスロットが巻き戻るのは、 その添字が取り出す index より上のとき。 `degree - 1` では上にスロットが無いので巻き戻りが起きず、 符号を完全に無視した実装でも phase が一致してしまう。 index 0 はその逆で、 1 つを除く全スロットが巻き戻る。 public test が 4 つとも最後の係数なのはそれを見せるためで、 hidden test は全 index を回す。

## 何も復号していない

extraction には鍵が渡らない。 key switching にも渡らない。 s_old は switching key の暗号文の中にしか現れず、 s_new はどこにも現れない。 それでも phase は保たれる。 key switching が decrypt して re-encrypt する操作だという理解は、 この導出のどこにも当てはまらない。

## 取り出した鍵は使いたい鍵ではない

extraction の結果の secret は環の secret を vector として読んだもの。 次元は degree で、 システムの他の部分が使う鍵ではない。 だから key switching が要る。 2 段が別々に存在する理由はここにある。

## 交差させないと見えない

digit の順序と switching key の読み順を両方逆にすると、 自分の分解を自分の switch に通すテストは通る。 だから hidden test は fixture の sample を submission の switch へ、 submission の sample を fixture の switch へ通す。

## compatible は metadata から決める

どちらの secret も手元に無いので、 switch を試して復号できるかで判定することはできない。 できたとしても、 それは secret を最も置いてはならない場所に置くということ。 noise も同じ理由で bound を報告する。 測るには phase が要り、 phase には鍵が要る。

## 対象外

production の switching key 生成、 圧縮された switching key、 noise-security パラメータ解析、 multi-key や proxy re-encryption。

## これは安全ではない

パラメータは全列挙でき、 両方の secret は線形代数で復元できる。 機構の toy であって困難性の toy ではない。

## 作問・検証

参加者は checkout を必要としません。リポジトリ保守者向けの検証手順は Makefile と CI を正とします。
