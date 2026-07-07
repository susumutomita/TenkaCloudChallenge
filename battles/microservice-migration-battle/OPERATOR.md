# Microservice Migration — Operator runbook

> Operator-facing. Reading this as a player spoils the hidden phase/disruption schedule and the legacy-path trap.

Microservice Migration is a `phased-polling` Battle. Each team inherits a three-service Node.js monolith (`users` / `orders` / `catalog`, dispatched by nginx on port 80) running on a single `t3.small` EC2 instance. The CTO orders a split: peel each service off EC2 onto a managed runtime — Lambda + API Gateway, ECS Fargate, or App Runner — and register the new URL in the portal. The score engine pays per hosting tier, so a team's score climbs as it evacuates the monolith. All top-level resources are CloudFormation-owned; the managed runtimes are the participant-created targets. There is no capture-flag mechanic and no `flagOutputKey` — scoring is pure per-tier uptime polling.

## Before the event

### Smoke test on a single team stack

Deploy a throwaway team stack. Access to the box is SSM-only (no SSH ingress). Collect these outputs from the stack:

```bash
EC2_HOST="<Ec2HostHint output>"     # e.g. ec2-…​.compute.amazonaws.com
INSTANCE_ID="<InstanceId output>"
```

The monolith comes up from EC2 UserData (`dnf` installs docker + git, clones the catalog repo, then `docker compose up -d --build` on nginx + 3 containers). Give it a few minutes, then verify nginx and each service behind it:

```bash
# nginx liveness (plain-text 200):
curl -s "http://$EC2_HOST/"          # → "tenkacloud microservice-migration-battle ec2 monolith"

# per-service score (the engine's scorePath, probed every 1 min):
curl -s "http://$EC2_HOST/users/score"     # → {"score":42}
curl -s "http://$EC2_HOST/orders/score"    # → {"score":7}
curl -s "http://$EC2_HOST/catalog/score"   # → {"score":99}

# per-service meta (the engine's metaPath — reports the self-declared platform):
curl -s "http://$EC2_HOST/users/meta"      # → {"service":"users","platform":"ec2","version":"1.0.0"}
curl -s "http://$EC2_HOST/orders/meta"
curl -s "http://$EC2_HOST/catalog/meta"
```

The hardcoded scores (users=42, orders=7, catalog=99) are just liveness markers — the returned integer does not affect points; the tier (`/meta` platform) and up/down do. If any service is missing, inspect the host:

```bash
aws ssm start-session --target "$INSTANCE_ID"   # = the SsmStartSessionCommand output
sudo docker ps
sudo docker compose -f /path/to/services/docker-compose.yml logs
```

You can also validate the service images locally without deploying:

```bash
cd battles/microservice-migration-battle/services
docker compose up --build
curl http://localhost/users/score    # → {"score":42}
```

### Verify scoring wires

In the platform admin console:

1. Confirm every endpoint slot (`users` / `orders` / `catalog`) resolves to an **empty** effective URL from `BaseUrl` (the output ships as `""` — the deploy earns nothing until a team registers, per the Battle participant-action gate).
2. Register `http://<Ec2HostHint>` as the override for all three slots and confirm EC2-tier scoring starts (+100/cycle/slot).
3. Confirm the engine probes `/meta` and `/score` once per minute (`scoring.intervalMinutes: 1`).
4. Confirm the dashboard renders `RegistrationPanel.tsx` (registration guidance + the Service Router mini-form) and `StatusPanel.tsx` (endpoint slot table + inter-team route directory).

## During the event

### Participant path to brief

Participants deploy nothing at the top level; they **create** managed runtimes under their own `${NamePrefix}*` and modify service config, never the template. The expected path:

1. Grab `Ec2HostHint` from the stack outputs and paste `http://<host>` into all three slot overrides — EC2 scoring begins.
2. Peel one service off EC2: containerize with `services/<name>/Dockerfile` (works as-is) and stand it up on **Lambda + API Gateway** (`hono/aws-lambda`, `PLATFORM=lambda`), **ECS Fargate** (ECR push, task def, service behind an ALB target group, `PLATFORM=ecs`), or **App Runner** (ECR source, `PLATFORM=apprunner`).
3. Swap that slot's override to the new managed URL. `/meta` now self-reports the new platform → that slot jumps to +1000/cycle.
4. Get all three services onto three distinct managed runtimes → the one-time +5000 bonus fires.
5. The `ParticipantViewerRole` already grants the Lambda / ECS / App Runner / ECR / ELB / API Gateway deploy permissions needed for this (all scoped to `${NamePrefix}*` or tag-conditioned).

### Inter-team coordination (Service Router)

This problem ships an inter-team mechanic (`coordination/router.ts`, name "サービスルーター", `publicHint: true` — players see it). When a team registers a migrated service's public URL, it is shared into every team's route directory, forming a simple cross-team service mesh. The plugin rejects any URL that does not start with `https://` (`must_be_https`) and any unknown service (`unknown_service`). Registered routes are public endpoints, not secrets, so the directory is visible to all teams by design. It is a pure validate→apply→project state machine hosted by the platform dispatcher — no infrastructure of its own.

### How the red team fires

There is **no** `redteam/` directory. One hidden disruption plus two hidden scoring phases apply pressure, all `publicHint: false` (do not disclose the timings):

| Default fire | Mechanic | Delivery | Effect | Revert |
| ------------ | -------- | -------- | ------ | ------ |
| 60 min | `ec2-latency-injection` disruption | EventBridge Scheduler → Lambda → SSM `AWS-RunShellScript` on the EC2 | `tc … netem delay 200ms` on the default NIC → EC2-hosted services probe slower | auto `tc qdisc del` after 600 s (ADR-029) |
| 60 min | `degraded` phase | scoring engine | EC2 tier points switch 100 → 10 | n/a (time-based) |
| 90 min | `legacy` phase | scoring engine | probe path becomes `/score?legacy=true` | n/a (time-based) |

The disruption is operator-adjustable (`disruptions[].operatorEditable: ["afterMinutes"]`, or the `DegradedAfterMinutes` stack parameter). The schedule uses `rate()`, so it re-fires each interval, but the `tc qdisc add` is idempotent (`|| true` swallows the EEXIST no-op). The Lambda discovers the default NIC at runtime (`ip route show default`) — on AL2023 nitro instances that is `ens5`, not the `eth0` named in the metadata descriptor, so do not hand-fire the raw metadata action against `eth0`. If a revert does not land, clear it manually over SSM: `tc qdisc del dev <dev> root`.

The `legacy` phase is the endgame trap: each service's `/score` handler has a `LEGACY_PATH` branch that sleeps ~2000 ms before returning. Once the engine probes `/score?legacy=true` (t+90), any service still carrying that branch trips the `responseTimeMs > 1500` penalty (−10/cycle). The intended fix is to notice the branch in `services/<name>/src/index.ts`, delete it, and redeploy (scoring hint-4 nudges toward reading the handler). Do not reveal this.

### Watching the room

Use the per-service `/meta` and `/score` to diagnose a team without guessing:

```bash
TEAM_HOST=<team's registered host or managed URL>
curl -s "$TEAM_HOST/users/meta"     # platform = ec2 | lambda | ecs | apprunner
curl -s "$TEAM_HOST/users/score"    # 200 + {"score":…} = up
```

Typical interpretations:

- All three `platform=ec2`: team registered but has not started migrating.
- A slot's effective URL empty in `StatusPanel`: not registered → the engine charges `failurePenalty` (−100) for that slot.
- `platform` reports `lambda`/`ecs`/`apprunner` but responses are slow: a migrated service under load, or the legacy-path branch still present after t+90.
- Note: `/meta` platform is **self-reported and trusted** by the engine. A team can leave a service on EC2 and claim `lambda`; that is allowed by design. Only the response-time penalty is objective, so tampering does not dodge latency.

## Scoring

`kind: phased-polling`, probed every **1 minute** (`/meta` + `/score` per service).

| Slot platform | Points / cycle / slot |
| ------------- | --------------------- |
| `ec2`         | 100 (→ 10 after the `degraded` phase at t+60) |
| `lambda`      | 1000 |
| `ecs`         | 1000 |
| `apprunner`   | 1000 |

- **One-time bonus:** all three slots on the three distinct managed platforms (`lambda` + `ecs` + `apprunner`) earns **+5000** once. A single slot left on `ec2` blocks it.
- **Penalties:** URL not registered / non-200 / timeout = **−100**/cycle (`failurePenalty`); slow response (**> 1500 ms**) = **−10**/cycle.
- **Hidden phases** (`publicHint: false`): `degraded` at t+60 halves-and-then-some the EC2 tier (100 → 10); `legacy` at t+90 switches the probe to `/score?legacy=true` (the 2 s trap above).
- **Scoring hints** cost 0 / 50 / 100 / 200 progressively.

## After the event

Delete each team stack:

```bash
aws cloudformation delete-stack --stack-name <team stack name>
```

`delete-stack` removes only template-owned resources (VPC / EC2 / IAM roles / disruption Lambda + Scheduler). **Participant-created resources are not in the stack** and must be cleaned separately — anything they built under `${NamePrefix}*`: ECR repositories, Lambda functions, API Gateway HTTP APIs, ECS clusters/services/task-definitions, App Runner services, ALBs + target groups, and the security groups they created for the Fargate path. Sweep by the `${NamePrefix}` prefix / `TenkaCloud:NamePrefix` tag rather than deleting by hand.

## Known limitations

- The monolith comes up from EC2 UserData that git-clones the catalog repo (`RepoUrl`@`RepoRef`, default `main`) at deploy time. A repo/branch outage breaks bring-up — verify `docker compose up -d --build` finished (nginx + 3 containers) before the match.
- Access is SSM-only (no SSH ingress). Use `aws ssm start-session --target <InstanceId>` (the `SsmStartSessionCommand` output).
- The disruption Lambda and Scheduler ship without an explicit `FunctionName` / `Name` on purpose — a long `NamePrefix` would overflow the 64-char limit.
- The template creates no NAT gateway (public subnet + IGW only), so the EC2 base cost is small (t3.small < $0.05 over a 2-hour battle; the disruption Lambda/Scheduler is pennies). Participant-created runtimes scale with what they build — the ECS Fargate path stands up an ALB (billed hourly + LCU). Expect under $1 per team if everything is torn down within an hour of finishing.
- `/meta` platform is self-reported and trusted; this is intentional (the response-time penalty is the objective backstop). Do not treat a claimed tier as proof the service actually moved.
