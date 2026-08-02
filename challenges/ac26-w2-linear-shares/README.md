# What you can do without talking to anyone

> This track is an independent, unofficial companion to the Advanced Cryptography Program 2026.
> It is not affiliated with or endorsed by the course or its operators. All problem statements,
> code, fixtures, and figures here are written independently. Questions about this track go to
> the TenkaCloud repository, not to the course operators.

**Track:** `advanced-cryptography-2026` · **Order:** 220 · **Chapter:** Week 2 / Local Linear
Operations · **Role:** `mechanism` · **Time:** 40–55 minutes · **Points:** 200
· **Required first:** `ac26-w2-secret-sharing` · **Status:** draft — see "Week 2 alignment"

## The story

The auditors' scheme from last time works: numbers get split into one row per party, nobody sees
anyone else's row. Now they actually want to *compute* — sums, weighted totals, a running average.

The obvious worry is that every step needs a meeting. It does not. Most of what they want, each
party can do alone, on its own row, and the rows still add up to the right answer. That is the
only reason the scheme is affordable rather than theoretical.

This morning's figure came out wrong. The pipeline is unchanged, the inputs are unchanged, and
every step of it is linear. **You are one of the parties**, and you are the one being asked what
the number should have been.

## What gets deployed

One container. No AWS account, no cloud resources, nothing to install. The container holds this
deployment's field, party count, rows and public values — all derived from a per-deploy
`FLAG_SEED`, so they are not the same as anyone else's — and the `shares` command you play it
with. The only published port is a loopback `/verify` the platform posts your flag to; you never
touch it yourself.

## The idea you are here for

A sharing is not a number in disguise. It is **a set of rows that sum to one**. So a party can
add two sharings by adding its own two rows, and scale a sharing by a public value by scaling its
own row, and in both cases the rows still sum to the right thing — with nobody talking.

Adding a **public constant** looks exactly like those and is not one of them. If every party adds
`c` to its own row, the rows sum to `x + n*c`. Exactly one party folds it in.

You are never shown another party's row. That is deliberate: if you can answer a stage at all from
what is on your screen, then the answer came out of one row, which is the whole claim.

## How to play

Start the problem in the portal and **attach the container terminal**. Everything happens there,
one line at a time. There is no file to edit, no editor to open, and nothing to clone.

```bash
shares                     # the list of commands
shares show                # your field, your rows, the pipeline, what the desk published
shares row 641             # YOUR row of the figure, if the pipeline is run correctly
shares total 2123          # what the desk should have published instead
shares silent e1,e4,e5     # the expressions that finish with nobody talking
shares transfer row=12 total=345 silent=g1,g3,g7
shares status              # what you have cleared
shares flag                # TC{...}, once all four stages are cleared
```

`python /problem/shares.py <command>` is the same thing, if you prefer to see where it lives.
python3 is in the container, so the arithmetic is a one-liner if you want it to be:
`python3 -c "print((17 * (984 + 510)) % 4049)"`. The reasoning is the exercise; the multiplication
is not.

### `row` — be a party

`shares show` prints your two rows, the public values `k` and `c`, how many parties there are,
which one you are, and which one folds a public constant in. Work out your own row of the figure
the pipeline produces, run correctly.

### `total` — undo the fault

The desk published a reconstruction from a run whose `addpub` was faulty in a way `shares show`
states outright. Say what it should have published. Everything in the correction is public — what
it costs is knowing exactly how many times the constant was folded in.

### `silent` — classify, do not recognise

Eight expressions over shared values `x, y, z` and public values `k, c`. Name the ones every party
can evaluate on its own rows with nobody talking.

A rejection tells you **how many** are on the wrong side, and not which ones. That is deliberate:
which ones is a map of where the misreading is, and drawing that map is the exercise. It is not a
lock — a count still moves when you change one entry, so a scripted search is possible, and this
is honor-system local play anyway (see Assurance scope).

### `transfer` — at a desk you have not seen

Clearing the three above hands you a second desk. Different prime, different party count, a
pipeline that puts the constant **inside** the scale, you as the designated party rather than an
ordinary one, and a fault that runs the other way: `addpub` never ran at all. So the correction
that worked at the first desk is wrong here, and wrong by a different shape rather than by a
different number. All three readings at once, on one line.

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

`shares status` reads a file under `/tmp`, which is the only writable path in the container
(everything else is mounted read-only). Recreating the container starts the four stages over. Once
you know the answers they take a couple of minutes to redo, and a durable volume would be one more
thing that can be wrong.

## Three ways to be wrong that nothing will catch for you

1. **"It is linear, so everyone does the same thing."** True for adding two sharings and for
   scaling by a public value. False for adding a public constant, and false exactly once.
2. **A public value inside a bracket is still a product of two shared values.** `x*(y + c)` expands
   to `x*y + c*x`. Expand before you count the degree.
3. **A row is a field element.** A subtraction that went negative on the way is not finished until
   it is back in `[0, p)`. `-1` and `p-1` are the same element, and the CLI takes the one in
   range.

## Where this leads

The boundary you draw here is the motivation for the next problem. If multiplying two shared
values is the only operation that needs to talk, the natural question is whether that talking can
be moved into preprocessing — which is exactly what a Beaver triple does.

## Week 2 alignment

Week 2's material was not published upstream at the commit `curriculum.md` records, so
`courseAlignment` pins `week2/README.md` with `kind: "placeholder"`, and `status` stays `draft`.
The pin records the *absence* of material at that commit rather than an alignment to it — which is
what lets `bun run course:drift` report `PUBLISHED` the day the material appears. #219 reconciles
the row before this leaves draft.

## Assurance scope

Local mode is **self-paced, honor-system verification**. You own the machine, the Docker daemon,
and the image, so nothing inside that image is hidden from you. Be specific about what that means
here:

- `FLAG_SEED` is in the container's environment and the flag is derived from it, so the flag can be
  computed without clearing any stage.
- `fixtures/` is in the image, because `shares show` is rendered from it. It carries the desk's
  secrets and the values the stages are graded against, so reading it hands you everything.

The four stages are a sequence to walk, not a lock to pick, and skipping them cheats nobody but
you. What the `author` stage split does buy is narrower: the worked answers and the suite that
grades them are not in the image you run, so you do not have to avert your eyes from a file that
solves the problem for you. What the seed buys is real: the field, the party count, the rows and
the flag come from this deployment, so an answer memorised from someone else's run does not carry.
And the grading is structural rather than a stored string, so it accepts a correct answer it has
never seen.

That supports self-study and honest practice. It does **not** support competition ranking,
examination, or completion certification — those need a verifier the participant does not
administer, tracked in [#271](https://github.com/susumutomita/TenkaCloudChallenge/issues/271).

## Cost

Zero. No cloud account, no AWS resources. A container on your machine.

## For authors

`make play` opens a shell in the participant image, which is what the portal terminal attaches to.
`make test` runs the public self-check (interface properties only — it carries no answer).

`make reference-test` is the real one. It checks the fixture invariants the design rests on, runs
the reference answers across twelve seeds, refuses a catalog of near-miss wrong answers, and then
breaks the judge one requirement at a time to confirm that catalog kills every broken version.
Three invariants exist for specific failure modes: the live participant is never the designated
party and the transfer participant always is (otherwise the transfer stage is the live stage with
different numbers); the two desks are faulty in opposite directions, so the live correction applied
at the second desk is always wrong; and every expression's declared locality is rechecked by
sampling `f(u+v) - f(u) - f(v) + f(0)` over the field, because a syntactic degree count disagrees
with the truth on expressions like `x*y - x*y` and the judge and the answer both come from that
same declaration.
