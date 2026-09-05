# Compute with sign flips, then tolerate more noise

> Independent, unofficial companion to Advanced Cryptography Program 2026.
> Not affiliated with or endorsed by its organizers. Contact TenkaCloud with questions.

Week 5 / order 565 / difficulty 3 / 200 points / draft / about 40–60 minutes.

You check a tiny NAND device: it returns zero only when both input bits are one.
Follow the signed table reads, then construct a noise failure and new arithmetic
that remains correct across all inputs and all stated displacements.

## Participant route

1. Start the problem and Inspect evidence. In `negacyclic_drill.py`, replace the first
   `return None` with `return (p,2*n,n,(2*n)//p)`. Run public tests and submit `params ->`.
2. Fill the next five functions using the matching free blocks. Tests check a worked
   example and print the learner's own values for the deployment. Unfilled rows do
   not prevent submitting another row.
3. Construct `[bit_a,bit_b,total_noise]` for `constants`, showing failure beyond the
   original total-noise bound. Then construct `[bias,weight_a,weight_b]` for `margin`
   that preserves NAND across all four inputs and every total noise from zero through
   `repair_noise`. Any satisfying construction is accepted.

| Field | What it checks | Points |
| --- | --- | ---: |
| params | Full signed cycle and message spacing | 20 |
| wrap | Remaining exponent and sign after wrapping | 15 |
| signs | Signed reads at six positions | 15 |
| boundary | First negative read position | 20 |
| hazard | One table lap too far | 15 |
| rotations | Read positions for the four input pairs | 15 |
| constants | Construct a larger-noise NAND failure | 50 |
| margin | Construct arithmetic tolerating all stated noise | 50 |

All required rules and small examples are free. Each row has three optional hints:
mechanism → example → on-screen procedure. Hints cost 2 points each, 48 total;
a wrong answer costs 10. Construction rows supply no completed code. Their final hints describe finite
searches with explicit candidate ranges, checks and termination.

## Model and boundaries

The device is a visible arithmetic model, not encrypted TFHE or ciphertext refresh.
It reads an all-ones table, reversing sign after n positions. Bits 0/1 encode as
p-1/1. The original phase is `(1-m1-m2)%p`; multiply by D and subtract total noise
before taking the cycle remainder. Only the two-one input reads a negative value
under the original bound. This is NAND when signs +1/-1 decode as bits 1/0.

Parameters are p=16,n=8,q=16,D=1. Individual input displacements sum to at most one;
probes vary and include negative or wrapped positions. The repair must tolerate total
noise up to two or three. Unlike the old n−3D distance claim, the actual first failure
is a mixed input wrapping below zero when total noise reaches two. The repair changes
three coefficients and is checked against all inputs and all allowed noise values.
The final model supplies displacement after the weighted calculation; it does not
claim to model how weights amplify noise from separate real input ciphertexts.

The participant image contains starter, public tests, helpers and Portal API. The
seed, generator, hidden checks and reference answers exist only in verifier/author
images. The Workbench prefetches public evidence and gives learner code only that
snapshot. A deployment tag binds prepared answers to a run; it is not authentication.
The unpublished verifier grades answers without executing learner code and returns
no reason for a failed direct answer.

Linux seccomp restricts learner networking and access to supervisor memory, signals,
and resource limits. Children inherit restrictions and remaining descendants are
terminated after execution. CLI uses the same launcher protections and fails closed.
Both services are non-root, read-only and resource-limited; Workbench port 18136 is
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
[Real TFHE bootstrapping](https://www.zama.org/post/tfhe-deep-dive-part-4).
