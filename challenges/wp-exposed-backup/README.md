# The Predecessor's Backup — A Site That Runs Fine Can Still Leak Everything

> TenkaCloud Challenge · `challenges/wp-exposed-backup` · difficulty 2 · ~30 min · `verify` scoring

A local, **AWS-free** teaching problem built on a **real, current WordPress + MariaDB**
running in an isolated Docker stack. It is aimed at non-engineers who operate a WordPress
site. The point is *not* a code vulnerability and *not* an old, deliberately-vulnerable
build — it reproduces one very common **operational-neglect** scenario: a database backup
the previous operator left in the public web root and never removed.

This is the WordPress companion to the SaaS (Wix) operational-neglect problem: same
message — the software is fine; your setup and operations are what leak.

## What gets deployed

| Where | What |
| --- | --- |
| **Your machine (Docker)** | A real WordPress + MariaDB + a loopback scorer — the problem runtime |
| `127.0.0.1:18080` | Challenge surface (the running WordPress site) |
| `127.0.0.1:18081` | Loopback `/verify` the TenkaCloud scorer delegates to |

Four containers, all on a private compose network, nothing published except the two
loopback ports:

- **`db`** — real MariaDB, dummy data only.
- **`wordpress`** — real, current WordPress (Apache + PHP). A wrapper entrypoint drops the
  neglected backup file into the docroot *before* Apache starts, so the challenge surface
  exists the instant the site is reachable.
- **`wpinit`** — one-shot WP-CLI that installs WordPress and seeds a little content, so you
  audit a working site, not the setup wizard.
- **`verify`** — the loopback scorer.

The flag is derived inside the containers from a per-deploy random `FLAG_SEED` (the
WordPress container bakes it into the backup file; the `verify` container derives the same
value to judge), so the answer is never stored in this repo. Nothing is exposed off
loopback, and `docker compose down -v` returns everything to a clean initial state.

## The story

You have taken over running a company's WordPress site. It runs normally. But during the
site migration, the previous operator dumped the database into a public folder "just for
testing" and forgot to remove it — so the whole dataset is readable from the outside. Your
job is to find it the way an outsider would.

## Mission

Investigate the running site from the outside and reach the forgotten backup. An audit
passphrase (`TC{...}`) is written inside it, in a `maintenance_notes` line.

## Steps

1. `make local PROBLEM=wp-exposed-backup` starts the stack, the scoring API, and the portal.
   (First run pulls the WordPress / MariaDB images and installs WordPress — give it a
   minute.)
2. Log in to the portal with any non-empty key.
3. Look at the site at `http://127.0.0.1:18080/`. It works fine — so don't attack
   WordPress itself. Think about what an operator leaves lying around. Check
   `http://127.0.0.1:18080/robots.txt`: people often "hide" a folder there, which really
   just advertises it.
4. Fetch the leftover dump:
   ```
   curl http://127.0.0.1:18080/wp-content/backups/db-backup.sql
   ```
   Read the `maintenance_notes` line — the audit passphrase is the flag (`TC{...}`).
5. Submit the flag in the portal — the container's `/verify` judges it.

| Request | Response |
| --- | --- |
| `GET /` | `200` a normal, working WordPress site |
| `GET /robots.txt` | `200` disallows `/wp-content/backups/` ← the breadcrumb |
| `GET /wp-content/backups/db-backup.sql` | `200` **the whole DB dump, incl. the flag** ← the leak |

## The root-cause fix (why this is a bug)

Nobody exploited WordPress. The site did exactly what a web server does: it served a file
that was sitting in a public folder. The fixes are all operational, and none of them touch
code:

- **Never place backups (or `wp-config.php` copies, `.sql` dumps, `.zip` exports) anywhere
  reachable from the web.** Keep them off the server entirely, or in a folder the web
  server cannot serve.
- **Delete test/leftover files before and after a migration**, and audit the docroot for
  stray `*.sql` / `*.bak` / `*.zip`.
- **`robots.txt` is not access control.** Disallowing a path only tells people (and bots)
  where to look. Use real access restrictions (deny the folder in the web server config),
  not "security by obscurity".
- **Combine with the rest of WordPress hygiene** the issue calls out: strong, changed
  admin passwords; least-privilege accounts; keeping core/plugins/themes updated; removing
  unused plugins and themes; and having (private!) backups you have actually test-restored.

A running-fine site is not a safe site. What is *reachable* is what matters.

## Learning goals

- WordPress runs on PHP, a DB, auth, and settings — and leaving initial setup alone has
  real consequences you can feel here.
- A backup or config file left in a public folder leaks the whole dataset even while the
  site runs fine.
- Reviewing what goes in public folders, deleting unneeded files, and restricting access
  are the basic, code-free fixes.

## Cost

Local Docker only. No AWS resources are created (free). First run pulls the WordPress and
MariaDB images.

## Related files

- `local/docker-compose.yml` — the four-container isolated stack.
- `local/wordpress/` — the real WordPress image + the wrapper that plants the neglect.
- `local/wpinit/init.sh` — one-shot WP-CLI install + content seed.
- `local/verify/server.mjs` — the loopback `/verify`.
- `metadata.json` — catalog entry, scoring, progressive hints.
