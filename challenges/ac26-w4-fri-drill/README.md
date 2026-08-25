# Type one line, paste the value — FRI folding and the query check

> This track is an independent, unofficial companion to the Advanced Cryptography Program 2026.
> It is not affiliated with or endorsed by the course or its operators. All problem statements,
> code, fixtures, and figures here are written independently. Questions about this track go to
> the TenkaCloud repository, not to the course operators.

**Track:** `advanced-cryptography-2026` · **Order:** 425 · **Chapter:** Week 4 / Drill: FRI
folding · **Role:** `mechanism` · **Time:** 40–60 minutes · **Points:** 200
· **Status:** draft — new companions need human play evidence (#465) before leaving draft

## What this is

Not a write-a-function problem. You open your own `python3`, paste the numbers the Portal's
inspect shows you, and then **type one line, paste the value it prints**, twelve times — an
honest FRI lap first, then a dishonest fold you catch yourself.

```
1  Q = ...; (Q(0),Q(1),Q(2))     the committed Q0                       poly
2  Qe, Qo                        the even/odd split                    (no answer field)
3  identity at every point       all True                              (no answer field)
4  Q1 = Qe + beta*Qo             fold: degree halves                    fold
5  c + beta2*d                   fold again: a constant                 fold2
6  (Q(x), Q(-x))                 the two openings                       query
7  (re, ro, Qe(x²), Qo(x²))      both halves recovered                  recover
8  (re + beta*ro, Q1(x²))        the query check, honest                consistency
9  Q1c = Q1 + d0 + d1*Y          the swapped commitment                (no answer field)
10 (re + beta*ro, Q1c(x²))       the query check catches it             cheat-caught
11 sorted(misses)                one ±x pair                            miss-points
12 honest fold fails nowhere     []                                    (no answer field)
```

Every line comes with "what this line means"; every matching value unlocks "read after it
matches". Eight of the twelve lines have an answer field — the platform's per-problem maximum.

## Why the numbers are small and seed-derived

The field is a small odd prime (17–31), so every line is a one-screen computation and the
all-points checks are list comprehensions. The procedure follows the lecture's FRI section,
whose F₁₇ example (Q₀ = 15 + 5X + 5X², Q₁ = 5Y + 13, x = 8) sits verbatim in the public
test's part 1; the deployment's Q₀ (degree exactly 3), β, β₂, x, and the swap's difference
are seed-derived. The swap is built as d0 = −d1·s², so the miss set is exactly one ±x pair
and it changes per deployment.

## Participant Portal

1. Start the problem in the Participant Portal. The problem editor appears on the same page.
2. Press **inspect**: the numbers are printed as Python assignment statements. Paste them into
   `python3` first.
3. Type line 1, paste the value into the `poly` answer field, submit. Read the sentence for
   that value. Continue to line 12. **Each answer field is a single-line input.**
4. If you cannot open Python: fill in the twelve functions of `fri_drill.py` in the editor
   and press **run the public tests** — it prints your functions' values on this deployment's
   numbers, which is exactly what the REPL would print.

Direct answers are bound to the current deployment seed, so values copied from another
deployment are rejected.

## Scoring

Eight checkpoints, graded independently. A wrong answer costs 10 points.

| Checkpoint | Points | Evidence kind | What it checks |
|---|---:|---|---|
| `poly` | 20 | construct | the committed Q₀ at 0, 1, 2 |
| `fold` | 25 | construct | Q₁ = Q_even + β·Q_odd — degree halved |
| `fold2` | 25 | construct | folded once more: the constant c + β₂·d |
| `query` | 20 | predict | the two openings (Q₀(x), Q₀(−x)) |
| `recover` | 25 | predict | both halves from the openings, beside the direct values |
| `consistency` | 25 | trace | the query check on the honest fold — equal |
| `cheat-caught` | 30 | counterexample | the same check on the swapped Q₁′ — caught |
| `miss-points` | 30 | trace | the exact ±x pair that would have missed |

One hint per checkpoint (penalty 6), naming the usual slip on that line.

## Assurance scope

Local mode is **self-paced, honor-system verification**. Someone who owns the Docker daemon
and every image in the compose stack cannot be prevented from inspecting hidden material.
The boundary here is misdelivery, not confidentiality against that person: the participant
Workbench image contains public fixtures, tests, and starter material only. The eight lines'
expected-value derivation (`verifier/expected.py`) and the hidden suite live in a separate,
unpublished verifier image, reachable only over the Compose-internal network; `reference/`
and `mutation.py` are added only to the `author` stage.

Only the Workbench is published, at host `127.0.0.1:18135`; the verifier has no host port.
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

`make reference-test` runs the mutation suite: eight broken references (the odd part from
the even coefficients, the fold with the halves swapped, (2x)⁻¹ as x⁻¹, the second opening
at Q(x), the second fold reusing β, …) that the hidden suite must kill, plus ten
verifier-level near-misses — the unfolded values, a swapped or truncated tuple, the cheat's
pair offered for the honest line and vice versa, a boolean, another deployment's answer —
that the value grader must refuse.
`scripts/solvability/expected/ac26-w4-fri-drill.py` mirrors the eight graded answers for
the solvability sweep.
