# The Forgotten Share Link — Your SaaS Settings Are Still Your Responsibility

> TenkaCloud Challenge · `challenges/wix-exposure-audit` · difficulty 1 · ~30 min · `verify` scoring

A local, **AWS-free**, **browser-completable** teaching problem for non-engineers,
designers, and PMs who build sites with SaaS tools (Wix, STUDIO, etc.). It runs entirely
in one Docker container and does **not** use any real Wix account, real site, or real
data — it is a small mock of a SaaS-built business site that reproduces one very common
operational-neglect scenario.

This is the SaaS-side companion to the WordPress operational-neglect problem: same
message ("the tool is safe; your settings and operations are what leak"), aimed at people
who never touch code.

## What gets deployed

| Where | What |
| --- | --- |
| **Your machine (Docker)** | A small mock business site — the problem runtime |
| `127.0.0.1:18080` | Challenge surface (the published site) |
| `127.0.0.1:18081` | Loopback `/verify` the TenkaCloud scorer delegates to |

The flag and the stale share token are derived inside the container from a per-deploy
random `FLAG_SEED`, so the answer is never stored in this repo. The compose stack binds to
`127.0.0.1` only and is never exposed off loopback.

## The story

You have taken over running the site for a small design studio. It was built with a SaaS
site builder by an outside production agency, and only the company info and a contact form
are supposed to be public. But the collaboration and sharing settings with that agency
were never cleaned up after launch — and someone has warned you that customers' contact-
form submissions (names, emails, messages) are visible to people who shouldn't see them.

This is **not** a code vulnerability. It is a publishing/operations problem: *who can see
how much.* That responsibility stays with the site owner even on a fully managed SaaS.

## Mission

Audit the published site the way a visitor would, and reach the inbox that is leaking to
the outside. An audit passphrase (`TC{...}`) is waiting in it.

- `GET /` — the public business site. Looks harmless.
- `GET /admin/inbox?share=<token>` — the contact-form inbox. It should be private, but a
  live share link the agency left behind still opens it for anyone who has the link.

## Steps

1. `make local PROBLEM=wix-exposure-audit` starts the container, the scoring API, and the portal.
2. Log in to the portal with any non-empty key.
3. Open the site at `http://127.0.0.1:18080/` and **view the page source** (right-click →
   "View Page Source"). Production agencies often leave leftovers in the HTML.
4. You will find an agency note that was never deleted, containing a live share link to
   the contact-form inbox. Open it:
   ```
   http://127.0.0.1:18080/admin/inbox?share=<the-token-from-the-source>
   ```
   The inbox — every customer's name, email, and message — is shown to anyone with the
   link. The audit row's message contains the flag (`TC{...}`).
5. Submit the flag in the portal — the container's `/verify` judges it.

| Request | Response |
| --- | --- |
| `GET /admin/inbox` (no / wrong `share`) | `403` invalid share link |
| `GET /admin/inbox?share=<correct>` | `200` **full inbox incl. customer PII and the flag** ← the leak |

## The root-cause fix (why this is a bug)

The site builder did exactly what it was told: it made a shareable link and it kept
honoring it. Nobody attacked anything — the settings were left open. The fixes are all
operational:

- **Revoke share links after they've served their purpose**, and treat any "anyone with
  the link" URL as public.
- **Remove collaborator/agency access when the engagement ends** (the departed-agency /
  departed-employee problem).
- **Know where form submissions go** and who can read them, and review that on a schedule.
- **Do a pre-launch check**: what is actually public, what is genuinely private.

Because a "share link" is capability-based, anyone who ever saw it — or found it left in
the page source — keeps that capability until you revoke it.

## Learning goals

- Even on a managed SaaS, publish scope, share links, and collaborator/agency permissions
  are the owner's responsibility.
- A share link you assumed was private may be reachable by anyone.
- Reviewing where form submissions are exposed and revoking access for departed staff,
  agencies, and old share links is the fix.

## Cost

Local Docker only. No AWS resources are created (free).

## Related files

- `local/app/server.mjs` — the mock site, the leaked inbox, and the loopback `/verify`.
- `local/docker-compose.yml`, `local/Dockerfile` — the loopback-only runtime.
- `metadata.json` — catalog entry, scoring, progressive hints.
