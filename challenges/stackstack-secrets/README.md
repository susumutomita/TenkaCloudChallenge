# The Key That Made It Onto the Board — StackStack secrets

> TenkaCloud Challenge · `challenges/stackstack-secrets` · difficulty 3 · ~40 min · `multi-verify` scoring

The board is internal, the nightly digest runs every night, and the second post on the
board contains the operations key in full. Everyone in the company can read it. You cannot
take it down — this board has no delete and is not going to grow one.

That constraint is the problem. Given something you cannot unpublish, what do you change so
that it stops mattering?

It is **AWS-free**: one Docker container on your machine, no cloud account, no credentials.
What it models is a small operations plane — a key store with statuses, a break-glass
credential held out of band, an allow-only policy engine, an audit journal, and one
scheduled job that must not stop.

## What gets deployed

| Where | What |
| --- | --- |
| **Your machine (Docker)** | The shared **StackStack base app** with `SCENARIO=secrets` |
| `127.0.0.1:18080/` | The board, unchanged from onboarding |
| `127.0.0.1:18080/api/ops` | The ops console — keys, action catalogue, policy, digest |
| `127.0.0.1:18081` | Loopback `/verify` the TenkaCloud scorer delegates to |
| `127.0.0.1:18080/docs` | The API console — view, change and discard the ops manifest (`/api/settings`) |

The ops manifest (ops.json — which key the nightly job runs as, and what it may do) starts
from a read-only mount; changes go through the API and live only inside the container. No
repository file is ever written. The board's own config (`/api/config`) is unchanged from
onboarding.

The image is built from [`stackstack-base/`](../../stackstack-base), shared by every
StackStack problem. The leaked key, the break-glass credential, every fingerprint, witness,
revocation receipt and policy digest are derived inside the container from a per-deploy
random `FLAG_SEED`, so **no answer is stored in this repository** and no two deploys share
one. Both ports are bound to `127.0.0.1` only.

### Honest about the model

There is no AWS account here, no IAM, and no CloudTrail. What runs is a few hundred lines of
JavaScript in one process. The mapping, and its limits:

| In the container | Real equivalent |
| --- | --- |
| `ops-legacy`'s secret sitting in a board post | an access key in Slack, a wiki, or a commit |
| the store's `status` and `revocationReceipt` | `aws iam update-access-key --status Inactive` / `delete-access-key` |
| the break-glass value, in the startup output only | root / break-glass credentials, held out of band |
| `grants: ["*"]` | `AdministratorAccess` |
| `grants: ["board:count","digest:publish"]` | a managed policy with only the actions the work needs |
| `GET /api/ops/journal` | CloudTrail data events |
| the nightly digest | a scheduled job that holds a credential |

**Only the lifecycle and the ordering are modelled.** IAM's evaluation rules are not: this
policy language is allow-only `service:action` with a segment-wise `*`, and there is no way
to write a refusal at all — no `Deny`, no condition keys, no resource ARNs. If you read it
as IAM you will over-read it. The two things worth carrying out of it are the order in which
a credential is replaced, and what a wildcard is actually holding.

## Mission

Five checkpoints, 200 points:

| Checkpoint | Points | What it asks |
| --- | --- | --- |
| The ops key the handover left behind | 40 | What the ops API says about the credential on the board |
| The key the nightly digest runs as now | 40 | The fingerprint the nightly job authenticated with |
| The old key no longer opens anything | 45 | The receipt for closing the credential that was published |
| What the ops key can do | 45 | The receipt for the gate that watches the policy |
| Sign-off for the handover | 30 | The handover sign-off from `GET /posture` |

## Steps

1. Start it:

   ```
   make local PROBLEM=stackstack-secrets
   ```

2. Read the board, all the way to the end of the second post:

   ```
   curl -s http://127.0.0.1:18080/api/board | jq -r '.posts[].body'
   ```

3. Open the ops console at `http://127.0.0.1:18080/api/ops` and ask where things stand:

   ```
   curl -s http://127.0.0.1:18080/api/ops/state  | jq
   curl -s http://127.0.0.1:18080/api/ops/policy | jq
   curl -s http://127.0.0.1:18080/posture        | jq
   ```

   Four of the five gates are red. The one that is green is the one you must not break.

4. Find out whether what is on the board still works. The ops API will tell you who a
   credential belongs to, but only to somebody who can present it:

   ```
   curl -s -H 'X-Ops-Key: SSOPS-…' http://127.0.0.1:18080/api/ops/whoami | jq
   ```

5. Issue a replacement. This is deliberately not something the ops key can do — a
   credential that could mint its own successor would make revoking it a formality. The
   header the console names is checked against a value written once to this container's
   startup output and served on no HTTP surface:

   ```
   docker compose logs | grep break-glass
   curl -sX POST -H 'X-Break-Glass: …' http://127.0.0.1:18080/api/ops/keys | jq
   ```

   The secret comes back in that one response and nowhere else, ever.

6. Cut the nightly job over. Which key it runs as is decided by the ops manifest:
   `GET /api/settings` returns what is loaded now, and changes are sent with
   `PATCH /api/settings` from the API console (`docs`). `identity` names a key; it never
   holds one, and a value starting with `SSOPS-` is refused through the API too. Send the
   change and run the job:

   ```
   curl -sX POST http://127.0.0.1:18080/api/ops/digest/run | jq
   ```

   There is no scheduling timer in this container. Until you run the job, `/posture` still
   describes the previous state. Scoring runs it too before it decides anything.

7. Close the old credential:

   ```
   curl -sX POST -H 'X-Break-Glass: …' \
     'http://127.0.0.1:18080/api/ops/keys/revoke?keyId=ops-legacy' | jq
   ```

   A `409 would_orphan_service` means the nightly job still depends on that key. That
   guardrail exists so the wrong order costs you a message rather than an outage.

8. Narrow what the ops key can do, to what this board needs and no further. `grants` is an
   allow list; there is nothing to write on the deny side. What the work needs is discovered
   by running it and reading the refusal:

   ```
   curl -sX POST http://127.0.0.1:18080/api/ops/digest/run | jq
   curl -s      http://127.0.0.1:18080/api/ops/journal     | jq '.entries[-4:]'
   ```

9. Check the posture and submit:

   ```
   curl -s http://127.0.0.1:18080/posture | jq
   ```

   ```jsonc
   {
     "gates": {
       "leak_confirmed": true,
       "key_rotated": true,
       "legacy_revoked": true,
       "least_privilege": true,
       "service_intact": true
     },
     "tokens": { "least_privilege": "TC{...}", "...": "..." },
     "ready": true,
     "readyToken": "TC{ready_...}"
   }
   ```

10. Return to the original broken state **after** you have submitted the sign-off, not
    before — discarding early points the job back at a revoked key and turns the gates
    red:

    ```
    curl -s -X DELETE http://127.0.0.1:18080/api/settings
    ```

    Rebuilding the container resets to the same state.

## The surfaces this problem adds

| Route | Purpose |
| --- | --- |
| `GET /api/ops` | The ops console, as a page |
| `GET /api/ops/keys` | The key inventory — ids, fingerprints, statuses. Never a secret |
| `POST /api/ops/keys` | Issue a key (`X-Break-Glass`) |
| `POST /api/ops/keys/revoke?keyId=ops-legacy` | Close a key (`X-Break-Glass`) |
| `GET /api/ops/whoami` | Who a presented credential belongs to (`X-Ops-Key`) |
| `GET /api/ops/policy` | The action catalogue, and what the current configuration permits |
| `POST /api/ops/act?action=…` | Execute one action (`X-Ops-Key`) |
| `POST /api/ops/digest/run` | Run the nightly digest now |
| `GET /api/ops/journal` | Every ops attempt, allowed or refused, by key fingerprint |
| `GET /api/ops/state` | Identity, policy, last digest run, journal size |

The board's own routes (`GET /`, `/api/board`, `/api/logs`, `/posture`, `/healthz`,
`POST /api/posts`) are unchanged from stackstack-onboarding.

## Why it is built this way

- **The leak surface cannot be deleted, on purpose.** Give people a leak they can remove and
  score the removal, and what they take away is "delete the evidence". The board has no
  delete route, so the only move that changes anything is the one that changes the key
  store. *The old key no longer opens anything* is graded by presenting the leaked secret
  again: it must still be **recognised** — `whoami` answers 200 and says `revoked` — and it
  must open nothing. Recognised-but-useless is what revocation means. It is not what
  deletion means.
- **`whoami` still identifies a closed credential.** That is not an oversight. It means you
  can do the work in whatever order you like: close the key first and collect your evidence
  afterwards, and *The ops key the handover left behind* is still answerable.
- **Issuing and revoking are not something the ops key can do.** If the credential you are
  replacing could issue its replacement, revoking it would be theatre — it could mint a new
  one on the way out. The break-glass value is written once to the container's startup
  output and served on no HTTP surface, which is a small model of a credential that lives
  somewhere the running application cannot reach.
- **The revoke route refuses to orphan the job.** `409 would_orphan_service` when you try to
  close the key the nightly job is currently running as. Real IAM will not stop you; the
  point of stopping you once here is that the lesson is the order, not the outage.
- **`grants: ["*"]` genuinely works.** The nightly job runs, everything is green except four
  gates, and you could stop. Narrowing forces you to find out what the job actually needs,
  and the job tells you: when it is refused, it names the action. That loop — run it, read
  the refusal — is how permissions get narrowed everywhere.
- **Every wildcard is too wide, structurally.** Each service prefix that carries an action
  the job needs also carries one it does not: `board:count` beside `board:export`,
  `digest:publish` beside `digest:recipients`. So `board:*` is not one character safer than
  `*`, and *What the ops key can do* probes all of them over real HTTP.
- **Pasting the new secret into `ops.json` is refused.** `identity` names a key and `grants`
  name actions; a value starting with `SSOPS-` is rejected with `secret_in_manifest`. A file
  in your git checkout is exactly the kind of place this whole problem is about, and a
  problem that ended with a fresh credential sitting in one would have taught the opposite
  of what it set out to.
- **Hard-coding the answers does not work.** All five submissions are derived from a
  per-deploy `FLAG_SEED` inside the container, four of them also depend on runtime state,
  the policy language has no deny form to write a list into, and the action catalogue itself
  contains one entry whose name is seed-derived.

### What the shortcuts cost

| Shortcut | Where it falls |
| --- | --- |
| Throw away your copy of the key and call it contained | the key store does not change, so the leaked secret still opens things — and a revocation receipt does not exist to submit |
| Revoke first, cut over later | `409 would_orphan_service`. Stop the job any other way and both `key-rotated` (40) and `key-revoked` (45) lose their correctness precondition |
| Narrow the policy but keep the old key | `least-privilege` (45) passes; `key_rotated` and `legacy_revoked` stay red and the sign-off (30) is never emitted |
| `grants: []`, or stop using the ops API | both absence-shaped checkpoints run the required side first, over real HTTP, and check its observable value |
| `board:*` / `digest:*` / `*:*` | a sensitive sibling under the same prefix answers 200 to the probe |
| Note the `readyToken` down, then revert | the sign-off re-evaluates all five gates at the moment it is answered |

### What scoring will not do to you

Grading runs two kinds of thing: the nightly digest once, which only appends, and real HTTP
probes of actions that read and never write. There is no snapshot and no restore path,
because nothing needing one is on the scoring path. Keys are issued, closed and reconfigured
only when you do it. Probes appear in `GET /api/ops/journal` as `source: "scorer"`, so you
can tell them from your own calls.

### The honesty limit

The verdict is computed inside the container you are running. A participant who edits
`stackstack-base/` in their own checkout and rebuilds the image defeats every check here.
That is true of every container problem in this catalog; `make local` builds from the pinned
`problems/` submodule.

## Scoring

`multi-verify`, five checkpoints, 200 points total (Medium tier). A wrong answer costs 2
points on each checkpoint (10 total). Each checkpoint has two hints: the first is free, the
second costs 18 / 18 / 22 / 22 / 14 — opening every hint in the problem costs 94 and still
leaves 106.

## Cost

Zero. Nothing is deployed to a cloud account; the container runs on your machine and is
removed by `make local-down`. The key store, the journal and the digest archive live
entirely in the container's memory, and manifest changes live only inside the container
too, so tearing down leaves nothing behind — your checkout's `git status` stays clean from
first request to last. Restarting the container resets the key store and the board, and
the leaked key and the break-glass value are seed-derived, so the same steps take you back
to the same place.

## What carries into the Battle

Honestly, and at the right granularity: the [`stackstack`](../../battles/stackstack) Battle
is a CloudFormation problem, so no JavaScript module from here crosses that boundary. What
transfers is the shape:

- **The scored fact** — "the credential that was published opens nothing", re-expressed as
  an access key whose status is `Inactive` while the workload keeps running.
- **The ordering** — issue, cut over, revoke, with the job that depends on the credential
  never down; the same sequence, against real IAM.
- **The narrowing loop** — run the work, read what it was refused, grant exactly that.

## Next

Before this one: [`stackstack-onboarding`](../stackstack-onboarding) — the fifteen-minute
environment check on the same board — and [`stackstack-ship`](../stackstack-ship), which
puts it behind a public entrance.
