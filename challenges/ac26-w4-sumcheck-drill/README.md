# Type one line, paste the value — two rounds of SumCheck, then count the misses

> This track is an independent, unofficial companion to the Advanced Cryptography Program 2026.
> It is not affiliated with or endorsed by the course or its operators. All problem statements,
> code, fixtures, and figures here are written independently. Questions about this track go to
> the TenkaCloud repository, not to the course operators.

**Track:** `advanced-cryptography-2026` · **Order:** 405 · **Chapter:** Week 4 / Drill: SumCheck
by hand · **Role:** `mechanism` · **Time:** 40–60 minutes · **Points:** 200
· **Status:** draft — new companions need human play evidence (#465) before leaving draft

## What this is

Not a write-a-function problem. You open your own `python3`, paste the numbers the Portal's
inspect shows you, and then **type one line, paste the value it prints**, twelve times. For nine
lines you are the verifier; for the last three, the lying prover.

```
1  (y0, y1, out)                the circuit: two gates and the output   circuit
2  W1 = ...; (W1(0),W1(1),W1(2))  the table stretched into a line (MLE)  mle
3  g0 = ...; four grid points    the wiring as a polynomial              grid
4  sum over the grid             the four-term sum                      (no answer field)
5  P1 = ...; P1(0)+P1(1)         the prover's p1, sum-checked           (no answer field)
6  all-points comparison         is p1 genuine? (the check V never does) (no answer field)
7  P1(r1)                        one random point — the next claim       round1
8  P2 = ...; P2(0)+P2(1)         the prover's p2, sum-checked           (no answer field)
9  (P2(r2), g0(r1, r2))          the last point: V computes g0 itself    final-check
10 P1c = P1 + d*(1-t); ...       inflate the claim by d                  lie
11 P2c = ...; the triple         the cover-up dies at the last point     lie-caught
12 sorted(misses)                which r2 would have missed              miss-points
```

Every line comes with "what this line means"; every matching value unlocks "read after it
matches". Eight of the twelve lines have an answer field — the platform's per-problem maximum;
the other four equal a value already produced or feed the line after them.

## Why the numbers are small and seed-derived

The field is a small prime (11–23), so every line is a one-screen computation and the all-points
sanity check is a list comprehension. The circuit is the lecture's two-gate GKR example; the
inputs, the verifier's randomness, the prover's coefficient messages, and the lie parameters all
come from this deployment's `FLAG_SEED`. There is one right value per line per seed; only the
value your own Python printed passes, and the two miss points change per deployment.

## Participant Portal

1. Start the problem in the Participant Portal. The problem editor appears on the same page.
2. Press **inspect**: the numbers are printed as Python assignment statements. Paste them into
   `python3` first.
3. Type line 1, paste the value into the `circuit` answer field, submit. Read the sentence for
   that value. Continue to line 12. **Each answer field is a single-line input.**
4. If you cannot open Python: fill in the twelve functions of `sumcheck_drill.py` in the editor
   and press **run the public tests** — it prints your functions' values on this deployment's
   numbers, which is exactly what the REPL would print.

Direct answers are bound to the current deployment seed, so values copied from another
deployment are rejected.

## Scoring

Eight checkpoints, graded independently. A wrong answer costs 10 points.

| Checkpoint | Points | Evidence kind | What it checks |
|---|---:|---|---|
| `circuit` | 20 | construct | (y₀, y₁, output) |
| `mle` | 25 | construct | the table stretched to (W₁(0), W₁(1), W₁(2)) |
| `grid` | 25 | predict | g₀ on the four grid points |
| `round1` | 25 | predict | p₁ at the verifier's random r₁ |
| `final-check` | 25 | trace | (p₂(r₂), the verifier's own g₀(r₁, r₂)) |
| `lie` | 25 | counterexample | the inflated p₁′: its sum check and its value at r₁ |
| `lie-caught` | 30 | counterexample | the doctored p₂′: sum check passes, the last point fails |
| `miss-points` | 25 | trace | the exact r₂ values that would have missed the lie |

One hint per checkpoint (penalty 6), naming the usual slip on that line.

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

`make reference-test` runs the mutation suite: eight broken references (the MLE with the table
swapped, the wiring selector on the wrong corner, a dropped square, the fudge attached to t,
the miss list counted from 2, …) that the hidden suite must kill, plus twelve verifier-level
near-misses — a shown fixture value, another line's value, an unsorted or truncated tuple, a
boolean, another deployment's answer — that the value grader must refuse.
`scripts/solvability/expected/ac26-w4-sumcheck-drill.py` mirrors the eight graded answers for
the solvability sweep.
