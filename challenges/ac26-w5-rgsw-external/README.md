# Multiply by a bit nobody can read

> This track is an independent, unofficial companion to the Advanced Cryptography Program 2026.
> It is not affiliated with or endorsed by the course or its operators. All problem statements,
> code, fixtures, and figures here are written independently. Questions about this track go to
> the TenkaCloud repository, not to the course operators.

**Track:** `advanced-cryptography-2026` · **Order:** 530 · **Chapter:** Week 5 / RGSW and the
External Product · **Role:** `mechanism` · **Time:** 75–105 minutes · **Points:** 300 ·
**Required first:** `ac26-w5-lwe-rlwe` · **Status:** draft

## The story

You have an RLWE ciphertext carrying a message, and an **encrypted** bit. Multiply them:
selector 0 turns the ciphertext into an encryption of zero, selector 1 leaves the message
alone. The arithmetic is identical either way, so nothing about the result says which
happened — that is the whole trick, and it is what makes encrypted branching possible.

You are not rebuilding the ring or RLWE. `participant.ring` supplies `ring_mul`,
`rlwe_encrypt` and the rest, correct; `ac26-w5-lwe-rlwe` is where they come from. This
problem is the gadget and the product.

## The convention, fixed

```text
q = base ** levels           unsigned, LSB-first, exactly `levels` digits
gadget = (1, B, B^2, ..., B^(L-1))
recompose(decompose(x)) == x        for every x in [0, q)
```

`q = base ** levels` is what makes that exact. It is a choice, and the `failure` checkpoint
is where you find out what it was buying — real implementations use an approximate gadget
and live with the error.

## RGSW has 2L rows, and the split is the point

`RGSW(mu) = Z + mu * G`, with `Z` being 2L RLWE encryptions of zero and `G` the gadget
matrix:

| rows | gadget term goes in |
|---|---|
| `0 .. L-1` | the **a** slot |
| `L .. 2L-1` | the **b** slot |

The external product decomposes **both** halves of the ciphertext, concatenates them into
one digit vector of length 2L, and multiplies it into that matrix:

```text
d = decompose(a) ++ decompose(b)
d . (Z + mu*G) = d.Z + mu*(d.G) = RLWE(0) + mu*(a, b)
```

`d . G` reassembles `(a, b)` exactly — that is why the rows are split across the two slots.
Put every gadget term in one slot and the product decrypts to something that looks almost
right.

## No secret, deliberately

`external_product` is not given the secret. It cannot decrypt the selector, and it must not
need to. If you find yourself wanting to know which bit it is, the design is telling you
something.

## Why your own round trip cannot catch this

Reverse the digit order **and** the gadget vector and every round trip still passes. Build
the RGSW rows with the layout backwards and multiply them with a product that is backwards
the same way, and selector 1 still returns the message.

So the hidden tests check the gadget vector **directly**, and every RGSW check is
**crossed**: rows built by the fixtures go through your product, and your rows go through
the fixtures'. A construction that is only self-consistent does not survive that.

## Participant Portal workflow

1. Start the problem in Participant Portal; the problem editor appears on the same page.
2. Select **Inspect evidence** to read this deployment's fixture and published evidence.
3. Edit the starter source in the Portal editor.
4. Select **Run public tests** and fill any direct-answer fields from the evidence.
5. Submit each checkpoint directly. Portal prepares and sends the current files and answers.

No checkout, terminal, local editor, second screen, or copy-and-paste step is required. Code
checkpoints use the current editor source. Direct answers are bound to the current deployment
seed, so a value copied from another deployment is rejected.

## Scoring

Eight checkpoints, scored independently. Wrong answers cost 15 points each.

| Checkpoint | Points | What is checked |
|---|---:|---|
| `decompose` | 35 | Exactly L digits in `[0, base)`, LSB-first, zero to all-zero, reduction before decomposing |
| `gadget` | 30 | The vector itself, ascending — not inferred from a round trip |
| `polynomial` | 30 | One ring element per level, coefficient order preserved, not transposed |
| `rgsw` | 40 | 2L rows, the right slot per half, selector rejected unless it is a bit, nothing else in the structure |
| `external` | 50 | Selector 0 → zero, selector 1 → the message, crossed both ways, and not the input handed back |
| `trace` | 35 | One record per row, ending at the product it describes |
| `failure` | 40 | Levels needed, and the smallest value that stops round-tripping |
| `transfer` | 40 | All of it under a base, level count, degree and modulus you have not seen |

Hints on five of the eight, each inside that checkpoint's 50% cap.

## A note on equivalent mutants

Two candidate mutations were **dropped rather than left to survive**, both verified
exhaustively rather than argued. Both are artifacts of `q = base ** levels`:

- removing `value % modulus` from `decompose` changes nothing — taking exactly `levels`
  base-B digits **is** reduction modulo `base ** levels`, for every value including
  negatives;
- removing `% modulus` from `recompose` changes nothing either — `levels` digits each below
  `base`, weighted by the gadget, sum to at most `q - 1`.

Both lines stay in the reference. They say what is meant, and they would be load-bearing
under an approximate gadget. They are simply not detectable here, and an unkillable entry
in the list would teach that a `SURVIVED` line can be ignored.

The float-logarithm mutation nearly joined them: `int(ceil(log(m, b)))` agrees with counting
on every power of 2 and 4. It only separates at `(5, 125)` and `(6, 216)`, which is why both
are now in the test cases.

## Not in scope

No production noise analysis, no optimized decomposition or FFT, no RGSW security proof, no
bootstrapping key compression.

## This is not secure

The parameters are small enough to enumerate and the secret falls to linear algebra. A toy
of the mechanism, not of the hardness.

## Source alignment

Week 5's material is published upstream, so `courseAlignment` pins `week5/README.md` as
`lecture` and `week5/problems/tfhe-toy-python/README.md` as `assignment`. `spoilerPolicy` is
`independent-reimplementation`: the API, the parameter generation, and the write-up here are
original, and no function name, fixture, or skeleton is taken from the official exercise.

## Assurance scope

Local mode is **self-paced, honor-system verification**. You own the machine and the Docker
daemon, so nothing you build is hidden from you: `reference/` and `tests/hidden/` are not
bind-mounted, which keeps them out of your git checkout rather than out of reach.

What the deployment does do is stop handing them to you by accident. It runs two
containers. The Workbench you talk to carries the starter, the public tests,
`participant/ring.py` and `show.py`; the grading image carries `fixtures/`,
`tests/hidden/` and the verifier, publishes no port, and sits on a Docker network with no
gateway. `show.py` and the public tests read this deployment's parameters, rows and traces
from that verifier's `GET /public`, which serves the question and never a checkpoint's
expected value — `fixtures/generate.py` has to implement all ten functions
`starter/rgsw.py` asks you to write in order to derive them, so it is not in the image you
run ([#543](https://github.com/susumutomita/TenkaCloudChallenge/issues/543)).

What the verifier does guarantee is narrower and real: a submission cannot hang or crash it,
a checkpoint can only credit the id it echoes, results do not leak expected values, and the
fixtures come from this deployment's seed so a memorized answer does not carry.

That supports self-study and honest practice. It does **not** support competition ranking,
examination, or completion certification — those need a verifier the participant does not
administer, tracked in [#271](https://github.com/susumutomita/TenkaCloudChallenge/issues/271).

## Cost

Zero. No cloud account, no AWS resources.

## For authors

`make reference-test` runs the mutation suite: eighteen broken implementations. Most are
self-consistent and only separate from the reference once something built by the fixtures
has to agree with something built by the submission.
