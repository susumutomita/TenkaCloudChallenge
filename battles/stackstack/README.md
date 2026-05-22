# StackStack — AI to Production Last Mile

> 日本語版: [README.ja.md](./README.ja.md)

Monday morning standup, TenkaCloud Platform Team. Kato-san resigned last month. The handover notes are thin. Meanwhile, 100 internal AI Builders are pushing Claude-generated apps into the team's queue — none of them hardened. All five control axes (auth / network / rate / audit / ux) wide open, all co-tenant on a single EC2.

> Sasaki-san, the CTO: "Get this to a publishable state. AI is shipping faster than Platform can keep up. Every other team's Platform org is in the same spot."

Your job, over the next 90 to 120 minutes: peel each of the 5 slots off EC2 and onto a managed runtime (Lambda + API GW / ECS Fargate / App Runner). Register the new URL in the Participant Portal Endpoint Override, and that slot's payout jumps from 100 to 1,000 pt per cycle. The cleanest split wins.

## Overview

| Field          | Value                                                                                       |
| -------------- | ------------------------------------------------------------------------------------------- |
| Category       | Battle (real-time PvP)                                                                      |
| Difficulty     | 4 / 5                                                                                       |
| Estimated time | 90–120 min                                                                                  |
| Scoring        | `phased-polling` — EC2 = 100 pt / managed = 1,000 pt / all-managed bonus = +30,000 (once)  |

## 5 control axes (= 5 endpoint slots)

| slot      | axis                                | initial state                       | hardened state                                  |
| --------- | ----------------------------------- | ----------------------------------- | ----------------------------------------------- |
| `auth`    | Authentication / Authorization      | naive Basic auth on EC2             | Cognito / SSO via managed runtime               |
| `network` | Network controls (S3 / WAF / IAM)   | Public S3 + wildcard IAM            | OAC + scoped IAM via managed runtime            |
| `rate`    | Rate limit / DoS protection         | unthrottled Flask                   | API GW throttle / Lambda concurrency cap        |
| `audit`   | Logging / Compliance                | stdout only                         | CloudTrail + Athena + WORM bucket               |
| `ux`      | User-facing availability            | single EC2                          | Multi-AZ + ALB + Auto Scaling                   |

Each slot self-reports its hosting platform via `GET /meta`. The initial deploy puts all five on EC2 (low score: 100 pt/cycle/slot). Hardening means re-hosting to Lambda + API GW / ECS Fargate / App Runner — which automatically brings the managed security defaults — and registering the new URL via the portal override. Once `/meta` returns `lambda` / `ecs` / `apprunner`, that slot pays 1,000 pt/cycle.

## What gets deployed

A single CloudFormation stack lands in your team's AWS account:

```text
┌── EC2 (Amazon Linux 2023, t3.small) ─────────────────────────────┐
│  nginx :80                                                       │
│    │                                                              │
│    ├─ /auth/*    → 127.0.0.1:8081  (Python systemd, self-reports ec2) │
│    ├─ /network/* → 127.0.0.1:8082  (Python systemd, self-reports ec2) │
│    ├─ /rate/*    → 127.0.0.1:8083  (Python systemd, self-reports ec2) │
│    ├─ /audit/*   → 127.0.0.1:8084  (Python systemd, self-reports ec2) │
│    └─ /ux/*      → 127.0.0.1:8085  (Python systemd, self-reports ec2) │
└──────────────────────────────────────────────────────────────────┘
        ▲
        │ Score engine probes /<slot>/meta + /<slot>/score per slot every 1 minute.
        │ Effective URL per slot = portal override ?? CFn Output (BaseUrl + /<slot>)
```

## How to play

1. **Deploy lands you a 5-slot monolith.** Grab `BaseUrl` from the stack Outputs (= the EC2 public DNS).
2. **Paste the URL into all 5 slot overrides** in the Participant Portal Endpoint Override panel (`auth` / `network` / `rate` / `audit` / `ux`). Scoring starts.
3. **Pick a slot, peel it off.** Build a tiny service that returns the same `/meta` (with `platform: "lambda" | "ecs" | "apprunner"`) and `/score` (200 JSON). Stand it up on Lambda + API GW / ECS Fargate / App Runner.
4. **Swap that slot's override URL** to the new managed endpoint. `/meta` self-reports the new platform; the score engine bumps you to the managed-tier rate.
5. **Race the clock.** The 30, 60, and 90 minute marks compound pressure on slots that are still EC2-resident — see the "Time-based phases" table below. Get all 5 onto managed runtimes for the +30,000 pt bonus.

## Time-based phases

| Time   | phase              | What happens                                                                                                |
| ------ | ------------------ | ----------------------------------------------------------------------------------------------------------- |
| 0 min  | start              | All slots naive on EC2 (≈ 500 pt/min baseline once you register URLs)                                       |
| 30 min | production-ramp    | Every slot still on EC2 switches to degraded (10 pt/cycle). The "publish deadline" simulation               |
| 60 min | compliance-audit   | Same effect, narrative compounds (Legal review pressure)                                                    |
| 90 min | incident-response  | Score engine probes `/score?legacy=true`. Slots still serving the planted slow path eat response-time penalty |

Each phase applies to **every slot still on EC2**, not just one. Migrating only `ux` and leaving four behind means all four degrade at the 30-minute mark.

## Random org events (disruptions)

Operator-fired catalog (you do not control these — they fire on the operator's schedule):

| id                    | name                              | Effect                                                  |
| --------------------- | --------------------------------- | ------------------------------------------------------- |
| `ceo-5000-users`      | CEO demands a 5000-user demo      | Extra penalty per cycle while `ux` slot is on EC2       |
| `mfa-mandate`         | Security Team mandates MFA        | Extra penalty per cycle while `auth` slot is on EC2     |
| `legal-pii-found`     | Legal finds PII                   | Extra penalty per cycle while `audit` slot is on EC2    |
| `env-credential-leak` | `.env` leaks                      | `auth` slot returns 503 for 5 min (zero pt for 5 cycles)|
| `ai-committed-secret` | Claude commits a secret           | `network` + `audit` both return 503 for 3 min           |

## All-managed bonus

Every slot reporting `lambda` / `ecs` / `apprunner` → **+30,000 pt one-time** ("production-ready" certification). A single slot left on EC2 disqualifies the bonus. The bonus is large enough that finishing all 5 beats a 4-of-5 plus extra runtime.

## What you build

There is no `services/` scaffold in this repo on purpose. Standing up the per-slot service is part of the challenge — the AI Builder didn't give you one either. Your service just needs:

- `GET /meta` → `{ "platform": "lambda" | "ecs" | "apprunner", "slot": "<slot-name>" }`
- `GET /score` → returns 200 with any JSON body
- Reachable from the score engine (= a public URL, or a private URL the score engine has been told about)

The Python stub running on EC2 is in `template.yaml`'s UserData — read it as a reference for the contract.

## Cost

- EC2 t3.small × 2h ≈ $0.04
- Any managed runtimes you stand up: pay as you create them; tear down within an hour of finishing for < $2 total
- Egress: negligible

Tear down with `aws cloudformation delete-stack` plus a manual sweep of the Lambda / ECS / App Runner / ECR / API GW resources you created.

## For operators

See [`OPERATOR.md`](./OPERATOR.md) for a fire-schedule recommendation, a deploy smoke test, and what to watch in 6-team rooms.

## Related files

- [`metadata.json`](./metadata.json) — problem metadata (source of truth for slots / scoring / phases / disruptions)
- [`template.yaml`](./template.yaml) — one-page CFn template
- [`portal/StatusPanel.tsx`](./portal/StatusPanel.tsx) — dashboard plugin that surfaces the 5-axis subscore + phase + disruption state
- [`OPERATOR.md`](./OPERATOR.md) — operator runbook
