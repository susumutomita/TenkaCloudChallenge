# Hello World Battle (Sample)

> 日本語版: [README.ja.md](./README.ja.md)

The **minimal sample** for Battle uptime scoring. Deploys nginx (frontend) and Python `http.server` (api) on a single EC2 -- but the `FrontendUrl` / `ApiUrl` Outputs are emitted **empty**. The Health Check Lambda only starts probing once the competitor pastes their stack's URLs into the override fields in the Participant Portal. While both return 200, +100 pt per minute.

| Field          | Value                                       |
| -------------- | ------------------------------------------- |
| Category       | Battle (real-time PvP)                      |
| Difficulty     | 1 / 5 (beginner)                            |
| Estimated time | 30 min                                      |
| status         | `ready`                                     |
| Scoring        | `uptime-flat` (`pointsPerSuccess`: 100)     |

## What you do

Day two at TenkaCloud Inc. You inherited the previous SRE's little production web stack (nginx + Python `/healthz` on one EC2) -- except other teams' SREs share the same account and are taking each other's services down.

Your job:

1. After deploy, copy the `Ec2HostHint` Output (= the EC2 public DNS name).
2. In the Participant Portal, paste `http://<host>` into the `frontend` slot override and `http://<host>:8080` into the `api` slot override.
3. From that point on, the Health Check Lambda probes every minute; +100 pt accrues per cycle where both endpoints return 200.
4. When attackers knock you down, restore service via SSM Session Manager (no SSH).

**Deploying earns nothing.** The Battle only begins the moment you register the URLs in the portal.

- **Attackers** tamper with the shared EC2 / Security Group to bring frontend or API down (e.g. `systemctl stop nginx`).
- **Defenders** connect via SSM Session Manager (no SSH) and restart the service.

All operations stay inside one EC2, so there is no cross-tenant impact.

## What gets deployed

```
┌─────── EC2 t3.micro (Amazon Linux 2023, public IP) ───────┐
│  nginx          :80   → /                                 │
│  python3 http.server :8080 → /healthz                     │
└────────────────────────────────────────────────────────────┘
       ▲
       │ FrontendUrl / ApiUrl Outputs are EMPTY
       │ Competitor overrides URL in portal → probe starts
       │ Both 200 → +100 pt / cycle
```

- Dedicated VPC (`10.99.0.0/16`) + public subnet + IGW
- InstanceRole for SSM Session Manager (`AmazonSSMManagedInstanceCore`)
- `ParticipantViewerRole` (read-only role competitors AssumeRole into for AWS Console)

## Scoring

| State                                                | Per cycle (1 min) |
| ---------------------------------------------------- | ----------------- |
| `FrontendUrl /` and `ApiUrl /healthz` both return 200 | +100 pt           |
| Either is non-200 / times out                        | 0 pt              |

See the `scoring` field in [`metadata.json`](./metadata.json) for the full spec.

## Cost

- EC2 t3.micro: within AWS Free Tier (750 hr/month for 12 months)
- VPC / IGW / SG: free
- One ~30-minute session is zero-cost while inside the Free Tier.

## Learning goals

- Confirm that TenkaCloud's Battle uptime scoring engine works against real endpoints.
- Experience a minimal EC2 + nginx + Python web stack receiving health-check probes.
- Practice connecting via SSM Session Manager without SSH to start / stop services.

## Related files

- [`metadata.json`](./metadata.json) — problem metadata (source of truth for UI / scoring engine)
- [`template.yaml`](./template.yaml) — one-page CFn template deployed into the competitor account
