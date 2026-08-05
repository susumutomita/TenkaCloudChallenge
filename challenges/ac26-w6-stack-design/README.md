# Every part is correct. What you built out of them is not

> This track is an independent, unofficial companion to the Advanced Cryptography Program 2026.
> It is not affiliated with or endorsed by the course or its operators. All problem statements,
> code, fixtures, and figures here are written independently. Questions about this track go to
> the TenkaCloud repository, not to the course operators.

**Track:** `advanced-cryptography-2026` · **Order:** 660 · **Chapter:** Week 6 / Programmable
Cryptography Stack Design · **Role:** `synthesis` · **Time:** 90–120 minutes · **Points:** 300 ·
**Required first:** `ac26-w6-zkvm-witness-binding`, `ac26-w6-cosnark-privacy` ·
**Status:** draft

## The story

Week 6's five problems before this one each built one part that works: a prover over secret
shares, a guest that says exactly what it proved, an evaluation that never sees its input. This
one is about the wires between them, and it starts from a single observation:

```text
a primitive can only check the shape of what it was handed
```

That is not a criticism of primitives. It is what a primitive *is*. An MPC engine verifies that
what arrived is a share; it has no way to know whether that share was supposed to be secret,
which field the party on the other end thinks it is working in, or whether the open policy ever
approved reconstructing it. A zkVM verifies that the guest ran; it does not verify that its
journal is about the program the reader is holding. An FHE evaluation is correct under whatever
key it was given, and cannot tell you the key was the wrong one.

So every component's own test passes, and the architecture is broken anyway. That is a
**composition failure**, and this problem is nine ways of looking at one.

## No cryptography runs here

Not a share, not a proof, not a ciphertext. What runs is a typed graph:

```text
a node   one computation, and where it runs
an edge  one value crossing from one computation to the next, and what it is at that moment
```

An edge is five things at once, plus the dialect it is framed in:

```text
representation  plaintext, secret-share, ciphertext, commitment, proof, journal
classification  public or secret
algebra         which field or modulus it lives in, when that applies
keyDomain       which key it is under, when that applies
identity        which program or statement it is about, when that applies
serialization   the framing it was encoded in
```

A picture of an architecture shows which box talks to which box. That is not the question. The
question is what the value **is** while it is in flight.

## Three levels of contract, and they are not one level

```text
LICENCE      what a transformation may change. A key-switch may change keyDomain. A carry may
             change nothing at all
policy       which nodes this architecture allowed to hold such a transformation. Being
             licensed to open a secret is a fact about the operation; being allowed to is a
             fact about who is running it
obligations  what this architecture promised to deliver, and on which wire
```

Two of the three exist because of failures the other one cannot see.

**A licensed change is not a correct change.** A key switch is authorised to change the key
domain, and being authorised to change it is not being right about what to change it to. The
FHE service switches keys twice on the way — a bootstrap leaves the ciphertext under the key it
bootstrapped with, and the switch after it brings the result home. Both are licensed. Only one
of them has to land on the client's key, and the licence table has nothing to say about which.

**Authorising the box that broke the rule satisfies every contract in one move.** It is also not
a repair: it lowers the requirement to meet the deployment, which is the deployment writing its
own acceptance criteria. That is why the policy is a level of its own and why it is outside the
search space the repair checkpoint gives you.

## Thirteen deployments

Every seed draws three sound architectures — an MPC-backed prover, a zkVM proof of exploit, an
FHE evaluation service — and thirteen deployments that differ from one of them in exactly one
place.

Eleven of them step on exactly one of the eleven boundary classes. The twelfth puts a licensed
operation on a node nobody approved to hold it. The thirteenth **breaks no contract at all**:
every boundary holds, no promise is unkept, and a primitive is left holding a shape it has no
way to consume. It is there to say in one deployment that a contract is not a substitute for a
design review — which is why the repair checkpoint asks for two things separately, every
contract holding *and* every component able to run what it was handed.

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
| `dataflow` | 45 | What each wire is pinned to carry, and where the primitive's guarantee stops |
| `properties` | 30 | Each end-to-end property mapped to the wires that carry it |
| `contracts` | 50 | Licence, obligation, authorisation, trust and cost breaches, classed correctly |
| `diagnosis` | 30 | The boundary that broke first in the order the value arrives |
| `counterexample` | 45 | One change that costs a property with every component still content |
| `repair` | 45 | The fewest changes that put it back, without editing the requirement |
| `selection` | 30 | Primitives, publication, trust and dominant cost for a brief |
| `transfer` | 25 | All of it on a field, a statement, a program and a brief you have not seen |

Hints on seven of the eight (14–24 each). Opening every one still leaves 174 of 300.

## Why eight checkpoints and not nine

Issue #244 asks for nine things. The multi-verify cap is eight, enforced catalog-side in
`SCHEMA.json` and again in the platform's `packages/problem-sdk` — and a ninth check is **not
truncated, the whole scoring object is dropped**, which would take the other eight down with it
and leave the problem unscorable. So two of the nine share a checkpoint.

They share it for a reason rather than because they were adjacent on the list: reading what each
wire is carrying and knowing where the primitive's guarantee stops are the same act of reading
the typed graph. There are still nine hidden phases behind the eight checkpoints; `dataflow` is
the one that runs two.

## The easy half

This problem ships 53 deliberately broken stacks, and **47 of them still answer the two
questions anybody writing a test for an architecture checker asks first** — does a sound
architecture come back with nothing wrong with it, and does a broken one come back with
something. `make reference-test` re-measures that count on every run.

Both are stated outright in the problem text, so nobody has to discover them, and a suite that
asks only those two agrees with forty-seven wrong models. What is not written out — that "first"
is the order the value arrives rather than id order, that a primitive stops vouching for
anything the moment its assumption is not met, that one property is carried by no wire at all,
and that authorising the offending node is not a repair — is why there are checkpoints instead
of one test.

## Where the primitive's guarantee stops

A primitive underwrites correctness and privacy for the computation it runs *inside* itself.
That is a strong guarantee and a narrow one. Application code sitting on top of a primitive is
covered by it the way a bank vault covers what you carry out of the building, host orchestration
is covered by nothing at all, and a guarantee whose assumption was not met is not a guarantee: a
primitive vouches for the value it received and the value it produced, and where a contract
broke on either, it is underwriting nothing.

An architecture diagram that shades the primitive boxes green is claiming something this
problem asks you to compute.

## One rule was removed rather than left in

An earlier version of the model skipped an attribute whose value was absent on both sides of a
wire, on the grounds that a contract about an attribute the value does not carry is not a
contract. It reads well. It also changes no answer — an edge with an absent key domain always
already carries that class's two properties through some other class — so it was a rule nobody
could observe being followed or broken.

It came out. A model keeps the rules that decide something, and a rule that decides nothing is
a comment that costs a reader time.

## What the suite proves, and what it does not

It proves that these eight checkpoints catch the 53 defects shipped with the problem, that the
reference clears all eight, and that the shipped starter clears none. It does **not** prove that
the model has no other hole: a defect nobody wrote down is a defect nobody measured.

## Where this leads

Week 6 ends here, and Week 7's capstone starts from a brief that names actors, assets and trust
and names no primitive at all. What carries over is the habit this one drills: the parts working
is the beginning of the argument, not the end of it.

## Not in scope

Actually running MPC, a zkVM or FHE; the security proof of any specific protocol; the soundness
of a proof system; production key management; network-level availability.

## This is not secure

Eight or nine nodes, seven to nine edges, five attributes, eleven boundary classes. A real stack
has hundreds of nodes, an attribute for every parameter of every proof system and ciphertext
scheme in it, and as many boundary classes as that deployment bothered to write down. The claim
here is that boundary contracts can be written as exact rules, not that the ones written here
are complete.

## Source alignment

Week 6's material is published upstream, so `courseAlignment` pins `week6/README.md` at commit
`5e80999306608a45aecf9a0e4e3394a0b62f34d2`. Nothing is reproduced from the official material:
the graph model, the attribute set, the licence and policy tables, the three architectures, the
thirteen deployments, the briefs and the solution are written independently. The subject —
computations that run inside a primitive versus on top of one, and what breaks where they meet
— is the one the course's own README names, so nothing here is a shortcut through an exercise.

## Assurance scope

Local mode is **self-paced, honor-system verification**. You own the machine, the Docker daemon,
and the image, so nothing inside that image is out of your reach: `reference/` and
`tests/hidden/` are not bind-mounted, which keeps them out of your git checkout rather than out
of your way. The same is true of the ground-truth functions the hidden checker compares against
— a model that imports them has modelled nothing, and only you can decide not to.

What the verifier does guarantee is narrower and real: a submission cannot hang or crash it, a
checkpoint can only credit the id it echoes, results do not leak expected values, and the field
each case works in, the statement a proof is about, the program a journal names and the six
briefs all come from this deployment's seed, so a memorized answer does not carry.

That supports self-study and honest practice. It does **not** support competition ranking,
examination, or completion certification — those need a verifier the participant does not
administer, tracked in [#271](https://github.com/susumutomita/TenkaCloudChallenge/issues/271).

## Cost

Zero. No cloud account, no AWS resources.

## For authors

`make reference-test` runs the mutation suite inside the image: 53 broken stacks plus one aimed
at the verifier itself. It first confirms that the reference clears all nine hidden phases, then
breaks the reference fifty-three ways and prints how many of them still get the easy two right.
That count is the number this README quotes — if a later edit makes the checkpoints cheaper, the
number moves and the claim has to move with it.
