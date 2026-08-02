# One sign, and everything downstream

LWE and RLWE have the same shape and different arithmetic. The single sign in X^N = -1 separates negacyclic from cyclic — and a cyclic ring is a perfectly good ring, so it passes every test you write yourself. Which is why the round trips are crossed.

## Browser workflow

1. Start the problem in the Participant Portal and open **Browser Workbench**.
2. Run `inspect` and read the deployment-specific fixture and published evidence.
3. Edit the starter sources on the page and run the public `test` command.
4. Complete any direct-answer fields from the evidence and your experiments.
5. Run `prepare`, then paste every generated value into the matching Portal checkpoint.

Direct answers are bound to the current deployment seed by `prepare`.

## Learning goals

- Normalize an element of R_q = Z_q[X] / (X^N + 1)
- Implement negacyclic addition and multiplication
- Show by counterexample how it differs from cyclic convolution
- Implement toy LWE key generation, encryption and decryption
- Explain how scalars and vectors become polynomials in RLWE
- Separate the encoded message from the noise in a decryption phase
- Tell the roles of modulus, dimension, degree and noise apart
- Keep toy correctness and production security separate

## Checkpoints

| Checkpoint | Purpose | Points |
| --- | --- | ---: |
| `normalize` | Fold into a ring element |  |
| `ring` | Multiply negacyclically |  |
| `lwe` | Encrypt under a vector secret |  |
| `rlwe` | Encrypt under a polynomial secret |  |
| `correspondence` | Put them side by side and name the difference |  |
| `boundary` | The first one out of budget |  |
| `transfer` | Hold up in a ring you have not seen |  |
| `defense` | Refuse a broken ciphertext |  |

## Explanation

## A cyclic ring is a perfectly good ring

The ring with `X^N = +1` satisfies every axiom, distributes, commutes, and round-trips encryption against decryption. It is simply not this ring. So "my tests pass" says nothing about whether the product is negacyclic. The wrong product is written out as `fixtures.generate.cyclic_mul`, so the counterexample is against a stated weakness.

## Self-consistent mistakes need a crossed test

A sign-flipped inner product cancels against a sign-flipped phase. A ciphertext carrying its own plaintext decrypts better than the real one. An implementation that ignores the mask round-trips perfectly against a decryptor that also ignores it. All of them pass a test that encrypts and decrypts with the same code.

So every round trip in the hidden suite is crossed: encrypt here and decrypt against the fixtures, and the other way round. A scheme that is only self-consistent does not survive it, and a correct one does not notice.

## Two wraps restore the sign

The coefficient at degree i lands on `i % N` with sign `(-1) ** (i // N)`. One wrap negates; two bring it back. An implementation that says "negate if it went past N" is wrong for any input longer than 2N. `ring_mul` only ever passes 2N - 1, so one wrap is enough there -- but `normalize` takes arbitrary input.

## RLWE is not LWE with longer vectors

The product is a different product, and one ciphertext carries N messages instead of one. That is why the `correspondence` checkpoint grades the `operation` and `payload_size` labels: naming the RLWE operation an inner product is the misconception written down.

## An all-zero secret degenerates the scheme

The generated secrets are forced to contain at least one 1. With an all-zero secret the mask term vanishes and `b = encode(m) + e` regardless of what the implementation did with the secret -- a sign-flipped inner product, a phase that adds instead of subtracting, and an implementation that ignores the mask all look correct. Three mutations survived on exactly this before it was forced.

## Reusing a mask is a break

Encryption takes its mask and noise as arguments for reproducibility; a real implementation samples both. Use the same mask twice under one key and the difference of the two ciphertexts cancels the mask term, leaving the difference of the two plaintexts plus a little noise.

## Not in scope

No concrete security parameter selection, no CSPRNG or constant-time work, no NTT or FFT, no usable library. Schoolbook multiplication is deliberate: an NTT hides the wrap behind a transform that has to be told the same sign convention anyway.

## This is not secure

n, N and q are small enough to enumerate, and the secret falls to linear algebra from a handful of samples. A toy of the mechanism, not of the hardness.

## Source alignment

Week 5's material is published upstream, so `courseAlignment` pins `week5/README.md` as `lecture` and `week5/problems/tfhe-toy-python/README.md` as `assignment`. `spoilerPolicy` is `independent-reimplementation`: the API, the parameter generation, and the scheme write-up are original, and no function name, fixture, or skeleton is taken from the official exercise.

## Authoring and validation

Participants do not need a checkout. Repository maintainers use the Makefile author targets and CI as the validation source of truth.
