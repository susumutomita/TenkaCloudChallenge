# (0, 0) is not the point at infinity

> This track is an independent, unofficial companion to the Advanced Cryptography Program 2026.
> It is not affiliated with or endorsed by the course or its operators. All problem statements,
> code, fixtures, and figures here are written independently. Questions about this track go to
> the TenkaCloud repository, not to the course operators.

**Track:** `advanced-cryptography-2026` · **Order:** 320 · **Chapter:** Week 3 / Elliptic Curve
Group Law · **Role:** `mechanism` · **Time:** 75–105 minutes · **Points:** 300
· **Required first:** `ac26-w3-field-inverse`

## The story

The claim is that the points of

```text
y^2 = x^3 + a*x + b   (mod p)
```

together with one extra element, form a group. Slides assert it. Here you build it, and the
build is where the assertion turns out to have four cases rather than one formula.

## The trap in the title

Six of the seven toy curves here have `b = 0`. On any of them `(0, 0)` satisfies the equation —
it is an ordinary point of the curve, of order two, and `make inspect` will print it in your
point list.

So an implementation that represents the point at infinity as `(0, 0)` cannot tell the identity
from a real element of its own group. This is not a hypothetical; the hidden tests pick such a
curve and check by name that the two do not compare equal.

## Four cases, not one formula

| Case | Result |
|---|---|
| Either side is the identity | the other side |
| Same `x`, opposite `y` | the identity — this includes doubling a point with `y = 0` |
| The same point | tangent slope `(3x² + a) / 2y` |
| Anything else | chord slope `(y₂ - y₁) / (x₂ - x₁)` |

Substituting `P = Q` into the chord's slope gives `0/0`. Doubling has its own formula not as an
optimization but because the chord does not exist there.

## How to play

```bash
make inspect            # your curve, its points, and where the tangent is vertical
make inspect K=13       # the bit decomposition for any scalar
make test               # public tests
make reset              # restore starter/curve.py
```

You edit one file, `local/starter/curve.py`.

## Scoring

Eight checkpoints, scored independently. Wrong answers cost 15 points each.

| Checkpoint | Points | What is checked |
|---|---:|---|
| `on-curve` | 30 | Every coordinate pair classified, and off-curve pairs rejected |
| `identity` | 30 | The identity distinguished from `(0, 0)`, and `P + (-P) = O` for every point |
| `add` | 45 | Every ordered pair of distinct points |
| `double` | 45 | Every point, including the vertical-tangent ones |
| `scalar` | 45 | Double-and-add, with `k = 0`, `k = 1` and negative `k` |
| `trace` | 35 | Each step's accumulator against the bits consumed so far |
| `properties` | 40 | The axioms and the homomorphism, on a curve you have not seen |
| `secp256k1` | 30 | The same abstraction over the published real parameters |

Hints on five of the eight, each inside that checkpoint's 50% cap.

## Exhaustive, not sampled

The curves are small — 23 to 47 points — so nothing here samples. Every coordinate pair is
classified, every ordered pair of distinct points is added, every point is doubled, and the group
axioms are checked across the whole group. An implementation that handles the generic case and
breaks on the identity, on `P + (-P)`, or at `y = 0` has nowhere to hide.

## How the trace catches bit order

Double-and-add consumes bits least significant first. Immediately after step `i`, the accumulator
must equal the number formed by the low `i+1` bits, times `P`. The trace checkpoint verifies that
on every row, so an implementation consuming bits the other way fails on the first one — getting
only the final answer right is not enough.

## What the secp256k1 checkpoint actually checks

Every relation it checks follows from the definition of the published parameters, rather than
matching a value transcribed from somewhere:

- `G` is on the curve;
- `n` is the group's order, so `n·G` is the identity;
- therefore `(n-1)·G = -G` and `(n+1)·G = G`;
- `(k+m)·G = k·G + m·G`.

No copied expected value is needed, so no mistyped or unsourced constant can creep in.

## Not constant-time

Double-and-add branches on the scalar's bits, and how many additions it performs depends on how
those bits fall. Against a real key that property is itself a side channel. This exists to make
the algorithm legible, not as a model for production.

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

`make reference-test` runs the mutation suite: ten broken implementations. Two of them found real
holes while this problem was being written — a curve-mismatch check that skipped itself when the
seed happened to pick the same curve twice, and an "aliases the input point" mutation that turned
out to be an equivalent mutant and was replaced with one that genuinely writes through.
