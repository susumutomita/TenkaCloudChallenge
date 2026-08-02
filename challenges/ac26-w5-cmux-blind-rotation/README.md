# Turn it by an angle nobody knows

> This track is an independent, unofficial companion to the Advanced Cryptography Program 2026.
> It is not affiliated with or endorsed by the course or its operators. All problem statements,
> code, fixtures, and figures here are written independently. Questions about this track go to
> the TenkaCloud repository, not to the course operators.

**Track:** `advanced-cryptography-2026` · **Order:** 540 · **Chapter:** Week 5 / CMUX and
Blind Rotation · **Role:** `mechanism` · **Time:** 75–105 minutes · **Points:** 300 ·
**Required first:** `ac26-w5-rgsw-external` · **Status:** draft

## The story

Pick one of two ciphertexts with an **encrypted** bit. Then repeat that until you have
rotated a polynomial by an amount nobody in the computation knows — not the code, not the
key, not the trace it prints.

You are not rebuilding the ring, RLWE, RGSW or the external product. `fixtures.generate`
supplies all of them, correct; `ac26-w5-lwe-rlwe` and `ac26-w5-rgsw-external` are where they
come from. This problem is the selection, and what the selection accumulates into.

## CMUX is one line

```text
CMUX(c, ct0, ct1) = ct0 + ExternalProduct(c, ct1 - ct0)
```

The external product returns `RLWE(0) + mu * (ct1 - ct0)`, so the sum is `ct0` when `mu` is
0 and `ct1` when it is 1. There is no branch anywhere in that expression.

Both candidates get computed every time. That is not waste — computing only the one you
need requires knowing which one that is, and you do not.

## The conventions, fixed

```text
plaintext_modulus = 4        delta = q // 4
X^(2N) = 1                   exponents normalize modulo 2N, not N
X^N   = -1                   one wrap flips the sign, two restore it
phase = (body - sum(mask[i] * secret[i])) mod 2N
```

**Four, not two.** Negacyclic rotation negates a coefficient every time it wraps past
degree N, and modulo 2 that flip is invisible — `-delta == delta (mod q)`. An implementation
that ignored `X^N = -1` completely would score full marks. Modulo 4 the flip lands in the
plaintext as `m -> (-m) mod 4`.

**2N, not N.** `X^(2N) = 1`, so that is the exponent's modulus. Reduce modulo N instead and
what you drop is the parity of how many times a coefficient wrapped — the sign. The whole
difference between this and a circular shift lives there.

## Blind rotation

An LWE sample is `(mask, body)` over `Z_(2N)`, already in the exponent's modulus, and
`blind_rotate` has to land on `X^(-phase) * accumulator` while being handed no secret at
all. `body` is **public**; only the bits are not, and they arrive as `key[i] = RGSW(bit_i)`.

Which means the opening offset rotation needs no CMUX, and each mask coefficient gets
applied conditionally through the matching key row. Work out the shape before writing the
loop — it is what makes the whole thing possible.

## Why your own tests cannot catch this

Reverse the rotation direction in `monomial_rotate` **and** in the loop, and a test that
compares the loop against your own `conditional_rotate` still passes. The last public test
is exactly that test, and it proves nothing.

So the hidden tests compare against a model that computes the rotation in the clear from the
phase and calls none of your functions.

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

Eight checkpoints, scored independently. Wrong answers cost 15 points each.

| Checkpoint | Points | What is checked |
|---|---:|---|
| `combine` | 25 | Both halves added and subtracted, the difference the right way round, short coefficient lists padded |
| `cmux` | 45 | Selector 0 → ct0's message, 1 → ct1's, and re-encrypting the selector does not move the result |
| `constant` | 35 | Both candidates computed, every key row read, output equal to neither input, no decryption helper touched |
| `rotate` | 40 | Signed wraparound, exponent modulo 2N, rotation by 0 and 2N the identity, by N a negation, composition additive, both ciphertext halves |
| `conditional` | 35 | An encrypted 1 turns, an encrypted 0 holds, candidates not swapped |
| `blind` | 55 | Matches a plaintext model built without your code, a different key lands elsewhere, an unreduced sample normalizes |
| `trace` | 35 | One record per step plus the offset, ending at the rotation it describes, public fields independent of the secret |
| `transfer` | 30 | All of it under a degree, dimension, base and modulus you have not seen |

Hints on seven of the eight, each inside that checkpoint's 50% cap.

## What the `constant` checkpoint does and does not claim

It is an audit, not a proof. It cannot show your code is constant-time and it does not try.
What it does show is that the selection happened arithmetically: both candidates were
computed, the whole selector ciphertext was consumed, the output is a ciphertext neither
input could have supplied, and no decryption helper was reached for along the way. Those are
the observable differences between arithmetic selection and an `if`.

## The degenerate case, which is not a bug

When a mask coefficient is zero the two candidates are the **same** ciphertext. The
difference is zero, its digits are zero, the external product is exactly the zero
ciphertext, and the output matches the candidate bit for bit. That is not a plaintext branch
— there was nothing to branch on. Mask coefficients are drawn from `Z_(2N)`, so this happens
one time in 2N, not rarely, and both the trace check and the mutation suite account for it.

Two candidate mutations were **dropped rather than left to survive** for exactly this
reason: returning `ct0` when the difference is the zero ciphertext, and skipping a step whose
mask coefficient is zero, are both what the reference already does. An unkillable entry in
the list would teach that a `SURVIVED` line can be ignored.

## Not in scope

Sample extraction and key switching (that is the next problem), programmable bootstrapping
and HomNAND (the one after), modulus switching, constant-time guarantees, optimized blind
rotation.

## This is not secure

The parameters are small enough to enumerate and the secret falls to linear algebra. A toy
of the mechanism, not of the hardness.

## Source alignment

Week 5's material is published upstream, so `courseAlignment` pins `week5/README.md` as
`lecture` and `week5/problems/tfhe-toy-python/README.md` as `assignment`. `spoilerPolicy` is
`independent-reimplementation`: the API, the parameter generation, and the write-up here are
original, and no function name, fixture, or skeleton is taken from the official exercise.

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

`make reference-test` runs the mutation suite: twenty-four broken implementations. Several
of them are wrong in both `monomial_rotate` and the loop at once, and only separate from the
reference at the plaintext model.
