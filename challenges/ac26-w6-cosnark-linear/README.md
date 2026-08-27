# Build half a proof over a witness nobody holds

> This track is an independent, unofficial companion to the Advanced Cryptography Program 2026.
> It is not affiliated with or endorsed by the course or its operators. All problem statements,
> code, fixtures, and figures here are written independently. Questions about this track go to
> the TenkaCloud repository, not to the course operators.

**Track:** `advanced-cryptography-2026` · **Order:** 610 · **Chapter:** Week 6 / Programmable
Cryptography Stack Design · **Role:** `mechanism` · **Time:** 60–90 minutes · **Points:** 300
· **Required first:** `ac26-w2-secret-sharing`, `ac26-w2-linear-shares` · **Status:** draft

## The story

A co-SNARK proves a statement about a witness that **no single prover holds**. The witness is
secret-shared across parties, and the prover computation itself runs on top of MPC.

That sounds expensive, and half of it is free.

```text
A = sum_j a_j w_j        B = sum_j b_j w_j        (mod p)
```

`a` and `b` are public coefficient vectors. `w` is the shared witness. Under an additive
sharing,

```text
sum_j a_j * [w_j]_party  =  [sum_j a_j * w_j]_party
```

holds for each party **independently**. Scaling by a public constant and adding two shares held
by the same party are both things one party does alone, so the entire linear layer of a
co-SNARK prover costs zero rounds. Multiplication is where that stops being true, and that is
the next problem.

## What is supplied, and what changed

Week 2's additive secret sharing and its local operations are supplied. You rebuild neither.
What changed is the type of a share.

```text
Share.party    which party holds it
Share.field    which field its value lives in
Share.id       a name, so a trace can name an operand without naming a value
```

Week 2 modelled a sharing as `list[int]` and let you index it. That is fine when the lesson is
the arithmetic. Once the lesson is *who may read what*, a share cannot stay an int.

The runtime you are handed has `party_scope`, `value_of`, `add`, `mul_public`, `zero`,
`events()`, `violations()`, `ancestry()` and `issued()`. It does not have `reconstruct`.

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
| `relation` | 30 | Canonical coefficients, and rows that do not describe a field are refused |
| `witness` | 30 | Shape, party order, field stamp and duplicates — checked without reading a value |
| `combine-a` | 40 | A combination built from local operations, indexed by witness position |
| `combine-b` | 40 | Both halves from their own vectors, over a witness that was checked first |
| `audit` | 50 | Every result issued by the runtime, descending only from its own party's inputs |
| `trace` | 45 | Rounds, messages and parties read out of the log rather than asserted |
| `equivalence` | 40 | Agreement with the plain relation on all four shapes, under rerandomization |
| `transfer` | 25 | All of it at a field, party count and witness length you have not seen |

Hints on seven of the eight (12–20 each). Opening every one still leaves 188 of 300.

## A correct A and B proves less than it looks

This problem ships 24 deliberately broken implementations, and **18 of them reconstruct to the
right A and B on every shape**. `make reference-test` re-measures that count on every run.

They split three ways. **Right value, wrong form** — a relation stored with `-3` where the
canonical name for that element is `94`. **Right value, nothing checked** — folding a sharing
whose parties are out of order, or that appears at two witness positions. **Right value, false
account of itself** — `rounds: 0` returned from belief rather than from the log.

One of them is the point of the problem. An implementation that adds up each sharing to recover
`w`, computes `A` and `B` in the clear, and re-shares the answers returns a perfect `A` and `B`
at every seed and every shape. Measured, exactly **one** checkpoint kills it: `audit`.

## What the audit proves, and what it does not

It proves that every result share was issued by the runtime, that its ancestry reaches only
that party's own input shares, and that no read was refused. That is real, and it is what the
shortcut above fails.

It does **not** prove that the witness was never assembled. Opening each party's scope in turn
and reading that party's own share is legal; do it for every party and you have `w`, and folding
honestly afterwards leaves a completely innocent trace. `Share._value` is one attribute access
away besides. The runtime is an instrument, not a sandbox — it records what a computation
consumed, not what its author looked at.

That is not a gap in the exercise. A real MPC transcript shows the protocol's message pattern;
it does not show that a party's operator kept no copy of their input. Conflating the two lands
you at "we used MPC, so nothing leaked".

## Zero rounds is the answer, not a measurement

You knew the answer before you wrote a line, so a report that returns `rounds: 0` earns nothing.
The `trace` checkpoint hands the report a log with communication in it every time: three
messages in one round, five in two, a round that carried nothing, and a message from a party
outside this row's committee. Read the log and all of them pass.

## Where this leads

The next problem is multiplication, which cannot be done this way: the product of the sums is
not the sum of the products, so parties have to exchange masked values. Everything a co-SNARK
spends is spent there, which is why the boundary drawn here is worth drawing precisely.

## Not in scope

Actual SNARK proof generation, malicious-secure MPC, network transport, prover performance.

## This is not secure

The field is a small enumerable prime, there are two to five parties, the adversary is not
semi-honest so much as absent, and there is no channel, no committed randomness and no
preprocessing. It is a toy of the mechanism.

## Source alignment

Week 6's material is published upstream, so `courseAlignment` pins `week6/README.md` and
`week6/problems/co-snark-prove/README.md` at the commit `curriculum.md` records. The exercise's
template, coefficients, fixtures and solution are not reproduced here: the relation, the runtime
and the instrumentation are written independently, and the course's exercise supplies the
secret-sharing primitives this one builds on rather than the code this one grades.

## Assurance scope

Local mode is **self-paced, honor-system verification**. Someone who owns the Docker daemon and
every container in the compose stack cannot be prevented from inspecting hidden material. The
boundary here is misdelivery, not confidentiality against that person: the Workbench container
you build and run carries the starter, the public tests, the orientation printer and the
supplied sharing layer (`participant/mpc.py` — the shares, the instrumented runtime and the
participant facade, which are two earlier problems' answers and are handed to you on purpose).
It does **not** carry the seed derivation, the hidden tests, the reference solution or the
verifier. Those live only in a second, unpublished container the Workbench reaches over the
compose network, and in the author-only image `make reference-test` builds.

Because of that, `make test`, `make test-one` and `make inspect` bring the verifier up first
(`make verifier-up`, run for you): `make inspect` reads this deployment's setting, row and
witness from it over the compose network instead of deriving them locally. `make verifier-down`
stops it.

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

`make reference-test` runs the mutation suite: 24 broken submissions plus one aimed at the
verifier. It prints how many of the 24 still reconstruct to the right `A` and `B`, which is the
number this README quotes — if a later edit makes the checkpoints cheaper, that number moves and
the claim has to move with it.
