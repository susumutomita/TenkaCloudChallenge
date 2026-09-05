# Find a second vote without publishing a name

> Independent, unofficial companion to Advanced Cryptography Program 2026.
> Not affiliated with or endorsed by its organizers. Contact TenkaCloud with questions.

Week 6 / order 655 / difficulty 3 / 200 points / draft / about 30–45 minutes.

You maintain a school voting service. Investigate how duplicate-vote prevention can
also erase a legitimate vote, using small numbers and visible request records.

## Participant route

1. Paste Inspect assignments from `p =` through `attempts =` into Python. Calculate
   the first marker and submit it to `label`.
2. Practice the formula and handling rules in six teaching rows. In the editor, copy
   the matching block into its function and return the last expression; public tests
   print your results.
3. Construct your own counterexamples: `unchecked` takes four request numbers whose
   order blocks two valid votes. `collision` takes five votes giving counts 4/3/2/4
   across four designs. Every construction satisfying the conditions is accepted.

The first six rows carry 100 points and the last two another 100. The construction
rows have no completed code to copy. Required rules and small examples are free.
Each row has three optional hints: mechanism → example → on-screen procedure.
Hints cost 2 points each, 48 total; a wrong answer costs 10.

| Field | What it checks | Points |
| --- | --- | ---: |
| label | Calculate a spent marker | 20 |
| repeat | Keep the marker when the vote changes | 15 |
| scopes | Separate elections | 15 |
| accept | Check before marking as spent | 20 |
| count | Count the resulting records | 15 |
| message | Test a marker that includes the vote | 15 |
| unchecked | Construct an order that erases two valid votes | 50 |
| collision | Construct five votes distinguishing four designs | 50 |

## Model and boundaries

The marker is the remainder of secret squared plus election number, by p=5 or 7.
Secrets are visible to the observer, so this exercise does not hide who voted.
It does not implement real checks of eligibility and the link between the voter,
marker and contents without exposing the secret. Instead, `verified` supplies a
practice check result; all five constructed votes are assumed checked. This is not
a cryptographic anonymous-voting or ZK implementation.

Participant images contain public tests, starter and Portal API. Only verifier/author
images contain FLAG_SEED, generators, reference answers or hidden tests. A public
deployment tag binds prepared submissions to a run; it is not authentication. Only
the separate verifier decides correctness.

Learner processes receive a prefetched public snapshot. Linux seccomp denies networking,
process-FD access, supervisor signals and resource-limit changes. Children inherit it.
The supervisor is non-dumpable and remaining descendants are terminated after a run.
CLI uses the same restrictions and refuses execution if setup fails.

Workbench port 18167 is bound to 127.0.0.1; the verifier stays internal. Both services
run non-root with read-only filesystems and resource limits. Docker owners can inspect
their own images; this exercise protects no real election or secret.

## Local verification and teardown

Run from this problem directory:

```bash
make inspect
make test              # failure is expected for the unfilled starter
make test-one ID=label
make verifier-down
```

Edited source is streamed into Docker: no host Python or shared mount path is needed.
Inspect/test leave the verifier running; stop it with `make verifier-down`. No cloud
resources are created; local CPU and memory remain in use until stopped.

Authors run `make reference-test` and root `make install` / `make agent-gate`.
Participant-only reading and real API evidence is recorded in `local/tests/hidden/READER.md`.
No AWS event or human event rehearsal was run.

[Week 6 composition context](https://github.com/zk-tokyo/advanced-cryptography-2026/blob/bdbc913fa7fd4ed87ce7f0de6b1d73fb41e49732/week6/README.md).
[Semaphore concept reference](https://js.semaphore.pse.dev/functions/_semaphore_protocol_proof.generateProof.html).
The square formula is an independently authored teaching substitute, not a real nullifier hash.
