# Your First Request — StackStack chapter 0

> TenkaCloud Challenge · `challenges/stackstack-first-request` · difficulty 1 · ~10 minutes · `multi-verify` scoring

Chapter 0 of the stackstack-route: ten minutes that need zero prior HTTP experience, making the request-response round trip three times. **No AWS.** One Docker container on your own machine is the whole world — no cloud account, no credentials, no bill. Break anything you like; a rebuild puts it back.

There is no puzzle. The goal is to complete three conversations — read, get refused and fix it, write — entirely from the in-browser API console, with your own hands.

## What runs

| where | what |
| --- | --- |
| **your machine (Docker)** | the StackStack family's shared **base app** — a small Node message board |
| `127.0.0.1:18080` | the board (the app you use) |
| `127.0.0.1:18081` | the loopback `/verify` TenkaCloud's scorer delegates to |
| the board's `docs` (API console) | **Try any API** — the three routes of this problem run from here |

The image builds from the shared [`stackstack-base/`](../../stackstack-base) (`SCENARIO=first-request`). The postcard password, the door token, the guestbook receipt and the round-trip token are all derived inside the container from the per-deploy random `FLAG_SEED`, so no answer exists in this repository and no two deploys agree. Both published ports bind to `127.0.0.1` only.

## Mission

Four checkpoints, 25 points each.

| checkpoint | what it asks | where the answer is |
| --- | --- | --- |
| Read the postcard | `token` (`postcard-...`) | the `GET /api/postcard` response |
| Get refused, then fix it | `token` (`TC{door_...}`) | the `GET /api/door` response, with the right `?key=` |
| Sign the guestbook | `receipt` (`TC{guestbook_...}`) | the 201 response of a well-formed `POST /api/guestbook` |
| Prove the full lap | `readyToken` (`TC{ready_...}`) | `GET /posture`, once all three gates are green |

## Steps

1. Start it.

   ```
   make local PROBLEM=stackstack-first-request
   ```

   The same command works in Codespaces; every link on the board is relative, so a forwarded origin works as-is.

2. Log in to the portal with any non-empty key and open the board via the `Web` endpoint. Two posts from the CTO spell out tonight's homework (the three routes). Open the board's `docs`.

3. In **Try any API**, run `GET /api/postcard`. Submit the response's `token` to **Read the postcard**.

4. Run `GET /api/door`. The 400 that comes back tells you the fix in `detail` — change the path to `/api/door?key=<the postcard token>` and send again. Submit the 200 response's `token` to **Get refused, then fix it**.

   If you prefer a terminal, the same trip looks like this (not required):

   ```
   curl -s "http://127.0.0.1:18080/api/door?key=postcard-xxxxxxxxxxxx"
   ```

5. Run `POST /api/guestbook` with a body:

   ```json
   {"name": "you", "message": "hello"}
   ```

   Submit the 201 response's `receipt` to **Sign the guestbook**. A 400's `detail` explains what to fix.

6. Run `GET /posture`.

   ```jsonc
   {
     "gates": {
       "postcard_read": true,
       "door_opened": true,
       "message_left": true
     },
     "ready": true,
     "readyToken": "TC{ready_...}"
   }
   ```

   Submit `readyToken` to **Prove the full lap**. While it is `null`, any false gate is your remaining homework.

## Routes this problem adds

| route | purpose |
| --- | --- |
| `GET /api/postcard` | a read-only round trip; its `token` is the door's password |
| `GET /api/door` | 400 without `?key=` (with the fix attached), 200 and a `token` with the right one |
| `GET /api/guestbook` | the entries so far |
| `POST /api/guestbook` | sign it — 201 and a `receipt` when well-formed, 400 and the reason when not |

The board's own routes (`/api/board`, `/api/logs`, `/posture`, `/docs`, ...) are the same as in [`stackstack-onboarding`](../stackstack-onboarding). No config editing is needed here — the shipped config accepts posts from the start.

Restarting the container resets every gate to false (they are measured, not remembered). Points already earned stay with the portal, but the full-lap token needs all three gates green again.

## Scoring

`multi-verify`. Four checkpoints × 25 points = 100 (Easy tier). Wrong-answer penalties are 1-2 points on the first three, 0 on the full lap. Each checkpoint has two hints: the first costs nothing, the second costs 8.

## Cost

Zero. Nothing is created in any cloud. The container runs on your machine and `make local-down` removes it.

## Next

[`stackstack-onboarding`](../stackstack-onboarding) — the first fifteen minutes: the same board, now including its log and its config.
