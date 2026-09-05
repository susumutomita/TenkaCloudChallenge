# Rotate an answer table and repair its error tolerance

> Independent, unofficial companion to Advanced Cryptography Program 2026.
> Not affiliated with or endorsed by its organizers. Contact TenkaCloud with questions.

Week 5 / order 563 / difficulty 3 / 200 points / draft / about 40–60 minutes.

You check an answer table used in encrypted computation. Follow small arithmetic,
find where changing rounding order changes the answer, and repair position tolerance.

## Participant route

1. Start the problem and Inspect evidence. In `rotation_drill.py`, replace the first
   `return None` with `return (p,q,n,q//p)`. Run public tests and submit `params ->`.
2. Fill the next five functions using the matching free blocks. Tests check a worked
   example and print the learner's own values for the deployment. Unfilled rows do
   not prevent submitting another row.
3. Construct a pair for `window` and a new table for `edge`. The latter must work
   across every stated message and offset. Any construction satisfying the conditions
   is accepted; there is no single required witness.

| Field | What it checks | Points |
| --- | --- | ---: |
| params | Message spacing | 20 |
| phase | Remove key-selected mask entries | 15 |
| testpoly | Build the entire answer table | 15 |
| rescale | Round three values onto the position scale | 20 |
| index | Separately rescale before subtraction | 15 |
| readout | Read with sign reversal after one table lap | 15 |
| window | Construct two rounding orders with different answers | 50 |
| edge | Construct a table correct for all messages and offsets | 50 |

All required rules and small examples are free. Each row has three optional hints:
mechanism → example → on-screen procedure. Hints cost 2 points each, 48 total;
a wrong answer costs 10. Construction rows supply no completed code. Deployed tables
have eight entries, requiring transfer from the four-entry worked example.

## Model and boundaries

The observer sees the key. This models arithmetic positions and signed table reads,
not blind encrypted rotation or ciphertext refresh. Outputs are ordinary numbers.
Python `round` uses nearest integer with ties to even; it is not half-up rounding.
Only the stated lower-half message range is guaranteed. No claim says that every
upper-half read must be wrong: negating zero still gives zero.

Shapes are `(p,n,q)=(4,8,32)` or `(8,8,32)`. Mask entries stay single-digit. Public
helpers explain the table and rounding rules; private predicates independently check
the first six values and the two constructions. The counterexample compares answers,
not merely positions, and neither rounding order is assumed universally correct.

The participant image contains starter, public tests, helpers and Portal API. The
seed, generator, hidden checks and reference answers exist only in verifier/author
images. The Workbench prefetches public evidence and gives learner code only that
snapshot. A deployment tag binds prepared answers to a run; it is not authentication.
The unpublished verifier grades answers without executing learner code and returns
no reason for a failed direct answer.

Linux seccomp restricts learner networking and access to supervisor memory, signals,
and resource limits. Children inherit restrictions and remaining descendants are
terminated after execution. CLI uses the same launcher protections and fails closed.
Both services are non-root, read-only and resource-limited; Workbench port 18138 is
published only on 127.0.0.1. Docker owners can inspect their own images.

## Local verification and teardown

Run in this problem directory:

```bash
make inspect
make test                  # expected failure for the unfilled starter
make test-one ID=params
make verifier-down
```

Edited source is streamed over stdin into Docker; no host Python or shared mount
path is required. Inspect/test leave the verifier running. Stop it with
`make verifier-down`. No cloud resources are created; local CPU and memory remain
in use until stopped. There is no AWS Region or cloud session cost for this runtime.

Authors run `make reference-test`, then root `make install` and `make agent-gate`.
Participant-only reading and runtime evidence are recorded in
`local/tests/hidden/READER.md`. A real AWS event and human event rehearsal are unrun.

[Course context](https://github.com/zk-tokyo/advanced-cryptography-2026/blob/c088f8e6f301dedcd80b6dd9c321a1cd83410637/week5/README.md).
[Python rounding rule](https://docs.python.org/3/library/functions.html#round).
[Real TFHE bootstrapping](https://www.zama.org/post/tfhe-deep-dive-part-4).
