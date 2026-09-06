# Check without sending the secret — test the order of Schnorr

An independent, unofficial companion to Advanced Cryptography Program 2026, not affiliated with or endorsed by the course. Text, examples and implementation are independently written.

Week 3 / order 305, eight fields, 200 points, approximately 40–60 minutes. Status remains draft.

## Participant route

Select Start → Inspect in the Participant Portal. Read p and t first, find the integer that multiplies t to remainder 1 by p, and submit it to field-inv. Correct is the first success; all eight fields correct is completion. Paper and the Portal answer fields suffice.

| Field | Answer | Points | Purpose |
|---|---|---:|---|
| field-inv | integer | 15 | Prepare remainder division |
| add-points | [X,Y] | 25 | Add distinct points |
| double | [X,Y] | 20 | Add the same point |
| order | integer | 25 | Make a point table and count the first return to O |
| response | integer | 25 | Answer a challenge |
| verify | [X,Y] | 30 | Compare both public sides |
| nonce-reuse | integer | 30 | Extract a secret from distinct challenges sharing a nonce |
| transfer | [Rx,Ry,s] | 30 | Construct a record with the challenge known first |

Every field has three hints: mechanism, a formula with a one-digit example, then steps using Inspect names. Each costs 2 points: 24 hints, maximum 48. A wrong answer costs 10. Required formulas and examples are also free in the statement. The legacy transfer ID now accepts multiple constructed records rather than a response on a second curve.

The optional schnorr_drill.py is a scratchpad. Paper solvers leave the supplied file unchanged. Filling its functions and running public tests shows worked-example PASS/FAIL and the participant function’s current values. Tests do not award checkpoint credit; submit the values separately. No external Python is required.

## Numbers and meaning

Both coordinate primes and generator orders are 5 or 7. At most seven additions complete the point table, which later fields reuse. Tiny values from different deployments can coincide; the verifier checks mathematical validity, not where a submitted number originated.

The final construction uses R=sG−efP2 without a supplied secret. It makes a record after the challenge is known; it does not demonstrate knowledge in the normal interaction where R is fixed first. Signature hashing and distributional proofs are outside this exercise. These tiny groups can be searched completely and provide no practical secrecy.

Source review covered the seminar’s Week 3 printed slides 54–60 (interactive protocol, extraction, simulator) and 61–62 (signature transformation), its schnorr-from-scratch assignment, and the author’s advanced-cryptography-note/week3/index.html sections on point addition, response, verification and simulation. The multiplicative seminar equations are expressed as elliptic-curve addition; examples and implementation are independent of the assignment’s large fixed test values.

## Runtime boundary and lifecycle

Compose separates the participant Workbench from an unpublished verifier. Only the Workbench is exposed at 127.0.0.1:18132. Its image contains starter, public tests and display code, not fixtures, expected values, hidden checks or reference answers. The trusted Workbench supervisor fetches public inputs and passes a snapshot to learner processes. They receive neither the seed nor verifier URLs. The existing PLONK Linux syscall filter and supervisor protection are reused. The final record is checked against the public equation, independently of any single reference answer.

The participant prepares field-bound submissions at /api/prepare and sends them to /verify. The verifier checks problem identity, field and signature. Containers run non-root with read-only filesystems, dropped capabilities, CPU/memory/PID limits and internal networking. This does not protect hidden material from a local Docker administrator.

No AWS resources are created. Local Docker consumes host CPU, memory and disk. Use make verifier-down to stop this problem’s Compose project; the platform owns event teardown.

## Author verification

From this directory:

```sh
make reference-test
make test STARTER_FILE=local/reference/schnorr_drill.py
```

The reference target runs implementation mutants plus regressions for independently calculated point tables, all final constructions, malformed inputs, and Linux seed/parent-process/network isolation. Run make install && make agent-gate at the catalog root. Independent reader and participant API evidence is recorded in local/tests/hidden/READER.md. Live AWS and third-party participant validation remain unrun, separate from local evidence.
