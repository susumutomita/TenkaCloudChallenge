# The Midnight Admin — An Account Nobody Added, Reconstructed From Outside

> TenkaCloud Challenge · `challenges/wp-midnight-admin` · difficulty 3 · ~45 min · `multi-verify` scoring (4 checkpoints, 200 pts)

A local, **AWS-free** teaching problem built on a **real, current WordPress + MariaDB**
running in an isolated Docker stack. It is the **incident-response** companion to the
WordPress operational-neglect problems (`wp-exposed-backup` discovery, `wp-harden-leaks`
remediation): instead of hunting leftover files, you investigate a live account-compromise
incident. An administrator account nobody added appeared overnight — you reconstruct WHO,
HOW, and WHAT they left behind. It is aimed at people who operate a WordPress site. There
is **no exploit, no CVE, and no admin login required** — every signal is externally
observable.

## The story

The morning after you inherit the design studio **Sakura Design**'s WordPress site, a
monitoring alert says an administrator account you don't recognize appeared overnight. The
site runs fine. Your job is not to attack it, but to investigate the incident the way an
outsider would — from four independent, real WordPress operational signals, no login needed.

## Checkpoints (multi-verify)

The incident leaves **four independent signals**, each a different real WordPress
operational signal and each with its own audit passphrase. You submit each passphrase to its
own checkpoint and earn partial credit; clearing all four gives full marks. The problem
container judges each checkpoint (`POST /verify` with a `checkpointId`) — the platform never
learns the answers, it only holds the points.

| Checkpoint | Signal (how it is found) | Points |
| --- | --- | ---: |
| `rogue-admin` | REST user enumeration `GET /wp-json/wp/v2/users` (unauthenticated by default) lists an administrator `media-sync` nobody added; its bio (`description`) carries the passphrase. | 50 |
| `login-trail` | A served access log `/server-logs/access.log` shows a brute-force burst of failed `POST /wp-login.php` from `203.0.113.66`, then one success; a `[tripwire]` annotation carries the passphrase. | 50 |
| `orphan-plugin` | An abandoned plugin's world-readable `readme.txt` (`/wp-content/plugins/legacy-contact-form/readme.txt`) shows an ancient `Tested up to`; an ops NOTE carries the passphrase. | 50 |
| `spam-post` | The intruder's SEO-spam post in the content feed `GET /wp-json/wp/v2/posts` hides the passphrase in an HTML comment in the body. | 50 |

The four map onto the incident arc — **WHO** (`rogue-admin`) → **HOW** (`login-trail`) → a
contributing risk found during triage (`orphan-plugin`) → **WHAT they left behind**
(`spam-post`).

## What gets deployed

| Where | What |
| --- | --- |
| **Your machine (Docker)** | A real WordPress + MariaDB + a loopback scorer — the problem runtime |
| `127.0.0.1:18080` | Challenge surface (the running WordPress site) |
| `127.0.0.1:18081` | Loopback `/verify` the TenkaCloud scorer delegates to |

Four containers, all on a private compose network, nothing published except the two loopback
ports:

- **`db`** — real MariaDB, dummy data only.
- **`wordpress`** — real, current WordPress (Apache + PHP). A wrapper entrypoint plants the
  two **file** signals (the access log and the orphan plugin readme) and enables the standard
  WordPress rewrite (so `/wp-json/` answers) *before* Apache starts.
- **`wpinit`** — one-shot WP-CLI that installs WordPress, seeds content, and plants the two
  **WordPress-content** signals (the rogue admin's bio and the spam post), so you audit a
  working site.
- **`verify`** — the loopback scorer; holds the four checkpoint flags.

Every flag is derived inside the containers from a per-deploy random `FLAG_SEED` (the
WordPress container and wpinit bake each signal; the `verify` container derives the same
values to judge), so no answer is stored in this repo. Nothing is exposed off loopback, and
`docker compose down -v` returns everything to a clean initial state.

## Steps

1. `make local PROBLEM=wp-midnight-admin` starts the stack, the scoring API, and the portal.
   (First run pulls the WordPress / MariaDB images and installs WordPress — give it a minute.)
2. Log in to the portal with any non-empty key. You will see four checkpoints.
3. Look at the site at `http://127.0.0.1:18080/`. It works fine — so don't attack WordPress
   itself. Investigate the incident from outside, WHO → HOW → WHAT.
4. Find each signal and submit its passphrase to the matching checkpoint:
   ```
   curl http://127.0.0.1:18080/wp-json/wp/v2/users                                   # rogue-admin (read media-sync's description)
   curl http://127.0.0.1:18080/server-logs/access.log                                # login-trail (the burst + the one success + the [tripwire] line)
   curl http://127.0.0.1:18080/wp-content/plugins/legacy-contact-form/readme.txt      # orphan-plugin (the NOTE line)
   curl http://127.0.0.1:18080/wp-json/wp/v2/posts                                   # spam-post (the HTML comment in content.rendered)
   ```
   If pretty permalinks aren't available in your setup, the REST calls also work as
   `http://127.0.0.1:18080/?rest_route=/wp/v2/users` and `.../?rest_route=/wp/v2/posts`.

| Request | Response |
| --- | --- |
| `GET /` | `200` a normal, working WordPress site |
| `GET /wp-json/wp/v2/users` | `200` the author list, incl. the unexpected `media-sync` and its bio (the `rogue-admin` flag) |
| `GET /server-logs/access.log` | `200` the access log, incl. the brute-force burst, the one success, and the `[tripwire]` line (the `login-trail` flag) |
| `GET /wp-content/plugins/legacy-contact-form/readme.txt` | `200` the abandoned plugin's readme (the `orphan-plugin` flag) |
| `GET /wp-json/wp/v2/posts` | `200` the content feed, incl. the spam post whose body comment holds the `spam-post` flag |

## The root-cause fix (why this is an incident), and the scoring boundary

Nobody found a flaw in WordPress's code. A weak / reused admin password was brute-forced, the
intruder made themselves an admin and left spam behind, and the site quietly kept serving
signals that told the whole story. The fixes are all operational, and none of them touch code:

- **`rogue-admin` →** delete the administrator account nobody added, audit every admin, and
  (as hardening) restrict / monitor the REST public user listing when you don't need it.
- **`login-trail` →** stop using weak / reused passwords; monitor and rate-limit login
  attempts (attempt / IP limits); rotate the compromised credential; keep logs out of the web
  root.
- **`orphan-plugin` →** remove unused / abandoned plugins and keep the ones you keep up to
  date. An un-maintained plugin is attack surface even when idle.
- **`spam-post` →** delete the malicious post, and after any admin takeover rotate credentials
  and enforce MFA + least privilege.
- **An unexpected admin account is a top incident signal**, and most of it you can spot from
  outside before you even log in — if you routinely inventory users, logs, plugins, and posts.

**Scoring boundary:** the four checkpoints are scored independently and the *container*
decides `correct` for each (`POST /verify` echoes the `checkpointId`). The platform holds only
the point values from `metadata.json` and never receives the answer or any point value from
the container — so a buggy or hostile container can never award itself points. A running-fine
site is not a safe site; what is *reachable* is what matters.

## Learning goals

- An unexpected administrator account is a top incident signal — felt in a real environment.
- WordPress can expose the user list through the REST API, an access log lets you tell a
  brute-force burst from the one successful login, and you can inventory installed plugins —
  four different observations that reconstruct one incident from outside.
- Deleting the account, rotating credentials, MFA / least privilege, removing abandoned
  plugins, and restricting the public user listing are the basic, code-free fixes.

## Cost

Local Docker only. No AWS resources are created (free). First run pulls the WordPress and
MariaDB images.

## Related files

- `local/docker-compose.yml` — the four-container isolated stack.
- `local/wordpress/` — the real WordPress image + the wrapper that plants the two file signals
  and enables the WordPress rewrite.
- `local/wpinit/init.sh` — one-shot WP-CLI install + content seed + the rogue admin and spam
  post.
- `local/verify/server.mjs` — the loopback `/verify` (judges each checkpoint).
- `metadata.json` — catalog entry, four-checkpoint scoring, per-checkpoint hints.
