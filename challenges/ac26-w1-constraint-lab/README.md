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

Which is excellent, except that the monitor prints one line: `PASS` or `FAIL`. When a request is
denied and someone asks *why*, nobody can answer. You are finishing the audit tooling.

## The idea you are here for

A circuit is not a program. It is **a set of expressions that must all equal zero**. A witness is
just an assignment of a value to each signal. "This witness satisfies the circuit" means every
residual is zero — and the residual is what tells you *which* claim failed when one does.

Five constraint kinds, all evaluated over `F_p`:

```text
mul      left * right - out
add      left + right - out
const    signal - value
boolean  signal * (signal - 1)
member   product over allowed of (signal - a)
```

## How to play

Start the problem from Participant Portal. The three-file editor appears on the same page.
Inspect the evidence, edit the files, run the public tests, and submit residuals / boolean /
membership / transfer there. The first-broken answer is the first violated
constraint's id **and its non-zero residual**, read from the broken witness's trace and entered as
JSON in the Portal. No host terminal or checkout editing is required.

Only when authoring or verifying straight from the repository, run these in the problem directory:

```bash
make inspect              # your field, circuit, honest witness, broken witness
make test                 # public tests
make test-one ID=trace    # iterate on one of them
make reset                # restore all three starter files
```

In the Portal editor or author checkout you edit three files: `local/starter/field.py` (arithmetic in
`F_p`), `local/starter/circuit.py` (residuals and traces), `local/starter/gadgets.py` (turning a
condition into constraints).

## Scoring

Five checkpoints, scored independently. Wrong answers cost 10 points each.

| Checkpoint | Points | What is checked |
|---|---:|---|
| `residuals` | 45 | Your evaluator over three different primes, shuffled order, missing signals |
| `first-broken` | 40 | `{ "constraintId": ..., "residual": ... }` for the first violation |
| `boolean` | 40 | Your boolean gadget, swept over **every** element of the field |
| `membership` | 35 | Your membership gadget, swept over the field, for allowed sets of size 1–5 |
| `transfer` | 40 | All three files, against a field and circuit from a seed you never see |

Hints on four of the five (15 / 15 / 10 / 10). Opening every one still leaves 150 of 200.

## Three ways to be wrong that the public tests will not catch

1. **`-1` is not zero, and neither is `p-1`.** They are the same field element. An evaluator that
   returns the raw subtraction looks right until an intermediate value goes negative.
2. **Naming a signal `flag` does not make it a boolean.** Only a constraint binds a value. This is
   why the boolean checkpoint sweeps the whole field rather than trying `2` — a test that only
   tries `2` passes an implementation that merely checks `b < 2`.
3. **One valid witness proves nothing.** An under-constrained circuit still gives every residual
   zero on an honest witness. A membership gadget that pins only `allowed[0]` passes whenever the
   visible example happens to use that value.

## Relationship to the official Week 1 exercise

This is a `mechanism` problem: it builds the reading skill the official exercise assumes, and
deliberately stops short of it. The official exercise attacks underconstraint; doing that requires
being able to see which condition became which expression, which is the trace you build here. No
expression, fixture, or solution from the course is reproduced — see `GOVERNANCE.md` §2.

## Assurance scope

Local mode is **self-paced, honor-system verification**. Someone who owns the Docker daemon and
every container in the compose stack cannot be prevented from inspecting hidden material. The
boundary here is misdelivery, not confidentiality against that person: the Workbench container
you build and run carries the starter and the public tests only — no fixtures, no hidden tests,
no reference solution, no verifier. Those live only in a second, unpublished container the
Workbench reaches over the compose network, and in the author-only image `make reference-test`
builds.

What the verifier does guarantee is narrower and real: a submission cannot hang or crash it,
a checkpoint can only credit the id it echoes, results do not leak expected values, and the
fixtures come from this deployment's seed so a memorized answer does not carry.

That supports self-study and honest practice. It does **not** support competition ranking,
examination, or completion certification — those need a verifier the participant does not
administer, tracked in [#271](https://github.com/susumutomita/TenkaCloudChallenge/issues/271).

## Cost

Zero. No cloud account, no AWS resources. A container on your machine.

## For authors

`make reference-test` runs the mutation suite: six broken submissions plus one aimed at the
verifier, all of which must be caught. Both the position and residual of the broken constraint are
seed-derived, so neither a constraint-name guess nor a two-choice answer carries across deploys.
