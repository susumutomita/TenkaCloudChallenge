# saa-asg-target-tracking

**Certification:** Solutions Architect Associate (SAA-C03) · **Kind:** `flag` · **Difficulty:** 3 · **Cost:** $0

## Story

Two months into TenkaCloud Inc. CTO Sasaki-san needs the CPU TargetValue from Kato-san's Auto Scaling configuration for an upcoming capacity planning meeting. The ASG is deployed with DesiredCapacity=0 (no running instances, zero cost). The learner inspects the scaling policy and reads the TargetValue from the TargetTrackingConfiguration.

## What gets deployed

- `{NamePrefix}-lt`: EC2 Launch Template (instance type: t3.micro, never launched).
- `{NamePrefix}-asg`: Auto Scaling Group (min=0, max=4, desired=0 -- no instances).
- Target Tracking Scaling Policy (`ASGAverageCPUUtilization`, TargetValue=60.0).
- `/{NamePrefix}/briefing`: SSM Parameter with task instructions.

DesiredCapacity=0: zero EC2 instances are launched -- $0 cost.

## Solution (operator notes)

The player must retrieve the scaling policy and read `TargetValue` from `TargetTrackingConfiguration`. The value is not in any SSM parameter or tag.

```bash
ASG_NAME=$(aws autoscaling describe-auto-scaling-groups \
  --query "AutoScalingGroups[?contains(AutoScalingGroupName, '${NAMEPREFIX}')].AutoScalingGroupName" \
  --output text)

aws autoscaling describe-policies --auto-scaling-group-name "$ASG_NAME" \
  --query 'ScalingPolicies[0].TargetTrackingConfiguration.TargetValue'
# Returns: 60.0
```

**Flag:** `TC{60}` (stored in CFn Output `AnswerFlag`, which the participant role cannot read).

## Scoring

- Correct: **+200 pt** (once per deploy).
- Wrong answer: **-15 pt** each (anti-brute-force); score clamps at 0.
- Two progressive hints (-20 / -40).

## Learning goals

- Target Tracking Scaling Policy: the TargetValue drives automatic scale-out / scale-in to maintain a metric at the specified level.
- `describe-policies` returns `TargetTrackingConfiguration.TargetValue`.
- DesiredCapacity=0 allows inspecting ASG/policy definitions without any EC2 cost.
