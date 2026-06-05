# dva-codedeploy-canary · DVA · flag · difficulty 2 · $0

## Story

Kato-san's all-at-once Lambda releases caused slow rollbacks when issues
appeared. The new SRE (you) must identify the CodeDeploy deployment style that
routes 10% of traffic to the new version for 5 minutes, then shifts 100%.

## What gets deployed

| Resource | Notes |
|---|---|
| `AWS::SSM::Parameter` | `/${NamePrefix}/briefing` with scenario text |
| `AWS::IAM::Role` (viewer) | ParticipantViewerRole with SSM read permissions |

No CodeDeploy or Lambda deployed -- spec-knowledge scenario.

## Solution

**Canary** deployment style:
- `CodeDeployDefault.LambdaCanary10Percent5Minutes` = shift 10% immediately,
  wait 5 minutes, then shift remaining 90%.
- If a CloudWatch alarm fires during the 5-minute window, CodeDeploy rolls back.

**Flag:** `TC{canary}`

Comparison:
| Style | Behavior |
|---|---|
| Canary | Fixed % first, validation window, then rest -- **2 steps** |
| Linear | Equal increments at fixed intervals -- **N steps** |
| AllAtOnce | 100% immediately -- **1 step** |

## Scoring

- Correct: +150 pt
- Wrong: -15 pt each (anti-brute-force)
- Hint 1: -20 pt (2-step pattern description)
- Hint 2: -40 pt (reveals canary)

## Learning goals

- Canary = fixed-percentage first + validation window + full shift (2 steps total)
- Linear = equal percentage increments at fixed intervals (N steps)
- CodeDeploy canary integrates with CloudWatch alarms for automatic rollback
