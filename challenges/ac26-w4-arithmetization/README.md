# Turning it into a polynomial is not a proof

> This track is an independent, unofficial companion to the Advanced Cryptography Program 2026.
> It is not affiliated with or endorsed by the course or its operators. All problem statements,
> code, fixtures, and figures here are written independently. Questions about this track go to
> the TenkaCloud repository, not to the course operators.

**Track:** `advanced-cryptography-2026` · **Order:** 410 · **Chapter:** Week 4 / Arithmetization
Bridge · **Role:** `transfer` · **Time:** 60–90 minutes · **Points:** 300
· **Status:** draft — see "Week 4 alignment"

## The story

Proving that a program ran does not put the program into the proof. The execution becomes a
table, the table's rules become polynomial relations, and the claim becomes "these relations
vanish on these points".

The machine is two columns and two rules:

```text
a_{i+1} = a_i + b_i
b_{i+1} = b_i + weight*a_i     (mod p)
```

The computation is not the point. The translation is.

## Two kinds of constraint, two different jobs

**Transition** constraints say each row follows from the one before it.
**Boundary** constraints say where the machine started. Neither implies the other.

Drop the boundary and the system is perfectly satisfied by a trace of the same machine started
from **somewhere else**. Every transition holds. Every residual is zero. The polynomials are
just as valid — and they are a proof of a different statement.

The `underconstrained` checkpoint has you build exactly that trace. It is what "dropping one
constraint" concretely means.

## How to play

```bash
make inspect            # the machine, the trace, and each row's domain point
make test               # public tests
make reset              # restore starter/air.py
```

You edit one file, `local/starter/air.py`.

## Scoring

Eight checkpoints, scored independently. Wrong answers cost 15 points each.

| Checkpoint | Points | What is checked |
|---|---:|---|
| `trace` | 30 | The trace the machine actually produces |
| `transition` | 40 | One residual per adjacent pair, zero on honest, first non-zero at the tamper |
| `boundary` | 30 | Zero on honest, non-zero when the start moves |
| `interpolate` | 45 | Agrees with the column on the domain, and is a polynomial off it |
| `compose` | 40 | The relation still vanishes when read through the polynomials |
| `locate` | 40 | The first wrong row, and which kind of constraint broke |
| `underconstrained` | 45 | A different trace satisfying every transition constraint |
| `transfer` | 30 | All of it under a field, length and weight you have not seen |

Hints on five of the eight, each inside that checkpoint's 50% cap.

## Details that decide whether an implementation is right

**How many residuals.** One per adjacent row pair — one fewer than the number of rows. One per
row means the last row is being compared against a next row that does not exist. That mutation
dies with an `IndexError`.

**Which row a violation belongs to.** The i-th transition produces row `i+1`, so row `i+1` is the
first row that is wrong. Reporting `i` sends the reader one row away from the problem.

**Row 0 has no predecessor.** The only thing that can break there is the boundary. Calling it a
transition failure points at the wrong place, which is why the boundary is checked first.

## The evaluation domain

The domain is the powers of a root of unity, with row `i` at point `g^i`, so consecutive rows are
consecutive points and the transition constraint becomes a relation between a polynomial at `x`
and the same polynomial at the next point. The primes are chosen so that `steps` divides `p-1` —
otherwise no root of unity of that order exists at all.

## This is not a proof system

No commitment. No verifier randomness. Therefore no soundness against anybody. This is a bridge
to arithmetization, not past it. Calling what you build here "a small SNARK" is the opposite of
what the problem is for.

## Week 4 alignment

Week 4's material was not published upstream at the pinned commit. `courseAlignment` pins
`week4/README.md` with `kind: "placeholder"` and takes the `transfer` role — one of the two
`GOVERNANCE.md` §6 permits for an unpublished week, and accurate besides, since the problem
transfers Week 1's constraints and Week 3's field into a new setting. It asserts nothing about
what the official exercise will require. #229 reconciles the row when the material appears.

## Cost

Zero. No cloud account, no AWS resources.

## For authors

`make reference-test` runs the mutation suite: nine broken implementations. The two worth reading
are "checks only the last transition" and "drops the boundary constraints" — both produce a system
that looks complete and accepts traces that are not the computation.
