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
party 0 gets the whole total and everybody else gets zero — and the difference between "adds up
correctly" and "keeps a secret" is the whole of this problem.

## The idea

Additive sharing over `F_p`: a secret `s` becomes `n` values summing to `s`. The arithmetic is
three lines. What makes it cryptography is that **any n-1 of those values are independent of the
secret** — and that is a claim you demonstrate, not one you assert.

## What gets deployed

One container. No AWS account, no cloud resources, nothing to install. It holds this deployment's
ledgers — derived from a per-deploy `FLAG_SEED`, so they are not the same as anyone else's — and
the `shares` command you play it with. The only published port is a loopback `/verify` the
platform posts your flag to; you never touch it yourself.

## How to play

Start the problem in the portal and **attach the container terminal**. Everything happens there,
one line at a time. There is no file to edit, no editor to open, and nothing to clone.

```bash
shares                                  # the list of commands
shares show                             # the subject, your ledgers, what to type next
shares recover <total>
shares complete "<expression>"
shares refresh <o0>,<o1>,...
shares transfer recover=<n> complete=<n> refresh=<o0>,...
shares status                           # what you have cleared
shares flag                             # TC{...}, once all four are cleared
```

`python /problem/shares.py <command>` is the same thing, if you prefer to see where it lives.

`shares show` is written to be the only thing you have to read. If you lose your place, run it
again.

### `recover` — the round trip, and the contrast

Ledger A is on screen with every share the parties hold. Add them up, bring the total back into
`[0, p)`, submit it. This one is easy on purpose: it is here so that a view which fixes the total
exactly and a view one share shorter sit on the same screen.

### `complete` — one line, for numbers you cannot see

Ledger B is a different total with one share missing, and its total is never printed. The question
is **not** what that total is. It is whether, given *any* target at all, you can always choose the
missing share so the ledger lands on it.

```bash
shares complete "<expression>"
```

Names: `target`, `known`, `modulus`. Operators: `+ - * % ( )` and whole numbers. Quote it — `*` is
a shell glob. It is graded by agreeing over a **family** of `(target, known, modulus)`, not by
matching the case you were shown: that case is satisfied by writing its answer down as a constant.

If the rule holds for every target in the field, then those n-1 shares rule out nothing about the
total. That is an executable definition of "it does not leak", and it beats any amount of prose.

`known` — the sum of the visible shares — is handed to you **unreduced**, and is larger than the
modulus. A rule that forgets to bring the result back into the field is therefore wrong on your own
numbers, not just on some edge case.

### `refresh` — the same secret, different shares

One offset per party, added share by share. Two requirements, and one without the other is not a
refresh: the offsets must sum to zero (the total does not move) and **none of them may be zero**
(every share does).

```bash
shares refresh 3,5,9,84,8
```

### `transfer` — the same three, on a setting you have not seen

Once the first three stages are cleared, a second setting arrives: a different modulus, a different
number of parties, a different party missing — and the visible shares are **not pre-summed** for
you this time. That last change is what a transfer is: the same question with one layer of
scaffolding taken away.

## Scoring

| | |
|---|---:|
| Correct flag | **200** |
| Wrong answer | −10 each |
| Hint 1 | −40 |
| Hint 2 | −60 |

Opening both hints still leaves 100 of 200. The flag is a `TC{...}` derived from this deployment's
seed: there is nothing to memorise from someone else's run and nothing to guess.

## Progress is kept in the container

`shares status` reads a file under `/tmp`, the only writable path in the container (everything
else is mounted read-only). Recreating the container starts the four stages over. Once you know
the readings they take a few minutes to redo, and a durable volume would be one more thing that
can be wrong.

## Week 2 alignment

Week 2's material was **not published upstream** at the commit `curriculum.md` records. This
problem therefore pins `week2/README.md` with `kind: "placeholder"` — a record of the *absence* of
material at that commit, not an alignment to it. `status` stays `draft`.

That pin is what lets `bun run course:drift` report `PUBLISHED` rather than `DRIFT` the day the
material appears; the Week 2 course-sync issue then reconciles the planned row and this problem's
alignment before it leaves draft.

## Assurance scope

Local mode is **self-paced, honor-system verification**. You own the machine, the Docker daemon,
and the image, so nothing inside that image is hidden from you. Be specific about what that means
here:

- `FLAG_SEED` is in the container's environment and the flag is derived from it, so the flag can
  be computed without clearing any stage.
- `fixtures/generate.py` — in the image, because `shares show` is rendered from it — builds both
  ledgers. Reading it hands you the totals the stages ask for.

The four stages are a sequence to walk, not a lock to pick, and skipping them cheats nobody but
you. What the `author` stage split does buy is narrower: the reference answers and the suite that
grades them are not in the image you run, so you do not have to avert your eyes from a file that
solves the problem for you. What the seed buys is real: the ledgers, the settings and the flag all
come from this deployment, so an answer memorised from someone else's run does not carry. And the
completion rule is graded structurally — any expression that agrees with the arithmetic over the
whole family is accepted, including ones nobody has written before.

That supports self-study and honest practice. It does **not** support competition ranking,
examination, or completion certification — those need a verifier the participant does not
administer, tracked in [#271](https://github.com/susumutomita/TenkaCloudChallenge/issues/271).

## Cost

Zero. No cloud account, no AWS resources.

## For authors

This problem is played from the container terminal, so it ships nothing for a participant to edit
and sits outside the four-target participant contract in
[`TEMPLATE.md`](../../docs/curricula/advanced-cryptography-2026/TEMPLATE.md) rather than violating
it. The Makefile is an author tool and no participant ever sees it: `make play` opens a shell in
the participant image, which is what the portal terminal attaches to, and `make test` runs the
public self-check (interface properties only — it carries no answer).

`make reference-test` is the real one. It runs the reference answers across eight seeds, refuses a
catalog of near-miss wrong answers, breaks the judge one requirement at a time to confirm that
catalog kills every broken version, sweeps 120 seeds for settings a stage cannot be answered from,
and drives the CLI to check the transfer lock and the sixteen progress states.

Three things that suite decided rather than merely checked:

- **What makes a refresh a refresh lives in `lab/judge.py`, not in `fixtures/`.** The mutation
  suite breaks the judge, so a requirement kept in the fixtures is one it cannot reach — and an
  unreachable requirement is one nothing tests.
- The obvious near misses for the offset count (drop the last offset, append a zero) are caught by
  the *sum* check and the *zero* check, so "one offset per party" survived until the catalog gained
  two perfectly good zero-sharings **for the wrong number of parties**.
- One mutation looked real and was not: `judge_recover` and `judge_transfer_completion` carry a
  textually identical `0 <= claimed < p` guard, and a short mutation pattern hit the first, where
  it is equivalent. The pattern now includes the following line. A surviving mutant is as often a
  mis-aimed mutation as a missing test.
