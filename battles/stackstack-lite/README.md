# StackStack Lite — Vibe to Production (Intro)

> TenkaCloud Battle · `battles/stackstack-lite` · difficulty 2 · ~45–60 min · phased-polling · no red team

## Story

TenkaCloud Platform Team. Kato-san left behind an AI-built message board and resigned. It runs on a
single EC2 host, but the database is empty, there's no auth (anyone can post), and there's no audit trail.

Sasaki-san, the CTO: *"Not everything at once. Just restore the data, turn on auth, and get an audit log
going — then it's publishable."*

Your job: using **only existing stack-owned resources** (no new top-level resources), satisfy three gates —
**deploy → restore DB → enable auth → enable audit** — to reach `production`.

This is the **entry-level** version of [`battles/stackstack`](../stackstack/): the same "vibe to production"
world, trimmed to one EC2 host and three gates (no ALB / RDS / WAF / SSH closure / red team).

## What gets deployed

| Resource | Role |
| --- | --- |
| **EC2 app host** (public, HTTP :80 via nginx) | Runs the vibe board. The scoring engine probes it directly (no ALB). |
| **S3 backup bucket** | Holds the seed dump for the DB restore. |
| **S3 audit bucket** | The app writes audit events here once audit is on. |
| **ParticipantViewerRole** | SSM Session Manager into the host, read your stack (Console), read the buckets. No new-resource perms. |

No ALB, no RDS, no WAF, no red team. A custom resource empties the S3 buckets on `delete-stack` (orphan-free).

## How to play

All host operations run in an **SSM Session Manager** shell (`SsmStartSessionCommand`). Load the vars first:
`source /etc/tenkacloud-vibe/runtime.env`. Run `vibe-status` any time for the live gate status + objectives.

1. **Deploy** the local build and register the URL:
   ```bash
   sudo /opt/tenkacloud/vibe/deploy_app.sh
   ```
   Copy `AppUrlHint` into the `app` endpoint override in the Participant Portal — scoring starts.

2. **Restore the DB** (`db_present`):
   ```bash
   source /etc/tenkacloud-vibe/runtime.env
   aws s3 cp "s3://$BACKUP_BUCKET/seed-sqlite.sql" /tmp/seed-sqlite.sql --region "$AWS_REGION"
   sqlite3 "$SQLITE_DB" < /tmp/seed-sqlite.sql
   sudo systemctl restart tenkacloud-vibe
   ```

3. **Enable auth** (`auth_enabled`) — set `auth_required=true` + a non-default `auth_token`:
   ```bash
   tmp=$(mktemp); jq '.auth_required=true | .auth_token="my-secret-42"' "$CONFIG_FILE" > "$tmp" && sudo mv "$tmp" "$CONFIG_FILE"
   sudo systemctl restart tenkacloud-vibe
   ```

4. **Enable audit** (`audit_on`) — set `audit_s3=true`:
   ```bash
   tmp=$(mktemp); jq '.audit_s3=true' "$CONFIG_FILE" > "$tmp" && sudo mv "$tmp" "$CONFIG_FILE"
   sudo systemctl restart tenkacloud-vibe
   ```

When all three gates read true, `/meta` reports `production` — per-minute scoring maxes out and a one-time
bonus lands. Posture is measured from real state, so any method that reaches the state flips the gate.

## Scoring

| | |
| --- | --- |
| Kind | `phased-polling` (probe `/meta` + `/score` every minute) |
| posture-0 / 1 / 2 | 0 / 100 / 200 points per minute |
| production (all 3) | 400 / min + a one-time **+5000** bonus |
| Failure penalty | −50 per failed probe (gentle) |
| Hints | 3 (0 / −100 / −150), revealing flow → exact commands → troubleshooting |

## Cost

One `t3.micro` EC2 + two S3 buckets (audit objects expire in 1 day) + a tiny cleanup Lambda. No ALB / RDS
hourly charges. `delete-stack` empties the buckets and removes everything — no orphans.

## Learning goals

- Deploy a local AI-built app onto real cloud compute (EC2) and reach a basic production state **without
  creating new top-level resources**.
- Verify URL registration, a backup restore, app auth, and S3 audit writes through real posture checks.
- Practice the first step of cloud operations (deploy → restore → auth → audit) as an on-ramp to the
  full [`stackstack`](../stackstack/) Battle.

## Related files

- [`template.yaml`](./template.yaml) — EC2 host + 2 S3 buckets (+ cleanup), the embedded vibe app, and the participant role.
- [`metadata.json`](./metadata.json) — catalog entry, phased-polling scoring, hints.
- [`portal/StatusPanel.tsx`](./portal/StatusPanel.tsx) — the 3-gate status panel.
- [`battles/stackstack`](../stackstack/) — the advanced version (ALB / WAF / RDS / SSH / red team).
