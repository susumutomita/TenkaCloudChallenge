# Review how cryptographic components are connected

> An independent, unofficial companion to the Advanced Cryptography Program 2026.
> Not affiliated with or endorsed by the course or its operators. The graph model,
> examples and implementation are independently authored. Direct questions here to TenkaCloud.

**Track:** advanced-cryptography-2026 · **Order:** 660 · **Role:** synthesis ·
**Time:** 90–120 minutes · **Points:** 300 · **Status:** draft

## Participant outcome

The participant reviews a diagram of connected cryptographic components by implementing
`local/starter/stack.py`. Each arrow has six labels: representation, public/secret
classification, arithmetic domain, key domain, claim/program identity, and serialization.
The free JA/EN statement defines these terms, all supplied tables and APIs, the input/output
contracts, and a two-wire example:

```text
source --e1:secret--> pass-through --e2:public--> receiver
                                  ^ expected secret, observed public
```

This is a labelled graph model. Its local component check inspects representations only;
that is a teaching assumption, not a definition of real cryptographic primitives. The task
separates local acceptance from the design's additional connection promises. No real MPC,
ZK, zkVM or FHE computation, security proof or performance benchmark runs here.

## Route and feedback

1. Start the problem in Participant Portal and select **Inspect evidence**.
2. Read the small diagram in the statement, edit `carried`, then **Run public tests**.
   `PASS test_carried_matches_the_two_wire_example` is the first concrete progress marker.
3. Implement the shared five contract checks, then `underwrites`, which uses them. Submit
   **dataflow**; a correct matching verdict is displayed as **Solved** by Portal.
4. Implement the remaining functions and submit their checkpoints independently. A partial
   source can pass one checkpoint while tests for unfinished functions still fail.

All required vocabulary, formulas/rules, API names and candidate sets are free. Each of the
eight checkpoints has three optional hints: mechanism, a small example, and actions using
actual editor/evidence names. Each hint costs 2 points: all 24 total 48 points, within 300.
A wrong checkpoint submission costs 15 points. There are no direct-answer text fields here;
Portal prepares and submits the current `stack.py` source.

| Checkpoint | Points | Contract |
|---|---:|---|
| `dataflow` | 45 | Required labels on every edge and conditional coverage of every node |
| `properties` | 30 | Map all five properties to the relevant edge IDs |
| `contracts` | 50 | Carry, obligation, authorization, separation and communication checks |
| `diagnosis` | 30 | First failure among edges whose inputs have arrived |
| `counterexample` | 45 | Exactly one allowed change that loses a property with local checks passing |
| `repair` | 45 | Zero changes if sound, otherwise one, preserving requirements and local acceptance |
| `selection` | 30 | Combine technologies, publication, secrets, assumptions and model cost |
| `transfer` | 25 | Reuse the same implementation under new names, parameters and briefs |

The construction checkpoints retain the high ceiling: the participant must choose a valid
counterexample or minimal repair under preserved policy and obligations, not just transcribe
an example or return a preselected edit. Selection applies three independent conditions;
its trust and cost tables are explicit teaching assumptions, not universal recommendations.

## Runtime and boundaries

Docker Compose runs two services. Workbench listens only on `127.0.0.1:18118`; the verifier is
unpublished on an internal network. Workbench exposes the existing editor configuration,
starter, public evidence, public tests and prepare/verify routes used by Portal. Its image
contains the completed vocabulary/accessors in `participant/lab.py`, not fixtures, hidden
checks or the reference. The verifier supplies public diagram data separately and grades
submitted source with time, process, memory and output limits. These limits and the image
split are operational boundaries, not a claim that arbitrary code has a proven sandbox.

Local verification is self-paced, honor-system use: the owner of the Docker host can build
the author/verifier images and read their contents. Competition ranking requires a verifier
participants do not administer. The platform boundary, scoring protocol and all other
problems are unchanged by this rewrite.

Counterexample and repair submissions may edit their argument in place or return a copy.
The checker retains the original input before calling either function, so it accepts a valid
in-place construction and still rejects edits that relax policy or obligations.

## Local commands

From this problem directory, with Docker available:

```sh
make inspect
make test
make test-one ID=carried_matches
make reference-test
make verifier-down
```

`make test` runs the 15 public previews against the shipped, unfinished starter, so failures
are expected before implementation. The three small-example tests inspect actual required
labels, conditional node coverage and publication violations; the other previews cover
shapes and selected happy paths. Passing them is not proof of a complete solution.

From the repository root:

```sh
make install
make agent-gate
```

The local commands create Docker images, containers and networks, not AWS resources. They
consume host CPU/RAM/disk; any hosting VM still has its own cost. `make verifier-down` removes
the Compose containers and networks. Images remain in the Docker cache.

## Validation recorded for this rewrite

- Host and Docker `make reference-test`: reference passes all nine grading phases (eight
  checkpoints); **56 mutations rejected**: 55 deliberately wrong stack implementations and
  one verifier-result spoof. **49 of 55** wrong implementations still pass the weak two-case
  probe, illustrating why happy-path tests alone are insufficient.
- Four author regressions: valid in-place counterexample and repair accepted; in-place policy
  relaxation rejected in both checkpoints.
- Running Workbench: JA/EN configuration, Inspect evidence and starter retrieval; unfinished
  starter fails its first example; a free-contract `carried` edit passes that preview while
  unfinished `underwrites` prevents dataflow success; an independent `selection` implementation
  is accepted without completing the other functions.
- Author reference through Workbench: **15 public tests and all eight checkpoint verdicts**;
  a policy-relaxing repair is rejected with the preservation condition.
- Catalog gate: **116 problem bundles**. `git diff --check` passes.
- The ordinary `make test` command in this `/private/tmp` checkout failed with
  `ModuleNotFoundError`: a read-only inspection confirmed that Colima saw an empty starter
  bind mount. The Workbench file-upload route ran the same public suite successfully.
  Host bind-mount execution was therefore not verified in this environment.
- A separate participant-only read identified four ambiguities (identity candidates, omitted
  obligations, the `none` return value and the first checkpoint's dependency). JA/EN statements
  and starter now define them explicitly.

The first-edit API run uses the free contract, but was performed by the author; it is not an
independent playtest. Reference runs prove regression behavior, not beginner comprehension.
This records Workbench HTTP behavior, not browser rendering, Portal's persisted points or a
live AWS deployment. Those were not exercised here. Finite mutation coverage does not prove
that the model or grader has no other defect.

## Source alignment

The existing course alignment pins the Week 6 README at
`a3aa4b56fa88fbe803b57d320fbc87c1a203b480`. This problem independently models the topic of
computations inside a primitive, application computations above it, and their connection
contracts. It does not reproduce course exercises or provide their solutions.
