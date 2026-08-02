# 曲線の前に、体を作る

楕円曲線の式に入る前に、その下の有限体を手で作る。正規化、四則、そして拡張 Euclid による逆元。素数でない法では逆元が存在しない要素があり、それを見落とす実装がある。

Week 3 の 1 問目。 楕円曲線の群演算へ進む前に、 F_p 上の正規化・加減乗算・逆元・除算を自分で実装する。 公式課題の template や test 値は一切参照せず、 異なる API と seed 由来 fixture で同じ数学的構造を扱う。

中心にあるのは 2 つの区別。

1. **integer と field element は違う**。 -5 と p-5 は同じ元だが、 -5 は正規形ではない。 hidden test は負値・法以上の値・法の整数倍を含む値の集合を与え、 すべてが [0, p) に落ちることを要求する。
2. **`pow(a, p-2, p)` は逆元を返すとは限らない**。 p が素数なら返すが、 合成数なら 「何か数」 を返す。 拡張 Euclid は gcd を返すので、 逆元が存在しない場合をそれとして報告できる。 mutation suite の 1 つ目はまさに Fermat 版で、 素数側は全部通り合成数側で落ちる。

checkpoint は 7 つ。 正規化と等価性、 四則と体の公理 (単位元・逆元・分配・可換・結合)、 拡張 Euclid の trace、 逆元と除算、 zero と非可逆元の error、 未知素数上での全元 property、 合成数法での counterexample 提出。

inverse checkpoint は素体の**全**非零元を検査する。 標本ではなく全数なので、 表を覚える戦略が成立しない。 axioms checkpoint はさらに逆元写像が非零元上の全単射になることまで見る。

trace checkpoint は Bezout 等式を各行で検査したうえで、 行列そのものを参照実装の step 列と突き合わせる。 最終行だけを持つ表は Bezout を満たしてしまうため、 それだけでは trace の検査にならない (mutation suite で実際に生き残ったので追加した)。

show.py が出す trace は algorithm 理解用であり、 入力に依存して分岐し実行時間も変わる。 constant-time 実装ではないことを participant 向けにも明記している。

## ブラウザでの進め方

1. Participant Portal で問題を起動し、**Browser Workbench** を開く。
2. `inspect` で deploy 固有の fixture と公開された証拠を読む。
3. 画面内の starter を編集し、`test` で公開テストを実行する。
4. 表示された直接回答欄を、inspect と実験結果から埋める。
5. `prepare` で全 checkpoint の提出値を作り、Portal へ貼る。

直接回答は `prepare` により現在の deploy seed へ結び付けられます。

## 学習目標

- integer と field element を区別できる
- 負数や法以上の値を正規形へ落とせる
- 加算・減算・乗算を法の下で実装できる
- 拡張 Euclid から乗法逆元を求められる
- a * a^{-1} = 1 を property として検証できる
- zero と非可逆元に逆元が無いことを明示的な error にできる
- 素数法と合成数法の違いを counterexample で示せる

## Checkpoint

| Checkpoint | 内容 | Points |
| --- | --- | ---: |
| `normalize` | 整数を体の元にする | 25 |
| `arithmetic` | 加減乗算と体の公理 | 30 |
| `egcd-trace` | 拡張 Euclid の各ステップを出す | 35 |
| `inverse` | 逆元と除算 | 35 |
| `errors` | 存在しないものを存在しないと言う | 25 |
| `composite` | 素数でない法で反例を作る | 25 |
| `axioms` | 見たことのない素数で公理を通す | 25 |

## 解説

## integer と field element

-5 と p-5 は F_p の同じ元を指すが、 -5 は正規形ではない。 element を作った時点で [0, p) に落としておくと、 負の step も法以上の初期値も同じ経路で扱える。 Python の `%` は法が正なら非負を返すので、 これは 1 演算で済む。

剰余を最後にまとめて取る実装は、 この問題の範囲では正しい答えを出す。 落ちるのは中間値そのものを検査されたときで、 hidden test は演算結果が [0, p) にあることを毎回見る。

## 拡張 Euclid が Fermat より多くを語る理由

`pow(a, p-2, p)` は p が素数のときだけ逆元になる。 合成数 n では `pow(a, n-2, n)` も数を返すが、 それは逆元ではない。 検算しなければ気づけない。

拡張 Euclid は a*s + n*t = gcd(a, n) を返す。 gcd が 1 でなければ逆元は存在せず、 アルゴリズムがそれを教えてくれる。 「存在しないことが分かる」 のが Fermat 版との差で、 mutation suite の 1 つ目はこの差だけで落ちる。

## trace を行列ごと突き合わせる理由

trace checkpoint は当初、 各行が Bezout 等式 a*s + p*t = r を満たすことと、 最終行が gcd と逆元に一致することだけを見ていた。 mutation suite に 「最終行だけを返す」 変異を入れたところ、 生き残った。 1 行だけの表はその条件をすべて満たすからだ。

現在は step 数と各行の (q, r, s, t) を参照実装の列と突き合わせる。 floor 除算なので step 列は一意に決まり、 正解はちょうど 1 つある。

## 全数検査

inverse checkpoint は素体の全非零元 (p-1 個、 p は 3 桁) を回す。 標本ではないので、 一部の値だけ特別扱いする実装は通らない。 axioms checkpoint はさらに、 逆元写像が非零元上の全単射であることを検査する — 体では逆元は一意で、 異なる元が同じ逆元を持つことはない。

## trace は constant-time ではない

show.py が出す trace は入力に依存して分岐し、 step 数も入力で変わる。 実際の鍵を扱う実装では、 この性質そのものが side-channel になる。 ここでは algorithm を読むためのものであり、 production 実装の参考にはならない。

## 次につながるところ

次の問題で曲線の群演算を作る。 点の加算は分母に体の逆元を持つので、 ここで作った inverse がそのまま使われ、 分母が 0 になる場合分けが群法則の場合分けそのものになる。

## 作問・検証

参加者は checkout を必要としません。リポジトリ保守者向けの検証手順は Makefile と CI を正とします。
