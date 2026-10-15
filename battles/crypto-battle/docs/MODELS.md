# Cryptographic models in this Battle

[日本語](MODELS.ja.md) · [Back to the game](../README.md)

This is a guide to what the exercises demonstrate, not a prerequisite for playing. The Order itself supplies the calculation and a worked example. Small numbers make hand calculation possible and also make secrets easy to guess; these models are not suitable for protecting real data.

## Encryption, recovery and signatures

| Exercise | What the participant follows | Scope |
| --- | --- | --- |
| Caesar | Add a shift to each of three symbols and wrap around the alphabet | A known original/encrypted pair exposes the shift |
| Vigenère | Add the key for the indicated position of a repeating three-value key | HUNT needs evidence covering all key positions, not merely three records |
| Rotor | Follow two moving four-symbol wiring tables | HUNT recovers initial positions; a public pair need not determine them uniquely |
| Enigma model | Step one wheel, follow the wiring, reflect, and return through inverse wiring | One symbol 0–3; not the historical 26-letter, multi-rotor machine |
| RSA encryption | Repeatedly multiply the message, taking remainders with the public modulus | Tiny textbook RSA without secure encoding; HUNT factors the public modulus |
| RSA decryption | Use the supplied task-only private exponent to recover one message | Independent of encryption Orders; the supplied key is not a HUNT target |
| Elliptic-curve addition | Follow the supplied point-addition/doubling formulas | The group operation used by signature schemes, not a full signature |
| ECDSA | Use the supplied key, per-signature number and inverse table to calculate a signature pair | Tiny curve and task-only key; not a HUNT target or secure signing implementation |

Encryption and decryption are separately scored Orders. Traversing an Enigma reflector and return wire is part of one encryption operation.

## Secret sharing and computation on hidden values

**Secret sharing:** a share is an index-and-value pair. Standard Shamir settings produce five shares with a threshold of three distinct indices. Shares from different teams or generations cannot be mixed. HUNT reconstructs the original secret, rather than asking for a share already visible in the record.

**Secure computation (MPC):** each participant adds received hiding numbers and subtracts sent hiding numbers from a private input. When the subtotals are summed, the paired hiding numbers cancel. This is a mask-cancellation model, not a general MPC system.

**Homomorphic addition:** the player adds ciphertext components without decrypting individual messages. The judge removes the relevant masks to relate the result to the sum of the hidden inputs. The historical action name is FHE, but the exercise supports addition only. Fully homomorphic encryption also supports circuits combining addition and multiplication.

## Zero-knowledge proofs and proof-system building blocks

**Schnorr PROVE** uses a public value `y` corresponding to a private `x`. The browser keeps `x` and a fresh hiding number `r`; the player sends a commitment `a`, receives the verifier's challenge `e`, then calculates response `z`. Verification uses public values rather than receiving `x` or `r`. These are two messages of one proof, not an encryption/decryption pair. The statement concerns this dedicated `x`, not a Shamir share or Sudoku solution.

The model uses at most eleven secret candidates. Passing it does not establish that someone possessed the secret before answering, and repeated rounds with the same tiny parameters do not restore practical security. Simulation of a conversation explains disclosure relative to the public `y`; resisting false claims is a separate property requiring appropriate parameters. See [schnorr.ts](../game/src/schnorr.ts) and [RFC 8235 security considerations](https://www.rfc-editor.org/rfc/rfc8235.html#section-6).

**Legacy Sudoku PROVE** relabels digits and reveals part of a board. A trusted judge already knows its solution. Saved matches retain this worksheet and reused-table attacks; it is not a full zero-knowledge Sudoku protocol and is not used for new-match PROVE.

**SNARK preparation** checks arithmetic constraints and wire-copy constraints with remainders after division by 7. Correct rows alone are insufficient if connected wires disagree. This demonstrates how a computation becomes constraints; it does not produce a succinct cryptographic proof. See [snark.ts](../game/src/snark.ts).

**STARK preparation** checks repeated-squaring transitions, a polynomial remainder and one folding step. A polynomial is a sum of terms such as a constant, a multiple of X and a multiple of X². The exercise provides the formulas; no derivation is required. It omits Merkle commitments, random verifier queries, repeated FRI checks and zero-knowledge masking. A correct fold alone does not prove a correct execution. See [stark.ts](../game/src/stark.ts).

## Other experiments

**Indistinguishability obfuscation (iO):** compare programs' outputs and output probabilities over a finite input set. Matching functions and matching output distributions are different checks. Exhaustive small examples illustrate the definition; they do not construct general-purpose secure iO.

**Anamorphic encryption:** choose an ordinary ciphertext that also matches a hidden bit under an additional secret table. Separate Orders cover selection, ordinary decryption and accepted-ticket probability. A six-entry table stands in for a pseudorandom function; the teaching sequence is not the independent rejection sampler required for the paper's security argument. A single-message averaged distribution does not prove security across repeated messages. See [anamorphic.ts](../game/src/anamorphic.ts) and [Persiano–Phan–Yung, EUROCRYPT 2022, §5.1](https://iacr.org/archive/eurocrypt2022/132760134/132760134.pdf).

**Commit-reveal rock-paper-scissors:** seal a hand with a hiding number before revealing it to the judge. The game delays publication until both openings are accepted. Reusing a hiding number can support a prediction attack. The small-number construction and trusted judge are teaching choices, not a production fair-exchange protocol.

## Learn while playing

Use the free diagrams and one-digit practice to understand a mechanism. Order hints then progress from mechanism, to a small worked example, to separate calculations with your own values. Hints never fill in the final answer automatically.

For the exact public evidence and HUNT answer targets, see [LEAK → public record → HUNT](LEAK-HUNT-RULES.md). For runtime trust boundaries and saved matches, see the [operator guide](../OPERATOR.md).
