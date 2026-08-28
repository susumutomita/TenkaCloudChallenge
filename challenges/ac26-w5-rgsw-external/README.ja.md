# 誰にも読めないビットを掛ける

> このトラックは Advanced Cryptography Program 2026 の非公式・独立コンパニオンです。
> コース運営とは無関係で、承認も受けていません。問題文・コード・fixture・図はすべて独立に書いています。
> このトラックへの質問はコース運営ではなく TenkaCloud リポジトリへお願いします。

**Track:** `advanced-cryptography-2026` · **Order:** 530 · **Chapter:** Week 5 / RGSW and the
External Product · **Role:** `mechanism` · **想定時間:** 75〜105 分 · **配点:** 300 ·
**前提:** `ac26-w5-lwe-rlwe` · **Status:** draft

## 物語

メッセージを載せた RLWE 暗号文と、**暗号化された**ビットがあります。これを掛けます。
selector が 0 なら暗号文はゼロの暗号文になり、 1 ならメッセージはそのまま残ります。
どちらでも算術は同一なので、結果からどちらだったかは分かりません。
それがこの構成の全部で、暗号化されたまま分岐できる理由です。

環や RLWE を作り直すわけではありません。 `participant.ring` が `ring_mul` や
`rlwe_encrypt` を正しい形で提供します。それらは `ac26-w5-lwe-rlwe` の成果物です。
この問題は gadget と external product です。

## 規約は固定

```text
q = base ** levels           unsigned、 大きい重みが先頭 (MSB 先頭)、桁数はちょうど levels
gadget = (B^(L-1), ..., B, 1)       降順 — q = B^L の下では (q/B, q/B^2, ..., q/B^L) と同じ
recompose(decompose(x)) == x        [0, q) のすべての x について
```

`B = 4`、`L = 3`、`q = 64` なら `decompose(47) = (2, 3, 3)` です。
`47 = 2·(64/4) + 3·(64/16) + 3·(64/64) = 2·16 + 3·4 + 3·1` で、講義スライド 30 の
例とちょうど同じ並びになります。

これを厳密にしているのが `q = base ** levels` です。これは選択であり、
その選択が何を買っていたかは `failure` checkpoint で分かります。
実装は本来 approximate な gadget を使い、誤差と付き合います。

## RGSW は 2L 行あり、その分割が要点

`RGSW(mu) = Z + mu * G`。 `Z` はゼロの RLWE 暗号文 2L 個、 `G` は gadget 行列です。

| 行 | gadget 項が入る場所 |
|---|---|
| `0 .. L-1` | **a** スロット |
| `L .. 2L-1` | **b** スロット |

external product は暗号文の**両方**の半分を分解し、長さ 2L の digit ベクトルに連結して、
この行列へ掛けます。

```text
d = decompose(a) ++ decompose(b)
d . (Z + mu*G) = d.Z + mu*(d.G) = RLWE(0) + mu*(a, b)
```

`d . G` が `(a, b)` をちょうど組み立て直します。行が 2 つのスロットへ分かれているのはそのためです。
gadget 項を片方のスロットに集めると、積はほとんど正しく見えるものへ復号されます。

## secret は渡さない、意図的に

`external_product` に secret は渡りません。 selector を復号できませんし、
復号する必要もあってはいけません。どちらのビットか知りたくなったら、
設計が何かを教えようとしています。

## 自分の往復テストではなぜ捕まらないか

digit の順序**と** gadget vector を両方逆にしても、往復はすべて通ります。
RGSW の行のレイアウトを逆にして、同じように逆な product で掛けても、
selector 1 はメッセージを返します。

そこで hidden test は gadget vector を**直接**検査し、 RGSW の検査はすべて**交差**させます。
fixture が作った行をあなたの product へ通し、あなたの行を fixture の product へ通します。
自己整合的なだけの構成はこれを越えられません。

## Participant Portal での進め方

1. Participant Portal で問題を起動する。同じ画面に問題エディタが表示される。
2. **証拠を調べる**で、この deploy 固有の fixture と公開された証拠を読む。
3. Portal のエディタで starter のソースを編集する。
4. **公開テストを実行**を押し、直接回答欄があれば証拠から埋める。
5. 各 checkpoint をそのまま提出する。Portal が現在のファイルと回答を準備して送る。

checkout、ターミナル、ローカルエディタ、別画面、コピペは不要です。code checkpoint は現在の
エディタ内容を使います。直接回答は現在の deploy seed へ結び付くため、別 deploy からコピーした
値は拒否されます。

## 採点

8 つの checkpoint を独立に採点します。誤答は 1 回 15 点。

| Checkpoint | 配点 | 検査内容 |
|---|---:|---|
| `decompose` | 35 | `[0, base)` の桁がちょうど L 個、 MSB 先頭、ゼロは全ゼロ、分解前の剰余 |
| `gadget` | 30 | vector そのものが降順であること。往復から推測しない |
| `polynomial` | 30 | level ごとに 1 つの環の元、係数順序の保存、転置していないこと |
| `rgsw` | 40 | 2L 行、半分ごとに正しいスロット、ビット以外の selector を拒否、余計なものを持たない |
| `external` | 50 | selector 0 でゼロ、 1 でメッセージ、両方向の交差、入力をそのまま返さない |
| `trace` | 35 | 行ごとに 1 レコード、最後が product そのもの |
| `failure` | 40 | 必要な level 数と、往復しなくなる最小の値 |
| `transfer` | 40 | 見たことのない base・level 数・degree・modulus で上記すべて |

8 つのうち 5 つに hint があり、いずれもその checkpoint の 50% 上限の内側です。

## equivalent mutant について

mutation の候補のうち 2 つは、生き残らせるのではなく**外しました**。
どちらも議論ではなく全数検査で確認しており、どちらも `q = base ** levels` の副産物です。

- `decompose` から `value % modulus` を外しても何も変わりません。 base-B の桁をちょうど
  `levels` 個取ることが、そのまま `base ** levels` を法とする剰余だからです。負数を含めて確認しました。
- `recompose` から `% modulus` を外しても変わりません。 `base` 未満の桁 `levels` 個を
  gadget で重み付けした和は、たかだか `q - 1` です。

どちらの行も reference には残しています。意図を書いていますし、 approximate な gadget の下では
判定を担うようになるからです。ここで検出できないだけであり、
殺せない項目を一覧に残すと `SURVIVED` の行を無視してよいと教えることになります。

float logarithm の mutation もあやうく同じ扱いになるところでした。
`int(ceil(log(m, b)))` は 2 と 4 の冪ではすべて counting と一致します。
食い違うのは `(5, 125)` と `(6, 216)` だけで、今はその両方をテストケースに入れてあります。

規約を降順（講義スライド 30 の並び）へ揃えた際に、3 つ目の候補が外れました。
external product の積み上げを最後の 1 行だけ止める mutation です。降順では最終行の重みが
`B^0 = 1` になるため、落としても phase の乱れは高々 `B - 1` とその行の noise で、
全 viable パラメータで decode の許容内に収まることを全数検査で確認しました。
これは実際の approximate gadget が最下位 level を落とすのと同じ近似です。
suite の truncation mutant は代わりに**先頭**の行（重み `B^(L-1)`）を飛ばします。

## 対象外

production の noise 解析、最適化された分解や FFT、 RGSW の security proof、
bootstrapping key の圧縮はいずれも対象外です。

## これは安全ではない

パラメータは全列挙できる大きさで、 secret は線形代数で復元できます。
機構の toy であって、困難性の toy ではありません。

## 出典との対応

Week 5 の教材は公開済みなので、 `courseAlignment` は `week5/README.md` を `lecture`、
`week5/problems/tfhe-toy-python/README.md` を `assignment` として pin しています。
`spoilerPolicy` は `independent-reimplementation` で、 API・パラメータ生成・記述は独自であり、
公式課題から関数名も fixture も skeleton も取っていません。

## 保証範囲

ローカル実行は**自習用の honor-system 検証**です。マシンも Docker デーモンも
あなたの管理下にあるので、あなたが build したものはあなたに対して秘匿されていません。
`reference/` と `tests/hidden/` を bind-mount しないのは、あなたの git checkout に
紛れ込ませないためであって、手が届かなくするためではありません。

そのうえでデプロイが行うのは、事故で手渡さないことです。 container は 2 つです。
あなたが話す Workbench は starter、public test、`participant/ring.py`、`show.py` を持ちます。
採点側の image は `fixtures/`、`tests/hidden/`、verifier を持ち、ポートを一切公開せず、
gateway のない Docker network に置かれます。 `show.py` と public test は、このデプロイの
パラメータ・row・trace を verifier の `GET /public` から読みます。そこが返すのは問題であって
checkpoint の期待値ではありません。 `fixtures/generate.py` はそれらを導出するために
`starter/rgsw.py` が書かせる 10 個の関数をすべて実装する必要があるので、あなたが実行する
image には入りません
（[#543](https://github.com/susumutomita/TenkaCloudChallenge/issues/543)）。

verifier が実際に保証するのはもっと狭く、そして本物です。提出コードは verifier を
ハングさせたりクラッシュさせたりできません。 checkpoint は echo した id しか加点できません。
結果は期待値を漏らしません。 fixture はこのデプロイの seed 由来なので、暗記した答えは持ち越せません。

これは自習と誠実な練習を支えます。競技順位・試験・修了判定は**支えません**。
それらには participant が管理しない verifier が必要で、
[#271](https://github.com/susumutomita/TenkaCloudChallenge/issues/271) で追跡しています。

## コスト

ゼロ。クラウドアカウントも AWS リソースも不要です。

## 作問者向け

`make reference-test` が mutation suite を走らせます。 18 個の壊れた実装のほとんどは自己整合的で、
fixture が作ったものと submission が作ったものが一致しなければならなくなって初めて
reference と分かれます。
