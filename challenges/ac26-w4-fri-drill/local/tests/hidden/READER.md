# FRI reader and runtime evidence (2026-09-06)

## Inputs

The independent junior-high-role reader received only participant statements, hints, starter text and one public Inspect snapshot.
They did not run code or access the fixture generator, reference, hidden checker or repository. The author separately read the
seminar Week 4 printed slide 23 (local PDF page 27), the personal notes' derivations §2.7 and Drill B, and the FRI paper scope.

## Initial defects caught

The initial reader found mismatched twelve steps/eight answers; missing commit/query definitions;
all sixteen starter functions empty; Inspect described as assignments but shown as JSON; degree “exactly half”;
first-fold comparison presented as the full protocol; final constant never checked; unconditional two-root and
independent-probability claims; and complete code transcription instead of a clear paper route.

## Revised reader

The first seven rows were manually derived from the revised hints. The closing task was subsequently strengthened as described below. The reader judged the first action, example-to-real substitution,
separation of local consistency from full FRI, and independent sampling condition followable. They caught one new mathematical
error: the altered expression can become constant, so “same degree” was replaced by “altered short expression”.
They also requested helper argument signatures; these are now supplied. The first action refers to a first VALUE in one
comma-separated answer, not three separate UI inputs.

Public snapshot: p=5, q0=0,q1=1,q2=4,q3=1,beta=3,beta2=2,x=4,d0=3,d1=3.
The derived first fold is Q1(Y)=3+2Y. The altered Q1'(Y)=6+5Y leaves constant 1.

| Row | Independent hand answer | Reason |
|---|---|---|
| poly | 0,1,1 | substitute 0,1,2 in Q |
| fold | 3,0,2 | substitute 0,1,2 in 3+2Y |
| fold2 | 2 | 3+2×2 leaves 2 |
| query | 2,1 | Q(4),Q(1) |
| recover | 4,2,4,2 | inverse of 2 is 3, inverse of 8 is 2 |
| consistency | 0,0 | 4+3×2 and 3+2×16 both leave 0 |
| cheat-caught | 0,1 | the fixed left stays 0, the altered expression is 1 |
| miss-points | 4,1,4,0,1,0 | A=Y−1, B=(Y−1)(Y−4); constructed in the final reader below |

## Independent closing-task reader

The code review identified that the original final root enumeration was still a prescribed calculation.
The closing checkpoint now requires two constructions, accepts multiple valid answers, and checks constraints.
A second participant-only packet contained the new instructions/hints/starter, the above Inspect snapshot,
and an additional public case p=7,x=2. The same independent reader used hand expansion only, without code
or repository internals, and derived:

- p=5,x=4: A=Y−1, B=(Y−1)(Y−4), giving 4,1,4,0,1,0.
- p=7,x=2: A=Y−4, B=(Y−1)(Y−2)(Y−4), giving 3,1,6,0,0,1.
- Alternate p=5 answer: double each difference, giving 3,2,3,0,2,0.

They found the free statement requires selecting square positions and factors, expanding, and checking;
it does not provide a completed valid B. The optional final hint supplies the construction strategy but
still requires the participant's work. A illustrates adaptive query timing; B illustrates the restricted
evaluation domain and degree cap, not an attack on FRI proximity soundness. Their small wording findings
were fixed: the diagram now says to add a linear difference (the resulting fold may become constant), and
coefficient/factor definitions occur at first use. This is an independent-role reading, not a human event playtest.

## Real participant API

The two-service Compose run used the same public snapshot as the reader. Through the public workbench only:
config/starter/Inspect → prepare → verify accepted all eight hand answers. Eight deliberately wrong and eight
unprepared answers were rejected without expected values or reasons. The statement's exact first editor change
passed poly's public check and printed the deployment answer while seven unfinished functions remained FAIL.
An independently written scratchpad using the visible formulas passed all seven public worked examples and the final public construction constraints. The final reader’s
alternate answer was also accepted; honest/zero differences, excess degree and partial-query matches were rejected. A learner-code
probe confirmed FLAG_SEED and fixtures are absent. No reference answers were used to derive the reader submissions.

Author checks separately verify 80 changing fixtures, the exact public one-digit example, every nonzero query position,
strict types/shapes, partial prepare, wrong-row and wrong-deployment envelopes, and twelve intentionally broken arithmetic/construction rules. Ten learning-contract tests include both primes,
every query, and independent nonzero scalings of both constructed differences, so valid alternatives cannot be rejected
by a hidden exact-answer comparison.
Five Docker checks exercise the actual CLI and browser launchers' network/native socket/child restrictions, parent protection,
descendant cleanup, Inspect assignments and fail-closed filter installation. Catalog validation covers 116 problems.

This evidence proves the arithmetic and actual participant API routes. A full Portal browser playthrough and a human
40–60-minute event rehearsal were not performed in this rewrite; no such result is claimed. Neither is a full FRI security proof.

## 2026-09-08 participant-only reread (Issue #716)

An independent reader used only Japanese/English participant instructions and public starter surfaces, without hidden tests, reference code or verifier implementation. The first pass found that “Y=X²” conflicted with the arithmetic exercise evaluating Y=2 when p=5: the possible square remainders are only0,1,4. The instructions now distinguish evaluating the expression at any Y for arithmetic practice from comparing with Q only at Y=x². On rereading both languages, the reader confirmed this gap was resolved with no additional missing step. This was a text and hand-calculation check; UI submission was not tested by that reader.
