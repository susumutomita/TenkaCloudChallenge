# #716: one secret-sharing problem, reading and runtime evidence

## Final Python types and retained Portal acceptance

The outer Python list contract is enforced before JSON serialization for `share`,
`rerandomize` and `share_line`; tuple results cannot silently become lists. The
three scalar reconstruction/completion functions reject booleans as integers. Point
pairs inside a `share_line` list may still be lists or tuples, preserving the existing
valid interface. Public and private tuple regressions cover all three list functions.
The IPC denylist also includes POSIX message queues. Two isolation-only test functions
were renamed from `share` to `probe` because their diagnostic dict/PID results are not
share lists; their assertions and actual process restrictions remain unchanged.

Final `make reference-test` passes all 27 mutations, the alternative valid two-of-three
construction, and 17 Linux tests (23.242 seconds). Catalog validation passes 116 entries.

The unchanged original reader and hand JSON passed all five fields through the
retained real Portal component/API harness after these changes: one test, 3.31 seconds
for submissions and 6.60 seconds total. The launcher removed its temporary parent test,
and the parent checkout remained clean.

The reproducible harness, original reader and manual JSON are checked in under
`local/tests/hidden/portal/`. They are author-only evidence, absent from the participant
image. With Docker, Bun and the TenkaCloud checkout dependencies installed, run from
this problem directory (the seed matches the retained manual calculation):

```sh
FLAG_SEED=secret-sharing-reader-716 docker compose -p ac26-sharing-reader \
  -f local/docker-compose.yml up -d --build --wait
AC26_WORKBENCH_URL=http://127.0.0.1:18095 \
  ./local/tests/hidden/portal/run.sh /absolute/path/to/TenkaCloud
FLAG_SEED=secret-sharing-reader-716 docker compose -p ac26-sharing-reader \
  -f local/docker-compose.yml down
```

The test renders the real `ContainerWorkbenchPanel` and contacts actual config,
prepare and verify endpoints; only outer transport/auth/score responses are mocked.
It checks four code rows, one sealed manual answer, unchanged source and solved-row
folding. The tested parent commit is `6bce08335caba4b61f28082e01764e46b8549d18`.
This is component/API evidence, not physical-browser or AWS acceptance.


Date: 2026-09-07. Baseline: `1923ddc54b20d1496b0bd959291fcfd51e0e8719`.
This is one problem's working increment. It does not complete the remaining #716 catalog.
No AWS service or shared event was changed. These are agent-role reading and local
runtime checks, not a timed study with a human beginner.

## PR #763 follow-up: call batches, zero draws, and IPC

Based on `2439701`, the review's six before cases were reproduced through the actual
API on the dedicated localhost deployment. A source renamed all six required functions,
read `payload.calls` from the worker's initialization frame, computed the correct
answers with its renamed helpers, printed the old `results` envelope and exited. All
four code checkpoints accepted it. A rerandomizer that rejected only all-zero draws
and a reconstructor that returned 0 whenever the two y values were equal also passed
their individual checkpoints. These are recorded in
`/private/tmp/secret-sharing-763-before.log`.

The problem-local worker now receives only source at initialization. After a ready
acknowledgement, the trusted parent generates a fresh 128-bit batch identifier and
sends that identifier with the existing calls batch. Only a matching result envelope
can supply values to the unchanged trusted value adapter. A bounded incremental reader
caps bytes before decoding; the existing 16 MiB result limit and one total deadline
remain. Keeping a single batch preserves the approximately 100,000 independent
line-privacy calls within the existing 12-second limit, instead of introducing that
many synchronous protocol round trips. The `run_functions` return shape, score,
checkpoint IDs, labels, parent mathematical checks and `tcw1` preparation are unchanged.

This rejects initialization-time access to future calls, queued old envelopes, fixed
identifiers and incomplete replies. It does **not** attest that a particular Python
function executed a return statement. Arbitrary learner Python may read later inputs
and compute the same correct values through another implementation; the parent's
mathematical checks remain authoritative. The before startup program still computed
correct mathematics—it was not bypassing those checks by printing a verdict.

The real grader now includes legal zero cases:

- Rerandomization runs both the existing nonzero adjustments and an all-zero draw.
  The secret must stay the same in both cases. Nonzero adjustments must change a
  share; zero adjustments must leave the supplied shares unchanged.
- Pair reconstruction runs each case at its existing slope and at zero, checking
  all three pairs in both orders. Equal y values on a flat reference line must recover
  that line's secret. The existing alternative valid two-of-three construction still
  passes; no requirement to use the reference line was introduced.

The fixture helper documentation now distinguishes its nonzero baseline from the
full random-input domain. Before cases that rejected zeros or mishandled a flat line
are rejected after the change; the unchanged independent reader handles both cases.

The Linux filter also denies SysV shared memory, message queue and semaphore creation
and operations (`shm*`, `msg*`, `sem*`, including the native `ipc` multiplexor where
available). These kernel objects can otherwise survive the learner process and consume
resources or pass information between executions. This is problem-local isolation;
no cloud policy or shared runtime changed.

Validation (synthetic `secret-sharing-reader-716` only):

- `make reference-test`: all 27 existing mutants rejected, one alternate valid sharing
  accepted, and all 16 Linux boundary tests passed. New checks exercise initialization
  input visibility, fresh batch IDs, fixed/wrong IDs, partial replies, bounded writes
  and reads, real zero-case grading, and all 12 SysV operations returning EPERM in 64
  repetitions with unchanged `/proc/sysvipc` object tables. Existing source diagnostic,
  time-limit, private-data and complete descendant-reaping checks remain passing.
- Actual API: all four unchanged startup spoof submissions now fail; the exact two
  zero-only mutants now fail. The unchanged reader source SHA
  `657dcad1c86fe04c42b857c8108614a3f339a496ab5eb32f0f318689ffc5a3ca`
  and hand-produced threshold JSON still pass all five checkpoints through the existing
  prepare/sealed-submit route. Public checks and location-only diagnostics still pass.
  Two-of-three took 3.426 seconds in the full acceptance run, below the existing limit.
- Actual public and private API requests also ran 64 repetitions of each SysV object
  creation attempt. Each returned EPERM, the otherwise correct reader still passed,
  and both service IPC object tables were identical before and after.
- Python compilation, `git diff --check` and the 116-entry catalog gate passed.

Logs: `/private/tmp/secret-sharing-763-{before,after,reader-http,reference,catalog,build}.log`.
The repeated exact spoof and zero-only mutants are saved alongside those logs, and the
actual follow-up harness is `/private/tmp/secret-sharing-763-after.py`. Runtime project
`ac26-secret-sharing-reader-716` exposes only the Workbench on localhost 18148. These are
local implementation checks, not a new independent reading, browser playtest or AWS run.

## Public-only first reading

Before grading/runtime/reference code was read, an independent reader read the Japanese
and English instructions, all 15 hints in both languages, and the six starter functions.
The first pass found eight concrete gaps:

1. “At least two nonzero shares” is not a secrecy criterion. Uniform draws include zero;
   a valid random output can look like `[s,0,0]`. The defective rule is ignoring randomness
   and always copying the secret, not that one output.
2. A completion for every candidate proves compatibility, not unchanged probabilities.
   State independent uniform full-range randomness, fresh draws, the observer's view,
   and the absence of the missing holder's information. Biased randomness can preserve
   compatibility while changing likelihoods.
3. An analogy said that two of three numbers “summing to 10” leave the total unknown,
   although it had just supplied the total.
4. The starter withheld the necessary completion formula and opened with undefined
   `F_p`; most examples used larger numbers rather than one-digit arithmetic.
5. First hints led with testing/strategy. Refresh inputs conditioned to change the list
   were presented as though independent random draws always differ.
6. Shamir at positions 1,2,3 requires prime `p>3`; at p=3, position 3 is the secret's
   position zero.
7. Sharing is a component of MPC, not itself a complete secure computation, wallet, or
   signature protocol. Broad product claims did not follow from these six functions.
8. The first useful Start/Inspect action appeared after several long concept sections.

The sources were the actual seminar's `week2/problems/toy-mpc/README.md` (additive
sharing, local addition, multiplication, and output disclosure are distinct operations)
and the owner's `week2/index.html`, slides 15–23 (additive and Shamir sharing).
The historical catalog alignment pin remains unchanged; reading current material does
not change what was available at that older pin.

## Reader implementation and revised packet

The reader wrote the six functions from the public formulas, without reading author
code. Their source stayed unchanged through the baseline and candidate executions:

`SHA256 657dcad1c86fe04c42b857c8108614a3f339a496ab5eb32f0f318689ffc5a3ca`

The deployment's public Inspect showed p=139, n=3, partial=[7,18]. By hand, the partial
sum is 25; candidate zero needs last share 114, and candidate one needs 115. The reader
used that same two-completion JSON through the actual prepare/manual route. All four
code checkpoints and the manual threshold passed on the baseline. An initial attempt
to send raw manual JSON directly to `/verify` failed because it skipped the existing
prepare envelope. That was a harness routing mistake, not a problem defect.

The rewritten participant-only packet was sent to the reader **before** the author
runtime tests began. It contained only JA/EN statements, all 30 hint texts, and the
unfinished starter. The second pass requested three compact tables (distribution,
zero-total refresh, and Shamir x=0 versus holders 1,2,3), a count of why probabilities
match (1/49 for two observed shares at p=7; 1/7 for one Shamir point), plain wording for
probabilities before observation, and “arbitrary secret without other information.”
Those were added. The final packet was read again with no further mathematical or
procedural gap identified. No ordinary straight line was drawn through wrapped residues.

The starter executable statements were compared as ASTs with docstrings removed and
remain unchanged. Required formulas are free in the statement/starter. Checkpoint IDs,
points, wrong-answer penalties, hint IDs and penalties remain unchanged: 200 total
points, 99 total hint penalties. Labels now use plain “missing piece,” “two completions,”
and “refresh shares,” with Japanese and English metadata/server values synchronized.

The random-prefix rule is an existing interface contract, not a new arbitrary grader
restriction: baseline `local/starter/sharing.py:85–97` explicitly says to use the first
n−1 supplied random values and adjust the last share. The old zero-count rejection was
replaced with that contract, including all-zero draws. The line checkpoint still accepts
a correct alternative construction, rather than requiring the reference line.

## Confirmed execution defects and fixes

Only boolean outcomes were recorded when reproducing the boundaries; no hidden values
were returned or logged.

- In the original actual `/api/prepare` → `/verify` route, source defining no functions
  but printing `{"failures": []}` and exiting earned all four code checkpoints. After
  the fix, the identical source is rejected for all four and fails public tests.
- The original threshold route converted fractions, strings, booleans, negative values,
  and values at/above p with `int(v) % p`. It also accepted a fractional JSON count such
  as `3.0`. Before/after API regressions use a canonical public example and 25 malformed
  variants. The final boundary requires actual JSON integers and canonical ranges; all
  25 negatives are rejected without a direct-answer failure message.

Submitted code now executes only in a restricted Linux worker, which receives source
and necessary function arguments, never a seed/checker/expected verdict. Trusted code
validates returned JSON values. A different worker reconstructs from shares alone.
Both supervisors protect their process state, and both services use non-root users and
`init: true`. Cleanup tests require descendant PIDs to disappear entirely; zombies are
not accepted as cleanup. Public syntax/initialization feedback is bounded to filename,
line, and an allowlisted exception type. Hidden execution failures remain generic.

## Executed acceptance

Dedicated Compose project: `ac26-secret-sharing-reader-716`, loopback port 18148,
synthetic seed `secret-sharing-reader-716`. The conventional public port was not used.

- Unchanged reader code: actual prepare → verify for all 5 checkpoints PASS; public
  checks PASS. On the final pre-label run, the slowest checkpoint took 2.325 seconds
  while a Docker build ran concurrently, within the unchanged 12-second grading limit.
- Actual public API error feedback: malformed function syntax reports
  `sharing.py:1: SyntaxError`; a module initialization exception reports
  `sharing.py:2: RuntimeError`, without the exception message.
- The parent Portal's real `ContainerWorkbenchPanel` was exercised in its Vitest DOM
  harness against the dedicated HTTP runtime. Five checkpoint submissions passed
  (test execution 3.22 seconds). This is real component/HTTP evidence, not a physical
  Mac/browser screenshot or a human solve-time measurement.
  The root repeated this component route after the final bilingual labels and
  strict threshold validation: all five submissions passed again in 3.02 seconds.
  The unchanged hand JSON passed through the existing preparation envelope.
  Final log: `/private/tmp/secret-sharing-716-real-portal-component-final.log`;
  harness: `/private/tmp/secret-sharing-716-portal-harness.test.tsx`. Its temporary
  parent test file was removed afterwards, leaving that checkout clean.
- `make reference-test IMAGE=ac26-secret-sharing-716-validation`: 27 mutants rejected,
  reference and one different valid two-of-three construction accepted, then 11 Linux
  execution-boundary tests. The tests cover clean environment, private/proc reads,
  network/exec denial, same-UID supervisor control, stored-secret shortcuts, stdout
  verdict forgery, public error bounds, zero draws, strict threshold types/ranges, and
  complete descendant reaping after success and timeout.
- `make install && make agent-gate`: all 116 metadata entries valid.
- `git diff --check` and Python compilation passed.

The documented `make test` was attempted with only the dedicated Compose project and
image name overridden. This machine's Docker daemon did not see the Mac `/private/tmp`
bind source, so that invocation stopped at a missing `/problem/starter/sharing.py`.
This is recorded as an environment-specific CLI limitation. Running the same CLI on
the shipped in-image starter correctly failed the unfinished `reconstruct` function;
the reader's completed source passed the actual public API checks. No mount, test or
checker was weakened to turn the missing bind source into a success.

Evidence produced during the run (local temporary artifacts, not participant inputs):
`/private/tmp/secret-sharing-716-reader/{first-reading.md,revised-reading.md,final-http.json,
stdout-boundary-before.json,threshold-api-before.json,threshold-api-after.json}`,
`/private/tmp/secret-sharing-716-reference.log`,
`/private/tmp/secret-sharing-716-catalog.log`,
`/private/tmp/secret-sharing-716-real-portal-component.log`.

No live AWS, physical-device or independent human rehearsal was performed.


## Final supervisor scheduling regression

The same-UID learner can no longer change scheduler policy, scheduling parameters,
CPU affinity, nice priority or I/O priority. The local policy now denies
`sched_setscheduler`, `sched_setparam`, `sched_setattr`, `sched_setaffinity`,
`setpriority` and `ioprio_set`. The Linux worker regression checks EPERM for the
libc scheduling/affinity/nice calls and verifies the parent state stays unchanged.
No production deadline or mathematical acceptance condition changed.

The final Linux suite passed 18 tests in 23.594 seconds. After rebuilding
both dedicated services, the retained Portal harness passed all five submissions
and solved-row transitions (one test, 11.93 seconds including setup). This is
actual component-to-local-API evidence, not a physical browser or AWS deployment.

## Filesystem metadata backport, 2026-09-07

At base 6416dab5af5805211b020f03c218a8827d66a201, this problem's own unchanged `restrict_learner` allowed mkdir, symlink, hardlink and FIFO creation. All four entries remained in a parent-owned TemporaryDirectory after the filtered child exited. `filesystem-before.json` records the policy hash and actual results; the fixture was then removed. The original log is `/private/tmp/filesystem-716-before.log`. No live Workbench, participant environment, external network or host folder was targeted.

The fix copies the proven native metadata-operation deny rules from linear 2444001 into this problem only. It does not share a runtime, change the loader or add an endpoint. The new `FilesystemMetadataBoundary` test in `test_execution_boundary.py` loads this consumer's actual filter in 16 disposable Linux children, requires EPERM for all 19 operations, and checks the parent's fixture content, directory listing, mode, uid/gid, mtime and extended attributes after each child exits. The TemporaryDirectory is also removed. This is an actual-filter regression, not a new participant playthrough or an attestation of all filesystem/kernel behavior.

Validation uses a dedicated `ac26-filesystem-716-w2-secret-sharing-author` image with `docker run --rm --init --network none`, read-only root, private /tmp, dropped capabilities and no-new-privileges. The unchanged reference/mutation and complete existing runtime/public-check suite are run, together with the new regression. Logs are `/private/tmp/filesystem-716-w2-secret-sharing.log`. No Compose project or listening service is started.

Reproduce from this problem's directory (the commands of `reference-test`, with explicit network and container isolation):

```sh
docker build --target author -t ac26-filesystem-716-w2-secret-sharing-author local
docker run --rm --init --network none --read-only --tmpfs /tmp:rw,noexec,nosuid,size=67108864 --cap-drop ALL --security-opt no-new-privileges:true --memory 1g --pids-limit 128 -e FLAG_SEED=filesystem-reader-716 ac26-filesystem-716-w2-secret-sharing-author python mutation.py
docker run --rm --init --network none --read-only --tmpfs /tmp:rw,noexec,nosuid,size=67108864 --cap-drop ALL --security-opt no-new-privileges:true --memory 1g --pids-limit 128 -e FLAG_SEED=filesystem-reader-716 ac26-filesystem-716-w2-secret-sharing-author python -m unittest discover -s tests/hidden -p test_execution_boundary.py -v
```

`make agent-gate` at the catalog root checks all 116 entries. This follow-up adds no new HTTP/UI flow; the existing suite exercises the unchanged positive/public-check paths with synthetic data. The prior live/API evidence above remains historical rather than being claimed as a new playthrough.

Final result: 27 existing mutations killed; 19 complete runtime tests pass in 50.296s, including the new filesystem case. Existing reference and public positive checks pass without changing their sources.
The existing honest alternative construction also remains accepted.
