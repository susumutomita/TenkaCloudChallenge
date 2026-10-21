# Old Tickets, Reused Boxes — memory-slot-lab

A deterministic, safe semantic simulation of stale references, slot reuse and control-data
changes. It does not corrupt real C memory or reproduce php2shell / CVE-2026-109618 or
109619. The correspondence and differences against the 2026-10-21 official disclosures
are documented below. No machine addresses,
shell commands, executable input, credentials, or external services are required.
The interactive lab and detailed code commentary are Japanese; metadata is bilingual.

## Run locally

From this problem directory, with Node.js 22 or newer and no dependencies:

```sh
node local/app/demo.mjs
node --test tests/*.test.mjs
node local/app/server.mjs
```

Open `http://127.0.0.1:8080`. Predict the outcome, compare three columns, inspect snapshots
with the slider, edit the guard program and rerun. Stop the server with Ctrl+C.
The page fetches only local assets; the optional official-PHP documentation link is not
needed for the experiment.

In a separate terminal, test the existing TenkaCloud verification contract:

```sh
FLAG_SEED=local-fixture-only node local/verify/server.mjs
curl -s http://127.0.0.1:8081/verify -H 'Content-Type: application/json' \
  -d '{"submission":"{\"guards\":[[\"slot.live\",\"==\",true],[\"handle.generation\",\"==\",\"slot.generation\"],[\"slot.owner\",\"==\",\"caller.owner\"],[\"slot.kind\",\"==\",\"caller.kind\"]]}"}'
```

`FLAG_SEED` is a local per-run fixture seed, not an external credential. TenkaCloud injects
it through `secretEnv`; only the verifier receives it. Grading evaluates submitted comparison
expressions, rather than asking participants to guess a seeded secret.

## Story, participant route and expected behavior

Maintain a progress-update system whose displayed action changes after a delayed update.
The first action is to predict and inspect the visible state transitions. Then construct a
small JSON program of comparisons, choosing operands and equality/inequality from the documented field set and submit the entire JSON in Portal.
This is a repair exercise with tests, not a single repair switch.

![Slot reuse and control-data change](diagram.svg)

|Same input B|Read using progress ticket|Write using progress ticket|Selected action|
|---|---|---|---|
|Normal: keep progress alive|25%|Change progress only|A, blue card|
|Faulty: release, reuse|Unrelated control value A|Overwrite control with B|B, yellow card|
|Fixed: identical release/reuse|Reject stale generation|Reject stale generation|A, blue card|

These are design expectations. `observed-demo.json` is actual CLI output, recorded separately.
Normal is a lifetime control experiment; faulty and fixed use identical operations and input.
The repair column initially has no guards and shows the participant's current program.

## Components, code and reference solution (operator material)

`local/app/model.mjs` implements allocation, release, handle resolution, reads, writes,
immutable snapshots and a closed harmless A/B dispatcher. Allocation increases the slot's
generation. Release does not destroy copied handles. An unchecked slot index therefore
reaches a different object after reuse. Both reads and writes use the same resolver.

```json
{"guards":[["slot.live","==",true],["handle.generation","==","slot.generation"],["slot.owner","==","caller.owner"],["slot.kind","==","caller.kind"]]}
```

Each comparison is `[left, "==" or "!=", right]`; operands are public field names or booleans. Order and equivalent operand arrangements may vary. Self-comparisons and reject-all programs do not solve the task. Live alone misses reuse. Owner and kind alone miss same-owner/same-kind
reuse. Generation alone misses access after release and wrong caller context. All four
are necessary properties in this comparison model, though real systems can use other ownership/lifetime
designs. The visible lab defines every operation, generation comparison and goal.

`local/verify/grade.mjs` executes submitted programs against valid access, released access,
repeated same-owner/same-kind reuse, and mismatched owners and kinds. It independently
checks reads and writes and verifies rejected writes leave state intact. It does not trust
client-provided success logs. The verifier lives in a separate process/image; its fixtures,
reference solution and tests are absent from the participant image. Only `/`, `/model.mjs`
and `/healthz` are served. Scoring uses `verify`: `{submission: string}` → `{correct: boolean}`.
Correct: 100 points; wrong: 5-point penalty; hints: 20 and 30 points. Portal owns points.

## Safety boundary and relation to PHP

Unintended writes can change control information that selects the next action. Overwriting
a saved return address changes where a function returns; this model instead resembles a
reused heap object containing a function-pointer-like value. It does not overwrite a stack
return address. Slot indices and A/B are labels, never CPU addresses. Corruption can also
crash or be stopped by protections; it does not inevitably become arbitrary code execution.

The [official PHP manual](https://www.php.net/manual/en/session.upload-progress.php)
states that upload progress is recorded in the session before scripts execute. This
illustrates input processing before application code. It proves neither stale references
nor a CVE cause by itself. The model's release/reuse order is fictional; the following
section records the official disclosure review.

## Relation to the 2026-10-21 official PHP disclosures

The [PHP announcement](https://www.php.net/index.php) lists fixed releases
**8.2.35 / 8.3.36 / 8.4.27 / 8.5.12**. These source-backed summaries describe the
real issues; they are not results of running this model against PHP.

|Official issue|Correspondence and difference|
|---|---|
|[CVE-2026-109618 / GHSA-w8hw-w9fx-j79w](https://github.com/php/php-src/security/advisories/GHSA-w8hw-w9fx-j79w): an OOM `longjmp()` can leave partially initialized state for shutdown to read or branch on.|The model has no OOM, nonlocal exit, partial initialization or PHP shutdown. It does not reproduce this cause.|
|[CVE-2026-109619 / GHSA-6wmf-4rv5-p3rp](https://github.com/php/php-src/security/advisories/GHSA-6wmf-4rv5-p3rp): worker globals can retain references to freed request-owned memory, consumed by a later request in the same worker before normal initialization.|The stale-reference lifetime principle is related. The model uses one array operation sequence, without HTTP request boundaries, workers or PHP globals.|

The latter advisory also identifies session upload progress as an early state consumer.
The progress story is only an analogy, not multipart parsing or PHP sessions. PHP's fixes
change OOM exit handling and reset state, respectively. The model's generation/owner/kind
checks are a teaching design, not the PHP patch or a substitute for updating PHP.

The advisories report real RCE. This model only selects fixed harmless A/B displays; it
implements no real allocator, heap layout, execution addresses or attack payload. It
neither reproduces an exploit nor validates PHP patches or real-system safety.

## Containers and platform integration

```sh
FLAG_SEED=local-fixture-only docker compose -p memory-slot-lab -f local/docker-compose.yml up --build -d --wait
# Web: http://127.0.0.1:18080; verifier: http://127.0.0.1:18081/verify
FLAG_SEED=local-fixture-only docker compose -p memory-slot-lab -f local/docker-compose.yml down
```

Both images run as non-root with read-only filesystems and health checks; published ports
bind loopback. Use an isolated TenkaCloud checkout and a local-path catalog-source config:
`make catalog-download CATALOG_SOURCES=<config>`, then `make catalog-prepare`, then
`CATALOG_SOURCES=<config> make local`. Create a new event containing this problem, start
its runtime, open its Web URL and submit the JSON. The generated core `problems/` is not
an authoring source. Full Portal event creation/start/grading/teardown was not tested.
Local Docker problems still require the host's supported Linux isolation; Cloud hosting
excludes Docker problems. No core runtime changes are needed for the declared contract.

## Measured verification and limits

The catalog `make agent-gate` passed all 25 metadata records and 11 root tests.
The core TenkaCloud `loadContainerProblem` loaded this problem; `checkComposePolicy`
reported zero violations. These parser checks are not a full event playthrough.

On 2026-10-21, Node 26.5.0 passed 5/5 tests: state transitions, valid access, repeated reuse,
all 15 incomplete guard subsets, reordered complete guards, two fixture seeds, malformed
submissions, self-comparisons, inverted operators, reject-all and equivalent comparisons, HTTP grading and participant-path isolation. Chrome displayed normal A,
faulty B and fixed A after entering the repair. Both Node 22 Alpine images built;
the final Node 22 container passed all 5 tests including HTTP with networking disabled, a read-only filesystem and a non-root user.

Compose did not start: the existing Docker daemon reported
`all predefined address pools have been fully subnetted` during network creation.
No other networks were deleted or changed. Native Node remains usable. No claims are
made for real PHP, real corruption, CVE reproduction, RCE, AWS or production.

## Cost-bearing resources and teardown

No paid cloud resources; Region: not applicable. Suggested session: 30 minutes. Only local
CPU and memory are used. Stop native servers with Ctrl+C or use the exact Compose project
name with `down`. No persistent volumes. This public catalog contains operator writeups;
it is not a secrecy boundary for reference solutions.
