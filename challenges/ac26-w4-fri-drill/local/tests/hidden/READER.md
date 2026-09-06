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

All eight rows were manually derived from the final hints. The reader judged the first action, example-to-real substitution,
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
| miss-points | 2,3 | 3+3t² leaves 0 exactly there |

## Real participant API

The two-service Compose run used the same public snapshot as the reader. Through the public workbench only:
config/starter/Inspect → prepare → verify accepted all eight hand answers. Eight deliberately wrong and eight
unprepared answers were rejected without expected values or reasons. The statement's exact first editor change
passed poly's public check and printed the deployment answer while seven unfinished functions remained FAIL.
An independently written scratchpad using the visible formulas passed all eight public examples. A learner-code
probe confirmed FLAG_SEED and fixtures are absent. No reference answers were used to derive the reader submissions.

Author checks separately verify 80 changing fixtures, the exact public one-digit example, every nonzero query position,
strict types/shapes, partial prepare, wrong-row and wrong-deployment envelopes, and eight intentionally broken arithmetic rules.
Five Docker checks exercise the actual CLI and browser launchers' network/native socket/child restrictions, parent protection,
descendant cleanup, Inspect assignments and fail-closed filter installation. Catalog validation covers 116 problems.

This evidence proves the arithmetic and actual participant API routes. A full Portal browser playthrough and a human
40–60-minute event rehearsal were not performed in this rewrite; no such result is claimed. Neither is a full FRI security proof.
