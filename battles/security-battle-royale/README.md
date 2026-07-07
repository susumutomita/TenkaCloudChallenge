# Security Battle Royale

> 日本語版: [README.ja.md](./README.ja.md)

Monday morning at TenkaCloud Inc. The previous SRE — the SRE you keep hearing about and never meeting — left you "Tenryu.Mart." The company acquired it last year. mysql + Flask + nginx co-tenant on one EC2. The monitoring dashboard is green. The codebase has not been read.

> The CTO: "Attacks are coming in. Other teams are getting hit too. Don't take it down, don't try to fix everything — just keep it up. Triage."

This Battle is the next 60 to 90 minutes. The score engine pays you for *every minute both endpoints return 200*, not for elegant fixes. Letting a bad request through is cheap. Taking the app down to harden it is expensive.

## Overview

| Field          | Value                                  |
| -------------- | -------------------------------------- |
| Category       | Battle (real-time PvP)                 |
| Difficulty     | 4 / 5                                  |
| Estimated time | 60–90 min                              |
| Scoring        | `uptime-multi` — both 200s = +100 pt; either down = 0 |

## What gets deployed

A single CloudFormation stack lands in your team's AWS account:

```text
┌── EC2 (Amazon Linux 2023, t3.small) — IMDSv2 enforced ──────┐
│                                                              │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐                    │
│  │  nginx   │  │  Flask   │  │  mysql   │  ← docker compose  │
│  │  :80     │  │  :8080   │  │  :3306   │                    │
│  └──────────┘  └──────────┘  └──────────┘                    │
│       ▲              ▲                                       │
│       │              │                                       │
│  Ec2HostHint    Ec2HostHint:8080                             │
└──────────────────────────────────────────────────────────────┘
        ▲
        │ Score engine probes both endpoints every 1 minute.
        │ +100 pt only on cycles where both return 200.
```

- Dedicated VPC + public subnet + IGW per team
- Public ports: 80 (frontend) / 8080 (api), gated by `AllowedCidr` (default `0.0.0.0/0` — tighten at deploy if you want to restrict the public attack surface)
- `DbPassword` is a NoEcho CFn parameter; the deploy chain generates a random value
- IMDSv2 is enforced (`HttpTokens=required`, hop-limit=1) so leaked SSRF cannot exfiltrate instance-role credentials

## How to play

1. **Deploy lands you a running app, scoring stopped.** Stack Outputs include `Ec2HostHint` (public DNS). The `FrontendUrl` / `ApiUrl` outputs are empty by design (invariant #9).
2. **Paste the URLs into the Participant Portal Endpoint Override:**
   - `frontend` slot ← `http://<Ec2HostHint>`
   - `api` slot ← `http://<Ec2HostHint>:8080`
3. **Score engine probes both** (`/` and `/api/v1/apistatus`). +100 pt per cycle while both return 200. Either drops → 0 pt that cycle.
4. **The operator side fires attack probes** on a schedule. Patch what you can without taking the app offline. Some attacks just need a hardened input; others need rate-limit / horizontal scaling.

The defender who stays at 200 the longest wins. The one who tries to fix everything to perfection usually does not.

## Local development

```bash
cd battles/security-battle-royale/local
docker compose up
# frontend: http://localhost:80
# api:      http://localhost:8080/api/v1/apistatus
```

`local/docker-compose.yaml` + `local/mysql-init.sql` reproduce the same 3-container stack as production. `api/api.py` and `frontend/index.html` are exactly what gets deployed.

## Scoring

```
+100 pt   both endpoints return 200 on a probe cycle (every 60 s)
   0 pt   either endpoint down / non-200 / timed out
```

Attack probes also fire continuously: each unpatched vulnerability that still lands docks points from that cycle, so a green-but-unpatched app scores **less** than a green-and-patched one — yet still more than a downed one. Patch the weakest spots to recover the full +100.

See the `scoring` field in [`metadata.json`](./metadata.json) for the full spec including hint penalties.

## Cost

- EC2 t3.small × 90 min ≈ $0.04
- VPC / SG / IGW: free
- Egress: negligible for the operator-side probes

Tear down with `aws cloudformation delete-stack` when the Battle ends.

## Related files

- [`metadata.json`](./metadata.json) — problem metadata
- [`template.yaml`](./template.yaml) — one-page CFn template deployed into the competitor account
- [`api/api.py`](./api/api.py) — Flask API (the codebase you inherit)
- [`frontend/index.html`](./frontend/index.html) — static page served by nginx
- [`local/docker-compose.yaml`](./local/docker-compose.yaml) — local reproduction
- [`redteam/`](./redteam/) — **operator only**. The attack catalog the platform fires against each team. Reading it as a player spoils the Battle.
