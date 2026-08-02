# Split it, and still nobody knows

Split a secret across n parties. Add them up and it comes back. If that were all, it would not be cryptography. Show, with evidence, that holding n-1 of them tells you nothing.

## Browser workflow

1. Start the problem in the Participant Portal and open **Browser Workbench**.
2. Run `inspect` and read the deployment-specific fixture and published evidence.
3. Edit the starter sources on the page and run the public `test` command.
4. Complete any direct-answer fields from the evidence and your experiments.
5. Run `prepare`, then paste every generated value into the matching Portal checkpoint.

Direct answers are bound to the current deployment seed by `prepare`.

## Learning goals

- Implement additive secret sharing over a finite field
- Confirm the secret returns only when every share is present
- Actually demonstrate that n-1 shares carry no information about the secret
- Explain why a trivial split is not a sharing
- Refresh the shares without changing the secret

## Checkpoints

| Checkpoint | Purpose | Points |
| --- | --- | ---: |
| `share-and-reconstruct` | Split it, collect it, get it back |  |
| `hides-the-secret` | Show that a short set says nothing |  |
| `threshold` | Answer how many are needed, with witnesses |  |
| `rerandomize` | Refresh the shares without moving the secret |  |
| `transfer` | Hold up in settings you have not seen |  |

## Explanation

## Adding up to the secret is not yet anything

The arithmetic of additive sharing takes a few lines. What makes it worth anything is that n-1 shares carry no information about the secret — and that is something to demonstrate, not assert.

## An executable definition of 'it does not leak'

If, holding the same n-1 shares, you can produce a consistent final share for *every* secret in the field, then those n-1 shares are not evidence about the secret. `complete_shares` succeeding across the whole field is the proof. That is the footing for talking about Week 6's over-opening in terms of why it is bad, rather than as a rule.

## A trivial split is not a sharing

Hand the secret to party 0 and give everyone else zero: the sum still works and the round-trip test still passes. Party 0 knew everything from the start. The hidden tests reject that case explicitly, because the gap between 'the test passes' and 'the property holds' shows up here in the same shape as everywhere else in this track.

## Rerandomizing

Add a set of offsets summing to zero and the secret is unchanged while every share moves. Real protocols use this so a set of shares cannot be linked across rounds. It is checked as a relation — secret preserved, every element moved — not against a fixed expected list.

## Authoring and validation

Participants do not need a checkout. Repository maintainers use the Makefile author targets and CI as the validation source of truth.
