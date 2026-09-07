# #716 participant reading and runtime evidence

## Persistent IPC follow-up

Review of the same isolation boundary in #762 reproduced a SysV object surviving
worker termination. This problem now denies SysV and POSIX persistent IPC operations
as well. The Linux suite checks 16 repeated sessions with EPERM and unchanged
`/proc/sysvipc/{shm,msg,sem}` tables. No scoring or participant text changed.

`make reference-test FLAG_SEED=underconstraint-reader-716` passed all 7 mutations and
22 Linux tests (20.212 seconds for the boundary suite). The dedicated HTTP rerun still
rejects old/fixed/wrong/reused result identifiers and unfinished required functions;
valid independent functions and public/private requests pass. Sixty-four forked HTTP
submissions again reaped all 256 descendants, with process counts 3/3/3 before/after/max.
Logs: `/private/tmp/underconstraint-761-ipc-{reference,http,compose}.log`.


## PR #761: reject queued startup results (follow-up to 990f85b)

The reported path was reproduced against the actual dedicated API before editing:
a source with no `intended_circuit` function printed the old batch envelope
`{"values":[{"returned": [the five correct public dictionaries]}]}` and called
`os._exit(0)`. Build returned `correct: true`. Unlike the earlier empty-`failures`
exploit, these dictionaries still had to pass the trusted parent's property checks;
the defect was accepting a queued startup result without a subsequent call.

The same unchanged spoof source now returns `correct: false`. `run_functions`
keeps its existing `values`/`output` return shape and `check_policy` is unchanged.
Only the problem-local execution channel changed:

1. Send source files alone; do not send calls or future identifiers at initialization.
2. Wait for the ready acknowledgement.
3. Mint a fresh, unpredictable 128-bit identifier in the trusted parent and send one
   function name and its arguments. Accept only the corresponding returned/raised
   value with that identifier, then mint another identifier for the next call.
4. Discard incomplete batches on EOF. A single shared deadline and output budget cover
   initialization, writes and reads. Completion, early exit, malformed output and
   timeout all kill the complete process group; Docker init reaps descendants.

The identifier rejects preprinted results, predictable-ID replies and replies from
older calls. **It is not an attestation that a Python function body executed a return
statement.** Arbitrary learner Python can read its later function inputs and implement
the reply protocol itself. Its values remain untrusted and must satisfy the parent's
actual mathematical/property checks. No additional file descriptor is claimed to
be protected from that same Python process, and the channel never becomes the source
of truth for a grade.

Validation of this follow-up (synthetic seed `underconstraint-reader-716` only):

- `make reference-test`: all 7 existing mutations killed, 21 actual Linux boundary
  tests passed. New cases cover the five-correct-dictionary static spoof, ready plus
  predictable ID 1, fresh 32-hex-digit identifiers absent at initialization, a wrong
  identifier, reuse of a previous identifier, EOF after a partial batch, unterminated
  output, excessive/deep JSON output, blocked input and full descendant reaping.
- The unchanged independent reader SHA
  `3e82b86fe00218637d93860a2d9d036e78dab6afcf3706cb16bae5295a39da16`
  passed the existing 38-check actual HTTP suite: all five code checkpoints and the
  manually derived inv114→0 JSON still pass; prepare preserves the same source.
- Additional actual HTTP requests rejected the identical previously accepted static
  spoof, predictable/wrong identifiers, reused audit replies and partial audit EOF.
  Repair still passes with a looping forge function; build still passes with looping
  repair. Transfer correctly fails when its required forge is unfinished.
- 64 actual HTTP build submissions created 256 forked descendants. Every settled
  request had zero zombies; process counts before/after/max were 3/3/3, including the
  measurement process. The Linux suite additionally waits for every extra PID to
  disappear, not just for a transient zero-Z snapshot.
- The image-copied participant public CLI still passes all 13 tests. Catalog validation
  passes all 116 entries. Python compilation and diff validation pass.

Evidence: `/private/tmp/underconstraint-761-static-before.log`,
`underconstraint-761-static-spoof.py`, `underconstraint-761-interactive-reference.log`,
`underconstraint-761-interactive-http-acceptance.log`,
`underconstraint-761-interactive-http.log`, `underconstraint-761-interactive-public.log`
and `underconstraint-761-interactive-catalog.log` (all under `/private/tmp`). The runtime
was the dedicated local project `ac26-underconstraint-reader-716`, API port 18147.
This is an implementation regression check, not a new participant-only reading,
real browser test or AWS deployment.

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

## 2026-09-07 follow-up: persistent IPC and same-UID scheduling

This follow-up is based on main `d444d3b1954e7f1cdf6ebe0a186b09ce81e15fee`.
It changes the local syscall deny policy and regression tests only; participant
copy, formulas, checkpoint IDs, scoring, and production time limits are unchanged.
The three confirmed consumers are constraint-lab, bridge-properties and
underconstraint. Their helpers remain problem-local.

A legacy constraint worker created one tiny System V shared-memory segment,
message queue, semaphore and POSIX message queue. All four survived learner exit.
The trusted probe parent removed every object in `finally` and verified the original
namespace state. `/private/tmp/constraint-ipc-716-evidence/baseline-ipc.log` records
creation/survival booleans and successful cleanup. POSIX `mq_open` is its own syscall;
blocking file opens alone does not prevent it. Existing open/openat restrictions
already block POSIX shared-memory and named-semaphore creation. System V and `mq_*`
entry points are now denied where missing.

A second isolated reproduction targeted only a disposable Linux helper parent.
Its same-UID child changed scheduler policy0→5 (SCHED_IDLE), nice0→19,
affinity4CPUs→1CPU, and I/O priority0→24576. All six mutating calls succeeded with
the legacy filter. The child was reaped and the helper then exited. No host process,
existing HTTP parent or shared deployment was targeted. The final tests launch a
fresh helper, verify all six changes return EPERM, verify scheduling/priority reads
still succeed, compare the parent's complete before/after snapshot, and remove the
whole helper group even on failure. `sched_setscheduler`, `sched_setparam`,
`sched_setattr`, `sched_setaffinity`, `setpriority` and `ioprio_set` are denied.
The baseline is `/private/tmp/constraint-ipc-716-evidence/baseline-scheduling.log`.

For libc `mq_unlink`, the exact public error is EACCES: glibc deliberately converts
kernel EPERM. The test checks that mapping and separately checks raw `mq_unlink`
returns EPERM; no assertion was weakened to accept arbitrary failures.
[glibc mq_unlink implementation](https://codebrowser.dev/glibc/glibc/sysdeps/unix/sysv/linux/mq_unlink.c.html).

Final Linux checks used dedicated author images, `--init --network none --read-only`,
a64MiB writable /tmp, dropped capabilities, no-new-privileges,1GiB memory and128PIDs.
All scheduling reproductions stayed inside these disposable containers.

- `underconstraint-linux.log`:23 tests PASS, including the new disposable-parent
  scheduler test and all existing verdict, phase-independence, isolation, mutation,
  fixed-input and public-diagnostic regressions.
- `underconstraint-mutations.log`:7 existing mutations killed.
- Its merged policy already denied System V and POSIX mqueues. This problem's
  production change adds only the six scheduler/I/O-priority writer denials.

Logs are under `/private/tmp/constraint-ipc-716-evidence/`. The shared catalog gate
`make install && make agent-gate` validates116 metadata files separately. Each
problem’s existing `make reference-test` runs its own mutation and Linux suites;
recorded runs used equivalent commands with dedicated image names.

## Filesystem metadata backport, 2026-09-07

At base 6416dab5af5805211b020f03c218a8827d66a201, this problem's own unchanged `restrict_learner` allowed mkdir, symlink, hardlink and FIFO creation. All four entries remained in a parent-owned TemporaryDirectory after the filtered child exited. `filesystem-before.json` records the policy hash and actual results; the fixture was then removed. The original log is `/private/tmp/filesystem-716-before.log`. No live Workbench, participant environment, external network or host folder was targeted.

The fix copies the proven native metadata-operation deny rules from linear 2444001 into this problem only. It does not share a runtime, change the loader or add an endpoint. The new `FilesystemMetadataBoundary` test in `test_execution_boundary.py` loads this consumer's actual filter in 16 disposable Linux children, requires EPERM for all 19 operations, and checks the parent's fixture content, directory listing, mode, uid/gid, mtime and extended attributes after each child exits. The TemporaryDirectory is also removed. This is an actual-filter regression, not a new participant playthrough or an attestation of all filesystem/kernel behavior.

Validation uses a dedicated `ac26-filesystem-716-w1-underconstraint-author` image with `docker run --rm --init --network none`, read-only root, private /tmp, dropped capabilities and no-new-privileges. The unchanged reference/mutation and complete existing runtime/public-check suite are run, together with the new regression. Logs are `/private/tmp/filesystem-716-w1-underconstraint.log`. No Compose project or listening service is started.

Reproduce from this problem's directory (the commands of `reference-test`, with explicit network and container isolation):

```sh
docker build --target author -t ac26-filesystem-716-w1-underconstraint-author local
docker run --rm --init --network none --read-only --tmpfs /tmp:rw,noexec,nosuid,size=67108864 --cap-drop ALL --security-opt no-new-privileges:true --memory 1g --pids-limit 128 -e FLAG_SEED=filesystem-reader-716 ac26-filesystem-716-w1-underconstraint-author python mutation.py
docker run --rm --init --network none --read-only --tmpfs /tmp:rw,noexec,nosuid,size=67108864 --cap-drop ALL --security-opt no-new-privileges:true --memory 1g --pids-limit 128 -e FLAG_SEED=filesystem-reader-716 ac26-filesystem-716-w1-underconstraint-author python -m unittest discover -s tests/hidden -p test_execution_boundary.py -v
```

`make agent-gate` at the catalog root checks all 116 entries. This follow-up adds no new HTTP/UI flow; the existing suite exercises the unchanged positive/public-check paths with synthetic data. The prior live/API evidence above remains historical rather than being claimed as a new playthrough.

Final result: 7 existing mutations killed; 24 complete runtime tests pass in 34.721s, including the new filesystem case. Existing reference and public positive checks pass without changing their sources.

### Computational allowance regression (2026-09-07)

A new local author regression sends a function that uses six seconds of actual CPU
time through the real isolated worker. The previous `(5, 6)` CPU limit terminated
it before the documented 15-second wall deadline. The unchanged filesystem-baseline
author image also rejected imports of computational helpers such as `fractions`.
The updated worker preloads the documented 14 standard libraries and sets the CPU
limit from the existing 15-second execution budget. No filesystem or network rule
was relaxed.

The participant's inbound body timeout remains 15 seconds. Its outbound verifier
wait is 35 seconds, covering two sequential 15-second workers used by audit/transfer. A real loopback HTTP regression uses a
response delayed beyond a scaled inbound timeout but inside the outbound budget;
an expired outbound request or mismatched checkpoint still yields a failed verdict.
The test deliberately does not claim that the scaled transport delay is a full
15-second end-to-end run. These are author regressions, not a new independent
participant read-through or AWS rehearsal. Run `make computation-test` and
`make reference-test` to repeat the checks.

The final `make reference-test computation-test` run passed the existing reference,
mutation and Linux boundary suites plus all four new computation/HTTP regressions.
Catalog validation passed for all 116 entries. During validation, the existing
sub-second timeout test caught an invalid floating-point CPU limit; rounding up to
an integer preserves that short wall deadline without failing worker startup.
