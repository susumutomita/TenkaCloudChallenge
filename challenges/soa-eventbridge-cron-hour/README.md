# soa-eventbridge-cron-hour

**SOA-C02 · flag · difficulty 3 · $0 free-tier**

## Story

Kato-san set up an EventBridge rule that fires on a cron schedule. Nobody knows exactly what UTC hour it runs. Late-night alerts prompted CTO Sasaki-san to ask the new SRE to decode the cron expression.

## What gets deployed

| Resource | Detail |
|----------|--------|
| `AWS::Events::Rule` | `{NamePrefix}-schedule`, `ScheduleExpression: cron(0 2 * * ? *)`, `ENABLED` |
| `AWS::SNS::Topic` | `{NamePrefix}-schedule-topic` (rule target, no subscription) |
| `AWS::SNS::TopicPolicy` | Allows EventBridge to publish |
| `AWS::SSM::Parameter` | `/{NamePrefix}/briefing` — task description |
| `AWS::IAM::Role` | `ParticipantViewerRole` with `events:ListRules`, `events:DescribeRule`, SSM read, CloudShell |

No compute resources. Cost: **$0**.

## Solution

The flag is **`TC{02}`**.

CLI verification:
```bash
aws events describe-rule --name "<NamePrefix>-schedule" \
  --query ScheduleExpression
# → "cron(0 2 * * ? *)"
# Field order: cron(minute hour day month weekday year)
# hour = 2 → UTC 02:00
```

Console: Amazon EventBridge > Rules > `{NamePrefix}-schedule` > Schedule expression.

## Scoring

- Correct: +200 pt
- Wrong: -15 pt per attempt

## Learning goals

- Memorize EventBridge cron field order: `cron(minute hour day month weekday year)`
- `cron(0 2 * * ? *)` = every day at UTC 02:00
- Read `ScheduleExpression` from `aws events describe-rule`
