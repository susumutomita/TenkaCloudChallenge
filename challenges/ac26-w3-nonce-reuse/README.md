# Recover a signing key from nonce reuse

> This track is an independent, unofficial companion to the Advanced Cryptography Program 2026.
> It is not affiliated with or endorsed by the course or its operators. All problem statements,
> code, fixtures, and figures here are written independently. Questions about this track go to
> the TenkaCloud repository, not to the course operators.

**Track:** `advanced-cryptography-2026` · **Order:** 340 · **Chapter:** Week 3 / Nonce Reuse and
Special Soundness · **Role:** `transfer` · **Time:** 60–90 minutes · **Points:** 300
· **Required first:** `ac26-w3-schnorr`

## The story

A signing service kept an audit log. Per signature: the message, the public key, the commitment
`R`, and the response `z`. No secret keys — that was rather the point of keeping a log.

Somewhere in it, one signer used the same commitment twice.

```text
z1 = k + e1*x
z2 = k + e2*x
```

Both x and k are unknown. Subtract the equations to eliminate k, then solve for x when the challenges differ.

## This is not a story about random numbers

Nonce reuse is usually told as "weak random number generators are dangerous". That is the
symptom, not the reason.

The reason is **special soundness**: two accepting transcripts sharing a commitment and differing
in the challenge yield the witness. This extraction property explains how a reused nonce can reveal `x`. It is a component
of a proof-of-knowledge argument, not by itself a security proof for the signature scheme.

## Sharing R is necessary, not sufficient

The log is noisy on purpose:

- rows that are **malformed** — a parser that trusts its input dies on the first one;
- a row that **parses cleanly and does not verify** — reuse inside a rejected transcript proves
  nothing;
- a row from a **different signer who used the same R** — different keys means the two
  transcripts are not two equations in one unknown, and attacking them yields a scalar belonging
  to nobody.

Which is why a recovery is always confirmed against `P = xG`. The arithmetic succeeds on the
wrong pair too.

And when `e1 = e2` there is no inverse, because two responses to the same challenge are one
equation written twice.

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
| `parse` | 30 | Valid rows read, malformed rows rejected explicitly |
| `detect` | 35 | Only same-signer, both-accepting pairs reported |
| `extract` | 50 | The key, and independence from transcript order |
| `confirm` | 30 | Confirmed against the public key; wrong scalars refused |
| `reject` | 40 | `e1 = e2`, a cross-signer pair, and a log with no reuse |
| `hunt` | 40 | The victim's key out of the noisy log, and whose it is |
| `collision` | 40 | The truncated generator measured, against its actual space |
| `repair` | 35 | Documented HMAC generator plus a weak-generator collision witness |

All eight checkpoints have three hints, two points per hint (48 points in total).

## Three nonce generators

| Generator | In the log it looks | Actually |
|---|---|---|
| `fixed_nonce` | obviously wrong | dies immediately |
| `truncated_nonce` | **perfectly random** | collides on the birthday schedule |
| `deterministic_nonce` | alarming | the safe one |

`truncated_nonce` is the interesting one: every `k` differs, every signature verifies, and nothing
is visibly wrong. Looking random is not having entropy.

`deterministic_nonce` has the most worrying name and is correct. The same key and message give the
same nonce — which gives the same signature, leaking nothing new — but different messages can share a nonce even when their hashes differ, because reduction modulo n−1 can merge digest values. A large output range makes this rare; it does not make it impossible. The key goes into the hash too, or two signers of the
same message would share a nonce.

## Group order, and a test that cannot be written

The repair checkpoint runs on **secp256k1**, and that is not incidental. A toy group has fewer
than fifty scalars, so sixty messages cannot possibly receive sixty distinct nonces — the
pigeonhole says so before any code exists. There is no safe nonce generator in a forty-element
group; the group being small *is* the vulnerability. A test asserting the impossible is a design
failure, not a failing test.

Truncation is likewise not caught by "are the sixty samples distinct". At sixteen bits, sixty
draws are all distinct about 97% of the time — that assertion would let it through on most runs.
The **range** rules it out: against a 256-bit order, every output landing below 2^64 has
probability around 2^-11000. That is evidence, not luck.

## Assurance scope

Local mode is **self-paced, honor-system verification**. Someone who owns the Docker daemon and
every container in the compose stack cannot be prevented from inspecting hidden material. The
boundary here is misdelivery, not confidentiality against that person: the Workbench container
you build and run carries the starter, the public tests, the supplied protocol
(`local/participant/schnorr.py` — the group, the challenge, the signing routine, and the
truncated generator the collision checkpoint asks you to measure) and the orientation printer
only. The audit-log builder, the key derivation, the repaired generator, the hidden tests, the
reference solution and the verifier are **not** in it. Those live only in a second, unpublished
container the Workbench reaches over the compose network, and in the author-only image
`make reference-test` builds.

Because of that, `make test`, `make test-one` and `make inspect` bring the verifier up first
(`make verifier-up`, run for you): `make inspect` reads this deployment's log from it over the
compose network instead of building it locally. `make verifier-down` stops it.

What the verifier does guarantee is narrower and real: a submission cannot hang or crash it,
a checkpoint can only credit the id it echoes, results do not leak expected values, and the
fixtures come from this deployment's seed so a memorized answer does not carry. Submissions run
with time, memory, process, and output caps; both containers run non-root, read-only, without
privileges, and only the Workbench is published, on loopback.

That supports self-study and honest practice. It does **not** support competition ranking,
examination, or completion certification — those need a verifier the participant does not
administer, tracked in [#271](https://github.com/susumutomita/TenkaCloudChallenge/issues/271).

## Cost

Zero. No cloud account, no AWS resources.

## For authors

`make reference-test` runs the mutation suite: 69 broken implementations. Three of them found
real holes in the hidden tests while this problem was being written — the log had no
non-accepting duplicate, no cross-signer duplicate, and the nonce-space check was distinctness
rather than range. A fourth, "reports a recovery without confirming it", turned out to be an
equivalent mutant on its own and is now mutated together with the validation it depends on.

## Three-rung hints and verification (Issue #716)

All eight checkpoints have three bilingual hints: mechanism, small example, named action. Required formulas and APIs are free. Repair grades the documented HMAC-SHA256 encoding and repair_witness(seed, group), which constructs two distinct trial-message indices colliding under the supplied weak generator. The function is called with different seeds; each returned pair is checked with that call’s seed. This is a finite regression test, not proof of collision freedom.

Author validation rejected all 69 mutants, including accepted mismatched commitments, malformed records, wrong HMAC encoding, and duplicate/noncolliding/fixed-seed witness pairs. The 36 added return-contract mutants are checked against their own parse, detect, confirm, reject, or collision checkpoint, without relying on a different checkpoint to fail. Parse compares all four fields across tuple/list/Point inputs and scalar/message boundaries. Detect checks distinct original integer indices before reading records and preserves original evidence when a submission mutates its input; valid reversed pairs and subsets remain accepted. Collision measures several sample sizes, including zero, one, and more draws than the nonce space, and requires integer counts. Twelve author checker regressions and Docker `make reference-test` passed. Catalog validation passed for 116 metadata files. Participant-only independent reading found wording and contract gaps that were corrected. Browser play and deployed scoring were not exercised.

Point subclasses remain supported; parsing compares primitive coordinates and curve parameters rather than trusting a submission-defined equality method. The new equality-spoof mutant is rejected by parse alone.


PR #815 follow-up: confirms requires bool on both accepting and rejecting calls. Collision observes execution of the supplied generator and checks seed, secret, trial order and count. A copied SHA expression is rejected even when counts agree. Pre-bound aliases, alternative aggregation and zero samples remain valid. This observes the supplied API; it is not a sandbox guarantee for arbitrary Python.

### Trusted-parent evaluation

The verifier now keeps the mathematical checker in the parent process. A restricted Linux worker returns typed function values only; its output is never a checkpoint verdict. Public object types and supplied callbacks retain their APIs. The normal `make reference-test` path first checks the deployed verifier with all eight reference submissions and harmless missing-function/syntax-error inputs, then runs the existing author tests. This is additional process isolation within the container, not a claim of general Python sandbox security.

### Supported computation imports / 計算用の標準ライブラリ

Supported computation imports / 計算用に使える標準ライブラリ:
array, base64, binascii, bisect, collections, contextlib, copy, dataclasses, decimal, enum, fractions, functools, hashlib, heapq, hmac, itertools, json, math, operator, random, re, statistics, string, struct, time, typing.
Other imports and file/network access are not supported in grading.
採点時は、この一覧以外のimportとファイル・通信操作には対応しません。
