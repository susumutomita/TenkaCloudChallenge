# Do not send the number you chose

> This TenkaCloud track is an unofficial companion built independently for learners of the Advanced Cryptography Program 2026. It is not affiliated with the course organizers and contains no official assignment solutions.

## Why

A sender has two 16-bit messages. A receiver should obtain exactly one without telling the sender which index was chosen and without learning the other message.

A final-output test is dangerously weak here. A request containing the choice plus two plaintext messages delivers the selected value perfectly. This lab therefore grades delivery, choice privacy, and message privacy separately.

Prerequisites: Python, integer powers and remainders, and XOR. OT and discrete logarithms are defined here.

## What you implement

Edit `local/starter/ot.py` and implement three independently named functions:

- `make_receiver_request(sender_public, choice, receiver_secret)`
- `seal_sender_messages(sender_secret, request, message_0, message_1)`
- `open_receiver_message(sender_public, choice, receiver_secret, ciphertexts)`

Their argument roles match the three operations in the course Part B exercise, while the names, code, fixtures, tests, and tiny parameters were designed independently.

## The toy construction

The group has prime modulus 467, subgroup order 233, and generator 4. Let the sender publish `A = g^a` and the receiver hold exponent `b`.

```text
B = g^b * A^choice

sender branch 0 key = B^a
sender branch 1 key = (B / A)^a
receiver key        = A^b
```

For choice 0, `A^b = B^a`. For choice 1, `A^b = (B/A)^a`. Multiplying a uniformly distributed subgroup element by fixed `A` permutes the subgroup, so the request distribution does not identify the choice.

The starter supplies `_pad(shared, branch)`: it takes the first 16 bits, big-endian, of SHA-256 over the ASCII string `tc-ot-v1:{shared}:{branch}`. Seal branch `i` as `message_i XOR _pad(branch_key_i, i)` and use the same helper to open the selected branch. The pad mapping is fixed by the exercise; it is not a step learners must guess.

These parameters are enumerable and are not secure. Enumeration is useful here because the choice audit can compare both complete request distributions.

## Participant Portal workflow

1. Start the problem in Participant Portal; the problem editor appears on the same page.
2. Select **Inspect evidence** to read the construction and deployment-specific inputs.
3. Edit `ot.py` in the Portal editor.
4. Select **Run public tests** to check final delivery.
5. Submit each checkpoint directly; Portal prepares and sends the current source.

## Checkpoints

| Checkpoint | What it observes |
| --- | --- |
| request | algebraic request shape |
| sender-encrypt | both ciphertext branches |
| receiver-decrypt | selected branch opening |
| delivery | end-to-end selected message |
| choice-audit | equality of request multisets |
| message-audit | no plaintext, no public pads, no second branch from `A^b` |
| transfer | the complete suite under an unseen seed |

Run `make inspect`, edit the starter, then use `make test`. The public test checks only final delivery. `make reference-test` is author-only.

## Why the audits are separate

The mutation suite contains eight broken implementations. Six still pass every final-delivery case. The audits kill all six: plaintext protocols, a choice-tagged request, pads derived from public data, one receiver key opening both branches, and a swapped ciphertext contract.

## Week 2 alignment

Issue #412 records the published Part B requirements. While this problem was being authored, #419 independently established the published Week 2 lecture and assignment references on `main`. This problem reuses those references and remains `status: draft`; it does not move an existing pin.

## Assurance scope

Local mode is **self-paced, honor-system verification**. You own the machine, Docker daemon, and image. `reference/` and `tests/hidden/` are not bind-mounted, which keeps author artifacts out of the ordinary working path rather than out of reach.

The verifier does bound submissions, fail closed on checkpoint ids, avoid returning expected values, and derive fixtures from the deployment seed. That supports self-study and honest practice. It does **not** support competition ranking,
examination, or completion certification — those need a verifier the participant does not administer.

## Cost

Zero. No cloud account or AWS resources are used.

## For authors

`make reference-test` must report `FINAL-OUTPUT-BLIND 6 of 8` and kill all eight submission mutations plus the cleartext-verifier probe.
