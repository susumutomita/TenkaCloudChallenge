# It passes, but it does not protect

> This track is an independent, unofficial companion to the Advanced Cryptography Program 2026.
> It is not affiliated with or endorsed by the course or its operators. All problem statements,
> code, fixtures, and figures here are written independently. Questions about this track go to
> the TenkaCloud repository, not to the course operators.

**Track:** `advanced-cryptography-2026` · **Order:** 120 · **Chapter:** Week 1 / Underconstraint
· **Role:** `assignment-companion` · **Time:** 60–90 minutes · **Points:** 300
· **Required first:** `ac26-w1-constraint-lab`

## The story

The privacy-preserving credential circuit was two days from production when the audit came back.
Nothing dramatic: ordinary holders are judged correctly, revoked ones are refused, the numbers all
line up. But somewhere in the report is a sentence nobody can dismiss — *a forged witness may be
able to walk around the condition entirely.*

Somebody has to build the circuit the policy actually wanted, find the gap, prove it is real, and
close it without breaking anyone's legitimate access. That is your afternoon.

## The policy

```text
grant access iff the revocation counter is zero AND the issuer is recognised
```

A circuit has no comparisons. "Is this signal zero?" is a **claim you constrain**, using a helper
signal `inv` that the prover supplies:

```text
iszero_a:  value * inv + out - 1 = 0
iszero_b:  value * out           = 0
```

Both are needed. Each alone is satisfiable with a lie — and *which* lie depends on which one you
keep. The deployed circuit is missing one of them, and which one changes with your seed.

## How to play

```bash
make inspect            # policy, deployed circuit, both honest witnesses
make test               # public tests
make reset              # restore starter/policy.py
```

You edit one file, `local/starter/policy.py`, with four functions:
`intended_circuit()` · `audit()` · `forge_witness()` · `repair()`.

## Scoring

Six checkpoints, scored independently. Wrong answers cost 15 points each.

| Checkpoint | Points | What is checked |
|---|---:|---|
| `build` | 60 | Your circuit accepts both honest witnesses and rejects every known forgery |
| `audit` | 50 | You name exactly the missing constraint, and report none on a complete circuit |
| `exploit` | 60 | Your witness satisfies the deployed circuit and fails the intended one |
| `root-cause` | 40 | Missing constraint id + the signals you manipulated, as JSON |
| `repair` | 50 | Forgery rejected, both honest cases still accepted, no constraint bloat |
| `mutation-transfer` | 40 | Audit and forgery both work when a *different* constraint is missing |

Hints on four of the six (20 / 25 / 20 / 15). Opening every one still leaves 220 of 300.

## What "exploit" means here, precisely

A forged witness must **satisfy the deployed circuit and fail the intended one**. That structural
definition is the whole point: it is what "the missing constraint was load-bearing" means, and it
works no matter which of the two is gone. It also cannot be satisfied by a lucky guess — a witness
that passes both circuits is claiming nothing false.

## The trap

**The public tests all pass in the starter state.** The starter circuit accepts both honest
witnesses, so every shape check is green. It also has no is-zero gadget at all, which means `ok` —
the flag deciding access — is bound by nothing whatsoever.

That is `misconception.happy-path-proves-soundness` in its natural habitat. Underconstraint does
not break the happy path. That is what makes it dangerous, and why the only way to measure it is
to build a counterexample.

## Relationship to the official Week 1 exercise

This is an `assignment-companion`: it builds the reading and attacking habit the official exercise
needs, using a **different business rule and different signal names**, and stops short of the
exercise's own answer path. No expression, fixture, or solution from the course is reproduced —
see `GOVERNANCE.md` §2 and §4.

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
verifier. Two of them are specifically the failure modes this problem exists to catch — a forgery
hard-coded for one of the two possible drops, and a forgery that satisfies the intended circuit
too, and so demonstrates nothing.
