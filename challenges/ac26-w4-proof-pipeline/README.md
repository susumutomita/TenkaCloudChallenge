# One box with nine layers

"SNARK" and "STARK" name families, not protocols. Read two toy pipelines as stage graphs, write one contract per layer, and find the first layer that broke in runs where exactly one thing is wrong.

## Browser workflow

1. Start the problem in the Participant Portal and open **Browser Workbench**.
2. Run `inspect` and read the deployment-specific fixture and published evidence.
3. Edit the starter sources on the page and run the public `test` command.
4. Complete any direct-answer fields from the evidence and your experiments.
5. Run `prepare`, then paste every generated value into the matching Portal checkpoint.

Direct answers are bound to the current deployment seed by `prepare`.

## Learning goals

- Tell a statement, a public input, a witness and a trace apart
- Read a pipeline as an artifact graph and explain the boundaries between stages
- Keep commitment success and constraint satisfaction separate
- Explain how challenge timing and transcript binding bear on soundness
- Point at openings and queries the verifier never checked
- Classify trusted and transparent setups as security assumptions
- Compare succinctness, proof size and prover cost as separate axes
- Find the first faulty layer behind a cascade of downstream failures and repair it

## Checkpoints

| Checkpoint | Purpose | Points |
| --- | --- | ---: |
| `graph` | Map the artifact flow |  |
| `wiring` | Decide who may see what |  |
| `constraints` | Separate committed from correct |  |
| `transcript` | What was absorbed before the challenge |  |
| `opening` | Find the opening nobody checked |  |
| `assumptions` | Put setup and assumptions in different columns |  |
| `cost` | Reject only the unsupported claims |  |
| `diagnose` | Name the first broken layer and fix it |  |

## Explanation

## A successful commitment is not a satisfied constraint

`commitment_ok` is True in every run here, including the ones that accepted with an unsatisfied constraint. A commitment succeeding says the prover committed to something. Whether what they committed to satisfies the constraint system is a separate claim and needs a separate check.

The commitment has a second job as well. Any artifact the commit stage was handed but did not commit to is free for the prover to change afterwards. Setup material is the one exception, because it is public and fixed before the run, so committing to it would bind nothing that is not already bound. Be able to say why it is an exception rather than special-casing it by name.

## Transparent is a property of the setup

B is transparent and rests on a collision-resistant hash and a random oracle. A has a trusted setup and rests on the SRS not being retained and on pairing hardness. Neither assumption list is empty. Transparency is about what the setup requires, not about whether there are assumptions.

The same confusion shows up on the cost side. Succinctness is about proof size and verifier time; it says nothing about prover cost. A's proof is constant size and A's prover is superlinear, and those two facts do not contradict each other.

## Report the earliest layer

A broken input boundary makes the openings, the transcript, and the verifier all look wrong. The diagnosis has to name the earliest layer, because pointing at the openings sends somebody to repair a stage that was doing its job. Read the layer order off the definition's stage list -- copying A's order either drops B's low-degree layer or puts it in the wrong place.

## A repair changes one field

A repair may change only the field the fault damaged. Without that, two shortcuts pass everything: rebuilding a clean run from the definition satisfies every contract while destroying the evidence, and setting the verdict to `reject` silences every contract at once.

There is one exception. An unsatisfied constraint cannot be made satisfied by editing the record, so there the correct repair *is* for the verifier to reject. That the exception is exactly one, and why it is that one, is the core of the checkpoint.

## The two pipelines are not the same shape

Stage count, stage names, layer order, query minimum, which artifacts exist -- all different. B has a low-degree layer and A does not. Applying a contract for a layer A does not have fails every honest A run. Write each contract starting from "if this pipeline has this stage".

## Not in scope

No Groth16, PLONK, or STARK implementation; no benchmark numbers; no setup ceremony; no proof-generation service. Every cost here is a declared class rather than a measurement.

## Week 4 alignment

Week 4's material was not published upstream at the pinned commit. `courseAlignment` pins `week4/README.md` with `kind: "placeholder"` and takes the `transfer` role -- one of the two GOVERNANCE.md section 6 permits for an unpublished week, and accurate besides, since the problem transfers Week 4's arithmetization and commitment into a new setting. It asserts nothing about what the official exercise will require.

## Authoring and validation

Participants do not need a checkout. Repository maintainers use the Makefile author targets and CI as the validation source of truth.
