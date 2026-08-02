# Every part is correct. What you built out of them is not

A primitive can only check the **shape** of what it was handed. An MPC engine sees that something is a share and not that it was supposed to be secret. A zkVM says the guest ran and not that its journal is about the program you are holding. Every component's test passes and the architecture is broken. Diagnose that **composition failure** from nine angles.

Week 6's last problem and the track's synthesis. The five before it each built one **working part**. This one is about the wiring between them.

It starts from one line:

```text
a primitive can only check the shape of what it was handed
```

That is not a criticism of primitives. It is what a primitive is. An MPC engine verifies that what arrived is a share; it has no way to know whether that share was supposed to be secret, which field the party on the other end thinks it is in, or whether the open policy ever approved reconstructing it. A zkVM verifies that the guest ran; it does not verify that its journal is about the program the reader is holding. An FHE evaluation is correct under whatever key it was given, and cannot tell you the key was the wrong one.

So **every component's test passes, and the architecture is broken anyway**.

## Three levels of contract

```text
LICENCE      what a transformation may change
policy       which nodes this architecture allowed to hold such a transformation
obligations  what it promised to deliver, and on which wire
```

They are three levels rather than one. A licensed change is not a correct change — a key switch is authorised to change the key domain, and being authorised to change it is not being right about what to change it to. And authorising the box that broke the rule satisfies every contract in one move. That is not a repair; that is the deployment writing its own acceptance criteria.

## Thirteen deployments

Every seed draws three sound architectures and thirteen deployments that differ from one of them in **exactly one place**. Eleven of them step on exactly one of the eleven boundary classes. The twelfth puts an operation on a node nobody approved to hold it. The thirteenth **breaks no contract at all** — every boundary holds and a primitive is left holding a shape it has no way to consume. It exists to say in one deployment that a contract is not a substitute for a design review.

## On scoring

This problem ships 53 deliberately broken stacks, and **47 of them still answer the two questions anybody writes first** — does a sound architecture come back with nothing wrong with it, and does a broken one come back with something. `make reference-test` re-measures that count on every run. Both are stated outright in the problem text and nobody has to discover them. The rest is why there are checkpoints.

## Why eight checkpoints and not nine

Issue #244 asks for nine. The multi-verify cap is eight, enforced catalog-side in SCHEMA.json and again in the platform's `packages/problem-sdk`, and a ninth is **not truncated — the whole scoring object is dropped**, which would take the other eight down with it and leave the problem unscorable. So two of the nine share a checkpoint. Not because they were adjacent on the list: reading what each wire is carrying and knowing where the primitive's guarantee stops are the same act of reading the typed graph. There are still nine hidden phases; only `dataflow` runs two.

## Browser workflow

1. Start the problem in the Participant Portal and open **Browser Workbench**.
2. Run `inspect` and read the deployment-specific fixture and published evidence.
3. Edit the starter sources on the page and run the public `test` command.
4. Complete any direct-answer fields from the evidence and your experiments.
5. Run `prepare`, then paste every generated value into the matching Portal checkpoint.

Direct answers are bound to the current deployment seed by `prepare`.

## Learning goals

- Tell a primitive's implementation apart from the application computation running on top of it
- Compare where a zkVM guest, a prover computation over MPC and an encrypted evaluation actually run
- Track the domain of a public input, a private witness, a secret share, a ciphertext and a proof artifact
- Judge correctness, soundness, privacy, binding and availability as separate end-to-end properties
- Keep what an operation may change (licence) apart from which node may hold it (policy)
- Check what an architecture promised to deliver separately from what it was licensed to change
- Apply the merge rules for classification, identity and everything else at a fan-in node
- Detect serialization, field, key and statement mismatches between primitives
- Show with a counterexample that safe primitives do not make a safe composition
- Find the boundary that broke first in the order the value arrives, not the first symptom
- Recover a property with the fewest changes, without editing the policy or the promises
- Treat trust-domain separation and a communication budget as boundaries about placement rather than about values
- Derive primitives, public information, secrets, trust assumptions and dominant cost from a use case
- Confirm every one of those judgements on a deployment you have not seen

## Checkpoints

| Checkpoint | Purpose | Points |
| --- | --- | ---: |
| `dataflow` | What is crossing that wire, and where the primitive's guarantee stops |  |
| `properties` | Which wire carries which property |  |
| `contracts` | There are five kinds of breach, and they really are five |  |
| `diagnosis` | Which one broke first |  |
| `counterexample` | Lose one without breaking a single component |  |
| `repair` | Put it back without lowering the requirement |  |
| `selection` | Choose a stack for something nobody has built yet |  |
| `transfer` | A field, a statement, a program and a brief you have not seen |  |

## Explanation

## What a component cannot check

An MPC engine verifies that what arrived is a share. It cannot verify that the share was supposed to be secret, that the party on the other end works in the same field, or that the open policy ever approved reconstructing it. A zkVM verifies that the guest ran and not that its journal is about the program the reader is holding. An FHE evaluation is correct under whatever key it was given and cannot say the key was wrong.

All nine angles in this problem follow from that one line.

## Keep the three levels apart

`LICENCE` is a fact about an operation. `policy` is a fact about who may perform it. `obligations` is a fact about what was promised. That they are three separate facts is what the repair checkpoint is about: authorising the node that opened the secret satisfies every contract in one move, and it is not a repair. Deleting the obligation it failed to keep is the same trick.

## Fan-in has its own rules

A node with two inputs is not transforming a value. It is **merging** two.

```text
classification  secret wins, because a function of a secret is a secret
identity        may be carried forward but never invented
everything else every input that carries one has to agree
```

`zkvm-exploit` makes it concrete: a public statement and a secret witness meet at one node, and the value that leaves is secret and is about the statement. A contract that compared the output against each input separately would call that edge two violations — a model that cannot express the architecture it is modelling.

## "First" is not id order

A stack fails once and then keeps failing. Every downstream symptom is real, and a repair aimed at one of them does nothing. In three of the deployments, the first edge in the order the value arrives and the first edge in id order are **different edges**. A solution that leans on the coincidence is a solution to a smaller problem.

## A counterexample is not "break something"

A component's own check is the whole of `CONSUMES`: it reads the **shape** of what arrived and nothing else. Classification, key domain, identity and dialect all travel through unread. So one change is enough to lose an end-to-end property **with every component still content**. A counterexample here is not that something stopped working. It is that nothing was ever looking.

## The fifth property

The property map returns five keys. One of them is carried by no wire in any of the three architectures, because nothing you can do to a value in flight costs it — losing it means putting the computation somewhere else. The empty tuple is its answer. **An audit that always finds something has not read anything.**

## The deployment that breaks no contract

One of the thirteen has every boundary holding and a primitive holding a shape it has no way to consume. Nothing unlicensed was changed, no promise was broken, and it does not run. That is why the repair checkpoint asks for two things separately: every contract holding, and every component able to run what it was handed. A repair that stops at the first has made a contract into a substitute for a design review.

## Measured

This problem ships 53 deliberately broken stacks, and **47 of them still get the easy two right** — nothing wrong with a sound architecture, something wrong with a broken one. `make reference-test` re-measures it on every run. Both categories are written out in the problem text; nobody has to discover them.

## What the suite proves, and what it does not

It proves that these eight checkpoints catch the 53 defects shipped with the problem, that the reference clears all of them, and that the shipped starter clears none. It does **not** prove that the model has no other hole.

## Toy versus production

Eight or nine nodes, seven to nine edges, five attributes, eleven boundary classes. A real stack has hundreds of nodes, an attribute for every parameter of every proof system and ciphertext scheme in it, and as many boundary classes as that deployment bothered to write down. The claim is that boundary contracts can be written as exact rules, not that the ones written here are complete.

## Not in scope

Actually running MPC, a zkVM or FHE; the security proof of any specific protocol; the soundness of a proof system; production key management; network-level availability.

## Authoring and validation

Participants do not need a checkout. Repository maintainers use the Makefile author targets and CI as the validation source of truth.
