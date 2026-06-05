# soa-ec2-recover-alarm

**SOA-C02 · flag · difficulty 3 · $0 free-tier**

## Story

Kato-san configured an EC2 automatic recover alarm. The audit team does not know which metric triggers it. CTO Sasaki-san asks the new SRE to identify the exact metric name from the alarm configuration.

## What gets deployed

| Resource | Detail |
|----------|--------|
| `AWS::CloudWatch::Alarm` | `StatusCheckFailed_System >= 1` for 2 periods, `AlarmActions: arn:aws:automate:...:ec2:recover` |
| `AWS::SSM::Parameter` | `/{NamePrefix}/briefing` — task description |
| `AWS::IAM::Role` | `ParticipantViewerRole` with `cloudwatch:DescribeAlarms` on `*`, SSM read on `/{NamePrefix}/*`, CloudShell |

No EC2 instance. Alarm is in INSUFFICIENT_DATA state. Cost: **$0**.

## Solution

The flag is **`TC{statuscheckfailed-system}`**.

CLI verification:
```bash
aws cloudwatch describe-alarms --alarm-name-prefix "<NamePrefix>" \
  --query 'MetricAlarms[0].{MetricName:MetricName,AlarmActions:AlarmActions}'
# → {"MetricName": "StatusCheckFailed_System", "AlarmActions": ["arn:aws:automate:...:ec2:recover"]}
```

The metric `StatusCheckFailed_System` fires when AWS hardware hosting the instance fails (system-level failure). The `ec2:recover` action moves the instance to healthy hardware automatically.

## Scoring

- Correct: +200 pt
- Wrong: -15 pt per attempt

## Learning goals

- EC2 automatic recovery uses the `StatusCheckFailed_System` metric (not `StatusCheckFailed_Instance`)
- `StatusCheckFailed_System` = hardware/hypervisor failure; `StatusCheckFailed_Instance` = OS/app failure
- Read `AlarmActions` and `MetricName` from `aws cloudwatch describe-alarms`
