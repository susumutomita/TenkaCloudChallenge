# What you can do without talking to anyone

> This track is an independent, unofficial companion to the Advanced Cryptography Program 2026.
> It is not affiliated with or endorsed by the course or its operators. All problem statements,
> code, fixtures, and figures here are written independently. Questions about this track go to
> the TenkaCloud repository, not to the course operators.

**Track:** `advanced-cryptography-2026` · **Order:** 220 · **Chapter:** Week 2 / Local Linear
Operations · **Role:** `mechanism` · **Time:** 35–50 minutes · **Points:** 200
· **Required first:** `ac26-w2-secret-sharing` · **Status:** draft — see "Week 2 alignment"

## The story

The auditors' scheme from last time works: numbers get split, nobody sees anyone else's figure.
Now they actually want to *compute* — sums, weighted totals, a running average.

The obvious worry is that every step needs a meeting. It does not. Most of what they want, each
auditor can do alone, on their own slip of paper, and the pieces still add up to the right answer.
Working out exactly which steps those are is what makes the scheme usable instead of theoretical.

## The four operations

```text
add-shared      shares of x, shares of y   ->  shares of x + y
add-constant    shares of x, public c      ->  shares of x + c
mul-constant    shares of x, public c      ->  shares of x * c
mul-shared      shares of x, shares of y   ->  shares of x * y
```

Three of the four are the obvious thing. **One is not**, and it is not the one you would guess.

## How to play

```bash
make inspect            # your setting and the four operations
make test               # public tests
make reset              # restore starter/linear.py
```

You edit one file, `local/starter/linear.py`.

## Scoring

Five checkpoints, scored independently. Wrong answers cost 10 points each.

| Checkpoint | Points | What is checked |
|---|---:|---|
| `add-shares` | 40 | Reconstructs to the sum, across four settings |
| `add-constant` | 50 | Reconstructs to `x + c` — and the classic wrong answer is named |
| `mul-constant` | 35 | Reconstructs to `x * c` |
| `no-communication` | 40 | Which of the four need anyone to talk |
| `transfer` | 35 | All of it, plus a composed expression, on an unseen setting |

Hints on two of the five (20 / 15). Opening both still leaves 165 of 200.

## The one that is not obvious

If every party adds `c` to its own share, the shares now sum to **`x + n*c`**. Exactly one party
folds the constant in.

This wrong version is worth dwelling on because of how well it hides:

- at `n = 1` it is **indistinguishable** from correct;
- for larger `n` it is off only by a multiple of `c`, so a test on one fixed setting can pass it by
  luck.

The hidden tests run four settings, all with `n ≥ 2`, and name the `x + n*c` result explicitly so
it cannot slip through as a coincidence.

The intuition being corrected is "it is linear, so everyone does the same thing". That is right
for three of the four operations and wrong for this one.

## Why the classification is graded 0-versus-non-zero

`no-communication` does not ask for an exact round count. How many rounds a multiplication
protocol takes depends on the protocol; **whether it has to communicate at all** does not. The
scoring only bets on the part that is settled.

## Where this leads

The boundary you draw here is the motivation for the next problem. If multiplication is the only
operation that needs to talk, the natural question is whether that talking can be moved into
preprocessing — which is exactly what a Beaver triple does.

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

`make reference-test` runs the mutation suite: six broken submissions plus one aimed at the
verifier. Two of them are the near-miss forms of the constant trap — folding into every share, and
folding into two shares — because a test that only catches the first would still pass the second.
