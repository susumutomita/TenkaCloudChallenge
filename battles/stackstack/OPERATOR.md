# StackStack — Operator runbook

> Operator-facing. Reading this as a player spoils the disruption schedule.

StackStack is now an orphan-safe "Vibe to Production" battle. All top-level resources are CloudFormation-owned; participants only register the app URL, modify app config/data on the EC2 host, associate an existing WAF WebACL to an existing ALB, and migrate data into the existing RDS PostgreSQL database.

## Before the event

### Smoke test on a single team stack

Deploy a throwaway team stack, then collect outputs:

```bash
APP_URL="http://<AppUrlHint DNS>"
INSTANCE_ID="<InstanceId>"

curl -s "$APP_URL/healthz" | jq .
curl -s "$APP_URL/posture" | jq .
curl -s "$APP_URL/meta" | jq .
curl -s "$APP_URL/score" | jq .
```

Immediately after the **stack** deploys, the app is **not running yet** (it ships as a local build in `~/vibe-app`). `/healthz` returns 5xx until you deploy it:

```bash
aws ssm start-session --target "$INSTANCE_ID"
sudo /opt/tenkacloud/vibe/deploy_app.sh
```

After deploy, expect:

```json
{"ok": true}
{
  "posture": {
    "db_present": false,
    "auth_enabled": false,
    "rate_limited": false,
    "audit_on": false,
    "on_rds": false,
    "site_intact": true,
    "no_backdoor": true
  },
  "platform": "posture-0"
}
```

If `/healthz` is not 200, inspect the app host:

```bash
aws ssm start-session --target "$INSTANCE_ID"
sudo journalctl -u tenkacloud-vibe --no-pager
sudo journalctl -u nginx --no-pager
```

Run the red-team smoke test against the same stack:

```bash
INSTANCE_ID="$INSTANCE_ID" BASE_URL="$APP_URL" bash redteam/smoke-test-attacks.sh
```

### Verify scoring wires

In the platform admin console:

1. Confirm the `app` endpoint default is empty from `RegisteredUrl`.
2. Register `AppUrlHint` as the team override.
3. Confirm the score engine probes `/meta` and `/score` once per minute.
4. Confirm the dashboard `StatusPanel.tsx` renders the endpoint and production gates.

## During the event

### Participant path to brief

Participants should not create new AWS services. There are no one-button solve scripts on the host
(they were removed); players perform the real operations, and `vibe-status` shows each gate's objective.
The expected path (after `source /etc/tenkacloud-vibe/runtime.env`):

1. Register `AppUrlHint` in the portal.
2. Use SSM Session Manager into `InstanceId`.
3. Restore the DB from backup: `aws s3 cp s3://$BACKUP_BUCKET/seed-sqlite.sql /tmp/ && sqlite3 $SQLITE_DB < /tmp/seed-sqlite.sql`, then restart the service.
4. Enable auth: set `auth_required=true` + a non-default `auth_token` in `$CONFIG_FILE` (e.g. with `jq`), restart.
5. Associate `WAF_WEB_ACL_ARN` to `ALB_ARN` with `aws wafv2 associate-web-acl`.
6. Enable audit: set `audit_s3=true` in `$CONFIG_FILE`, restart.
7. Migrate to RDS: `tools/export_sqlite_to_postgres.py` → `psql` into RDS, set `database=rds` in `$CONFIG_FILE`, restart.
8. Use `/posture` (or `vibe-status`) as the source of truth.

### How the red team fires

All disruptions are real-fault `action` deliveries (ADR-031) with mandatory revert (ADR-029). There are no effect-only penalties.

| Default fire | id                     | Delivery                       | Revert |
| ------------ | ---------------------- | ------------------------------ | ------ |
| 35 min       | `ai-wipes-database`    | SSM command runs wipe script    | 300 s  |
| 50 min       | `auth-setting-removed` | SSM command edits config        | 300 s  |
| 65 min       | `vibe-app-stopped`     | SSM command stops app service   | 180 s  |

The executor AssumeRoles into the team account and targets the `InstanceId` stack output. Revert is scheduled at fire time. Participants can recover earlier through SSM.

### Watching the room

Use `/posture` to diagnose a team without guessing:

```bash
TEAM_APP_URL=<registered AppUrlHint>
curl -s "$TEAM_APP_URL/posture" | jq .
```

Typical interpretations:

- `platform=posture-0`: hosted but no production work has landed.
- `db_present=false`: restore script has not run or a DB wipe disruption landed.
- `auth_enabled=false`: auth flag/token is missing or was stripped.
- `rate_limited=false`: WAF is not associated to the ALB.
- `audit_on=false`: audit flag is off or the app cannot write to the audit bucket.
- `on_rds=false`: app still uses SQLite or cannot query RDS PostgreSQL.
- `ssh_closed=false`: the planted public tcp/22 rule is still on the app SG (or the app cannot DescribeSecurityGroups; check the instance role if every team is stuck false).

## Scoring (flat per-gate)

Each satisfied production gate is worth **+100 points/min**. The six gates are equally weighted, so a team earns the same for closing any one of them — there is no arbitrary per-gate weighting.

| Platform     | Gates | Points / min |
| ------------ | ----- | ------------ |
| `posture-0`  | 0     | 0            |
| `posture-1`  | 1     | 100          |
| `posture-2`  | 2     | 200          |
| `posture-3`  | 3     | 300          |
| `posture-4`  | 4     | 400          |
| `posture-5`  | 5     | 500          |
| `production` | 6     | 600          |

- **One-time bonus:** reaching `production` (all six gates) earns **+30000** once — kept as the "finish line" incentive.
- **Penalties (unchanged by the flatten):** probe failure **-100**/cycle, slow response (> 1500 ms) **-25**.
- **`production-ramp` (after 30 min):** teams still at `posture-0/1/2` drop to the degraded rate (half: 0 / 50 / 100 per min) — pressure to deepen posture before the deadline.
- **Incident clamp:** when `site_intact` or `no_backdoor` is false (site defaced / backdoor planted), the app reports `platform ≤ posture-2`, capping the team at **200 points/min** until they remediate. This is measured by the app from real state, not operator-toggled.

## After the event

Delete each team stack:

```bash
aws cloudformation delete-stack --stack-name tc-stackstack-<team>
```

No extra cleanup pass is expected. If any ALB / WAF / S3 / RDS / EC2 / IAM resource remains, treat that as a CloudFormation deletion failure and debug the stack events rather than deleting participant-created resources.

## Known limitations

- The RDS PostgreSQL instance (db.t3.micro, Single-AZ, 20GB gp2) is free-tier eligible, so it adds little cost over the old EC2-only StackStack. The ALB still accrues charges, so keep event duration short and delete stacks promptly.
- The WAF posture check verifies WebACL association, not a live flood. The WebACL itself is stack-owned and contains a rate-based rule.
- The app writes a small S3 object during `/posture` when audit is enabled. The audit bucket has a one-day lifecycle rule to bound object growth.
- `RegisteredUrl` is intentionally empty. If an operator pre-populates the endpoint override for a team, deploy alone can start scoring; avoid doing that before the participant begins.
