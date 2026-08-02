# Multiply by a bit nobody can read

Multiply an RLWE ciphertext by an encrypted bit. Selector 0 gives an encryption of zero, selector 1 gives the message back, and the arithmetic is identical either way — so the result says nothing about which it was.

The third Week 5 problem. As the groundwork for applying an encrypted control bit to an RLWE ciphertext, build gadget decomposition, the gadget vector, a toy RGSW, and the external product in that order.

The ring and RLWE are supplied -- they are ac26-w5-lwe-rlwe's output, and this problem is the gadget and the product itself.

The decomposition convention is fixed: q = base**levels, unsigned, LSB-first, exactly `levels` digits, gadget (1, B, B^2, ...). That q makes recomposition exact, and the `failure` checkpoint is where you find out what it was buying -- a real implementation uses an approximate gadget and lives with the error.

RGSW has 2L rows: the first half puts the gadget term in the a slot, the second in b. The external product decomposes both halves of the ciphertext into one digit vector of length 2L and multiplies it into that matrix. `d . G` reassembles (a, b) exactly, so the result is RLWE(0) + mu*(a, b). Collect every gadget term into one slot and the product decrypts to something that looks almost right.

`external_product` is not given the secret. It cannot decrypt the selector and must not need to: both branches being the same arithmetic is exactly what makes encrypted branching possible.

On scoring: reversing the digit order and the gadget vector together leaves every round trip passing, and building the RGSW rows backwards then multiplying them with a product that is backwards the same way still returns the message. So the gadget vector is graded directly, and every RGSW check is crossed -- fixture rows through the submission's product, and the submission's rows through the fixtures'.

None of this is secure. The parameters are small enough to enumerate and the secret falls to linear algebra.

## Browser workflow

1. Start the problem in the Participant Portal and open **Browser Workbench**.
2. Run `inspect` and read the deployment-specific fixture and published evidence.
3. Edit the starter sources on the page and run the public `test` command.
4. Complete any direct-answer fields from the evidence and your experiments.
5. Run `prepare`, then paste every generated value into the matching Portal checkpoint.

Direct answers are bound to the current deployment seed by `prepare`.

## Learning goals

- Implement gadget decomposition for a base B and level count L
- Recompose the original value from its digits modulo q
- Decompose a polynomial coefficient by coefficient
- Explain what the gadget vector and digit vector's inner product means
- Follow the structure that makes a toy RGSW act as an encrypted selector
- Keep or zero an RLWE ciphertext by external product, according to the selector
- Show by counterexample how decomposition error follows from insufficient parameters
- State plainly how the toy differs from production RGSW

## Checkpoints

| Checkpoint | Purpose | Points |
| --- | --- | ---: |
| `decompose` | Break a value into digits |  |
| `gadget` | Write the gadget vector |  |
| `polynomial` | Decompose per coefficient |  |
| `rgsw` | Encrypt the selector |  |
| `external` | Multiply by the bit |  |
| `trace` | Show the accumulation |  |
| `failure` | Where the levels run out |  |
| `transfer` | Hold up in a setting you have not seen |  |

## Explanation

## The split is the point

RGSW's 2L rows put the gadget term in the a slot for the first half and the b slot for the second. The external product decomposes both halves of the ciphertext and concatenates them because that is what makes `d . G` reassemble `(a, b)` exactly. Collect the gadget terms into one slot and the product decrypts to something almost right -- which, here, is wrong.

## Self-consistent mistakes need a crossed test

Reverse the digit order and the gadget vector together and every round trip still passes. Build the RGSW rows with the layout backwards, multiply them with a product that is backwards the same way, and selector 1 still returns the message. Both are perfectly consistent with themselves.

So the gadget vector is graded directly rather than through a round trip, and every RGSW check is crossed: fixture-built rows through the submission's product, and the submission's rows through the fixtures'.

## Withholding the secret is the specification

`external_product` is not given the secret. It cannot decrypt the selector and does not need to. Both branches being the same arithmetic is exactly what makes encrypted branching possible -- if you want to know which bit it is, the design is telling you something.

## q = base**levels is a choice

It is what makes recomposition exact. Once the levels stop reaching the modulus, `decompose` truncates without complaining and `recompose` is confidently wrong. The smallest failing value is `base**levels` itself. Counting the levels beats a float logarithm, which is off at an exact power -- `(5, 125)` and `(6, 216)` are the cases that show it.

## Not in scope

Production noise analysis, optimized decomposition or FFT, an RGSW security proof, bootstrapping key compression.

## This is not secure

The parameters are small enough to enumerate and the secret falls to linear algebra. A toy of the mechanism, not of the hardness.

## Authoring and validation

Participants do not need a checkout. Repository maintainers use the Makefile author targets and CI as the validation source of truth.
