# A set of things that must be zero

> This track is an independent, unofficial companion to the Advanced Cryptography Program 2026.
> It is not affiliated with or endorsed by the course or its operators. All problem statements,
> code, fixtures, and figures here are written independently. Questions about this track go to
> the TenkaCloud repository, not to the course operators.

**Track:** `advanced-cryptography-2026` · **Order:** 110 · **Chapter:** Week 1 / Arithmetic
Circuits · **Role:** `mechanism` · **Time:** 45–60 minutes · **Points:** 200
· **Recommended first:** `ac26-bridge-experiment`, `ac26-bridge-properties`

## The story

The new policy engine does not decide access with if-statements. It expresses the decision as an
arithmetic circuit, so that every decision can be audited afterwards by anyone, without trusting
the service that made it.

Which is excellent, except that the monitor prints one word: `PASS` or `FAIL`. A request came back
refused this morning, the customer wants to know which condition they failed, and nobody in the
room can answer. You are finishing the audit tooling — and the part that is missing is the part
that says *why*.

## What gets deployed

One container. No AWS account, no cloud resources, nothing to install. The container holds this
deployment's field and circuits — derived from a per-deploy `FLAG_SEED`, so they are not the same
as anyone else's — and the `audit` command you play it with. The only published port is a loopback
`/verify` the platform posts your flag to; you never touch it yourself.

## The idea you are here for

A circuit is not a program. It is **a set of expressions that must all equal zero**. A witness is
just an assignment of a value to each signal. "This witness satisfies the circuit" means every
residual is zero — and the residual is what tells you *which* claim failed when one does.

Every residual is an element of `F_p`. `-1` and `p-1` are the same element, and neither of them
is zero.

## How to play

Start the problem in the portal and **attach the container terminal**. Everything happens there,
one line at a time. There is no file to edit, no editor to open, and nothing to clone.

```bash
audit                    # the list of commands
audit show               # your field, the circuit, a witness that satisfies it, one that does not
audit explain c2         # one constraint's residual, with its operands named
audit trace 0,3,125,0,0  # every residual of the refused witness, in circuit order
audit admit "(tier - 3)*(tier - 40)"
audit transfer 0,56,89,0,0,64
audit status             # what you have cleared
audit flag               # TC{...}, once all three stages are cleared
```

`python /problem/audit.py <command>` is the same thing, if you prefer to see where it lives.

### `trace` — be the evaluator

`audit show` prints the circuit, a witness every residual is zero for, and the witness the monitor
refused. Work out the residual of every constraint for the refused one and submit them in circuit
order, each reduced into `[0, p)`.

A rejection tells you **how many** entries are not the residual of their constraint, and not which
ones. That is deliberate: which entries are wrong is a map of where your mistakes are, and drawing
that map is the exercise. It is not a lock — a count still moves when you change one entry, so a
scripted search is possible, and this is honor-system local play anyway (see Assurance scope).
`audit explain <id>` is the help that does not spoil anything: it prints the expression one
constraint requires to be zero, with its operands named and no values.

### `admit` — write a constraint, do not copy one

The circuit has no membership constraint, and the residual table does not have a row for one. It
is the constraint the team has not written yet: a signal `tier` has to be one of the licensed
values. Submit the residual that is zero on exactly those and non-zero on every other element of
the field:

```bash
audit admit "(tier - 3)*(tier - 40)"
```

Quote it — `*` is a shell glob. It is graded by **sweeping the entire field**, not by trying the
licensed values. A gadget that pins only the first licensed value passes every happy-path example
you could write and fails here, which is the point.

### `transfer` — on a circuit you have not seen

Clearing the two above hands you a second circuit, from another tenant. Different prime, different
signal names, one more constraint, a different order — and it carries the membership gadget you
just wrote as a deployed constraint, so reading it means evaluating what you constructed. Same
command shape, nothing carried over but the reading.

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

`audit status` reads a file under `/tmp`, which is the only writable path in the container
(everything else is mounted read-only). Recreating the container starts the three stages over.
Once you know the answers they take a couple of minutes to redo, and a durable volume would be one
more thing that can be wrong.

## Three ways to be wrong that nothing will catch for you

1. **`-1` is not zero, and neither is `p-1`.** They are the same field element. A residual that
   went negative on the way is not finished until it is back in `[0, p)`.
2. **Naming a signal `flag` does not make it a boolean.** Only a constraint binds a value, and it
   is one constraint: `flag * (flag - 1) = 0`. Without it, `flag` can be any element of the field.
3. **One valid witness proves nothing.** An under-constrained circuit still gives every residual
   zero on an honest witness. That is why the gadget is swept over the whole field.

## Relationship to the official Week 1 exercise

This is a `mechanism` problem: it builds the reading skill the official exercise assumes, and
deliberately stops short of it. The official exercise attacks underconstraint; doing that requires
being able to see which condition became which expression, which is the trace you build here. No
expression, fixture, or solution from the course is reproduced — see `GOVERNANCE.md` §2.

## Assurance scope

Local mode is **self-paced, honor-system verification**. You own the machine, the Docker daemon,
and the image, so nothing inside that image is hidden from you. Be specific about what that means
here:

- `FLAG_SEED` is in the container's environment and the flag is derived from it, so the flag can be
  computed without clearing any stage.
- `fixtures/` is in the image, because `audit show` is rendered from it. It carries the evaluator
  the stages are graded against, so reading it hands you every answer.

The three stages are a sequence to walk, not a lock to pick, and skipping them cheats nobody but
you. What the `author` stage split does buy is narrower: the worked solution and the suite that
grades it are not in the image you run, so you do not have to avert your eyes from a file that
solves the problem for you. What the seed buys is real: the field, the circuits and the flag come
from this deployment, so an answer memorised from someone else's run does not carry. And the
grading is structural rather than a stored string, so it accepts a correct answer it has never
seen.

That supports self-study and honest practice. It does **not** support competition ranking,
examination, or completion certification — those need a verifier the participant does not
administer, tracked in [#271](https://github.com/susumutomita/TenkaCloudChallenge/issues/271).

## Cost

Zero. No cloud account, no AWS resources. A container on your machine.

## For authors

`make play` opens a shell in the participant image, which is what the portal terminal attaches to.
`make test` runs the public self-check (interface properties only — it carries no answer).

`make reference-test` is the real one. It checks the fixture invariants the design rests on, runs
the reference answers across seeds covering every break shape in both cases, refuses a catalog of
near-miss wrong answers, and then breaks the judge one requirement at a time to confirm that
catalog kills every broken version. Two of the invariants exist for specific failure modes: the
refused witness always breaks at least two constraints (one non-zero entry among visible zeros is
a guess, not a trace), and the transfer case's refused witness always leaves the `member` or the
`boolean` residual non-zero (otherwise the transfer stage could be answered by copying zeros).
