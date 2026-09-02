# Type one line, paste the value — the clock world, and the cover that must not repeat

> This track is an independent, unofficial companion to the Advanced Cryptography Program 2026.
> It is not affiliated with or endorsed by the course or its operators. All problem statements,
> code, fixtures, and figures here are written independently. Questions about this track go to
> the TenkaCloud repository, not to the course operators.

**Track:** `advanced-cryptography-2026` · **Order:** 14 · **Chapter:** Bridge 0 /
Clock Arithmetic and Covers · **Role:** `diagnostic` · **Time:** 30–40 minutes ·
**Points:** 100 · **Status:** draft — new companions need human play evidence (#465) before
leaving draft

## What this is

The catalog's difficulty-2 second step, directly after `ac26-bridge-unknown-x`. Every later
week computes in the world of division remainders — a clock of n ticks — and this problem
scouts that world before the course moves in. You open your own `python3`, paste the numbers
the Portal's "Inspect evidence" shows you, and **type one line, paste the value it prints**,
ten times.

```
1  (u % n, v % n)              put them on the clock                  (no answer field)
2  add, both orders            the difference is 0                     add
3  multiply, both orders       still 0 — a place to compute            mul
4  (secret + cover) % n        hide with a random cover                cover
5  (covered - cover) % n       the same cover takes it back            uncover
6  table t; read 3 spots       one cover per candidate — flat          every
7  sum(t)                      n covers for n candidates: nothing      count
8  same cover, second message  the reuse begins                        reuse
9  (covered - covered2) % n    the covers cancel — the real gap leaks  leak
10 leak == real gap            the oldest failure, caused by hand     (no answer field)
```

The summit is lines 6–7: for every candidate secret there is exactly one cover producing the
observation, so the observation narrows **nothing** — established by the learner's own
counting, without the term "perfect secrecy". The last two lines reuse the cover on purpose
and leak the secrets' difference, without the term "one-time pad". Eight of the ten lines
have an answer field — the platform's per-problem maximum.

## Why the numbers are small and seed-derived

The clock has 12–24 ticks, so the cover table of line 6 is buildable in one comprehension
and readable at a glance. u and v are drawn above n so the wrap is always visible; the cover
is redrawn so the covered value never lands on the secret or on 0; the second secret is
redrawn so neither observation collides with a number already on screen (otherwise roughly
one deployment in twenty is readable off the assignment block — see `generate.py`'s
docstring). The `every` line reads three specific spots rather than a copyable shape,
because n is on screen. The statement's worked example (n = 10) is outside the generation
range (n ≥ 12). One right value per line per seed; only what your own Python printed passes.

## Participant Portal

1. Start the problem in the Participant Portal. The problem editor appears on the same page.
2. Press **Inspect evidence**: the numbers are printed as Python assignment statements. Paste
   them into `python3` first.
3. Type line 1, then line 2, pasting each printed value into its answer field. Continue to
   line 10. **Each answer field is a single-line input.**
4. If you cannot open Python: fill in the functions of `clock_drill.py` in the editor and
   press **Run public tests** — it prints your functions' values on this deployment's
   numbers, which is exactly what the REPL would print.

Direct answers are bound to the current deployment seed, so values copied from another
deployment are rejected.

## Scoring

Eight checkpoints, graded independently. A wrong answer costs 5 points.

| Checkpoint | Points | Evidence kind | What it checks |
|---|---:|---|---|
| `add` | 10 | construct | addition commutes with the wrap — difference 0 |
| `mul` | 10 | construct | multiplication commutes with the wrap — difference 0 |
| `cover` | 10 | construct | (secret + cover) % n — the one number the other side sees |
| `uncover` | 10 | construct | (covered − cover) % n — the secret comes back |
| `every` | 20 | trace | the cover count at three candidates — flat everywhere |
| `count` | 10 | trace | the whole table's sum — one cover per candidate |
| `reuse` | 10 | construct | the two observations under one reused cover |
| `leak` | 20 | counterexample | their difference — the cover cancels, the real gap leaks |

One hint per checkpoint (penalty 3–5), naming the usual slip on that line.

## Assurance scope

Local mode is **self-paced, honor-system verification**. Someone who owns the Docker daemon
and every image in the compose stack cannot be prevented from inspecting hidden material.
The boundary here is misdelivery, not confidentiality against that person: the participant
Workbench image contains the Portal editor API, the starter and the public tests only.
This problem's `fixtures/generate.py` derives the expected values in the same function as
the public numbers, so the module ships only in the separate, unpublished verifier image
(Issue 537/543 option B2); the Workbench fetches this deployment's public half from the
verifier's `GET /public` over the Compose-internal network. `reference/` and `mutation.py`
are added only to the `author` stage.

Only the Workbench is published, at host `127.0.0.1:18141`; the verifier has no host port.
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

`make reference-test` runs the mutation suite: ten broken references (the wrap never taken,
the left side never wrapped in the add and mul comparisons, the cover added where it should
be subtracted, the table counted without the wrap, the leak's difference reversed, …) that
the hidden suite must kill, plus twelve verifier-level near-misses — the secret where the
covered value belongs, the candidates where their counts belong, an unwrapped sum, a
truncated tuple, a boolean, another deployment's answer — that the value grader must refuse.
`make test` and `make inspect` run through Compose because the participant image has no
`fixtures/`: the public numbers come from the verifier's `GET /public`.
