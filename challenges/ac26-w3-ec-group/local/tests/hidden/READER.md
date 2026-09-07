# EC group: participant-role first reading (2026-09-07)

Status: rewrite in progress; this problem is not yet accepted.
Baseline: Challenge main `2154b59c`. The author performed this reading using only
Japanese instructions, checkpoint hints, and the shipped `curve.py`. No hidden
checker, reference implementation, or fixture generation was read for this pass.
This is not an independent human playtest or a claim of runtime success.

## First-pass gaps

1. The opening promises that nobody can recover k quickly from kP, without limiting
   that claim to suitable large groups. Small classroom curves allow enumeration.
2. The opening switches P from the starting point in kP to the output in P=kG.
   Use a fixed base G and output Q=kG consistently.
3. “楕円曲線” is used before explaining the set of coordinate pairs satisfying the
   displayed remainder equation. “toy” is also undefined in the short description.
4. The group definition confuses changing order with changing parentheses and omits
   closure. Explain these separately; commutativity is an extra property here.
5. “接線”, “弦”, “傾き”, and “導く” in the doubling hint demand geometry/derivation
   that the problem's supplied-rule contract says is unnecessary.
6. Five checkpoints have no hints, and the others begin with implementation advice
   or a hidden-test concern, rather than mechanism → small example → screen action.
7. The necessary modular inverse construction is delegated to a different problem.
   Define a usable calculation procedure here as well as offering the prerequisite.
8. The first worked slope uses modulus 11 and larger products. Add a small modulus-7
   example that exposes the ordinary point (0,0) and the separate identity O.
9. Equality/hash ignore the curve in the starter. The statement does not explicitly
   specify whether equivalent, separately constructed curves count as the same curve.
10. Trace output for zero and negative scalars is unspecified, although negative
    scalar multiplication is required. State trace's actual intended domain.
11. The scalar explanation introduces binary digits and powers-of-two notation
    without first showing repeated division by two with its remainder.
12. The statement calls secp256k1 a “256桁” case in one place, conflating binary
    length with decimal digits. Define a bit and describe the actual input size.
13. The `properties` step names laws without enough small before/after examples
    tied to the existing methods; the reason this step follows addition is obscured.
14. Public feedback currently describes testing only distinct addition and O;
    readers have no public feedback loop for the other six implementation steps.

## Hand work recoverable from the given rules

A modulus is the positive divisor used to take remainders. For a smaller example,
use y²=x³+x with divisor 7 and P=(1,3). Membership: 3² leaves 2 and 1³+1 leaves 2.
The opposite point is (1,4), since 3+4 leaves zero. O is a separate marker, never
(0,0). Doubling P: numerator 3·1²+1=4, denominator 2·3=6; the inverse of 6 is 6
because 6·6 leaves 1. Thus λ=4·6 leaves 3; x=3²−1−1 leaves 0 and y=3·(1−0)−3=0.
So 2P=(0,0), and doubling that point gives O before any division by zero.
Consequently 4P=O, 5P=P and −P=(1,4). These are hand calculations, not results
read from a fixture or an expected-answer file.

For scalar 5: successive division by two gives (quotient,remainder)=(2,1),(1,0),
(0,1). Starting accumulator O and addend P, the rows end at (P,2P), (P,4P),
(5P,8P). This explains the existing trace fields using a one-digit scalar.
The existing statement gives no unambiguous row contract for scalar zero/negative;
no successful solution of those unspecified cases is claimed.

## Sources for the rewrite

- Seminar repository: `week3/README.md`, and the linked `week3_zksnark_slides.pdf`
  (inspected after the first pass: pages 22–30 extracted to
  `/private/tmp/ec-week3-slides.txt`, page25 rendered and visually checked at
  `/private/tmp/ec-slide25.png`).
- Owner's notes: `advanced-cryptography-note/week3/index.html`, slide cards 22–30
  and “やってみる” questions 1–5. These distinguish coordinate addition from the
  defined group operation, order from field modulus, and doubling from addition.

Next: inspect the actual course PDF and the runtime contracts; rewrite the two
languages without inventing new success criteria, then run the participant route
and positive/negative grader tests. This file records gaps, not completion.


## Frozen author-role implementation and baseline runtime

`reader-curve.py` was written from the revised statement's formulas and API names.
This is not a new independent blind read: author inspection of the existing
checker and reference had already occurred after the initial pass above.
SHA256: `9dae080a9bf9639ab094f6e32a5fcc7746acf740c5fd61c23bac6a0cea716592`.
Local checks reproduced the hand calculation for p7, P=(1,3), 2P=(0,0), 4P=O,
5P=P, -P=(1,4), scalar-zero empty trace, and the three scalar-five trace rows.

The current Docker author image `ac26-w3-ec-group-reader-author` then accepted
this implementation on all eight checkpoints, using synthetic seed
`ec-reader-716`. Log: `/private/tmp/ec-group-reader-baseline.log`.
This was a direct call to the real Linux verifier, not a Portal/browser check.

A second source containing only `print('{"failures":[]}')` and `raise SystemExit`
was also accepted on all eight checkpoints. Log:
`/private/tmp/ec-group-stdout-spoof-before.log`. This is a confirmed baseline
verifier defect: the learner can announce success without computing any point.
The problem is not accepted as complete; parent-owned mathematical checking and
positive/negative runtime regressions are required before this rewrite can merge.
No AWS deployment has been performed.


## Parent-owned checker and native dispatch progress

The verifier now evaluates the curve rules in its parent process. The worker
receives only source and requested operations, without the seed or checker. Public
checks use the same value adapter and now cover eight small example groups.
An incorrect point, trace row or printed success cannot replace those checks.
The reference and frozen reader both pass all eight private checkpoints and public
examples. Log: `/private/tmp/ec-group-public-first.log`.

Eleven boundary regressions initially found one remaining escape: Python frame
access could replace the response encoder's closure cell and mislabel a builtin
exception. That failed run is `/private/tmp/ec-group-boundary-regressions.log`.
The native call/exception/response adapter, also used by the Field rewrite, fixes
that path without putting the curve solution in the participant image. All eleven
regressions then passed in 18.502 seconds (`/private/tmp/ec-group-native-tests.log`)
and all ten existing mutations were rejected
(`/private/tmp/ec-group-native-mutations.log`). The parent still treats protocol
values as untrusted and owns the verdict; native-return attestation against an
independent wire-protocol implementation is not claimed.

These results preceded the final integrated validation recorded below.


## Integrated local Portal acceptance

The real `ContainerWorkbenchPanel` component was rendered with the actual config,
starter and Inspect payload from the dedicated local Compose environment
`ac26-ec-reader-716`, Workbench `http://127.0.0.1:18172`, synthetic seed
`ec-reader-716`. The test replaced the visible starter with the frozen reader,
clicked Inspect and public tests, then submitted all eight checkpoints through
`/api/prepare` and `/verify`. Every verdict matched its checkpoint and was correct;
solved input controls disappeared and the sum was 300 points. The test's score
adapter projects verified local verdicts; this is not AWS scoring-history evidence.

Command:
```
AC26_WORKBENCH_URL=http://127.0.0.1:18172 sh local/tests/hidden/portal/run.sh /Users/susumu/product/TenkaCloud
```
The one real-component/HTTP test passed in 8.35 seconds, with 6.08 seconds of test
execution. Log: `/private/tmp/ec-group-final-portal.log`. No browser screenshot or
real AWS playtest is claimed. The retained harness is under `portal/` beside this
record and needs a TenkaCloud checkout as its first argument.

The final Linux suite added malformed curve/coordinate responses to the earlier
regressions: all 12 passed in 16.226 seconds (`/private/tmp/ec-group-final-runtime.log`).
The reference suite rejected all ten existing mutations. Catalog validation covered
116 entries. The statement and all eight checkpoint hint staircases are bilingual;
24 hint charges of 3 points preserve the previous total charge of 72 points.
These results complete this problem's local verification, not every problem in
Issue #716. This record also preserves the earlier failures and non-blind source
reading boundary above.

### Checkpoint-by-checkpoint reader completion check

This is the author's follow-up over the visible statement, hints, starter and
public feedback, not a second independent blind reading.

| Checkpoint | Why the step exists | Procedure and visible evidence |
|---|---|---|
| on-curve | The equation defines which coordinate pairs belong to the set. | Implement contains and point using remainders; (1,3) belongs under 7 and (1,1) does not; point-membership passes. |
| identity | The neutral element must not erase an ordinary point such as (0,0). | Use two None values for O and negate y; identity-and-opposite passes. |
| add | Point addition is the supplied operation, not addition of x and y separately. | Apply the different-point slope and reduce both output coordinates; (1,3)+(3,3)=(3,4) under 7; two-different-points passes. |
| double | The different-point denominator would be zero when the two points coincide. | Handle opposite/zero-y points before the doubling formula; hand-derived 2(1,3)=(0,0), then O; doubling-and-zero-y passes. |
| scalar | Repeated doubling lets a large count finish without one addition per unit. | Read remainders after division by 2, including k=0 and negative multiplication; signed-scalars passes and the large-parameter checkpoint succeeds. |
| trace | The rows connect the binary digits to the mathematical partial sum. | For k=5 the three rows consume 1,0,1 and end at 1P,1P,5P; each-trace-row checks before/after fields and zero's empty list. |
| properties | Combining valid individual operations must preserve the group rules. | Use the same settings across separate Curve instances, equal hashes, and parentheses/order examples; curve-equality-and-mismatch passes, then the properties submit succeeds. |
| secp256k1 | The same abstract rules should still work when the integers become large. | Retain the formulas and logarithmic double-and-add; submit the same file unchanged and receive success for the large parameters. |

The first pass's fourteen terminology/formula gaps are recorded above. The revised
statement defines remainder/modulus, inverse, identity, group/order, bit, hash and
trace field meanings before they are needed. The p7 example can be checked by hand;
the submitted reader uses those rules rather than a fixture's finished answer.
