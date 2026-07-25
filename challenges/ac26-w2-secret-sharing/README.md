# Split it, and still nobody knows

> This track is an independent, unofficial companion to the Advanced Cryptography Program 2026.
> It is not affiliated with or endorsed by the course or its operators. All problem statements,
> code, fixtures, and figures here are written independently. Questions about this track go to
> the TenkaCloud repository, not to the course operators.

**Track:** `advanced-cryptography-2026` · **Order:** 210 · **Chapter:** Week 2 / Additive Secret
Sharing · **Role:** `mechanism` · **Time:** 40–60 minutes · **Points:** 200
· **Status:** draft — see "Week 2 alignment" below

## The story

Five auditors need to compute a total across their books without any of them learning another's
figures. The plan on the whiteboard is simple enough: each number gets split into pieces, one per
auditor, and only the pieces added together mean anything.

Somebody has already written the split. It adds up correctly. It is also, as written, useless —
and the difference between "adds up correctly" and "keeps a secret" is the whole of this problem.

## The idea

Additive sharing over `F_p`: a secret `s` becomes `n` values summing to `s`. The arithmetic is
three lines. What makes it cryptography is that **any n-1 of those values are independent of the
secret** — and that is a claim you demonstrate, not one you assert.

## How to play

```bash
make inspect            # your setting, and what n-1 parties see between them
make test               # public tests
make reset              # restore starter/sharing.py
```

You edit one file, `local/starter/sharing.py`: `share()` · `reconstruct()` ·
`complete_shares()` · `rerandomize()`.

## Scoring

Five checkpoints, scored independently. Wrong answers cost 10 points each.

| Checkpoint | Points | What is checked |
|---|---:|---|
| `share-and-reconstruct` | 50 | Round trip across four settings, **and** the split is not trivial |
| `hides-the-secret` | 45 | Your completion works for **every** secret in the field |
| `threshold` | 45 | How many shares are needed, plus two witnesses |
| `rerandomize` | 30 | Secret preserved, every share moved |
| `transfer` | 30 | All of it, on a modulus and party count from an unseen seed |

Hints on three of the five (20 / 20 / 15). Opening every one still leaves 145 of 200.

## The two checkpoints that carry the problem

**`hides-the-secret`** sweeps the entire field. If, holding the same n-1 shares, you can produce a
consistent final share for *every* secret, then those n-1 shares are not evidence about the
secret. That is an executable definition of "it does not leak", and it beats any amount of prose.

**`threshold`** will not accept a number. You submit the count *and* two different secrets that
are both consistent with the same n-1 shares. Guessing the number is easy; building two witnesses
is not.

## What the public tests do not tell you

They check the round trip. They never ask whether a partial set hides anything — so the trivial
split (hand the secret to party 0, give everyone else zero) passes them cleanly while party 0
knows everything from the start. The hidden tests reject that case by name.

## Week 2 alignment

Week 2's material was **not published upstream** at the commit `curriculum.md` records. This
problem therefore pins `week2/README.md` with `kind: "placeholder"` — a record of the *absence* of
material at that commit, not an alignment to it. `status` stays `draft`.

That pin is what lets `bun run course:drift` report `PUBLISHED` rather than `DRIFT` the day the
material appears; the Week 2 course-sync issue then reconciles the planned row and this problem's
alignment before it leaves draft.

## Cost

Zero. No cloud account, no AWS resources.

## For authors

`make reference-test` runs the mutation suite: six broken submissions plus one aimed at the
verifier. One of them — `reconstruct` forgetting the modulus — **survived the first version of the
hidden tests**, because `check_roundtrip` was normalizing the learner's answer before comparing
it. The check now requires the canonical element. That is the mutation suite doing its job on the
tests rather than on the submission.
