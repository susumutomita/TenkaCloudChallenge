# soa-backup-retention

**SOA-C02 · flag · difficulty 2 · $0 free-tier**

## Story

Kato-san set up AWS Backup with a daily schedule. A compliance auditor wants to know exactly how many days backups are retained before automatic deletion. The player reads the Backup Plan rule and reports the `DeleteAfterDays` value.

## What gets deployed

| Resource | Detail |
|----------|--------|
| `AWS::Backup::BackupVault` | `{NamePrefix}-vault` |
| `AWS::Backup::BackupPlan` | `{NamePrefix}-daily-plan`, daily cron at 05:00 UTC, `DeleteAfterDays: 35` |
| `AWS::SSM::Parameter` | `/{NamePrefix}/briefing` — task description |
| `AWS::IAM::Role` | `ParticipantViewerRole` with `backup:GetBackupPlan*`, `backup:ListBackupPlans`, SSM read, CloudShell |

No backup jobs run. Cost: **$0**.

## Solution

The flag is **`TC{35}`**.

CLI verification:
```bash
PLAN_ID=$(aws backup list-backup-plans \
  --query "BackupPlansList[?BackupPlanName=='<NamePrefix>-daily-plan'].BackupPlanId" \
  --output text)
aws backup get-backup-plan --backup-plan-id "$PLAN_ID" \
  --query 'BackupPlan.Rules[0].Lifecycle.DeleteAfterDays'
# → 35
```

Console: AWS Backup > Backup plans > `{NamePrefix}-daily-plan` > Backup rules > DailyRule > Retention period.

## Scoring

- Correct: +200 pt
- Wrong: -15 pt per attempt

## Learning goals

- Read AWS Backup Plan `DeleteAfterDays` from Console and CLI
- Understand the lifecycle model: backup is taken, retained N days, then automatically deleted
- SOA-C02: link retention periods to RPO / compliance requirements
