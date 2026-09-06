# #716 participant reading and runtime evidence

## PR #761 review corrections

Review of `237fff3` found that checking only honest cases and known forgeries
accepted an incomplete two-dictionary build, and that repair accepted the missing
expression under a different ID. The trusted checker now requires all five
documented dictionaries for build and the exact missing dictionary for repair,
while preserving the supplied dictionaries. List order is not graded. Regression
cases cover each omitted dictionary, changed IDs and signal bindings, a duplicate,
and a valid reversed list.

Function-call failures now say that the named function did not return a value.
They no longer attribute the value-channel wrapper's `ValueError` to an unfinished
participant function; private exception messages remain excluded. Fork cleanup
requires the child PID to disappear, rather than treating a zombie as reaped.

Verification after these changes:

- Existing 7 author mutations killed and 15 Linux boundary tests passed.
- Unchanged independent reader passed the existing 38-check actual HTTP suite,
  including all six checkpoints and the manually calculated diagnosis.
- Actual `/verify` rejected the two-dictionary build and renamed repair in their
  individual checkpoints and transfer. An unfinished audit returned
  `audit did not return a value`, without a fabricated exception type or the
  private exception marker.
- Compilation, diff validation and catalog validation (116 entries) passed.

Local logs: `/private/tmp/underconstraint-761-reference-test.log` and
`/private/tmp/underconstraint-761-http-acceptance.log`. Tests used the same dedicated
port 18147 and synthetic `underconstraint-reader-716` seed. This follow-up is local
runtime verification, not a new independent reading or production deployment.

Scope: only `ac26-w1-underconstraint`, based on `7bec128`. No shared runtime, scoring contract, cloud resources, release or other problem changed. The learner-facing problem still has six checkpoints worth 300 points and 15-point wrong-answer penalties. All six now have three hints, totalling 80 points.

## Read before looking at answers

An independent reader first read the Japanese and English statements, every hint, the supplied `policy.py`, and the real public `/api/config`, `/api/starter` and `/api/inspect` responses. This happened before reading reference solutions or hidden grading. The initial reading found six actual gaps:

1. The root-cause checkpoint claimed a JSON format existed in the editor, but no field names or example were supplied. The reader could not submit that checkpoint.
2. The starter gave the A equation but omitted its required constraint dictionary keys.
3. Prover, signal, gadget and seed appeared without local definitions; ZK/zkRollup assertions preceded any first action.
4. An invalid helper assignment was described as a false ZK claim. Missing A can leave the entry decision correct; the exercise checks constraints rather than producing a ZK proof.
5. Root-cause had no hint, and the other hints did not provide all three rungs.
6. The inverse procedure lacked the nonzero-remainder precondition, and `= 0` was not clearly defined as remainder zero.

The reader wrote the five-code-checkpoint solution from the public formulas and dictionary inference. Its SHA-256 is `3e82b86fe00218637d93860a2d9d036e78dab6afcf3706cb16bae5295a39da16`. The source passed all five code checkpoints on the baseline API and was kept unchanged for the revised API. The missing JSON answer was not guessed or obtained from the verifier.

The revised independent reading covered both languages and all 18 hints. It requested two final local definitions (`id`, and replacing undefined `residual`) and the full first action Start → Inspect evidence; these were incorporated.

## Concrete reasoning from the public deployment

The dedicated local run used synthetic `FLAG_SEED=underconstraint-reader-716`, project `ac26-underconstraint-reader-716`, public port 18147. Public evidence showed `p=137`, `revoked=131`, `issuer_ok=1`, honest `inv=114`, with A absent.

The reader checked the unchanged inputs on paper:

- Honest A: `131 × 114 − 1 = 14933 = 137 × 109`, remainder zero.
- Change only inv from 114 to 0. The supplied B and entry expressions remain zero; intended A becomes `−1`, remainder 136.
- Thus the auxiliary inverse is wrong, but `granted=0` remains the correct decision.

Once the revised public JSON format was supplied, the reader independently formed:

```json
{"missingConstraintId":"c-iszero-a","manipulatedSignals":[{"signal":"inv","before":114,"after":0}]}
```

The actual API accepted this JSON, all five unchanged code submissions and the alternative valid diagnosis with `after=1`. It rejected a wrong id, unchanged inverse, negative/out-of-range numbers, booleans, fractions, strings, arrays, objects and null. Direct-answer failures disclosed no reason.

These are public-only reading and submission observations. Subsequent hidden-checker inspection and author mutation tests below are separate runtime evidence, not evidence that an unseen answer was recoverable from the statement.

## Runtime defect and fix

Before the fix, an actual `/verify` build request containing only the following source was accepted:

```python
import os
print('{"failures": []}', flush=True)
os._exit(0)
```

The previous execution path trusted learner-controlled output as the authoritative result. The problem-local execution/isolation implementation was adapted from the existing `ac26-bridge-properties` work, with no new shared-runtime family. Only function inputs and the supplied public evaluator enter the learner worker; trusted checking remains in the parent. The worker carries no fixture seed or imported checker. Non-root Linux execution closes file opening, new network sockets, exec and supervisor signalling/limit modification before the source runs, with bounded time/output and process-group cleanup. Workbench no longer receives `FLAG_SEED`.

The final worker evaluates only functions required for the checkpoint. A looping unfinished repair does not block build, audit or exploit; a looping unfinished forge does not block repair. The closing transfer check still requires all four functions. Repair alone uses trusted known counterexamples and honest cases; the optional learner-counterexample check also runs during transfer.

The final actual HTTP regression rejects the old stdout shortcut on all five code checkpoints. Importing `participant.evaluator` works inside both the real Workbench public-test worker and verifier worker. Unseen function inputs printed or put into exception messages do not appear in scoring feedback.

## Reproducible checks

Run from the problem directory:

```bash
make test
make reference-test
make verifier-down
```

The reference target includes the Linux execution-boundary suite in a non-root, read-only, network-disabled container. Recorded local checks:

- Participant image public CLI: all 13 tests passed; the deliberately incomplete starter still passes these honest-case/shape-only checks.
- Author reference solution and all 7 existing mutations: passed / killed respectively.
- Linux execution boundary: 12 tests passed, including two synthetic seeds across all five code checkpoints, verdict spoofing/import rejection, checkpoint independence, supplied evaluator import, canonical integer diagnosis, fixed-input preservation, no private file/network/seed access, same-UID supervisor protection, timeout and fork cleanup.
- Real HTTP: all six participant answers correct, public test/prepare source identity preserved, evaluator import supported, invalid diagnosis and old verdict shortcut rejected, hidden/unknown routes return 404, API healthy after rejected input.
- Python compilation and `git diff --check`: passed.
- Catalog `make agent-gate`: all 116 entries passed.

The checkout is under `/private/tmp`. On this Docker host, its read-only bind mount appeared as an empty directory, so unmodified `make test` stopped at `ModuleNotFoundError: policy`. The same target was then run with `RUN` selecting `compose exec -T workbench`, using the image-copied starter; the full participant public suite passed. This is a local mount limitation, not evidence that bind-mounted editor files were tested. The real editor source path was separately exercised through `/api/test`, `/api/prepare` and `/verify`.

Session logs are `/private/tmp/underconstraint-716-{http-acceptance,public-cli,reference-test,copy-gate,make-test,make-test-image}.log`. The independent first reading and original source are in `/private/tmp/underconstraint-716-reader/`. These temporary artifacts support this local run; the checked-in suite is the reproducible regression boundary. The parent also ran the real Portal component against API 18147: one component harness test passed in 2.96 seconds, submitting the unchanged reader source for all five code checkpoints and the manually derived inv114→0 JSON for the sixth. All six received correct verdicts and each solved row collapsed. Evidence: `/private/tmp/underconstraint-716-portal-harness.test.tsx` and `/private/tmp/underconstraint-716-real-portal-component.log`. This tests the actual Portal component-to-HTTP boundary; it is not a real browser or device test. No live AWS event, third-party timing or production deployment is claimed.

## Both teaching inputs

Read the official `advanced-cryptography-2026/week1/problems/proof-of-exploit/README.md` and the owner's `advanced-cryptography-note/week1/index.html`, including the proof-of-exploit/underconstraint sections. The sequence uses their distinction between computing a value and constraining an assignment, and between rejecting a counterexample and preserving honest cases. It keeps this companion's revocation/issuer policy and signal names; it does not copy the official role/clearance/region assignment solution.
