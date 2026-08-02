# Look up a function on a ciphertext, and hand back a fresh key

> This track is an independent, unofficial companion to the Advanced Cryptography Program 2026.
> It is not affiliated with or endorsed by the course or its operators. All problem statements,
> code, fixtures, and figures here are written independently. Questions about this track go to
> the TenkaCloud repository, not to the course operators.

**Track:** `advanced-cryptography-2026` · **Order:** 560 · **Chapter:** Week 5 / Programmable
Bootstrapping and HomNAND · **Role:** `synthesis` · **Time:** 105–150 minutes ·
**Points:** 300 · **Required first:** all five Week 5 problems · **Status:** draft

## The story

Week 5's five problems each built one piece. All five are supplied here, correct and
finished: the ring and the encoding, LWE and RLWE, the gadget and the external product, CMUX
and monomial rotation, sample extraction and key switching. You rebuild none of them.

What is missing is the thing they were pieces of.

```text
LWE(dimension n, key s_lwe)
  -> rotation domain      scale by 2N/q and round
  -> LUT accumulator      a trivial RLWE ciphertext: no mask, no noise, no message
  -> blind rotation       X^(-phase), and the phase is never computed
  -> RLWE(ring key)
  -> sample extraction    coefficient 0, at dimension N under the ring key
  -> key switching        back to dimension n under s_lwe
  -> LWE(dimension n, key s_lwe)
```

The output key is the **input** key. That is what makes this bootstrapping rather than a
one-way evaluation, and it is checked: the hidden tests bootstrap the output of a bootstrap.

## The encoding changed, and that is the point

```text
encode(1) =  q/8        encode(0) = -q/8        decode(c) = centered(c) > 0
```

Balanced, not `m * delta`. Under it, decoding **is** a sign test — and a sign test is what
negacyclic rotation computes for free, because `X^N = -1` negates whatever wraps past the
degree. The earlier problems' encoding cannot express that. If you have ever wondered why
PBS cannot just evaluate any function you like, this is the concrete answer.

The lookup table's upper half holds `1 - f(0)`, not `f(0)`: the wrap hands coefficient 0 its
value negated, and under a balanced encoding `-encode(x)` is `encode(1 - x)`.

## Every stage stamps where its numbers live

```text
kind             "lwe" or "rlwe"
keyId            which secret it is a ciphertext under
dimension        how many mask coefficients that secret has
modulus          which ring of integers the numbers are in
parameterSetId   which parameter set they belong to
noiseBound       what the stage can have added, as a bound
```

Two of those change mid-pipeline. Extraction moves the ciphertext to the **ring** secret at
dimension `degree`; the key switch moves it back. A stage that returns the right numbers
under the wrong label has produced something the next stage will silently combine with a
ciphertext it does not match — and the result decrypts to noise under both keys.

## A correct truth table proves less than it looks

This problem ships 37 deliberately broken implementations. **21 of them produce a perfect
truth table** — every unary function, both messages, all four NAND rows, at every parameter
set — and every one of the 21 is still a broken pipeline. `make reference-test` measures
that count on every run and fails if it moves, because this file quotes it.

That is the measured reason this problem grades every stage where it sits rather than
checking the pipeline end to end. The 21 split
three ways:

- **Right numbers, wrong label.** Extraction that keeps the input's `keyId`, or reports the
  input's dimension instead of the ring's, or calls its output an RLWE ciphertext. The
  pipeline works end to end because the switching key happens to be the matching one, and it
  breaks the moment anything in a circuit reads that label to decide what may be combined
  with what.
- **Right answer, wrong account of it.** A trace whose noise bounds are all zero; an
  accumulator row claiming to carry the message; an output bound that grows with the input's.
  The pipeline is fine and the story it tells about itself is false — and the story is the
  part you were supposed to learn.
- **Right answer by luck.** Extracting coefficient 1 instead of 0 works because the lookup
  table is constant across each half of the ring. Truncating instead of rounding works
  because the correctness budget absorbs it at these parameters. Neither is a property you
  would want to rely on, and neither is visible from the final bit.

A twenty-second is blind on most seeds and caught on the one the mutation suite fixes: the
dropped `q/8` offset in `nand_combine`. Whether a truth table catches it depends on which
way the noise fell, which is the worst kind of defect and is described further down.

The trace is matched by artifact digest for the same reason: a digest cannot be filled in
from the final answer.

## Browser workflow

1. Start the problem in Participant Portal and open **Browser Workbench**.
2. Run `inspect` to read this deployment's fixture and published evidence.
3. Edit the starter source in the in-browser editor.
4. Run `test` for the published checks and fill any direct-answer fields from the evidence.
5. Run `prepare`, then paste every prepared checkpoint value into Participant Portal.

No checkout, terminal, or local editor is required. Code checkpoints submit the edited source.
Direct answers are wrapped by `prepare` and bound to the current deployment seed, so a value copied
from another deployment is rejected.

## How to play

```bash
Workbench `inspect`                     # the identity table on m = 1 — the least informative run
Workbench `inspect` F=always-one        # identity, negate, always-zero, always-one
Workbench `inspect` F=always-one M=0    # the other message, where the wrap fires
Browser Workbench `test`                    # public tests
reload the starter                   # restore starter/pipeline.py
```

You edit one file, the Workbench editor (`pipeline.py`).

## Scoring

Eight checkpoints, scored independently. Wrong answers cost 15 points each.

| Checkpoint | Points | What is checked |
|---|---:|---|
| `lut` | 30 | All four unary functions, the upper half's negation, a trivial ciphertext with no mask and no noise |
| `domain` | 25 | Scaled to `Z_2N`, rounded rather than truncated, every component in range, the rounding budget reported |
| `rotate` | 40 | Coefficient 0 decodes to `f(m)` for every function and message, by the documented loop |
| `relabel` | 50 | Extraction and the key switch: coefficient 0, the phase preserved exactly, the ring key at dimension `degree`, then back to the input's own key, mismatched keys refused |
| `evaluate` | 40 | Every unary function plus a hidden one, the output bootstrapped again, fresh randomness |
| `refresh` | 30 | Six trace rows matched by digest, the post-rotation bounds unmoved when the input's noise changes, the contract's edge |
| `nand` | 60 | The offset present, the sign positive exactly when NAND is 1, mixed keys refused, all four truth-table rows at every parameter set, and over two already-bootstrapped bits |
| `transfer` | 25 | All of it under parameters, keys, tables and inputs you have not seen |

Hints on seven of the eight, each inside that checkpoint's 50% cap.
The pipeline has **ten** stages and the hidden tests grade all ten separately, each with its
own failure messages. The multi-verify contract caps a problem at eight scored checkpoints —
in `SCHEMA.json` and again in the platform's `problem-sdk`, which drops the whole scoring
object rather than truncating a ninth — so the two most closely coupled pairs share a
checkpoint. `relabel` is extraction and the key switch, `nand` is the combination and the
gate; each pair is one idea, and grading them apart would have suggested otherwise.

## The refresh is not "the noise gets smaller"

The output's noise bound is blind rotation's contribution plus the key switch's. The input's
noise is not a term in it. It does not shrink — it stops being **depended on**. That is why
the output can be bootstrapped again, and why circuits are possible at all.

Read the trace's noise column down and you can see the row where the dependency ends.
`refresh_report` says the same thing as an equation: read `outputNoiseBound` twice with
different inputs and the number does not move.

## The gate is not in the lookup table

HomNAND's lookup table is the identity. All four input pairs use the same table; what
separates the rows is the sign of the phase the pre-processing produced. The bootstrap only
turns that sign into a fresh ciphertext, and the gate lives in `(0, q/8) - c1 - c2`.

Drop that `q/8` and `(0,1)` and `(1,0)` have a phase of exactly zero, where the answer is
settled by whichever way the noise fell. Measured over 40 seeds, 12 of the 80 attempts at
those two rows came out wrong — and `(0,0)` and `(1,1)` never did. A missing constant that
fails one row in seven reads as flakiness rather than as a bug, which is worse than failing
outright.

## What happens past the correctness bound

An input noisier than the bound does not degrade the bootstrap. It returns the **other** bit,
confidently, with a fresh small noise — a correct-looking ciphertext of the wrong answer
rather than a broken one. That is the FHE failure mode worth remembering, and
`refresh_report` is where you say whether a given input is inside the contract at all.

## A shortcut that is structurally absent

No function you write is handed a secret, at either end. Not the ring secret, not the LWE
secret. So "decrypt the input, apply `f`, re-encrypt the answer" is not an implementation
this API can express, and **two candidate mutations were dropped because they could not be
written** rather than faked: that one, and "the output plaintext is stored in the artifact's
metadata", which fails for the same reason — no stage ever learns `m` or `f(m)`.

The hidden suite still scans every returned artifact for either secret, so a future author
who threads one through finds out.

## Toy versus production

This is a toy of the mechanism. Production TFHE runs the polynomial products through FFT or
NTT, compresses the bootstrapping key, and derives its parameters from security against
lattice reduction rather than from what fits in a comment. Per-gate cost, realistic
bootstrapping-key size, and compiling arbitrary multi-gate circuits are all out of scope.

## Not in scope

Production TFHE security and performance, optimized FFT / NTT / SIMD, bootstrapping-key size
optimization, an arbitrary multi-gate circuit compiler.

## This is not secure

The parameters are small enough to enumerate and both secrets fall to linear algebra. A toy
of the mechanism, not of the hardness.

## Source alignment

Week 5's material is published upstream, so `courseAlignment` pins `week5/README.md` as
`lecture` and `week5/problems/tfhe-toy-python/README.md` as `assignment`. The declared role
is `synthesis` — the schema takes one role, and this problem's defining property is that it
integrates the whole week rather than isolating one mechanism. `spoilerPolicy` is
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

`make reference-test` runs the mutation suite: thirty-seven broken implementations, all killed.
Twenty-one of them produce a perfect truth table, which is the number this problem exists to
justify — a stage-by-stage checkpoint layout is expensive, and that figure is what pays for
it. The suite measures it on every run and fails if it moves, so the READMEs and the
metadata cannot drift away from the reference.
