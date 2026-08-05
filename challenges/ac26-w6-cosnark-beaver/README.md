# Multiply two values nobody holds, with one round of talking

> This track is an independent, unofficial companion to the Advanced Cryptography Program 2026.
> It is not affiliated with or endorsed by the course or its operators. All problem statements,
> code, fixtures, and figures here are written independently. Questions about this track go to
> the TenkaCloud repository, not to the course operators.

**Track:** `advanced-cryptography-2026` · **Order:** 620 · **Chapter:** Week 6 / Programmable
Cryptography Stack Design · **Role:** `assignment-companion` · **Time:** 60–90 minutes ·
**Points:** 300 · **Required first:** `ac26-w6-cosnark-linear`, `ac26-w2-beaver-mul` ·
**Status:** draft

## The story

The previous problem built the half of a co-SNARK prover's row that costs nothing. Both
sharings come out of it already built, and they are handed to you here.

```text
A = sum_j a_j w_j        B = sum_j b_j w_j        C = A * B        (mod p)
```

`[A]` and `[B]` are shared. The product of the sums is not the sum of the products, so no
arrangement of local operations produces `[C]`. One round of communication is the price, and
Beaver's trick is what makes it exactly one.

```text
[d] = [A] - [x]        [e] = [B] - [y]        both local
d, e opened                                   one round, two values
[C] = [z] + d*[y] + e*[x] + d*e
```

The cost did not disappear; it moved into preprocessing. Producing triples is the expensive,
input-independent part, and the online phase is one round however wide the layer of
independent multiplications is, because they all batch into it.

## What is supplied, and what is new

Week 2's Beaver multiplication (`ac26-w2-beaver-mul`) and the previous problem's linear layer
are both supplied. You rebuild neither. What is new is that they meet: the same trick, one
layer up, where it is a co-SNARK's privacy rather than a standalone protocol's.

The runtime gains three things:

```text
runtime.reserve_triple(triple)   check a triple and spend it; a second call raises
runtime.open(round_id, sharing)  reveal one shared value. The only thing here that talks
runtime.openings()               every opening: {"roundId", "shareIds", "maskedBy"}
runtime.consumed_triples()       the triple ids spent so far
```

A round is a **distinct `roundId`**, not an opened value. That is what makes "two values, one
round" a measurement instead of a claim.

There is still no `reconstruct`.

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
| `plan` | 30 | Triples, openings, rounds and messages as functions of the layer's width |
| `triple` | 35 | The triple checked against the relation, spent once, and the ledger read not assumed |
| `masks` | 40 | `[d]` and `[e]` from the substitution, local, descending from the mask |
| `open` | 45 | Both values in one round, counted off the runtime rather than remembered |
| `product` | 45 | `[C]` reconstructs to `A * B`, with the public `d*e` folded in by one party |
| `artifact` | 30 | Three sharings and their metadata — no plaintext, no transcript |
| `audit` | 50 | Every published value under a reserved mask, measured from the opening records |
| `transfer` | 25 | All of it at a field, party count and witness length you have not seen |

Hints on seven of the eight (12–20 each). Opening every one still leaves 190 of 300.

## A correct C proves less than it looks

This problem ships 31 deliberately broken implementations, and **24 of them reconstruct `C` to
`A * B` on every shape**. `make reference-test` re-measures that count on every run.

One of them is the point of the problem. Open `[A]` and `[B]` directly and you have the
plaintext `A` and `B`; multiply, re-share the answer. The `C` that comes out is perfect at
every seed and every shape, the round count is still one, and a triple is still spent.
Measured, exactly **one** checkpoint kills it: `audit`.

That is not a loophole in the grading. `prove_product`'s contract is that `C` is right and the
schedule is one round, and that prover satisfies it completely. What it threw away is that the
only values published were masked ones, and the opening records are where that lives.

## What the audit proves, and what it does not

It proves that every value published on this runtime went out under a reserved triple mask,
that no read was refused, and that triples were spent as the ledger says.

It does **not** prove that nobody ever saw `A` or `B`. Opening each party's scope and reading
that party's own share is legal; do it for every party and you have `A`. `Share._value` is one
attribute access away besides. The runtime is an instrument, not a sandbox — it records what a
computation published, not what its author looked at.

## The mask is uniform exactly once

"Opening `d` and `e` reveals nothing about `A` and `B`" rests entirely on the `x` in
`d = A - x` being uniform **and used once**. Hide two values behind the same `x` and their
difference is public. Nothing else breaks: `C` still comes out right, which is why "triple
reuse is a performance concern" survives as a belief. `reserve_triple` raises on the second
reservation rather than discouraging it in a docstring.

## What the dealer checks, and what a real protocol cannot

`reserve_triple` verifies `z == x * y` before handing the triple over. **A real protocol
cannot do that.** The parties hold only shares, and checking the product would mean
reconstructing all three — destroying the mask they exist to provide. Real preprocessing
spends a second triple to check the first (sacrificing), or produces triples with a protocol
that is maliciously secure end to end. Here a trusted dealer checks its own work.

## Where this leads

The next problem takes the same step and asks what else it opened. This one measures whether
the two openings were masked; the privacy problem asks whether they were the *only* two, and
what a prover that opens one value more has actually published.

## Not in scope

Actual proof encoding and verification, scheduling optimization across multiplication layers,
malicious-secure triples, network transport.

## This is not secure

The field is a small enumerable prime, there are two to five parties, the adversary is not
semi-honest so much as absent, and a trusted dealer produces the triples. It is a toy of the
mechanism.

## Source alignment

Week 6's material is published upstream, so `courseAlignment` pins `week6/README.md` and
`week6/problems/co-snark-prove/README.md` at the commit `curriculum.md` records. The exercise's
template, coefficients, fixtures and solution are not reproduced here: the relation, the
runtime, the triple dealer and the instrumentation are written independently, and the course's
exercise supplies the primitives this one builds on rather than the code this one grades.

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

`make reference-test` runs the mutation suite: 31 broken submissions plus one aimed at the
verifier. It prints how many of the 31 still reconstruct `C` to `A * B`, which is the number
this README quotes — if a later edit makes the checkpoints cheaper, that number moves and the
claim has to move with it.
