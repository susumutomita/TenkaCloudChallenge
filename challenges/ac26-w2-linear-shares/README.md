# What you can do without talking to anyone

Some operations on shares can be done by every party alone, on its own share, with nobody talking. Which ones? Three are the obvious thing. One is not.

## Browser workflow

1. Start the problem in the Participant Portal and open **Browser Workbench**.
2. Run `inspect` and read the deployment-specific fixture and published evidence.
3. Edit the starter sources on the page and run the public `test` command.
4. Complete any direct-answer fields from the evidence and your experiments.
5. Run `prepare`, then paste every generated value into the matching Portal checkpoint.

Direct answers are bound to the current deployment seed by `prepare`.

## Learning goals

- Confirm that adding two sharings completes locally
- Confirm that scaling by a public constant needs no communication
- Explain why adding a constant to every share yields x + n*c
- Tell operations that need communication apart from those that do not
- Confirm that composing linear operations still yields a valid sharing

## Checkpoints

| Checkpoint | Purpose | Points |
| --- | --- | ---: |
| `add-shares` | Add two sharings |  |
| `add-constant` | Add a value everyone already knows |  |
| `mul-constant` | Scale by a value everyone already knows |  |
| `no-communication` | Name what needs no talking |  |
| `transfer` | Hold up in settings you have not seen |  |

## Explanation

## Why linear operations need no communication

With additive shares, adding two sharings and scaling by a public constant can each be done by a party looking only at its own share, and the result is already a valid sharing. That is what makes MPC practical. Communication is needed only where the sum of products is not the product of sums — multiplying two *shared* values.

## Why add-constant is the odd one

Adding a public constant is linear too, but if every party adds c to its own share the total becomes x + n*c. Exactly one party folds it in. The wrong version is indistinguishable from correct at n = 1, and off only by a multiple of c otherwise, so a test on one fixed setting can pass it by luck. The intuition 'it is linear, so everyone does the same thing' is wrong exactly once, and this is that once.

## Zero versus non-zero, not an exact round count

The classification checkpoint grades on whether an operation needs to talk at all, not on how many rounds. The round count of a multiplication protocol depends on the protocol; whether it must communicate does not. The scoring only bets on the part that is settled.

## Where this leads

The boundary you draw here is the motivation for Beaver triples. If multiplication is the only thing that needs to talk, the next question is whether that talking can be pushed into preprocessing.

## Authoring and validation

Participants do not need a checkout. Repository maintainers use the Makefile author targets and CI as the validation source of truth.
