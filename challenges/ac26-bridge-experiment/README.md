# Predict, then run

> This track is an independent, unofficial companion to the Advanced Cryptography Program 2026.
> It is not affiliated with or endorsed by the course or its operators. All problem statements,
> code, fixtures, and figures here are written independently. Questions about this track go to
> the TenkaCloud repository, not to the course operators.

**Track:** `advanced-cryptography-2026` · **Order:** 10 · **Chapter:** Bridge 0 / Experimental Workflow
· **Role:** `diagnostic` · **Time:** 20–30 minutes · **Points:** 100
· **Required first:** nothing. This is the first problem in the track.

## The story

There is no cryptography in this problem, and that is the point.

Everything later in this track asks you to do three things at once: say what a computation will
do before you run it, read a trace and name where it first went wrong, and write something that
holds for parameters you were never shown. Doing all three for the first time *while also* meeting
your first constraint system is how a good afternoon turns into a bad one.

So here they are on their own, on a subject small enough to work out on paper: a counter that
advances by a fixed step and is kept inside a window.

## What gets deployed

One container. No AWS account, no cloud resources, nothing to install. The container holds this
deployment's numbers — derived from a per-deploy `FLAG_SEED`, so they are not the same as anyone
else's — and the `counter` command you play it with. The only published port is a loopback
`/verify` the platform posts your flag to; you never touch it yourself.

## How to play

Start the problem in the portal and **attach the container terminal**. Everything happens there,
one line at a time. There is no file to edit, no editor to open, and nothing to clone.

```bash
counter                 # the list of commands
counter show            # the subject, your numbers, and the exact command for each stage
counter predict <number>
counter locate <index>
counter rule "<expression>"
counter transfer predict=<number> locate=<index>
counter status          # what you have cleared
counter flag            # TC{...}, once all four are cleared
```

`python /problem/counter.py <command>` is the same thing, if you prefer to see where it lives.

`counter show` is written to be the only thing you have to read. If you lose your place, run it
again.

### The subject

```text
one round:  value <- value + step, brought back into the window [0, modulus)
the promise: every value the counter takes is inside [0, modulus)
```

That single promise is what all four stages are about.

### `predict` — say it before you look

Work out on paper where the counter stands after its last round, then submit it. **The trace is
printed once the prediction is right, and not before.** A wrong prediction gets one round worked
out for you — enough to find where your arithmetic and the counter's part company, not enough to
skip the rest. A number copied out of an answer measures nothing, which is the whole reason the
order matters.

### `locate` — where it FIRST broke

The trace `counter show` prints came out of a different, broken implementation. Say which entry is
the **first** one outside `[0, modulus)`. Entries are numbered from 0.

That trace leaves the window more than once, on purpose. If it left only once, "the first entry
that breaks the promise" and "the entry that breaks the promise" would be the same question — see
the note in *For authors* about how that was caught.

### `rule` — one line, for parameters you cannot see

Write an expression that gives the final value, using the names `start`, `step`, `rounds`,
`modulus` and the operators `+ - * % ( )`.

```bash
counter rule "<expression>"
```

Quote it — `*` is a shell glob. It is graded by **agreeing with the counter over a family of
parameter sets**, not by matching the case you were shown: that case is satisfied by writing its
answer down as a constant. The family carries a step that runs backwards, a step of zero, a step
larger than the modulus, a start already outside the window, and no rounds at all.

Any expression that agrees is accepted. There is no single spelling being looked for.

### `transfer` — the same readings, running backwards

Once the first three are cleared, `counter show` prints a fourth case: the same counter, with the
step running the other way. Predict it and locate the first break in its trace, both on one line.

It is deliberately not a new kind of question. What is being looked for is whether the reading
survives different parameters — not whether you learned a fifth thing.

## Scoring

| | |
|---|---:|
| Correct flag | **100** |
| Wrong answer | −5 each |
| Hint 1 | −20 |
| Hint 2 | −30 |

Opening both hints still leaves 50 of 100. The flag is a `TC{...}` derived from this deployment's
seed: there is nothing to memorise from someone else's run and nothing to guess.

## Progress is kept in the container

`counter status` reads a file under `/tmp`, which is the only writable path in the container
(everything else is mounted read-only). Recreating the container starts the four stages over. Once
you know the readings they take a couple of minutes to redo, and a durable volume would be one
more thing that can be wrong.

## Relationship to the official course

This is a `diagnostic`: it runs **before** the course material rather than alongside it, and it
gates the track rather than accompanying a particular week. That is also why it pins no upstream
`sources` — there is no specific lecture or exercise it is written against, and inventing a commit
SHA to fill the field would be worse than leaving it empty (`CATALOG.md` §`courseAlignment`).

No expression, fixture, or solution from the course is reproduced here; there is no cryptography
in this problem at all. See `GOVERNANCE.md` §2 and §4.

## Assurance scope

Local mode is **self-paced, honor-system verification**. You own the machine, the Docker daemon,
and the image, so nothing inside that image is hidden from you. Be specific about what that means
here:

- `FLAG_SEED` is in the container's environment and the flag is derived from it, so the flag can
  be computed without clearing any stage.
- `fixtures/generate.py` — in the image, because `counter show` is rendered from it — computes the
  honest trace and the first break. Reading it hands you three of the four answers.

The four stages are a sequence to walk, not a lock to pick, and skipping them cheats nobody but
you. What the `author` stage split does buy is narrower: the reference answers and the suite that
grades them are not in the image you run, so you do not have to avert your eyes from a file that
solves the problem for you. What the seed buys is real: the numbers and the flag come from this
deployment, so an answer memorised from someone else's run does not carry. And the grading is
structural rather than a stored string — `counter rule` accepts any expression that agrees with
the counter, including ones nobody has written before.

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
catalog kills every broken version, and drives the CLI to check both gates: the transfer case is
neither shown nor accepted until the first three stages are cleared, and the flag is released for
exactly one of the sixteen progress states.

That suite is also what shaped the problem. The broken trace originally left the window once, and
breaking the judge's "is it the **first** entry" requirement changed no verdict — the checkpoint
was asking a question it could not grade. The trace now breaks twice.
