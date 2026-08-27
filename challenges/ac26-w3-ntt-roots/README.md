# Does that omega really take n powers to reach 1?

> This track is an independent, unofficial companion to the Advanced Cryptography Program 2026.
> It is not affiliated with or endorsed by the course or its operators. All problem statements,
> code, fixtures, and figures here are written independently. Questions about this track go to
> the TenkaCloud repository, not to the course operators.

**Track:** `advanced-cryptography-2026` · **Order:** 315 · **Chapter:** Week 3 / Roots of Unity
· **Time:** 45–75 minutes · **Points:** 200

## The story

Underneath a zkSNARK is a transform that moves a polynomial between its coefficients and its
evaluations. For it to be a transform at all, the evaluation points must be distinct — and the
only thing making them distinct is that omega has order exactly `n`.

## The gap this problem is built on

The starter builds omega as `3 ** ((p-1)/n)`. That formula is not wrong. What is missing is the
check that the omega it produced has order `n`.

| p | n | starter's omega | its actual order |
|---|---|---|---|
| 17 | 4 | 13 | 4 |
| 113 | 16 | 40 | 16 |
| 97 | 8 | 75 | **4** |
| 73 | 8 | 46 | **4** |
| 13 | 4 | **1** | **1** |

At `p=13, n=4` every evaluation point collapses onto 1. The return value is still `n` integers
inside the field, and every public test still passes, because the public tests use the pairs in
the top half of that table.

`pow(w, n, p) == 1` cannot tell these apart. It is satisfied by every element of every smaller
subgroup, 1 included, so it says "the order divides `n`" and never "the order is `n`". Closing
that gap is the exercise; nothing in the image does it for you.

## What you implement

```python
transform(coefficients, prime, order)
  -> {"ok": True, "omega": w, "values": [...]} | {"ok": False, "error": str}

inverse_transform(values, prime, order, omega)
  -> {"ok": True, "coefficients": [...]} | {"ok": False, "error": str}
```

Any omega will do as long as its order is exactly `order`; return the one you used. The inverse
needs `1/n`, and it must refuse an omega whose powers repeat rather than return plausible numbers.

## How the hidden properties decide

Every `(p, n)` comes from the verifier seed, and **at least half of every set is a pair the
textbook rule gets wrong**, so a submission that kept the rule fails for certain rather than by
luck. The checker builds its expectations from the definition of multiplicative order, not from
the reference.

## Commands

```
make build         build the participant image
make test          run the public tests (the shipped starter passes all of them)
make inspect       print this deployment's fields and one worked transform
make reset         restore starter/ to its shipped state
make verifier-up   start the verifier container the two above read from
make verifier-down stop it
```

## Assurance scope

Local mode is **self-paced, honor-system verification**. Someone who owns the Docker daemon and
every container in the compose stack cannot be prevented from inspecting hidden material. The
boundary here is misdelivery, not confidentiality against that person: the Workbench container
you build and run carries the starter, the public tests and the orientation printer only — no
fixtures, no hidden tests, no reference solution, no verifier. Those live only in a second,
unpublished container the Workbench reaches over the compose network, and in the author-only
image `make reference-test` builds.

Because of that, `make test`, `make test-one` and `make inspect` bring the verifier up first
(`make verifier-up`, run for you): `make inspect` reads this deployment's field family and its
worked transform from it over the compose network instead of computing them locally.
`make verifier-down` stops it.

What the verifier does guarantee is narrower and real: a submission cannot hang or crash it,
a checkpoint can only credit the id it echoes, results do not leak expected values, and the
fixtures come from this deployment's seed so a memorized answer does not carry. Submissions run
with time, memory, process and output caps; both containers run non-root, read-only, without
privileges, and only the Workbench is published, on loopback.

That supports self-study and honest practice. It does **not** support competition ranking,
examination, or completion certification — those need a verifier the participant does not
administer, tracked in [#271](https://github.com/susumutomita/TenkaCloudChallenge/issues/271).

## Cost

Zero. No cloud account, no AWS resources.

## For authors

`make reference-test` runs the mutation suite: nine broken implementations, all killed. Two of
them are the reason the hidden phases are written the way they are. The one that keeps the
textbook rule and never checks the result is the defect the shipped starter carries, and it
survives every public test. The one that accepts any omega whose order merely divides `n`
passes the forward transform and only shows up on the inverse.
