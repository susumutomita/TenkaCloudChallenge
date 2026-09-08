# How far can it be pushed

> This track is an independent, unofficial companion to the Advanced Cryptography Program 2026.
> It is not affiliated with or endorsed by the course or its operators. All problem statements,
> code, fixtures, and figures here are written independently. Questions about this track go to
> the TenkaCloud repository, not to the course operators.

**Track:** `advanced-cryptography-2026` · **Order:** 510 · **Chapter:** Week 5 / Encoding
and Noise · **Role:** `mechanism` · **Time:** 45–60 minutes · **Points:** 200 ·
**Status:** draft

## The story

This public encoding model places messages on spaced positions and studies how far
a position can shift before decoding changes. There is no secret key: anyone can
decode. The model studies correctness, not secrecy or real encryption noise growth.

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
| **the tie** | A value exactly halfway between two points rounds **up**. Even delta has an integer tie and an asymmetric interval; odd delta has no integer tie and a symmetric interval. |
| **negative noise** | `e` can be negative. Python's `%` already returns a non-negative result for a positive modulus, so this needs no special case — `abs(e)` is a different function. |
| **the wrap** | The point past the last message is message 0, not message p. Only two of the p messages notice. |

## Predict, then measure

`success_interval` is scored against the parameters, not against your own decoder. That is
deliberate: an interval *measured* by trying every noise value agrees with whatever the
decoder does, so a wrong decoder and a wrong interval pass together. The hidden tests
compute both from the fixtures and check your decoder against the interval and the
interval against your decoder separately.

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

All seven checkpoints have three 2-point hints each, within each checkpoint's 50% cap.

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

Local mode is **self-paced, honor-system verification**. Someone who owns the Docker daemon and
every container in the compose stack cannot be prevented from inspecting hidden material. The
boundary here is misdelivery, not confidentiality against that person: the Workbench container
you build and run carries the starter and the public tests only — no fixtures, no hidden tests,
no reference solution, no verifier. Those live only in a second, unpublished container the
Workbench reaches over the compose network, and in the author-only image `make reference-test`
builds.

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

`make reference-test` runs the mutation suite: seventeen broken implementations. Most
decode every exact encoding point correctly, which is the property a learner checks first
and the reason it is not enough.


All seven checkpoints now have three 2-point hints (42 points total). The free statement supplies integer rounding, centered positions, the zero-containing safe interval, first-failure construction and exact parameter validity rules. Public encoding is distinguished from encryption; this does not model real noise growth or security. An independent participant-only reader caught missing validation bounds, ambiguous wraparound and incorrect secrecy/interval claims; the rewrite addresses those findings. Hint availability and deductions change (maximum total 53 to 42 points). The verifier now also rejects boolean, float and missing-key parameters as the free contract requires. Catalog validation and copy review are author checks, not a browser playtest. The author mutation suite passes its reference and rejects all 20 mutants, including permissive boolean, float and missing-key validators.


The closing transfer checkpoint now also requires counterexample(params, bug) to construct inputs separating correct decoding from floor, no-wrap and abs-noise implementations. All formulas and input bounds are free; participants choose the separating cases. The verifier computes both results independently. Public feedback checks the current parameter set. The author suite rejects all 23 mutants, including non-separating and bug-ignoring witnesses.


Independent reading found a no-witness case for two messages and odd spacing. The contract now permits None and the grader tests both existence and nonexistence; always returning None fails.

## Parent-owned grading (Issue #837, 2026-09-08)

The checker, fixture generation and final verdict run in the trusted verifier process. Submitted functions run in a separate Linux worker; only typed, inert return values cross back. The transport preserves tuple/list, integer dictionary keys, and bool/int distinctions. Documented input refusals retain `ValueError`, including subclasses. It reuses the existing bounded worker and seccomp isolation used by other AC26 problems.

The evaluator has a 12-second total deadline, below the existing 15-second forwarding timeout. Both services use UID 10001 and Compose `init: true`. The worker cannot open files, create network/process access, or signal the parent; missing Linux isolation fails closed. This is defense inside the local evaluator, not confidentiality against a person controlling Docker or a production-security certification. Public APIs, scoring, fixtures and legal arithmetic alternatives are unchanged.

Author verification: `make reference-test` accepts the reference and rejects all 23 existing arithmetic mutants. `make boundary-test` adds 7 Linux test methods, including all 7 reference checkpoint routes, missing functions/early termination, typed values, timeout, filesystem/process isolation and non-root execution. The actual Workbench HTTP path (`config` → `inspect` → `starter` → `test` → `prepare` → `verify`) passed 4 reference public examples and all 7 checkpoint submissions; early termination was rejected at every checkpoint. These are author regression checks, not an independent participant playtest or a live Portal scoring-persistence test.

`make test` was attempted on this host but could not allocate Docker's exhausted default address pool. A temporary, task-owned Compose override supplied non-overlapping private subnets for the Workbench checks; no repository network settings or unrelated networks were changed. Real AWS, live Portal score history and cross-team behavior were not exercised. No deployment was performed.

A separate first-step check implemented only `encode` from the free formula and earned that checkpoint with all later functions still unfinished.

### Supported computation imports / 計算用の標準ライブラリ

Supported computation imports / 計算用に使える標準ライブラリ:
array, base64, binascii, bisect, collections, contextlib, copy, dataclasses, decimal, enum, fractions, functools, hashlib, heapq, hmac, itertools, json, math, operator, random, re, statistics, string, struct, time, typing.
This list covers optional standard-library helpers. Imports already supplied by the starter (including __future__ and problem APIs) are also supported. Other optional imports and file/network access are not supported in grading.
この一覧は追加できる標準ライブラリです。スターターに最初からあるimport（__future__や教材のAPIなど）も、そのまま使えます。それ以外の追加importとファイル・通信操作には採点時は対応しません。
