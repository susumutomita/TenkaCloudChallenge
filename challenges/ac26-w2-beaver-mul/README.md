# Multiplication is the one that has to talk

> This track is an independent, unofficial companion to the Advanced Cryptography Program 2026.
> It is not affiliated with or endorsed by the course or its operators. All problem statements,
> code, fixtures, and figures here are written independently. Questions about this track go to
> the TenkaCloud repository, not to the course operators.

**Track:** `advanced-cryptography-2026` · **Order:** 230 · **Chapter:** Week 2 / Beaver Triples
· **Role:** `mechanism` · **Time:** 45–60 minutes · **Points:** 200
· **Required first:** `ac26-w2-linear-shares` · **Status:** draft — see "Week 2 alignment"

## The story

The auditors can now add, scale, and combine their split-up figures without ever meeting. One
thing still defeats them: multiplying two numbers that are *both* split. Every attempt turns into
"well, first you tell me yours", which is the thing they built the scheme to avoid.

Someone points out that the hard part does not depend on the numbers. You can grind out the
awkward material in advance — the week before, overnight, whenever — and then the meeting itself
is short.

Last night's run came out wrong, and it is the last term of four that did it. **You are one of
the parties**, and you are the one being asked what the product actually is.

## What gets deployed

One container. No AWS account, no cloud resources, nothing to install. The container holds this
deployment's field, party count, rows and triple — all derived from a per-deploy `FLAG_SEED`, so
they are not the same as anyone else's — and the `beaver` command you play it with. The only
published port is a loopback `/verify` the platform posts your flag to; you never touch it
yourself.

## The construction

A preprocessed triple `(a, b, c)` with `c = a*b`, shared out ahead of time and independent of
both inputs:

```text
d = X - a      e = Y - b        each party, on its own two rows
open d, open e                  one round: everybody broadcasts both rows, everybody adds up
X*Y = c + d*b + e*a + d*e
```

Three of those four terms are linear in the shares, so each party computes its own row. **The
fourth is not a sharing at all.** Once `d` and `e` are open, `d*e` is a public scalar — and a
public scalar is folded in by exactly one party. If every party adds it, the rows sum to
`X*Y + (n-1)*d*e`.

You are shown your own row of `a` and no other. That is deliberate, and it is checkable: `x = d +
a` needs the whole of `a`, so "publishing `d` reveals nothing about `x`" is a fact about what is
on your screen rather than something you are asked to believe.

## How to play

Start the problem in the portal and **attach the container terminal**. Everything happens there,
one line at a time. There is no file to edit, no editor to open, and nothing to clone.

```bash
beaver                     # the list of commands
beaver show                # your five rows, the protocol, the broadcasts, what was published
beaver open 1234,567       # the two values the round makes public
beaver row 890             # YOUR row of the product, assembled correctly
beaver product 123         # what the desk should have published instead
beaver transfer open=12,34 row=56 product=78
beaver status              # what you have cleared
beaver flag                # TC{...}, once all four stages are cleared
```

`python /problem/beaver.py <command>` is the same thing, if you prefer to see where it lives.
python3 is in the container, so the arithmetic is a one-liner if you want it to be:
`python3 -c "print((1234 * 567) % 4013)"`. The reasoning is the exercise; the multiplication is
not.

### `open` — the one round

`d` and `e` are sharings, so a party's row of each is one row minus one row, and opening means
adding up everybody's. `beaver show` prints every other party's broadcast and not yours, because
computing yours is the local step this stage is about.

### `row` — the linear combination, and the term that is not

Assemble your own row of `X*Y`. Three of the four terms are your own row of something; the fourth
is a public scalar, and `beaver show` says which party folds it in.

### `product` — undo the fault

The desk published a reconstruction from a run that mishandled that scalar in a way `beaver show`
states outright. Say what the product actually is. Everything in the correction is public: the two
opened values and the party count.

### `transfer` — on a multiplication you have not seen

Clearing the three above hands you a second run. Different prime, different party count, you as
the designated party rather than an ordinary one, and a fault that goes the other way: nobody
folded the scalar in. So the correction that worked on the first one is wrong here, and wrong by a
different shape rather than by a different number. All three readings at once, on one line.

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

`beaver status` reads a file under `/tmp`, which is the only writable path in the container
(everything else is mounted read-only). Recreating the container starts the four stages over. Once
you know the answers they take a couple of minutes to redo, and a durable volume would be one more
thing that can be wrong.

## Three ways to be wrong that nothing will catch for you

1. **`d*e` is not a sharing.** It looks like the other three terms and it is a public scalar.
   Exactly one party folds it in.
2. **Preprocessing does not buy silence.** One Beaver multiplication costs one round, not zero. A
   circuit of multiplicative depth D costs D rounds, which is why MPC latency tracks depth rather
   than gate count.
3. **A row is a field element.** `X - a` goes negative on the way. Bring it back into `[0, p)`;
   `-1` and `p-1` are the same element, and the CLI takes the one in range.

## Where this leads

With multiplication in hand, any arithmetic circuit can be evaluated under MPC. What is left is
which openings leak what, and that is the last two problems of Week 2.

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
- `fixtures/` is in the image, because `beaver show` is rendered from it. It carries the secrets,
  the whole triple and the values the stages are graded against, so reading it hands you
  everything.

The four stages are a sequence to walk, not a lock to pick, and skipping them cheats nobody but
you. What the `author` stage split does buy is narrower: the worked answers and the suite that
grades them are not in the image you run, so you do not have to avert your eyes from a file that
solves the problem for you. What the seed buys is real: the field, the party count, the triple and
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
Four invariants exist for specific failure modes: Beaver's identity actually reconstructs to `X*Y`
from the rows the participant is handed (otherwise the `row` stage asks for a number that is not
part of anything); neither opening is ever zero, because a zero `d` or `e` makes `d*e` vanish and
the wrong way of folding it in indistinguishable from the right one; the two openings are never
equal, because otherwise `beaver open e,d` would pass a transposition; and the live participant is
never the designated party while the transfer participant always is, so neither `row` answer can
be reached by repeating the other.
