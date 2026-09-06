# Private aggregate acceptance, 2026-09-07

Scope: `ac26-w2-private-aggregate` only, starting at catalog main
`d444d3b1954e7f1cdf6ebe0a186b09ce81e15fee`. No shared runtime, platform endpoint,
checkpoint ID, points, hint penalties or evaluation deadline was changed. The existing
25-second deadline covers a submission's learner session.

## Reading and sources

`first-reading.md` preserves root's original participant-only read of selected JA/EN
instructions, hints, README, starter and public checks. It found 12 actual gaps before
source changes or hidden/reference inspection. This is an agent playing the beginner
role, not an independent human or timed playtest. `revised-reading-root.md` records a
subsequent read of both revised languages and all 24 hints; it is not a second blind run.

The first reader wrote `portal/reader-aggregate.py` from public material. Its SHA256
remains `68f80983819ee810e543608dda56cfbc105488a58a1d4de2ce39b41aa6ea79a3` throughout
baseline, revised API, Linux and Portal-component runs. The first baseline already
passed all eight checkpoints and both public checks. We do not claim the original
problem was unfinishable or relabel the revised run as a first-attempt success.

The author then read runtime, fixtures and hidden checks to investigate those gaps.
That implementation review also found the claim that swapping count/severity must fail
was too broad: multiplication commutes. The revised relation is specifically a change
to one count, whose score delta is h times that organization's severity modulo p.

Both requested primary sources were read: official Week2 `toy-mpc/README.md` and the
owner's `advanced-cryptography-note/week2/index.html`. Exact local paths, repository
commits and SHA256 hashes are in `source-readings.json`. Additive reconstruction, public
terms, expansion of `(a+d)*(b+e)`, fresh masks and independent opening batches inform the
copy. The metadata's old alignment pin is preserved as historical provenance; it does
not mean the current Week2 lesson is still unpublished.

All necessary formulas are in the statement and starter. The p7 two-organization table
was hand-checked by the reader before the runtime change:

- Organization0: x=2,y=3,d=1,e=1, product pieces[3,3], total6.
- Organization1: x=1,y=4,d=5,e=3, product pieces[2,2], total4.
- One opening request returns[1,1,5,3]; sum products[5,5], add bias1 to get[6,5], total4.
- Increment the first count by1: score changes by3, giving0 modulo7.

The revised entry starts with school arithmetic and `plan(spec)`, then identifies all
four functions and eight fields. The hints distinguish organization i from piece-owner
j, reset `triple=triple_list[i]` in both loops, and separate values, multiplicity and
rounds. Public plan can succeed while unfinished public score still fails.

## Confirmed before/after defects

`boundary-http-before.json` preserves actual old-server HTTP results on the dedicated
synthetic deployment. `boundary-http-after.json` preserves the first corrected-server
run using the same frozen reader. These are runtime-boundary probes, not evidence of a
participant-only reading.

| Probe | Before | After |
|---|---|---|
| Frozen public reader, eight checkpoints | 8 correct | 8 correct |
| Print `{"failures":[]}`, flush, exit0 without implementing functions | multiply correct | rejected |
| Open raw counts, then rewrite `io.opened/rounds/batch_sizes` | privacy/cost correct | both rejected |
| Same printed verdict on public tests | passed | failed |

The flushing step matters: an earlier unflushed stdout probe did not reproduce the
verdict shortcut. The saved before result is the flushed, reproducible case. The
observation-forging source is retained as `forged-observations.py`.

The trusted parent now owns the mathematical checker and the `Protocol` observation
record. The learner receives a remote opening handle. Each matching request is
validated, recorded and reconstructed by the parent before values are returned.
Rewriting child fields cannot erase an already received raw-input opening or turn two
received batches into one. Printed grade-shaped JSON is never the grade channel.

## Exact contract and limits

The channel carries untrusted values, not attestations of Python types or function
execution. Fresh 128-bit request IDs are sent after readiness and reject stale or
preprinted answers. A program that reads the live ID can still send values directly;
those values must satisfy the same parent mathematics and observed opening criteria.
The regression accepts the correct live-ID response and rejects wrong outer/inner
lengths, booleans, floats, out-of-range values and wrong sums.

Lists and tuples are equivalent ordered sequences for returned pieces, both levels of
`share_inputs`, and opening inputs. Examples use lists. Plan retains exactly its three
integer keys. Public constant offsets may be spread over owners provided their sum is
the constant modulo p; one owner is a simple implementation, not the sole valid one.
A zero modular excess must not make an otherwise equal result fail.

Privacy compares the multiset of reconstructed opened values with the expected masked
differences, including multiplicity. It allows reordering and cannot authenticate the
source-level origin of coincidentally equal values. Triple reuse can still produce a
correct score and open2k values in one round, so cost is not a proof of fresh masks.
All shares are available to the single learner program; it can reconstruct them
locally. The observed opening channel is not all Python information flow, distributed
MPC confidentiality, collusion resistance or network latency. The final score itself
reveals what follows from it.

Zero masks are valid and now included by deterministic fixture generation. The
uniform-mask explanation is explicitly conditional on independent uniform masks
unknown to the observer; deterministic toy generation is not certified cryptographic
randomness.

Linux workers receive a clean environment, closed inherited FDs, bounded source/output,
25-second session deadline and memory/process limits. Seccomp rejects file opens and
metadata writes, program/network access, parent process interference, scheduler writes,
SysV IPC and POSIX message queues. Denied file operations also prevent POSIX shared
memory/named-semaphore creation. Tini and process-group cleanup reap descendants. These
checks cover specified surfaces and are not a guarantee against a Docker administrator
or a substitute for a hardened execution platform. Hidden fixture/error text and seed
values are not returned; public diagnostics use validated source filename/line/type.

## Local verification

All commands below run from this problem directory, except catalog validation.
The dedicated instance is project `ac26-private-aggregate-reader-716`, loopback18153,
synthetic seed `private-aggregate-reader-716`. `/private/tmp/private-aggregate-716-compose.yml`
is the repository Compose with an absolute local build context and only its host port
changed from18099 to18153. It is not the user's shared Compose project.

```sh
make reference-test IMAGE=ac26-private-aggregate-reader-716 FLAG_SEED=private-aggregate-reader-716
AC26_WORKBENCH_URL=http://127.0.0.1:18153 python3 local/tests/hidden/http_acceptance.py
AC26_WORKBENCH_URL=http://127.0.0.1:18153 ./local/tests/hidden/portal/run.sh /private/tmp/tenkacloud-score-history-20260906
```

The retained Portal launcher requires an explicit TenkaCloud checkout with installed
participant-portal dependencies. It temporarily places the test next to the real
`ContainerWorkbenchPanel` and removes that file on exit. The test uses the real Portal
components and local `/api/prepare` → `/verify` API for all eight code fields, asserting
source preservation across eight preparations and folding of solved rows. Only auth and
the outer platform score transport are mocked. This is a components/API test, not a
real browser, Cognito/AWS event or independently conducted human session.

The original `make test` is also run with the unchanged reader. On this Colima host a
`/private/tmp` bind mount was empty in the VM, so the first run correctly failed with
`FileNotFoundError`; it was not recorded as a successful public test. For the rerun,
Docker's build context copies the frozen reader into a dedicated temporary participant
image, and a Compose override selects that image for the Makefile's existing public
runner. No starter source in the problem or shared daemon mount configuration changes.
A normal host whose bind mounts work can use the original read-only starter mount.

To reproduce that dedicated reader-image public run after
`make build IMAGE=ac26-private-aggregate-reader-716`:

```sh
docker build -t ac26-private-aggregate-reader-716-make-test -f - local/tests/hidden/portal <<'DOCKER'
FROM ac26-private-aggregate-reader-716:latest
COPY --chown=10001:10001 reader-aggregate.py /problem/starter/aggregate.py
DOCKER
cat > /private/tmp/private-aggregate-716-reader-override.yml <<'COMPOSE'
services:
  workbench:
    image: ac26-private-aggregate-reader-716-make-test
    pull_policy: never
COMPOSE
make test IMAGE=ac26-private-aggregate-reader-716 FLAG_SEED=private-aggregate-reader-716 \
  COMPOSE='FLAG_SEED=private-aggregate-reader-716 docker compose -f /private/tmp/private-aggregate-716-compose.yml -p ac26-private-aggregate-reader-716' \
  RUN='FLAG_SEED=private-aggregate-reader-716 docker compose -f /private/tmp/private-aggregate-716-compose.yml -f /private/tmp/private-aggregate-716-reader-override.yml -p ac26-private-aggregate-reader-716 run --rm workbench'
```

Logs are outside the repository under `/private/tmp/private-aggregate-716-`:
`reference-test-final.log`, `make-test.log`, `make-test-final.log`, `final-http.log`,
`real-portal-component.log`, `real-portal-component-final.log`, and `catalog.log`.
The reference target retains nine mutation cases; the Linux suite has25 tests including
actual parent observation tampering, valid alternatives, live reply checks, stale IDs,
process cleanup, all-process seed/file access, persistent IPC, six scheduling writes on
a disposable helper parent, and19 filesystem operations across16 workers with unchanged
parent files/metadata. The timeout test starts its worker first, then tests the same
300ms partial-output hang deadline and descendant cleanup; it does not relax production25s.

Catalog validation is `make agent-gate` from the repository root (116 metadata entries).
Python compilation and `git diff --check` complement the runtime checks. Real AWS and
production deployment are not performed. The dedicated18153 service is intentionally
left running for root's final review; root owns the subsequent project-specific stop.

## Final observed results

- Original mutation suite: all9 killed; reference passes.
- Linux boundary:25/25 pass in72.309s, including tuples/live-ID comparison and filesystem metadata denial.
- Original Makefile public runner with frozen-reader image:2/2 pass.
- Dedicated final HTTP: config/JAEN labels/Inspect agree; prepared frozen reader8/8;
  public2/2; printed verdict, forged observations (privacy and cost), wrong score and
  public stdout spoof rejected.
- Retained real Portal components: all8 fields pass in one test;7.86s total,2.99s test time;
  eight unchanged preparations and solved-row folding confirmed. Temporary test removed.
- Catalog116/116, Python compilation, diff whitespace checks pass.

The original description, Inspect text, learning goals and both writeups were also
synchronized with the model: no stale set-without-multiplicity rule, source/type
attestation, unique-owner requirement, actual-latency guarantee or current-unpublished
Week2 claim remains in those explanations. The course pin/status itself is preserved.

Root final review inspected the parent opening-event record, value validation, bounded worker and preserved protocol checks. The retained real Portal/API harness was rerun on the final18153 services and passed all eight fields; see `/private/tmp/private-aggregate-716-root-portal.log`.
