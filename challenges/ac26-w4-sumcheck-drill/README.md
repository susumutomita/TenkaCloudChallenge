# Catch a false sum with short expressions

> Independent, unofficial companion to Advanced Cryptography Program 2026.
> Not affiliated with or endorsed by its organizers. Contact TenkaCloud with questions.

Week 4 / order 405 / difficulty 3 / 200 points / draft / about 40–60 minutes.

Audit a tiny calculation using remainders by 5 or 7. Follow two SumCheck messages,
then construct false messages that expose why the check position must be chosen
after fixing the message. This exercise uses ordinary visible arithmetic.

## Participant route

1. Start → Inspect evidence. Open `sumcheck_drill.py`, replace the first `return None`
   with `return layer(p,x)`, run public tests, and submit the value after `circuit ->`.
2. Fill the next five functions using their free blocks. Each function has its own
   inputs and supplied helpers. Public tests check a worked example, then print the
   learner's own deployment values. An unfinished row does not block another answer.
3. Construct a false second message matching an early-revealed r2. Then construct
   two false messages with exactly two blind spots each and no shared blind spot.
   Any construction satisfying the stated conditions is accepted.

| Field | Return value | Points |
| --- | --- | ---: |
| circuit | Addition result, multiplication result, total | 20 |
| mle | Line evaluations at 0,1,2 | 15 |
| grid | Evaluations at (0,0),(0,1),(1,0),(1,1) | 15 |
| round1 | First endpoint sum, value at r1 | 20 |
| final-check | Second endpoint sum, value at r2, independent g(r1,r2) | 15 |
| lie | False first endpoint sum, false next claim | 15 |
| lie-caught | Three coefficients matching the false sum and early r2 | 50 |
| miss-points | Two coefficient triples with disjoint pairs of blind spots | 50 |

Every required formula and small example is free. Each field has three optional
hints: mechanism → example → on-screen procedure. Each costs 2 points, 48 total.
Wrong answers cost 10 points. Closing hints give bounded searches with termination;
completed construction code is not supplied.

## Mathematical scope

The honest first message sums g(t,0) and g(t,1); the second fixes r1 and equals
g(r1,t). Both have degree at most two. The endpoint identities connect each round,
and the final evaluation is checked against the verifier's own g(r1,r2).

The protocol chooses each challenge after the corresponding message is fixed.
This exercise displays completed, selected practice records. Its r1 is at least
two, its inputs are nondegenerate, and its dishonest next claim differs from the
honest claim, so both construction tasks have solutions. It does not simulate
uniform sampling of full protocol runs. The early-r2 task intentionally reverses
the secure ordering; the final task omits r2 and checks every possible position.
For each constructed fixed false second message, exactly two of p positions agree
with the truth. The resulting 2/p is conditional on this final check; it is not
the soundness bound for the full two-round protocol. Tiny fields are not secure.

No speedup, succinct proof size, input privacy, or complete zero-knowledge proof is
claimed for this toy. See [Thaler, Proofs, Arguments, and Zero-Knowledge,
Chapter 4](https://people.cs.georgetown.edu/jthaler/ProofsArgsAndZK.pdf) for the
message order, degree checks, final evaluation, and full-protocol soundness bound.

## Runtime boundary

The participant image contains starter, public tests, arithmetic helpers, and the
Portal editor API. Seed, generator, hidden checks, and reference answers remain in
the verifier/author images. The Workbench prefetches public evidence before running
learner code. Prepared submissions are tied to this run; that tag is not authentication.
The unpublished verifier grades values and construction properties without executing
learner code. Failed direct answers carry no reason.

Linux seccomp restricts learner networking and access to supervisor memory, signals,
and resource limits. Restrictions are inherited by children; remaining descendants
are stopped after execution. The streamed CLI uses the same launcher and fails
closed if restrictions cannot be installed. Services are non-root, read-only and
resource-limited. Only port 18133 is published, on 127.0.0.1. Docker owners can
inspect their own images; this is not a complete adversarial sandbox claim.

## Local verification and teardown

Run in this problem directory:

```bash
make inspect
make test                  # the unfilled starter should fail
make test-one ID=circuit
make verifier-down
```

Source is streamed to Docker over stdin, requiring neither host Python nor a shared
mount path. Inspect/test leave the verifier running; stop it with `make verifier-down`.
No cloud resources or AWS Region are used. Local CPU/memory stay in use until stopped.

Authors run `make reference-test`, root `make install`, and root `make agent-gate`.
Participant-only reading and actual test/prepare/verify evidence are recorded in
`local/tests/hidden/READER.md`. A human event rehearsal and real AWS event are unrun.
