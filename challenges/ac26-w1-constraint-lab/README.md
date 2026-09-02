# A set of things that must be zero

> This track is an independent, unofficial companion to the Advanced Cryptography Program 2026.
> It is not affiliated with or endorsed by the course or its operators. All problem statements,
> code, fixtures, and figures here are written independently. Questions about this track go to
> the TenkaCloud repository, not to the course operators.

**Track:** `advanced-cryptography-2026` · **Order:** 110 · **Chapter:** Week 1 / Arithmetic
Circuits · **Role:** `mechanism` · **Time:** 60–90 minutes · **Points:** 200
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
membership / range there. The first-broken answer is the first violated
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
| `residuals` | 45 | Your evaluator over three hidden primes, a six-constraint circuit using all five kinds, handed over in a seed-derived order; residual rows on a broken witness; missing signals |
| `first-broken` | 40 | `{ "constraintId": ..., "residual": ... }` for the first violation in the public broken witness |
| `boolean` | 35 | Your boolean gadget, swept over **every** element of the field by the reference evaluator |
| `membership` | 30 | Your membership gadget, swept over the field, for allowed sets of size 1–5 |
| `range` | 50 | Your `range_constraints` / `range_witness`: every in-range value passes with your own witness, and the set of values the gadget admits under *any* assignment of your auxiliary signals is computed exactly and must be 0 .. 2^bits − 1 and nothing else — on widths 1–2, 3–4 and 5–6 bits |

Hints on four of the five (15 / 15 / 10 / 10 + 10). Opening every one still leaves 140 of 200.

The three gadget checkpoints are judged by the hidden checker's **reference evaluator**, which
knows exactly the five documented kinds. The participant's own `evaluate` is never consulted for
a gadget, so a kind it alone understands does not pass. The range gadget may use only `boolean` /
`add` / `mul` / `const`, at most 5 × bits constraints: listing 2^bits values with `member` fails
the kind rule, spelling the product out by hand fails the budget from 3 bits up, and a hard-coded
width fails on the other widths. Out-of-range rejection is decided by computing the set of values
the gadget admits — every solution of its constraints is enumerated, branching at the boolean-pinned
signals and propagating `add` / `mul` / `const` in closed form, so every field element outside the
range is covered and never a sample of them (a 200k-assignment budget per width; exceeding it is a
deterministic message) — not by trusting the witness function.

## Four ways to be wrong that the public tests will not catch

1. **`-1` is not zero, and neither is `p-1`.** They are the same field element. An evaluator that
   returns the raw subtraction looks right until an intermediate value goes negative.
2. **Naming a signal `flag` does not make it a boolean.** Only a constraint binds a value. This is
   why the boolean checkpoint sweeps the whole field rather than trying `2` — a test that only
   tries `2` passes an implementation that merely checks `b < 2`.
3. **One valid witness proves nothing.** An under-constrained circuit still gives every residual
   zero on an honest witness. A membership gadget that pins only `allowed[0]` passes whenever the
   visible example happens to use that value.
4. **A range gadget that accepts its own witnesses can still admit everything.** The public tests
   substitute *your* witness into *your* constraints and see zeros. Drop the boolean constraints on
   the digits, or never link the digit sum to the signal, and that still holds — while any value
   at all now has some auxiliary assignment that satisfies the gadget. Only the search over every
   assignment tells those apart, which is why the hidden verifier does one.

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

`make reference-test` runs the mutation suite: nineteen broken submissions plus six near-misses
sent through the verifier itself, all of which must be caught — and a mutation aimed at a specific
rule (an invented kind, an id-sorted trace, a sign-flipped residual, a `member` listing, the
product chain, an unlinked digit sum, a free-signal padding that must exhaust the search budget, a
boolean selector that hides exactly one extra out-of-range value) must be killed by *that* rule's
message, not by an unrelated one. Both the position and residual
of the broken constraint are seed-derived, so neither a constraint-name guess nor a two-choice
answer carries across deploys.

The hidden circuit is the public one plus a `member` constraint on a sixth signal (`tier`), so it
uses all five kinds, and it is handed to `trace` / `first_broken` in a seed-derived order that is
never the identity or its reverse — an implementation that sorts by id fails on the promise the
statement makes. Each hidden label breaks a different kind (arithmetic / member / boolean), and
the expected first violation is derived from the reference evaluator over the given order.

The range width is 1–2 / 3–4 / 5–6 bits by label, so every deployment covers the one-bit case
that needs no adder chain and the widest case where a per-digit doubling chain (26 constraints at
6 bits) sits just under the 5 × bits budget. Both that construction and the constant-weights one
(`const` powers of two, `mul`, `add`) pass; the reference uses the Horner form (3 × bits − 2).
2^6 = 64 is below every prime in `PRIMES`, so `2^bits < p` needs no per-field clamp.

The out-of-range half of the range check is exact, not sampled. `check_range` enumerates every
solution of the submitted constraints — a backtracking search that branches only where a single
constraint has one unassigned signal (a `boolean` gives two candidates, a `const` or a
single-occurrence `add` / `mul` one), so a decomposition gadget costs 2^bits leaves — and collects
the signal's value at each leaf; when a branch leaves a signal that no single constraint pins, the
same search decides each field element in 2^bits .. p − 1 on its own with the signal fixed. The
admitted set must equal 0 .. 2^bits − 1. An earlier version tried only four sampled out-of-range
values, and a review showed a gadget that hides exactly one extra value (2^bits + 1) behind a
boolean selector slipping through; `local/probes/range_exactness.py` replays that gadget, the
three honest constructions, and a brute-force cross-check of the search on random small gadgets,
and `mutation.py` carries the selector as a mutant. At 6 bits the honest constructions need about
800–1,400 assignments per width (a few milliseconds); exhausting the budget costs about 0.6 s per
width, well inside the verifier's 20 s limit.

`transfer` (a re-run of the whole suite on another seed) was removed in wave 5: it was earned by
transcription alone. The hidden labels already grade on fields, orderings and widths the visible
instance never shows.
