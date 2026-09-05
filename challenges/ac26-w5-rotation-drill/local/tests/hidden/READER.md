# Participant-fidelity record — 2026-09-06

An independent reader saw only the Japanese statement, three hint rungs per row,
starter, public helper definitions and Inspect assignments. No reference, generator,
expected-value module or verifier was shown, and answers were calculated without
running the supplied Python.

## First pass and resulting changes

The original version called Python round “round half up” despite ties-to-even
behavior, contradicted itself about observing the plaintext, called ordinary numeric
output a refreshed ciphertext, mislabelled message centres as boundaries, and left
multiple undefined dependencies when copying its expressions into the starter.
It also claimed every upper-half output differed, overlooking negative zero.

The rewrite uses eight functions, six directly runnable teaching blocks, explicit
rounding and signed-read rules, and two property-graded construction tasks worth
half the score. A subsequent reader found that an initial four-entry deployment
could copy the final table directly from the small example. All deployed tables
now have eight entries, while the worked example has four.

## Final independent hand calculation

# 回転演習・最終公開値での独立参加者読解

今回追加で読んだのは `/private/tmp/rotation-inspect-final.txt` だけ。規則は直前に許可された `/private/tmp/rotation-participant-revised.md` の問題文・ヒント・Starter・公開補助関数に従った。本文の実質的な変更は見出しだけという担当者の説明を前提にし、他の原稿、作者側の実装、生成器、模範解答、採点実装は読んでいない。掲載コードも計算用コードも実行していない。日本の中学校数学と入門 Python 1 冊の読者役による手計算であり、実ランタイムの合格確認ではない。

## 最終判定

新しい公開値でも全 8 問を原稿の規則だけで手計算・構成できた。前回の「4 個の見本に書かれた修正をそのまま転記すれば 8 問目が完答になる」という限定的な指摘は解消している。今回は表が 8 個で、元の数は 0〜3。見本のリストを写すだけでは長さも各位置の値も不足し、今回の数字へ規則を適用する必要がある。

後半では、7 問目の丸め順とノイズと読み出しの条件を合わせ、8 問目の全 8 組について符号と値を確認できた。新しい実質的な読解の障害、用語の未定義、説明の矛盾は見つからなかった。

## 最初の操作・形式・完了

原稿の「起動」→「証拠を確認」→ `rotation_drill.py` の `params` を埋める→「公開テストを実行」→ `your values` の出力を回答欄へ提出、という流れで進める。1〜6 問のコードを入れる場所、最終式の return、補助関数が用意済みであること、未記入の他問が提出を止めないことが説明されている。

7 問目は `[new_a,new_b]`、8 問目は長さ n の新しい表を提出する。全 8 問が「解答済み」になれば完了。この手計算ではまだ実画面へ提出していないので、解答済みを観測したとは報告しない。

## 公開値と共通の計算

追加の Inspect 1〜8 行：

```text
p = 8
q = 32
n = 8
s = [1, 0]
a = [8, 9]
b = 13
shift = 1
offsets = [-1, 0]
```

- 元の数として使う範囲：0〜p//2−1 = 0〜3
- D = q//p = 32//8 = 4
- 2*n = 16
- slot = 2*n//p = 16//8 = 2
- 丸め前に掛ける割合は 16/32 = 1/2

## 1. params

目的：元の数 1 段を隠したデータの何目盛りへ置くか、その間隔を調べる。

`32//8 = 4`。p、q、n、D の順で返す。

提出：`(8, 32, 8, 4)`

## 2. phase

目的：鍵に対応する足し算を取り除き、元の数とノイズを含む残りを読む。

`8×1 + 9×0 = 8`。`13 - 8 = 5`。`5%32 = 5`。

提出：`5`

この値は `5=1×4+1` なので、元の数 1、ノイズ 1 とも読めるが、ここでの提出は位相の整数だけ。

## 3. testpoly

目的：元の数ごとの答えを、狙う位置の周りへ並べた表を作る。

slot=2、slot//2=1。`(j+1)//2` を求め、3 より大きい場合は 3 にする。得られた元の数 m に対する答えは `(m+1)%4`。

| 表の位置 j | (j+1)//2 | 最大値 3 を適用した m | (m+1)%4 |
| --- | --- | --- | --- |
| 0 | 0 | 0 | 1 |
| 1 | 1 | 1 | 2 |
| 2 | 1 | 1 | 2 |
| 3 | 2 | 2 | 3 |
| 4 | 2 | 2 | 3 |
| 5 | 3 | 3 | 0 |
| 6 | 3 | 3 | 0 |
| 7 | 4 | 3 | 0 |

提出：`[1, 2, 2, 3, 3, 0, 0, 0]`

原稿の 4 個の見本では答えを 2 で割っていたが、今回は 4 で割る。表の長さだけでなく答えの計算も今回の p へ置き換えた。

## 4. rescale

目的：隠したデータの 32 目盛りを、表の読み出しに使う 16 目盛りへ合わせる。

- D=4 → 半分は 2 → 2
- a[0]=8 → 半分は 4 → 4
- b=13 → 半分は 6.5 → ちょうど中間なので偶数の 6

提出：`(2, 4, 6)`

## 5. index

目的：各数を別々に丸めてから隠した分を引き、読む位置を求める。

- a[0]=8 → 4
- a[1]=9 → 4.5 → 偶数の 4
- b=13 → 6.5 → 偶数の 6

丸めた a と s の積の合計は `4×1+4×0=4`。引き算は `6-4=2`、一周の 16 で割った余りも 2。

提出：`2`

## 6. readout

目的：求めた位置で、表の符号反転の規則を使って答えを読む。

表は `[1,2,2,3,3,0,0,0]`、位置は 2。`2%16=2` は n=8 未満なので符号を変えず、表の位置 2 にある 2 を読む。

提出：`2`

元の数 1 に対する期待値は `(1+1)%4=2` で一致する。以前の 4 個の表の答え 0 は使っていない。

## 7. window

目的：丸める順序の違いが、位置だけでなく表から取り出す答えまで変える数の組を作る。

D=4 なので許容される整数のノイズは `0<noise<2` より 1 だけ。元の数は 0〜3 なので、位相の候補は 1、5、9、13。

位相 1 を選ぶと、差を先に丸める位置は `round(1/2)=round(0.5)=0`。今回の表では位置 0 の答えは 1、位置 1 の答えは 2 なので、別々に丸める位置を 1 にできれば条件を満たす。

new_a=1、new_b=2 とする。

提出：`[1, 2]`

全条件の確認：

1. 両方とも整数で、0〜q−1=31 の範囲に入る。
2. s の最初の 1 は位置 0。新しい a を [1,0] にすると、`1×1+0×0=1` が new_a に一致する。
3. 位相は `(2-1)%32=1`。
4. `divmod(1,4)=(0,1)`。元の数 0 は p//2=4 未満。ノイズ 1 は 0 より大きく D/2=2 未満。
5. 別々に丸める位置は `(round(2/2)-round(1/2))%16=(1-0)%16=1`。
6. 差を先に取る位置は `round(1/2)%16=0`。
7. 同じ元の表を読み、位置 1 は 2、位置 0 は 1。答えが異なる。

組の数値は以前の小さい表でも使えたが、今回は範囲、元の数の上限、一周の長さ、実際に読む二つの答えをすべて新しい値で確認した。コードは実行していない。

## 8. edge

目的：元の数とずれの全組について期待する答えが読めるよう、今回の長さ 8 の表を構成する。

長さは n=8。入れる整数は `-(p//2-1)=-3` 以上、`p//2-1=3` 以下。各 m の狙い位置は m×2、期待値は `(m+1)%4`。

- m=0：期待値 1。ずれ −1 と 0 で位置 −1 と 0 を読む。
  - −1 を 16 で割った余りは 15。n=8 を引いて位置 7、符号を反転するので `-values[7]=1`。values[7] は −1。
  - values[0] は 1。
- m=1：期待値 2。読む位置は 1 と 2 なので、values[1] と values[2] を 2。
- m=2：期待値 3。読む位置は 3 と 4 なので、values[3] と values[4] を 3。
- m=3：期待値 0。読む位置は 5 と 6 なので、values[5] と values[6] を 0。

提出：`[1, 2, 2, 3, 3, 0, 0, -1]`

全 8 組の確認：

| m | ずれ | 位置 | 新しい表から読む値 | 期待値 |
| --- | --- | --- | --- | --- |
| 0 | −1 | −1 | −values[7] = −(−1) = 1 | 1 |
| 0 | 0 | 0 | values[0] = 1 | 1 |
| 1 | −1 | 1 | values[1] = 2 | 2 |
| 1 | 0 | 2 | values[2] = 2 | 2 |
| 2 | −1 | 3 | values[3] = 3 | 3 |
| 2 | 0 | 4 | values[4] = 3 | 3 |
| 3 | −1 | 5 | values[5] = 0 | 0 |
| 3 | 0 | 6 | values[6] = 0 | 0 |

長さは 8。全要素が整数で −3〜3 に入る。二つのずれと四つの元の数の全組を満たす。

## 指摘の解消と残る点

- 4 個の見本 `[1,0,0,-1]` をそのまま貼って 8 問目を終えられる問題は解消した。そのリストは今回の長さ条件を満たさず、期待する答え 2 と 3 も入っていない。
- 見本の負の位置の説明は利用できるが、今回の一周 16、表の位置 7、元の数 0〜3 へ読み替え、別の位置にも値を割り当てる必要がある。これが見本から自分の数字へ規則を適用する作業になっている。
- 7 問目は依然として完成コードがなく、位相の許容範囲、丸め、表の値を合わせて確認する必要がある。
- 8 個の表と 8 組の検算は手で追える量で、重い計算が学習の目的を隠すほどではない。
- 丸め方、位相とノイズ、狙う位置、符号反転、入出力の形式、模型が新しい暗号文を作らないことは直前の原稿で明確だった。今回の公開値によって新しい矛盾は生じていない。
- 隠された採点条件を推測していない。ここで確認したのは公開された数学的・操作上の条件までである。

## 全 8 回答

```text
params: (8, 32, 8, 4)
phase: 5
testpoly: [1, 2, 2, 3, 3, 0, 0, 0]
rescale: (2, 4, 6)
index: 2
readout: 2
window: [1, 2]
edge: [1, 2, 2, 3, 3, 0, 0, -1]
```


## Executed local routes

- Real Compose Workbench `/api/inspect` printed the assignments used above.
- Both Japanese and English free blocks, inserted into the actual `/api/starter`
  functions, passed their six public example checks through `/api/test`. The two
  constructions remained unfilled and failed, as intended.
- The reader's eight hand answers passed `/api/prepare` → `/verify`. Eight wrong
  values and eight unprepared submissions failed. A different satisfying rounding
  pair passed; zero-noise and wrong-sign constructions failed.
- The author reference passed the real streamed `make test` CLI. This checks the
  implementation and is separate from the participant-only hand-calculation evidence.
- Real learner execution could not see the fixture seed or generator, open Python,
  native or child sockets, read parent memory, kill the supervisor, change its limits,
  or escape its process group. Trusted grading remained usable afterward.
- Docker `make reference-test`: 20 mutations, 9 learning/submission checks and
  5 Linux launcher/isolation checks passed. Fixtures cover both shapes, every shift,
  all usable messages and offsets; public/private construction predicates agree.
- Root `make install` and `make agent-gate` passed; 116 metadata entries valid.

No claim of a human browser playtest, real encrypted bootstrapping, or a live AWS
event is made. No shared environment was changed.

## Final hint review

PR review found that “choose and check” did not tell a beginner how to finish either
construction. Rung 3 now gives a bounded nested search for the counterexample, and
an explicit per-position assignment including the sign for the replacement table.
An independent reader implemented both functions from these hints without seeing
private answers or running code. Combined with either language's six teaching blocks,
the functions passed 80 varied author fixtures and actual Workbench public tests.
Only exceptional failure handling was unspecified; the reader used ValueError.

The reader-authored functions were:

```python
"""Independent translation of the participant's two closing hints.

Not executed. Insert these functions where the provided rh, table and read
helpers are already available, as described in the participant packet.
"""


def window(p, q, n, shift):
    D = q // p
    values = table(p, n, shift)
    for new_a in range(q):
        for new_b in range(q):
            phase = (new_b - new_a) % q
            message, noise = divmod(phase, D)
            if message >= p // 2 or noise <= 0 or noise >= D / 2:
                continue
            separate_position = (
                rh(q, n, new_b) - rh(q, n, new_a)
            ) % (2 * n)
            difference_position = rh(q, n, phase) % (2 * n)
            if read(values, separate_position) != read(values, difference_position):
                return [new_a, new_b]
    raise ValueError("条件を満たす組が見つかりませんでした")


def edge(p, n, shift, offsets):
    values = [0] * n
    for message in range(p // 2):
        for offset in offsets:
            position = (message * (2 * n // p) + offset) % (2 * n)
            answer = (message + shift) % (p // 2)
            if position < n:
                values[position] = answer
            else:
                values[position - n] = -answer

    for message in range(p // 2):
        for offset in offsets:
            position = (message * (2 * n // p) + offset) % (2 * n)
            answer = (message + shift) % (p // 2)
            if read(values, position) != answer:
                raise ValueError("すべての条件を同時に満たす表になりませんでした")
    return values

```
