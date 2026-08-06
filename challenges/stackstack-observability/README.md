# Making a Silent App Talk — StackStack observability

> TenkaCloud Challenge · `challenges/stackstack-observability` · difficulty 3 · ~45 min · `multi-verify` scoring

The board works. The dashboard is green. And people keep saying the things they wrote
have gone missing. This is the problem where you stop guessing and make the app say what
is happening to it.

It is **AWS-free**: one Docker container on your machine, no cloud account, no
credentials. What it models is the minimum an application owes an on-call human — a
number that says *what* is failing, a log line that says *why*, and a health check whose
condition is written down where you can read it and argue with it.

## What gets deployed

| Where | What |
| --- | --- |
| **Your machine (Docker)** | The shared **StackStack base app** with `SCENARIO=observability` |
| `127.0.0.1:18080/` | The board — unchanged from onboarding |
| `127.0.0.1:18080/relay` | The relay console — what is being shipped downstream, and what is not |
| `127.0.0.1:18080/metrics` | The numbers, in Prometheus text format |
| `127.0.0.1:18080/relay/healthz` | The relay's health check |
| `127.0.0.1:18080/archive` | What actually reached the downstream archive |
| `127.0.0.1:18081` | Loopback `/verify` the TenkaCloud scorer delegates to |
| `127.0.0.1:18080/docs` | Browser API console and request workbench; relay changes live at `PATCH /api/settings` |

The image is built from [`stackstack-base/`](../../stackstack-base), shared by every
StackStack problem. The shard names, the shard codes, the incident id, the safe-log
token, the relay's downstream credential and the title-to-shard map are all derived
inside the container from a per-deploy random `FLAG_SEED`, so no answer is stored in this
repository and no two deploys share one. Both ports are bound to `127.0.0.1` only.

### Honest about the model

There is no CloudWatch here, no alarm, and no load balancer. What exists is one process
that publishes counters, writes lines, and answers a health check whose condition lives
in a file. The mapping to what this becomes on AWS:

| In this container | Real equivalent |
| --- | --- |
| `GET /metrics` | CloudWatch metrics, or a metric filter over a log group |
| `healthCheckProbes` in `relay.json` | an ALB target group's health check condition |
| `GET /relay/healthz` | the path the target group polls |
| `archiveLogging` in `relay.json` | whether the application logs at all |
| `logDetail` in `relay.json` | log masking / structured-log field selection |
| The archive's four shards | a downstream partition, AZ, or shard |

**There is no "create an alarm and watch it fire" step, on purpose.** Paging yourself
from a container on your own laptop teaches nothing. What is scored here stops at *is
this system in a state where something could fire*; the firing belongs to the Battle,
against a fault somebody else injects.

## Mission

Four checkpoints, 200 points:

| Checkpoint | Points | What it asks |
| --- | --- | --- |
| Get the writes that never landed into the record | 50 | The incident id from a dropped-write log line |
| Make the health check tell the truth | 45 | The receipt for the gate watching the health condition |
| Make the investigation log safe to hand over | 60 | The safe-log value the redacted lines carry |
| Name the slice that is actually down | 45 | The code of the shard that is refusing writes |

## Steps

1. Start it:

   ```
   make local PROBLEM=stackstack-observability
   ```

2. Open the relay console at `http://127.0.0.1:18080/relay`, then ask the two surfaces
   that disagree with each other:

   ```
   curl -s http://127.0.0.1:18080/metrics
   curl -s -w ' [%{http_code}]\n' http://127.0.0.1:18080/relay/healthz
   ```

   One says a dependency is not answering. The other says everything is fine. Both are
   telling the truth about what they were asked.

3. Write to the board a few times, with different titles, and look at the numbers again:

   ```
   for i in 1 2 3 4 5 6 7 8; do
     curl -s -o /dev/null -X POST -H 'content-type: application/json' \
       -d "{\"author\":\"you\",\"title\":\"note-$i\",\"body\":\"x\"}" \
       http://127.0.0.1:18080/api/posts
   done
   curl -s http://127.0.0.1:18080/metrics
   curl -s http://127.0.0.1:18080/archive | jq '{count, attempted, missing}'
   ```

   Every post is on the board. Not every post is in the archive. The breakdown per shard
   appears only for shards something has actually been written to — nothing is printed
   for you before you have produced it.

4. Now read the log:

   ```
   curl -s 'http://127.0.0.1:18080/api/logs?limit=200' | jq -r '.lines[].message'
   ```

   Boot lines, post-accepted lines — and nothing at all about the writes that did not
   land. That silence is a setting, and the setting is in

   Open `/docs`, inspect `GET /api/settings`, then use `PATCH /api/settings`.
   No repository file is edited.

   which the app re-reads on every request. There is nothing to restart.

5. Once the signal is on, read the log again before you paste any of it anywhere.

6. Check the posture:

   ```
   curl -s http://127.0.0.1:18080/posture | jq
   ```

   ```jsonc
   {
     "gates": {
       "traffic_seen": true,
       "failures_logged": true,
       "health_honest": true,
       "credential_out_of_logs": true
     },
     "tokens": { "health_honest": "TC{...}", "...": "..." },
     "ready": true
   }
   ```

   A false gate is your next action. `GET /relay/state` returns the same measurements in
   more detail — including whether the health condition you wrote passes the three cases
   the gate evaluates, and whether anybody has actually run it since you wrote it.

7. Retry from the starter with `DELETE /api/settings` in `/docs`.

## The surfaces this problem adds

| Route | Purpose |
| --- | --- |
| `GET /relay` | The relay console, as a page |
| `GET /relay/state` | The same measurements as JSON, including what each gate is looking at |
| `GET /relay/healthz` | The relay's health check — its condition comes from `relay.json` |
| `GET /metrics` | Counters and gauges, Prometheus text format |
| `GET /archive` | What reached the downstream archive |

The board's own routes (`GET /`, `/api/board`, `/api/logs`, `/posture`, `/healthz`,
`POST /api/posts`) are unchanged from stackstack-onboarding. The board's `/healthz` stays
200 throughout: the board is not what is broken.

## Why it is built this way

- **Both fixed responses are refused.** The condition is graded in three worlds, and
  each rules out a different answer: pointing it only at the settings file (the shipped
  condition) is never red, pointing it only at the archive would stay green through a
  broken settings file, and an empty probe list — "always 503, then I can never miss an
  outage" — is never green. Exactly one condition is right in all three.
- **A correct health check goes red here, and that is the pass.** The archive really is
  down. Once `/relay/healthz` looks at it, it answers 503 and keeps answering 503. A
  health check that has never once gone red has not been shown to work — it has only been
  shown to be pointed at something that cannot fail. The container's own `healthcheck:`
  is deliberately pointed at the board's `/healthz`, not the relay's, for exactly this
  reason.
- **Silence is not health.** The two cheapest ways to make the errors disappear are to
  close the board and to turn the relay's log back off. Both are refused: every
  checkpoint requires that failures are *really happening and being recorded* before
  anything else is graded. "No errors on screen" scores zero, not full marks.
- **Turning the log off is not how you fix a leak.** *Make the investigation log safe to
  hand over* checks two things before it looks for an absence: a dropped-write line and a
  delivered-write line are both *present* right now under the settings in force — the
  delivered line is itself the evidence that writes are still reaching the archive — and
  both still carry the shard, its code, the target and the epoch. An empty log fails at
  the first of those and never reaches the absence check; a log cut down until nothing
  sensitive is left fails at the second.
- **Masking the tail is not masking.** `logDetail` has a setting that blanks the end of
  the value and keeps the front — the fix people actually ship, because it looks redacted
  and still correlates. The absence check matches the first twelve characters, so what is
  left is enough to fail, and no safe-log value is issued on those lines at all.
  The setting that cuts the line down instead really does remove the value — and fails
  the other way, on the fields the investigation needs, and on the incident reference
  *Get the writes that never landed into the record* is asking for. Only one of the four
  settings both replaces the value and keeps the record.
- **Every shard has a code.** *Name the slice that is actually down* is a correlation,
  not a copy: all four codes are printed once their shards have been written to, and
  submitting the wrong shard's code is a wrong answer. The checkpoint also requires that
  the shard you name really refused one of *your* writes, and that something else really
  accepted one — "everything is broken" is a different diagnosis.
- **Restarting costs.** The title-to-shard map is derived from the seed and holds no
  state, so the same titles fail the same way after a restart — nothing is fixed. What a
  restart does do is zero the counters and clear the log ring, which takes three
  checkpoints that were passing and makes them fail until you generate the evidence
  again.
- **Hard-coding the answers.** The incident id, the safe-log value, the four shard names,
  the four codes and the title-to-shard map are all derived from a per-deploy `FLAG_SEED`
  inside the container. The health-check receipt comes from a secret generated at boot,
  so it is not even stable across a restart of the same container.

### What leaked stays leaked

Turning the log's detail down does **not** un-write the lines that already carry the
credential. They stay in the log, and you can still read them. That is deliberate: the
absence check is scoped to the lines written under the settings in force *now*, because a
config change is not a remediation for a value that has already been written down. In a
real incident this is the moment you rotate the credential — editing or grepping the log
is not the fix, and pretending it is would be the wrong lesson to build into a problem.

### About the credential in the log

The value the relay presents downstream is derived from `FLAG_SEED`, authenticates
nothing, and never leaves a loopback-bound container. It is written into the log on
purpose, because "the log already had it in it" is exactly the situation this problem
teaches you to find before somebody else does. Getting it out of the current lines is one
of the four pass conditions.

### What scoring will not do to you

All four checkpoints are read-only. They do not post, do not touch `relay.json`, and do
not move a shard. A wrong answer cannot break your environment and a retried verdict
changes nothing.

### The honesty limit

The verdict is computed inside the container you are running. A participant who edits
`stackstack-base/` in their own checkout and rebuilds the image defeats every check here.
That is true of every container problem in this catalog; `make local` builds from the
pinned `problems/` submodule. Unguessability likewise assumes the platform injects
`FLAG_SEED` — a bare `docker compose up` uses the compose default.

## Scoring

`multi-verify`, four checkpoints, 200 points total (Medium tier). A wrong answer costs 3
/ 2 / 3 / 2 points (10 total). Each checkpoint has two hints: the first is free, the
second costs 20 / 18 / 24 / 18 — opening every hint in the problem costs 80 and still
leaves 120.

## Cost

Zero. Nothing is deployed to a cloud account; the container runs on your machine and is
removed by `make local-down`. The relay, the archive and the counters live entirely in
the container's memory, including the runtime settings override, so tearing down leaves
the repository checkout untouched.

## What carries into the Battle

Honestly, and at the right granularity: the [`stackstack`](../../battles/stackstack)
Battle is a CloudFormation problem scored by `phased-polling`, so no JavaScript module
and no in-process listener crosses that boundary. What transfers is the shape:

- **The health-check condition** — "what is this check actually looking at, and would it
  notice the thing that is currently broken", re-expressed as a target group's health
  check path and matcher.
- **The numbers-then-lines order** — a count narrows it to a component, a log line names
  the instance and the reason. On AWS that is a CloudWatch metric and then a log group.
- **Silence is not health** — a phase scored on observed availability does not care that
  your error rate went to zero because you stopped serving.

This problem does not claim its `/metrics` text or its `relay.json` keys are reused
there; between these two execution models they are not.

## Next

Before this one: [`stackstack-ship`](../stackstack-ship) — getting the same board as far
as the outside. After it, the main event is the [`stackstack`](../../battles/stackstack)
Battle.
