# Security Battle Royale

> 日本語版: [README.ja.md](./README.ja.md)

A Battle around an e-commerce-style web app, "Unicorn.Rentals," deliberately seeded with vulnerabilities. Players take attacker or defender roles: attackers sweep other teams' public endpoints to capture scoring resources, defenders patch holes without taking the app offline. SQL injection / RCE / SSRF / IMDS exposure coexist by design.

| Field          | Value                                  |
| -------------- | -------------------------------------- |
| Category       | Battle (real-time PvP)                 |
| Difficulty     | 3 / 5                                  |
| Estimated time | 60–90 min                              |
| status         | `draft`                                |
| Scoring        | `uptime-multi` (`pointsAllOk`: 100)    |

## What you do

- **Attackers** sweep other teams' `FrontendUrl` / `ApiUrl` and exploit the seeded SQLi / RCE / SSRF / IMDS exposure to steal scoring resources.
- **Defenders** patch vulnerabilities **without shutting the app down**. Killing the service technically protects you, but the uptime probe stops paying out.

That trade-off (= harden while staying available) is the core of the problem.

## What gets deployed

```
┌── single EC2 (Amazon Linux 2023, t3.small) docker-compose ──┐
│                                                              │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐                    │
│  │  nginx   │  │  Flask   │  │  mysql   │                    │
│  │  :80     │  │  :8080   │  │  :3306   │                    │
│  └──────────┘  └──────────┘  └──────────┘                    │
│       │              │              │                        │
│  FrontendUrl     ApiUrl         (private)                    │
└──────────────────────────────────────────────────────────────┘
```

- Dedicated VPC + public subnet + IGW
- Public ports: 80 (frontend) / 8080 (api); restrictable via `AllowedCidr`
- `DbPassword` is a CFn parameter (NoEcho); the deploy chain generates it from `__RANDOM_PASSWORD__`

## Scoring

Every minute, both endpoints are probed; if both return 200, +100 pt.

| State                                                  | Per cycle |
| ------------------------------------------------------ | --------- |
| `FrontendUrl /` and `ApiUrl /healthz` both return 200  | +100 pt   |
| Either non-200 / times out                             | 0 pt      |

See the `scoring` field in [`metadata.json`](./metadata.json) for the full spec.

## Local development

```bash
cd problems/battles/security-battle-royale/local
docker compose up --build
# frontend: http://localhost:80
# api:      http://localhost:8080/healthz
```

`local/docker-compose.yaml` + `local/mysql-init.sql` reproduce the same 3-container stack as production. `api/api.py` and `frontend/index.html` contain the vulnerabilities themselves.

## Seeded vulnerabilities (= spoilers)

- **SQL injection** — raw string concatenation in `api.py` search queries.
- **RCE** — `eval` / shell-out style helpers behind a debug endpoint.
- **SSRF** — a helper endpoint that fetches an arbitrary URL.
- **IMDS exposure** — IMDSv1 enabled; chained with SSRF, IAM Role credentials can be exfiltrated.

> Until ADR-008 (= moving problem implementations to a private repo, issue #574) ships, these can be read ahead in the public repo.

## Learning goals

- Walk through the workflow of discovering and patching intentional SQL injection / RCE / SSRF.
- Understand the EC2 IMDS / IAM Role exposure path and the best practices to close it.
- Experience the attacker / defender trade-off (keep availability while hardening) in real time.

## Related files

- [`metadata.json`](./metadata.json) — problem metadata
- [`template.yaml`](./template.yaml) — one-page CFn template deployed into the competitor account
- [`api/api.py`](./api/api.py) — Flask API (where the vulnerabilities live)
- [`frontend/index.html`](./frontend/index.html) — static page served by nginx
- [`local/docker-compose.yaml`](./local/docker-compose.yaml) — local reproduction
