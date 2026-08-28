# The First Fifteen Minutes — StackStack onboarding

> TenkaCloud Challenge · `challenges/stackstack-onboarding` · difficulty 1 · ~15 min · `multi-verify` scoring

The shakedown you run before StackStack. It is **AWS-free**: one Docker container on
your machine, no cloud account, no credentials. Nothing in it is a puzzle. Its job is
to walk one full lap of the tools — portal, app, log, settings, scoring — so that
when the real event starts, none of that is new.

It doubles as an environment diagnostic. `GET /posture` reports four gates measured
from the running app, and only hands out its sign-off token once all four are green,
so "this environment works end to end" is a machine-readable fact rather than a hope.

## What gets deployed

| Where | What |
| --- | --- |
| **Your machine (Docker)** | The shared **StackStack base app** — a small Node message board |
| `127.0.0.1:18080` | The board (the app you use) |
| `127.0.0.1:18081` | Loopback `/verify` the TenkaCloud scorer delegates to |
| The board's `docs` (API console) | View, change and reset the app's settings — no repository file is ever touched |

The image is built from [`runtimes/stackstack/`](../../runtimes/stackstack), which every problem
in the StackStack family shares. The board serial, the boot-check value, and the sign-off
token are all derived inside the container from a per-deploy random `FLAG_SEED`, so no
answer is stored in this repository and no two deploys share one. Both ports are bound to
`127.0.0.1` only.

## Mission

Four checkpoints, 25 points each:

| Checkpoint | What it asks | Where the answer lives |
| --- | --- | --- |
| Reach the board | The board's serial | printed on the board |
| Read the app's log | The value in the boot log line | `GET /api/logs` |
| Open the board for posts | The title of a message you posted | you choose it |
| Sign-off | The environment sign-off token | `GET /posture`, once every gate is green |

## Steps

1. Start it:

   ```
   make local PROBLEM=stackstack-onboarding
   ```

   In a Codespace the same command works — the portal forwards the ports for you, and
   every link on the board is relative so it survives the forwarded origin.

2. Log in to the portal with any non-empty key, and open the `Web` endpoint. The board
   prints its serial near the top:

   ```
   board serial: SS-1a2b3c4d
   ```

   Submit that (`SS-` included) for **Reach the board**.

3. Read the app's own log:

   ```
   curl -s http://127.0.0.1:18080/api/logs | jq -r '.lines[].message'
   ```

   One of the boot lines reads `boot ok boot-check=<value>`. Submit just the value for
   **Read the app's log**. `docker compose logs` shows the same lines.

4. The board is not accepting posts yet, and says so on its own page. Open it through the
   board's API console (`docs`) — **never by editing a repository file**.

   ```
   curl -X PATCH http://127.0.0.1:18080/api/config \
     -H 'content-type: application/json' \
     -d '{"acceptingPosts": true}'
   ```

   No restart needed; the change lives only inside the container, so your checkout stays
   clean. Then post for real.

5. Check the posture:

   ```
   curl -s http://127.0.0.1:18080/posture | jq
   ```

   ```jsonc
   {
     "gates": {
       "board_visited": true,
       "logs_read": true,
       "posts_open": true,
       "post_created": true
     },
     "ready": true,
     "readyToken": "TC{ready_...}"
   }
   ```

   Submit `readyToken` for **Sign-off**. If it is still `null`, the false gate names your
   next action.

6. Reset **after** you have submitted the sign-off, not before: closing the board flips
   `posts_open` back to false and the token stops verifying. Resetting is an API call too —
   it discards every change and returns to the initial state.

   ```
   curl -X DELETE http://127.0.0.1:18080/api/config
   ```

## The board's routes

| Route | Purpose |
| --- | --- |
| `GET /` | The board, as a page |
| `GET /api/board` | Title, serial, whether posts are open, and every post |
| `GET /api/logs` | The app's recent log lines (`?limit=` to widen) |
| `GET /posture` | The four measured gates, and the sign-off token once they are green |
| `GET /healthz` | Liveness, plus the config error if there is one |
| `GET /docs` | The API console — run every route on this list from the screen |
| `GET/PATCH/DELETE /api/config` | View, change and reset the settings |

Restarting the container starts the environment check over: the gates are measured from the
running app, so a restart clears them and takes your posts with them. Checkpoints you have
already been credited for stay credited — the portal holds those — but the sign-off needs the
four gates green again.
| `POST /api/posts` | Post a message — `409` while the board is closed |

## Why measured, not claimed

Flipping `acceptingPosts` to `true` is not enough on its own. The checkpoint also requires
that a post actually went through and now exists. Configuration and behavior drift apart
in real systems — "the auth we enabled isn't actually enforcing" is exactly this shape —
so the thing worth checking is the outcome, not the setting. Every StackStack gate is
built this way, including the ones on AWS.

If you break the JSON while editing, nothing hides it: `GET /healthz` returns `503` with
the parse error, and the same error appears in `/api/logs`.

## Scoring

`multi-verify`, four checkpoints of 25 points, 100 total (Easy tier). Wrong answers cost
1–2 points on the first three checkpoints and nothing on the sign-off. Each checkpoint has
two hints: the first is free, the second costs 8.

## Cost

Zero. Nothing is deployed to a cloud account; the container runs on your machine and is
removed by `make local-down`.

## Next

The main event is the [`stackstack`](../../battles/stackstack) Battle: the same board,
taken to production quality — data restore, auth, rate limiting, audit, a database
migration — with failures fired at you while you work.
