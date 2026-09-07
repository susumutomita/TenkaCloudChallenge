# Participant-fidelity record — 2026-09-06

## First independent pass: real gaps

The first participant-only read saw the original statement, hints, starter and
Inspect. It identified missing W1/g0/P1/P2 and intermediate-value dependencies in
the editor route, an instruction predicting two equal outputs when the three
actual values were 14,12,5, and a probability claim missing the order requirement:
the message must be fixed before a fresh uniformly sampled check point. It also
flagged unexplained zkRollup/zkVM vocabulary and confusion between twelve text
steps and eight graded fields.

The rewrite uses p=5 or 7, six self-contained teaching blocks and two false-message
constructions worth half the score. Every formula is free. Each final hint gives
a finite coefficient search with an explicit acceptance condition and termination.

## Revised independent read

The reader saw only the rewritten Japanese statement, all hints, the starter and
public Inspect assignments. No code execution, generator, reference answer,
verifier or private tests were available to them.

# SumCheck 独立参加者読解レポート

読んだ資料は `/private/tmp/sumcheck-participant-revised.md` だけ。リポジトリ内部、生成器、旧解答は参照せず、解答コードも実行していない。「受理される答え」は画面の条件との手計算による照合であり、実際の提出による確認ではない。

## 結論

今回の表示値では8問すべてを手計算できる。最終2問も記載された有限探索で解ける。**ただし、本文で許されている r1 の範囲全体について「第8問の組が必ず見つかる」とは言えない。p=5,r1=1 では要求が不可能になる。** 生成時にこの値を除いているかは読解範囲外で未確認。本文に出題条件の説明が必要か、親担当が確認すべき点である。

最初の行動は「起動」→「証拠を確認」、`sumcheck_drill.py` の circuit に `return layer(p,x)` を入れ、公開テストの `circuit ->` を提出すること。全8問の「解答済み」が終了条件。

## 今回の公開値

`p=5, x=[1,1,1,1], first=[3,1,1], r1=2, second=[0,3,1], r2=2, d=4`。

よって `y0=2, y1=1, W(z)=(2-z)%5`、`P1(t)=(3+t+t*t)%5`、`P2(t)=(3*t+t*t)%5`。本文の式からも、`g(t,0)+g(t,1)=(1-t)*(3-t)=3-4*t+t*t` は P1 と同じ余りになる。`g(2,t)=-t*(2-t)=t*t-2*t` は P2 と同じ。公開された二式を「正直」とする説明は今回の値と整合している。

## 8問の目的と手計算

### circuit

目的：最初に本当の途中結果と合計を求め、以降の主張を比べる基準を作る。

`y0=(1+1)%5=2`、`y1=(1*1)%5=1`、合計 `(2+1)%5=3`。答えは **`[2,1,3]`**。

### mle

目的：位置0と1の値を同じ一本の式で表し、それ以外の位置も計算できるようにする。

`W(0)=2`、`W(1)=1`、`W(2)=2*(1-2)+1*2=0`。答えは **`[2,1,0]`**。

### grid

目的：元の合計を、次のやり取りで確認する四か所の和に書き換える。

`g(a,b)=(1-a)*b*(W(a)+W(b))` の前半が1なのは (0,1) だけ。その値は `W(0)+W(1)=2+1=3`。ほかは0なので、答えは **`[0,3,0,0]`**。

### round1

目的：最初の式の二点の和を確認し、固定後に選んだ r1 で次の確認値を得る。

`P1(0)=3`、`P1(1)=(3+1+1)%5=0`、二点の和は3。`P1(2)=(3+2+4)%5=4`。答えは **`[3,4]`**。

### final-check

目的：二番目の式が前の確認値につながり、最後の一点では検証者自身の計算とも一致するか確かめる。

`P2(0)=0`、`P2(1)=4`、二点の和は4で前問の P1(2) と一致。今回は r2=2 なので `P2(2)=(6+4)%5=0`。`W(2)=0` だから `g(2,2)=(-1)*2*(0+0)=0`。答えは **`[4,0,0]`**。本文の r2=3 の小例とは数が違うが、明示された例なので矛盾ではない。

### lie

目的：最初の式へ d*(1-t) を足して合計を偽り、それによって次の確認値がどう変わるか調べる。

偽の二点の和は `(3+4)%5=2`。偽の claim は `(4+4*(1-2))%5=0`。答えは **`[2,0]`**。元の合計3と異なり、次の値も本当の4から0へ変わる。

### lie-caught

目的：確認位置 r2 が先に分かると、その位置だけ正しい値になる偽の二番目の式を後から選べることを確かめる。

答えは **`[0,0,0]`**。これは C(t)=0。係数はすべて0〜4以内で次数は2以下。`(C(0)+C(1))%5=0` は偽の claim=0 と一致し、`C(r2)=C(2)=0=P2(2)` でもある。

本当の P2 は二点の和が4なので、C は正直な式とは異なる。それでも既知の検査位置2だけでは一致してしまう。ゼロの式を禁止する条件はないため、この単純な答えも有効である。

### miss-points

目的：先に固定した偽の式ごとに見逃し点が決まることと、その点が重ならない二式を作れることを確認する。

答えは **`[[0,0,0],[1,0,3]]`**。二式を A(t)=0、B(t)=(1+3*t*t)%5 とする。

A の二点の和は0。B(0)=1、B(1)=4だから、Bの二点の和も `(1+4)%5=0`。両方とも偽の claim と一致する。

| t | 正直な P2(t)=(3t+t²)%5 | A(t) | B(t)=(1+3t²)%5 |
| --- | --- | --- | --- |
| 0 | 0 | 0 | 1 |
| 1 | 4 | 0 | 4 |
| 2 | `(6+4)%5=0` | 0 | `(1+12)%5=3` |
| 3 | `(9+9)%5=3` | 0 | `(1+27)%5=3` |
| 4 | `(12+16)%5=3` | 0 | `(1+48)%5=4` |

A の見逃し点は `[0,2]`、Bは `[1,3]`。それぞれちょうど2点で、共通する点はない。提出は点の一覧ではなく上の二係数リスト。この式を固定してから独立に等確率で一点選ぶ場合、それぞれの見逃し率は2/5。

## 有限探索の関数

`/private/tmp/sumcheck-reader-functions.py` に、ヒントの順序どおりに lie_caught と miss_points を書いた。実行していない。前者は三係数の列挙と二条件の比較、後者は三係数の列挙・全地点の比較・保存済み候補との点の比較だけを使う。

今回の p=5 では列挙候補は最大125個。miss_points の内側にも全5点の検査と保存リストの走査があるため、125という数は全処理回数ではなく候補数の上限。保存候補も最大125個で、どのループも有限。解がなければ最後に例外を出し、発見したようには扱わない。

## 厳しめの指摘と整合確認

### 要確認：第8問の存在保証に条件が足りない

本文は r1 を0〜p−1から等確率で選ぶとし、pは5または7、dは非ゼロとする。一方、最後のヒントは最大p³候補で組が見つかると言い切っている。

表示値のうち r1 を、本文が許す **1** にした場合を手で考える。正直な二番目の式は `g(1,t)=0` になるため second=[0,0,0]。`P1(1)=0` で、`d*(1-r1)=0` だから偽の claim も0になる。最初の偽合計は変わっていても、この先の主張は本当と同じになってしまう。

p=5で、そのゼロ式とちょうど二点 u,v で一致する非ゼロの次数2以下の候補は `k*(t-u)*(t-v)` の形になる。二点の和を0にするには `2*u*v-u-v+1` の余りが0でなければならない。異なる二点の10組でこの値を計算すると次のとおり。

| 根の組 u,v | `(2uv-u-v+1)%5` |
| --- | --- |
| 0,1 | 0 |
| 0,2 | 4 |
| 0,3 | 3 |
| 0,4 | 2 |
| 1,2 | 2 |
| 1,3 | 3 |
| 1,4 | 4 |
| 2,3 | 3 |
| 2,4 | 1 |
| 3,4 | 3 |

可能なのは見逃し点 `{0,1}` だけなので、共通点のない二式は存在しない。ゼロ式自体は5点で一致するので「ちょうど2点」を満たさない。

今回の公開値 r1=2 はこの問題に当たらない。生成器が r1=1 を除いているなら、「本来は全点から選ぶが、この作問では偽の次の主張を変えるため r1≠1 の記録を使う」などの出題条件を参加者に示すと、存在保証と一様乱数の説明が両立する。生成器が除いていない場合は、一部の出題が解けない可能性がある。内部は未読なので、その実装状態は断定しない。

### 初心者が止まりそうな小さな飛躍

- 1〜6は写すコードがあるが、7〜8では三重ループのコードを自分で組み立てる。`range(p)` が0〜p−1を返すこと、`continue` が今の候補を飛ばすことの一言があると入口が明確になる。
- 第8問の「保存」は、係数と一致点のリストをセットで残す必要がある。例えば `saved.append([candidate, points])` と取り出す形の構文例があれば、数学を理解したのに保存形式で止まることが減る。これは計算条件の欠落ではなく初心者Pythonの支援余地。

### 時間順序と暗号の保証

- 本来の「P1固定→r1→P2固定→r2」と第7問の意図的な順序逆転は明確。第8問は r2 を関数の引数に受け取らず、全点を調べるので、第7問との計算上の違いもある。
- ただし参加者は画面で r2 をすでに見ている。引数から外したこと自体が、未知の乱数より前に式を固定したという実行上の証拠にはならない。本文は終了後の記録と明示し、確率も「固定した後に選ぶなら」と条件付きなので、現状の数学的説明は正しい。この演習で安全な実通信順序を実証した、と追加で主張すべきではない。
- 2/p は各固定式を最後の一点検査が見逃す確率、と限定されている。二段全体の誤受理率や二式を組み合わせた率にはしていない。ゼロ知識や実用上の安全性も主張しておらず、今回の説明に過大な暗号保証は見つからない。

### 定義・依存・返却形

- `%`、負の余り、係数、次数、W、g、P1、P2、claim、見逃し点は本文から定義を追える。後半は前半の自作関数の戻り値に依存せず、提供済み poly と引数から claim を計算できるので循環依存はない。
- 本文・スターター・ヒントで各署名と返却形は一致する。第7問は一式の三係数、第8問は二式の三係数の組で、見逃し点自体は提出しないと繰り返し説明されている。
- チェックポイントのハイフン付きIDとPython関数のアンダースコア名は異なるが、final_check、lie_caught、miss_points がそれぞれ明記されており、古い署名の残存とは判断しない。


## Response to the second read

The reader found a genuine missing restriction: if r1 were 1, the dishonest next
claim could equal the honest claim and the disjoint-pair construction could have
no solution. The statement now says the practice records are selected with r1 at
least 2. It distinguishes the full protocol's fresh uniform choices from these
selected, completed teaching records. A fixture regression checks that restriction
and the difference between the honest and dishonest next claim. The current
reader's public values and hand answers were unchanged.

## Author-executed runtime verification

- The real Compose Inspect returned the same p,x,first,r1,second,r2,d assignments
  used in the independent read.
- Both languages' six free blocks, inserted into the actual API starter, passed
  six public checks and left the construction rows unfinished. Adding the two
  reader-authored functions completed all eight public checks in both languages.
- Those same functions passed 80 varied author fixtures covering both primes,
  every allowed r2 value, distinct graded outputs and both construction conditions.
- All eight reader hand answers passed `/api/prepare` → `/verify`. Eight wrong
  values and eight unprepared values were rejected without failure reasons.
  Different satisfying constructions passed; an honest message with the wrong
  claimed sum and a repeated pair of blind spots failed.
- Learner execution could not read the seed/generator or verifier connection data,
  open Python/native/child sockets, access parent memory, kill the supervisor,
  change its resource limits or escape the process group. Grading still worked.
- Docker reference-test passed: 23 mutations killed, 9 learning/submission tests
  and 5 Linux isolation tests. Mutants fail for actual arithmetic or condition
  violations, never a stale function signature. Public/private construction
  predicates agree over every coefficient and every sum-eligible pair across
  twelve varied fixtures. Honest message identities are checked at every point.
- Streamed Docker CLI `make test` passed with the participant-derived functions.
  Root `make install` and `make agent-gate` passed.

The independent reader did not inspect the private fixtures used by later author
checks. No human browser playtest, shared deployment or real AWS event was run.

## Reader-authored construction functions

```python
"""Finite-search drafts written from participant-visible hints only.

Not executed. poly is the helper supplied by the exercise.
"""

from participant.model import poly


def lie_caught(p, first, second, r1, r2, d):
    claim = (poly(p, first, r1) + d * (1 - r1)) % p
    target_at_r2 = poly(p, second, r2)
    # range(p) visits 0, 1, ..., p-1.
    for a0 in range(p):
        for a1 in range(p):
            for a2 in range(p):
                candidate = [a0, a1, a2]
                endpoints = (poly(p, candidate, 0) + poly(p, candidate, 1)) % p
                if endpoints != claim:
                    continue
                if poly(p, candidate, r2) == target_at_r2:
                    return candidate
    raise ValueError("No candidate satisfies both conditions")


def miss_points(p, first, second, r1, d):
    claim = (poly(p, first, r1) + d * (1 - r1)) % p
    saved = []
    for a0 in range(p):
        for a1 in range(p):
            for a2 in range(p):
                candidate = [a0, a1, a2]
                endpoints = (poly(p, candidate, 0) + poly(p, candidate, 1)) % p
                if endpoints != claim:
                    continue

                points = []
                for t in range(p):
                    if poly(p, candidate, t) == poly(p, second, t):
                        points.append(t)
                if len(points) != 2:
                    continue

                for saved_item in saved:
                    saved_candidate = saved_item[0]
                    saved_points = saved_item[1]
                    if points[0] not in saved_points and points[1] not in saved_points:
                        return [saved_candidate, candidate]

                saved.append([candidate, points])
    raise ValueError("No pair has exactly two disjoint agreement points")

```

## Final code-review wording corrections

The starter now states the intentionally unsafe order directly: reveal the
challenge first, then construct the message. The safe order is stated separately.
The first construction hint says the expression matches at the revealed position,
without claiming it matches only there; additional agreement positions are allowed.
These corrections change no arithmetic, signatures, or acceptance conditions.

## 2026-09-07 participant-only reread (Issue #716 / PR #804)

An independent reader inspected only Japanese/English participant instructions and public starter surfaces, without hidden tests, reference code or verifier implementation. The first pass found that a linear expression before reduction was conflated with its wrapped remainder values, and that the forged first polynomial required an accompanying false initial total but the statement did not say so. Both languages were revised to separate before/after reduction and to diagram the false initial total and next-round claim. The participant-only reread confirmed both gaps resolved. This records text and hand-calculation review, not UI submission. Earlier entries above concern earlier text.
