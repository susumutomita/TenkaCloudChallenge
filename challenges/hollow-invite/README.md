# Operation "Hollow Invite"

> 日本語版: [README.ja.md](./README.ja.md)
> Facilitators: read [FACILITATOR.md](./FACILITATOR.md) (answer key + run-of-show).

You are the security response team at **Kestrel Dynamics**, an independent
engineering consultancy. An employee, Aoi Tanaka, forwards a message she is
unsure about: the subject looks like a reply to a thread she does not remember
starting, and the sender — a US coworking operator called **Northgate Cowork** —
says their Google Meet stopped working and steers her onto a different meeting
tool, **Vela Meet**.

The message authenticates cleanly: SPF, DKIM, and DMARC all pass, and it even
quotes what looks like an earlier reply from Aoi. So is it safe?

Your mission: **judge whether this message is safe or dangerous on the facts**,
and if it is dangerous, pin down the method, the blast radius, and the attacker
infrastructure — through to containment and reporting.

> Everything is fictional and runs inside one isolated tenant. Only `.example`
> and `*.tenka.local` names are used; there is no external network, no real
> malware, and no real payload anywhere.

## What gets deployed

A single local-play container (no AWS account needed). It is **not** a vulnerable
app to exploit — it is your evidence tenant.

```text
docker compose (127.0.0.1 only)
  :18080  Investigation surface
     ├─ /                         evidence index
     ├─ /artifacts/hollow-invite.eml     the reported message (raw headers)
     ├─ /clone/  + /clone/app.js         captured, sanitized fake meeting page
     ├─ /artifacts/proxylog.jsonl        network-observation log (T+45)
     ├─ GET  /rdap/domain/{name}         mock RDAP (registration dates)
     ├─ GET  /api/meetings/{id}          meeting metadata
     ├─ POST /meetings/{id}/download     dynamic "helper" issuance (marker only)
     └─ POST /api/heartbeat              presence beacon
  :18081  /verify   (loopback; the portal delegates scoring here)
```

`FLAG-1` (the sender domain's registration date) is generated per deploy from a
random `FLAG_SEED`, so it can only be read from the mock RDAP — never memorized.

## How to play

1. Read the raw `hollow-invite.eml` — headers included. Note what authenticates
   and what the message is actually asking you to do.
2. Corroborate in the mock tenant: query the sender domain via RDAP, statically
   analyse `clone/app.js`, and (from T+45) read `proxylog.jsonl`.
3. Submit each recovered fact to its checkpoint in the portal:
   - the **sender domain's registration date**,
   - the **DKIM signing domain** (`d=`),
   - the **fake meeting app's distribution endpoint**,
   - the **impersonated person**.
4. Stuck? Open a hint (each carries a point penalty).

This is run as a facilitated GameDay: your facilitator paces the injects
(domain lookups at T+15, a second recipient at T+30, the network log at T+45, an
executive query at T+60) and scores the reasoning and deliverables with the
rubric in [FACILITATOR.md](./FACILITATOR.md).

## Scoring

The portal auto-scores four discovery flags via the container's `/verify`
(`multi-verify`, 50 points each). Hints carry a penalty. The full GameDay rubric
— arguing the domain takeover, articulating what authentication does and does not
guarantee, blast-radius judgment, the IOC/reporting deliverables, plus deduction
traps (e.g. calling `payload:"none"` proof of safety) — is scored separately by
the facilitator; see [FACILITATOR.md](./FACILITATOR.md).

## Key message

Authentication, a real name, a real-looking company, and TLS together are **not
sufficient** for legitimacy. Evaluate the trust of a business conversation and
the trust of a URL that asks you to meet / log in / download / sign
**separately**, and verify identity over a known, independent channel.

## Safety

- Only `.example` and `*.tenka.local`; no external egress; no real payload.
- The download endpoint only ever returns a URL to an in-tenant benign marker (or
  nothing, `payload:"none"`, for a non-matching OS).
- `node local/safety-check.mjs` (the `make harness` equivalent) enforces the
  reserved-TLD / no-egress / no-binary invariants — run it before every event.

## Cost

Zero. It is a local Docker container; no cloud resources are created.

## Related files

- [`metadata.json`](./metadata.json) — problem metadata, `multi-verify` checks
- [`FACILITATOR.md`](./FACILITATOR.md) — answer key, run-of-show, 100-pt rubric
- [`local/`](./local/) — the container: `Dockerfile`, `docker-compose.yml`,
  `app/server.mjs` (mock APIs + `/verify`), `app/artifacts/`, `app/clone/`,
  `safety-check.mjs`
