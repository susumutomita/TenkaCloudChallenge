# Public-only first reading, 2026-09-07

Reader: root, junior-high mathematics and beginner Python role. Read only selected
Japanese/English participant metadata, hints, starter aggregate.py, public test and
participant README. No reference, hidden checker, fixture generator or verifier read.
This is an author-role read-through, not an independent human or timed playtest.

Observed gaps before writing code:
1. The first screen names MPC, share and Beaver triples without definitions and sends
   an unfamiliar reader to four different exercises. A short local glossary is needed.
2. Required Beaver formula is described as list arithmetic; organization index and
   share-owner index are conflated. Show a table with two separate indices.
3. Most worked steps use p=101 and three/five-digit arithmetic, despite one-digit bar.
4. multiply hint3 step5 reuses `triple` left from step3: it never sets
   triple=triple_list[index] in the second loop. Literal following uses the last
   organization's triple for every product. I must correct this to follow the formula.
5. cost hint says reusing a triple reduces the opening count. It need not: the same
   triple used with each pair still produces 2k differences. Privacy and cost differ.
6. privacy/cost prose calls it a set, while repeated openings matter. Explain a list
   counted with multiplicity; reordering alone must be allowed.
7. Cost hints begin with grading strategy, not what an opening/round is. The final
   input definition requires four functions but plan can be submitted independently.
8. Source-text counting (`one open_batch occurrence`, only literals0/1/2) does not
   guarantee runtime behavior; a called function/conditional can change it. Measure.
9. `Both factors belong to different people` in English conflicts with each
   organization's count and severity story. Distinguish origin owner from processors.
10. The model provides every share to one Python program, so the program can locally
    reconstruct secrets. Monitoring open_batch is not a real MPC privacy guarantee.
    Define the modeled observer and explicit boundary before claiming confidentiality.
11. Boston/Apple/Google analogies assert the same deployed mechanism without sources;
    they do not teach the actual controls. Use the local incident scenario directly.
12. Hints define share_inputs via spec even though that function has no spec argument.
    n is len(randoms[i])+1. The input-shape explanation must use accessible variables.

Per-checkpoint reading:
- plan: estimate k independent products, k fresh triples, one batched opening. Write
  plan(spec), run public tests, submit plan even before aggregate is complete.
- share-inputs: preserve supplied n-1 draws, append the modular complement per secret.
- linear: add public bias once across owners; all owners adding it multiplies it by n.
- multiply: subtract each product's masks, open d/e in one batch, combine its own
  c+d*b+e*a shares, add public d*e once, sum product shares, add bias once.
- result: changing the random split or organization order preserves score; adding h
  to one count changes score by h*severity modulo p. Same source is submitted.
- privacy: actual opening list must contain precisely each supplied d/e sharing,
  no raw input, subtotal or final score. This checks modeled observations only.
- cost: one batch and 2k openings, plan agrees; this is separate from confidentiality.
- transfer: same four functions work for new modulus/count, taking all values from inputs.

Hand example (all inputs 0..6, p7, k=n=2):
org0 x=[5,4] ->2, y=[6,4] ->3; a=[2,6] ->1, b=[3,6] ->2,
c=[4,5] ->2. d=[3,5] ->1, e=[3,5] ->1. product=[3,3] ->6.
org1 x=[3,5] ->1, y=[2,2] ->4; a=[1,2] ->3, b=[4,4] ->1,
c=[6,4] ->3. d=[2,3] ->5, e=[5,5] ->3. product=[2,2] ->4.
Open [d0,e0,d1,e1] once -> [1,1,5,3]. Sum products [5,5], add bias1
only to owner0 -> [6,5], recovered score4 = (2*3+1*4+1)%7.
plan={multiplications:2,triples:2,rounds:1}; four opened values, one round.
