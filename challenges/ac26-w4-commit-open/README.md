# Ask me first and I can pass anything

A proof system's skeleton is three steps and their order: commit, challenge, open. Reverse the first two and the prover only has to be right where they already know they will be checked.

## Browser workflow

1. Start the problem in the Participant Portal and open **Browser Workbench**.
2. Run `inspect` and read the deployment-specific fixture and published evidence.
3. Edit the starter sources on the page and run the public `test` command.
4. Complete any direct-answer fields from the evidence and your experiments.
5. Run `prepare`, then paste every generated value into the matching Portal checkpoint.

Direct answers are bound to the current deployment seed by `prepare`.

## Learning goals

- Tell a commitment, a challenge and an opening apart
- Show by counterexample why the challenge must follow the commitment
- Verify an opening from a root and an authentication path
- Bind the index, the value and the direction into the commitment
- Explain why binding and hiding are different properties
- State what has to go into the challenge's transcript
- Explain why one opening says nothing about the other rows

## Checkpoints

| Checkpoint | Purpose | Points |
| --- | --- | ---: |
| `encoding` | Make one leaf mean one thing |  |
| `root` | Build the commitment |  |
| `opening` | Open one position and verify it |  |
| `order` | Enforce the order |  |
| `adaptive` | Show what a challenge-first protocol allows |  |
| `ambiguity` | Show the encoding ambiguity with a counterexample |  |
| `transcript` | Derive the challenge from the transcript |  |
| `transfer` | Hold up in a setting you have not seen |  |

## Explanation

## The order is the protocol

A commitment only says "this cannot be changed later". What gives it meaning is that the challenge arrives **after** it. Reverse them and the prover only has to be right where they already know they will be checked. The vector built in the `adaptive` checkpoint is wrong in fifteen of sixteen positions and its opening verifies.

## What has to be in a leaf

**The index.** Without it a leaf makes no claim about where it came from, and the prover can present it as having come from wherever suits.

**Field boundaries.** Run the index and value together and `(1, 23)` and `(12, 3)` both render as "123": two different claims, one commitment. The weak encoding lives in the fixtures — breaking code you deliberately weakened yourself is not a counterexample.

**Direction.** Without knowing which side each sibling is on, a verifier can hash `(sibling, node)` or `(node, sibling)`, and the prover picks whichever reaches the root.

## A note on equivalent mutants

The index-range and path-length checks in `verify_opening` cannot be caught if removed. `LEAF_TAG` and `NODE_TAG` already mean a leaf hash never equals a node hash, so a path of the wrong length recomputes to something that is not the root and the comparison rejects it anyway. They are not in the mutation suite.

The range check in `Session.receive_challenge` is mutated instead — there a negative index silently wraps and the prover opens a row nobody asked about, which is detectable.

Leaving an unkillable mutant in the list teaches that a "SURVIVED" line can be ignored. So it is not left in.

## This is not a polynomial commitment

A Merkle root commits to a vector. It does not prove anything about a polynomial's evaluation, and one opening says nothing about the rows nobody asked about. There is a single query here, so a guessing prover wins with probability 1/length — soundness amplification is not covered.

## Binding and hiding are different

A Merkle root gives binding. It does not give hiding: with a small value space, the contents can be recovered from the root by brute force. Hiding needs separate randomness in each leaf.

## Authoring and validation

Participants do not need a checkout. Repository maintainers use the Makefile author targets and CI as the validation source of truth.
