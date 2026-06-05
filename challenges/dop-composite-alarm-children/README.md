# dop-composite-alarm-children

**DOP-C02 · flag · difficulty 3 · $0**

## Story

Kato-san created a CloudWatch composite alarm whose child alarm count is unknown.
CTO Sasaki-san needs to know how many child alarms are AND-combined in the AlarmRule
for a paging-noise reduction review.
The learner reads the AlarmRule and counts the ALARM() references.

## What gets deployed

- CloudWatch metric alarm `{NamePrefix}-cpu-high` (CPUUtilization > 80)
- CloudWatch metric alarm `{NamePrefix}-network-in-high` (NetworkIn > 10 MB)
- CloudWatch composite alarm `{NamePrefix}-composite-high-load` (ANDs the two above)
- SSM Parameter `/{NamePrefix}/briefing` (task description)

No EC2 instance — metric alarms stay INSUFFICIENT_DATA. Cost: $0.

## Solution

The flag is `TC{2}`.

**CLI verification:**

```bash
aws cloudwatch describe-alarms \
  --alarm-types CompositeAlarm \
  --alarm-names "<NamePrefix>-composite-high-load" \
  --query 'CompositeAlarms[0].AlarmRule'
# Returns: ALARM("<NamePrefix>-cpu-high") AND ALARM("<NamePrefix>-network-in-high")
# Count of ALARM(...) = 2
```

## Scoring

- Correct: +200 pt
- Wrong: -20 pt per attempt (brute-force deterrent)

## Learning goals

1. Read CloudWatch composite alarm AlarmRule (ALARM / AND / OR / NOT syntax)
2. Understand how composite alarms reduce paging noise
3. Grasp `aws cloudwatch describe-alarms` response structure
