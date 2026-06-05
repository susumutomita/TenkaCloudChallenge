# soa-cloudwatch-alarm-threshold

**SOA-C02 · flag · difficulty 2 · $0 free-tier**

## Story

Kato-san left a CloudWatch alarm watching CPU utilization. The alarm name is vague and contains no number. CTO Sasaki-san needs to know the exact threshold before a monitoring review. The new SRE (the player) must read the alarm configuration and report the threshold value.

## What gets deployed

| Resource | Detail |
|----------|--------|
| `AWS::CloudWatch::Alarm` | `CPUUtilization > 80` for 2 consecutive 5-minute periods, `GreaterThanThreshold`, INSUFFICIENT_DATA (no real instance needed) |
| `AWS::SSM::Parameter` | `/{NamePrefix}/briefing` — task description |
| `AWS::IAM::Role` | `ParticipantViewerRole` with `cloudwatch:DescribeAlarms` on `*`, SSM read on `/{NamePrefix}/*`, CloudShell |

No EC2 instance. Cost: **$0**.

## Solution

The flag is **`TC{80}`**.

CLI verification:
```bash
aws cloudwatch describe-alarms --alarm-name-prefix "<NamePrefix>" \
  --query 'MetricAlarms[0].Threshold'
# → 80.0
```

Console: CloudWatch > All alarms > click the alarm > Conditions panel shows "Greater than 80".

## Scoring

- Correct: +200 pt
- Wrong: -15 pt per attempt

## Learning goals

- Read CloudWatch Alarm Threshold / EvaluationPeriods / Period from Console and CLI
- Understand `aws cloudwatch describe-alarms` output structure
- Build the habit of reading configuration rather than inferring from resource names
