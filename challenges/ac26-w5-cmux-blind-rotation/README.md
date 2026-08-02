# Turn it by an angle nobody knows

Pick one of two ciphertexts with an encrypted bit, then chain that into rotating a polynomial by an encrypted amount. Nothing inside the loop knows the angle.

The fourth Week 5 problem. Build CMUX and monomial rotation, then chain the two into blind rotation.

The ring, RLWE, RGSW and the external product are supplied -- they are ac26-w5-lwe-rlwe's and ac26-w5-rgsw-external's output, and this problem is the selection itself and what it accumulates into.

CMUX is one line: `ct0 + ExternalProduct(c, ct1 - ct0)`. Selector 0 gives ct0's plaintext, selector 1 gives ct1's, and there is no branch. Computing both candidates every time is not waste; it is the mechanism, because computing only the one you need requires knowing which one that is.

The plaintext modulus is 4, and that is load-bearing. Negacyclic rotation negates a coefficient every time it wraps past degree N, and modulo 2 that flip is **invisible** -- `-delta == delta (mod q)` -- so an implementation that ignored `X^N = -1` entirely would score full marks. Modulo 4 the flip shows up in the plaintext as `m -> (-m) mod 4`.

Rotation exponents are normalized modulo 2N. `X^(2N) = 1` is why it is 2N rather than N, and reducing modulo N instead loses exactly the sign -- which is the whole difference from a circular shift.

Blind rotation takes an LWE sample `(mask, body)` over `Z_(2N)` and lands on the exponent `phase = body - <mask, secret>`. No secret is passed. `body` is public, so the opening offset rotation needs no CMUX; the rest is carried by the rows of the bootstrapping key.

On scoring: an implementation whose rotation direction is reversed everywhere is perfectly consistent with itself and passes any test that compares the loop against its own parts. So the blind rotation is compared against a separate model computed in the clear from the phase, which calls none of the submission's functions.

None of this is secure. The parameters are small enough to enumerate and the secret falls to linear algebra.

## Browser workflow

1. Start the problem in the Participant Portal and open **Browser Workbench**.
2. Run `inspect` and read the deployment-specific fixture and published evidence.
3. Edit the starter sources on the page and run the public `test` command.
4. Complete any direct-answer fields from the evidence and your experiments.
5. Run `prepare`, then paste every generated value into the matching Portal checkpoint.

Direct answers are bound to the current deployment seed by `prepare`.

## Learning goals

- Implement CMUX as one line on top of the external product
- Confirm that selector 0 and 1 switch which branch is selected
- Explain why multiplying by a monomial is a negacyclic rotation
- Normalize a rotation exponent modulo 2N
- Rotate or hold a ciphertext according to an encrypted bit
- Chain conditional rotations driven by an LWE mask
- Check a blind rotation against a plaintext reference model
- State plainly how the toy differs from a production blind rotation

## Checkpoints

| Checkpoint | Purpose | Points |
| --- | --- | ---: |
| `combine` | Add and subtract ciphertexts |  |
| `cmux` | Select with an encrypted bit |  |
| `constant` | Show you did not branch in the clear |  |
| `rotate` | Turn by a monomial |  |
| `conditional` | Choose between turning and holding |  |
| `blind` | Turn by an amount nobody knows |  |
| `trace` | Show the accumulation |  |
| `transfer` | Hold up in a setting you have not seen |  |

## Explanation

## Computing both is the mechanism

CMUX is `ct0 + ExternalProduct(c, ct1 - ct0)`. The external product returns `RLWE(0) + mu * (ct1 - ct0)`, so the sum is ct0 when mu is 0 and ct1 when mu is 1. Fresh noise lands on both paths, so the output is a new ciphertext either way and never one of the inputs.

An implementation that computed only the candidate it needs cannot be written without knowing which one that is. Computing both is not waste -- it is the reason an encrypted bit can steer anything.

## A plaintext modulus of 4 is what makes the sign visible

Negacyclic rotation negates a coefficient every time it wraps past the degree. Modulo 2, `-delta` and `delta` are the same value, so that flip never reaches the plaintext and an implementation that wrote an ordinary circular shift passes everything. Modulo 4 it appears as `m -> (-m) mod 4`, which moves 1 and 3.

## 2N, not N

`X^(2N) = 1`, so exponents reduce modulo 2N. Reducing modulo N instead drops the parity of how many times the coefficient wrapped -- that is, the sign. The entire difference between this and a circular shift lives there.

## A consistently reversed implementation cannot catch itself

Reverse the direction in `monomial_rotate` and in the loop together, and a test that compares the loop against your own `conditional_rotate` still passes. The last public test is exactly that test, and it proves nothing.

So the hidden tests compare against a model that computes the rotation in the clear from the phase and calls none of your functions.

## The degenerate case where the candidates coincide

When a mask coefficient is zero the two candidates are the same ciphertext: the difference is zero, its digits are zero, and the external product is exactly the zero ciphertext. The output matches the candidate bit for bit. That is not a plaintext branch -- there was nothing to branch on. Mask coefficients are drawn from `Z_(2N)`, so this happens one time in 2N, not rarely.

## body is public

The secret is the LWE bits; the body is not. That is why the opening offset rotation needs no CMUX, and why step 0 of the trace is labelled `phase-offset` -- it marks where the public part of the phase ends and the encrypted part begins.

## Not in scope

Sample extraction and key switching (the next problem), programmable bootstrapping and HomNAND (the one after), modulus switching, constant-time guarantees, optimized blind rotation.

## This is not secure

The parameters are small enough to enumerate and the secret falls to linear algebra. A toy of the mechanism, not of the hardness.

## Authoring and validation

Participants do not need a checkout. Repository maintainers use the Makefile author targets and CI as the validation source of truth.
