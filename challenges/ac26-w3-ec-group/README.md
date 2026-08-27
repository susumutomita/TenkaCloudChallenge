# (0, 0) is not the point at infinity

> This track is an independent, unofficial companion to the Advanced Cryptography Program 2026.
> It is not affiliated with or endorsed by the course or its operators. All problem statements,
> code, fixtures, and figures here are written independently. Questions about this track go to
> the TenkaCloud repository, not to the course operators.

**Track:** `advanced-cryptography-2026` · **Order:** 320 · **Chapter:** Week 3 / Elliptic Curve
Group Law · **Role:** `mechanism` · **Time:** 75–105 minutes · **Points:** 300
· **Required first:** `ac26-w3-field-inverse`

## The story

The claim is that the points of

```text
y^2 = x^3 + a*x + b   (mod p)
```

together with one extra element, form a group. Slides assert it. Here you build it, and the
build is where the assertion turns out to have four cases rather than one formula.

## Participant Portal workflow

1. Start the problem in Participant Portal; the problem editor appears on the same page.
2. Select **Inspect evidence** to read this deployment's fixture and published evidence.
3. Edit the starter source in the Portal editor.
4. Select **Run public tests** and fill any direct-answer fields from the evidence.
5. Submit each checkpoint directly. Portal prepares and sends the current files and answers.

No checkout, terminal, local editor, second screen, or copy-and-paste step is required. Code
checkpoints use the current editor source. Direct answers are bound to the current deployment
seed, so a value copied from another deployment is rejected.

## Scoring

Eight checkpoints, scored independently. Wrong answers cost 15 points each.

| Checkpoint | Points | What is checked |
|---|---:|---|
| `on-curve` | 30 | Every coordinate pair classified, and off-curve pairs rejected |
| `identity` | 30 | The identity distinguished from `(0, 0)`, and `P + (-P) = O` for every point |
| `add` | 45 | Every ordered pair of distinct points |
| `double` | 45 | Every point, including the vertical-tangent ones |
| `scalar` | 45 | Double-and-add, with `k = 0`, `k = 1` and negative `k` |
| `trace` | 35 | Each step's accumulator against the bits consumed so far |
| `properties` | 40 | The axioms and the homomorphism, on a curve you have not seen |
| `secp256k1` | 30 | The same abstraction over the published real parameters |

Hints on five of the eight, each inside that checkpoint's 50% cap.

## Exhaustive, not sampled

The curves are small — 23 to 47 points — so nothing here samples. Every coordinate pair is
classified, every ordered pair of distinct points is added, every point is doubled, and the group
axioms are checked across the whole group. An implementation that handles the generic case and
breaks on the identity, on `P + (-P)`, or at `y = 0` has nowhere to hide.

## How the trace catches bit order

Double-and-add consumes bits least significant first. Immediately after step `i`, the accumulator
must equal the number formed by the low `i+1` bits, times `P`. The trace checkpoint verifies that
on every row, so an implementation consuming bits the other way fails on the first one — getting
only the final answer right is not enough.

## What the secp256k1 checkpoint actually checks

Every relation it checks follows from the definition of the published parameters, rather than
matching a value transcribed from somewhere:

- `G` is on the curve;
- `n` is the group's order, so `n·G` is the identity;
- therefore `(n-1)·G = -G` and `(n+1)·G = G`;
- `(k+m)·G = k·G + m·G`.

No copied expected value is needed, so no mistyped or unsourced constant can creep in.

## Not constant-time

Double-and-add branches on the scalar's bits, and how many additions it performs depends on how
those bits fall. Against a real key that property is itself a side channel. This exists to make
the algorithm legible, not as a model for production.

## Assurance scope

Local mode is **self-paced, honor-system verification**. Someone who owns the Docker daemon and
every container in the compose stack cannot be prevented from inspecting hidden material. The
boundary here is misdelivery, not confidentiality against that person: the Workbench container
you build and run carries the starter and the public tests only — no fixtures, no hidden tests,
no reference solution, no verifier. Those live only in a second, unpublished container the
Workbench reaches over the compose network, and in the author-only image `make reference-test`
builds.

Because of that, `make test`, `make test-one` and `make inspect` bring the verifier up first
(`make verifier-up`, run for you): they read this deployment's curve and its points from it
over the compose network instead of computing them locally. `make verifier-down` stops it.

What the verifier does guarantee is narrower and real: a submission cannot hang or crash it,
a checkpoint can only credit the id it echoes, results do not leak expected values, and the
fixtures come from this deployment's seed so a memorized answer does not carry.

That supports self-study and honest practice. It does **not** support competition ranking,
examination, or completion certification — those need a verifier the participant does not
administer, tracked in [#271](https://github.com/susumutomita/TenkaCloudChallenge/issues/271).

## Cost

Zero. No cloud account, no AWS resources.

## For authors

`make reference-test` runs the mutation suite: ten broken implementations. Two of them found real
holes while this problem was being written — a curve-mismatch check that skipped itself when the
seed happened to pick the same curve twice, and an "aliases the input point" mutation that turned
out to be an equivalent mutant and was replaced with one that genuinely writes through.
