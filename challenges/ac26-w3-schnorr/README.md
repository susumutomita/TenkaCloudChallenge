# What did you leave out of the hash

Run a Sigma protocol interactively, then turn it into a signature with Fiat-Shamir. Whatever you leave out of the hash is not protected — drop the domain separator and one signature is valid under two protocols at once.

## Browser workflow

1. Start the problem in the Participant Portal and open **Browser Workbench**.
2. Run `inspect` and read the deployment-specific fixture and published evidence.
3. Edit the starter sources on the page and run the public `test` command.
4. Complete any direct-answer fields from the evidence and your experiments.
5. Run `prepare`, then paste every generated value into the matching Portal checkpoint.

Direct answers are bound to the current deployment seed by `prepare`.

## Learning goals

- Explain the relation between the public key P = xG and the secret x
- Implement the commitment, the challenge and the response
- Check the verifier's equation as points on both sides
- Derive the challenge from the transcript rather than receiving it
- Show by counterexample why the domain, message, key and commitment must all be bound
- Explain when concatenating variable-length fields becomes ambiguous
- Explain why a signature does not hide the message

## Checkpoints

| Checkpoint | Purpose | Points |
| --- | --- | ---: |
| `keygen` | Make a key, and refuse an unusable one |  |
| `sigma` | Implement the three moves |  |
| `transcript` | Check both sides of the equation |  |
| `serialization` | Write an encoding with one reading |  |
| `fiat-shamir` | Derive the challenge from the transcript |  |
| `sign-verify` | Sign and verify |  |
| `cross-protocol` | Show what dropping the domain costs |  |
| `transfer` | Run it on real parameters |  |

## Explanation

## What you leave out is not protected

Anything absent from the challenge is something the signature does not claim. Leave out the message and one signature fits every message. Leave out the public key and it can be re-attributed. Leave out the commitment and Fiat-Shamir stops being Fiat-Shamir. Leave out the domain and a signature made for another protocol verifies here.

None of that shows on the happy path — sign, verify, green. Five of the ten mutations in this problem's suite are exactly that shape, which is why the checkpoints go after it directly instead of only round-tripping.

## The cross-protocol counterexample

The weakened challenge — the one that omits the domain separator — is fixed in the fixtures, not written by the submission. That matters: "my attack works against my own weakened code" would not be an answer.

On top of building the attack, the learner's own challenge must hash *different bytes* for the two domains. Being able to construct the attack and being immune to it are two separate claims, and the checkpoint wants both.

## Length prefixes, and why the fields are adjacent

Concatenating variable-length fields without their lengths makes `('ab', 'cd')` and `('a', 'bcd')` produce the same bytes: two different statements sharing one proof.

The reference puts the domain and the message **next to each other**. A layout that separates them with fixed-width point encodings is still unsound in principle, but a collision then needs the point bytes to line up by luck — and a reviewer can talk themselves into believing the length prefixes are decoration. Adjacent, the collision is deterministic and there is nothing to argue about.

## Group order and probability

The toy groups have order between 29 and 43. A Schnorr forgery succeeds with probability 1/n, so "change one byte of the message and verify" really does pass about one time in forty **for a correct implementation**. That is a property of the parameters, not a defect, and it was hit while writing this problem.

So the checks are split:

- acceptance (an honest signature verifies) runs on the toy groups, where it is deterministic;
- rejection (a modified signature fails) runs on secp256k1, where 1/n is unreachable;
- "changing a binding input changes the challenge" is asserted on the **preimage** over toy groups, because two preimages collide mod n with probability 1/n while the hash input differing is deterministic.

A test that fails at random teaches learners to re-run it. That is a grading failure, not a flake.

## A signature is not encryption

The verification equation holding says nothing about confidentiality. The message is not hidden; the verifier is assumed to have it already, and the signature is a claim about it.

## Where this leads

The next problem is nonce reuse. Having written `z = k + e*x` yourself, two signatures under the same `k` are visibly two equations in two unknowns, and `x` falls out.

## Authoring and validation

Participants do not need a checkout. Repository maintainers use the Makefile author targets and CI as the validation source of truth.
