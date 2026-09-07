# Beaver #716: reading, correction and acceptance evidence

## Final root verification

The final label/20-second-deadline image passed the retained component/API harness:
all five checkpoints, one test (1.74 seconds; complete run 5.76 seconds). The parent
checkout was clean after the launcher removed its test.

The root `make reference-test FLAG_SEED=beaver-reader-716` rerun initially exposed a
test-timing error: its 300ms hang deadline expired while a busy Docker host was still
starting Python, before the hang began. The regression now starts the worker first,
then gives the actual non-returning call the same 300ms deadline. The three-second
assertion and complete descendant removal remain. Product timeouts were not changed.
The final repository Makefile run passes all eight mutations and sixteen Linux tests
(17.040 seconds for the Linux suite). The IPC filter includes POSIX queues as well
as SysV IPC, and the 116-entry catalog gate passes.
Logs: `/private/tmp/beaver-716-root-final-reference-2.log`,
`beaver-716-real-portal-component-final.log`, `beaver-716-root-final-catalog.log`.


Recorded 2026-09-07. Base: `1923ddc54b20d1496b0bd959291fcfd51e0e8719`,
branch `codex/beaver-hints-716`. Only `ac26-w2-beaver-mul` is changed.

## Reading boundary

The initial reader was asked to read JA/EN instructions, ID-linked hints, READMEs
and starter. The first `cat metadata.json` also displayed `writeup`. The reader
code was written after that output and before a later instruction to stop code
creation arrived. **This is not a writeup-blind reader or a fully blind acceptance
answer.** It must not be combined with other problems' independent first-reading
records. The original `first-reading.md` is preserved unchanged beside this file.
During that phase, no fixture, hidden checker, verifier, reference or runtime source
was read. The implementation phase read those files only after authorization.

The same original source is in `portal/reader-beaver.py`:
SHA256 `c534d93bccdba05e443926d69c363585de095b1c3c8726b552cb47a524b48e19`.
It was not edited to fit the grader. The original workspace artifacts are in
`/private/tmp/beaver-716-reader/`: `public-{ja,en}.md`, `reader-beaver.py`,
`first-reading.md`, `sources.json`, `public-calculations.log`. Revised participant
packets are `revised-{ja,en}.md`, `revised-beaver.py`, `revised-inspect.json`.
Packets select participant fields only, and associate each hint by ID.

## Sources and the mathematical boundary

`source-readings.json` records revisions and SHA256 hashes. Read both the official
Week 2 lecture/toy-mpc Part A and the owner's Week 2 notes (slides25–28, the
model/protocol distinction, and the Beaver mutation audit). The official pin is
`a3aa4b56fa88fbe803b57d320fbc87c1a203b480`; the note is
`58344a29ea39c25839475ba9a594c115ed89989b`.

The lecture/assignment covers a full toy-MPC function, two masked openings, one-use
triples and canonical field elements. This independent exercise practises the
arithmetic through four functions. It gathers all shares centrally and cannot
claim party-local secrecy, secure preprocessing or resistance to malicious parties.
The final wording states that distinction rather than claiming identical assurance.

## First-reading findings and corrections

The ten original findings are retained in `first-reading.md`. Corrections include:

- c/d/e alone do not determine the product: the cross terms also need a/b shares.
  For p=7,c=5,d=3,e=4, a=2/b=6 gives product1 while a=6/b=2 gives product5.
- A noncanonical opening is an output-contract violation. With p=7, d/e=10/11
  and d/e=3/4 still give the same modular product when combine reduces it.
- An unknown mask alone is insufficient. With p=7, a restricted to0/1 and d=3
  narrows x to3/4. A uniform independent one-use mask gives a one-to-one
  `x ↔ a=(x-d)%p` correspondence with equal probability, conditional on the
  observer not reconstructing the mask.
- Full share lists on Inspect are a teaching view; their values can be reconstructed.
  Receiving one other share does not universally expose a secret with more parties.
- Matching shapes alone do not establish protocol correctness; `rounds()` also
  matters. The revised minimum-round contract is exactly1, and round2 now fails.
- The old large example had d=e and could hide a swapped cross term. The new p=7
  table has d=3/e=4 and shows the full input, masking and output rows.
- Generic parameter use matters, but absence of hard-coded constants is not proof.
  The statement supplies a second p=5 mask example and a triple-reuse transfer question.
- Start/Inspect/editor/submit are named directly. All5 checkpoints are code inputs.
  Repeat Inspect is stable for the same seed; no every-launch-change claim remains.
  Stale Week2-unpublished and placeholder text was removed in both languages.

Root reread the revised JA/EN packet and independently calculated the table:
`d=[2,2,6]→3`, `e=[6,2,3]→4`, base `[0,5,5]`, one public contribution
`[5,5,5]→1`, repeated contribution `[5,3,3]→4`. General expansion and the
MPC/arithmetic distinction were checked against the concrete rows.

## Demonstrated runtime defects and fixes

Before runtime edits, the dedicated HTTP service accepted the unchanged reader at
all5 checkpoints. That baseline is `/private/tmp/beaver-716-baseline-api.log`.
The same run demonstrated:

- `print('{"failures":[]}'); os._exit(0)` was graded correct for `combine`.
- A public submission containing only `os._exit(0)` reported `passed:true`.
- A public child observed `FLAG_SEED` in its environment (presence boolean only;
  no environment value was emitted).

Now both checkers run in their trusted parent and judge untrusted returned values.
A learner process contains no hidden checker or seed. The existing Workbench
parent-owned SEED/tcw1 contract remains; no key-retrieval endpoint was added.
Fresh128-bit call IDs are sent after initialization ready and per invocation. They
reject stale/preprinted replies, not attest Python execution. Tuple/list and
bool/int coercion is rejected before JSON serialization. The parent still validates
shape, range and the arithmetic, accepting other mathematically correct allocations
of the public constant.

Linux restrictions deny files (including `/proc/*/environ`), network, exec, parent
signals/resource-limit changes and all System V shm/msg/sem entry points. Limits
and process-group cleanup bound a run; Compose and author invocations use Tini to
reap descendants. This is not a host/Docker-administrator confidentiality claim.

## Validation results

- `/private/tmp/beaver-716-linux-tests.log`: **16 Linux tests PASS**. Includes
  reference across two seeds/all5 checkpoints, alternate last-party and distributed
  constants, in-place results, zero openings, n=1, fake stdout/exit, preprinted ready
  and predictable ID, tuple/bool/float/round2, output limits and partial timeout,
  source-location-only diagnostics, hidden-log suppression and existing tcw1 binding.
- The same suite probes all visible process environ paths without emitting values;
  file/network/exec/parent-FD access is denied. Twelve System V operations return
  EPERM over16 iterations, with `/proc/sysvipc/{shm,msg,sem}` exactly unchanged.
  Sixty-four submissions fork4 descendants each; no live or zombie PID remains
  after any submission.
- `/private/tmp/beaver-716-mutations.log`: **8 mutations killed**, including round2,
  repeated/missing public constant, swapped cross terms, reversed mask, unreduced
  open, round0 and the original verifier-level wrong-combine probe.
- `/private/tmp/beaver-716-public-contract.log`: **12,492 pure arithmetic cases**,
  p∈{2,3,5,7}, n∈{1,2,3,5}, all x/y/a/b values, including zero d/e; these are host
  arithmetic checks, not Linux-isolation evidence. All existing scoring IDs, points,
  input kinds and15 hint IDs/penalties are unchanged.
- `/private/tmp/beaver-716-final-api.log`: original reader and last-party alternative
  each pass `/api/test` and all5 `/api/prepare`→`/verify` paths. Seven incorrect
  submissions fail public/private checks, cross-checkpoint tcw1 seals fail5/5,
  both real service children have no seed/readable process environment (boolean
  result only), syntax diagnostics name only submitted location, arbitrary proxy
  paths return404, and a subsequent valid transfer succeeds.
- `/private/tmp/beaver-716-real-portal-component.log`: **1 test PASS** (5.51s total,
  1.58s test). Real `ContainerWorkbenchPanel` and `MultiFlagSubmissionPanel` use the
  live HTTP API, preserve the original source across5 submissions and fold solved
  rows until all5 are correct. This is a real-component/API test, **not a browser
  screenshot**; authentication and the outer scoring transport are mocked.
- `/private/tmp/beaver-716-catalog.log`: `make install && make agent-gate`, **116
  metadata files valid**. Catalog validation is separate from runtime acceptance.

## Reproduce

From this problem directory, `make reference-test` builds the author image and runs
mutation and Linux tests. It does not run the catalog gate or the real Portal test.
The recorded runs used the equivalent commands with a dedicated image name,
`ac26-beaver-reader-716-author`, `docker run --rm --init --network none`, and only
synthetic `FLAG_SEED=beaver-reader-716`.

For the API/component test, use the checked-in Compose configuration from this
problem directory. The default loopback port is 18097; the original recorded run
used a dedicated copy on 18150 to avoid other local problems.

```sh
FLAG_SEED=beaver-reader-716 docker compose \
  -f local/docker-compose.yml -p ac26-beaver-reader up -d --build --wait
AC26_WORKBENCH_URL=http://127.0.0.1:18097 \
  ./local/tests/hidden/portal/run.sh /absolute/path/to/TenkaCloud
FLAG_SEED=beaver-reader-716 docker compose \
  -f local/docker-compose.yml -p ac26-beaver-reader down
```

The external TenkaCloud checkout must have its participant-portal dependencies
installed. The launcher creates an exclusive temporary test file there and removes
it on exit. It does not change product code. The tested parent is
`6bce08335caba4b61f28082e01764e46b8549d18`. The synthetic seed and URL must match the
service. The final participant labels match metadata in both languages, and the
private execution deadline remains the existing 20 seconds. The local IPC filter
also denies POSIX message queue operations.


## Final supervisor scheduling regression

The same-UID learner can no longer change scheduler policy, scheduling parameters,
CPU affinity, nice priority or I/O priority. The local policy now denies
`sched_setscheduler`, `sched_setparam`, `sched_setattr`, `sched_setaffinity`,
`setpriority` and `ioprio_set`. The Linux worker regression checks EPERM for the
libc scheduling/affinity/nice calls and verifies the parent state stays unchanged.
No production deadline or mathematical acceptance condition changed.

The final Linux suite passed 17 tests in 32.103 seconds. After rebuilding
both dedicated services, the retained Portal harness passed all five submissions
and solved-row transitions (one test, 6.98 seconds including setup). This is
actual component-to-local-API evidence, not a physical browser or AWS deployment.

## Filesystem metadata backport, 2026-09-07

At base 6416dab5af5805211b020f03c218a8827d66a201, this problem's own unchanged `restrict_learner` allowed mkdir, symlink, hardlink and FIFO creation. All four entries remained in a parent-owned TemporaryDirectory after the filtered child exited. `filesystem-before.json` records the policy hash and actual results; the fixture was then removed. The original log is `/private/tmp/filesystem-716-before.log`. No live Workbench, participant environment, external network or host folder was targeted.

The fix copies the proven native metadata-operation deny rules from linear 2444001 into this problem only. It does not share a runtime, change the loader or add an endpoint. The new `FilesystemMetadataBoundary` test in `test_execution_boundary.py` loads this consumer's actual filter in 16 disposable Linux children, requires EPERM for all 19 operations, and checks the parent's fixture content, directory listing, mode, uid/gid, mtime and extended attributes after each child exits. The TemporaryDirectory is also removed. This is an actual-filter regression, not a new participant playthrough or an attestation of all filesystem/kernel behavior.

Validation uses a dedicated `ac26-filesystem-716-w2-beaver-mul-author` image with `docker run --rm --init --network none`, read-only root, private /tmp, dropped capabilities and no-new-privileges. The unchanged reference/mutation and complete existing runtime/public-check suite are run, together with the new regression. Logs are `/private/tmp/filesystem-716-w2-beaver-mul.log`. No Compose project or listening service is started.

Reproduce from this problem's directory (the commands of `reference-test`, with explicit network and container isolation):

```sh
docker build --target author -t ac26-filesystem-716-w2-beaver-mul-author local
docker run --rm --init --network none --read-only --tmpfs /tmp:rw,noexec,nosuid,size=67108864 --cap-drop ALL --security-opt no-new-privileges:true --memory 1g --pids-limit 128 -e FLAG_SEED=filesystem-reader-716 ac26-filesystem-716-w2-beaver-mul-author python mutation.py
docker run --rm --init --network none --read-only --tmpfs /tmp:rw,noexec,nosuid,size=67108864 --cap-drop ALL --security-opt no-new-privileges:true --memory 1g --pids-limit 128 -e FLAG_SEED=filesystem-reader-716 ac26-filesystem-716-w2-beaver-mul-author python -m unittest discover -s tests/hidden -p test_execution_boundary.py -v
```

`make agent-gate` at the catalog root checks all 116 entries. This follow-up adds no new HTTP/UI flow; the existing suite exercises the unchanged positive/public-check paths with synthetic data. The prior live/API evidence above remains historical rather than being claimed as a new playthrough.

Final result: 8 existing mutations killed; 18 complete runtime tests pass in 56.851s, including the new filesystem case. Existing reference and public positive checks pass without changing their sources.
The first added-test attempt lacked its json import (the existing suite passed); that harness error was fixed and the full suite rerun. The original log is retained as `/private/tmp/filesystem-716-w2-beaver-mul-initial.log`.

### Computational allowance follow-up (2026-09-07)

A local author test imports the 14 documented computational standard libraries
inside the actual isolated worker, then separately runs six seconds of real CPU
work. The pre-fix filesystem-baseline image rejected the added imports. It also killed the six-second computation at the old five-second CPU limit.
The updated worker preloads these helpers before applying the same filesystem,
network and IPC restrictions. README and starter text list the supported imports.
The CPU budget now covers the existing 20-second grading deadline. The participant
server waits up to 25 seconds for that verdict but still limits incoming bodies to
15 seconds. Real loopback HTTP tests use scaled delays to prove those two budgets
are independent and that expired/mismatched responses still fail closed. They do
not claim a full 20-second end-to-end browser run.

Run `make reference-test computation-test` for the existing reference/mutation
suites and new local regressions. These are author tests, not an independent
participant read-through or a live AWS rehearsal.

Final verification passed: `make reference-test computation-test`, including the
existing Linux boundary tests, reference answers and mutation checks. The new
computation tests pass after the same tests rejected unavailable imports in the
pre-fix image. All 116 catalog entries validate.

### Review follow-up: standard author command (2026-09-07)

`make reference-test` now runs `test_computation_allowance.py` as well as the
existing boundary and mutation suites. The standalone `computation-test` remains
available for focused reruns. The standard command passed for all three affected
Week 2 problems (65 Linux tests total and 43 existing mutants rejected).

The actual `/api/test` HTTP route previously accepted a correct submission with
a 16-second startup delay, contradicting the documented 15-second public deadline.
The new regression failed before the fix. Workbench public tests now receive their
own 15-second deadline while private grading retains 20 seconds. After the fix,
the same HTTP submission is rejected publicly and accepted by private grading.
Logs: `/private/tmp/week2-public-deadline-before.log` and
`/private/tmp/week2-beaver-review-after.log`. This exercises local Linux and HTTP,
not an AWS deployment or a new independent reader.
