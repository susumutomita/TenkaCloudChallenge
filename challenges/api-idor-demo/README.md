# IDOR — Reading Objects You Shouldn't

> TenkaCloud Challenge · `challenges/api-idor-demo` · difficulty 2 · ~30 min · `verify` scoring

A local, **AWS-free** CTF for OWASP API Security Top 10 **#1 — API1:2023 Broken Object
Level Authorization (BOLA / IDOR)**. It runs entirely in one Docker container: no AWS,
no Cloudflare, no cloud account. This is the fully-local reincarnation of the
"profile API security" theme — the platform only scores; the challenge runs on your box.

## What gets deployed

| Where | What |
| --- | --- |
| **Your machine (Docker)** | A small Node **profile API** — the problem runtime |
| `127.0.0.1:18080` | Challenge surface (the profile API) |
| `127.0.0.1:18081` | Loopback `/verify` the TenkaCloud scorer delegates to |

The flag and the admin token are derived inside the container from a per-deploy random
`FLAG_SEED`, so the answer is never stored in this repo. The compose stack binds to
`127.0.0.1` only and is never exposed off loopback.

## Mission

You are signed in as `guest` with the API token `token-guest`.

- `GET /api/profile` returns **your own** profile (looked up from your token). Intended.
- `GET /api/profile/<id>` returns the object for `<id>` as long as you are logged in —
  but it **never checks that `<id>` is yours**. That is the IDOR.

The administrator is **user id 1** and the flag is in their private `note`. You do not
know the admin's token, and you do not need it.

## Steps

1. `make local PROBLEM=api-idor-demo` starts the container, the scoring API, and the portal.
2. Log in to the portal with any non-empty key.
3. Read your own profile first:
   ```
   curl -H "Authorization: Bearer token-guest" http://127.0.0.1:18080/api/profile
   ```
4. Now change the id to the admin's (IDOR):
   ```
   curl -H "Authorization: Bearer token-guest" http://127.0.0.1:18080/api/profile/1
   ```
   The `note` field holds the flag (`TC{...}`).
5. Submit the flag in the portal — the container's `/verify` judges it.

| Request | Response |
| --- | --- |
| `GET /api/profile/1` (no token) | `401` |
| `GET /api/profile` (`Bearer token-guest`) | `200` guest's own profile |
| `GET /api/profile/1` (`Bearer token-guest`) | `200` **admin's object, incl. the flag** ← the bug |

## The root-cause fix (why this is a bug)

Authentication answers "who are you"; **authorization** answers "are you allowed to read
*this object*". The endpoint authenticates you but forgets the second question. The fixes:

- **Check ownership**: reject (`403`) when the requested id is not the caller's own — or
  is not one the caller is entitled to.
- **Least-privilege responses**: never serialize secret fields (`secret_note`) into a
  profile response in the first place.

The defensive counterpart — *fixing* a flaw like this in code, locally — is a separate
problem (see the SQLi "fix it" challenge).

## Cost

Local Docker only. No AWS resources are created (free).
