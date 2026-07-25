# The Counter That Slipped

Bridge 0 of the **Advanced Cryptography 2026** companion track. No cryptography
appears in this challenge. What appears is the loop every later challenge in the
track assumes you already have: observe, predict, run, compare, and find the first
place the two disagree.

> This TenkaCloud track is an unofficial companion built independently for
> learners of the Advanced Cryptography Program 2026. It is not affiliated with
> the course organizers and contains no official assignment solutions.

## Introduction

There is a small counter. It starts at `start`, adds `step` once per round, and
after each addition records the value reduced into `[0, modulus)`. The value
recorded at round `i` (1-based) is

```text
(start + step * i) reduced into [0, modulus)
```

That is the whole subject. It is deliberately something you already understand,
so that the thing you are actually practising is the method rather than the
mathematics.

## First step

```bash
cd local
docker compose up -d --wait
make test
```

`make test` prints the Python version and a marker unique to this environment. It
runs even before you have written anything — that is on purpose, so "the lab is
broken" and "I have not implemented it yet" never look the same.

Then:

```bash
make inspect
```

This prints the values round by round, the parameters for checkpoint 2, and the
published trace for checkpoint 3.

## Goal

Implement `advance()` in `local/solution/counter.py`. That is the only file you
edit.

```python
def advance(start: int, step: int, rounds: int, modulus: int) -> list[int]:
    ...
```

Return the `rounds` recorded values, in order, each inside `[0, modulus)`.

## Scoring

Four checkpoints, scored independently through the loopback `/verify`.

| checkpoint | Points | What you submit |
| --- | ---: | --- |
| `environment` | 10 | The marker `make test` printed |
| `predict` | 30 | For the predict case, the value the **last** round records |
| `first-divergence` | 30 | For the published trace, the 1-based round where the rule first breaks |
| `general-counter` | 30 | Nothing — `counter.py` itself is run on unseen cases |

Submit from the participant portal, or directly:

```bash
curl -s -X POST http://127.0.0.1:18311/verify \
  -H 'Content-Type: application/json' \
  -d '{"checkpointId":"predict","submission":"12"}'
```

The response echoes the `checkpointId` you sent, so a typo is visible rather than
silently scored as wrong.

## Why these four, in this order

**`predict` asks you to answer before running.** The predict case uses different
parameters from the public case, so running first and copying the output does not
work. Writing the prediction down first is what makes the difference between
prediction and measurement informative.

**`first-divergence` cannot be solved from the final value.** The published trace
breaks the rule on exactly one round, and every round after that follows the rule
again starting from the broken value. The tail is therefore self-consistent. You
have to compare adjacent values from the beginning.

**`general-counter` runs your code, not your answer.** It uses cases you have not
seen. An implementation that fits the single public case is not the same thing as
an implementation that matches the definition, and this checkpoint is where the
difference shows up.

## Participant contract

The same four targets mean the same thing in every AC26 challenge:

```bash
make test      # public tests — what you run while iterating
make inspect   # intermediate values and the published trace
make reset     # restore solution/ to its starting state
make shell     # a shell inside the lab container
```

There is no `make reference-test`. The reference implementation lives inside the
image and is never unpacked onto your machine.

## Safety boundary

- Both ports are bound to `127.0.0.1`. Nothing is exposed off this machine.
- `solution/` is mounted read-only. The verifier copies your file into a private
  temporary workspace before importing it, so verification never writes to your
  source tree and cannot be changed mid-run by an edit.
- Your code runs in a spawned subprocess with a 10-second wall-clock kill, so an
  infinite loop fails that checkpoint instead of wedging the lab. `spawn` rather
  than `fork` means the subprocess does not inherit the expected values.
- The container is read-only, unprivileged, `cap_drop: ALL`, `no-new-privileges`,
  and capped on memory, CPU, and process count.

The container **can** reach the network: a published port has to be routed through
a bridge network, and a bridge reaches the internet. Nothing here is secret from
you, so no claim is made otherwise.

## Cost

Zero. One local container, no cloud account, no AWS resources.

## Note on the parameters

The moduli are small so the values stay readable. They carry no security meaning,
and the same is true of the toy parameters in the later challenges in this track.
