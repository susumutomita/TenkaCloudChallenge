# One box with nine layers

> This track is an independent, unofficial companion to the Advanced Cryptography Program 2026.
> It is not affiliated with or endorsed by the course or its operators. All problem statements,
> code, fixtures, and figures here are written independently. Questions about this track go to
> the TenkaCloud repository, not to the course operators.

**Track:** `advanced-cryptography-2026` · **Order:** 430 · **Chapter:** Week 4 / Proof
System Pipeline · **Role:** `transfer` · **Time:** 60–90 minutes · **Points:** 300 ·
**Required first:** `ac26-w4-arithmetization`, `ac26-w4-commit-open` · **Status:** draft —
see "Week 4 alignment"

## The story

"SNARK" and "STARK" name families, not protocols. Treated as single black boxes they
produce sentences like *it's succinct, so it's fast* and *it's transparent, so it assumes
nothing* — both of which are confusions between two different axes.

So this problem does not build a proof system. It gives you two, as **stage graphs**, and
breaks them.

```text
input-boundary → arithmetization → polynomial → commitment
               → transcript → opening → [low-degree] → verifier
```

A **run** is the paperwork for one execution: what was committed, what was absorbed
before the challenge was drawn, which openings the verifier actually checked. You write
one contract per layer, then diagnose runs where exactly one of those contracts broke.

## Two pipelines, and they are not the same shape

|  | A | B |
|---|---|---|
| family | circuit-oriented, succinct | trace-oriented, transparent |
| setup | trusted, per-circuit | transparent, none |
| rests on | SRS not retained, pairing hardness | collision-resistant hash, random oracle |
| stages | 8 | 9 |
| extra layer | — | `low-degree`, between `opening` and `verifier` |
| minimum queries | 1 | 8 |

Neither is an implementation of any real scheme and neither is named after one. What
matters is that **anything you hardcode from A is wrong for B**: stage names, layer order,
query minimum, and which artifacts exist at all. Every hidden check runs against both.

## The field that is a trap

`run["commitment_ok"]` is `True` in **every** run in this problem — honest ones and broken
ones alike. A commitment succeeding says the prover committed to something. It says
nothing about whether what they committed to satisfies the constraint system, and nothing
about whether the verifier ever checked an opening.

A contract that reads it passes the public tests and dies on the `constraints` checkpoint.

## Earliest, not worst

One broken input boundary makes the openings look wrong, the transcript look wrong, and
the verifier look wrong. `first_fault` reports the **earliest** layer, because a diagnosis
pointing at the openings sends somebody to repair a stage that was doing its job.

`repair` may change **exactly one field** of the run: the one the fault damaged. That rules
out the two shortcuts that would otherwise pass everything —

- rebuilding a clean run from the definition satisfies every contract and destroys the
  evidence;
- setting the verdict to `reject` silences every contract at once.

There is one fault for which flipping the verdict *is* the repair. Finding which, and
being able to say why it is the exception, is most of the checkpoint.

## How to play

```bash
make inspect            # both pipelines, one honest run, one broken run, the claims
make test               # public tests
make reset              # restore starter/pipeline.py
```

You edit one file, `local/starter/pipeline.py`.

## Scoring

Eight checkpoints, scored independently. Wrong answers cost 15 points each.

| Checkpoint | Points | What is checked |
|---|---:|---|
| `graph` | 30 | Producer and consumers per artifact, setup included, dangling detected |
| `wiring` | 35 | Verifier gets its inputs, prover-only artifacts stay private, setup material matches |
| `constraints` | 40 | Accepting despite an unsatisfied constraint; the commitment binding what it was handed |
| `transcript` | 45 | Everything the challenge consumes was absorbed before it was drawn |
| `opening` | 40 | Required openings checked by name not by count; per-pipeline query minimum; low-degree only where it exists |
| `assumptions` | 30 | Setup kind, transparency, and a non-empty assumption list for both |
| `cost` | 30 | Four unsupported claims rejected and four supported ones kept |
| `diagnose` | 50 | Earliest broken layer on nine faults, and a one-field repair |

Hints on five of the eight, each inside that checkpoint's 50% cap.

## What the claims are for

Four of the eight claims in `make inspect` are unsupported, and each one is a named
misconception rather than an arbitrary wrong answer:

- *A is succinct, so A's prover is fast* — proof size and prover cost are different axes.
- *B is transparent, so B rests on no assumption* — transparency is a property of the
  **setup**. B still needs a collision-resistant hash and a random oracle.
- *A's setup is a one-time ceremony, so A rests on no assumption* — the same confusion
  from the other side.
- *B's proofs are smaller than A's* — polylogarithmic is not smaller than constant.

The other four are true, and rejecting everything scores no better than reading the
profiles.

## Not in scope

No Groth16, PLONK, or STARK implementation; no benchmark numbers; no setup ceremony; no
proof-generation service. Every cost here is a **declared class**, not a measurement, and
comparing declared classes is the only comparison this problem makes.

## Week 4 alignment

Week 4's material was not published upstream at the pinned commit. `courseAlignment` pins
`week4/README.md` with `kind: "placeholder"` and takes the `transfer` role, one of the two
`GOVERNANCE.md` §6 permits for an unpublished week. It asserts nothing about what the
official exercise will require. #229 reconciles the row when the material appears.

## Cost

Zero. No cloud account, no AWS resources.

## For authors

`make reference-test` runs the mutation suite: nineteen broken implementations, every one
of them a plausible reading rather than a typo. Most pass the public tests and every
honest run, and differ only on a broken pipeline or on B rather than A.

Two candidate mutations were **dropped** rather than left to survive: excluding `verdict`
from the prover-only set (nothing ever publishes it, so no verdict changes) and sorting
`dangling_artifacts`' output (the hidden tests sort before comparing). A mutation that
cannot change an outcome does not demonstrate coverage, and leaving an unkillable one in
the list teaches that a `SURVIVED` line can be ignored.
