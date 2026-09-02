# Type one line, paste the value — the addition that finishes without knowing x

> This track is an independent, unofficial companion to the Advanced Cryptography Program 2026.
> It is not affiliated with or endorsed by the course or its operators. All problem statements,
> code, fixtures, and figures here are written independently. Questions about this track go to
> the TenkaCloud repository, not to the course operators.

**Track:** `advanced-cryptography-2026` · **Order:** 12 · **Chapter:** Bridge 0 /
Computing Under a Cover · **Role:** `diagnostic` · **Time:** 20–30 minutes · **Points:** 100
· **Status:** draft — new companions need human play evidence (#465) before leaving draft

## What this is

The catalog's difficulty-1 entrance step. Not a write-a-function problem: you open your own
`python3`, paste the numbers the Portal's "Inspect evidence" shows you, and then **type one
line, paste the value it prints**, eleven times. The subject is one line of school algebra —
`(a + x) + (b + x) = (a + b) + 2x` — the line the whole course stands on: an addition that
finishes without anyone knowing x.

```
1  c1, c2 = a + x, b + x       lay the cover on                        covered
2  c1 + c2                     add without knowing                     sum-covered
3  (a + b) + 2 * x             the all-knowing expression             (no answer field)
4  c1 + c2 == ...              the agreement check                    (no answer field)
5  huge in place of x          the fifteen-digit cover, as a diff      huge
6  held = c1 + c2; (held, 2x)  what the other side holds               held
7  held - 2 * x                take the cover off                      recover
8  count the candidates        nothing narrows                         guesses
9  c1 - c2                     the shared cover leaks the difference   gap
10 (c1*c2, ab+(a+b)x, diff)    multiplication leaves x²                product
11 diff == x * x               the wall, touched before it has a name (no answer field)
```

Every line comes with "what this line means"; every matching value unlocks "read after it
matches". Eight of the eleven lines have an answer field — the platform's per-problem maximum;
two of the other three only display a `True` whose content the line before them already
carries, and line 3 prints the same number as line 2.

## Why the numbers are small and seed-derived

a and b are single digits, the small cover is at most two digits, and the candidate count in
line 8 stays below sixty — every line is checkable by hand or at a glance. The huge cover is
fifteen digits precisely so nothing about it is checkable by eye, which is that line's point.
All values come from this deployment's `FLAG_SEED`; the statement's worked example (a = 5,
b = 3, x = 2, huge = 10⁶, n = 13) is outside the generation range (x is at least 3, huge
always fifteen digits, n at least 17), so no deployment can be solved by copying the
statement. There is one right value per line per seed; only the value your own Python
printed passes.

Mod is deliberately not a topic here: line 8's `% n` gets a one-sentence inline gloss and
nothing more. The clock world itself is the next problem (`ac26-bridge-clock`).

## Participant Portal

1. Start the problem in the Participant Portal. The problem editor appears on the same page.
2. Press **Inspect evidence**: the numbers are printed as Python assignment statements. Paste
   them into `python3` first.
3. Type line 1, paste the value into the first answer field, submit. Read the sentence for
   that value. Continue to line 11. **Each answer field is a single-line input.**
4. If you cannot open Python: fill in the functions of `unknown_x_drill.py` in the editor
   and press **Run public tests** — it prints your functions' values on this deployment's
   numbers, which is exactly what the REPL would print.

Direct answers are bound to the current deployment seed, so values copied from another
deployment are rejected.

## Scoring

Eight checkpoints, graded independently. A wrong answer costs 5 points.

| Checkpoint | Points | Evidence kind | What it checks |
|---|---:|---|---|
| `covered` | 10 | construct | the pair (a + x, b + x) — all the other side receives |
| `sum-covered` | 10 | construct | c1 + c2, the addition done in ignorance of x |
| `huge` | 15 | predict | the two sides' difference with a fifteen-digit cover |
| `held` | 10 | construct | what returns, paired with the cover total 2x |
| `recover` | 10 | construct | the cover taken off — a + b, never shown to anyone |
| `guesses` | 15 | trace | the candidate count: nothing narrows |
| `gap` | 15 | counterexample | c1 − c2: the difference two values under one cover leak |
| `product` | 15 | counterexample | the multiplication's leftover — exactly x² |

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

Only the Workbench is published, at host `127.0.0.1:18140`; the verifier has no host port.
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

`make reference-test` runs the mutation suite: eleven broken references (the cover never laid
on, the cover counted once in three separate places, the candidate count without the wrap,
the expansion missing its cross terms, the wall compared against 2x, …) that the hidden
suite must kill, plus fourteen verifier-level near-misses — the plain pair, the returned sum
unopened, the "surely it narrows to one" guess, a truncated tuple, a boolean, another
deployment's answer — that the value grader must refuse. `make test` and `make inspect` run
through Compose because the participant image has no `fixtures/`: the public numbers come
from the verifier's `GET /public`.
