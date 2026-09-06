# Issue #716 — participant reading and runtime evidence

Author-only record. This file is excluded from the participant image. Evidence was collected
on 2026-09-07 JST in an isolated clone at base
`b64dfa9fe09f06ffc544c858715419ef9e8191f7`, for this problem only. No shared runtime,
platform contract, other problem, AWS resource, or real credential was changed.

## Sources read before implementing the revision

Both sources were inspected directly; the official material supplies the mechanism and the
author's notes supply the beginner-facing explanation. No course solution/fixture was copied.

- `advanced-cryptography-2026` at `bdbc913fa7fd4ed87ce7f0de6b1d73fb41e49732`,
  `week1/problems/proof-of-exploit/README.md`, lines 14–23 (constraints and witnesses),
  58–66 (missing-constraint attack), 74–103 (circuit construction).
- `advanced-cryptography-note` at `58344a29ea39c25839475ba9a594c115ed89989b`,
  `week1/index.html`, lines 863–875 and 913–915: constrain the inputs and distinguish a
  missing condition from an extra condition.
- Current `AGENTS.md` §12b/c/d: first useful action, given formulas and small examples,
  mechanism → example → actual screen/file procedure, and a transfer task at the end.

## First reading before hidden/reference access

The root reviewer read Japanese/English instructions, hints linked by checkpoint ID,
all three public starters, and actual Inspect output. The reviewer had not read this
problem's hidden checker or reference solution. This is an agent participant-role read,
not an independent human playtest. Record: `/private/tmp/constraint-lab-716-reader/first-reading.md`.

The first pass caught nine concrete gaps:

1. Direct substitution was described as private/succinct proof. It is a representation
   step; this task exposes the values and evaluates every expression.
2. `(5+x)+(3+x)-(8+2x)` is always zero and has no separately proposed output to reject.
   Replace it with `x+y−z` and compare a good and bad proposed `z`.
3. The product-zero argument needs prime `p`; `2*3` modulo composite 6 is a counterexample.
4. A three-bit range 0..7 conflicts with a divisor 7 and the promised `2**bits < p`.
   The revised three-bit example explicitly uses `p=11`.
5. Normalization must handle large positives, not just negative values.
6. The starter's constant-zero Boolean gadget admits only zero; it does not admit every value.
7. Field notation and the normalized range were undefined in the starter.
8. First-broken had no hints; other hints began at checking, while the needed range
   construction was buried in a final hint.
9. The useful action appeared only after long specialized framing.

The revision puts Start → Inspect evidence → first nonzero row first; gives the five
expressions and range construction in the statement; defines each term before use;
adds three hints to all five checkpoints; and preserves code transfer across widths,
signal names and fields. The closing question asks how an omitted Boolean constraint
could permit an out-of-range value. Hint total is 60, base score 200, wrong attempt 10.

A second reader inspected only the revised public packet and independently calculated:
with public `p=97`, the honest trace is all zero; broken row `c3` is
`34+37−88=-17`, normalized to 80. The answer is
`{"constraintId":"c3","residual":80}`. This reader caught one stale intermediate example
in `gadgets.py`: the top-down doubling explanation still said `b1+b1 → t1=0`.
For digits 1,0,1, it must say `b2+b2 → t1=2`. That example was corrected before testing.

## Unchanged participant-only code

The root reviewer wrote these files from the public statement/Inspect alone, before
hidden/reference reading, in `/private/tmp/constraint-lab-716-reader/source/`:

| File | SHA-256 |
|---|---|
| `field.py` | `c1adbdd7e74bcfc09d18f797a799b6ff51e70d4f444e32dc71e034f7824a54c2` |
| `circuit.py` | `902a7e7a40bdc46beaa9d2a8a9c63fec17c1b37ff2a4dae32844a6c0cc88a10a` |
| `gadgets.py` | `f4f69076e6185e47ce0c6c1bef65a96d99758fbabd3333c099ae840da8412e07` |

All three files were submitted unchanged. The explicit synthetic seed for the dedicated
session was `constraint-reader-716`. It is test data, not an environment credential.
Public formulas, source assertions and this hand calculation supplied the acceptance
answers; hidden/reference code was used separately only for author boundary/mutation tests.

## Reproduced boundary failures and repair

Before repair, actual `/verify` accepted a source that printed `{"failures":[]}` and
exited for each of the four code checkpoints. `/api/test` also reported that submitted
code could see `FLAG_SEED` in its environment and a process environment. Probes recorded
only booleans, not the value. Log: `/private/tmp/constraint-716-baseline-boundary.log`.

The prior runner put hidden checks and learner imports in the same interpreter. The
replacement keeps the existing trusted, bounded checker process but moves learner
functions to a separate value worker. The checker never imports submitted modules.
Each returned value remains untrusted and is checked by the existing evaluator. Worker
stdout cannot become the parent's failures list. The public runner uses the same value
boundary and published assertions. The participant image/Compose environment has no seed.

Linux filters deny file opening (including `/proc` and private source paths), network,
program execution, and signals/resource-limit changes to the supervisor. The value
channel is bounded, uses nonblocking input/output, and shares one deadline. Nested
children remain in the launcher-owned process group and are terminated on completion
or timeout. This is a problem-local boundary, not a claim of secrecy from Docker admins
or immunity to every host/kernel attack. The existing exact range search and its
200,000-assignment budget were preserved without loosening tests.

## Actual route and regression results

Dedicated Compose project `ac26-constraint-reader-716` exposed only `127.0.0.1:18146`.
Only that project was rebuilt for verification. The verifier stayed unpublished.

- Actual HTTP: **34 checks passed**. Unchanged reader public tests, four prepared code
  bundles, all four code verdicts, and the manual c3/80 answer passed. Wrong manual
  shapes/value types failed without hints; forged grade output and private imports failed
  on all four phases; invented kinds and unconstrained range failed with property-level
  messages; seed/proc/private-file/network probes returned only negative booleans; private
  paths, incomplete submissions, and post-negative health were checked.
  `/private/tmp/constraint-716-http-acceptance-final.log`.
- Real parent Portal components at parent revision `6bce083`: **1 test passed** (7.15 s).
  Root rendered the product components and replaced only transport with local 18146.
  It edited the same three reader files, submitted the four code rows and the manual
  first-broken JSON, observed all five correct, each solved row folded, and zero unanswered.
  `/private/tmp/constraint-716-portal-harness.test.tsx` and
  `/private/tmp/constraint-716-real-portal-component.log`. The temporary parent test was
  removed afterwards. This is a component/HTTP test, not a browser screenshot or AWS run.
- Actual CLI public/adapter assertions: **14 passed** using the same reader files in a
  temporary submission directory; the starter checkout was not replaced.
  `/private/tmp/constraint-716-cli-public.log`.
- Actual Linux execution boundary: **10 tests passed**, including multi-seed reference
  phases, stdout forgery/private imports, all process environments enumerated by the
  trusted parent (plus self and PID 1), supervisor signals/resource changes, partial
  output/no newline, blocked input, successful/timeout process-group cleanup, hidden-input
  print suppression, and manual-answer shape. `/private/tmp/constraint-716-linux-boundary.log`.
- Existing mutation suite: **25 cases passed** (24 negative cases plus a valid-range
  acceptance control), with rule-specific messages for targeted mutations. No mutation/checker was changed.
  `/private/tmp/constraint-716-linux-mutation.log`.
- Pure exact search: **400 random gadgets, zero disagreement with brute force**; 134 used
  the value-by-value fallback and none exceeded the budget. The selector exploit was
  rejected and all three legitimate constructions passed on three seeds.
  `/private/tmp/constraint-716-range-exactness.log`.

The author `reference-test` target now runs mutation plus Linux boundary checks in
restricted disposable containers. The final repository-root `make install` and `make agent-gate` passed: **116 metadata
records valid** (`/private/tmp/constraint-716-catalog.log`). The documented `make
reference-test IMAGE=constraint-716 FLAG_SEED=constraint-boundary-synthetic` target
also passed, recorded in `/private/tmp/constraint-716-reference-target.log`. The catalog
gate is separate from these runtime claims.
Host-only tests skip Linux isolation intentionally; the actual Linux results above supply
that evidence. After the final 34-check HTTP rerun, the dedicated project was stopped: both containers
and both project networks were removed; project-filtered listings were empty. Logs:
`/private/tmp/constraint-716-cleanup.log`, `constraint-716-remaining-containers.log`, and
`constraint-716-remaining-networks.log`. Images/build cache remain; no broad Docker cleanup
was performed. The initial final-HTTP attempt met sandbox localhost EPERM before any
request; the same scoped test passed after normal approval review, without an approval rejection.

## PR #760 review follow-up at 5410fdd

Two review findings were fixed without changing the exercises, scoring, range search or
platform contract:

- **Descendant reaping:** the verifier service had no `init: true`, although the
  Workbench and author test containers did. Killing a process group stops computation
  but does not reap orphaned zombies. The verifier now also runs with Docker's init.
  Cleanup tests require the child PID to disappear from `/proc`; a `Z` state no longer
  counts as success.
- **Public startup diagnostics:** source compilation and module initialization now
  complete before the function-call channel starts. The worker reports a structured
  startup error; the public controller validates an editable filename, line number and
  exception type, removes control characters and bounds its message. For example,
  `field.py:1: SyntaxError: invalid syntax (field.py, line 1)` tells the participant
  what to edit. Module import and initialization errors similarly identify their
  source line. Hidden grading still reports only its generic/property-level failure;
  exceptions from hidden function calls do not expose their inputs.

Verification used the same dedicated `ac26-constraint-reader-716` project, local port
18146 and synthetic seed `constraint-reader-716`. Both the repository Compose file
and the dedicated Compose copy include the verifier init setting.

- **Actual Compose HTTP stress:** 64 successive correct residual submissions each
  forked four descendants, for 256 total. Trusted `/proc` observations after every
  submission found **zero zombies**. Process count was 3 before and 3 after (maximum
  sampled 4 while a health check ran); PID 1 was `docker-init`. A valid public test
  still passed after the stress run.
- **Actual public diagnostics:** SyntaxError at `field.py:1`, ModuleNotFoundError at
  `circuit.py:2`, and ValueError at `gadgets.py:2` were displayed with filename, line
  and type. Messages were single-line, bounded, and contained no worker path or escape
  control characters. The corresponding `/verify` calls failed without echoing the
  initialization marker.
- `make reference-test IMAGE=constraint-760 FLAG_SEED=constraint-boundary-synthetic`:
  **25 mutation cases and 13 Linux boundary tests passed**. The latter include another
  64 × 4 descendant run, exact PID disappearance after success and timeout, malformed
  diagnostic fields, and private-input suppression.
- The unchanged independent reader's existing actual HTTP acceptance suite passed
  again, with **34 checks** over all five checkpoints and the existing negative cases.
- Python compilation, `git diff --check` and the final catalog gate passed;
  **116 metadata entries** remain valid.

Logs: `/private/tmp/constraint-760-http-regressions.log`,
`/private/tmp/constraint-760-http-acceptance.log`,
`/private/tmp/constraint-760-reference-test.log`, and
`/private/tmp/constraint-760-catalog.log`. These are local API/process observations,
not a new browser, production or AWS claim.

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

- `constraint-linux.log`:16 tests PASS. New IPC tests run19 System V/mqueue
  operations and POSIX shm/sem creation across64 iterations each, with no residual
  objects. Every regression probe removes its own objects even if the deny fails.
- One pre-existing200ms I/O test initially timed out during Python startup under
  load. It now starts the interpreter first, then applies the same200ms deadline to
  partial-read and blocked-write operations. Production limits are unchanged.
- `constraint-mutations.log`:25 existing mutations killed.
- `reader-api.log`: the original three reader files remain byte-identical and pass
  public tests, four code submissions and the original first-broken answer at
  dedicated `127.0.0.1:18152`, project `ac26-constraint-ipc-716`, synthetic
  `constraint-reader-716`. The actual Workbench/verifier children also reject IPC
  creation while those functions still pass. The HTTP parent was not a scheduling
  probe target.

Logs are under `/private/tmp/constraint-ipc-716-evidence/`. The shared catalog gate
`make install && make agent-gate` validates116 metadata files separately. Each
problem’s existing `make reference-test` runs its own mutation and Linux suites;
recorded runs used equivalent commands with dedicated image names.
