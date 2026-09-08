# Look up a function on a ciphertext, and return to the input key

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
ciphertext it does not match — so correct decryption under the intended key is not guaranteed.

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
| `lut` | 30 | All four unary functions, the upper half's negation, a trivial ciphertext with no mask and no noise |
| `domain` | 25 | Scaled to `Z_2N`, rounded rather than truncated, every component in range, the rounding budget reported |
| `rotate` | 40 | Coefficient 0 decodes to `f(m)` for every function and message, by the documented loop |
| `relabel` | 50 | Extraction and the key switch: coefficient 0, the phase preserved exactly, the ring key at dimension `degree`, then back to the input's own key, mismatched keys refused |
| `evaluate` | 40 | Every unary function plus a hidden one, the output bootstrapped again, fresh randomness |
| `refresh` | 30 | Six trace rows matched by digest, the post-rotation bounds unmoved when the input's noise changes, the contract's edge |
| `nand` | 60 | The offset present, the sign positive exactly when NAND is 1, mixed keys refused, all four truth-table rows at every parameter set, and over two already-bootstrapped bits |
| `transfer` | 25 | All of it under parameters, keys, tables and inputs you have not seen |

All eight checkpoints have three hints, each costing2 points (48 total).
The pipeline has **ten** stages and the hidden tests grade all ten separately, each with its
own failure messages. The multi-verify contract caps a problem at eight scored checkpoints —
in `SCHEMA.json` and again in the platform's `problem-sdk`, which drops the whole scoring
object rather than truncating a ninth — so the two most closely coupled pairs share a
checkpoint. `relabel` is extraction and the key switch, `nand` is the combination and the
gate; each pair is one idea, and grading them apart would have suggested otherwise.

## Refresh has an input contract

The output bound is R+K, with no input-noise term. Input noise still affects the selected position. Reuse requires matching domains and a sufficient input budget; it is not unconditional.

## The gate is not in the lookup table

HomNAND's lookup table is the identity. All four input pairs use the same table; what
separates the rows is the sign of the phase the pre-processing produced. The bootstrap only
turns that sign into a fresh ciphertext, and the gate lives in `(0, q/8) - c1 - c2`.

Drop that `q/8` and `(0,1)` and `(1,0)` have a phase of exactly zero, where the answer is
settled by whichever way the noise fell. Measured over 40 seeds, 12 of the 80 attempts at
those two rows came out wrong — and `(0,0)` and `(1,1)` never did. A missing constant that
fails one row in seven reads as flakiness rather than as a bug, which is worse than failing
outright.

## Outside the correctness contract

Correctness is no longer guaranteed outside the bound. This does not imply that every such input returns the other bit.

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

These teaching parameters do not establish practical security. A toy
of the mechanism, not of the hardness.

## Source alignment

Week 5's material is published upstream, so `courseAlignment` pins `week5/README.md` as
`lecture` and `week5/problems/tfhe-toy-python/README.md` as `assignment`. The declared role
is `synthesis` — the schema takes one role, and this problem's defining property is that it
integrates the whole week rather than isolating one mechanism. `spoilerPolicy` is
`independent-reimplementation`: the API, the parameter generation, and the write-up here are
original, and no function name, fixture, or skeleton is taken from the official exercise.

## Assurance scope

Local mode is **self-paced, honor-system verification**. You own the machine and the Docker
daemon, so nothing you build is hidden from you: `reference/` and `tests/hidden/` are not
bind-mounted, which keeps them out of your git checkout rather than out of reach.

What the deployment does do is stop handing them to you by accident. It runs two
containers. The Workbench you talk to carries the starter, the public tests,
`participant/fhe.py` — the supplied Week 5 stack — and `show.py`; the grading image carries
`fixtures/`, `tests/hidden/` and the verifier, publishes no port, and sits on a Docker
network with no gateway. `show.py` reads this deployment's parameters, trace rows and noise
contract from that verifier's `GET /public`, which serves the demonstration and never a
checkpoint's expected value — `fixtures/generate.py` has to implement `lookup_accumulator`,
`to_rotation_domain`, `blind_rotate`, `output_noise_bound`, `correctness_bound`,
`refresh_report` and `nand_combine` in order to derive them, and those are seven of the
names `starter/pipeline.py` asks you to write, so it is not in the image you run
([#543](https://github.com/susumutomita/TenkaCloudChallenge/issues/543)).

The verifier bounds submitted-code runtime and output, checks results in its parent process,
and echoes the checkpoint being graded. Failure feedback excludes expected values. Fixtures
come from the deployment seed. These controls do not establish general denial-of-service
resistance or confidentiality against the Docker administrator.

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

## Issue #716 revision

Free instructions and the editor include definitions, formulas, API signatures, a stage-label table, a LUT-position diagram and error-budget reasoning. An independent participant-only reader identified and rechecked missing mathematical connections. Required formulas are not paid hints. Integer rounding bounds now use the ceiling; a Fraction-based author regression demonstrates an attainable error greater than the former bound. Browser submission and deployed score reflection have not been exercised.

Transfer also requires a constructed counterexample to a floored rounding bound, or None when odd dimension makes that impossible. Separate regression checks reject omitted evidence, an ineffective mask and a zero test key.

Validation passed: all 37 historical mutants, three invalid constructed witnesses, the fractional rounding regression and missing target-dimension guard; catalog 116 valid. Compatibility checks also reject mismatched modulus, base and levels with ValueError. Transfer now includes the independent construction check in addition to the ten pipeline-stage checks.

## Parent-owned grading (Issue #837, 2026-09-08)

The checker, fixture generation and final verdict run in the trusted verifier process. Submitted functions run in a separate Linux worker; only typed, inert return values cross back. The transport preserves tuple/list, integer dictionary keys, and bool/int distinctions. Documented input refusals retain `ValueError`, including subclasses. It reuses the existing bounded worker and seccomp isolation used by other AC26 problems.

The evaluator has a 12-second total deadline, below the existing 15-second forwarding timeout. Both services use UID 10001 and Compose `init: true`. The worker cannot open files, create network/process access, or signal the parent; missing Linux isolation fails closed. This is defense inside the local evaluator, not confidentiality against a person controlling Docker or a production-security certification. Public APIs, scoring, fixtures and legal arithmetic alternatives are unchanged.

Author verification: `make reference-test` accepts the reference and rejects all 37 existing arithmetic mutants. `make boundary-test` adds 7 Linux test methods, including all 8 reference checkpoint routes, missing functions/early termination, typed values, timeout, filesystem/process isolation and non-root execution. The actual Workbench HTTP path (`config` → `inspect` → `starter` → `test` → `prepare` → `verify`) passed 5 reference public examples and all 8 checkpoint submissions; early termination was rejected at every checkpoint. These are author regression checks, not an independent participant playtest or a live Portal scoring-persistence test.

`make test` was attempted on this host but could not allocate Docker's exhausted default address pool. A temporary, task-owned Compose override supplied non-overlapping private subnets for the Workbench checks; no repository network settings or unrelated networks were changed. Real AWS, live Portal score history and cross-team behavior were not exercised. No deployment was performed.

### Supported computation imports / 計算用の標準ライブラリ

Supported computation imports / 計算用に使える標準ライブラリ:
array, base64, binascii, bisect, collections, contextlib, copy, dataclasses, decimal, enum, fractions, functools, hashlib, heapq, hmac, itertools, json, math, operator, random, re, statistics, string, struct, time, typing.
Other imports and file/network access are not supported in grading.
採点時は、この一覧以外のimportとファイル・通信操作には対応しません。
