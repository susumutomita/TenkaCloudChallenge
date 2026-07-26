# As Far As the Outside — StackStack ship

> TenkaCloud Challenge · `challenges/stackstack-ship` · difficulty 3 · ~45 min · `multi-verify` scoring

The board works. Only from inside the ops console. This is the problem where it stops
being a thing on your laptop and starts being a thing with an entrance.

It is **AWS-free**: one Docker container on your machine, no cloud account, no
credentials. What it models is a release plane — an artifact registry, a manifest, a
staged pipeline with a health gate, a live-release pointer, and a published surface that
only answers while something is actually deployed.

## What gets deployed

| Where | What |
| --- | --- |
| **Your machine (Docker)** | The shared **StackStack base app** with `SCENARIO=ship` |
| `127.0.0.1:18080/shipyard` | The ops console — registry, releases, deploy log, secret store |
| `127.0.0.1:18080/site` | The published entrance — what the outside gets |
| `127.0.0.1:18081` | Loopback `/verify` the TenkaCloud scorer delegates to |
| `problems/challenges/stackstack-ship/local/release/release.json` | The release manifest — **your** file, mounted read-only |
| `problems/challenges/stackstack-ship/local/config/app.json` | The board's own config, unchanged from onboarding |

The image is built from [`stackstack-base/`](../../stackstack-base), shared by every
StackStack problem. The artifact id, the public serial, the deploy receipts and the
signing key store are all derived inside the container from a per-deploy random
`FLAG_SEED`, so no answer is stored in this repository and no two deploys share one.
Both ports are bound to `127.0.0.1` only.

### Honest about the model

There is no public URL here, and no second network. `/site` is a **second surface on the
same origin**, served by the same process. What it models is narrow and worth modelling:
*what the ops console shows you and what the public entrance actually returns are
different facts*. Everything else about a real edge — a separate failure domain, TLS, a
CDN — is not modelled and is not claimed.

The mapping to what this becomes on AWS:

| Shipyard | Real equivalent |
| --- | --- |
| artifact registry | ECR / a container registry |
| release + generation | an App Runner or ECS revision |
| `BOARD_SIGNING_KEY: "<value>"` | pasting a secret into an environment variable |
| `BOARD_SIGNING_KEY: {"fromSecret": "..."}` | a Secrets Manager reference |
| `/site` | what sits behind an ALB / CloudFront |
| `GET /posture` gates | the deploy gate you would put in front of a promotion |

## Mission

Five checkpoints, 200 points:

| Checkpoint | Points | What it asks |
| --- | --- | --- |
| Identify what gets shipped | 20 | The id of the artifact this platform has on hand |
| Get one release through | 40 | The receipt from the log line written when a release goes live |
| Change what the outside sees | 40 | The heading the public entrance is serving |
| Survive a key rotation | 60 | The receipt for the gate that watches the next rotation |
| Clean up without an outage | 40 | The cutover sign-off from `GET /posture` |

## Steps

1. Start it:

   ```
   make local PROBLEM=stackstack-ship
   ```

2. Open the ops console at `http://127.0.0.1:18080/shipyard`. There is one artifact in
   the registry, and no release serving it. Ask the public entrance what it thinks:

   ```
   curl -s http://127.0.0.1:18080/site/healthz | jq
   ```

   ```json
   { "error": "no_live_release", "detail": "nothing is deployed at the moment" }
   ```

   The build already happened. The deploy has never happened once. Those are two facts,
   not one.

3. Try to deploy what the predecessor left:

   ```
   curl -sX POST http://127.0.0.1:18080/shipyard/releases | jq '.release.failure'
   ```

   It stops, and it names the stage it stopped at. Fix what that says in

   ```
   problems/challenges/stackstack-ship/local/release/release.json
   ```

   and run it again. Repeat until a release is promoted. There is nothing to restart:
   the manifest is re-read on every deploy call. Six stages run in order —
   `read-manifest`, `resolve-artifact`, `resolve-config`, `start`, `health-gate`,
   `promote` — and a refused deploy answers `422`, not a `5xx`. A refused deploy is a
   normal outcome.

4. When a release goes live, the log carries the line this problem's second checkpoint
   wants:

   ```
   curl -s http://127.0.0.1:18080/api/logs?limit=200 | jq -r '.lines[].message' | grep promote
   ```

5. Look at what the outside is now serving, and make the heading yours:

   ```
   curl -s http://127.0.0.1:18080/site/healthz | jq
   ```

   The heading comes from the release, not from `config/app.json`. Change it in the
   manifest, deploy again, and check what `/site` answers.

6. Production keys get rotated. Rotate this one yourself and see what happens:

   ```
   curl -sX POST http://127.0.0.1:18080/shipyard/secrets/rotate | jq
   curl -s     http://127.0.0.1:18080/site/healthz | jq
   ```

   Whether that was survivable is decided by how the release resolved its signing key,
   which is decided in the manifest.

7. Check the posture and clean up:

   ```
   curl -s http://127.0.0.1:18080/posture | jq
   ```

   ```jsonc
   {
     "gates": {
       "site_serving": true,
       "survives_key_rotation": true,
       "single_release": true
     },
     "tokens": { "survives_key_rotation": "TC{...}", "...": "..." },
     "ready": true,
     "readyToken": "TC{ready_...}"
   }
   ```

   A false gate names your next action. `GET /shipyard/releases` lists every record,
   including the one that was already there when you arrived, and
   `DELETE 'http://127.0.0.1:18080/shipyard/release?id=rel-N'` removes one.

8. Restore your checkout **after** you have submitted the sign-off, not before —
   reverting the manifest and redeploying is fine, but reverting it and leaving the
   plane empty turns the gates red:

   ```
   git -C problems checkout -- challenges/stackstack-ship/local/
   ```

## The surfaces this problem adds

| Route | Purpose |
| --- | --- |
| `GET /shipyard` | The ops console, as a page |
| `GET /shipyard/artifacts` | What has been built |
| `GET /shipyard/releases` | Every release record, with its state and how it bound its key |
| `GET /shipyard/release?id=rel-1` | One record, plus its stage-by-stage transcript |
| `POST /shipyard/releases` | Deploy the manifest as it is on disk right now |
| `DELETE /shipyard/release?id=rel-1` | Remove a record — including the live one |
| `GET /shipyard/secrets` | Names and versions in the platform's store |
| `GET /shipyard/secrets/value?name=…` | Read a secret's value (the read is logged) |
| `POST /shipyard/secrets/rotate` | Rotate a secret to its next version |
| `GET /shipyard/state` | Live release, generation, secret version, site verdict |
| `GET /site` | The published entrance, as a page |
| `GET /site/healthz` | The published entrance's health, with its serial and signature |

The board's own routes (`GET /`, `/api/board`, `/api/logs`, `/posture`, `/healthz`,
`POST /api/posts`) are unchanged from stackstack-onboarding.

## Why it is built this way

The interesting shortcuts all work, right up until they do not. That is the point.

- **Read the signing key's value and paste it into the manifest.** You can — the store
  will hand it over and log that you did, exactly like a real one. The deploy passes,
  the health gate passes, and `/site` answers 200, so *Change what the outside sees*
  is genuinely earnable this way. Then the key rotates, the signature the release
  publishes stops verifying under the key the platform now holds, and the entrance
  returns 503. *Survive a key rotation* (60) and *Clean up without an outage* (40) both
  fail. The shortcut costs half the problem.
- **Rotate first, then paste the fresh value.** The rotation question is answered
  against a dry-run probe epoch — the value the store *would* take one rotation from now
  — so however fresh the copy, it is already a version behind. There is no timing window,
  because nothing about scoring moves the store.
- **Delete every release, so "exactly one release" is satisfied.** Zero is not one, and
  an empty plane means `/site` returns 503. Every checkpoint that reads the sign-off also
  sends a real HTTP request to `/site` and requires a 200, so taking the service down to
  look tidy fails on both counts. Recovery is a redeploy.
- **Leave the failed attempts in place because everything else is green.** The sign-off
  is withheld while more than one record remains — and there is one in the plane before
  you start, so there is always something to remove. The record that survives also has to
  be the live one, so "delete everything except a dead record" is not a shortcut either.
- **Change the heading in `config/app.json`.** The public heading comes only from the
  live release's environment. The board's config decides the board's title; a deploy is
  what carries a setting to the outside.
- **Relax the health gate from the manifest.** There is no health field in the manifest
  to relax. The gate belongs to the platform, and `resolve-config` refuses a key it does
  not know rather than ignoring it.
- **Hard-code the answers.** The artifact id, the public serial, the receipts and the
  signing key store are all derived from a per-deploy `FLAG_SEED` inside the container,
  and the gate receipts are derived from a secret generated at boot — so they are not
  even stable across a restart of the same container.

### What scoring will not do to you

`Survive a key rotation` does not rotate anything. It probes the entrance, asks the plane
whether the live release would still be accepted one rotation from now, and compares the
receipt — nothing moves. A wrong answer cannot break your environment, and a retried
verdict cannot rotate twice. The key moves when, and only when, you rotate it.

### The honesty limit

The verdict is computed inside the container you are running. A participant who edits
`stackstack-base/` in their own checkout and rebuilds the image defeats every check here.
That is true of every container problem in this catalog; `make local` builds from the
pinned `problems/` submodule.

## Scoring

`multi-verify`, five checkpoints, 200 points total (Medium tier). A wrong answer costs 2
points on each checkpoint (10 total). Each checkpoint has two hints: the first is free,
the second costs 8 / 16 / 16 / 28 / 16 — opening every hint in the problem costs 84 and
still leaves 116.

## Cost

Zero. Nothing is deployed to a cloud account; the container runs on your machine and is
removed by `make local-down`. The release plane lives entirely in the container's memory,
so tearing down leaves nothing behind except the two files in your own checkout, which
`git -C problems checkout -- challenges/stackstack-ship/local/` restores.

## What carries into the Battle

Honestly, and at the right granularity: the [`stackstack`](../../battles/stackstack)
Battle is a CloudFormation problem scored by `phased-polling`, so no JavaScript module and
no in-process listener crosses that boundary. What transfers is the shape:

- **The scored fact** — "an externally observed 200", re-expressed as an ALB target group
  reporting healthy rather than as a deploy record saying the deploy succeeded.
- **The rotation predicate** — "would this survive the next rotation", re-expressed as a
  task definition that references a Secrets Manager ARN rather than carrying a pasted
  environment variable, which `DescribeTaskDefinition` can answer without breaking
  anything.
- **The gate shape** — a promotion gate that measures the running system instead of
  reading a claim, which is what `GET /posture` is a small model of.

## Next

Before this one: [`stackstack-onboarding`](../stackstack-onboarding) — the fifteen-minute
environment check on the same board. After it, the main event is the
[`stackstack`](../../battles/stackstack) Battle.
