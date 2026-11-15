# Inspecting the Document Shelf — Walk the Route, Then Prove the Fix

> TenkaCloud Challenge · `challenges/php-attachment-viewer-lab` · difficulty 3 · ~60 min · `multi-verify` scoring (5 checkpoints, 200 pts) · status `draft`

A local-only attack-then-fix lab in the same shape as
[`wp2shell-local-lab`](../wp2shell-local-lab/): a from-scratch app, stage 1 attacks it,
stage 2 fixes it through settings, and every stage-2 checkpoint is decided by re-probing the
live app. A security vendor's advisory says the staff portal's document viewer can reach
files outside the document shelf. Before anyone touches production, the SRE reproduces it in
a disposable lab with the same layout, closes it, cleans up the aftermath and proves the
original trick now fails.

**Everything here is a from-scratch simulator.** The portal is one small PHP file on the
official `php:8` CLI image (pinned by digest). It is not a real CMS, vendors no real
product's code and copies no specific CVE. The single planted flaw is that the viewer joins
an untrusted name onto the shelf path without checking where the result points.

## Participant experience

| | |
| --- | --- |
| Role | SRE on call for a 12-person company's staff portal |
| First symptom | A vendor advisory: "the document viewer has a route outside the shelf". `manual.txt` on the shelf describes the layout: `attachments/` is the shelf, `private/config.ini` next to it holds the audit token. |
| First move | Open `/attachment?file=manual.txt`, then change the `file` value. |
| Success looks like | Stage 1: the private settings file appears in the viewer with `audit_token = "TC{...}"`, and that token opens `/internal/audit`, which shows an account nobody created. Stage 2: the same names now return 403, `manual.txt` still opens, the account is gone, the leaked token returns 401. |

## The two stages

| | Stage 1 — attack | Stage 2 — defend |
| --- | --- | --- |
| Starting point | Unauthenticated | Holding the SRE console token (shown openly at `/admin`, lab convenience) |
| What you do | Make the viewer open a file outside the shelf and read the audit token | Switch the viewer's path policy, remove the leftover account, re-issue the audit token, replay the attack, confirm normal reading still works |
| Proof | A string you found | The **live app state**, re-probed by the verifier — never a submitted trivia value |

**Order matters.** The `realpath` policy closes the only route to the stage-1 passphrase, so
finish stage 1 first.

## Checkpoints (multi-verify, 200 pts)

| Checkpoint | What it proves (what the verifier actually does) | Points |
| --- | --- | ---: |
| `read-outside` | The submitted `TC{...}` equals the audit token derived from `FLAG_SEED`. | 50 |
| `fix-viewer` | Five spellings of "climb out of the shelf" (`../`, `....//`, `./../`, `../../app/`, `..\/`) are sent to the live viewer; none may return 200 or the private file's `audit_token =` line, and `manual.txt` must still return 200 with its content. | 50 |
| `cleanup-leftover` | `/admin/audit` reports the leftover account gone **and** `/internal/audit` (with the current token) no longer lists `svc-backup`. | 30 |
| `rotate-token` | The token version is ≥ 1, the version-0 token (the stage-1 flag) gets 401 at `/internal/audit`, and the current token gets 200. | 30 |
| `site-healthy` | `/`, `/documents`, `/attachment?file=manual.txt` and `/admin` all return 200 with expected content. | 40 |

`fix-viewer` is the ceiling. The console offers three `pathPolicy` values: `none` (the
starting state), `strip-dotdot` (deletes `../` once — a tempting patch that `....//` walks
past) and `realpath` (resolve the joined path, then require it to sit inside the shelf). The
verifier never reads the chosen value; only `realpath` survives its replay. Hints climb from
the mechanism (`..` means one folder up) to a worked example on a small path to the exact
command, and every penalty sum is at or under the SCORING.md ceiling (99 of 100).

## What gets deployed

Two containers from one Dockerfile, two loopback ports, no database, no other services:

| Where | What |
| --- | --- |
| `surface` · `127.0.0.1:18080` | `php:8.4.27-cli-alpine` (digest-pinned) running PHP's built-in server with `public/index.php` as the router. Portal home, `/documents`, the viewer `/attachment`, `/internal/audit`, the SRE console `/admin/*`. Runs as `www-data`, read-only root filesystem, `/app/private` and `/app/state` are tmpfs. |
| `verifier` · `127.0.0.1:18081` | `node:22` (digest-pinned) running `verify/server.mjs`. Reaches the surface as `http://surface:8080` over the compose network. Runs as `node`, read-only. |

The two share only `FLAG_SEED`. On start, `bin/bootstrap.php` writes the console state and
`private/config.ini` (whose `audit_token` is the stage-1 flag) into the surface's tmpfs. The
verifier derives the same flag and the console token from the seed, so no file, volume or
process is shared and the participant image contains nothing secret.

## Participant route (what I ran, against the compose stack)

```sh
BASE=http://127.0.0.1:18080
curl "$BASE/"                                   # shelf listing + viewer URL shape
curl "$BASE/attachment?file=manual.txt"         # layout: attachments/ vs private/config.ini
curl -g "$BASE/attachment?file=../private/config.ini"   # 200; audit_token = "TC{escape_...}"
curl -g "$BASE/internal/audit?token=TC{escape_...}"      # accounts incl. svc-backup (admin)
curl "$BASE/admin"                              # console token + actions
H="Authorization: Bearer <console token>"
curl -X POST "$BASE/admin/action" -H "$H" -d '{"action":"set-config","pathPolicy":"strip-dotdot"}'
curl -g -o /dev/null -w '%{http_code}\n' "$BASE/attachment?file=../private/config.ini"      # 404
curl -g -o /dev/null -w '%{http_code}\n' "$BASE/attachment?file=....//private/config.ini"   # 200 (still leaks)
curl -X POST "$BASE/admin/action" -H "$H" -d '{"action":"set-config","pathPolicy":"realpath"}'
#   -> both spellings 403, manual.txt 200
curl -X POST "$BASE/admin/action" -H "$H" -d '{"action":"remove-leftover-account"}'
curl -X POST "$BASE/admin/action" -H "$H" -d '{"action":"rotate-audit-token"}'   # old token -> 401
```

Submitting each checkpoint to `POST 127.0.0.1:18081/verify` with
`{"checkpointId":"...","submission":"..."}` returned `correct: true` in that order:
`read-outside` (the flag), `fix-viewer` only after `realpath` (false under `none` and under
`strip-dotdot`), `cleanup-leftover`, `rotate-token`, `site-healthy`. `curl -g` matters: without
it curl's URL globbing strips the braces from `TC{...}`.

## Safety boundary

- **No execution, no outbound calls.** The PHP app never calls `exec`, `system`,
  `shell_exec`, `passthru`, `popen`, `proc_open`, `eval`, `curl_init`, `fsockopen` or
  `mail`; the verifier never imports `child_process`. `tests/boundary.test.mjs` greps the
  shipped source for all of them.
- **Loopback only.** Both published ports bind to `127.0.0.1`. The compose test asserts it.
- **Non-root, read-only, no capabilities.** `USER www-data` / `USER node`, `read_only: true`,
  `cap_drop: [ALL]`, `no-new-privileges`, no host bind mounts, no `docker.sock`. Verified on
  the running container: `id` → uid 82, `touch /app/x` → read-only file system.
- **No default seed.** `${FLAG_SEED:?}` on both services; `docker compose config` fails
  without it. Nothing flag-shaped is committed (asserted by the boundary test).
- **Participant surface and verifier authority are separate containers.** The verifier's
  only input from the participant is the HTTP behaviour of the surface.
- **The flaw is contained.** The viewer reads files; it never writes, lists arbitrary
  directories or executes. The private file holds only a lab token derived from the seed.

## Cost-bearing resources

None. Everything runs on the participant's own machine under Docker. No cloud account,
Region or paid service is involved; session length is bounded only by the participant.

## Teardown

```sh
docker compose -p php-attachment-viewer-lab -f local/docker-compose.yml down --volumes --rmi local
```

(or `make down` from this directory). The tmpfs state disappears with the containers.

## Local verification

Problem tests (needs `php` on PATH and `make install` at the repository root):

```sh
cd challenges/php-attachment-viewer-lab
make test            # node --test tests/*.test.mjs
```

`tests/lab.test.mjs` runs the real portal (`php -S`) and the real verifier on free loopback
ports and checks: stage 1 succeeds in the starting state; `/verify` echoes `checkpointId`;
wrong and failed submissions never carry the seed, the flag, the console token or any
`TC{` value; `strip-dotdot` is bypassed by `....//` so `fix-viewer` stays false; `realpath`
refuses all five spellings while `manual.txt` still opens; cleanup and rotation are judged
live and the old token gets 401. `tests/boundary.test.mjs` holds the safety boundary above.
Result on this branch: 12 passed, 0 failed.

Full stack:

```sh
export FLAG_SEED="$(openssl rand -hex 32)"
docker compose -p php-attachment-viewer-lab -f local/docker-compose.yml up --build -d --wait
```

Both containers reach `healthy`; the route above then passes every checkpoint. The root
gate `make agent-gate` (schema, bilingual READMEs, cross-references, scoring regulation)
passes with this problem included.

What was not run: a TenkaCloud `make local` session with this problem selected (the compose
file follows the same contract as the other `docker`/`compose` problems in the catalog, but
end-to-end play through the TenkaCloud portal is an event rehearsal, not a merge gate).
