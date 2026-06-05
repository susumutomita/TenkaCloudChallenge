# soa-logs-retention

**SOA-C02 · flag · difficulty 2 · $0 free-tier**

## Story

Kato-san created a CloudWatch Log Group. A compliance officer needs to verify the retention period. The player reads the `RetentionInDays` setting and reports the number of days.

## What gets deployed

| Resource | Detail |
|----------|--------|
| `AWS::Logs::LogGroup` | `/{NamePrefix}/app`, `RetentionInDays: 90` |
| `AWS::SSM::Parameter` | `/{NamePrefix}/briefing` — task description |
| `AWS::IAM::Role` | `ParticipantViewerRole` with `logs:DescribeLogGroups` on `*`, SSM read, CloudShell |

No log ingestion. Cost: **$0**.

## Solution

The flag is **`TC{90}`**.

CLI verification:
```bash
aws logs describe-log-groups \
  --log-group-name-prefix "/<NamePrefix>" \
  --query 'logGroups[0].retentionInDays'
# → 90
```

Console: CloudWatch > Log groups > `/{NamePrefix}/app` > Retention setting column.

## Scoring

- Correct: +200 pt
- Wrong: -15 pt per attempt

## Learning goals

- Read CloudWatch Log Group `RetentionInDays` from Console and CLI
- `aws logs describe-log-groups` `retentionInDays` field (absence means "Never expire")
- Setting retention is a SysOps cost-control and compliance best practice
