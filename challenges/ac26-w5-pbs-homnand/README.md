# Look up a function on a ciphertext, and hand back a fresh key

Chain what Week 5's five problems built into one Programmable Bootstrapping pipeline, then evaluate a NAND on ciphertexts. Nothing is decrypted at any step.

Week 5's capstone. Everything the five earlier problems built is supplied -- encoding and noise, LWE and RLWE, RGSW and the external product, CMUX and blind rotation, sample extraction and key switching. What you write is the pipeline that chains them, and the gate it evaluates.

Remember bootstrapping as "the thing that removes noise" and you can explain neither why a function comes out of it nor why only some functions do. What actually happens is a chain of transformations that evaluates a lookup function against an encrypted phase and returns the result under a fresh key and domain -- and the noise the output carries does not mention the input's at all. That absence is the refresh.

The encoding changes here. Under balanced encoding, `encode(1) = +q/8` and `encode(0) = -q/8`, decoding **is** a sign test -- and a sign test is what negacyclic rotation computes for free, because `X^N = -1` negates whatever wraps past the degree. If you have ever wondered why PBS cannot evaluate any function you like, this is the concrete answer.

The lookup table's upper half holds `1 - f(0)`, not `f(0)`, because the wrap hands coefficient 0 its value negated and `-encode(x)` is `encode(1 - x)`. Get it wrong and every non-constant unary function comes out inverted for `m = 0`: exactly half the truth table, which looks like a sign bug anywhere else in the pipeline.

Each stage returns its numbers **and** where they live -- kind, keyId, dimension, modulus, parameterSetId, noiseBound. Two of those change mid-pipeline: extraction moves the ciphertext to the ring secret at dimension `degree`, and the key switch moves it back. A stage that returns the right numbers under the wrong label has produced something the next stage will silently combine with a ciphertext it does not match.

HomNAND turns out to be mostly pre-processing. One linear combination, `(0, q/8) - c1 - c2`, gives the four input pairs phases of `3q/8, q/8, q/8, -q/8` -- negative only for `(1,1)`. Then one bootstrap with the identity table. There is no plaintext NAND anywhere, and no gate inside the lookup.

On scoring: this problem ships 37 deliberately broken implementations, and **21 of them produce a perfect truth table** -- every unary function, both messages, all four NAND rows, at every parameter set. All 21 are broken pipelines anyway: right numbers under the wrong label, a right answer with a false account of itself, or a right answer by luck. A final-answer test sees none of them. So grading happens stage by stage rather than end to end, and the trace is matched by artifact digest. The pipeline has ten stages and the hidden tests grade all ten separately; the eight scored checkpoints are those ten with the two most closely coupled pairs merged, which is the multi-verify contract's cap.

None of this is secure. The parameters are small enough to enumerate and both secrets fall to linear algebra.

## Browser workflow

1. Start the problem in the Participant Portal and open **Browser Workbench**.
2. Run `inspect` and read the deployment-specific fixture and published evidence.
3. Edit the starter sources on the page and run the public `test` command.
4. Complete any direct-answer fields from the evidence and your experiments.
5. Run `prepare`, then paste every generated value into the matching Portal checkpoint.

Direct answers are bound to the current deployment seed by `prepare`.

## Learning goals

- Relate an input LWE ciphertext's phase to a position in the lookup accumulator
- Encode a target function into an accumulator polynomial
- Select the lookup position from an encrypted input using blind rotation
- Return to an output LWE via sample extraction and key switching
- Confirm that f(m) is evaluated correctly across the whole pipeline
- Compare input and output noise on the toy metric
- Explain why bootstrapping is not decryption
- Compose HomNAND from pre-processing, one PBS lookup, and a decode
- Generalize to all four inputs and to parameters you have not seen
- State what this toy omits and how it differs from production TFHE

## Checkpoints

| Checkpoint | Purpose | Points |
| --- | --- | ---: |
| `lut` | Write the function into a polynomial |  |
| `domain` | Move to the units of rotation |  |
| `rotate` | Turn it while it stays encrypted |  |
| `relabel` | Move it between key domains |  |
| `evaluate` | Look up a function on a ciphertext |  |
| `refresh` | Record what actually happened |  |
| `nand` | Build the gate and complete the truth table |  |
| `transfer` | Hold up in a setting you have not seen |  |

## Explanation

## A correct truth table proves less than it looks

This problem ships 37 deliberately broken implementations, and **21 of them produce a perfect truth table** -- every unary function, both messages, all four NAND rows, at every parameter set. Every one of the 21 is still a broken pipeline, and `make reference-test` re-measures the count on every run.

They split three ways. **Right numbers, wrong label**: extraction that keeps the input's keyId, reports the input's dimension instead of the ring's, or calls its output an RLWE ciphertext. **Right answer, wrong account of it**: a trace whose noise bounds are all zero, an accumulator row claiming to carry the message, an output bound that grows with the input's. **Right answer by luck**: extracting coefficient 1 works because the table is constant across each half of the ring, and truncating instead of rounding works because the correctness budget absorbs it at these parameters.

Ten stage-level checkpoints are expensive. That measured 21 is what pays for them. A twenty-second -- the dropped `q/8` offset -- is blind on most seeds and caught on the one the suite fixes, so it is left out of the count rather than papered over.

## The identity table shows you nothing

For `f = identity` the lower half is `encode(f(1)) = encode(1)` and the upper half is `encode(1 - f(0)) = encode(1)`. Every coefficient is the same number. A constant polynomial cannot distinguish where the rotation landed, so swapped halves, the wrong extracted coefficient, and truncation instead of rounding all pass. Every public test uses it, on purpose.

## The refresh is not "the noise gets smaller"

The output's noise bound is blind rotation's contribution plus the key switch's. The input's noise is not a term. It does not shrink -- it stops being **depended on**. That is why the output can be bootstrapped again, and why circuits are possible at all. Read the trace's noise column down and you can see which row the dependency ends at.

## The right answer under the wrong label is still broken

An extraction that keeps the input's `keyId` produces the correct numbers with the wrong domain stamped on them. The pipeline works end to end because the switching key happens to be the matching one, and it breaks the moment anything else in a circuit reads that label to decide what the ciphertext may be combined with. The artifact envelope exists for this class, and a truth table cannot see it.

## The gate is not in the lookup table

HomNAND's lookup table is the identity. All four input pairs use the same table; what separates the rows is the sign of the phase the pre-processing produced. The bootstrap only turns that sign into a fresh ciphertext. The gate lives in `(0, q/8) - c1 - c2`.

Drop that `q/8` and `(0,1)` and `(1,0)` have a phase of exactly zero, so the answer is settled by whichever way the noise fell. Measured over 40 seeds, 12 of the 80 attempts at those two rows came out wrong and the other two rows never did -- a missing constant that fails one row in seven reads as flakiness rather than as a bug.

## Three rows out of four is not correct

`(1,1)` is the only NAND row that returns 0, so an implementation that returns a constant 1 is 75% right. That is why the hidden tests run all four rows every time.

## What happens past the correctness bound

An input noisier than the bound does not degrade the bootstrap. It returns the **other** bit, confidently, with a fresh small noise -- a correct-looking ciphertext of the wrong answer rather than a broken one. That is the FHE failure mode worth remembering.

## Toy versus production

This is a toy of the mechanism. Production TFHE runs the polynomial products through FFT or NTT, compresses the bootstrapping key, and derives its parameters from security against lattice reduction. Here the parameters are small enough to enumerate and both secrets fall to linear algebra. Per-gate cost, realistic bootstrapping-key size, and compiling arbitrary multi-gate circuits are all out of scope.

## Not in scope

Production TFHE security and performance, optimized FFT / NTT / SIMD, bootstrapping-key size optimization, an arbitrary multi-gate circuit compiler.

## Authoring and validation

Participants do not need a checkout. Repository maintainers use the Makefile author targets and CI as the validation source of truth.
