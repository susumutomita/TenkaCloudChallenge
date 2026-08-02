# 9 層ある 1 個の箱

「SNARK」「STARK」はプロトコル名ではなく族の名前。 2 つの toy pipeline を stage graph として読み、層ごとの contract を書き、1 つだけ壊れた run から最初に破れた層を特定して直す。

Week 4 の 3 問目。 proof system を 1 個のブラックボックスとして扱うと、 「succinct だから速い」 「transparent だから何も仮定しない」 という文が出てくる。 どちらも別々の軸を混同している。 この問題は proof system を作らず、 2 つを stage graph として渡して壊す。

pipeline A は circuit 指向で回路ごとの trusted setup を持ち、 B は trace 指向で transparent。 どちらも実在 scheme の実装ではなく、 実在 scheme の名前も付けていない。 重要なのは 2 つが同じ形ではないことで、 stage 数も stage 名も層の順序も query の下限も違い、 B には A に無い low-degree 層が opening と verifier の間に入る。 A から決め打ちしたものは B で外れ、 hidden check はすべて両方に対して走る。

run は 1 回の実行の記録であって proof ではない。 何を commit したか、 challenge を引く前に何を吸収したか、 verifier が実際にどの opening を検証したか。 participant は層ごとに contract を書き、 そのうち 1 つだけが壊れた run を診断する。

中心にある罠が `commitment_ok` で、 これはこの問題のすべての run で True。 正常な run でも、 未充足の制約を抱えたまま accept した run でも。 commitment が成功したという事実は prover が何かに commit したことしか言わない。 これを読む contract は public test を通り、 constraints checkpoint で落ちる。

診断は最悪の層ではなく最初の層を返す。 input boundary が 1 つ壊れれば下流はすべて壊れて見えるので、 opening を指す診断は正しく仕事をしていた stage を直しに人を送る。 修復は fault が壊したフィールド 1 つだけを変えてよい。 正常な run を組み直せばすべての contract を満たしたうえで証拠が消え、 verdict を reject にすればすべての contract が一度に黙る。 その制約の例外が 1 つだけあり、 それがどれで、 なぜ例外なのかを言えることが diagnose checkpoint の大部分になる。

## ブラウザでの進め方

1. Participant Portal で問題を起動し、**Browser Workbench** を開く。
2. `inspect` で deploy 固有の fixture と公開された証拠を読む。
3. 画面内の starter を編集し、`test` で公開テストを実行する。
4. 表示された直接回答欄を、inspect と実験結果から埋める。
5. `prepare` で全 checkpoint の提出値を作り、Portal へ貼る。

直接回答は `prepare` により現在の deploy seed へ結び付けられます。

## 学習目標

- statement・public input・witness・trace を区別できる
- pipeline を artifact graph として読み、 stage 間の境界を説明できる
- commitment の成功と制約の充足を混同しない
- challenge を引く時点と transcript の束縛が健全性に効くことを説明できる
- verifier が検証していない opening / query を指摘できる
- trusted / transparent setup を security assumption として分類できる
- succinctness・proof size・prover cost を別の軸として比較できる
- 下流に波及した failure から最初の fault 層を特定して直せる

## Checkpoint

| Checkpoint | 内容 | Points |
| --- | --- | ---: |
| `graph` | artifact の流れを図にする | 30 |
| `wiring` | 誰が何を見てよいかを決める | 35 |
| `constraints` | commit できたことと正しいことを分ける | 40 |
| `transcript` | challenge を引く前に何を吸収したか | 45 |
| `opening` | 検証されなかった opening を見つける | 40 |
| `assumptions` | setup と仮定を別の欄にする | 30 |
| `cost` | 支持されない主張だけを落とす | 30 |
| `diagnose` | 最初に破れた層を指して直す | 50 |

## 解説

## commitment の成功は制約の充足ではない

この問題のすべての run で `commitment_ok` は True。 未充足の制約を抱えたまま accept した run でもそうなっている。 commitment が成功したという事実は、 prover が何かに commit したことを言う。 commit した中身が制約系を満たすかは別の主張で、 別の検査が要る。

そして commitment には第 2 の仕事がある。 commit stage が受け取った artifact のうち commit されなかったものは、 その後 prover が自由に差し替えられる。 setup material だけが例外で、 これは run より前に公開・固定されているので commit しても新しく縛るものが無い。 名指しで特例にするのではなく、 なぜ例外なのかを言えるようにする。

## transparent は setup の性質である

B は transparent で、 かつ衝突困難ハッシュと random oracle に依拠している。 A は trusted setup を持ち、 SRS が残らないことと pairing の困難性に依拠している。 どちらの仮定リストも空ではない。 transparency は setup が何を必要とするかについての性質であって、 仮定の有無についての性質ではない。

同じ混同が cost 側にもある。 succinct は proof size と verifier 時間の話で、 prover のコストとは別の軸。 A の proof は定数サイズだが prover は superlinear で、 この 2 つは矛盾していない。

## 最初の層を返す

input boundary が壊れると、 opening も transcript も verifier も壊れて見える。 診断が返すのは最初の層でなければならない。 opening を指す診断は、 正しく仕事をしていた stage を直しに人を送り出す。 層の順序は definition の stage 列から読む。 A の順序を書き写すと、 B の low-degree 層を落とすか置き場所を間違える。

## 修復はフィールド 1 つ

修復が変えてよいのは fault が壊したフィールドだけ。 これがなければ 2 つの近道が通ってしまう。 definition から正常な run を組み直せばすべての contract を満たしたうえで証拠が消え、 verdict を reject にすればすべての contract が一度に黙る。

例外は 1 つある。 未充足の制約は記録を編集しても充足にはならないので、 そこでの正しい修復は verifier が reject することそのものになる。 例外が 1 つだけであることと、 なぜそこだけなのかが、 この checkpoint の核心。

## 2 つの pipeline が同じ形ではないこと

stage 数、 stage 名、 層の順序、 query の下限、 存在する artifact — すべて違う。 B には low-degree 層があり、 A には無い。 A に無い層の契約を A に適用すると、 正常な A の run が全部落ちる。 契約を書くときは 「この pipeline がこの stage を持つなら」 から始める。

## 対象外

Groth16 / PLONK / STARK の完全実装、 benchmark の実測値、 setup ceremony、 proof generation service。 ここでのコストはすべて宣言されたクラスであって測定値ではない。

## Week 4 の対応づけ

Week 4 の教材は pin した commit 時点で未公開。 courseAlignment は `week4/README.md` を `kind: "placeholder"` で pin し、 role は transfer にしてある。 GOVERNANCE.md §6 が未公開週の companion に許す 2 つの role のうちの 1 つで、 Week 4 の arithmetization と commitment を新しい設定 (pipeline 診断) へ転用しているので transfer が正確でもある。 公式課題が何を要求するかについては何も主張していない。

## 作問・検証

参加者は checkout を必要としません。リポジトリ保守者向けの検証手順は Makefile と CI を正とします。
