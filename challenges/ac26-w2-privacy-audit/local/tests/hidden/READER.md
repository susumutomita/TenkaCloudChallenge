# Privacy audit #716 — reading and execution evidence

This is author-only evidence, not a participant explanation or a source of hidden answers for the editor. Work began from merged base `1923ddc54b20d1496b0bd959291fcfd51e0e8719` on `codex/privacy-audit-hints-716` in an independent clone. No other unmerged lesson branch was included.

## Independent first reading, before internals

The first reader assumed only junior-high mathematics and beginner Python. Only these public fields were extracted from metadata: `instructions`, `shortDescription`, checkpoint id/label/hints, and their English equivalents (`i18n.en.checks` for English hints). The full metadata, including writeup, was not displayed. Both READMEs, starter and public tests were read; hidden/reference/fixtures/verifier contents were not read before the initial implementation and real baseline submission.

The original read-through is `/private/tmp/privacy-audit-716-reader/first-reading.md`, with whitelisted `original-ja.json` / `original-en.json` and `inputs.sha256` beside it. It records each of seven checkpoint purposes and first actions, twelve concrete gaps, and a hand calculation. Findings included:

- MPC/share were used without local definitions; masks lacked the independence/full-range assumptions.
- The free statement did not give the weighted-total/partial-sum relation needed for recovery. The only complete hint example used p=1009 rather than one-digit inputs.
- “Prime p implies an inverse” omitted the nonzero-weight condition.
- Deliberately revealing an agreed result was mixed with “reveals no new information.”
- Three hints repeated the same long loop instead of giving each checkpoint its own small example.
- “The verdict does not change” did not distinguish violation kind from the index that must change after movement.
- Three versus seven implementations, direct-answer instructions for an all-code problem, and stale “Week 2 unpublished” README text conflicted.

The reader independently implemented `reader-auditor.py` using the original public packet only. The immutable source is retained at `portal/reader-auditor.py`:

```text
SHA-256 acf9a5e91d20572d10a2c8af4cc2eef4121ca6d50984d7bbd4ce5954b4a91806
```

This file has not been edited to satisfy hidden tests. Before reading internals it passed the original two public tests and all seven actual `/api/prepare` → `/verify` code submissions. Baseline: `/private/tmp/privacy-audit-716-baseline-http.log` and `/private/tmp/privacy-audit-716-reader/baseline-results.json`. An initial harness used `answer` instead of the existing `submission` request field and got seven false responses; that harness mistake is separately logged in `privacy-audit-716-invalid-request-key.log` and is not counted as a product defect. There are no manual-answer checkpoints in this problem.

## Both teaching inputs

After reading the problem, the reader compared the official Week 2 `toy-mpc/README.md` and the owner's `advanced-cryptography-note/week2/index.html`. The official assignment checks correct Beaver multiplication plus its permitted masked openings. The owner's notes distinguish correctness, privacy beyond agreed output, share/opening, semi-honest assumptions, and an intentionally broken implementation whose product stays correct while it opens too much.

Local input sources:

- `/Users/susumu/product/advanced-cryptography-2026/week2/problems/toy-mpc/README.md`
- `/Users/susumu/product/advanced-cryptography-note/week2/index.html`, especially sections around source lines 498–591, 663–665, 946–1040 and 1480–1618.

Revised public packets were saved before implementation: `/private/tmp/privacy-audit-716-reader/revised-ja.md`, `revised-en.md`, `revised-auditor.py`, `revised-hints-ja.json`, `revised-hints-en.json`. The root reader independently checked the revised JA mathematics and action mapping before inspecting generated data: the x/r table for d=1 contains all seven candidates, and T=2, S=4, p=7, w=3 gives D=5, inverse=5, recovered input=4. This revised reading is distinct from the original first reading and from subsequent author-side inspection.

## Changes justified after reading internals

The final lesson connects **specification → observation → extra information → recovery → repair**. The statement contains all required rules and formulas without paid hints. Twenty-one hints are three rungs per checkpoint: mechanism, small example/formula, then actual editor/file/field actions. The public suite now checks eight published examples, including recovery at p=7, permitted versus forbidden logs/reads, repair and moved positions.

Actual generation was checked rather than inferred from the narrative:

- Seven program IDs all return the same correct total; four have prohibited observations. Tested over three synthetic settings and all-zero-mask settings.
- Each generated event has all six keys. Inspect deliberately prints a shorter display, omitting unused keys; the full values passed to functions retain the documented shape.
- Weights are nonzero. The generator previously excluded zero masks; its mask range is now 0..p−1. This deterministic seeded teaching generator is not claimed to implement an ideal independent uniform sampler. `spec.masked` supplies the model's certification of a suitable fresh mask; the auditor does not prove randomness quality.
- A `const` operation also prepares private masks locally. The old “public constant” description was therefore incorrect; public text now says it prepares a local constant, with opening a separate action.

The old grader imported learner code into a runner holding the checker and accepted stdout `{"failures":[]}` as a verdict. The exact no-function print-and-exit source passed all seven actual HTTP checkpoints before the fix. It now fails all seven. Further actual before/after cases:

| Source behavior | Before | After |
|---|---|---|
| Reverse the required sorted allowed list | accepted | rejected |
| Return correct violation kind but index=0 after moved events | accepted | rejected |
| Add an unused constant operation to a “remove-only” repair | accepted | rejected |
| Replace integer constants in repair with equal-valued floats | accepted | rejected |
| Ignore spec and detect names ending in `sub` / containing `x-` | accepted by mutation | rejected |

The last case exposed that renaming only prefixed original labels. The existing rename helper now maps every label to a deterministic opaque name while updating the specification consistently. It does not claim to authenticate an implementation's reasoning; the parent checks values on varied cases.

Before/after sources and logs remain in `/private/tmp/privacy-audit-716-reader/` and `/private/tmp/privacy-audit-716-{before,after}-regressions.log`, `privacy-audit-716-repair-type-{before,after}.log`, `privacy-audit-716-name-heuristic-{before,after}.log`.

## Grading and isolation boundary

The existing hidden checker executes in the trusted parent. Only the named checkpoint's required functions are requested, so an unfinished unrelated function does not prevent an independent checkpoint. The child receives submitted source alone, signals readiness, then receives inputs and a fresh 128-bit request ID for each call. Its return values are untrusted JSON; private properties and pass/fail remain in the parent. The worker does not receive FLAG_SEED, the checker, parent file descriptors or the parent environment.

Fresh IDs reject initialization-time preprints, old batch/grade payloads, fixed IDs and replayed IDs. They do **not** attest that a native Python `return` produced a value. Arbitrary submitted Python can observe its live call inputs/ID and implement the same correct computation another way; that remains a valid untrusted-value implementation. A new file descriptor alone would not change that limitation.

The published Python outer-list contract is checked before normal worker serialization. Repair operation tuples become JSON arrays; comparison preserves their values while distinguishing booleans/floats from integers. A valid repair returning inner lists is accepted. Parent checks also enforce integer index/input results, sorted names, moved-event indices, unchanged permitted operations and the existing output/leak conditions.

Both HTTP supervisors protect their process state. Children run as a non-root user with seccomp, clean environment, close_fds, bounded pipes, a 20-second suite deadline, 512 MiB address-space limit, CPU/output limits and process-group cleanup. Both Compose services use `init: true`. Denied operations include file/network/exec, parent memory/FD/signal/resource changes, persistent SysV/POSIX IPC and scheduler/priority mutations. Read-only scheduler queries remain available.

Public syntax/initialization feedback contains only a validated submitted filename, source line and exception-type identifier. Private failures stay generic or use checker-owned property messages; learner exception text and prints containing private call inputs are not forwarded into grading feedback.

## Verification results and boundaries

- `make reference-test`: all 8 pre-existing mutants killed; 16 real Linux execution/audit tests pass. Includes 64 successful submissions each forking four descendants (256 total), waiting for every extra PID to disappear, with no zombie treated as a successful cleanup. Also includes real EPERM/no-object-accumulation IPC checks and six scheduler mutation syscalls denied while parent scheduling state remains unchanged.
- Frozen public reader: all 7 HTTP checkpoints pass after the rewrite, and all 8 public examples pass. No source changes were needed.
- The same previously accepted defective sources fail after their fixes.
- Actual public CLI in the author image: 8 tests pass; `--only recovery-p7` selects and passes the single intended test. This uses the unchanged reader copied from stdin into an ephemeral image directory. It is distinct from running bare `make test` against the intentionally incomplete shipped starter.
- Real `ContainerWorkbenchPanel` under the parent Portal's Vitest/DOM harness: fetch actual starter/config, edit to the frozen reader, Inspect, execute the 8 public tests, submit all 7 via real local prepare/verify, and confirm each solved code input collapses. The platform auth/score adapter is replaced with a local adapter backed by real verifier verdicts; no AWS score authority is claimed.
- `make install` and `make agent-gate`: all 116 catalog entries valid. Python compile and `git diff --check` pass.

Logs: `/private/tmp/privacy-audit-716-reference-final.log`, `privacy-audit-716-final-http.log`, `privacy-audit-716-public-cli.log`, `privacy-audit-716-portal.log`, `privacy-audit-716-catalog.log`. This evidence is source reading, actual Linux processes, local HTTP and a real Portal component/DOM harness. It is not a manual real-browser playtest, actual AWS deployment or independent third-party playtest.

## Reproduce the retained Portal acceptance

The retained `portal/` directory contains the test, frozen reader and a runner that creates one temporary test file in the parent Portal and removes it on exit. It reads metadata and point values from this problem; no other problem's checkpoint or score is copied.

```sh
# Start this problem's Compose stack using a synthetic local seed.
FLAG_SEED=privacy-audit-reader-716 docker compose -f local/docker-compose.yml up -d --build --wait

# From the problem directory; use the existing parent checkout with installed dependencies.
AC26_WORKBENCH_URL=http://127.0.0.1:18098 \
  local/tests/hidden/portal/run.sh /absolute/path/to/TenkaCloud

# Author-side checks.
make reference-test

# Stop only this local problem when finished.
FLAG_SEED=privacy-audit-reader-716 docker compose -f local/docker-compose.yml down
```

The development rehearsal uses an isolated copy of the same Compose file with absolute build context and host port **18151**, project **ac26-privacy-audit-reader-716**, synthetic seed **privacy-audit-reader-716**, at `/private/tmp/privacy-audit-716-compose.yml`. It is left running for the root's final review; it must not be rebuilt while another reviewer is using it. No commit, push, release or AWS action was performed by this subtask.

## Filesystem metadata backport, 2026-09-07

At base 6416dab5af5805211b020f03c218a8827d66a201, this problem's own unchanged `restrict_learner` allowed mkdir, symlink, hardlink and FIFO creation. All four entries remained in a parent-owned TemporaryDirectory after the filtered child exited. `filesystem-before.json` records the policy hash and actual results; the fixture was then removed. The original log is `/private/tmp/filesystem-716-before.log`. No live Workbench, participant environment, external network or host folder was targeted.

The fix copies the proven native metadata-operation deny rules from linear 2444001 into this problem only. It does not share a runtime, change the loader or add an endpoint. The new `FilesystemMetadataBoundary` test in `test_execution_boundary.py` loads this consumer's actual filter in 16 disposable Linux children, requires EPERM for all 19 operations, and checks the parent's fixture content, directory listing, mode, uid/gid, mtime and extended attributes after each child exits. The TemporaryDirectory is also removed. This is an actual-filter regression, not a new participant playthrough or an attestation of all filesystem/kernel behavior.

Validation uses a dedicated `ac26-filesystem-716-w2-privacy-audit-author` image with `docker run --rm --init --network none`, read-only root, private /tmp, dropped capabilities and no-new-privileges. The unchanged reference/mutation and complete existing runtime/public-check suite are run, together with the new regression. Logs are `/private/tmp/filesystem-716-w2-privacy-audit.log`. No Compose project or listening service is started.

Reproduce from this problem's directory (the commands of `reference-test`, with explicit network and container isolation):

```sh
docker build --target author -t ac26-filesystem-716-w2-privacy-audit-author local
docker run --rm --init --network none --read-only --tmpfs /tmp:rw,noexec,nosuid,size=67108864 --cap-drop ALL --security-opt no-new-privileges:true --memory 1g --pids-limit 128 -e FLAG_SEED=filesystem-reader-716 ac26-filesystem-716-w2-privacy-audit-author python mutation.py
docker run --rm --init --network none --read-only --tmpfs /tmp:rw,noexec,nosuid,size=67108864 --cap-drop ALL --security-opt no-new-privileges:true --memory 1g --pids-limit 128 -e FLAG_SEED=filesystem-reader-716 ac26-filesystem-716-w2-privacy-audit-author python -m unittest discover -s tests/hidden -p test_execution_boundary.py -v
```

`make agent-gate` at the catalog root checks all 116 entries. This follow-up adds no new HTTP/UI flow; the existing suite exercises the unchanged positive/public-check paths with synthetic data. The prior live/API evidence above remains historical rather than being claimed as a new playthrough.

Final result: 8 existing mutations killed; 17 complete runtime tests pass in 71.672s, including the new filesystem case. Existing reference and public positive checks pass without changing their sources.

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
