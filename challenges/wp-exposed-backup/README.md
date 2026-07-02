# The Predecessor's Leftovers — A Site That Runs Fine Can Still Leak Everything

> TenkaCloud Challenge · `challenges/wp-exposed-backup` · difficulty 3 · ~45 min · `multi-verify` scoring (4 checkpoints, 200 pts)

A local, **AWS-free** teaching problem built on a **real, current WordPress + MariaDB**
running in an isolated Docker stack. It is aimed at non-engineers who operate a WordPress
site. The point is *not* a code vulnerability and *not* an old, deliberately-vulnerable
build — it reproduces the most common **operational-neglect** pattern: the previous
operator left several files in the public web root during a migration and never removed
them.

This is the WordPress companion to the SaaS (Wix) operational-neglect problem: same
message — the software is fine; your setup and operations are what leak.

## Checkpoints (multi-verify)

The previous operator left **four independent leftovers**, each a different, very common
misconfiguration and each with its own audit passphrase. You submit each passphrase to its
own checkpoint and earn partial credit; clearing all four gives full marks. The problem
container judges each checkpoint (`POST /verify` with a `checkpointId`) — the platform
never learns the answers, it only holds the points.

| Checkpoint | Attack surface (how it is found) | Points |
| --- | --- | ---: |
| `public-backup` | A DB dump left in the web root: `/wp-content/backups/db-backup.sql` (advertised by `robots.txt`). | 40 |
| `exposed-config` | An editor backup `wp-config.php.bak` served as **plain text** (PHP only runs `.php`), leaking DB creds + an ops token. | 50 |
| `debug-log` | `WP_DEBUG_LOG` left on in production: `wp-content/debug.log` is world-readable and captured an internal note. | 50 |
| `dir-listing` | Apache **directory listing** left on for `/internal/`, so its handover memo is browsable. | 60 |

All four grow from the same habit — *leaving things in the public area* — which is exactly
the lesson: they are distinct controls, not one bug split four ways.

## What gets deployed

| Where | What |
| --- | --- |
| **Your machine (Docker)** | A real WordPress + MariaDB + a loopback scorer — the problem runtime |
| `127.0.0.1:18080` | Challenge surface (the running WordPress site) |
| `127.0.0.1:18081` | Loopback `/verify` the TenkaCloud scorer delegates to |

Four containers, all on a private compose network, nothing published except the two
loopback ports:

- **`db`** — real MariaDB, dummy data only.
- **`wordpress`** — real, current WordPress (Apache + PHP). A wrapper entrypoint plants the
  four leftovers into the docroot *before* Apache starts, so the challenge surface exists
  the instant the site is reachable.
- **`wpinit`** — one-shot WP-CLI that installs WordPress and seeds a little content, so you
  audit a working site, not the setup wizard.
- **`verify`** — the loopback scorer; holds the four checkpoint flags.

Every flag is derived inside the containers from a per-deploy random `FLAG_SEED` (the
WordPress container bakes each into its leftover; the `verify` container derives the same
values to judge), so no answer is stored in this repo. Nothing is exposed off loopback, and
`docker compose down -v` returns everything to a clean initial state.

## The story

You have taken over running a company's WordPress site. It runs normally. But during the
site migration, the previous operator left several files in a public folder "just for
testing" / "to delete later" and forgot them — so data, DB credentials, and internal notes
are readable from the outside. Your job is to find each one the way an outsider would.

## Steps

1. `make local PROBLEM=wp-exposed-backup` starts the stack, the scoring API, and the portal.
   (First run pulls the WordPress / MariaDB images and installs WordPress — give it a
   minute.)
2. Log in to the portal with any non-empty key. You will see four checkpoints.
3. Look at the site at `http://127.0.0.1:18080/`. It works fine — so don't attack
   WordPress itself. Check `http://127.0.0.1:18080/robots.txt`: it "hides" (advertises)
   `/wp-content/backups/` and `/internal/`.
4. Find each leftover and submit its passphrase to the matching checkpoint:
   ```
   curl http://127.0.0.1:18080/wp-content/backups/db-backup.sql   # public-backup
   curl http://127.0.0.1:18080/wp-config.php.bak                  # exposed-config
   curl http://127.0.0.1:18080/wp-content/debug.log               # debug-log
   curl http://127.0.0.1:18080/internal/                          # dir-listing (browse, then open handover.txt)
   ```

| Request | Response |
| --- | --- |
| `GET /` | `200` a normal, working WordPress site |
| `GET /robots.txt` | `200` disallows `/wp-content/backups/` and `/internal/` ← the breadcrumbs |
| `GET /wp-content/backups/db-backup.sql` | `200` the whole DB dump, incl. the `public-backup` flag |
| `GET /wp-config.php.bak` | `200` the config copy as text, incl. the `exposed-config` flag |
| `GET /wp-content/debug.log` | `200` the debug log, incl. the `debug-log` flag |
| `GET /internal/` | `200` a directory listing → `handover.txt`, incl. the `dir-listing` flag |

## The root-cause fix (why this is a bug), and the scoring boundary

Nobody exploited WordPress. The site did exactly what a web server does: it served files
sitting in public folders. The fixes are all operational, and none of them touch code:

- **`public-backup` →** never place backups (`.sql` dumps, `.zip` exports) anywhere
  reachable from the web; delete leftover files before/after a migration.
- **`exposed-config` →** never leave editor backups (`.bak` / `.save` / `~`) of
  `wp-config.php` in the docroot; they are served as text and leak credentials. Rotate any
  credential that was exposed.
- **`debug-log` →** turn `WP_DEBUG` / `WP_DEBUG_LOG` **off** in production, and keep
  `wp-content/debug.log` out of the web root.
- **`dir-listing` →** disable Apache directory listing (`Options -Indexes`); a listable
  folder exposes everything in it.
- **`robots.txt` is not access control.** Disallowing a path only tells people where to
  look. Use real access restrictions, not "security by obscurity".

**Scoring boundary:** the four checkpoints are scored independently and the *container*
decides `correct` for each (`POST /verify` echoes the `checkpointId`). The platform holds
only the point values from `metadata.json` and never receives the answer or any point value
from the container — so a buggy or hostile container can never award itself points. A
running-fine site is not a safe site; what is *reachable* is what matters.

## Learning goals

- WordPress runs on PHP, a DB, auth, and settings — and leaving initial setup alone has
  real consequences you can feel here.
- A backup, a config copy, a debug log, and a directory listing are four different
  operational mistakes that all grow from the same "left it in the public area" habit.
- Reviewing public folders, deleting unneeded files, turning off directory listing, and
  stopping debug output are the basic, code-free fixes.

## Cost

Local Docker only. No AWS resources are created (free). First run pulls the WordPress and
MariaDB images.

## Related files

- `local/docker-compose.yml` — the four-container isolated stack.
- `local/wordpress/` — the real WordPress image + the wrapper that plants the four leftovers.
- `local/wpinit/init.sh` — one-shot WP-CLI install + content seed.
- `local/verify/server.mjs` — the loopback `/verify` (judges each checkpoint).
- `metadata.json` — catalog entry, four-checkpoint scoring, per-checkpoint hints.
