# dop-blue-green

**DOP-C02 · flag · difficulty 3 · $0**

## Story

Kato-san's rolling-update deployment causes 30 seconds of downtime per release.
CTO Sasaki-san demands zero downtime AND instant rollback.
The learner reads the scenario from SSM and picks the correct deployment strategy.

## What gets deployed

- SSM Parameter `/{NamePrefix}/briefing` (scenario question with three strategy options)

Cost: $0.

## Solution

The flag is `TC{blue-green}`.

Blue/Green deployment keeps two identical environments (Blue = current, Green = new version) live simultaneously. All traffic switches via a load balancer flip in an instant. Rollback = flip back to Blue, completing in seconds.

Rolling update replaces instances sequentially (rollback mid-flight is hard).
Canary shifts a fraction of traffic gradually (zero downtime but rollback takes minutes).

**CLI verification:**

```bash
aws ssm get-parameter --name "/{NamePrefix}/briefing" --query Parameter.Value --output text
```

## Scoring

- Correct: +200 pt
- Wrong: -15 pt per attempt

## Learning goals

1. Distinguish Blue/Green, Rolling, and Canary deployment trade-offs
2. Identify the one strategy achieving zero downtime AND instant rollback simultaneously
3. Gain confidence in deployment strategy selection for CodeDeploy / ECS / Elastic Beanstalk
