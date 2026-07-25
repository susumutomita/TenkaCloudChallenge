# Five multiplications, one round

> This track is an independent, unofficial companion to the Advanced Cryptography Program 2026.
> It is not affiliated with or endorsed by the course or its operators. All problem statements,
> code, fixtures, and figures here are written independently. Questions about this track go to
> the TenkaCloud repository, not to the course operators.

**Track:** `advanced-cryptography-2026` · **Order:** 250 · **Chapter:** Week 2 / Private
Aggregation Synthesis · **Role:** `synthesis` · **Time:** 75–105 minutes · **Points:** 300
· **Required first:** `ac26-w2-privacy-audit` · **Status:** draft — see "Week 2 alignment"

## The story

Several organizations have been comparing notes about incidents, badly — over lunch, in
generalities, nobody willing to be the one who says a number first. What they actually want is a
single figure:

```text
score = sum_i (count_i * severity_i) + bias        (bias public, mod p)
```

Both factors of every product are secret, and they belong to different people. This is the whole of
Week 2 in one expression.

## What you build

Everything you reveal goes through one handle:

```python
io.open_batch([sharing_a, sharing_b])   # -> [value_a, value_b]   1 round
io.open_batch([sharing_a])
io.open_batch([sharing_b])              # -> same values          2 rounds
```

One call is one round. How you group your openings is a design decision, and it is **measured**,
not asked about.

## How to play

```bash
make inspect            # your setting and the shape of what you are handed
make test               # public tests
make reset              # restore starter/aggregate.py
```

You edit one file, `local/starter/aggregate.py`.

## Scoring

Eight checkpoints, scored independently. Wrong answers cost 15 points each.

| Checkpoint | Points | What is checked |
|---|---:|---|
| `plan` | 35 | Multiplications, triples and rounds, estimated before implementing |
| `share-inputs` | 30 | One canonical share per party, reconstructing to the secret |
| `linear` | 30 | A public constant folded in by exactly one party |
| `multiply` | 55 | The score matches the plain computation |
| `result` | 35 | Re-sharing, permutation, and a known input delta |
| `privacy` | 40 | The masked differences were revealed, and nothing else |
| `cost` | 35 | The estimate matches the measurement |
| `transfer` | 40 | All of it, under a seed you have never been shown |

Hints on six of the eight, each inside that checkpoint's 50% cap.

## Two of the three numbers are the same

`k` organizations means `k` multiplications and `k` triples. It does **not** mean `k` rounds: no
product's `d` and `e` depends on any other product's result, so all of them fit in one opening.

An implementation that opens per multiplication is correct, is private, and costs `k` times the
latency. That is the point — rounds track multiplicative **depth**, not multiplication count. This
expression has depth 1, so the round count stays at one however wide it grows. A circuit of depth
`D` costs `D` rounds.

## Why reusing a triple is not a correctness bug

Beaver multiplication works with any valid triple, so reusing one across every product still gives
the right score. Every correctness test you can write passes.

What breaks is privacy. With one `a` masking both `x₁` and `x₂`, the opened `d₁ - d₂` **is**
`x₁ - x₂` — a difference of secrets, sitting in the transcript.

The hidden tests match the multiset of opened values exactly against the masked differences the
supplied triples imply. Being an exact match rather than a blacklist, one check catches "used
another product's triple", "revealed something extra", and "revealed something short".

## Correctness, privacy and cost are graded separately

An implementation can be correct and expensive, correct and leaky, or private and wrong. Folded
into a single verdict, you could not tell which of those you built. So they are three checkpoints.

## What the published output leaks by definition

Once the score is published, whatever follows from the score is public. At `k = 1`, `score - bias`
is that organization's product outright. With small `k` and a narrow severity range, the candidate
counts narrow a lot.

MPC guarantees the *process* adds no leakage. It does not guarantee the output reveals nothing —
that needs a different mechanism, such as perturbing or thresholding what you publish.

## Threat model

Honest-but-curious, no collusion, toy field, values small enough to check by hand. Not a security
claim and not a model of a real deployment.

## Week 2 alignment

Week 2's material was not published upstream at the commit `curriculum.md` records, so
`courseAlignment` pins `week2/README.md` with `kind: "placeholder"`, and `status` stays `draft`.
The pin records the *absence* of material at that commit rather than an alignment to it — which is
what lets `bun run course:drift` report `PUBLISHED` the day the material appears. #219 reconciles
the row before this leaves draft.

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

`make reference-test` runs the mutation suite: nine broken implementations. Two of them —
triple reuse and per-multiplication opening — produce **exactly the right score**, so a suite that
only checked the answer would let both through and the problem would be grading arithmetic.
