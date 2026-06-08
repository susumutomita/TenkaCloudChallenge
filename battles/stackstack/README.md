# StackStack — Vibe to Production

> 日本語版: [README.ja.md](./README.ja.md)

Monday morning standup, TenkaCloud Platform Team. Kato-san is gone, and an AI Builder's generated message-board app is waiting for internal launch. It runs, but it is not production: the database is empty, anonymous users can post, there is no rate limiting, audit is off, and the app still uses SQLite.

> Sasaki-san, the CTO: "Hosting alone is not production. Use the controls we already provisioned and get it publishable today."

Your job over the next 90 to 120 minutes: take one hosted app to production using only stack-owned resources and data/config changes. Do not create Lambda, ECS, App Runner, API Gateway, CloudFront, or any other unmanaged top-level resource.

## Overview

| Field          | Value                                                                 |
| -------------- | --------------------------------------------------------------------- |
| Category       | Battle (real-time PvP)                                                |
| Difficulty     | 4 / 5                                                                 |
| Estimated time | 90-120 min                                                            |
| Scoring        | `phased-polling` from `posture-0` to `production`, plus one bonus      |

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
   `-- Aurora Serverless v2 database
```

`RegisteredUrl` is intentionally empty. Paste the stack output `AppUrlHint` into the Participant Portal endpoint override before scoring starts.

## Production gates

The app exposes `GET /posture`; those values are measured from actual state, not from a self-report toggle.

| posture key    | Initial state        | Hardened state                                                    |
| -------------- | -------------------- | ----------------------------------------------------------------- |
| `db_present`   | SQLite has no posts  | Restore the S3 backup dump into the existing DB                   |
| `auth_enabled` | Anonymous POST works | Enable the app auth flag with a non-default token                 |
| `rate_limited` | WAF not associated   | Associate the existing WebACL with the existing ALB               |
| `audit_on`     | No audit writes      | Enable audit writes to the existing S3 audit bucket               |
| `on_aurora`    | SQLite               | Migrate posts to the existing Aurora database and switch the app  |

`GET /meta` maps those checks to `posture-0` through `posture-4`, or `production` when all gates are true. Each step raises the per-cycle payout; `production` earns the one-time bonus.

## How to play

1. Deploy the stack, then copy `AppUrlHint` into the `app` endpoint override in the Participant Portal.
2. Start an SSM Session Manager shell using the `SsmStartSessionCommand` output.
3. Restore data:

   ```bash
   sudo /opt/tenkacloud/vibe/restore_database_from_s3.sh
   ```

4. Enable auth and keep the printed token for test posts:

   ```bash
   sudo python3 /opt/tenkacloud/vibe/set_auth_required.py true
   sudo systemctl restart tenkacloud-vibe
   ```

5. Associate the existing WAF WebACL to the existing ALB:

   ```bash
   source /etc/tenkacloud-vibe/runtime.env
   aws wafv2 associate-web-acl \
     --web-acl-arn "$WAF_WEB_ACL_ARN" \
     --resource-arn "$ALB_ARN" \
     --region "$AWS_REGION"
   ```

6. Enable audit writes:

   ```bash
   sudo python3 /opt/tenkacloud/vibe/set_audit_s3.py true
   sudo systemctl restart tenkacloud-vibe
   ```

7. Migrate from SQLite to Aurora:

   ```bash
   sudo /opt/tenkacloud/vibe/migrate_to_aurora.sh
   ```

8. Check `GET /posture` after each step. The score engine uses the same state through `/meta` and `/score`.

## Red team

Operators can fire reversible disruptions:

| id                     | What happens                                 | Revert                         |
| ---------------------- | -------------------------------------------- | ------------------------------ |
| `ai-wipes-database`    | Clears posts from SQLite / Aurora             | Restores from S3 backup        |
| `auth-setting-removed` | Backs up config, then disables auth            | Restores the backed-up config  |
| `vibe-app-stopped`     | Stops `tenkacloud-vibe`                       | Starts `tenkacloud-vibe`       |
| `site-defaced`         | Defaces the board (PWNED banner), `site_intact`=false | Removes the deface marker |
| `supply-chain-backdoor`| Plants a backdoor artifact, `no_backdoor`=false | Removes the backdoor artifact |

All disruptions are `action` deliveries with a declared `revert`; no effect-only penalty claims a cloud fault.

## Cost

The stack pre-creates ALB, EC2, WAF, S3, and Aurora Serverless v2. Expect more than the old EC2-only sample; keep event stacks short-lived and delete them promptly. No participant-created resources should exist outside the stack, so teardown is:

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
