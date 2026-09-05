# Participant-only reader and runtime evidence — 2026-09-06

An independent agent read only the Japanese statement, hints, editor starter and
public Inspect values, with junior-high mathematics and beginner Python as its assumed
background. It did not execute code or read generators, reference answers or grading.
This is an agent read-through, not a human event playtest.

## Corrections before the final design

The initial reader found verified markers that the formula could not produce, a count
example missing its requests, and an overbroad claim about different-election markers.
Fixtures now draw verified markers from the formula's output range for that election;
the statement shows the example requests and explains the tiny model's repeated markers.

PR review then found that seven completed code blocks plus a tiny final search made
most of the exercise transcription. It also requested a concrete participant role and
plain definitions of the claimed checks. The introduction now casts the participant
as a school voting-service maintainer investigating lost legitimate votes. It describes
what is checked without assuming anonymity or proof vocabulary.

The last two rows were replaced with constructions carrying half the score. Row 7
combines verification and election failures to erase two valid votes; row 8 composes
identity collisions, changed votes and election handling into one five-vote witness
with four distinct counting policies. Both accept any satisfying construction.
Only the first six rows provide completed code. Required rules and pair-sized examples
for both constructions are free; each has the same three optional hint stages.

## Final independent hand answers

The reader's fixture is p=5, secret=2, scope=3, scope_ids=[3,4], messages=[1,1].
Number the six attempts from 1 through 6:

1. (True,4,4)
2. (True,3,3)
3. (True,3,4)
4. (True,3,3)
5. (False,3,3)
6. (False,3,2)

| Field | Hand answer |
| --- | --- |
| label | 2 |
| repeat | [2,2] |
| scopes | [2,3] |
| accept | [False,True,True,False,False,False] |
| count | 2 |
| message | [True,False] |
| unchecked | [5,2,1,3] |
| collision | [[2,3,0],[3,3,0],[2,3,1],[0,3,1],[2,4,0]] |

For row 7, request 5 consumes marker 3 prematurely and request 1 consumes marker 4
for the wrong election. A correct handler accepts requests 2 and 3; the record-first
handler accepts none. This differs from the author's first valid ordering.

For row 8, ordinary markers are 2,2,2,3,3. Keys identifying people directly give four
votes; per-election marker keys give three; markers alone give two; adding vote content
before the remainder gives four per-election keys. The reader combined the conditions
independently and judged that copying the teaching blocks cannot finish these tasks.
It caught one remaining starter instruction saying rows 1–7 could be copied; that was
corrected to 1–6 before final runtime checks.

The reader also generalized the five-vote construction: start with secret and p-secret
in this election, repeat the first person with a changed vote, then choose x,y with
different x² from secret² and x²−y² remainder 1. The latter two votes share a second
marker across elections. Choose the fourth vote's content to keep its vote-dependent
marker distinct. At most p² candidate pairs suffice. The author executed this
independently proposed construction for all 30 permitted p/secret/scope combinations;
every result met the published conditions. No such completed construction is shipped.

## Actual participant runtime

The author submitted all eight hand answers through Docker `/api/prepare` and `/verify`:
8/8 accepted; eight wrong and eight unprepared submissions rejected. Both languages'
six published blocks copied into the actual `/api/starter` passed the teaching rows
but left both constructions unfinished. Implementing the hand-order construction and
the reader's generalized five-vote construction passed `/api/test` and the CLI public
suite. Different satisfying schedules were accepted; well-formed constructions with
incorrect acceptance counts were rejected.

Actual Inspect originally exposed a missing import path; it was fixed and is covered
by a regression. Learner execution could see neither the fixture seed nor the generator.
API probes denied IPv4/IPv6/Unix sockets, native libc networking, child networking,
parent memory, parent SIGKILL/resource-limit changes and changing session/process group.
The trusted grading proxy still worked. A completed execution left no running descendant.
CLI uses the same fail-closed restrictions.

The final author suite killed 20 mutants and passed 11 learning/boundary checks plus
five Linux runtime checks. These runs exercise real participant APIs and CLI, not a
deployed Portal, live AWS event or human event. No production deployment was performed.
