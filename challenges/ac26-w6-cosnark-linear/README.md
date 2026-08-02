# Build half a proof over a witness nobody holds

Compute a co-SNARK prover's linear layer on a secret-shared witness, on shares. The witness is never assembled and not one round of communication happens.

Week 6's first problem. A co-SNARK proves a statement about a witness that **no single prover holds**: the witness is secret-shared across parties and the prover computation runs on top of MPC. What you write here is the half of that computation which costs no communication at all.

```text
A = sum_j a_j w_j        B = sum_j b_j w_j        (mod p)
```

`a` and `b` are public, `w` is secret. Under an additive sharing, `sum_j a_j [w_j]_party = [sum_j a_j w_j]_party` holds for each party independently, so scaling by a public constant and adding two same-party shares is the whole of it. Nobody sends anything. Multiplication, in the next problem, is where that stops being true -- which is why a co-SNARK's cost is counted in multiplications.

Week 2's two problems (`ac26-w2-secret-sharing`, `ac26-w2-linear-shares`) are supplied. What changes is the type of a share: Week 2 modelled a sharing as `list[int]`, and here a `Share` carries a party, a field and an id, and its value is read through a runtime. Once the lesson is who may read what, a share cannot stay an int.

The runtime handed to the participant has no `reconstruct`. "Reconstruct, do the arithmetic in the clear, re-share" is absent from the API rather than discouraged in a comment. It is an instrument and not a security boundary, though: `Share._value` is one attribute access away. What the audit can prove is that a result was produced by the runtime out of that party's own inputs -- not that the witness was never assembled. The writeup is explicit about the difference.

On scoring: this problem ships 24 deliberately broken implementations, and **18 of them reconstruct to the right A and B on every shape**. `make reference-test` re-measures the count on every run. They split three ways: right value, non-canonical form; right value, nothing checked; right value, false account of itself. None of them is visible to a test that looks at the prover's output, so the checkpoints grade stages instead. One in particular -- reconstruct the witness, fold it in the clear, re-share the answer -- returns a perfect A and B at every seed and every shape, and is caught by the **audit checkpoint alone**.

This is a toy and says so. The field is a small enumerable prime, there are two to five parties, and there is no adversary and no channel.

## Browser workflow

1. Start the problem in the Participant Portal and open **Browser Workbench**.
2. Run `inspect` and read the deployment-specific fixture and published evidence.
3. Edit the starter sources on the page and run the public `test` command.
4. Complete any direct-answer fields from the evidence and your experiments.
5. Run `prepare`, then paste every generated value into the matching Portal checkpoint.

Direct answers are bound to the current deployment seed by `prepare`.

## Learning goals

- Explain where responsibility divides between public coefficients and a secret-shared witness
- Validate a witness vector's shape, field and party count without reading a value
- Implement a linear combination using only addition and public scaling on shares
- Keep the intermediate A and B as sharings rather than reconstructing them
- Predict zero rounds of communication from the operation DAG
- Tell local operations and communication events apart in a runtime trace
- Confirm that the shared computation agrees with the plain reference
- Diagnose coefficient-order, witness-index and field-mismatch defects
- State what a provenance audit does and does not prove

## Checkpoints

| Checkpoint | Purpose | Points |
| --- | --- | ---: |
| `relation` | Read the row, in the field's own words |  |
| `witness` | Check the sharing without reading it |  |
| `combine-a` | Build the combination on shares |  |
| `combine-b` | Both halves of the row, from different vectors |  |
| `audit` | Trace where the result came from |  |
| `trace` | Report what the log says |  |
| `equivalence` | Agree with the plain relation |  |
| `transfer` | Hold up in a setting you have not seen |  |

## Explanation

## A correct A and B is not evidence of a correct prover

This problem ships 24 deliberately broken implementations, and **18 of them reconstruct to the right A and B on every shape and every label**. `make reference-test` re-measures that count on every run; if it moves, the number moves with it.

They split three ways. **Right value, wrong form**: a relation stored with `-3` where the field's canonical name for that element is `94`. **Right value, nothing checked**: folding a sharing whose parties are out of order, whose shares belong to another field, or that appears at two witness positions. **Right value, false account of itself**: returning `rounds: 0` from belief rather than from the log, or asserting `issued` instead of asking.

One of them is the point.

## Reconstructing the witness first does not fail a single value test

An implementation that adds up each sharing to recover `w`, computes `A` and `B` in the clear, and re-shares the answers returns a **perfectly correct A and B** at every seed and every shape. The reconstruction values agree, rerandomizing the sharing changes nothing, and sparse, signed and unit vectors all pass.

Measured, exactly **one** checkpoint kills it: `audit` (plus `transfer`, which re-runs the same checks under another seed). There is no way to catch it from the output, because `issued` and `ancestry` are not looking at values. They are looking at where a share came from.

## What the audit proves, and what it does not

It proves this: every result share was issued by the runtime, its ancestry reaches **only that party's own input shares**, and not one read was refused. That is a real property, and it is what the shortcut above fails.

It does not prove that the witness was never assembled. Opening each party's scope in turn and reading that party's own share is legal; do it for every party and you have `w`, and if you then fold honestly the trace looks completely innocent. `Share._value` is one attribute access away besides. The runtime is an instrument, not a sandbox: it records what a computation consumed, not what the person writing it looked at.

This is not a hole in the exercise -- it is the same in a real MPC prover. A transcript shows the protocol's message pattern; it does not show that a party's operator kept no copy of their input. That second thing is a trust boundary and an operational question rather than a cryptographic one, and conflating them lands you at "we used MPC, so nothing leaked".

## "Zero rounds" is the answer, not a measurement

Everyone knows this problem's answer is zero rounds before writing a line. That is exactly why a report that returns `rounds: 0` earns nothing. The `trace` checkpoint hands the report a log with communication in it every time: three messages carried in one round, five carried in two, a round that carried nothing at all, and a message from a party outside this row's committee. Read the log rather than your expectations and all of them pass.

`rounds` and `messages` being different numbers is the same lesson. How many messages a round carries is protocol-dependent; whether anything was sent is not.

## Why sparse is harder than dense

`a_j` multiplies the witness at position `j`, not "the j-th surviving term". For a dense coefficient vector those are the same thing, so code written against dense vectors passes quietly. Skipping zero coefficients is a fine optimization in itself; advancing `shares` alongside the skips is the bug.

## A negative coefficient is not a mistake

`-3` is a perfectly correct name for an element of `F_97`, and not the canonical one. Everything downstream reduces mod p anyway, so `A` and `B` come out right. What does not come out right is comparing your stored relation with the same relation as another prover wrote it -- which is exactly how two provers agree they are proving the same statement.

## Toy versus production

This is a toy of the mechanism. The field is a small enumerable prime, there are two to five parties, the adversary is not semi-honest so much as absent, and there is no channel, no committed randomness and no preprocessing. A real co-SNARK spends Beaver triples on its multiplications, and where those triples come from is the centre of the design. That is the next problem.

## Not in scope

Actual SNARK proof generation, malicious-secure MPC, network transport, prover performance.

## Authoring and validation

Participants do not need a checkout. Repository maintainers use the Makefile author targets and CI as the validation source of truth.
