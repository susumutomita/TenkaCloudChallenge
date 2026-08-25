# Type one line, paste the value — twelve lines from the field to nonce reuse

> This track is an independent, unofficial companion to the Advanced Cryptography Program 2026.
> It is not affiliated with or endorsed by the course or its operators. All problem statements,
> code, fixtures, and figures here are written independently. Questions about this track go to
> the TenkaCloud repository, not to the course operators.

**Track:** `advanced-cryptography-2026` · **Order:** 305 · **Chapter:** Week 3 / Drill: twelve lines
from field to nonce reuse · **Role:** `mechanism` · **Time:** 40–60 minutes · **Points:** 200
· **Status:** draft — new companions need human play evidence (#465) before leaving draft

## What this is

Not a write-a-function problem. You open your own `python3`, paste the numbers the Portal's
inspect shows you, and then **type one line, paste the value it prints**, twelve times:

```
1  (-t) % p                 negative numbers live in 0..p-1          (no answer field)
2  pow(t, p - 2, p)         the inverse: the partner that multiplies to 1   field-inv
3  lam = ...                the slope of the line through G and Q       (no answer field)
4  (x3, y3)                 G + Q: the third intersection, reflected    add-points
5  (x3, y3)                 2G: the tangent                              double
6  def ec_add ... ; k       add G until O — the order n                  order
7  P = ec_mul(x, G)         the public key                              (no answer field)
8  R = ec_mul(r, G)         the commitment                              (no answer field)
9  s = (r + e*x) % n        the response                                 response
10 ec_mul(s, G)             the left side of s*G = R + e*P               verify
11 (s1-s2)/(e1-e2) mod n    the secret behind two signatures with one nonce   nonce-reuse
12 the same, on curve 2     transfer                                     transfer
```

Every line comes with "what this line means"; every matching value unlocks "read after it
matches". Result and explanation sit next to each other — that is the point of the format, and
the reason it exists (see the description in `metadata.json`). Eight of the twelve lines have an
answer field — the platform's per-problem maximum; the other four are material for the line
after them, and a mistake in them surfaces there (a wrong λ on line 4, a wrong P or R on line 10).

## Why the numbers are small and seed-derived

The curves are verified prime-order toy curves (p ≤ 31, n ≤ 43), so every line is a one-screen
computation and `ec_mul` can be a plain loop. Everything — the curve, t, Q, x, r, e, the attack
key, the transfer curve — comes from this deployment's `FLAG_SEED`. There is one right value per
line per seed; only the value your own Python printed passes, and a value copied from another
deployment is rejected. The course assignment's own test numbers are not used.

## Participant Portal

1. Start the problem in the Participant Portal. The problem editor appears on the same page.
2. Press **inspect**: the numbers are printed as Python assignment statements. Paste them into
   `python3` first.
3. Type line 1, paste the value into the `field-neg` answer field, submit. Read the sentence for
   that value. Continue to line 12. **Each answer field is a single-line input.**
4. If you cannot open Python: fill in the twelve functions of `schnorr_drill.py` in the editor
   and press **run the public tests** — it prints your functions' values on this deployment's
   numbers, which is exactly what the REPL would print.

No checkout, terminal, local editor, or copy-paste between screens is required beyond your own
Python. Direct answers are bound to the current deployment seed, so values copied from another
deployment are rejected.

## Scoring

Eight checkpoints, graded independently. A wrong answer costs 10 points.

| Checkpoint | Points | Evidence kind | What it checks |
|---|---:|---|---|
| `field-inv` | 15 | predict | the inverse of t |
| `add-points` | 25 | construct | G + Q (a wrong λ from line 3 shows here) |
| `double` | 20 | construct | 2G |
| `order` | 25 | trace | the order n, counted by adding until O |
| `response` | 25 | predict | s = r + e·x mod n |
| `verify` | 30 | trace | s·G, the left side of the check (a wrong P or R from lines 7–8 shows here) |
| `nonce-reuse` | 30 | counterexample | the secret extracted from two signatures sharing a nonce |
| `transfer` | 30 | transfer | s on a second curve, with its order recounted |

One hint per checkpoint (penalty 6), naming the usual slip on that line.

## Assurance scope

Local mode is **self-paced, honor-system verification**. Someone who owns the Docker daemon
and every image in the compose stack cannot be prevented from inspecting hidden material.
The boundary here is misdelivery, not confidentiality against that person: the participant
Workbench image contains public fixtures, tests, and starter material only. The eight lines'
expected-value derivation (`verifier/expected.py`) and the hidden suite live in a separate,
unpublished verifier image, reachable only over the Compose-internal network; `reference/`
and `mutation.py` are added only to the `author` stage.

Only the Workbench is published, at host `127.0.0.1:18132`; the verifier has no host port.
Both services run non-root with a read-only root filesystem, no capabilities, `no-new-
privileges`, and bounded memory/PIDs. A submission cannot hang or crash the verifier, a
checkpoint can only credit the id it echoes, results do not leak expected values, and the
fixtures come from this deployment's seed so a memorized answer does not carry.

That supports self-study and honest practice. It does **not** support competition ranking,
examination, or completion certification — those need a verifier the participant does not
administer at all, tracked in [#271](https://github.com/susumutomita/TenkaCloudChallenge/issues/271).

## Cost

Zero. No cloud account, no AWS resources.

## For authors

`make reference-test` runs the mutation suite: nine broken references (the wrong modulus for s,
the tangent without `a`, the forgotten reflection, the order counted from 0, …) that the hidden
suite must kill, plus ten verifier-level near-misses — a shown fixture value, another line's
value, the unreflected point, s reduced mod p, a boolean, another deployment's answer — that the
value grader must refuse. `scripts/solvability/expected/ac26-w3-schnorr-drill.py` mirrors the
eight graded answers for the solvability sweep.
