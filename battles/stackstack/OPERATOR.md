# StackStack — Operator runbook

> Operator-facing. Reading this as a player spoils the disruption schedule.

StackStack is now an orphan-safe "Vibe to Production" battle. All top-level resources are CloudFormation-owned; participants only register the app URL, modify app config/data on the EC2 host, associate an existing WAF WebACL to an existing ALB, and migrate data into the existing Aurora database.

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

Expected immediately after deploy:

```json
{"ok": true}
{
  "posture": {
    "db_present": false,
    "auth_enabled": false,
    "rate_limited": false,
    "audit_on": false,
    "on_aurora": false,
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

Participants should not create new AWS services. The expected path is:

1. Register `AppUrlHint` in the portal.
2. Use SSM Session Manager into `InstanceId`.
3. Run `/opt/tenkacloud/vibe/restore_database_from_s3.sh`.
4. Run `python3 /opt/tenkacloud/vibe/set_auth_required.py true`.
5. Source `/etc/tenkacloud-vibe/runtime.env`, then associate `WAF_WEB_ACL_ARN` to `ALB_ARN`.
6. Run `python3 /opt/tenkacloud/vibe/set_audit_s3.py true`.
7. Run `/opt/tenkacloud/vibe/migrate_to_aurora.sh`.
8. Use `/posture` as the source of truth.

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
- `on_aurora=false`: app still uses SQLite or cannot query Aurora.

## After the event

Delete each team stack:

```bash
aws cloudformation delete-stack --stack-name tc-stackstack-<team>
```

No extra cleanup pass is expected. If any ALB / WAF / S3 / Aurora / EC2 / IAM resource remains, treat that as a CloudFormation deletion failure and debug the stack events rather than deleting participant-created resources.

## Known limitations

- Aurora Serverless v2 and ALB make this more expensive than the old EC2-only StackStack. Keep event duration short and delete stacks promptly.
- The WAF posture check verifies WebACL association, not a live flood. The WebACL itself is stack-owned and contains a rate-based rule.
- The app writes a small S3 object during `/posture` when audit is enabled. The audit bucket has a one-day lifecycle rule to bound object growth.
- `RegisteredUrl` is intentionally empty. If an operator pre-populates the endpoint override for a team, deploy alone can start scoring; avoid doing that before the participant begins.
