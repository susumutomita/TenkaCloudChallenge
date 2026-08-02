# The same R twice is the key

A signing service's audit log holds the message, the public key, R and z. It does not hold the secret key. Find the one place R appears twice and the secret key is two equations away.

## Browser workflow

1. Start the problem in the Participant Portal and open **Browser Workbench**.
2. Run `inspect` and read the deployment-specific fixture and published evidence.
3. Edit the starter sources on the page and run the public `test` command.
4. Complete any direct-answer fields from the evidence and your experiments.
5. Run `prepare`, then paste every generated value into the matching Portal checkpoint.

Direct answers are bound to the current deployment seed by `prepare`.

## Learning goals

- Find two transcripts in a log that share a commitment
- Extract the secret key algebraically from the difference of the responses
- Explain why (e1 - e2) must be invertible, and what it means when it is not
- Confirm a recovered key against P = xG rather than claiming it unchecked
- Explain why sharing a commitment is necessary but not sufficient
- Show by measurement that looking random is not the same as having entropy
- State the conditions under which a deterministic nonce is safe

## Checkpoints

| Checkpoint | Purpose | Points |
| --- | --- | ---: |
| `parse` | Read a log that came from outside |  |
| `detect` | Name only the pairs that can be attacked |  |
| `extract` | Solve the two equations for the key |  |
| `confirm` | Confirm the key you recovered |  |
| `reject` | Say that an unsolvable pair is unsolvable |  |
| `hunt` | Find it in the noise |  |
| `collision` | Measure what looks random |  |
| `repair` | Fix the generator |  |

## Explanation

## This is not a story about random numbers

Nonce reuse is usually told as "weak random number generators are dangerous". That describes the symptom, not the reason.

The reason is **special soundness**: two accepting transcripts that share a commitment and differ in the challenge yield the witness. That is the definition of the Sigma protocol being a proof of knowledge — the property that guarantees the prover really knows x. The extractor exists, so the protocol is sound; the extractor exists, so reuse is fatal. One fact, two consequences.

## Sharing R is not sufficient

The log contains a record from a *different* signer that happens to use the same R. With different keys, the two transcripts are not two equations in one unknown, and attacking them produces a scalar belonging to nobody. That is why a recovery is always confirmed against P = xG: the arithmetic succeeds on the wrong pair too.

The log also contains a record that parses cleanly and does not verify. Reuse inside a rejected transcript proves nothing.

And when e1 = e2 there is no inverse, because two responses to the same challenge are one equation written twice. No new information arrived.

## Three nonce generators

- `fixed_nonce` — the same k every time. Dies immediately.
- `truncated_nonce` — a genuine hash, thrown away down to a few bits. **In the log it looks perfectly random.** Every k differs, every signature verifies, nothing is visibly wrong. It collides on the birthday schedule anyway.
- `deterministic_nonce` — a hash of the secret key and the message. The name is the most alarming and it is the safe one: the same key and message give the same nonce, which gives the same signature and leaks nothing new, while two different messages cannot collide without a hash collision. The key goes in too — hashing the message alone would give two signers the same nonce for the same message.

## Group order, and the test that cannot be written

The repair checkpoint runs on secp256k1. A toy group has fewer than fifty scalars, so sixty messages cannot possibly get sixty distinct nonces — the pigeonhole says so before any code exists. There is no safe nonce generator in a forty-element group; the group being small **is** the vulnerability. A test that asserts the impossible is a design failure, not a failing test.

Truncation is likewise not caught by "are the sixty samples distinct". At sixteen bits, sixty draws are all distinct about 97% of the time, so that assertion would let it through on most runs. The range is what rules it out: against a 256-bit order, every output landing below 2^64 has probability around 2^-11000 — that is evidence, not luck.

## Where this leads

"One commitment, two challenges" reappears throughout the proof systems in later weeks. There the extractor shows up as a tool in a security proof rather than as an attack, but it is the same subtraction.

## Authoring and validation

Participants do not need a checkout. Repository maintainers use the Makefile author targets and CI as the validation source of truth.
