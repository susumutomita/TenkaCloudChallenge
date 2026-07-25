# The same line, twice

> This track is an independent, unofficial companion to the Advanced Cryptography Program 2026.
> It is not affiliated with or endorsed by the course or its operators. All problem statements,
> code, fixtures, and figures here are written independently. Questions about this track go to
> the TenkaCloud repository, not to the course operators.

**Track:** `advanced-cryptography-2026` · **Order:** 520 · **Chapter:** Week 5 / LWE and
RLWE · **Role:** `mechanism` · **Time:** 75–105 minutes · **Points:** 200 ·
**Status:** draft

## The story

The last problem put one message on one ring and asked how far it could be pushed. This one
builds the two constructions that actually carry a message that way. They are the same
construction.

```text
LWE     secret s is a vector of n small integers
        b = <a, s> + encode(m) + e                    (mod q)

RLWE    secret s is a polynomial with N small coefficients
        b = a*s   + encode(m) + e                     in R_q
```

Replace every scalar in the first line with a polynomial and you have the second. The inner
product becomes a polynomial product, one message becomes N, one noise value becomes N. What
is left once the secret cancels — the **phase** — is `encode(m) + e` either way, and decoding
it is the previous problem's rule unchanged.

So that rule is given to you. `encode`, `decode`, `centered` and `noise_interval` ship already
written at the top of the starter. Nothing below them does.

The ring is `R_q = Z_q[X] / (X^N + 1)`. **Note the plus.** `X^N = -1`, so a coefficient that
walks off the top comes back with its sign flipped.

## The four things that are actually hard

| | Why it bites |
|---|---|
| **the fold's sign** | It is periodic, not a threshold. Degree N lands on degree 0 negated; degree **2N** lands back positive. A product of two ring elements reaches degree 2N-2 at most, so it never gets there — no amount of encrypting and decrypting will tell you which rule you wrote. |
| **the phase subtracts** | `b + <a, s>` is a perfectly well-defined number, and it decodes to the right message whenever `<a, s>` happens to be a multiple of the scaling. Often enough to pass a test written from one example. |
| **N coefficients, N budgets** | Every RLWE coefficient carries its own message and spends its own distance to the rounding boundary. The worst one decides. Not the sum, not the mean, not the magnitude. |
| **ternary secrets** | Coefficients are in `{-1, 0, 1}`, so they really are negative. Python's `%` needs no special case for that, but it does mean the reduction is doing work rather than tidying up. |

## Cyclic is not a wrong answer — it is a different ring

Folding indices with `% N` gives the ring where `X^N = +1`. That is not a broken
implementation; it is a correct product in another well-defined ring. Which is exactly why it
decrypts so many samples correctly and why a round-trip test never notices.

One counterexample settles it: is `X^(N-1) * X` equal to -1, or to +1? `make inspect` prints
both answers side by side, because a counterexample is cheaper than an argument.

## More than "RLWE is LWE with longer vectors"

Coefficient k of a product can be written `sum_j v[j] * s[j]` for a vector v built from the
mask — the same secret, every k. So one RLWE ciphertext is N LWE-shaped equations **sharing
one mask**, not N independent samples.

The entries of v are the mask rearranged, and the ones that had to cross degree N to reach
coefficient k are negated. Drop that minus and you have a cyclic rotation of the mask: a real
vector, satisfying a real identity, in the wrong ring. That is the `correspondence` checkpoint.

It is also the foundation problem 550 builds on when sample extraction pulls an actual LWE
ciphertext out of an RLWE one. Only the vector's shape is graded here; the extraction and the
key switch belong to that problem.

## How to play

```bash
make inspect            # the ring, an LWE sample, an RLWE sample, and the two product rules
make inspect SECRET=1   # the same, with the secret shown
make test               # public tests
make reset              # restore starter/
```

You edit one file, `local/starter/lattice.py`.

`make inspect` withholds the secret by default. Read the trace once without it and work out
which quantities the phase actually depends on. This is a toy and the secret is short enough
to search, so that is a reading discipline, not a boundary.

## Scoring

Eight checkpoints, scored independently. Wrong answers cost 10 points each.

| Checkpoint | Points | What is checked |
|---|---:|---|
| `normalize` | 25 | Any-length, negative-coefficient sequences; the fold at N, 2N and 3N |
| `ring` | 25 | Addition, subtraction, the negacyclic product; `X^(N-1)·X = -1`; distributivity |
| `lwe` | 25 | The ciphertext, the phase, the round trip, and both edges of the noise budget |
| `rlwe` | 25 | The same in the ring, with all N messages returning |
| `correspondence` | 25 | `<v, s>` equals coefficient k of the product, for every secret |
| `boundary` | 25 | Survival decided by the worst coefficient; the first failing sample; the empty run |
| `transfer` | 25 | All of the above under a ring, dimension and secret derived from a seed you have not seen |
| `validate` | 25 | Thirteen malformed ciphertexts rejected, four well-formed ones kept |

Hints on four of the eight, each inside that checkpoint's 50% cap.

## A note on equivalent mutants

Two candidate mutations were **dropped rather than left to survive**, both verified rather
than argued:

- Reducing the fold index in `phase_coefficient_terms` — `-mask[(k + N - j) % N]` instead of
  `-mask[k + N - j]` — cannot change any output. That branch only runs when `j > k`, and then
  `k + N - j` already lies in `[k+1, N-1]`. The modulo is a no-op on every reachable input.
- Dropping the outer `% q` from the same expression is likewise unobservable on the
  non-negated branch, because the mask is normalized on the line above. What is observable is
  the sign, and that is what gets mutated instead.

Leaving an unkillable mutant in the list teaches that a `SURVIVED` line can be ignored. So
neither is left in.

## This is not secure, and the problem will not pretend otherwise

`q` is small enough to enumerate by hand and the secret is short enough to search by brute
force, which is the only reason every intermediate value in `make inspect` can be printed at
all. A real parameter set hides the secret behind a lattice problem; this one hides it behind
nothing. Toy correctness and production security are separate claims and this problem makes
only the first.

## Source alignment

Week 5's material is published upstream, so `courseAlignment` pins `week5/README.md` as
`lecture` and `week5/problems/tfhe-toy-python/README.md` as `assignment`, both at the track's
recorded commit. `spoilerPolicy` is `independent-reimplementation`: the API names and the
parameter generation here were chosen independently and the whole model is stated above, so
nothing is copied from the official exercise's function names, fixtures, or its `solution.py`,
and reading this gives no shortcut through it.

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

`make reference-test` runs the mutation suite: twenty-four broken implementations, plus two
checks that the verifier grades in both directions. Most of the twenty-four round-trip an LWE
ciphertext correctly, which is the property a learner checks first and the reason it is not
enough.
