# Fix It Without Rolling It Back — StackStack recover

> TenkaCloud Challenge · `challenges/stackstack-recover` · difficulty 3 · ~40 min · `multi-verify` scoring

Day three, 9:12 in the morning. Last night's deploy was supposed to make the board
production-grade: a token in front of writes, and the app's write permission narrowed
to only what it needs. The deploy went through. Nobody worked late.

This morning the public entrance returns 401, the monitor says unhealthy, and a
scheduled job has not written anything since 23:40. The CTO's instruction is one line:
*"I did not say roll it back."*

It is **AWS-free**: one Docker container on your machine, no cloud account, no
credentials.

## What gets deployed

| Where | What |
| --- | --- |
| **Your machine (Docker)** | The shared **StackStack base app** — the same message board as `stackstack-onboarding` |
| `127.0.0.1:18080/ops` | The ops plane — a separate plane from the entrance, so it answers even while the entrance does not |
| `127.0.0.1:18080/edge/*` | The public entrance in front of the board |
| `127.0.0.1:18081` | Loopback `/verify` the TenkaCloud scorer delegates to |
| `problems/challenges/stackstack-recover/local/policy/policy.json` | **The file last night's deploy edited.** Yours, mounted read-only, re-read on every request |
| `problems/challenges/stackstack-recover/local/config/app.json` | The board's own config, unchanged from the previous problems |
| `problems/challenges/stackstack-recover/local/state/` | Where the scheduled job writes, if the policy lets it |

The image is built from [`stackstack-base/`](../../stackstack-base). The incident
signature is derived inside the container from a per-deploy random `FLAG_SEED`, so no
answer is stored in this repository and no two deploys share one. Both ports are bound
to `127.0.0.1` only.

## What is a model, and what is real

There is no load balancer here, no IAM, and no cloud account. Everything is inside one
process, and the READMEs would rather say so than imply otherwise.

| In this container | Real equivalent | What is **not** claimed |
| --- | --- | --- |
| `/edge/*` | what sits in front of an ALB / CloudFront | not a separate network — a second surface in the same process |
| the watchdog (real HTTP to `/edge/healthz`) | a target group health check | threshold of one; flapping is not modelled |
| draining (public paths answer 503) | an unhealthy target taken out of service | not real connection draining |
| `storage.writable` | narrowing an IAM `Resource` | **not an OS permission** — neither file modes nor IAM |
| `/ops/*` | the AWS console / an operations VPN | it has no authentication; in local play only you can reach it |

`storage.writable` is a declarative allow-list the app checks *before* it writes, which
is what an IAM policy is too. It is not implemented with file modes, for two reasons:
there is no IAM in local play, and a chmod-ed read-only directory is ignored by a CI
runner running as root, so the verification would not reproduce. What is real: the
refusal is a real refusal written to a real log line, the permitted write is a real
write to a real file in your checkout, and widening the allow-list back out is caught.

## Mission

Five checkpoints, 200 points:

| Checkpoint | Points | What it asks |
| --- | --- | --- |
| Name what stopped | 30 | The signature of the set of subsystems that were down when the first incident opened |
| Bring the board back with last night's protection intact | 50 | The `auth_enforced` receipt |
| The scheduled job that stopped writing | 40 | The `digest_ok` receipt |
| How wide the write permission is | 45 | The `scope_narrow` receipt |
| It stays fixed across a restart | 35 | The `survived_restart` receipt |

A receipt appears in `tokens` on `GET /posture` only while its gate is true, and it is
derived from a secret the container generates at boot — not from `FLAG_SEED` — so it is
not forgeable by anything running inside the container. Every checkpoint re-measures at
the moment you answer it, so a receipt you noted earlier stops being accepted the moment
the thing it attests to stops being true.

## Steps

1. Start it:

   ```
   make local PROBLEM=stackstack-recover
   ```

2. Open the ops plane at `http://127.0.0.1:18080/ops`, and look at what it measured:

   ```
   curl -s http://127.0.0.1:18080/ops/status | jq
   ```

   `subsystems` is what the app found when it last looked. `probe` is the raw evidence:
   what a monitor got back, what an anonymous reader got back, what an anonymous write
   got back, and what an authorised write got back.

3. Read the container's own log. It has been talking since boot:

   ```
   docker compose logs
   # or: curl -s http://127.0.0.1:18080/api/logs | jq -r '.lines[].message'
   ```

4. `GET /ops/incident?id=inc-1` replays what the app observed for each of the six
   subsystems at the moment the first incident opened. Work out which of them were down
   *then*, and have the ops plane compute that set's value:

   ```
   curl -s 'http://127.0.0.1:18080/ops/signature?subsystems=<name>,<name>' | jq -r .signature
   ```

   Submit that for **Name what stopped**. The oracle answers for any set you hand it,
   including sets that were never down — it is a calculator, not a hint.

5. Fix the policy. It is one file in your checkout (paths below are relative to your
   TenkaCloud checkout, where this catalog is the `problems/` submodule):

   ```jsonc
   // problems/challenges/stackstack-recover/local/policy/policy.json
   {
     "auth": {
       "requireToken": true,
       "token": "night-deploy-4f2a",
       "protect": ["/"]            // ← path prefixes that require a token
     },
     "storage": {
       "writable": ["/app/state/quarantine"]   // ← prefixes the app may write under
     },
     "digest": { "enabled": true }
   }
   ```

   Nothing to restart: the app re-reads it on every request. After a save, take a fresh
   measurement — `curl -sX POST http://127.0.0.1:18080/ops/probe` — and read
   `GET /posture` again.

   **Paths in `storage.writable` are the paths inside the container**, not the ones in
   your checkout. The job writes `/app/state/digest/latest.json`, which shows up in your
   checkout as `problems/challenges/stackstack-recover/local/state/digest/latest.json`.
   `GET /ops/digest` prints both.

6. When `GET /posture` shows five green gates, submit each gate's entry from `tokens`.
   `survived_restart` needs one more thing than the others — the ops plane's restart
   ledger says what.

   ```jsonc
   {
     "gates": {
       "service_restored": true,
       "auth_enforced": true,
       "digest_ok": true,
       "scope_narrow": true,
       "survived_restart": true
     },
     "tokens": {
       "service_restored": "TC{service_restored_...}",
       "auth_enforced": "TC{auth_enforced_...}",
       "...": "..."
     }
   }
   ```

## The surfaces

| Route | Purpose |
| --- | --- |
| `GET /ops` | The ops console: gates, subsystem names, the policy's shape |
| `GET /ops/status` | Everything measured. **Takes a fresh measurement when you call it** |
| `POST /ops/probe` | Measure now, and return the same payload |
| `GET /ops/incident?id=inc-1` | What the app observed when that incident opened |
| `GET /ops/signature?subsystems=a,b` | That set's signature. Order- and duplicate-insensitive |
| `GET /ops/digest` | The scheduled job: its output path, and why the last run went the way it did |
| `POST /ops/digest/run` | Run the job once, now |
| `POST /ops/restart` | Restart the worker |
| `GET /edge/healthz` | What the watchdog calls |
| `GET /edge/board` | The public read path |
| `POST /edge/posts` | The public write path |
| `GET /`, `/api/board`, `/api/logs`, `/posture`, `/healthz`, `POST /api/posts` | The board itself, unchanged from the earlier problems |

## Things that look like fixes and are not

| Shortcut | Where it falls over |
| --- | --- |
| Restart the worker | The policy is re-read from disk. The same failure replays, and the ledger keeps an `afterOk: false` entry for every attempt |
| `auth.requireToken: false` | An anonymous write goes through, `edge-auth` shows up as down, and the board checkpoint fails |
| `auth.protect: []` | The same. Protecting zero paths behaves exactly like having no authentication, and this is judged on behaviour |
| Blank the token, or set it to `change-me` | The board checkpoint also checks the token is a real one |
| `acceptingPosts: false` | An authorised write returns 409 instead of 201. "Legitimate users can write" is a precondition for "anonymous users cannot" |
| `digest.enabled: false` | The failing log line stops, and so does any successful run. Two checkpoints fail |
| `storage.writable: ["/"]` (or `/app`, or `/app/state`) | The job succeeds — and the allow-list now admits paths it should never have |
| Write `state/digest/latest.json` by hand | The verdict runs the job again and measures it live, and the submission is a receipt that is not in that file |
| Note a receipt early, then revert the setting | Every checkpoint re-measures before comparing |

## Why the recovery time is reported but not scored

`GET /ops/status` publishes `recovery.elapsedSeconds`, `recoveredAfterSeconds` and a
budget, and none of it feeds into any verdict. In local play `make local-down && make
local` resets the clock, so scoring it would reward re-racking the container rather than
recovering the service. Treat the clock as a rehearsal signal: the deliverable is a
runbook you can execute inside the window, not a fast first attempt.

## Scoring

`multi-verify`, five checkpoints, 200 total (Medium tier). A wrong answer costs 2 on any
checkpoint. Each checkpoint has two hints: the first is free and names only where to
look; the second costs 12–22 and names the edit. Opening all ten costs 88 of 200.

## Cost

Zero. Nothing is deployed to a cloud account; the container runs on your machine and is
removed by `make local-down`. The scheduled job writes one file into
`local/state/digest/`, which is ignored by git.

## Next

The main event is the [`stackstack`](../../battles/stackstack) Battle: the same board,
defended while it is under attack.
