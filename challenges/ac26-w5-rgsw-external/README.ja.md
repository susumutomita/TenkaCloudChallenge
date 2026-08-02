# 誰にも読めないビットを掛ける

メッセージを載せた RLWE 暗号文と暗号化されたビットを掛ける。 selector 0 でゼロ、 1 でメッセージ、そして算術はどちらでも同一なので結果からどちらかは分からない。

Week 5 の 3 問目。 TFHE で encrypted control bit を RLWE 暗号文へ作用させる土台として、 gadget decomposition・gadget vector・toy RGSW・external product を順に実装する。

環と RLWE は支給される。 それらは ac26-w5-lwe-rlwe の成果物で、 この問題は gadget と積そのもの。

分解の規約は固定してある。 q = base**levels、 unsigned、 LSB 先頭、 桁数はちょうど levels、 gadget は (1, B, B^2, ...)。 q = base**levels が復元を厳密にしており、 それが何を買っていたかは failure checkpoint で分かる。 実装は本来 approximate な gadget を使い誤差と付き合う。

RGSW は 2L 行を持ち、 前半が gadget 項を a スロットへ、 後半が b スロットへ入れる。 external product は暗号文の両方の半分を分解して長さ 2L の digit ベクトルにし、 この行列へ掛ける。 d . G が (a, b) をちょうど組み立て直すので、 結果は RLWE(0) + mu*(a, b) になる。 gadget 項を片方のスロットに集めると、 積はほとんど正しく見えるものへ復号される。

external_product に secret は渡らない。 selector を復号できず、 する必要もない。 両方の分岐が同じ算術になることが、 暗号化されたまま分岐できる理由そのもの。

採点の設計として、 digit の順序と gadget vector を両方逆にしても往復は通り、 RGSW の行レイアウトを逆にして同じく逆な product で掛けても selector 1 はメッセージを返す。 だから gadget vector は直接採点し、 RGSW の検査はすべて交差させる。 fixture が作った行を submission の product へ、 submission の行を fixture の product へ通す。

これは安全ではない。 パラメータは全列挙でき、 secret は線形代数で復元できる。

## ブラウザでの進め方

1. Participant Portal で問題を起動し、**Browser Workbench** を開く。
2. `inspect` で deploy 固有の fixture と公開された証拠を読む。
3. 画面内の starter を編集し、`test` で公開テストを実行する。
4. 表示された直接回答欄を、inspect と実験結果から埋める。
5. `prepare` で全 checkpoint の提出値を作り、Portal へ貼る。

直接回答は `prepare` により現在の deploy seed へ結び付けられます。

## 学習目標

- base B と level 数 L による gadget decomposition を実装できる
- decomposition digits から元の値を mod q で再構成できる
- 多項式の係数ごとの decomposition を実装できる
- gadget vector と digit vector の内積の意味を説明できる
- toy RGSW が encrypted selector として働く構造を追跡できる
- external product で selector に応じて RLWE を保持・ゼロ化できる
- decomposition 誤差と parameter 不足の関係を反例で示せる
- toy 実装と production RGSW の差を明記できる

## Checkpoint

| Checkpoint | 内容 | Points |
| --- | --- | ---: |
| `decompose` | 値を桁へ分解する | 35 |
| `gadget` | gadget vector を書く | 30 |
| `polynomial` | 係数ごとに分解する | 30 |
| `rgsw` | selector を暗号化する | 40 |
| `external` | ビットを掛ける | 50 |
| `trace` | 積み上がりを見せる | 35 |
| `failure` | level が足りなくなる点 | 40 |
| `transfer` | 見たことのない設定で成立させる | 40 |

## 解説

## 分割こそが要点

RGSW の 2L 行は、 前半が gadget 項を a スロットへ、 後半が b スロットへ入れる。 external product が暗号文の両方の半分を分解して連結するのは、 `d . G` が `(a, b)` をちょうど組み立て直すため。 gadget 項を片方に集めると、 積は 「ほとんど正しい」 ものへ復号される。 ほとんど正しいは、 この文脈では間違い。

## 自己整合的な間違いは交差させないと見えない

digit の順序と gadget vector を両方逆にすれば往復は通る。 RGSW の行レイアウトを逆にして、 同じく逆な product で掛ければ selector 1 はメッセージを返す。 どちらも自分自身とは完全に整合している。

だから gadget vector は往復からではなく直接採点し、 RGSW の検査はすべて交差させる。 fixture が作った行を submission の product へ通し、 submission の行を fixture の product へ通す。

## secret を渡さないことが仕様

external_product に secret は渡らない。 selector を復号できず、 する必要もない。 両方の分岐が同じ算術になることが、 暗号化されたまま分岐できる理由そのもの。 どちらのビットか知りたくなったら、 設計が何かを教えようとしている。

## q = base**levels は選択である

それが復元を厳密にしている。 level が modulus に届かなくなると、 decompose は文句を言わずに切り捨て、 recompose は自信を持って間違う。 最小の失敗値は base**levels そのもの。 float の logarithm で level 数を数えると、 厳密な冪でずれる — (5, 125) と (6, 216) がその例。

## 対象外

production の noise 解析、 最適化された分解や FFT、 RGSW の security proof、 bootstrapping key の圧縮。

## これは安全ではない

パラメータは全列挙でき、 secret は線形代数で復元できる。 機構の toy であって困難性の toy ではない。

## 作問・検証

参加者は checkout を必要としません。リポジトリ保守者向けの検証手順は Makefile と CI を正とします。
