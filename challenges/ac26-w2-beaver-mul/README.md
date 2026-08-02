# Multiplication is the one that has to talk

Multiplying two shared values is the one thing that cannot finish locally. A triple made in advance pushes the talking down to a single round — and the last of the four terms wants different treatment from the other three.

## Browser workflow

1. Start the problem in the Participant Portal and open **Browser Workbench**.
2. Run `inspect` and read the deployment-specific fixture and published evidence.
3. Edit the starter sources on the page and run the public `test` command.
4. Complete any direct-answer fields from the evidence and your experiments.
5. Run `prepare`, then paste every generated value into the matching Portal checkpoint.

Direct answers are bound to the current deployment seed by `prepare`.

## Learning goals

- Mask a secret with a preprocessed value and open the difference safely
- Assemble a sharing of x*y from the opened values by a linear combination
- Explain why the public scalar d*e is folded in by exactly one party
- State that a Beaver multiplication costs one round of communication
- Explain that preprocessing moves multiplication cost offline rather than removing it

## Checkpoints

| Checkpoint | Purpose | Points |
| --- | --- | ---: |
| `mask` | Hide a secret behind a preprocessed value |  |
| `open` | Publish the masked difference |  |
| `combine` | Build the product from the two published values |  |
| `protocol` | Run it end to end and state the rounds |  |
| `transfer` | Hold up in settings you have not seen |  |

## Explanation

## What the preprocessing actually moved

A Beaver triple (a, b, c) only has to satisfy c = a*b. It depends on neither x nor y, so it can be manufactured before the event, or in any idle stretch. What remains online is masking (local), opening d and e (one round), and a linear combination (local). The cost of multiplication did not disappear; the input-independent part of it moved offline.

## Why d and e are safe to publish

The a in d = x - a is a uniform value made during preprocessing that nobody holds in the clear. So d is x under a one-time mask, and publishing it reveals nothing about x. Reuse the triple and the same a masks two different secrets, at which point that property is gone. That is why each multiplication consumes its own triple, and why the offline cost scales with the number of multiplications.

## The last term

c + d*b + e*a is linear in the shares, so each party computes its own row. d*e is not a sharing at all — it is a public scalar, and exactly one party folds it in. If every party adds it, the set sums to x*y + (n-1)*d*e. It is the same rule as adding a public constant in the previous problem, arriving mid-protocol where it is far easier to miss.

That mistake is indistinguishable from correct at n = 1, and also whenever d or e happens to be zero. The hidden fixtures force d != 0 and e != 0 precisely so the wrong answer stays observable. That is a choice made for observability, not a realistic mask distribution.

## The round count

d and e can be opened together, so one Beaver multiplication costs one round of communication. Not zero — preprocessing does not buy silence. A multiplication circuit of depth D costs D rounds, which is why MPC latency tracks multiplicative depth rather than gate count.

## Where this leads

With multiplication in hand, any arithmetic circuit can be evaluated under MPC. What is left is which openings leak what, and that is the last two problems of Week 2.

## Authoring and validation

Participants do not need a checkout. Repository maintainers use the Makefile author targets and CI as the validation source of truth.
