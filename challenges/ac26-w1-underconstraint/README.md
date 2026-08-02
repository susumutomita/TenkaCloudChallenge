# It passes, but it does not protect

> This track is an independent, unofficial companion to the Advanced Cryptography Program 2026.
> It is not affiliated with or endorsed by the course or its operators. All problem statements,
> code, fixtures, and figures here are written independently. Questions about this track go to
> the TenkaCloud repository, not to the course operators.

**Track:** `advanced-cryptography-2026` · **Order:** 120 · **Chapter:** Week 1 / Underconstraint
· **Role:** `assignment-companion` · **Time:** 45–75 minutes · **Points:** 300
· **Required first:** `ac26-w1-constraint-lab`

## The story

The privacy-preserving credential circuit was two days from production when the audit came back.
Nothing dramatic: ordinary holders are judged correctly, revoked ones are refused, the numbers all
line up. But somewhere in the report is a sentence nobody can dismiss — *a forged witness may be
able to walk around the condition entirely.*

Somebody has to find the gap, prove it is real by walking a lie through it, and close it without
breaking anyone's legitimate access. That is your afternoon.

## What gets deployed

One container. No AWS account, no cloud resources, nothing to install. The container holds this
deployment's circuit — derived from a per-deploy `FLAG_SEED`, so it is not the same as anyone
else's — and the `circuit` command you play it with. The only published port is a loopback
`/verify` the platform posts your flag to; you never touch it yourself.

## How to play

Start the problem in the portal and **attach the container terminal**. Everything happens there,
one line at a time. There is no file to edit, no editor to open, and nothing to clone.

```bash
circuit                 # the list of commands
circuit show            # the policy, your parameters, the deployed circuit, the honest witnesses
circuit check revoked=<n> inv=<n> ok=<n> issuer_ok=<n> granted=<n>
circuit repair "<expression>"
circuit status          # what you have cleared
circuit flag            # TC{...}, once both stages are cleared
```

`python /problem/circuit.py <command>` is the same thing, if you prefer to see where it lives.

### The policy

```text
grant access iff the revocation counter is zero AND the issuer is recognised
```

A circuit has no comparisons and no division. "Is this signal zero?" is a **claim you constrain**,
using a helper signal `inv` that the prover supplies — and it takes two constraints, not one. The
circuit that is deployed has one of them. Which one changes with your deployment.

### `check` — get a lie accepted

A forged witness has to do two things at once:

1. **satisfy the deployed circuit**, so production would have honoured it, and
2. **carry a claim the policy calls false** — the `granted` it asserts differs from what the
   written policy says about that credential.

The second requirement is the one worth stating out loud. "The intended circuit rejects my
witness" is not an exploit: with one of the two constraints gone, an honest witness with a garbage
`inv` already does that, and claims nothing false at all. A counterexample is worth something
because a *lie* got through, not because something rejected it.

`check` prints every residual of the deployed circuit for your witness, so a rejection tells you
which constraint you tripped over.

### `repair` — close it without causing an outage

Submit the missing constraint as the residual that must come out zero, written with signal names:

```bash
circuit repair "a*b + c - 1"
```

Quote it — `*` is a shell glob. Three things are checked:

- **exactly one constraint.** One was removed, so one goes back. Adding the whole gadget on top of
  the half that is already there is a rewrite, not a repair, and every extra constraint is another
  way to deny an honest holder.
- **both honest witnesses still accepted.** A repair that denies a legitimate holder is an outage.
- **the repaired circuit accepts the same witnesses the policy does** — checked over a family of
  witnesses built around your parameters, not just against the two happy paths and your own
  forgery. Both directions matter: too weak and a lie still gets through, too strict and an honest
  prover is refused.

That last one is the interesting check. A repair can keep both honest witnesses, block every lie,
and still be wrong — see the writeup after you solve it.

## Scoring

| | |
|---|---:|
| Correct flag | **300** |
| Wrong answer | −15 each |
| Hint 1 | −60 |
| Hint 2 | −90 |

Opening both hints still leaves 150 of 300. The flag is a `TC{...}` derived from this deployment's
seed: there is nothing to memorise from someone else's run and nothing to guess.

## Progress is kept in the container

`circuit status` reads a file under `/tmp`, which is the only writable path in the container
(everything else is mounted read-only). Recreating the container starts the two stages over. Once
you know the answer they take seconds to redo, and a durable volume would be one more thing that
can be wrong.

## Relationship to the official Week 1 exercise

This is an `assignment-companion`: it builds the reading and attacking habit the official exercise
needs, using a **different business rule and different signal names**, and stops short of the
exercise's own answer path. No expression, fixture, or solution from the course is reproduced —
see `GOVERNANCE.md` §2 and §4.

## Assurance scope

Local mode is **self-paced, honor-system verification**. You own the machine, the Docker daemon,
and the image, so nothing inside that image is hidden from you. Be specific about what that
means here, because it is more than usual:

- `FLAG_SEED` is in the container's environment and the flag is derived from it, so the flag can
  be computed without clearing either stage.
- `fixtures/generate.py` — in the image, because `circuit show` is rendered from it — states the
  circuit the policy intends, which is the deployed circuit plus the constraint that was removed.
  Reading it hands you both answers.

The two stages are a sequence to walk, not a lock to pick, and skipping them cheats nobody but
you. What the `author` stage split does buy is narrower: the worked solution and the suite that
grades it are not in the image you run, so you do not have to avert your eyes from a file that
solves the problem for you. What the seed buys is real: the circuit and the flag come from this
deployment, so an answer memorised from someone else's run does not carry. And the grading is
structural rather than a stored string, so it accepts a correct answer it has never seen.

That supports self-study and honest practice. It does **not** support competition ranking,
examination, or completion certification — those need a verifier the participant does not
administer, tracked in [#271](https://github.com/susumutomita/TenkaCloudChallenge/issues/271).

## Cost

Zero. No cloud account, no AWS resources.

## For authors

`make play` opens a shell in the participant image, which is what the portal terminal attaches to.
`make test` runs the public self-check (interface properties only — it carries no answer).

`make reference-test` is the real one. It runs the reference answers across seeds covering both
possible drops, refuses a catalog of near-miss wrong answers, and then breaks the judge one
requirement at a time to confirm that catalog kills every broken version. Two entries in the
catalog exist for specific failures this problem is about: a witness that satisfies the deployed
circuit while asserting nothing false, and a repair that keeps both honest witnesses, blocks every
lie, and still pins a signal the policy leaves free.
