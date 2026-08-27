# Eight provers that agree on the answer and disagree on what they say

> This track is an independent, unofficial companion to the Advanced Cryptography Program 2026.
> It is not affiliated with or endorsed by the course or its operators. All problem statements,
> code, fixtures, and figures here are written independently. Questions about this track go to
> the TenkaCloud repository, not to the course operators.

**Track:** `advanced-cryptography-2026` · **Order:** 630 · **Chapter:** Week 6 / Programmable
Cryptography Stack Design · **Role:** `transfer` · **Time:** 60–90 minutes ·
**Points:** 300 · **Required first:** `ac26-w6-cosnark-linear`, `ac26-w6-cosnark-beaver` ·
**Status:** draft

## The story

The co-SNARK prover was finished in the previous two problems. The linear layer cost zero
rounds; the multiplication cost exactly one. Both are handed to you here as answers.

```text
A = sum_j a_j w_j        B = sum_j b_j w_j        C = A * B        (mod p)
```

What you are handed is eight implementations built on top of it, `S1`..`S8`. **All eight
reconstruct `C` to `A * B` at every seed and every shape** — 96 runs out of 96 agree. A
correctness test cannot tell them apart. That is the premise of the problem, not a spoiler.

What differs is what each one lets out, and through which exit.

```text
artifact   what the next stage consumes
log        lines a prover writes while working
metrics    named numbers an operator scrapes
error      what a malformed input produces
```

A correctness test reads the first field of the first one. Three of the eight use only the
other three. One leaks through none of the four, and one says nothing at all while reading
every party's share.

## What is new

The previous problem's runtime withheld `reconstruct`, which made one class of shortcut
unwritable. That was the right default there and it is the wrong one here: a real MPC library
exposes reconstruction, cross-party debugging hooks and structured logging, because real
operators need them. Withhold them and the whole class of defect becomes unwritable and
therefore unauditable.

So `AuditRuntime` hands them out, and records what was reached:

```text
runtime.reached()     every capability reached: {"capability", "party", "operands"}
runtime.openings()    every opening:            {"roundId", "shareIds", "maskedBy"}
runtime.events()      the full operation trace
```

Operand ids, **never a value**. The record is evidence rather than a transcript. Reaching a
capability is not a violation — publishing `d` and `e` is the protocol — and deciding is your
job.

Specimen ids are opaque and two of them reach a capability through a name that does not spell
it. `grep("reconstruct")` finds nothing. The capability record finds it.

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
| `classify` | 30 | Six classes over a catalog of descriptors, including two openings that are still secret |
| `capability` | 40 | Every capability reached — including one that needs a second, malformed probe |
| `open-set` | 40 | Mask **and** declared round, because each half alone passes a different prover |
| `cross-party` | 30 | Reads across a party boundary, in an implementation whose disclosure is clean |
| `leakage` | 45 | All four channels, against the name policy **and** the kind policy |
| `evidence` | 45 | A secret derived from a serialized disclosure, named by the pair it came from |
| `repair` | 45 | Correctness, the open set, the round count, the schema and the failure path at once |
| `transfer` | 25 | All of it at a setting you have not seen, on provers you have not seen |

Hints on seven of the eight (12–18 each). Opening every one still leaves 190 of 300.

## Noticing is easy. Saying what leaked is not

This problem ships 35 deliberately broken audits, and **29 of them still give all eight
specimens the right verdict** — clean or not clean. `make reference-test` re-measures that
count on every run.

That is the whole reason the checkpoints demand exact pairs and exact values. An audit that
points at the right prover for the wrong reason is not a finding; it is a coincidence that
will not survive the next implementation.

Measured, each checkpoint is the sole catcher of its own defect (alongside `transfer`, which
re-runs everything under another seed). One predicate breaks two at once: `_authorized`
reduced to "was there a mask" or "was it the right round" fails `classify` **and** `open-set`,
because those two checkpoints are asking the same question.

## Published is not the same as allowed to be published

One Beaver multiplication authorizes exactly two openings — the masked `d` and `e`, both under
the multiplication's own round id. An opening is authorized only when **both** hold:

- a reserved triple mask is in its ancestry (`maskedBy` is not empty), and
- its `roundId` is the round the relation declared.

An opening that fails the first published something nothing was hiding. One that fails the
second spent a mask on a value it was not drawn for, which is triple reuse in a disguise.

## What the audit proves, and what it does not

It proves that every value published on this runtime went out under a reserved mask, that no
capability beyond the protocol's own was reached, and that no name outside the policy appeared
in any of the four channels.

It does **not** prove that nobody ever saw `A`. `Share._value` is one attribute access away,
and you own the machine and the image. The runtime is an instrument, not a sandbox — it
records what a computation published, not what its author looked at.

Two limits are worth stating rather than implying. The log's policy surface is the *field
names* inside a structured record, so a prover that writes a secret into a message's prose is
not caught here; reducing the log to strings first would have made this an exercise in regular
expressions. And a value opened to the other parties but never put into a channel is invisible
to the disclosure audit by construction — it is `open-set`'s business, not `leakage`'s.

## Where this leads

Week 6's remaining problems leave MPC for the zkVM side of the stack. What carries over is the
question this one asks: a primitive that is correct and a system that keeps its promise are
different claims, and only one of them is checked by the tests everybody writes.

## Not in scope

Formal simulation-based proofs, timing and cache side channels, malicious-secure MPC
compilers, and the privacy analysis of an actual SNARK proof.

## This is not secure

The field is a small enumerable prime, there are two to five parties, the adversary is not
semi-honest so much as absent, and a trusted dealer produces the triples. It is a toy of the
mechanism.

## Source alignment

Week 6's material is published upstream, so `courseAlignment` pins `week6/README.md` and
`week6/problems/co-snark-prove/README.md` at the commit `curriculum.md` records. The
exercise's template, coefficients, fixtures and solution are not reproduced here: the
relation, the runtime, the specimens, the disclosure sink and the policy are written
independently, and the course's exercise supplies the primitives this one audits rather than
the code this one grades.

## Assurance scope

Local mode is **self-paced, honor-system verification**. Someone who owns the Docker daemon and
every container in the compose stack cannot be prevented from inspecting hidden material. The
boundary here is misdelivery, not confidentiality against that person: the Workbench container
you build and run carries the starter, the public tests, the orientation printer, the supplied
layer (`participant/mpc.py` — the sharing runtime, the disclosure sink and the policy
vocabulary, plus the two answers this problem hands over), the bench (`participant/lab.py`) and
the eight specimens as runnable objects (`participant/specimens.py`). It does **not** carry the
seed derivation, the ground truth about those eight, the hidden tests, the reference solution or
the verifier. Those live only in a second, unpublished container the Workbench reaches over the
compose network, and in the author-only image `make reference-test` builds.

Because of that, `make test`, `make test-one` and `make inspect` bring the verifier up first
(`make verifier-up`, run for you): `make inspect` reads this deployment's setting, row, witness
and catalog from it over the compose network instead of deriving them locally. `make
verifier-down` stops it.

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

`make reference-test` runs the mutation suite: 35 broken audits plus one aimed at the
verifier. It prints how many of the 35 still give every specimen the right verdict, which is
the number this README quotes — if a later edit makes the checkpoints cheaper, that number
moves and the claim has to move with it.
