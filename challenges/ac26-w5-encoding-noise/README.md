# How far can it be pushed

> This track is an independent, unofficial companion to the Advanced Cryptography Program 2026.
> It is not affiliated with or endorsed by the course or its operators. All problem statements,
> code, fixtures, and figures here are written independently. Questions about this track go to
> the TenkaCloud repository, not to the course operators.

**Track:** `advanced-cryptography-2026` · **Order:** 510 · **Chapter:** Week 5 / Encoding
and Noise · **Role:** `mechanism` · **Time:** 45–60 minutes · **Points:** 200 ·
**Status:** draft

## The story

A homomorphic ciphertext hides a message by putting it somewhere on a ring and then
pushing it off that spot. Decryption is "which spot was this nearest to". Every question
about correctness reduces to how far it can be pushed before the answer changes — and that
distance is a number you can compute before running anything.

Nothing is hidden from you. The whole model is four lines:

```text
message      m   in [0, p)
scaling      D   spreads p messages across the ring
ring         q = p * D
encode       encode(m) = (m * D) mod q
decode       the message whose encoding point c is nearest to, ties rounding up
```

`p`, `D`, and `q` come from `params` and change between checkpoints. Anything hardcoded is
wrong somewhere.

## The three things that are actually hard

| | Why it bites |
|---|---|
| **the tie** | A value exactly halfway between two points rounds **up**. Once that is decided, the tolerated noise interval is no longer symmetric — one end loses a point, and `delta` being even or odd decides whether there is a halfway point at all. |
| **negative noise** | `e` can be negative. Python's `%` already returns a non-negative result for a positive modulus, so this needs no special case — `abs(e)` is a different function. |
| **the wrap** | The point past the last message is message 0, not message p. Only two of the p messages notice. |

## Predict, then measure

`success_interval` is scored against the parameters, not against your own decoder. That is
deliberate: an interval *measured* by trying every noise value agrees with whatever the
decoder does, so a wrong decoder and a wrong interval pass together. The hidden tests
compute both from the fixtures and check your decoder against the interval and the
interval against your decoder separately.

## How to play

```bash
make inspect            # the ring, every encoding point, and one message walked off its edge
make test               # public tests
make reset              # restore starter/encoding.py
```

You edit one file, `local/starter/encoding.py`.

## Scoring

Seven checkpoints, scored independently. Wrong answers cost 10 points each.

| Checkpoint | Points | What is checked |
|---|---:|---|
| `encode` | 25 | Points distinct and in `[0, q)`, messages outside the space normalized |
| `noise` | 30 | Centered representative and its round trip; negative and oversized noise |
| `decode` | 30 | Every ring value, `decode(encode(m)) = m`, invariance under `+q`, the tie |
| `interval` | 30 | The interval predicted from the parameters, both parities of `delta` |
| `first-failure` | 30 | The first failing noise in each direction, and what it decodes to |
| `transfer` | 25 | All of the above under parameters derived from a seed you have not seen |
| `validate` | 30 | Five unusable parameter sets rejected, three usable ones — including `delta = 1` — kept |

Hints on four of the seven, each inside that checkpoint's 50% cap.

## A note on equivalent mutants

Two candidate mutations were **dropped rather than left to survive**, both verified
exhaustively rather than argued:

- `validate_params`' `delta >= 1` rule cannot be broken detectably. `q = p * delta` with
  `q >= 1` and `p >= 2` already forces it, so relaxing the bound changes no verdict on any
  input. It stays in the reference as a better error message, not as a load-bearing rule.
- `encode`'s `m % p` cannot be broken detectably either: `(m % p) * D` and `m * D` are
  congruent modulo `p * D` for every integer `m`. The reduction says what is meant; the
  outer `% q` is what does work, and **that** is mutated.

Leaving an unkillable mutant in the list teaches that a `SURVIVED` line can be ignored. So
neither is left in.

## This is not secure, and the problem will not pretend otherwise

`p` and `q` are small enough to enumerate by hand, which is the only reason the boundary is
visible at all. A real parameter set hides the message behind a lattice problem; this one
hides it behind nothing. Toy correctness and production security are separate claims and
this problem makes only the first.

Likewise, noise is not padding and it is not free. It is what the security rests on and
what the correctness spends. Every unit added buys hardness and costs headroom, and the
interval you compute here is the budget the rest of Week 5 spends.

## Source alignment

Week 5's material is published upstream, so `courseAlignment` pins `week5/README.md` as
`lecture` and `week5/problems/tfhe-toy-python/README.md` as `assignment`, both at the
track's recorded commit. `spoilerPolicy` is `independent-reimplementation`: the parameters
here are generated from the seed and the encoding rule is stated in full above, so nothing
is copied from the official exercise's fixtures or its `solution.py`, and reading this
gives no shortcut through it.

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

`make reference-test` runs the mutation suite: seventeen broken implementations. Most
decode every exact encoding point correctly, which is the property a learner checks first
and the reason it is not enough.
