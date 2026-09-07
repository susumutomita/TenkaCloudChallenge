# Revised participant reading — root, 2026-09-07

Inputs: revised-ja.md and revised-en.md only, including all 24 hints. This follows the recorded original public-only reading and its frozen answer; it is not a new blind reader. No amended verifier or hidden cases were consulted for this read.

- plan: count each organization product and fresh triple; independent differences need one opening round. For k=2 return multiplications=2, triples=2, rounds=1. The first checkpoint is independent of aggregate, and the text distinguishes the unfinished public score test.
- share-inputs: preserve the supplied random draws modulo p, balance the last share. 2-5=-3, whose remainder modulo7 is4, so [5,4] reconstructs2. There is no spec argument in this function.
- linear: one public adjustment enters the sum once. [5,4]+1 at owner0 gives [6,4] and reconstructs3; adding everywhere gives4.
- multiply: select each organization own triple in both loops. Organization0 d/e=[3,5]/[3,5] both open1; product pieces [3,3] reconstruct6. Organization1 d/e=[2,3]/[5,5] open5/3; product [2,2] reconstruct4. Adding positions and bias gives [6,5], reconstructing4. This follows c+db+ea+de with the public final term once.
- result: only representation/order changes preserve output. Raising organization0 count by1 changes score by severity3, yielding0 modulo7. This tests a relation rather than a single sample result.
- privacy: the modeled channel must show the multiset [1,1,5,3], with repetitions retained and no extra inputs. Same-mask reuse opens input differences. This claim concerns the modeled opening observer; the central Python program holds all shares.
- cost: all four independent difference sharings can go in one open_batch call; two calls opening the same four values cost two rounds. Reuse and opening count are separate properties.
- transfer: the same four functions must follow new p, party count and arguments, rather than copying example constants. Parent-field spec[parties] is an integer; list lengths are distinct.

Remaining wording feedback sent to author: define this as additive shares rather than implying every secret-sharing scheme reconstructs by simple addition; replace undefined execution seed with ordinary language. Check random-mask generation includes zero before claiming the full uniform remainder distribution. Revised English gives the same index roles and all eight meanings. No arithmetic mismatch found in the p7 table.
