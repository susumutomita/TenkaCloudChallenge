# Build the field before the curve

> This track is an independent, unofficial companion to the Advanced Cryptography Program 2026.
> It is not affiliated with or endorsed by the course or its operators. All problem statements,
> code, fixtures, and figures here are written independently. Questions about this track go to
> the TenkaCloud repository, not to the course operators.

**Track:** `advanced-cryptography-2026` · **Order:** 310 · **Chapter:** Week 3 / Finite Fields
· **Role:** `mechanism` · **Time:** 45–60 minutes · **Points:** 200

## The story

Every elliptic-curve slide starts with an equation over `F_p` and moves on within a minute,
because the field is assumed. This problem is that minute, taken seriously: you build `F_p` from
normalization up, and the last piece — the multiplicative inverse — is the one with real content.

## What you implement

```python
class Field:
    modulus: int
    def element(self, value: int) -> FieldElement: ...

class FieldElement:
    def __add__, __sub__, __mul__, __truediv__
    def inverse(self) -> FieldElement: ...

def egcd(a, b) -> (g, s, t)          # a*s + b*t == g == gcd(a, b)
def egcd_trace(a, b) -> [ {q, r, s, t}, ... ]
def non_invertible_element(modulus) -> int
```

Elements of two different moduli never combine silently.

## Browser workflow

1. Start the problem in Participant Portal and open **Browser Workbench**.
2. Run `inspect` to read this deployment's fixture and published evidence.
3. Edit the starter source in the in-browser editor.
4. Run `test` for the published checks and fill any direct-answer fields from the evidence.
5. Run `prepare`, then paste every prepared checkpoint value into Participant Portal.

No checkout, terminal, or local editor is required. Code checkpoints submit the edited source.
Direct answers are wrapped by `prepare` and bound to the current deployment seed, so a value copied
from another deployment is rejected.

## Scoring

Seven checkpoints, scored independently. Wrong answers cost 10 points each.

| Checkpoint | Points | What is checked |
|---|---:|---|
| `normalize` | 25 | Negatives, values past the modulus, idempotence, equality |
| `arithmetic` | 30 | Add/sub/mul, identities, distributivity, commutativity, associativity |
| `egcd-trace` | 35 | The step sequence, row by row, against the algorithm's own |
| `inverse` | 35 | Every non-zero element of the prime field, plus `a / b * b == a` |
| `errors` | 25 | Zero, division by zero, and mixing two moduli |
| `composite` | 25 | The smallest non-invertible element — and none over a prime |
| `axioms` | 25 | The axioms over a prime you have not been shown |

Hints on four of the seven, each inside that checkpoint's 50% cap.

## Two distinctions this problem insists on

**An integer is not a field element.** `-5` and `p - 5` name the same element; `-5` is not a
canonical representative of it. Normalizing at construction means a negative input and an input
past the modulus take the same path afterwards.

**`pow(a, p - 2, p)` is not "the inverse".** It is an inverse when `p` is prime. Over a composite
`n` it still returns a number — just not an inverse, and nothing tells you unless you check. The
extended Euclidean algorithm returns the gcd alongside the coefficients, so it can say *there is
no inverse*. The first mutation in this problem's suite is exactly the Fermat version: it passes
every prime checkpoint and fails the composite one.

## Why the trace is compared row by row

The trace checkpoint first checked only that each row satisfies `a*s + p*t = r` and that the last
row matches the gcd and the inverse. A mutation returning **only the last row** survived that — a
one-row table satisfies all of it.

It now compares the step count and each row's `(q, r, s, t)` against the reference sequence. Floor
division makes that sequence deterministic, so there is exactly one right answer.

## Exhaustive, not sampled

`inverse` runs every non-zero element of the prime field, not a sample, so special-casing a few
values is not a strategy. `axioms` additionally checks that inversion is a **bijection** on the
non-zero elements: in a field the inverse is unique, and two elements never share one.

## The trace is not constant-time

The trace Workbench `inspect` prints branches on its inputs, and its step count depends on them. In
code handling a real key that property is itself a side channel. It is here to make the algorithm
legible, not as a model for production.

## Assurance scope

Local mode is **self-paced, honor-system verification**. You own the machine, the Docker
daemon, and the image, so nothing inside that image is hidden from you: `reference/` and
`tests/hidden/` are not bind-mounted, which keeps them out of your git checkout rather than
out of reach.

What the verifier does guarantee is narrower and real: a submission cannot hang or crash it,
a checkpoint can only credit the id it echoes, results do not leak expected values, and the
fixtures come from this deployment's seed so a memorized answer does not carry.

That supports self-study and honest practice. It does **not** support competition ranking,
examination, or completion certification — those need a verifier the participant does not
administer, tracked in [#271](https://github.com/susumutomita/TenkaCloudChallenge/issues/271).

## Cost

Zero. No cloud account, no AWS resources.

## For authors

`make reference-test` runs the mutation suite: eight broken implementations. The Fermat-inverse
one passes every prime checkpoint, and the last-row-only trace survived the original checkpoint
and is why it now compares the whole sequence.
