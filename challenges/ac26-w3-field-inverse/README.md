# Build the field before the curve

Before the curve equation, the field underneath it: normalization, arithmetic, and the inverse from the extended Euclidean algorithm. Over a composite modulus some elements have no inverse at all, and one popular implementation never notices.

## Browser workflow

1. Start the problem in the Participant Portal and open **Browser Workbench**.
2. Run `inspect` and read the deployment-specific fixture and published evidence.
3. Edit the starter sources on the page and run the public `test` command.
4. Complete any direct-answer fields from the evidence and your experiments.
5. Run `prepare`, then paste every generated value into the matching Portal checkpoint.

Direct answers are bound to the current deployment seed by `prepare`.

## Learning goals

- Tell an integer apart from a field element
- Normalize negatives and values past the modulus to a canonical representative
- Implement addition, subtraction and multiplication modulo p
- Derive the multiplicative inverse from the extended Euclidean algorithm
- Verify a * a^-1 = 1 as a property rather than on one example
- Raise an explicit error for zero and for non-invertible elements
- Show the difference between a prime and a composite modulus with a counterexample

## Checkpoints

| Checkpoint | Purpose | Points |
| --- | --- | ---: |
| `normalize` | Turn an integer into a field element |  |
| `arithmetic` | Arithmetic, and the axioms it must satisfy |  |
| `egcd-trace` | Show every step of the extended algorithm |  |
| `inverse` | Inverse and division |  |
| `errors` | Say that something does not exist |  |
| `composite` | Build a counterexample over a non-prime modulus |  |
| `axioms` | Hold the axioms over a prime you have not seen |  |

## Explanation

## Integers and field elements

`-5` and `p - 5` name the same element of `F_p`, but `-5` is not a canonical representative of it. Normalizing when the element is constructed means a negative input and an input past the modulus take the same path afterwards. Python's `%` returns a non-negative result for a positive modulus, so that is one operation.

Reducing only at the end produces the right final answer for this exercise. What it fails is being asked about an intermediate value, and the hidden tests check that every arithmetic result lands in `[0, p)`.

## Why the extended algorithm says more than Fermat

`pow(a, p - 2, p)` is an inverse only when `p` is prime. Over a composite `n`, `pow(a, n - 2, n)` still returns a number — it just is not an inverse, and nothing tells you unless you check.

The extended Euclidean algorithm returns `a*s + n*t = gcd(a, n)`. When the gcd is not 1 there is no inverse, and the algorithm has told you so. Knowing the answer does not exist is the difference, and the first mutation in the suite fails on that difference alone.

## Why the trace is compared row by row

The trace checkpoint originally checked only that each row satisfies `a*s + p*t = r` and that the last row matches the gcd and the inverse. A mutation that returns *only the last row* survived that: a one-row table satisfies every one of those conditions.

It now compares the step count and each row's `(q, r, s, t)` against the reference sequence. Floor division makes that sequence deterministic, so there is exactly one right answer.

## Exhaustive, not sampled

The inverse checkpoint runs every non-zero element of the prime field — `p - 1` of them, with `p` in the hundreds. Not a sample, so special-casing a few values is not a strategy. The axioms checkpoint goes further and checks that inversion is a bijection on the non-zero elements: in a field the inverse is unique, and two different elements never share one.

## The trace is not constant-time

The trace `show.py` prints branches on its inputs, and its step count depends on them. In an implementation handling a real key, that property is itself a side channel. This is here to make the algorithm legible, not as a model for production code.

## Where this leads

The next problem builds the curve's group law. Point addition has a field inverse in its denominator, so this `inverse` is used directly — and the cases where the denominator is zero turn out to be exactly the group law's case split.

## Authoring and validation

Participants do not need a checkout. Repository maintainers use the Makefile author targets and CI as the validation source of truth.
