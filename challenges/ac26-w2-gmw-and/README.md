# A correct AND is not yet private

> This TenkaCloud track is an unofficial companion built independently for learners of the Advanced Cryptography Program 2026. It is not affiliated with the course organizers and contains no official assignment solutions.

## Why

Two parties hold XOR shares of bits x and y. They need XOR shares of x AND y without reconstructing either input.

A complete four-row truth table cannot prove that. Opening x and y, computing plaintext AND, and re-sharing the answer passes every row. This lab makes the path observable: local reads, OT sessions, cross-party operations, and opens are audited separately from the output.

Prerequisites: Python, bitwise AND and XOR, and reconstruction by XOR. The preceding OT construction is supplied as an ideal fixture so this problem stays focused on Boolean MPC composition.

## What you implement

Edit `local/starter/gmw.py`:

```python
and_shared_bits(x_shares, y_shares, masks, ot_secrets)
```

The argument roles match the course Part B GMW operation. The function name, source, tests, fixtures, and runtime are independent.

## Expand before coding

```text
(x0 xor x1) AND (y0 xor y1)
  = x0*y0 xor x0*y1 xor x1*y0 xor x1*y1
```

`x0*y0` belongs entirely to party 0. `x1*y1` belongs entirely to party 1. The two cross terms need OT.

For `x0*y1`, party 0 chooses fresh mask r and offers `(r, r xor x0)`. Party 1 selects with y1. Keeping r at party 0 and the selected value at party 1 creates two shares whose XOR is `x0*y1`. Repeat in the opposite direction for `x1*y0`, with a fresh mask and session.

The supplied fixture API is `ot_secrets.local(shares, party)` for a party-local read and `ot_secrets.transfer(session, sender_party, receiver_party, (message_0, message_1), choice)` for one ideal transfer. Use session 0 from party 0 to 1 and session 1 from party 1 to 0. The runtime also has an `open` operation for auditing forbidden reconstructions; a valid gate never calls it.

## Participant Portal workflow

1. Start the problem in Participant Portal; the problem editor appears on the same page.
2. Select **Inspect evidence** to read the expansion and deployment-specific inputs.
3. Edit `gmw.py` in the Portal editor.
4. Select **Run public tests** to check the truth table.
5. Submit each checkpoint directly; Portal prepares and sends the current source.

## Checkpoints

| Checkpoint | What it observes |
| --- | --- |
| truth-table | reconstructed AND for all four inputs |
| cross-terms | two opposite-direction OT message pairs |
| output-sharing | fresh masks rerandomize shares without changing XOR |
| transcript | no open, no unscoped read, no cross-owner operation |
| privacy-audit | all construction evidence together |
| transfer | unseen shares and masks |

Run `make inspect`, edit the starter, and use `make test`. The public suite checks the truth table only. `make reference-test` is author-only.

## Why OT is a fixture here

The preceding companion owns receiver request, sender encryption, and receiver decryption. Rebuilding those formulas here would turn the Boolean gate exercise into a second OT exercise. `IdealOt.transfer` supplies that building block while recording the exact session, direction, messages, choice, and result needed for the composition audit.

## Why the audit is the real checkpoint

The mutation suite contains eight broken gates. Seven pass the complete final truth table: reconstruction shortcuts, direct cross-owner products, one-OT composition, session reuse, mask reuse, and fixed plaintext output sharing. The transcript and privacy checks kill all seven.

## Week 2 alignment

Issue #412 records the published Part B requirements. While this problem was being authored, #419 independently established the published Week 2 lecture and assignment references on `main`. This problem reuses those references and remains `status: draft`; it does not move an existing pin.

## Assurance scope

Local mode is **self-paced, honor-system verification**. You own the machine, Docker daemon, and image. `reference/` and `tests/hidden/` are excluded from the ordinary participant path, which prevents accidental delivery rather than putting them out of reach.

The verifier bounds submissions, echoes only the requested checkpoint, does not return expected values, and derives fixtures from the deployment seed. That supports self-study and honest practice. It does **not** support competition ranking,
examination, or completion certification — those need a verifier the participant does not administer.

## Cost

Zero. No cloud account or AWS resources are used.

## For authors

`make reference-test` must report `FINAL-OUTPUT-BLIND 7 of 8` and kill all eight submission mutations plus the reconstruct-and-reshare verifier probe.
