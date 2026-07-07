# The Successor's Cleanup — Close Every Leak Until the Scan Is Clean

> TenkaCloud Challenge · `challenges/wp-harden-leaks` · difficulty 3 · ~40 min · `multi-verify` scoring (4 checkpoints, 200 pts)

The **remediation** companion to [`wp-exposed-backup`](../wp-exposed-backup/) (The
Predecessor's Leftovers). Same Aoi Corp WordPress site, same real, current WordPress +
MariaDB in an isolated Docker stack — but this time you are not *finding* the leaks, you
are **closing** them. You inherit an already-leaky site and harden it until an external
scanner reports it clean.

The point, again, is not a code vulnerability: the software is fine, the *operations* are
what leak. And fixing operations means deleting files and turning settings off — not
writing code. One of the four holes is designed to teach the difference between treating
a **symptom** and fixing the **cause**.

## What is different from the discovery problem

| | Discovery (`wp-exposed-backup`) | Remediation (this problem) |
| --- | --- | --- |
| Your job | *Find* each leftover, read a passphrase | *Close* each leak so it is unreachable |
| How it is judged | You submit the passphrase (string match) | An **external scanner** HTTP-probes the live site; a checkpoint clears only when the surface is genuinely gone |
| Can you fake it? | — | No. There is no flag to submit; the site's real behaviour is the proof |
| The twist | — | One hole **regenerates** if you only delete the file |

## Checkpoints (multi-verify)

Close each hole from inside the container; the scanner re-checks by probing the running
site. Re-scan as often as you like — there is no penalty for an unclosed re-check.

| Checkpoint | Close it so that… | Points |
| --- | --- | ---: |
| `close-backup` | `GET /wp-content/backups/db-backup.sql` no longer serves the DB dump. | 40 |
| `close-config` | `GET /wp-config.php.bak` no longer serves the config copy as text. | 40 |
| `close-listing` | `GET /internal/` no longer produces an Apache directory listing. | 50 |
| `close-debug` | `GET /wp-content/debug.log` stays gone — **even after the site is hit again**. | 70 |

`close-debug` is worth the most on purpose: deleting `wp-content/debug.log` does **not**
close it, because `WP_DEBUG` is left on and the log is rewritten on the next request. Stop
the source (turn the debug setting off), *then* remove the file.

## What gets deployed

| Where | What |
| --- | --- |
| **Your machine (Docker)** | A real WordPress + MariaDB + a loopback scorer — the problem runtime |
| `127.0.0.1:18080` | Challenge surface (the running WordPress site) |
| `127.0.0.1:18081` | Loopback `/verify` the TenkaCloud scorer delegates to (the external scanner) |

Four containers on a private compose network, nothing published except the two loopback
ports:

- **`db`** — real MariaDB, dummy data only.
- **`wordpress`** — real, current WordPress (Apache + PHP). A wrapper entrypoint plants the
  four leftovers (and a must-use plugin that regenerates `debug.log` while debug logging is
  on) into the docroot *before* Apache starts, so the site is already leaky the instant it
  is reachable.
- **`wpinit`** — one-shot WP-CLI that installs WordPress and seeds a little content.
- **`verify`** — the loopback **scanner**: for each checkpoint it fetches
  `http://wordpress/…` over the compose network and judges the hole closed by the live
  response. It holds no answer and no flag; the site's real behaviour is the only proof.

Nothing is exposed off loopback, and `docker compose down -v` (or `make local-down`)
returns everything to the clean initial (leaky) state.

## The story

You have taken over running Aoi Corp's WordPress site. It runs normally. But during the
migration, the previous operator left several files and settings in the public web root
"just for testing" / "to delete later" and forgot them — so data, DB credentials, and
internal notes are readable from the outside. Your job is to close each hole the way a
real operator would, and prove the site is clean.

## Steps

1. `make local PROBLEM=wp-harden-leaks` starts the stack, the scoring API, and the portal.
   (First run pulls the WordPress / MariaDB images and installs WordPress — give it a
   minute.)
2. Log in to the portal with any non-empty key. You will see four checkpoints.
3. Enter the server: `docker compose exec wordpress bash` (the docroot is
   `/var/www/html`). Compare what is reachable from outside (`http://127.0.0.1:18080/`,
   `robots.txt`, `/internal/`, …) with what is on disk, and close each hole.
4. For each checkpoint, submit any trigger (e.g. `done`) to re-scan. Closed → you score;
   still open → "still reachable from the outside". Stuck? Open a checkpoint's hints (the
   first is free; they go from approach to the exact command).

## The root-cause fix (why each is a bug)

Nobody exploited WordPress. The fixes are all operational, and none of them touch code:

- **`close-backup` →** delete the `.sql` dump from the web root; never place backups where
  the web server can serve them.
- **`close-config` →** delete the `.bak` editor copy; it is served as text and leaks
  credentials. Rotate anything that was exposed.
- **`close-listing` →** disable Apache directory listing (`a2disconf` the scoped
  `Options +Indexes`, or add an `index.html`, or remove the folder).
- **`close-debug` →** turn `WP_DEBUG` **off** in `wp-config.php` first, then delete
  `wp-content/debug.log`. Deleting the file while logging is on just lets it regenerate —
  fix the cause, not the symptom.

**Scoring boundary:** the four checkpoints are scored independently and the *container*
(the scanner) decides `correct` for each by probing the live site (`POST /verify` echoes
the `checkpointId`). The platform holds only the point values from `metadata.json` and
never receives an answer or a point value from the container — so a buggy or hostile
container can never award itself points. A running-fine site is not a safe site; what is
*reachable* is what matters.

## Learning goals

- Making a running site safe is operational remediation — deleting unneeded files and
  turning settings off — not writing code.
- Some holes do not close by deleting the file: a symptom (the log) returns until you stop
  the cause (the debug setting). The scanner proves the difference.
- Inventorying public folders, disabling directory listing, and stopping debug output are
  the basic, code-free controls.

## Cost

Local Docker only. No AWS resources are created (free). First run pulls the WordPress and
MariaDB images.

## Related files

- `local/docker-compose.yml` — the four-container isolated stack.
- `local/wordpress/` — the real WordPress image + the wrapper that plants the four leaks
  and the `debug.log`-regenerating mu-plugin.
- `local/wpinit/init.sh` — one-shot WP-CLI install + content seed.
- `local/verify/server.mjs` — the loopback scanner (`/verify`): probes `http://wordpress/…`
  and judges each hole closed.
- `metadata.json` — catalog entry, four-checkpoint scoring, per-checkpoint hints.
