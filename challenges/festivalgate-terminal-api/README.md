# The Terminal's Back Door — "Internal Only" Is Not Authentication

> TenkaCloud Challenge · `challenges/festivalgate-terminal-api` · difficulty 3 · ~40 min · `verify` scoring

A local, **AWS-free** CTF for junior–intermediate engineers about the design and
operational risk of **terminal-facing / "internal" APIs**. It runs entirely in one
Docker container: no AWS, no Cloudflare, no cloud account. This is the engineer-track
sequel to the non-engineer WordPress / Wix problems — same "your settings still matter"
theme, aimed one level up at people who build and run APIs.

Inspired by the class of incident where an API that "could only be reached internally"
turned out to be reachable, and trusted, from the outside (see
[ian.sh/frontgate](https://ian.sh/frontgate)).

## What gets deployed

| Where | What |
| --- | --- |
| **Your machine (Docker)** | A small Node **terminal API** — the problem runtime |
| `127.0.0.1:18080` | Challenge surface (the FestivalGate terminal API) |
| `127.0.0.1:18081` | Loopback `/verify` the TenkaCloud scorer delegates to |

The flag and the terminal token are derived inside the container from a per-deploy
random `FLAG_SEED`, so the answer is never stored in this repo. The compose stack binds
to `127.0.0.1` only and is never exposed off loopback.

## The story

FestivalGate runs entrance terminals at event venues. Each terminal calls this API to
look up tickets and check attendees in. The terminal functions are guarded by a terminal
token and work fine. The **operations endpoint** (`GET /internal/ops/summary`) was built
on one load-bearing assumption: *"only the internal network can reach it."* Inside it are
the venue's ops config and secrets. You are auditing the service from the outside.

## Mission

The terminal endpoints behave correctly:

- `GET /api/terminal/tickets/<code>` — ticket status (needs the terminal token). Intended.
- `POST /api/terminal/checkin` — check a ticket in (needs the terminal token). Intended.

The operations endpoint is where the two design flaws meet:

- `GET /internal/ops/summary` refuses "external" callers — but it decides *internal vs
  external* from a value the caller controls. That is the boundary flaw.
- When you do reach it, it hands back the **ops/auth secrets and customer data**, not
  just terminal-relevant fields. That is the least-privilege / data-separation flaw: the
  terminal path's DB access was never scoped down.

The flag lives in `opsSecrets.gate_master_note`.

## Steps

1. `make local PROBLEM=festivalgate-terminal-api` starts the container, the scoring API, and the portal.
2. Log in to the portal with any non-empty key.
3. Try the ops endpoint from the outside — it refuses you:
   ```
   curl http://127.0.0.1:18080/internal/ops/summary
   # {"error":"forbidden","detail":"This endpoint is restricted to the internal operations network."}
   ```
4. Ask *how* it decides you are external, and forge an internal-looking hop:
   ```
   curl -H "X-Forwarded-For: 10.0.0.9" http://127.0.0.1:18080/internal/ops/summary
   ```
   `opsSecrets.gate_master_note` holds the flag (`TC{...}`).
5. Submit the flag in the portal — the container's `/verify` judges it.

| Request | Response |
| --- | --- |
| `GET /internal/ops/summary` (no header) | `403` forbidden |
| `GET /internal/ops/summary` (`X-Forwarded-For: 10.0.0.9`) | `200` **ops secrets, incl. the flag** ← the bug |
| `GET /api/terminal/tickets/TG-1001` (terminal token) | `200` ticket status (intended) |

## The root-cause fix (why this is a bug)

Two independent lessons, both real:

- **A network boundary is not authentication.** "Only internal callers can reach this"
  is an assumption about your topology, not a property the request proves. Deciding
  "internal" from `X-Forwarded-For` (or any client-supplied header/IP) lets anyone claim
  it. Authenticate every request on its own merits — a terminal credential the server can
  verify (mTLS, a signed token), checked *per endpoint* — and treat the boundary as
  defense-in-depth, never as the gate.
- **Least privilege and data separation.** The entrance terminals need `tickets` and
  nothing else. Give the terminal path a DB user (or database) scoped to exactly that, and
  keep operations config, customer PII, and auth/reset secrets behind their own
  identities. Then even a broken boundary check can't turn "read a ticket" into "read the
  master secret."

Boundary defense (WAF, private networking) is a useful *supplement* — it is not a
substitute for authentication, authorization, and least-privilege data access.

## Learning goals

- An "internal" / "terminal-facing" API is still a major attack surface when its reach
  and authentication are vague.
- Trusting the network boundary as a stand-in for authentication breaks the moment the
  signal is client-controlled.
- Scoping the terminal's DB connection to least privilege and separating ops / customer /
  auth data are the root-cause fixes.

## Cost

Local Docker only. No AWS resources are created (free).

## Related files

- `local/app/server.mjs` — the terminal API + the loopback `/verify`.
- `local/docker-compose.yml`, `local/Dockerfile` — the loopback-only runtime.
- `metadata.json` — catalog entry, scoring, progressive hints.
