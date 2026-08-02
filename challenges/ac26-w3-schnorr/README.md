# What did you leave out of the hash

> This track is an independent, unofficial companion to the Advanced Cryptography Program 2026.
> It is not affiliated with or endorsed by the course or its operators. All problem statements,
> code, fixtures, and figures here are written independently. Questions about this track go to
> the TenkaCloud repository, not to the course operators.

**Track:** `advanced-cryptography-2026` · **Order:** 330 · **Chapter:** Week 3 / Sigma Protocol
and Fiat–Shamir · **Role:** `assignment-companion` · **Time:** 75–105 minutes · **Points:** 300
· **Required first:** `ac26-w3-ec-group`

## The story

You want to convince somebody you know `x`, without handing over `x`. Three moves do it:

```text
P = xG                        the statement
R = kG                        commitment
e                             challenge
z = k + e*x  (mod n)          response
zG == R + eP                  what the verifier checks
```

Then Fiat–Shamir removes the conversation by computing `e` from the transcript. That is where
the problem starts, because now *you* decide what goes into the hash.

## Whatever you leave out is not protected

| Left out of the challenge | What stops being true |
|---|---|
| the message | one signature fits every message |
| the public key | the signature can be re-attributed to another key |
| the commitment | Fiat–Shamir stops being Fiat–Shamir |
| the domain | a signature made for another protocol verifies here |

None of that shows on the happy path. Sign, verify, green — every time. Five of this problem's
ten mutations are exactly that shape, which is why the checkpoints go after it directly.

## Browser workflow

1. Start the problem in Participant Portal and open **Browser Workbench**.
2. Run `inspect` to read this deployment's fixture and published evidence.
3. Edit the starter source in the in-browser editor.
4. Run `test` for the published checks and fill any direct-answer fields from the evidence.
5. Run `prepare`, then paste every prepared checkpoint value into Participant Portal.

No checkout, terminal, or local editor is required. Code checkpoints submit the edited source.
Direct answers are wrapped by `prepare` and bound to the current deployment seed, so a value copied
from another deployment is rejected.

## Scoring

Eight checkpoints, scored independently. Wrong answers cost 15 points each.

| Checkpoint | Points | What is checked |
|---|---:|---|
| `keygen` | 30 | `P = xG`, and refusing secrets and keys that are not usable |
| `sigma` | 40 | The commitment and the response, under the right modulus |
| `transcript` | 35 | The honest transcript accepted, every altered one rejected |
| `serialization` | 40 | Round-trip, non-canonical rejection, and unambiguous concatenation |
| `fiat-shamir` | 45 | All four binding inputs change what gets hashed |
| `sign-verify` | 40 | Honest signatures pass; altered ones fail on a real-size group |
| `cross-protocol` | 40 | The counterexample, and immunity to it |
| `transfer` | 30 | The same protocol code on secp256k1 |

Hints on six of the eight, each inside that checkpoint's 50% cap.

## The counterexample checkpoint

`fixtures.generate.weak_challenge` hashes the commitment, the public key and the message — and
not the domain. It lives in the fixtures, **not** in your file: "my attack works against my own
weakened code" would not be an answer.

You construct a witness where one signature verifies under two different domains at once. Then
your own `challenge` has to hash different bytes for those two domains. Building the attack and
being immune to it are separate claims, and this checkpoint wants both.

## Length prefixes, and why the fields are adjacent

Concatenate variable-length fields without their lengths and `('ab', 'cd')` and `('a', 'bcd')`
produce the same bytes — two different statements sharing one proof.

The reference puts the domain and the message **next to each other**. Separating them with the
fixed-width point encodings would still be unsound in principle, but a collision would then need
the point bytes to line up by luck, and a reviewer could talk themselves into believing the length
prefixes are decoration. Adjacent, the collision is deterministic.

## Group order and probability

The toy groups have order between 29 and 43. A Schnorr forgery succeeds with probability `1/n`,
so "change one byte of the message and verify" really does pass about **one time in forty for a
correct implementation**. That is a property of the parameters, not a defect — and it was hit
while writing this problem.

So the checks are split deliberately:

- **acceptance** (an honest signature verifies) runs on the toy groups, where it is deterministic;
- **rejection** (a modified signature fails) runs on secp256k1, where `1/n` is unreachable;
- **"changing a binding input changes the challenge"** is asserted on the *preimage* over toy
  groups, because two preimages collide mod `n` with probability `1/n`, while the hash input
  differing is deterministic.

A test that fails at random teaches learners to re-run it. That is a grading failure, not a flake.

## A signature is not encryption

The verification equation holding says nothing about confidentiality. The message is not hidden;
the verifier is assumed to have it, and the signature is a claim about it.

## Assurance scope

Local mode is **self-paced, honor-system verification**. You own the machine, the Docker
daemon, and the image, so nothing inside that image is hidden from you: `reference/` and
`tests/hidden/` are not bind-mounted, which keeps them out of your git checkout rather than
out of reach.

What the verifier does guarantee is narrower and real: a submission cannot hang or crash it,
a checkpoint can only credit the id it echoes, results do not leak expected values, and the
fixtures come from this deployment's seed so a memorized answer does not carry.

That supports self-study and honest practice. It does **not** support competition ranking,
examination, or completion certification — those need a verifier the participant does not
administer, tracked in [#271](https://github.com/susumutomita/TenkaCloudChallenge/issues/271).

## Cost

Zero. No cloud account, no AWS resources.

## For authors

`make reference-test` runs the mutation suite: ten broken implementations. Half of them sign and
verify perfectly and are broken only against an attacker. The length-prefix mutation is the reason
the reference's preimage layout puts its two variable-length fields adjacent — with the points in
between, that mutation survived.
