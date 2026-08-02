# How far can it be pushed

A homomorphic ciphertext puts a message on a ring and pushes it off the spot. Decryption is "which spot was it nearest to", so every correctness question reduces to how far it can be pushed — a distance you can compute before running anything.

The first Week 5 problem, and the one the rest of the week's noise budget rests on. A homomorphic ciphertext hides a message by putting it somewhere on a ring and then pushing it off that spot; decryption is "which spot was this nearest to". Every correctness question reduces to how far it can be pushed, and that distance is a number you compute before running anything.

Nothing about the model is hidden. A message m lives in [0, p), a scaling factor D spreads the message space across the ring q = p*D, encode(m) = (m*D) mod q, and decode returns the message whose encoding point the value is nearest to. p, D and q change between checkpoints, so anything hardcoded is wrong somewhere.

The difficulty is in three places a worked example never reaches. Ties round up, and once that is decided the tolerated noise interval stops being symmetric: with D even the exact half-way point rounds onto the next message, so the upper end is one short. Negative noise needs no special case, because Python's % already returns a non-negative result for a positive modulus, so taking its absolute value is a different function. And the point past the last message is message 0, not message p, which only two of the p messages notice.

The scoring is split deliberately: success_interval is graded against the parameters, never against the submission's own decoder. An interval measured by sweeping every noise value agrees with whatever decoder measured it, so a wrong decoder and a wrong interval would pass together.

None of this is secure. p and q are small enough to enumerate by hand, which is the only reason the boundary is visible at all. Toy correctness and production security are separate claims and this problem makes only the first.

## Browser workflow

1. Start the problem in the Participant Portal and open **Browser Workbench**.
2. Run `inspect` and read the deployment-specific fixture and published evidence.
3. Edit the starter sources on the page and run the public `test` command.
4. Complete any direct-answer fields from the evidence and your experiments.
5. Run `prepare`, then paste every generated value into the matching Portal checkpoint.

Direct answers are bound to the current deployment seed by `prepare`.

## Learning goals

- Tell the message space, plaintext modulus p, ciphertext modulus q and scaling factor apart
- Implement a toy encoding and decoding
- Explain on the ring how noise moves an encoded point
- Move between the centered and the modular representative
- Compute the rounding boundary and predict the decoding range before running it
- Show by counterexample that correctness is lost once noise crosses the boundary
- State plainly that toy parameters carry no security

## Checkpoints

| Checkpoint | Purpose | Points |
| --- | --- | ---: |
| `encode` | Put the message on the ring |  |
| `noise` | Push it off, and read the sign |  |
| `decode` | Pick the nearest point |  |
| `interval` | Say the tolerated width first |  |
| `first-failure` | Find the first noise that breaks it |  |
| `transfer` | Hold up under parameters you have not seen |  |
| `validate` | Refuse an unusable parameter set |  |

## Explanation

## The interval is not symmetric

Which way an exact half-way value rounds is a decision that has to be made, and this problem fixes it as rounding up. Once it is made, the tolerated noise interval stops being symmetric.

With `delta` even there is an exact half-way point; it rounds up onto the next message, so the upper end is `delta // 2 - 1` rather than `delta // 2`. With `delta` odd there is no half-way point and the interval is symmetric. `(-(delta // 2), delta - delta // 2 - 1)` produces both from one expression. An implementation that branches on the parity is admitting it only tested one of them.

## A measured interval agrees with whatever the decoder does

Measure `success_interval` by trying every noise value and the measurement matches the decoder, whatever the decoder does -- a wrong decoder and a wrong interval agree with each other and both pass. So the interval is derived from the parameters, and the hidden tests check the decoder against a fixture-derived interval and the interval against a fixture-derived decoder, separately. Splitting prediction and measurement into two checkpoints is the same idea.

## Negative noise needs no special case

Python's `%` returns a non-negative result for a positive modulus, so `(c + e) % q` is already right when `e` is negative. Taking `abs(e)` is a different function, and a round-trip test starting from exact points can never see the difference.

## Only two messages notice the wrap

Noise above the largest message lands on 0; noise below message 0 lands on p - 1. A `first_failure` that reports `m + 1` and `m - 1` is right for p - 2 of the p messages. The other two are the whole point.

## Noise is not padding

Noise is what the security rests on and what the correctness spends. Every unit buys hardness and costs headroom. "More is safer and free" and "random filler" both drop one half of that. The interval computed here is the budget the rest of Week 5 spends.

## This is not secure

p and q are small enough to enumerate by hand. A real parameter set hides the message behind a lattice problem; this one hides it behind nothing. Reading correctness here as evidence of production security is the opposite of what the problem teaches.

## Source alignment

Week 5's material is published upstream, so `courseAlignment` pins `week5/README.md` as `lecture` and `week5/problems/tfhe-toy-python/README.md` as `assignment`. `spoilerPolicy` is `independent-reimplementation`: the parameters are generated from the seed and the encoding rule is stated in full in the problem text, so nothing is copied from the official exercise's fixtures or its `solution.py`.

## Authoring and validation

Participants do not need a checkout. Repository maintainers use the Makefile author targets and CI as the validation source of truth.
