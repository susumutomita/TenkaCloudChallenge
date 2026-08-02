# (0, 0) is not the point at infinity

Verify by building it that the points of an elliptic curve over a finite field form a group, exceptional cases included. Most of the toy curves here contain (0, 0), so an implementation that borrows it for the identity cannot tell the identity from a real point.

## Browser workflow

1. Start the problem in the Participant Portal and open **Browser Workbench**.
2. Run `inspect` and read the deployment-specific fixture and published evidence.
3. Edit the starter sources on the page and run the public `test` command.
4. Complete any direct-answer fields from the evidence and your experiments.
5. Run `prepare`, then paste every generated value into the matching Portal checkpoint.

Direct answers are bound to the current deployment seed by `prepare`.

## Learning goals

- Decide whether a point is on the curve
- Represent the identity so that it cannot be confused with a real point
- Confirm the inverse and P + (-P) = O
- Explain why adding distinct points and doubling use different slopes
- Handle the exceptional cases, including points with y = 0
- Implement scalar multiplication by double-and-add
- Verify the group axioms and the homomorphism as properties
- Confirm the same abstraction works on a toy curve and on secp256k1

## Checkpoints

| Checkpoint | Purpose | Points |
| --- | --- | ---: |
| `on-curve` | Decide what is on the curve |  |
| `identity` | The identity and the inverse |  |
| `add` | Add two different points |  |
| `double` | Add a point to itself |  |
| `scalar` | Multiply by k with double-and-add |  |
| `trace` | Show what each bit did |  |
| `properties` | Hold the axioms on a curve you have not seen |  |
| `secp256k1` | Run the same abstraction on real parameters |  |

## Explanation

## Why (0, 0) cannot be the identity

Most of the toy curves here have b = 0, and then (0, 0) satisfies y^2 = x^3 + ax. It is a real point on the curve, and since y = 0 it has order two. Borrow that coordinate for the identity and the two become indistinguishable.

"It is the point at infinity, so (0, 0) will do" genuinely breaks on the right curve. The hidden tests pick curves where (0, 0) is on the curve and check by name that it does not compare equal to the identity.

## Four cases, not one formula

1. either side is the identity, so return the other;
2. same x, opposite y, so the result is the identity (this includes doubling a point with y = 0);
3. the same point, so the slope is the tangent's, (3x^2 + a) / 2y;
4. anything else, so the slope is the chord's, (y2 - y1) / (x2 - x1).

Writing case 3 as a special case of case 4 gives 0/0. Doubling has its own formula not for speed but because the chord is not defined there.

## Exhaustive, not sampled

The curves are small, so the checks are exhaustive: every coordinate pair is classified, every ordered pair of distinct points is added, every point is doubled, and the group axioms are checked over the whole group. There is nowhere for an implementation that only handles the generic case to hide.

## How the trace catches bit order

Double-and-add consumes bits least significant first. Immediately after step i, the accumulator must equal the number formed by the low i+1 bits, times P. The trace checkpoint verifies that on every row, so an implementation consuming bits the other way fails on the first one. Getting only the final answer right is not enough.

## What the secp256k1 checkpoint actually checks

The last checkpoint runs the same abstraction over the published standard parameters. Every relation it checks follows from the definition of those parameters rather than matching a value copied from somewhere:

- G is on the curve;
- n is the group's order, so n*G is the identity;
- therefore (n-1)*G = -G and (n+1)*G = G;
- (k+m)G = kG + mG.

No transcribed expected value is needed, so no mistyped or unsourced constant can creep in.

## Not constant-time

Double-and-add branches on the scalar's bits, and how many additions it performs depends on how those bits fall. Against a real key that property is itself a side channel. The goal here is a legible algorithm, not a model for production.

## Where this leads

The next problem builds Schnorr. Its verification equation is nothing but scalar multiplication and point addition, so this group is the floor it stands on.

## Authoring and validation

Participants do not need a checkout. Repository maintainers use the Makefile author targets and CI as the validation source of truth.
