# Type one line, paste the value — PLONK's two constraints and the grand product

> This track is an independent, unofficial companion to the Advanced Cryptography Program 2026.
> It is not affiliated with or endorsed by the course or its operators. All problem statements,
> code, fixtures, and figures here are written independently. Questions about this track go to
> the TenkaCloud repository, not to the course operators.

**Track:** `advanced-cryptography-2026` · **Order:** 435 · **Chapter:** Week 4 / Drill: PLONK's
two constraints · **Role:** `mechanism` · **Time:** 40–60 minutes · **Points:** 200
· **Status:** draft — new companions need human play evidence (#465) before leaving draft

## What this is

Not a write-a-function problem. You open your own `python3`, paste the numbers the Portal's
inspect shows you, and then **type one line, paste the value it prints**, twelve times —
first on an honest gate table, then on a lying one you build yourself.

```
1  (o0, o1, o2)               the three gate outputs                  outputs
2  gate equation on 3 rows    [0, 0, 0] — every row fits its type    (no answer field)
3  the two wires              (True, True)                           (no answer field)
4  bad2 = (o0+g, o1, ...)     a lying row: gates pass, wire breaks    bad-row
5  gates + wires on the lie   ([0,0,0], (False, True))               (no answer field)
6  addresses of 9 cells       ω^row · (col+1)                         addresses
7  the same, through σ        two pairs swapped                       sigma-addresses
8  fingerprints               (value + β·addr + γ), first three       marks
9  the grand product          equal on the honest table               grand-product
10 the lying table's product  the broken wire shows up                bad-product
11 the sets, side by side     (True, False)                          (no answer field)
12 count the misses           only a zeroed fingerprint escapes       miss-count
```

Every line comes with "what this line means"; every matching value unlocks "read after it
matches". Eight of the twelve lines have an answer field — the platform's per-problem maximum;
the other four are constants of the construction, explained in place.

## Why the numbers are small and seed-derived

The gate field is a small prime (11–23) and the grand-product field a three-digit one
(101–113), so every line is a one-screen computation and the exhaustive miss count is a few
seconds. The table, σ, and grand-product procedure follow the lecture's PLONK example; the
inputs, both fields, the address base, β, γ, and the lie's shift g all come from this
deployment's `FLAG_SEED`. There is one right value per line per seed; only the value your own
Python printed passes, and the miss count changes per deployment.

## Participant Portal

1. Start the problem in the Participant Portal. The problem editor appears on the same page.
2. Press **inspect**: the numbers are printed as Python assignment statements. Paste them into
   `python3` first.
3. Type line 1, paste the value into the `outputs` answer field, submit. Read the sentence for
   that value. Continue to line 12. **Each answer field is a single-line input.**
4. If you cannot open Python: fill in the twelve functions of `plonk_drill.py` in the editor
   and press **run the public tests** — it prints your functions' values on this deployment's
   numbers, which is exactly what the REPL would print.

Direct answers are bound to the current deployment seed, so values copied from another
deployment are rejected.

## Scoring

Eight checkpoints, graded independently. A wrong answer costs 10 points.

| Checkpoint | Points | Evidence kind | What it checks |
|---|---:|---|---|
| `outputs` | 20 | construct | the three gate outputs |
| `bad-row` | 20 | counterexample | the lying gate-2 row: gates pass, the wire breaks |
| `addresses` | 25 | construct | ω^row · (col + 1) for all nine cells |
| `sigma-addresses` | 25 | predict | the addresses re-attached through σ |
| `marks` | 25 | predict | the first three fingerprints (value + β·addr + γ) |
| `grand-product` | 25 | trace | the two products, equal on the honest table |
| `bad-product` | 30 | counterexample | the two products, split by the broken wire |
| `miss-count` | 30 | trace | how many (β, γ) pairs would have missed |

One hint per checkpoint (penalty 6), naming the usual slip on that line.

## Assurance scope

Local mode is **self-paced, honor-system verification**. Someone who owns the Docker daemon
and every image in the compose stack cannot be prevented from inspecting hidden material.
The boundary here is misdelivery, not confidentiality against that person: the participant
Workbench image contains public fixtures, tests, and starter material only. The eight lines'
expected-value derivation (`verifier/expected.py`) and the hidden suite live in a separate,
unpublished verifier image, reachable only over the Compose-internal network; `reference/`
and `mutation.py` are added only to the `author` stage.

Only the Workbench is published, at host `127.0.0.1:18134`; the verifier has no host port.
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

`make reference-test` runs the mutation suite: eight broken references (the multiplication
gate as an addition, the address factor off by one, a forgotten σ swap, a dropped reduction,
the miss count starting at β = 0, …) that the hidden suite must kill, plus twelve
verifier-level near-misses — the un-permuted address list, the honest products offered for
the lying line, a swapped pair, a truncated tuple, a boolean, another deployment's answer —
that the value grader must refuse. The server counts misses by factoring (a miss needs a
shared fingerprint to zero both products) and the per-problem test proves the fast count
equals the exhaustive loop the learner types.
`scripts/solvability/expected/ac26-w4-plonk-drill.py` mirrors the eight graded answers for
the solvability sweep.
