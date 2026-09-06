# Participant-fidelity record — 2026-09-06

## First independent pass: actual gaps

The initial participant-only read caught missing q/D/c/r/rots dependencies when
copying the statement into the starter, an unexplained jump from negative powers
to table reads, and a false noise-margin claim. In that fixture n−3D was 40, but
a mixed input failed at total noise 9. Statement and starter also disagreed about
whether dmax bounded each input or their total.

The rewrite supplies six self-contained teaching blocks and two constructions:
a larger-noise failure and arithmetic that works at every input and displacement.
All formulas are free. Final hints specify finite candidate ranges and termination.

## Deployment replay correction

PR review found four fixed answers worth 140/200 points across every initial
rewritten fixture. The final version varies n (8/16), encoding (-1/1 or 1/-1),
and repair noise (D+1 through 3D). Regression checks cover all twelve combinations.
No fixed failure triple meets both the narrow and wide noise intervals. No fixed
repair triple works with both encodings: reversing them swaps numeric inputs 00
and 11, which require opposite signs. Fixed params and boundary also fail for n=16.

The following independent reader received only the final Japanese statement,
hints, starter and public Inspect values. They did not execute code or read the
fixture generator, reference, verifier, previous answers or hidden tests.

# 独立した参加者読解レポート

読んだ資料は `/private/tmp/negacyclic-participant-variation.md` だけ。リポジトリ内部、旧解答は読まず、解答コードは実行していない。以下の「正解」は、公開された数と受理条件による手計算上の判定であり、提出・実行による確認ではない。

## 最初の行動と終了条件

最初は「起動」→「証拠を確認」で自分の数を見る。その後、`negacyclic_drill.py` の `params` に `return (p, 2*n, n, (2*n)//p)` を入れ、公開テストの `params ->` の右側を回答欄へ貼って提出する。終了は全8問が「解答済み」になること。ほかの未記入問が FAIL でも今の問を提出できる、という説明もある。

今回の公開値は `p=16, n=16, noise_a=1, noise_b=1, dmax=2, lo=10, hi=27, probes=[16,-2,5,32,32,1], repair_noise=5, encoding=[1,-1]`。よって `q=32, D=2`。周期で戻した位置が0〜15なら1、16〜31なら−1。

## 8問の目的と手計算

### params

目的：符号まで元に戻る周期と、1枠ぶんの位置の間隔を知る。

`q=2*16=32`、`D=32//16=2`。指定順は p,q,n,D なので、答えは **`[16,32,16,2]`**。

### wrap

目的：はみ出した歩数を表の長さで戻し、残りと符号反転の回数を分けて確認する。

`E=10+27=37`。`37=16*2+5` で2回は偶数だから符号は1。答えは **`[5,1,37]`**。

### signs

目的：周期の前半・後半と負の位置を含む六つの読み値を確かめる。

32で割った余りは順に `16,30,5,0,0,1`。特に `-2=32*(-1)+30` だから余りは30。前の二つは16以上、残りは16未満。答えは **`[-1,-1,1,1,1,1]`**。

### boundary

目的：位置0から進んで初めて読み値が負になる境目を探す。

位置0〜15は1、位置16は−1。答えは **`16`**。

### hazard

目的：元の位置から表を一巡余計に進むと、読み値が反転することを確かめる。

`10+16=26`。26は周期32の後半なので−1。答えは **`[26,-1]`**。

### rotations

目的：四つのビット入力をNANDに対応する読む位置へ変換する。

合計ノイズは `1+1=2`。encoding=[1,-1] なので、入力順 (0,0),(0,1),(1,0),(1,1) の置き換えは (1,1),(1,-1),(-1,1),(-1,-1)。元の式は `1+m1+m2` となり、16で割った余りは `3,1,1,15`。

位置は `2*3-2=4`、`2*1-2=0`、`2*1-2=0`、`2*15-2=28`。答えは **`[4,0,0,28]`**。読み値は `1,1,1,-1` でNANDになる。

### constants

目的：許された範囲でノイズを増やし、元のNANDの答えが壊れる具体的な入力を作る。

答えは **`[0,1,3]`**。ビット0,1は許され、ノイズ3は `dmax+1=3` 以上 `repair_noise=5` 以下。

入力 (0,1) は m1=1,m2=−1。位相は `1-(-1)*1-(-1)*(-1)=1`。位置は `(2*1-3)%32=(-1)%32=31`。31は16以上だから読み値−1。しかし (0,1) のNANDの正しい符号は1なので壊れる。

ヒントの順番でも、(0,0) のノイズ3,4,5では位置が3,2,1ですべて1、その次の (0,1),ノイズ3でこの答えが見つかる。4回目の確認である。

### margin

目的：四入力とノイズ0〜5のすべてで正しいNANDになるよう、位相の式の3数を作り直す。

答えは **`[3,-2,-2]`**。3数はいずれも−3〜3以内。式は `3+2*m1+2*m2`。

| 入力 | m1,m2 | 位相 | ノイズ0〜5での読む位置 | 読み値 |
| --- | --- | --- | --- | --- |
| (0,0) | 1,1 | `3+2+2=7` | `14,13,12,11,10,9` | すべて1 |
| (0,1) | 1,−1 | `3+2-2=3` | `6,5,4,3,2,1` | すべて1 |
| (1,0) | −1,1 | `3-2+2=3` | `6,5,4,3,2,1` | すべて1 |
| (1,1) | −1,−1 | `(3-2-2)%16=15` | `30,29,28,27,26,25` | すべて−1 |

24通りをこの表で直接確認できる。単に最大ノイズだけを検査していない。

## 書いた関数

`/private/tmp/negacyclic-reader-variation-functions.py` に constants と margin を保存した。ヒント通り、決まった範囲のループ、提供済みの rotate/read、目標符号との比較だけで探索する。実行はしていない。見つからない場合は例外で失敗を明示する。

constants は a,b を0,1、noise を3〜5とするので最大12回。margin は候補343個、各候補でノイズ6個と入力4個なので読み値の確認は最大8232回。どちらも有限。境界を探す while も今回の n=16 なら position=16 で停止する。

## 不足・飛躍・署名・停止性

- **今回の値で解答不能になる定義不足や、停止できない手順は見つからなかった。** 負の余り、encoding、合計ノイズ、正しい符号、候補の範囲、全ノイズでの検査は本文で定義されている。
- 関数署名は本文とスターターで一致している。`constants(p,n,dmax,repair_noise,encoding)`、`margin(p,n,repair_noise,encoding)`、通常の `rotate(p,n,noise,encoding)` と候補を渡す5引数形の説明に食い違いはない。
- 初心者向けの小さな構文上の飛躍はある。1〜6は完成したコードを写せるが、7〜8で初めて「−3〜3を動かすループ」を自分で書く必要がある。`range(-3,4)` は最後の4を含めないこと、ノイズ範囲は `range(dmax+1,repair_noise+1)` と書くことの一言があると迷いが減る。
- `2*a+b` が四入力の添字0,1,2,3を作ることはヒントに式としてあるが説明はない。(0,0)→0、(0,1)→1、(1,0)→2、(1,1)→3という短い対応表があれば自力で検算しやすい。
- margin の「その候補をやめ、次の候補へ」は手順として明確だが、Pythonでのフラグと `break` の書き方は示されていない。三重ループ全体から抜けるのではなく、その候補のノイズ検査を打ち切るという点は初心者がつまずきやすい。これは数学上の不足や署名の不整合ではなく、コードを組み立てる部分の支援余地。
- 「最大12回/343候補で見つかる」は今回の公開値では上の具体的な反例・修理が存在するので成立する。任意の p,n,dmax,repair_noise に対して解が存在する保証までは本文で述べられていないが、今回の課題を解く障害ではない。


## Author-executed verification of that participant route

- Real Compose Inspect returned the same public assignments shown to the reader.
- Both languages' six free blocks passed the real Workbench public tests; the two
  constructions remained unfinished until the reader's functions were added.
- Those functions passed all eight real public-test rows in both languages and
  80 varied author fixtures covering all twelve parameter/encoding/noise shapes.
- All eight hand answers passed `/api/prepare` → `/verify`. Eight wrong values and
  eight unprepared answers were rejected without failure reasons. Alternate valid
  counterexamples were accepted. Safe-noise failures and fragile repairs failed.
- Real learner execution could not access the seed/generator, verifier URLs or
  binding, create Python/native/child sockets, read parent memory, kill its
  supervisor, change its limits, or escape the process group. Grading still worked.
- Docker `make reference-test`: 24 mutations killed, 10 learning/submission tests,
  and 5 Linux isolation tests passed. Independent public/private predicates agree
  over every allowed candidate in all twelve construction domains.
- Streamed Docker CLI `make test` passed with the visible blocks and reader's
  functions. Root `make install` (initial rewrite) and `make agent-gate` passed.

These runtime and author tests were performed after the independent read; they do
not mean the reader accessed private fixtures. Earlier fixed-fixture answers are
superseded by the values and signatures in this record. No human browser playtest,
shared deployment, or real AWS event was performed.

## Reader-authored functions

```python
"""Participant-only draft from the displayed terminating hints.

Not executed. read and rotate are the helpers provided by the exercise.
"""

from participant.model import read, rotations as rotate


def constants(p, n, dmax, repair_noise, encoding):
    for a in range(2):
        for b in range(2):
            # range stops before its second argument.
            for noise in range(dmax + 1, repair_noise + 1):
                positions = rotate(p, n, noise, encoding)
                position = positions[2 * a + b]
                target = 1
                if a == 1 and b == 1:
                    target = -1
                if read(n, position) != target:
                    return [a, b, noise]
    raise ValueError("No failing input exists in the stated search range")


def margin(p, n, repair_noise, encoding):
    target = [1, 1, 1, -1]
    for bias in range(-3, 4):
        for weight_a in range(-3, 4):
            for weight_b in range(-3, 4):
                candidate = [bias, weight_a, weight_b]
                all_noise_ok = True
                for noise in range(repair_noise + 1):
                    positions = rotate(p, n, noise, encoding, candidate)
                    values = []
                    for position in positions:
                        values.append(read(n, position))
                    if values != target:
                        all_noise_ok = False
                        break
                if all_noise_ok:
                    return candidate
    raise ValueError("No repair exists in the stated search range")

```
