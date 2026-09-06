# Issue #716: properties evidence (author-only)

Scope: `ac26-bridge-properties`, based on main
`ad473cdcd43e7ce4b4f2a9a8685983c2f5652b2e`. No other problem or shared runtime changed.

## Primary teaching sources read

- Seminar repository `advanced-cryptography-2026`, commit
  `bdbc913fa7fd4ed87ce7f0de6b1d73fb41e49732`:
  `week1/problems/proof-of-exploit/README.md`, lines 14–23, 58–66 and 74–103.
  It defines constraints/witnesses and makes students construct values satisfying
  the implemented checks while violating intended conditions. Completeness and
  soundness require different tests, not a single happy path.
- Owner's `advanced-cryptography-note`, commit
  `58344a29ea39c25839475ba9a594c115ed89989b`:
  `week1/index.html`, lines 863–875 and 913–915, connects missing/extra constraints
  to accepting invalid inputs/rejecting valid ones. `week3/index.html`, lines
  2708–2738, distinguishes completeness, knowledge soundness and zero knowledge.
  This exercise therefore explicitly limits its `sound` and `private` labels to
  toy input validity and record disclosure. Public equations do not hide `w`.
- Root `AGENTS.md` §12b/§12c/§12d and Issue #716: definitions before use, required
  formulas and small examples in the statement, one mechanism/example/action hint
  per checkpoint, and a final transfer beyond copying a visible number.

## Independent participant-only first read

The root reader received JA/EN statements, hints joined by checkpoint ID, both
starter files, and real `/api/inspect`, `/api/config`, `/api/starter` output from the
baseline dedicated Compose project. It did not read hidden/reference material.
Packet: `/private/tmp/properties-716-reader/` (`baseline-*`, `first-reading.md`).

The first pass caught actual gaps:

1. The visible valid value is not at the lower bound, so the incomplete verifier
   accepts it. The statement did not explain that submission passes a different
   boundary input to the function.
2. “A congruence cannot be solved like an equation” was false. Finite search is the
   entry method here, not a claim about the impossibility of algebraic solutions.
3. Public conditions determine the small witness, so `private` is not a secrecy or
   zero-knowledge guarantee. The transcript exercise is explicitly limited.
4. Rejecting false existential statements and rejecting invalid supplied witnesses
   were conflated. The toy uses the latter input-validity condition.
5. Generic always-accept/reject examples did not explain actual `relation`, `range`
   and `range(strict-lo)` names. The rewrite connects their exact formulas to a
   small table and gives `w+p` and nested-dictionary reading before the hints.

All five checkpoints now have mechanism → example/formula → named screen/file
steps in JA and EN. Each costs 3+3+4 in hints; total remains 50. No new checkpoint,
point total or extra manual/CLI requirement. The final functions still have to
work on unseen numeric arguments. The closing questions compare repairing a range
check with removing a recorded value.

The reader reread both revised statements and all 15 hints in each language, plus
both starters, and reported no remaining mathematical or input-route blocker.
Its two sources were sent unchanged through the actual API:

- `reader-classify.py`: SHA256
  `9a6a8279fca0abf20c305e31d93448f78e8b2790d8d32d64a7f9150faf7089ac`
- `reader-counterexamples.py`: SHA256
  `e5c82bce41a1db25500b6635f85b4bd5e2b111d07d2de846883c888480209c26`

## Runtime defects found along the same participant route

The old transfer used an unseen seed for protocol aliases as well as numbers. A
learner following the documented name-based `if` branches could not classify the
unannounced aliases. Transfer now keeps the public deployment aliases and changes
only numeric cases/records.

The old evaluator executed submitted modules beside the hidden checker and trusted
its stdout failure list. A source that printed `{"failures": []}` with a flush and
exited scored transfer without computing anything. The Workbench also passed the
seed into learner environment; process environments exposed it. These were confirmed
through the baseline public HTTP endpoints using only a dedicated synthetic seed.
`/private/tmp/properties-716-baseline-boundary.log` records booleans, never seed values.

The replacement sends only source and function inputs to the child. The trusted
parent generates cases and checks returned JSON values. The worker has no checker,
seed or expected results, and Linux denies file opening/exec/network and supervisor
interference before learner code runs. Private inputs printed by failing prepare
are not returned. The public proxy still permits only the existing fixed routes.

## Verification and limits

- Actual HTTP: 29 checks, including unchanged public-only reader code → public
  shape test → prepare → all five correct; independently computed visible values;
  wrong/in-range/fractional/boolean answers; forged failures/values; fixture import;
  hard-coded visible answers failing transfer; private routes returning 404; health
  after failures. `/private/tmp/properties-716-http-acceptance-final.log`.
- Linux boundary: 8 tests passed, with 3 synthetic runs proving current public names
  suffice for unseen numbers. Tests also cover direct libc file/network probes,
  every process environment path enumerated by the parent plus self/PID1, exec,
  supervisor signalling/resource limits, fork cleanup, timeout, and hidden-input
  feedback. `/private/tmp/properties-716-linux-boundary-final.log`.
- The first process probe stopped at `os.listdir('/proc')`, because directory opening
  is also denied. The test was corrected to pass the parent's real PID snapshot as
  input; no isolation rule was relaxed.
- Existing mutation suite: all 8 mutants killed on host and Linux.
  `/private/tmp/properties-716-mutation.log`, `properties-716-linux-mutation.log`.
- Existing public CLI/adapter suite: 10 passed through the actual Workbench container.
  `/private/tmp/properties-716-cli-public.log`.
- Catalog: 116 valid. `/private/tmp/properties-716-catalog.log`.
- Host boundary suite intentionally skips 7 Linux-only cases; the integer contract
  runs on host. Linux, not a macOS fallback, is the runtime evidence.

Only project `properties-716-20260906` at `127.0.0.1:18145` was started for this
validation. No shared port, AWS deployment, release, or original checkout was used.
The operator controls local Docker and is outside the confidentiality claim. No
physical-browser layout check, live AWS, or third-party runtime acceptance is claimed. The real Portal component submission test below is separate evidence.

The final two older matrix mutants now alter the actual current alias's properties,
so they fail for misclassification instead of merely raising an unrelated unknown-name
KeyError. All eight still fail for their intended property or input contract.

Cleanup completed: both dedicated containers and both networks were removed.
`/private/tmp/properties-716-cleanup.log` records removal; the project-filtered
`properties-716-remaining-containers.log` is empty. Build images/caches remain.

## Actual Portal editor submission contract

Final review inspected parent Portal commit 2994bbfcd64197b75b48652381a42f00f20be04a and rendered its real ContainerWorkbenchPanel and MultiFlagSubmissionPanel in Vitest/jsdom. Only the platform transport was adapted to this dedicated local API; prepare and verifier responses were real. The original metadata/config declared four answer inputs although the documented route derives all five values from the source editors. Clicking those four empty answer forms did not call prepare. The controls looked available, making the missing submission especially unclear.

All five catalog inputs now declare the existing multiline/editor contract, and the Workbench config declares code for the same five fields. No parent product implementation or scoring format changed. With both independent reader files above unchanged, clicking each next unsolved Submit control called real /api/prepare then /verify, produced five correct verdicts, and folded each solved row. The two component cases passed in 2.90 seconds. Harness: /private/tmp/properties-716-portal-harness.test.tsx; log: /private/tmp/properties-716-real-portal-component.log. The temporary harness was removed from the parent checkout after verification. This exercises component interaction and the local runtime, not a full authenticated browser or physical device layout.

The root reran all 29 HTTP checks after this input-contract fix: /private/tmp/properties-716-http-root-final.log. Initial harness corrections were limited to reproducing clicks rather than asserting a disabled attribute, restoring the same synthetic fixture as the independent reading, and choosing the next unsolved button after solved rows collapsed. Reader source hashes and mathematical answers did not change.

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

- `properties-linux.log`:11 tests PASS, including the new disposable-parent
  scheduler test, System V/mqueue operations and POSIX shm/sem creation across
  64 iterations each with no residual objects, plus all existing grading checks.
- `properties-mutations.log`:8 existing mutations killed.
- This older filter also lacked IPC denials, so both persistent IPC and the six
  scheduler/I/O-priority writers are covered in this problem.

Logs are under `/private/tmp/constraint-ipc-716-evidence/`. The shared catalog gate
`make install && make agent-gate` validates116 metadata files separately. Each
problem’s existing `make reference-test` runs its own mutation and Linux suites;
recorded runs used equivalent commands with dedicated image names.

## Filesystem metadata backport, 2026-09-07

At base 6416dab5af5805211b020f03c218a8827d66a201, this problem's own unchanged `restrict_learner` allowed mkdir, symlink, hardlink and FIFO creation. All four entries remained in a parent-owned TemporaryDirectory after the filtered child exited. `filesystem-before.json` records the policy hash and actual results; the fixture was then removed. The original log is `/private/tmp/filesystem-716-before.log`. No live Workbench, participant environment, external network or host folder was targeted.

The fix copies the proven native metadata-operation deny rules from linear 2444001 into this problem only. It does not share a runtime, change the loader or add an endpoint. The new `FilesystemMetadataBoundary` test in `test_execution_boundary.py` loads this consumer's actual filter in 16 disposable Linux children, requires EPERM for all 19 operations, and checks the parent's fixture content, directory listing, mode, uid/gid, mtime and extended attributes after each child exits. The TemporaryDirectory is also removed. This is an actual-filter regression, not a new participant playthrough or an attestation of all filesystem/kernel behavior.

Validation uses a dedicated `ac26-filesystem-716-bridge-properties-author` image with `docker run --rm --init --network none`, read-only root, private /tmp, dropped capabilities and no-new-privileges. The unchanged reference/mutation and complete existing runtime/public-check suite are run, together with the new regression. Logs are `/private/tmp/filesystem-716-bridge-properties.log`. No Compose project or listening service is started.

Reproduce from this problem's directory (the commands of `reference-test`, with explicit network and container isolation):

```sh
docker build --target author -t ac26-filesystem-716-bridge-properties-author local
docker run --rm --init --network none --read-only --tmpfs /tmp:rw,noexec,nosuid,size=67108864 --cap-drop ALL --security-opt no-new-privileges:true --memory 1g --pids-limit 128 -e FLAG_SEED=filesystem-reader-716 ac26-filesystem-716-bridge-properties-author python mutation.py
docker run --rm --init --network none --read-only --tmpfs /tmp:rw,noexec,nosuid,size=67108864 --cap-drop ALL --security-opt no-new-privileges:true --memory 1g --pids-limit 128 -e FLAG_SEED=filesystem-reader-716 ac26-filesystem-716-bridge-properties-author python -m unittest discover -s tests/hidden -p test_execution_boundary.py -v
```

`make agent-gate` at the catalog root checks all 116 entries. This follow-up adds no new HTTP/UI flow; the existing suite exercises the unchanged positive/public-check paths with synthetic data. The prior live/API evidence above remains historical rather than being claimed as a new playthrough.

Final result: 8 existing mutations killed; 12 complete runtime tests pass in 44.359s, including the new filesystem case. Existing reference and public positive checks pass without changing their sources.
