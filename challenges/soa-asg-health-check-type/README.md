# soa-asg-health-check-type

**SOA-C02 · flag · difficulty 3 · $0 free-tier**

## Story

Kato-san's Auto Scaling Group is configured to replace instances that fail the load-balancer health check. CTO Sasaki-san needs to confirm the `HealthCheckType` setting. The player reads the ASG configuration and reports the value.

## What gets deployed

| Resource | Detail |
|----------|--------|
| `AWS::EC2::LaunchTemplate` | `{NamePrefix}-lt`, t3.micro AMI placeholder, tagged with `TenkaCloud:NamePrefix` |
| `AWS::AutoScaling::AutoScalingGroup` | `{NamePrefix}-asg`, Min=0, Max=2, **Desired=0** (no instances launch), `HealthCheckType: ELB`, `HealthCheckGracePeriod: 300` |
| `AWS::SSM::Parameter` | `/{NamePrefix}/briefing` — task description |
| `AWS::IAM::Role` | `ParticipantViewerRole` with `autoscaling:Describe*` on `*`, EC2 launch template read, SSM read, CloudShell |

DesiredCapacity=0: no EC2 instances run. Cost: **$0**.

## Solution

The flag is **`TC{elb}`**.

CLI verification:
```bash
aws autoscaling describe-auto-scaling-groups \
  --auto-scaling-group-names "<NamePrefix>-asg" \
  --query 'AutoScalingGroups[0].{HealthCheckType:HealthCheckType,GracePeriod:HealthCheckGracePeriod}'
# → {"HealthCheckType": "ELB", "GracePeriod": 300}
```

Console: EC2 > Auto Scaling groups > `{NamePrefix}-asg` > Details tab > Health checks section.

## Scoring

- Correct: +200 pt
- Wrong: -15 pt per attempt

## Learning goals

- `HealthCheckType=EC2` (default): only replaces instances failing EC2 status checks
- `HealthCheckType=ELB`: also replaces instances the load balancer marks unhealthy (app-level)
- `HealthCheckGracePeriod` prevents premature termination during instance bootstrap
