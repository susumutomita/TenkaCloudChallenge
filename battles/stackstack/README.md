# StackStack — Vibe to Production

> 日本語版: [README.ja.md](./README.ja.md)

Monday morning standup, TenkaCloud Platform Team. The previous SRE is gone, and an AI Builder's generated message-board app is waiting for internal launch. It runs, but it is not production: the database is empty, anonymous users can post, there is no rate limiting, audit is off, and the app still uses SQLite.

> the CTO, the CTO: "Hosting alone is not production. Use the controls we already provisioned and get it publishable today."

Your job over the next 90 to 120 minutes: take one hosted app to production using only stack-owned resources and data/config changes. Do not create Lambda, ECS, App Runner, API Gateway, CloudFront, or any other unmanaged top-level resource.

## Overview

| Field          | Value                                                                 |
| -------------- | --------------------------------------------------------------------- |
| Category       | Battle (real-time PvP)                                                |
| Difficulty     | 4 / 5                                                                 |
| Estimated time | 90-120 min                                                            |
| Scoring        | `phased-polling` engine, flat **+100/min per satisfied gate** (`production` = +600/min) + one-time +30000 |

## What gets deployed

A single CloudFormation stack creates every top-level resource used by the game:

```text
Score Engine
   |
   v
ALB :80  -- optional association --> WAF rate-limit WebACL
   |
   v
EC2 app host (SSM only, no SSH)
   |-- /healthz
   |-- /posture
   |-- /meta
   |-- /score
   |-- SQLite app.db (initially wiped)
   |-- helper scripts under /opt/tenkacloud/vibe/
   |
   |-- S3 backup bucket (seed-sqlite.sql / seed-postgres.sql)
   |-- S3 audit bucket
   `-- RDS PostgreSQL (db.t3.micro, Single-AZ) database
```

The app ships as a **local build** in `~/vibe-app` and is not running yet — deploy it first with `deploy_app.sh`. `RegisteredUrl` is intentionally empty; paste the stack output `AppUrlHint` into the Participant Portal endpoint override before scoring starts.

## Production gates

The app exposes `GET /posture`; those values are measured from actual state, not from a self-report toggle.

| posture key    | Initial state        | Hardened state                                                    |
| -------------- | -------------------- | ----------------------------------------------------------------- |
| `db_present`   | SQLite has no posts  | Restore the S3 backup dump into the existing DB                   |
| `auth_enabled` | Anonymous POST works | Enable the app auth flag with a non-default token                 |
| `rate_limited` | WAF not associated   | Associate the existing WebACL with the existing ALB               |
| `audit_on`     | No audit writes      | Enable audit writes to the existing S3 audit bucket               |
| `on_rds`       | SQLite               | Migrate posts to the existing RDS PostgreSQL database and switch the app |
| `ssh_closed`   | tcp/22 open to 0.0.0.0/0 | Discover the previous SRE's leftover public SSH rule and revoke it (SSM-only access, nothing breaks) |

`GET /meta` maps those checks to `posture-0` through `posture-5`, or `production` when all gates are true. Scoring is **flat: every satisfied gate is worth +100 points/min**, so closing any one of the six gates is equally rewarding.

| Platform     | Gates satisfied | Points / min |
| ------------ | --------------- | ------------ |
| `posture-0`  | 0               | 0            |
| `posture-1`  | 1               | 100          |
| `posture-2`  | 2               | 200          |
| `posture-3`  | 3               | 300          |
| `posture-4`  | 4               | 400          |
| `posture-5`  | 5               | 500          |
| `production` | 6 (all)         | 600          |

Reaching `production` (all six gates) also earns a one-time **+30000** bonus. A probe failure costs **-100** per cycle and a slow response (> 5000 ms) costs **-25** — both unchanged by the flat model. After the 30-minute `production-ramp` phase, teams still at `posture-0/1/2` drop to the degraded rate (half: 0 / 50 / 100 per min). If the red team defaces the site, plants a backdoor, or lands anonymous spam on a board with auth still off (`site_intact` / `no_backdoor` / `board_clean` false), the app clamps the platform to `posture-2`, capping the team at **200 points/min** until they recover (for spam: enable auth to repel it, then delete the `author=redteam-spam` posts).

## How to play

1. Start an SSM Session Manager shell (`SsmStartSessionCommand`) and run `sudo /opt/tenkacloud/vibe/deploy_app.sh` to deploy the local build (start the service).
2. Copy `AppUrlHint` into the `app` endpoint override in the Participant Portal.
   > There are no one-button solve scripts — you perform the real operations. Run `vibe-status`
   > any time for the live gate status and the objective for each gap (exact commands are below and,
   > if you get stuck, in the penalty-gated portal hints). First load the resource vars:
   > `source /etc/tenkacloud-vibe/runtime.env`.

3. Restore data into the app DB from the backup bucket:

   ```bash
   source /etc/tenkacloud-vibe/runtime.env
   aws s3 cp "s3://$BACKUP_BUCKET/seed-sqlite.sql" /tmp/seed-sqlite.sql --region "$AWS_REGION"
   sqlite3 "$SQLITE_DB" < /tmp/seed-sqlite.sql
   sudo systemctl restart tenkacloud-vibe
   ```

4. Enable auth: set `auth_required=true` and a non-default `auth_token`, then restart. Keep the token for test posts:

   ```bash
   TOKEN="my-secret-$RANDOM"
   tmp=$(mktemp); jq --arg t "$TOKEN" '.auth_required=true | .auth_token=$t' "$CONFIG_FILE" > "$tmp" && sudo mv "$tmp" "$CONFIG_FILE"
   sudo systemctl restart tenkacloud-vibe
   echo "token: $TOKEN"
   ```

5. Associate the existing WAF WebACL to the existing ALB:

   ```bash
   source /etc/tenkacloud-vibe/runtime.env
   aws wafv2 associate-web-acl \
     --web-acl-arn "$WAF_WEB_ACL_ARN" \
     --resource-arn "$ALB_ARN" \
     --region "$AWS_REGION"
   ```

6. Enable audit writes (set `audit_s3=true`):

   ```bash
   tmp=$(mktemp); jq '.audit_s3=true' "$CONFIG_FILE" > "$tmp" && sudo mv "$tmp" "$CONFIG_FILE"
   sudo systemctl restart tenkacloud-vibe
   ```

7. Migrate from SQLite to RDS PostgreSQL: convert with the helper, load with psql, then point the app at RDS:

   ```bash
   python3 /opt/tenkacloud/vibe/tools/export_sqlite_to_postgres.py > /tmp/vibe-migrate.sql
   PGPASSWORD="$DB_PASSWORD" psql -h "$DB_ENDPOINT" -U "$DB_USER" -d "$DB_NAME" -f /tmp/vibe-migrate.sql
   tmp=$(mktemp); jq '.database="rds"' "$CONFIG_FILE" > "$tmp" && sudo mv "$tmp" "$CONFIG_FILE"
   sudo systemctl restart tenkacloud-vibe
   ```

8. Inspect the app host security group (`<NamePrefix>-app-sg`, visible in the EC2 Console with your participant role), find the leftover public SSH rule, and revoke it. Run this with **your participant credentials** (CloudShell or `aws login`), not from the app host — the instance role deliberately cannot modify SGs. All shell access is SSM Session Manager, so closing tcp/22 breaks nothing:

   ```bash
   APP_SG_ID=$(aws ec2 describe-security-groups \
     --filters "Name=tag:Name,Values=<NamePrefix>-app-sg" \
     --query 'SecurityGroups[0].GroupId' --output text)
   aws ec2 revoke-security-group-ingress \
     --group-id "$APP_SG_ID" \
     --protocol tcp --port 22 --cidr 0.0.0.0/0
   ```

9. Check `GET /posture` after each step. The score engine uses the same state through `/meta` and `/score`.

## Scoreboard

Your score and every other team's score appear on the Participant Portal:

- The **Home** page shows your cumulative score and rank, plus a score timeline chart that overlays every team in the event, so you can watch rivals climb in real time.
- The **Scoreboard** page ranks all teams in the event (auto-refresh every 5 s; the ranking freezes 30 minutes before the event ends).

Rival scores are **event-scoped**: they appear only when the operator runs StackStack as an Event and each team joins and deploys through it. A standalone deploy (a single team deployed outside an Event) still scores normally, but the portal cannot show other teams.

## Red team

Operators can fire reversible disruptions:

| id                     | Delivery                       | What happens                                 | Recovery / revert              |
| ---------------------- | ------------------------------ | -------------------------------------------- | ------------------------------ |
| `anonymous-spam`       | HTTP attack probe (`redteam/probes/anon-spam.sh`) | Posts marker spam to `/submit` with no auth token; if auth is off it lands and `board_clean`=false | Enable auth (the probe is rejected 401), then delete the `author=redteam-spam` posts |
| `ai-wipes-database`    | SSM `action`                   | Clears posts from SQLite / RDS                | Restores from S3 backup        |
| `auth-setting-removed` | SSM `action`                   | Backs up config, then disables auth            | Restores the backed-up config  |
| `vibe-app-stopped`     | SSM `action`                   | Stops `tenkacloud-vibe`                       | Starts `tenkacloud-vibe`       |
| `site-defaced`         | SSM `action`                   | Defaces the board (PWNED banner), `site_intact`=false | Removes the deface marker |
| `supply-chain-backdoor`| SSM `action`                   | Plants a backdoor artifact, `no_backdoor`=false | Removes the backdoor artifact |

The five SSM disruptions are `action` deliveries with a declared `revert` (no effect-only penalty claims a cloud fault). `anonymous-spam` is an HTTP attack probe with no server-side revert — a correctly authenticated board simply rejects it (401), so hardening is what "reverts" it.

## Cost

The stack pre-creates ALB, EC2, WAF, S3, and RDS PostgreSQL (db.t3.micro, Single-AZ). The RDS instance is free-tier eligible (db.t3.micro Single-AZ), so the added cost is small; still, keep event stacks short-lived and delete them promptly. No participant-created resources should exist outside the stack, so teardown is:

```bash
aws cloudformation delete-stack --stack-name <stack-name>
```

No extra cleanup pass is required.

## Related files

- [`metadata.json`](./metadata.json) — problem metadata, scoring, phases, disruptions
- [`template.yaml`](./template.yaml) — stack-owned AWS resources and app bootstrap
- [`portal/StatusPanel.tsx`](./portal/StatusPanel.tsx) — dashboard plugin
- [`OPERATOR.md`](./OPERATOR.md) — operator runbook
- [`redteam/`](./redteam/) — disruption catalog and smoke test
