# Fix It Without Taking It Down — StackStack defend

> TenkaCloud Challenge · `challenges/stackstack-defend` · difficulty 3 · ~45–60 min · `multi-verify` scoring

The board is up. It grew a drafts feature while you were not looking, and the drafts
feature is showing people things they are not supposed to see. You cannot take it down:
somebody is writing tomorrow's all-hands announcement on it right now.

It is **AWS-free**: one Docker container on your machine, no cloud account, no
credentials. What it models is an incident you have to fix *while it is being watched* —
ordinary traffic and traffic that must be refused, arriving continuously, both scored
every round.

## What gets deployed

| Where | What |
| --- | --- |
| **Your machine (Docker)** | The shared **StackStack base app** with `SCENARIO=defend` |
| `127.0.0.1:18080/` | The board from `stackstack-onboarding`, unchanged |
| `127.0.0.1:18080/desk` | The drafts desk — the accounts, their tokens, the routes |
| `127.0.0.1:18080/api/drill` | What the continuous traffic actually measured, this round |
| `127.0.0.1:18081` | Loopback `/verify` the TenkaCloud scorer delegates to |
| `127.0.0.1:18080/docs` | The API console — view, change and discard the access policy (`/api/settings`) |

The policy's starting point is mounted read-only; changes go through the API and live only
inside the container. No repository file is ever written. The board's own config
(`/api/config`) is unchanged from onboarding.

The image is built from [`stackstack-base/`](../../stackstack-base), shared by every
StackStack problem. The draft ids, the account tokens and the leaked marker are derived
inside the container from a per-deploy random `FLAG_SEED`; the gate receipts come from a
separate secret generated at boot. No answer is stored in this repository and no two
deploys share one. Both ports are bound to `127.0.0.1` only.

### Honest about the model

There is no cloud here, no WAF, no second host, and **no separate attacker machine**. The
"attack traffic" is a drill inside the same container that sends real HTTP to the same
listener a few times a second. That is not a pretence of a network: it is a traffic
generator, and it is named as one on `/api/drill`.

Two consequences worth stating plainly rather than glossing:

- **Blocking by source address is not modelled and is not tested.** Every probe arrives on
  loopback from the same process, so an address-based answer cannot be expressed here.
  Rather than score a defence that was never tried, this problem gives you the two blunt
  answers that *are* expressible — switching the feature off, and throttling it — and
  measures both of them failing. The real layer-3/7 version is the `rate_limited` gate in
  the [`stackstack`](../../battles/stackstack) Battle, which runs on AWS.
- **The policy file is data, not code.** Nothing you write is imported into the app's
  process. The evaluator belongs to the scenario, and the file is parsed as JSON, so
  there is no path from the artifact you are graded on to the thing doing the grading.

The mapping to what this becomes on AWS:

| Here | Real equivalent |
| --- | --- |
| `access.json` rules | an IAM / Cedar policy, or a row-level-security predicate |
| a rule that names a *relationship* rather than an id | an IAM `Condition` on a principal tag, or `USING (owner_id = current_user)` |
| the drill's normal traffic | your real users, who do not stop while you patch |
| the drill's attack traffic | the `anonymous-spam` probe in the StackStack Battle |
| `GET /posture` gates | the promotion gate you would put in front of the fix |

## Mission

Five checkpoints, 200 points:

| Checkpoint | Points | What it asks |
| --- | --- | --- |
| See for yourself what is leaking out of the drafts | 30 | The value you got out of a draft you should not have been able to open |
| Stop other people's drafts from being readable | 45 | The receipt for the gate that watches forbidden reads |
| Keep every legitimate user working | 45 | The receipt for the gate that watches the four accounts doing their jobs |
| Close the publish path too | 40 | The receipt for the gate that watches forbidden publishes |
| Sign-off: fixed without taking it down | 40 | The sign-off from `GET /posture`, once all five gates are green |

## Steps

1. Start it:

   ```
   make local PROBLEM=stackstack-defend
   ```

2. Open the desk at `http://127.0.0.1:18080/desk`. It lists four accounts and hands you
   the token for three of them. One token is deliberately not there.

3. Use the investigation account and look:

   ```
   curl -s -H "Authorization: Bearer <u-guest token>" http://127.0.0.1:18080/api/drafts | jq
   curl -s -H "Authorization: Bearer <u-guest token>" 'http://127.0.0.1:18080/api/draft?id=<id>' | jq
   ```

   Note what comes back that should not. The first checkpoint scores having actually done
   this, not having worked out what the answer would be.

4. Read the rule you are being graded against. It is a post on the board, left by the
   predecessor:

   ```
   curl -s http://127.0.0.1:18080/api/board | jq -r '.posts[] | select(.seeded) | .body'
   ```

5. Watch what is being measured:

   ```
   curl -s http://127.0.0.1:18080/api/drill | jq '{window, cleanForMs, holdMs}'
   curl -s http://127.0.0.1:18080/api/drill | jq '.lastFailures'
   ```

   `lastFailures` reports symptoms — who was stopped, or what got through. It never
   reports the rule that would fix it.

6. Fix the cause.

   ```
   curl -s http://127.0.0.1:18080/api/settings | jq          # the current policy
   # send the change with PATCH /api/settings from the API console (docs)
   ```

   The shapes the evaluator understands are listed under `grammar` in
   `curl -s http://127.0.0.1:18080/api/policy | jq`. A change takes effect on the next
   request — there is nothing to restart, and a change the policy engine refuses comes
   back as a `400` with the reason, leaving everything as it was, rather than a quiet
   fallback to something that works.

7. Then leave it alone and let it run:

   ```
   curl -s http://127.0.0.1:18080/posture | jq
   ```

   ```jsonc
   {
     "gates": {
       "policy_loaded": true,
       "service_intact": true,
       "reads_held": true,
       "publishes_held": true,
       "held_under_load": false
     },
     "tokens": { "reads_held": "TC{...}", "...": "..." },
     "ready": false,
     "readyToken": null
   }
   ```

   The last gate is time: **60 seconds by default** with no bad round anywhere.
   `curl -s http://127.0.0.1:18080/api/drill | jq '{cleanForMs, holdMs}'` shows how much is
   left. One bad round sets it back to zero.

8. To get back to the original broken state, discard your changes:

   ```
   curl -s -X DELETE http://127.0.0.1:18080/api/settings
   ```

   If you fixed the policy before reproducing the leak, this is also how you get the first
   checkpoint back: discard, reproduce, then re-apply your fix. Rebuilding the container
   resets to the same state.

## The surfaces this problem adds

| Route | Purpose |
| --- | --- |
| `GET /desk` | The drafts desk, as a page: accounts, tokens, drafts, routes |
| `GET /api/drafts` | The drafts this credential is allowed to see |
| `GET /api/draft?id=…` | One draft, with its body |
| `POST /api/drafts` | Write a draft of your own |
| `POST /api/publish?id=…` | Put a draft on the publication queue |
| `GET /api/published` | The publication queue — titles and owners, never bodies |
| `GET /api/policy` | The policy as loaded right now, plus the grammar it accepts |
| `GET /api/drill` | The rolling measurement: the window, the hold, recent symptoms |

The board's own routes (`GET /`, `/api/board`, `/api/logs`, `/posture`, `/healthz`,
`POST /api/posts`) are unchanged from stackstack-onboarding.

## Why it is built this way

Every blunt answer to "make the attack stop" is available, and every one of them is
measured failing. That is the lesson, not a punishment.

- **Deny everything.** Nothing forbidden gets through, and both attack gates really do go
  green — the app hands out their receipts. Neither receipt is worth a point, because the
  checkpoints behind them require `service_intact` at the same moment, and the four
  accounts have stopped working. "We stopped the attack" is only worth something while the
  service is up.
- **Switch the feature off** (`"enabled": false`). Refusals become `503`, and a `503` is
  not counted as held — the drill separates "the policy decided" from "the feature is
  down". Legitimate traffic dies at the same time. It is a double loss on the scoreboard,
  as it is in production.
- **Throttle it** (`readsPerRound`). `429` is not counted as held either, and the busier
  traffic is the legitimate kind, so turning the limit down far enough to bite an attacker
  bites four working users first.
- **Block the account you saw attacking.** The account doing the reading rotates every
  round, and the account you blocked is also the legitimate reader of its own drafts. You
  lose `service_intact` and keep the leak.
- **Write down the ids you can see and allow exactly those.** The starter hands you the
  whole list in one request, so this is genuinely tempting. New drafts appear every few
  rounds with ids that did not exist when you wrote the table, and the entitled sets drift
  out from under it inside one window. A policy written in terms of the *relationship*
  keeps working without being touched.
- **Fix reads and stop there.** Publishing is scored separately, on purpose: it is the
  half people forget. The publish rule has two conditions, not one.
- **Hard-code the answers.** The ids, the tokens and the marker come from a per-deploy
  `FLAG_SEED`, and the receipts come from a boot secret — they are not even stable across
  a restart of the same container. And the first checkpoint needs the app to have actually
  handed the marker to somebody who should not have had it; knowing the string is not the
  same as having caused it.

### What scoring will not do to you

Nothing about being scored touches your board. Every checkpoint handler reads state and
compares a value; none of them writes a draft, publishes anything, rotates anything, or
changes your policy. A wrong answer cannot break your environment and a retried verdict
cannot do anything twice.

The four receipt checkpoints carry **no wrong-answer penalty**, because the intended loop
is "fix it, wait, check, submit" and charging for the checking would bill you for doing
what the problem asks.

### The honesty limit

The verdict is computed inside the container you are running. A participant who edits
`stackstack-base/` in their own checkout and rebuilds the image defeats every check here.
That is true of every container problem in this catalog; `make local` builds from the
pinned `problems/` submodule.

The drill's cadence, window and hold are ordinary environment variables —
`DEFEND_INTERVAL_MS`, `DEFEND_WINDOW_ROUNDS`, `DEFEND_HOLD_MS` — and this problem's own
test suite uses them to turn minutes into seconds. You can set them too. What they change
is how long you wait; what is required (a completely clean window, and not one bad round
for the whole hold) does not move.

## Scoring

`multi-verify`, five checkpoints, 200 points total (Medium tier). The wrong-answer budget
(10, the tier's 5 %) sits entirely on the first checkpoint; the other four cost nothing to
retry. Each checkpoint has two hints: the first is free, the second costs
14 / 20 / 20 / 18 / 18 — opening every hint in the problem costs 90 and still leaves 110.

## Cost

Zero. Nothing is deployed to a cloud account; the container runs on your machine and is
removed by `make local-down`. Drafts, publications and measurements live entirely in the
container's memory, and policy changes live only inside the container too, so tearing down
leaves nothing behind — your checkout's `git status` stays clean from first request to last.

## What carries into the Battle

The [`stackstack`](../../battles/stackstack) Battle is a CloudFormation problem scored by
`phased-polling`, so no JavaScript and no in-process listener crosses that boundary. What
transfers is the shape:

- **Two numbers, not one** — the Battle's `auth_enabled` gate and its `anonymous-spam`
  attack probe are scored separately from `board_clean`, exactly as `reads_held` and
  `service_intact` are here.
- **The refusal has to come from the decision** — a target group that is unhealthy is not
  the same result as a request that was authenticated and refused, and the Battle counts
  them differently too.
- **The policy is a relationship, not a list** — which is what survives a deploy that
  renames every resource.

## Next

Before this one: [`stackstack-onboarding`](../stackstack-onboarding) — the fifteen-minute
environment check on the same board — and [`stackstack-ship`](../stackstack-ship), which
gets it an entrance. After it, the main event is the
[`stackstack`](../../battles/stackstack) Battle.
