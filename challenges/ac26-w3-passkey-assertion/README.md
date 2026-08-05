# The signature is valid. Reject it anyway.

A passkey login reaches the server as a signed **assertion**. In this lab you stand on the
server side: assemble the bytes covered by that signature, verify them with the stored public
key, and then meet an assertion whose signature is completely valid but whose user-verification
bit is zero.

The result is not "passkeys are broken." The result is narrower and more useful: cryptographic
validity and the server's authentication policy are separate checks, and the relying party has
to perform both.

## Prerequisites

Assumed: Python bytes, dictionaries and booleans.

Not assumed: public/private keys, signatures, challenges, assertions, WebAuthn, or binary flags.
Each is introduced before it is used. The P-256 ECDSA arithmetic is supplied; the participant
does not implement elliptic curves.

## One complete login

```text
authenticator on the device                 relying-party server
keeps the credential private key            stores the credential public key
            |                                           ^
            | signs challenge + authenticatorData       | verifies
            +---------------- assertion ----------------+
```

- A **private key** can create signatures. It is not sent to the relying party.
- A **public key** can verify signatures but cannot create them. The server stores this half.
- A **challenge** is a fresh value the server asks the authenticator to sign for this login.
- An **assertion** is the authenticator's signed reply.
- **authenticatorData** starts with the SHA-256 hash of the RP ID, then a flags byte, then a
  signature counter in this lab.
- **UV** (user verified) is bit `0x04` in that signed flags byte. It reports that the authenticator
  performed local user verification, such as a PIN or biometric.

WebAuthn assertion verification requires the relying party to validate the expected RP ID,
origin, challenge and user-presence state; if user verification is required, it must also check
the UV bit; finally it verifies the signature over
`authenticatorData || SHA-256(clientDataJSON)`. See [WebAuthn Level 3 §7.2](https://www.w3.org/TR/webauthn-3/#sctn-verifying-assertion).

## The constructed fixtures

Every deployment creates exactly four assertions from its `FLAG_SEED`:

| Kind | Signature | Context | UV | Required-policy result |
| --- | --- | --- | --- | --- |
| honest | valid | valid | 1 | accept |
| no UV | valid | valid | 0 | reject: `user-verification-required` |
| bad signature | invalid | valid | 1 | reject: `signature-invalid` |
| wrong RP | valid | wrong RP ID hash only | 1 | reject: `rp-id-mismatch` |

This is construction, not probability. The interesting assertion always exists, and its only
rejection reason under a UV-required policy is UV itself. The WebAuthn credential `id` matches
the registered record; the lab-only `caseId` labels and order vary by seed, so code that returns
a position or remembered label does not generalize.

The lab uses a real P-256 ECDSA verifier and the WebAuthn signed-data layout. It deliberately
models only the Level 1 slice above; registration, attestation, extensions, backup flags and
counter policy are outside this problem.

## Run it

Start the problem in Participant Portal and use the editor on the problem page. Authors can also
run the same checks locally:

```bash
make inspect
make test
make test-one ID=signature
make reset
```

Complete these functions in `local/starter/assertion.py`:

1. `signed_message` — decode the two byte strings and hash `clientDataJSON`.
2. `verify_signature` — call the supplied P-256 verifier with the stored public key.
3. `user_verified` — read byte 32 and test bit `0x04`.
4. `find_signed_without_user_verification` — select by properties, not by `caseId` or order.
5. `verify_assertion` — return one specific verdict after context, UV-policy and signature checks.

Portal submits the current source independently for all three graded checkpoints: `signature`,
`find-uv-gap`, and `enforce-uv`.

## Why this maps to a real incident

Unit 42's August 2026 research examined Google Password Manager synced passkeys in Chrome on
Windows with TPM support. Its stated initial condition is already-present malware on the
victim's device; it is not a remote break of the signature algorithm. In the Pass-ta-key test,
the produced assertions were cryptographically valid but normally failed where UV was required
because the bit remained unset. Unit 42 reported GitHub rejecting the login. It also reported an
eBay flow that accepted it despite requesting `userVerification: "required"`; the article says
eBay fixed that validation gap after disclosure.

That difference is the exact seam this L1 isolates. The lab does not reproduce endpoint malware,
Google's cloud authenticator, or the later onboarding and key-extraction attacks. It also does
not generalize the pre-fix eBay observation into a claim about eBay today.

Primary sources:

- [Unit 42 — Passkeys Under Attack: Three New Ways to Bypass Passwordless Authentication](https://unit42.paloaltonetworks.com/passwordless-authentication-security-risks/)
- [Unit 42 — Google Cloud Authenticator: The Hidden Mechanisms of Passwordless Authentication](https://unit42.paloaltonetworks.com/passwordless-authentication/)
- [W3C Web Authentication Level 3](https://www.w3.org/TR/webauthn-3/)

## Assurance scope

Local mode is **self-paced, honor-system verification**. You own the machine, the Docker
daemon, and the image, so nothing inside that image is hidden from you: `reference/` and
`tests/hidden/` are not bind-mounted, which keeps them out of your git checkout rather than
out of reach.

The verifier's narrower guarantees still matter: participant source runs with time, memory,
process and output caps; a checkpoint can only credit the id it echoes; verdicts do not reveal
expected values; and hidden checks rebuild the fixture from this deployment's seed.

That supports self-study and honest practice. It does **not** support competition ranking,
examination, or completion certification — those need a verifier the participant does not
administer, tracked in [#271](https://github.com/susumutomita/TenkaCloudChallenge/issues/271).

## Cost

Zero. No cloud account or AWS resource is used.

## Author verification

```bash
make reference-test
make solvability
```

The hidden suite reruns eight unseen seeds per checkpoint. The mutation suite must kill wrong
signed-byte order, signature-always-true, UP/UV confusion, position-based selection, omitted UV
enforcement and omitted final signature verification.
