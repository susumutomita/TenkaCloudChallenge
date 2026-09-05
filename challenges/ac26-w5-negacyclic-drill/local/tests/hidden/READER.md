# Participant-fidelity record — 2026-09-06

An independent reader saw only the Japanese statement, hints, starter, public helper
source and Inspect. No fixture generator, verifier or reference answer was shown;
hand calculations and learner functions were authored without executing the code.

## Original defects

The first pass found missing q/D/c/r/rots dependencies when copying the statement
into the starter, an unexplained leap from negative polynomial powers to table reads,
and a misleading noise-margin explanation. In that original fixture n−3D was 40,
but a mixed input already failed when total noise reached 9. The statement and
starter also disagreed about whether dmax bounded each input or their total.

The rewrite defines a signed table directly, supplies six complete teaching blocks,
and turns the final two rows into a larger-noise counterexample and a repair valid
for all inputs and all permitted displacements. All necessary formulas are free;
the closing hints give finite searches with explicit termination. The arithmetic
model does not claim to implement encrypted TFHE or weighted input-noise propagation.

## Revised participant-only read

# 符号反転演習・改稿後の独立参加者読解

読んだのは `/private/tmp/negacyclic-participant-revised.md` だけ。日本の中学校数学と入門 Python 1 冊の読者として、本文・ヒント・Starter・公開補助関数・Inspect を確認した。コードは実行していない。作者側の非公開実装、生成器、模範解答、採点実装、他の回答ファイルは参照していない。

独自に書いた 2 関数は `/private/tmp/negacyclic-reader-functions.py` に保存した。本文の Starter 155 行と同じ、公開された read と rotate の import を使用している。実装内容を実行して検証したという報告ではない。

## 判定

8 問とも、公開された規則から手計算または構成できた。最終ヒントの有限探索は、Python の for、if、リスト、return、break で実装できる。提出に必要な正常な処理で、隠された数式や呼出方法を推測する必要はなかった。

最初の操作、ビット/NAND/ノイズ、表の符号、補助関数、入力と出力の形式、全 8 問が解答済みという完了条件がつながっている。算術を止める未定義語や数学的矛盾は見つからなかった。7 問目は自分で失敗例を作り、8 問目は四入力と全ノイズで修理を確かめる課題になっている。

残る指摘は読みやすさが中心。143 行と 147 行の最終ヒントは手順として十分だが、一つの長い段落へループ範囲、条件、棄却、終了を詰めている。106 行も定義と数式と補助関数の呼び方を分ける余地がある。

## 初手と Starter への移し方

3 行から「起動」→「証拠を確認」→ `negacyclic_drill.py` の params の return None を具体的な一行へ変更→「公開テストを実行」→回答欄へ提出、という順に進める。19 行は見本の出力と `your values` を区別している。自分の数を使う提出では後者の出力を選べる。

17 行の「該当するコード全体を入れ、最後の式を return」は、今回の Starter と対応している。

- params は p,n だけで必要な四値を作る。
- wrap は E と sign を関数内で作る。
- signs、boundary、hazard は n を引数として受け取り、用意済みの read を使う。
- rotations は noise_a と noise_b を足し、用意済みの rotate を使う。
- return は for/if/while の内側の既存字下げを保ちながら、関数へ入れる分だけ各行を下げればよい。

q、D、c、r などを別の関数から暗黙に引き継ぐ必要はない。Starter 155 行の alias により、参加者の rotations 関数と補助関数の rotate も別の名前になる。

7 問目は `[入力a,入力b,合計ノイズ]`、8 問目は `[bias,weight_a,weight_b]`。それぞれの範囲と合格条件が本文にある。5 行の「全8問の解答済み」がゴール。今回は実画面へ提出していないので、その状態を観測したとは報告しない。

## Inspect の値と共通計算

233〜241 行：

```text
p = 16
n = 8
noise_a = 0
noise_b = 1
dmax = 1
lo = 2
hi = 11
probes = [5, 16, -3, 6, 3, 3]
repair_noise = 2
```

q=2n=16、D=q//p=16//16=1。読み位置は 16 で割った余りにし、0〜7 なら +1、8〜15 なら −1。今回の入力ノイズの合計は 0+1=1。

## 1. params — 一周と数の間隔

目的：符号も元に戻る歩数と、元の数一枠に対応する歩数を調べる。

q=2×8=16、D=16//16=1。指定の順は p,q,n,D。

提出：`(16, 16, 8, 1)`

## 2. wrap — はみ出した歩数と符号

目的：n 歩ごとの折り返しについて、残る位置と符号の両方を求める。

E=2+11=13。`13=8×1+5`。8 を引く回数は 1 回で奇数なので符号 −1、残り 5。

提出：`(5, -1, 13)`

## 3. signs — 六つの位置の読み出し

目的：同じ 1 の表を読む位置によって、正負どちらの値になるか確かめる。

| 表示された位置 | 16 で割った余り | 判定 | 読む値 |
| --- | --- | --- | --- |
| 5 | 5 | 8 未満 | 1 |
| 16 | 0 | 8 未満 | 1 |
| −3 | 13 | 8 以上 | −1 |
| 6 | 6 | 8 未満 | 1 |
| 3 | 3 | 8 未満 | 1 |
| 3 | 3 | 8 未満 | 1 |

提出：`[1, 1, -1, 1, 1, 1]`

繰り返し表示された位置 3 も、表示順の二件として両方記録する。

## 4. boundary — 最初の負の位置

目的：正から負へ変わる最初の読み位置を求める。

位置 0〜7 は 1、位置 8 から −1。最初は 8。

提出：`8`

## 5. hazard — n 歩余計に進んだ結果

目的：同じ表の場所に戻っても、一周余計に進むと答えの符号が反対になることを確かめる。

lo+n=2+8=10。10%16=10 は 8 以上なので −1。元の位置 2 では +1。

提出：`(10, -1)`

## 6. rotations — 四入力が指す位置

目的：NAND の四入力を読む位置へ置き換え、両方 1 の場合だけ後半へ送る。

ビット 0 は 15、ビット 1 は 1。位相は `(1-m1-m2)%16`。

| 入力 | 余りを取る前の数 | 位相 | ノイズ 1 を引いた位置 |
| --- | --- | --- | --- |
| (0,0) | 1−15−15=−29 | −29+32=3 | 3−1=2 |
| (0,1) | 1−15−1=−15 | −15+16=1 | 1−1=0 |
| (1,0) | 1−1−15=−15 | −15+16=1 | 1−1=0 |
| (1,1) | 1−1−1=−1 | −1+16=15 | 15−1=14 |

D=1 なので位相を D 倍しても同じ。全位置が 0〜15 なので最後の %16 も値を変えない。

提出：`[2, 0, 0, 14]`

読む符号は [1,1,1,−1]。ビットとしては [1,1,1,0] となり NAND に一致する。

## 7. constants — 壊れる入力を構成

目的：許された従来の上限を超えるずれで、元の計算が NAND と違う答えを返す入力を作る。

条件から、ノイズの整数範囲は dmax+1=2 以上 repair_noise=2 以下なので、今回の候補は 2 だけ。

入力 (0,1) を選ぶ。位相は上の計算どおり 1。D=1 なので、ノイズ 2 を引くと `1−2=−1`、16 で割った余りは 15。read は −1 を返す。しかし (0,1) の正しい NAND の符号は +1。

提出：`[0, 1, 2]`

全条件の確認：

- 入力 0,1 はどちらもビット。
- ノイズ 2 は整数で、指定された閉区間 [2,2] に入る。
- 元の規則を使って位置 15 を得た。
- 読む符号 −1 は目標 +1 と異なる。

元の規則を全四入力・各ずれでも手で比較する：

| 合計ノイズ | 四入力の位置 | 読む符号 | NAND との関係 |
| --- | --- | --- | --- |
| 0 | [3,1,1,15] | [1,1,1,−1] | 全て一致 |
| 1 | [2,0,0,14] | [1,1,1,−1] | 全て一致 |
| 2 | [1,15,15,13] | [1,−1,−1,−1] | (0,1),(1,0) が不一致 |

最終ヒント 143 行の順序なら (0,0,2) は正しいままなので次へ進み、(0,1,2) で反例を見つけられる。

## 8. margin — より大きいずれに耐える計算を構成

目的：四入力全てで、合計ノイズが 0〜2 のどれでも NAND の符号を保つように位相の式を変える。

まず望ましい位相の範囲を考える。今回は D=1。

- +1 を保つ三入力は、ノイズ 2 を引いても 0 以上、ノイズ 0 のときでも 8 未満にしたい。したがって位相を 2〜7 に置けばよい。
- −1 を保つ入力 (1,1) は、ノイズ 2 を引いても 8 以上、ノイズ 0 のときには 16 未満にしたい。したがって位相を 10〜15 に置けばよい。

元の位相は 3,1,1,15。式の最初の数と二つの掛ける数を全て 2 にすれば、位相は元の式の 2 倍を 16 で割った余りになり、6,2,2,14 にできる。これは上の二つの範囲に入る。

提出：`[2, 2, 2]`

新しい式 `(2−2*m1−2*m2)%16` を各入力に代入する。

| 入力 | m1,m2 | 余りを取る前の式 | 新しい位相 |
| --- | --- | --- | --- |
| (0,0) | 15,15 | 2−30−30=−58 | −58+64=6 |
| (0,1) | 15,1 | 2−30−2=−30 | −30+32=2 |
| (1,0) | 1,15 | 2−2−30=−30 | −30+32=2 |
| (1,1) | 1,1 | 2−2−2=−2 | −2+16=14 |

全四入力×全三ノイズの検算：

| 合計ノイズ | (0,0) の位置・符号 | (0,1) | (1,0) | (1,1) |
| --- | --- | --- | --- | --- |
| 0 | 6 → +1 | 2 → +1 | 2 → +1 | 14 → −1 |
| 1 | 5 → +1 | 1 → +1 | 1 → +1 | 13 → −1 |
| 2 | 4 → +1 | 0 → +1 | 0 → +1 | 12 → −1 |

全 12 組が [1,1,1,−1] に一致する。三つの係数は整数 2 で、0〜p−1=15 の範囲に入る。反例のノイズ 2 だけでなく、0 と 1 も検査した。

この修理は、重みを付けた計算を終えた後のずれを noise として与える模型の範囲で行った。112 行が、現実の暗号で重みが入力ノイズを増やす過程を対象外と明記しているので、重みを 2 にしたことを現実の暗号のノイズ耐性の改善と同一視していない。

## 最終ヒントから書いた関数

保存先：`/private/tmp/negacyclic-reader-functions.py`

constants は 143 行どおり、a、b、noise の順に回す三重ループにした。rotate の四位置から 2*a+b の場所を選び、目標符号と違う最初の三数を返す。

margin は 147 行どおり、bias、weight_a、weight_b の三重ループにした。各候補のノイズ 0〜repair_noise を調べ、その四位置を read した結果を [1,1,1,−1] と比較する。一つでも違えば候補を捨て、全て一致した候補を返す。候補の失敗を覚える works という真偽変数と、内側のループを抜ける break を使った。これは公開手順を Python に表す方法の選択であり、暗黙の採点条件を推測したものではない。

提出に必要な処理について、未定義の関数や数式はなかった。探索しても答えがない場合の処理だけはヒントに指定がないので、両関数とも ValueError にした。公開範囲では候補が見つかると説明されているため、これは正常な提出経路を補う必要条件ではなく、失敗を黙って扱わないための実装上の選択。

今回はコードを実行していない。関数の実ランタイムでの返り値や採点結果は未確認。

## 残る文章上の指摘

### 1. 最終ヒント 143 行を操作ごとに分けると追いやすい

引用：「constants で入力aを0,1、内側で入力bを0,1、さらに内側でnoiseをdmax+1〜repair_noiseへ順に動かす三重ループを作ります。rotate(p,n,noise)の位置は入力(0,0),(0,1),(1,0),(1,1)の順なので、場所2*a+bを取り出してreadします。」

同じ段落の後半に、目標符号の決定、比較、return、上限回数、提出先も続く。

原因：必要な手順は全部あるが、ループと一候補の計算と終了条件が一つの長い段落に続くため、コードへ移すときに今どの操作を書いているかを見失いやすい。

修正案：入力とノイズの候補を回す、位置を一つ取り出す、目標と比べる、違えば返す、の四段階へ改行する。新しい数式を足す必要はない。

### 2. 最終ヒント 147 行も候補の検査と候補全体の探索を分けたい

引用：「margin でbias,weight_a,weight_bをそれぞれ0〜p−1へ順に動かす三重ループを作ります。候補ごとにnoiseを0〜repair_noiseへ動かし、rotate(p,n,noise,候補)の四位置をreadします。一つでも[1,1,1,-1]と違えばその候補を捨て、次の候補へ。」

原因：三つの係数の探索、ノイズの繰り返し、四つの符号の検査という三つの階層が文章だけで連続する。手順そのものは十分だが、入門 Python の読者には「どのループを止め、どのループを続けるか」が一度で読みづらい。

修正案：一候補を選ぶ→ノイズごとに四符号を検査→一つでも違えば次の候補→全て通れば return、と段階を分ける。候補の合否を True/False に覚える方法を添えるなら、break の位置も判断しやすくなる。ただし今の文章からでも私は実装できたので、機構が未説明で止まる欠陥とは区別する。

### 3. 106 行は定義・式・呼び方を分けられる

引用：「bias は最初に置く数、weight_a,weight_b は各入力に掛ける数です。0を p-1、1を1に置き換える規則は同じで、新しい位相を (bias-weight_a*m1-weight_b*m2)%p とします。位置は (D*位相-noise)%q です。補助関数は rotate(p,n,noise,[bias,weight_a,weight_b]) の形でも呼べます。」

原因：意味の異なる四文が一段落に集まる。全て必要な説明だが、読者は新しい三つの名前を覚えながら二つの式と関数呼出を対応付けることになる。

修正案：三数の意味、新しい位相の式、位置の式、用意済み補助関数の呼び方を別の短い行にする。108 行の数値例は理解の助けになっているので維持してよい。

### 4. 「一周」の対象だけ統一するとより明確

引用：9 行は n 進むと同じ場所へ戻って符号反転、13 行は q=2*n を「符号も戻る一周の歩数」と呼ぶ。68 行の「一周しすぎた」は n 歩を指す。

原因：表の位置だけの一周と、符号も含む一周の二つがある。規則自体は明示されているため矛盾ではないが、用語だけ拾うと一周は n か 2n かと読み直す可能性がある。

修正案：表一周は n 歩、符号も戻る二周は q=2n 歩、と同じ呼び方を保つ。計算や採点条件を変える必要はない。

## 未定義語・数学・負荷の確認

- ビット、NAND、ノイズ、位相、bias と二つの weight は、それぞれ使う前または使う場所で意味が示される。
- 多項式の見方は 34 行で小例とともに任意の対応として置かれ、負の指数を知らなくても歩数の規則で計算できる。
- q,D は式の中で作られるか、補助関数の中で計算される。前の関数の局所変数に頼る飛躍はない。
- dmax と repair_noise は合計ノイズの範囲を表すと明確で、各入力の上限との混同はない。
- ノイズは位置から引かれる。今回の失敗は位置 1 から 2 を引いて負になり、一周して後半へ移ることとして説明される。別方向の距離をノイズ耐性と取り違えない。
- 普通の数の模型と本物の暗号は 11 行と 112 行で区別される。
- constants の今回の候補は四入力×ノイズ 1 種の 4 組。margin の有限探索は最大 16³=4096 候補、各候補でノイズ 3 種×四入力=12 判定、単純な上限で 49152 判定。実際の実行速度は測っていないが、探索範囲の終わりは明示される。
- 手で修理を考える場合は、必要な位相の範囲と [2,2,2] の全 12 条件だけで追える。4096 候補を手で総当たりする必要はない。

## 全 8 回答

```text
params: (16, 16, 8, 1)
wrap: (5, -1, 13)
signs: [1, 1, -1, 1, 1, 1]
boundary: 8
hazard: (10, -1)
rotations: [2, 0, 0, 14]
constants: [0, 1, 2]
margin: [2, 2, 2]
```


## Final editorial response

The final two hint paragraphs were split into numbered actions. The explanation
of the coefficient names and helper call was separated into shorter paragraphs.
Japanese now consistently calls n steps a table lap and 2n steps the full signed
cycle. These changes preserve the equations and the reader-authored functions.

## Executed runtime evidence

- Real Compose Inspect supplied exactly the reader's assignments above.
- Both languages' six free blocks, inserted into the actual starter through the
  Workbench `/api/test`, passed their six teaching checks and left the constructions
  unfinished. The reader's two functions completed the public tests in both routes.
- Those same reader functions passed 30 varied author fixtures, including both
  repair bounds. This is additional implementation evidence, not a claim that
  the independent reader viewed private fixtures.
- The eight hand answers passed `/api/prepare` → `/verify`. Eight incorrect values
  and eight unprepared submissions were rejected. Different satisfying failure
  triples and repairs were accepted; safe-noise failure claims and the original
  fragile coefficients were rejected.
- Real learner execution could not read the seed or generator, create Python,
  native or child sockets, read parent memory, kill the supervisor, alter its
  limits or escape the process group. Trusted grading still worked afterward.
- Docker `make reference-test`: 20 mutations, 9 learning/submission checks and
  5 Linux isolation tests passed. Public and private repair predicates agree over
  every coefficient triple at both repair bounds.
- Streamed CLI `make inspect`, reference `make test`, and visible `make test-one`
  passed. Root `make install` and `make agent-gate` passed (116 entries).

No human browser playtest, shared deployment, or real AWS event was performed.

## Reader-authored construction functions

```python
"""Independent translation of the participant's final hints; not executed."""

from participant.model import read, rotations as rotate


def constants(p, n, dmax, repair_noise):
    for a in range(2):
        for b in range(2):
            target = 1
            if a == 1 and b == 1:
                target = -1
            for noise in range(dmax + 1, repair_noise + 1):
                positions = rotate(p, n, noise)
                position = positions[2 * a + b]
                if read(n, position) != target:
                    return [a, b, noise]
    raise ValueError("条件を満たす入力とノイズが見つかりませんでした")


def margin(p, n, repair_noise):
    expected = [1, 1, 1, -1]
    for bias in range(p):
        for weight_a in range(p):
            for weight_b in range(p):
                coefficients = [bias, weight_a, weight_b]
                works = True
                for noise in range(repair_noise + 1):
                    positions = rotate(p, n, noise, coefficients)
                    for i in range(4):
                        if read(n, positions[i]) != expected[i]:
                            works = False
                            break
                    if not works:
                        break
                if works:
                    return coefficients
    raise ValueError("すべての入力とノイズに耐える三数が見つかりませんでした")

```
