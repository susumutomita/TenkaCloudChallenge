# Multiply two values nobody holds, with one round of talking

Build [C] = [A] x [B] from a fresh Beaver triple in a single round. Only d and e are ever opened; the witness, A, B and C never become plaintext.

Week 6's second problem. The previous one (`ac26-w6-cosnark-linear`) built the linear half of a co-SNARK prover's row and it cost zero rounds. This is the other half -- **the one that has to talk**.

```text
A = sum_j a_j w_j        B = sum_j b_j w_j        C = A * B        (mod p)
```

`[A]` and `[B]` are handed over already built. The product of the sums is not the sum of the products, so no arrangement of local operations produces `[C]`. One round of communication is the price, and Beaver's trick is what makes it exactly one.

```text
[d] = [A] - [x]        [e] = [B] - [y]        both local
d, e opened                                   one round, two values
[C] = [z] + d*[y] + e*[x] + d*e
```

This is a transfer problem: `ac26-w2-beaver-mul` built the multiplication as general MPC, and here it goes into a co-SNARK prover one layer up. Spending the triple, batching d and e, and folding the public `d*e` at exactly one party -- Week 2's three lessons -- are what the prover's privacy rests on here.

The runtime is the same instrument as the previous problem's, and `open` is the only thing in it that communicates. A round is a **distinct roundId**, not an opened value, which makes "two values, one round" a measurement rather than a claim -- and it is what the `open` checkpoint grades. `reserve_triple` consumes: reserving the same triple twice raises, because the mask being uniform *exactly once* is the whole security of the step.

On scoring: this problem ships 31 deliberately broken implementations, and **24 of them reconstruct C to A * B on every shape**. `make reference-test` re-measures the count on every run. The one that matters opens `[A]` and `[B]` directly, multiplies in the clear, and re-shares the answer: it returns a perfect C at every seed and every shape, still costs one round, and still spends its triple. Measured, exactly **one** checkpoint kills it -- `audit` (plus `transfer`, which re-runs the same checks under another seed).

This is a toy and says so. The field is a small enumerable prime, there are two to five parties, the adversary is not semi-honest so much as absent, and a trusted dealer produces the triples. That dealer verifies `z = x*y` on its own work, which **a real protocol cannot do**: the parties hold only shares, and checking the product means reconstructing all three.

## Browser workflow

1. Start the problem in the Participant Portal and open **Browser Workbench**.
2. Run `inspect` and read the deployment-specific fixture and published evidence.
3. Edit the starter sources on the page and run the public `test` command.
4. Complete any direct-answer fields from the evidence and your experiments.
5. Run `prepare`, then paste every generated value into the matching Portal checkpoint.

Direct answers are bound to the current deployment seed by `prepare`.

## Learning goals

- Explain why only the non-linear part of a prover's relation needs interactive multiplication
- Check a fresh triple's field, party count and product, and spend it exactly once
- Build [d] = [A] - [x] and [e] = [B] - [y] with local operations only
- Batch d and e into one round, and tell round count apart from opening count
- Construct [C] = [z] + d[y] + e[x] + de, with the public constant folded in by one party
- Keep a proof artifact free of the witness and of any reconstructed A, B or C
- Tell a masked opening from an unmasked one in the record, and measure privacy from it
- Predict the communication-cost gap between a linear-only and a multiplicative relation
- Diagnose triple reuse, field mismatch and over-opening defects

## Checkpoints

| Checkpoint | Purpose | Points |
| --- | --- | ---: |
| `plan` | Count the talking before you do any |  |
| `triple` | A mask is uniform exactly once |  |
| `masks` | Cover the shared values. Nobody talks yet |  |
| `open` | Two values, one wait |  |
| `product` | Four terms, one of them unlike the others |  |
| `artifact` | The shape the next stage consumes |  |
| `audit` | Measure what was published, from the record |  |
| `transfer` | Hold up in a setting you have not seen |  |

## Explanation

## A correct C is not evidence of a correct prover

This problem ships 31 deliberately broken implementations, and **24 of them reconstruct C to A * B on every shape**. `make reference-test` re-measures that count on every run; if it moves, the number moves with it.

## Opening A and B first does not fail a single value test

Open `[A]` and `[B]` directly and you have the plaintext `A` and `B`. Multiply, re-share the answer. The `C` that comes out is perfectly correct at every seed and every shape, the round count is still one (put both openings under the same round id), and a triple is still spent. `prove_product`'s contract -- C is right, the schedule is one round -- is satisfied completely.

What is not satisfied is that the only values published were masked ones. Measured, exactly **one** checkpoint kills it: `audit` (plus `transfer`, which re-runs the same checks under another seed). The only thing that sees it is `maskedBy` on each opening record -- whether a reserved triple share was in that opening's ancestry.

That is what the claim "opening d and e reveals nothing about A and B" actually rests on. It rests entirely on the `x` in `d = A - x` being uniform **and used once**. An unmasked opening does not meet that condition, so the same `open` operation means something different. The runtime does not refuse it. It records it -- refusing would make the shortcut impossible rather than visible.

## What the audit proves, and what it does not

It proves that every value published on this runtime went out under a reserved mask, that no read was refused, and that triples were spent as the ledger says.

It does not prove that nobody ever saw A or B. As in the previous problem, opening each party's scope and reading that party's own share is legal, and doing it for every party gives you `A`. `Share._value` is one attribute access away besides. The runtime is an instrument, not a sandbox: it records what a computation published, not what its author looked at.

## "One round" is the answer, not a measurement

You knew the answer was one round before writing a line, so a report that returns `rounds: 1` earns nothing. The `open` and `product` checkpoints hand you a runtime that has **already opened something**. The right answer there is not 1; it is that this step added one.

A round not being an opened value is the same lesson. Two values in one round and two values in two rounds have identical output and differ only in latency -- which, in a real prover, accumulates once per multiplication layer in the circuit.

## A public constant is folded in by one party

`d*e` is a number everybody knows. There is no shared `[d*e]` to add. Adding it to every party's share gives a sharing of `value + parties*d*e`, which at two parties is off by exactly one `d*e`. The lesson Week 2 spent a checkpoint on comes back here as "C is not A * B", and the measured gap is exactly `(parties - 1) * d * e`.

## What happens if you use a triple twice

Nothing breaks. `C` comes out right. What breaks is the mask: hiding two values behind the same `x` publishes their difference. That is why `reserve_triple` raises on the second reservation rather than discouraging it in a docstring. "Triple reuse is a performance concern" survives as a belief precisely because nothing visible happens while it is only a performance concern.

## What the dealer checks and a real protocol cannot

`reserve_triple` verifies `z == x * y` before handing the triple over. **A real protocol cannot do that.** The parties hold only shares, and checking the product would mean reconstructing all three, destroying the mask they exist to provide. Real preprocessing spends a second triple to check the first (sacrificing), or generates triples with a protocol that is maliciously secure end to end. Here a trusted dealer checks its own work, and the limitation is stated rather than implied.

## No plaintext in the artifact

`[C]` is one `open` away from an integer satisfying `C = A * B`, which would look like a perfectly good proof artifact. It is not one. A real prover's next stage consumes a sharing, and a plaintext `C` publishes a witness-derived value for no reason. `d` and `e` are public and belong to the transcript; they do not belong to the artifact either.

Metadata is not decoration. An artifact that does not say which relation, which field and how many parties it is for cannot be checked against anything, and a `C` labelled with the wrong relation is a valid proof of a statement nobody made.

## Toy versus production

The field is a small enumerable prime, there are two to five parties, the adversary is absent, and a trusted dealer produces the triples. In a real co-SNARK, where the triples come from is the centre of the design, and the online phase's single round is a number that assumes that preprocessing exists. The cost did not disappear; it moved to the input-independent side.

## Not in scope

Actual proof encoding and verification, scheduling optimization across multiplication layers, malicious-secure triples, network transport.

## Authoring and validation

Participants do not need a checkout. Repository maintainers use the Makefile author targets and CI as the validation source of truth.
