# Type one line, paste the value — the negacyclic flip as the accident, then as the mechanism

> This track is an independent, unofficial companion to the Advanced Cryptography Program 2026.
> It is not affiliated with or endorsed by the course or its operators. All problem statements,
> code, fixtures, and figures here are written independently. Questions about this track go to
> the TenkaCloud repository, not to the course operators.

**Track:** `advanced-cryptography-2026` · **Order:** 565 · **Chapter:** Week 5 / Drill:
Negacyclic flip and HomNAND · **Role:** `mechanism` · **Time:** 40–60 minutes · **Points:** 200
· **Status:** draft — new companions need human play evidence (#465) before leaving draft

## What this is

Not a write-a-function problem. You open your own `python3`, paste the numbers the Portal's
"Inspect evidence" shows you, and then **type one line, paste the value it prints**, twelve times. The
first five lines produce the negacyclic sign flip (`x^n = -1`) as an **accident** — the spot
lecture slide 35 leaves as an open question. The last seven produce the same flip as the
**mechanism** that makes HomNAND work (slides 43–45).

```
1  (p, q, n, D)                the ring's constants, q = 2n            params
2  E = lo + hi; ...            fold the overflowing exponent           wrap
3  c = lambda i: ...; probes   the constant term at six probes         signs
4  min(i ... if c(i) < 0)      the flip boundary — exactly n           boundary
5  (lo + n, c(lo + n))         the read that overshoots by n           hazard
6  (p - 1, 1)                  the bit encoding, effectively ±1       (no answer field)
7  r = 1 - m1 - m2 mod p       the four phases                        (no answer field)
8  D*r - noise mod q           the four rotation amounts               rotations
9  tuple(c(i) for i in rots)   the constant terms — a truth table      constants
10 NAND(a, b), four pairs      the cross-check                        (no answer field)
11 sweep every noise 0..dmax   the table stays closed                 (no answer field)
12 n - 3*D                     the room left before the boundary       margin
```

Every line comes with "what this line means"; every matching value unlocks "read after it
matches". Eight of the twelve lines have an answer field — the platform's per-problem maximum;
the other four are construction constants, a cross-check, or feed the line after them.

## Why the numbers are small and seed-derived

The ring degree is 16–64 and the plaintext modulus 8–32, so every line is a one-screen
computation and the noise sweep is one `all(...)`. The procedure is the lecture's; the ring,
the noise, and every probe index come from this deployment's `FLAG_SEED`. The assignment's own
toy parameters (p=8, n=16) are excluded from generation, so no deployment can be solved by
copying the course material. There is one right value per line per seed; only the value your
own Python printed passes.

One correction the drill carries on purpose: slide 44 states the HomNAND condition as
"3 < n < p−1", which fails on the lecture's own example. The generator enumerates exactly the
(n, p, dmax) satisfying the condition that actually governs — 3D < n and dmax ≤ D — and the
`margin` line has the learner measure that room.

## Participant Portal

1. Start the problem in the Participant Portal. The problem editor appears on the same page.
2. Press **Inspect evidence**: the numbers are printed as Python assignment statements. Paste them into
   `python3` first.
3. Type line 1, paste the value into the first answer field, submit. Read the sentence for
   that value. Continue to line 12. **Each answer field is a single-line input.**
4. If you cannot open Python: fill in the functions of `negacyclic_drill.py` in the editor
   and press **Run public tests** — it prints your functions' values on this deployment's
   numbers, which is exactly what the REPL would print.

Direct answers are bound to the current deployment seed, so values copied from another
deployment are rejected.

## Scoring

Eight checkpoints, graded independently. A wrong answer costs 10 points.

| Checkpoint | Points | Evidence kind | What it checks |
|---|---:|---|---|
| `params` | 20 | construct | (p, q, n, D) with q = 2n and D = q/p |
| `wrap` | 25 | construct | x^(lo+hi) reduced: remainder, sign, original exponent |
| `signs` | 25 | predict | the constant term of x^(−i)·v(x) at six probes |
| `boundary` | 20 | trace | the first i whose constant term is negated — exactly n |
| `hazard` | 30 | counterexample | the read n past lo: same coefficient, opposite sign |
| `rotations` | 30 | construct | D·r − noise mod q for all four input pairs |
| `constants` | 30 | predict | the constant terms after rotating — the NAND column as ±1 |
| `margin` | 20 | trace | n − 3D, the room the real condition leaves |

One hint per checkpoint (penalty 6), naming the usual slip on that line.

## Assurance scope

Local mode is **self-paced, honor-system verification**. Someone who owns the Docker daemon
and every image in the compose stack cannot be prevented from inspecting hidden material.
The boundary here is misdelivery, not confidentiality against that person: the participant
Workbench image contains the Portal editor API, the starter and the public tests only.
Unlike the Week 4 drills, this problem's `fixtures/generate.py` derives the expected values
in the same function as the public numbers, so the module ships only in the separate,
unpublished verifier image (Issue 537/543 option B2); the Workbench fetches this deployment's
public half from the verifier's `GET /public` over the Compose-internal network. `reference/`
and `mutation.py` are added only to the `author` stage.

Only the Workbench is published, at host `127.0.0.1:18136`; the verifier has no host port.
Both services run non-root with a read-only root filesystem, no capabilities, `no-new-
privileges`, and bounded memory/PIDs. A checkpoint can only credit the id it echoes, results
do not leak expected values, and the fixtures come from this deployment's seed so a memorized
answer does not carry.

That supports self-study and honest practice. It does **not** support competition ranking,
examination, or completion certification — those need a verifier the participant does not
administer at all, tracked in [#271](https://github.com/susumutomita/TenkaCloudChallenge/issues/271).

## Cost

Zero. No cloud account, no AWS resources.

## For authors

`make reference-test` runs the mutation suite: thirteen broken references (the sign counted
with the wrong parity, the constant term read without the flip, the boundary searched only
below n, the noise added instead of subtracted, slide 44's condition taken literally, …) that
the hidden suite must kill, plus twelve verifier-level near-misses — a shown fixture value,
another line's value, the NAND column where the constant terms belong, a truncated tuple, a
boolean, another deployment's answer — that the value grader must refuse. `make test` and
`make inspect` run through Compose because the participant image has no `fixtures/`: the
public numbers come from the verifier's `GET /public`.
