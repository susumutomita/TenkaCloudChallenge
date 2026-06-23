# Microservice Migration Battle

> 日本語版: [README.ja.md](./README.ja.md)

Month one at TenkaCloud Inc. The previous SRE — the predecessor who vanished after that handover meeting last quarter — left you an EC2 monolith: three services (`users` / `orders` / `catalog`) co-tenant on one box, dispatched by a tired nginx config.

> the CTO, the CTO: "Time to split these out. Lambda, ECS Fargate, App Runner — give each service its own hosting. I don't care which, just stop running them on one VM. Other teams started yesterday."

This Battle is your migration. You have 90 to 120 minutes, three slots in the Participant Portal, and a score engine that pays out per hosting tier the moment you register a new URL.

## Overview

- Category: Battle (real-time PvP)
- Difficulty: 4 / 5
- Estimated time: 90 – 120 min
- Learning goals:
  - Experience an incremental monolith → microservices migration (strangler fig pattern).
  - Compare Lambda + API Gateway (function-as-a-service), ECS Fargate (orchestrated containers), and App Runner (managed containers) on real AWS infrastructure.
  - Decide which service to peel off first under live time pressure.

## What gets deployed

A single CloudFormation stack lands in your team's AWS account:

```text
┌─────────────── EC2 (t3.small, Amazon Linux 2023) ───────────────┐
│                                                                  │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐                       │
│  │  users   │  │  orders  │  │ catalog  │  ← docker compose      │
│  │  :3001   │  │  :3002   │  │  :3003   │     co-tenancy         │
│  └──────────┘  └──────────┘  └──────────┘                       │
│         ▲             ▲             ▲                            │
│         └─────────────┴─────────────┘                            │
│                       │                                          │
│  ┌────────────────────────────────────────────┐                  │
│  │  nginx :80  →  /users/*   /orders/*        │                  │
│  │             →  /catalog/*                  │                  │
│  └────────────────────────────────────────────┘                  │
└──────────────────────────────────────────────────────────────────┘
                       ▲
                       │ Score engine probes /users, /orders, /catalog every minute
                       │ (URL pulled from the Participant Portal Endpoint Override panel)
```

Each service is isomorphic — same code, only the port and the service name differ:

| service   | port | self-reported platform (`/meta`) | handlers              |
| --------- | ---- | -------------------------------- | --------------------- |
| `users`   | 3001 | `ec2`                            | `/meta`, `/score`, `/healthz` |
| `orders`  | 3002 | `ec2`                            | same                  |
| `catalog` | 3003 | `ec2`                            | same                  |

`GET /meta` self-reports the hosting platform (`ec2` / `lambda` / `ecs` / `apprunner`). The score engine reads this to decide which tier of points to award.

## Target end-state (one possible split)

```text
                ┌────────── Lambda + API Gateway ───────────┐
                │  /users   → handler (Hono on Lambda)       │
                └────────────────────────────────────────────┘

                ┌────────── ECS Fargate Service ─────────────┐
                │  /orders  → ALB → Fargate Task (container)  │
                └─────────────────────────────────────────────┘

                ┌────────── AWS App Runner ──────────────────┐
                │  /catalog → App Runner Service (container)  │
                └─────────────────────────────────────────────┘
```

There are 6 ways to assign 3 services to 3 hosting tiers. The picture above is one — pick your own.

## How to play

1. **Deploy lands you a working monolith.** `BaseUrl` is intentionally empty in the CFn Outputs (invariant #9: the Battle starts when you say it does, not when the deploy completes). Grab `Ec2HostHint` from the stack Outputs.
2. **Paste `http://<Ec2HostHint>` into all three slot overrides** (`users` / `orders` / `catalog`) in the Participant Portal Endpoint Override panel. The score engine starts probing once a URL is registered and you earn the EC2-tier rate.
3. **Peel one service off.** Pick the easiest, package it as a container (the `services/<name>/Dockerfile` works as-is), and stand it up on Lambda + API GW, ECS Fargate, or App Runner.
4. **Swap that slot's override URL** to the new managed endpoint. `GET /meta` reports `lambda` / `ecs` / `apprunner`, the score engine bumps you to the managed-tier rate.
5. **Keep going.** Get all three services onto three different managed runtimes and the "production-ready" bonus fires once.

The deploy that just sits on EC2 earns a baseline. The deploy that splits gracefully earns the win.

## Service spec

Common HTTP routes on every service:

- `GET /meta` → `{ "service": "<name>", "platform": "ec2" | "lambda" | "ecs" | "apprunner", "version": "1.0.0" }`
- `GET /score` → `{ "score": <int> }`
- `GET /healthz` → `{ "ok": true, "service": "<name>" }`

### Local development

```bash
cd battles/microservice-migration-battle/services
docker compose up --build
curl http://localhost/users/score
curl http://localhost/orders/score
curl http://localhost/catalog/score
```

## Scoring (per slot, per 1-minute probe cycle)

| State                                          | Points        |
| ---------------------------------------------- | ------------- |
| URL not registered / non-200 / timeout         | -100          |
| EC2 (normal)                                   | +100          |
| EC2 (after the mid-game degradation event)     | +10           |
| Lambda + API Gateway                           | +1,000        |
| ECS Fargate                                    | +1,000        |
| App Runner                                     | +1,000        |
| Slow response (> 1.5 s)                        | -10           |
| All 3 slots on managed tiers (one-time bonus)  | +5,000        |

Self-reporting via `/meta` decides the tier. The score engine trusts the report; tampering is allowed, but the response time penalty still applies.

## Migration hints

The repo ships a Dockerfile for every service. The same image works on all three managed runtimes — only the wiring differs.

### Lambda + API Gateway

1. Wrap Hono with the `hono/aws-lambda` adapter (export the handler).
2. Build with esbuild (`npm install -g esbuild`) or ship a container image.
3. `aws lambda create-function --package-type Image --code ImageUri=<ECR URI>`.
4. In API Gateway HTTP API, target the Lambda function.
5. Set the env var `PLATFORM=lambda` so `/meta` self-reports correctly.

### ECS Fargate

1. `docker build -t <ECR URI>:latest services/orders` → ECR push.
2. Task Definition (CPU 256 / Memory 512, container port 3002, `PLATFORM=ecs`).
3. ECS Cluster + Service (1 task) behind an ALB Target Group on the container port.
4. Forward `/orders/*` from the ALB listener.

### App Runner

1. `docker build -t <ECR URI>:latest services/catalog` → ECR push.
2. Create an App Runner Service (Source = ECR, port 3003, `PLATFORM=apprunner`).
3. Register the App Runner URL directly into the slot override.

## Hosting tradeoffs (= why all three at once)

| Axis             | Lambda + API GW          | ECS Fargate                         | App Runner                          |
| ---------------- | ------------------------ | ----------------------------------- | ----------------------------------- |
| Unit             | function (event-driven)  | container + cluster management      | container (managed)                 |
| Scale            | per-request, cold start  | per-task (Auto Scaling)             | per-request, auto                   |
| Setup overhead   | light (one HTTP API)     | heavy (VPC / ALB / Service / TaskDef) | medium (one URL, no VPC)          |
| Main takeaway    | event-driven, async      | orchestration, persistence, network | managed container, source deploy    |

The whole point is to walk the spectrum from function → managed container → orchestrated container in a single sitting.

## Cost

t3.small EC2 + minimal networking + the disruption Lambda. Per 2-hour battle:

- EC2 t3.small: < $0.05
- Lambda / Scheduler: pennies
- Egress on the score-engine probes: negligible
- ECR, Lambda functions, ECS Fargate tasks, App Runner services that you stand up during the battle: scale with what you create; expect < $1 if you tear down within an hour of finishing.

Tear the stack down with `aws cloudformation delete-stack` when the battle ends.
