# dop-codedeploy-auto-rollback

**DOP-C02 · flag · difficulty 3 · $0**

## Story

Kato-san's CodeDeploy deployment group had no CloudWatch alarm integration,
so a high-error-rate deployment completed without automatic intervention.
CTO Sasaki-san wants the feature name that would have stopped and reverted the deployment.

## What gets deployed

- SSM Parameter `/{NamePrefix}/briefing` (scenario question)

Cost: $0.

## Solution

The flag is `TC{automatic-rollback}`.

CodeDeploy Automatic Rollback halts a deployment and restores the previous revision when
a specified CloudWatch alarm enters ALARM state during the deployment.
Configure it in the deployment group under "Rollback behavior":
- "Roll back when a deployment fails"
- "Roll back when alarm thresholds are met"

## Scoring

- Correct: +200 pt
- Wrong: -15 pt per attempt

## Learning goals

1. Configure CodeDeploy automatic rollback with CloudWatch alarm integration
2. Understand alarm-triggered rollback as a deployment safety net
3. Organize CodeDeploy deployment group settings: deployment config / alarms / rollback
