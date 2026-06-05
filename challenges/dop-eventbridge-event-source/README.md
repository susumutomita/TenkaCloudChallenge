# dop-eventbridge-event-source

**DOP-C02 · flag · difficulty 3 · $0**

## Story

Kato-san set up an EventBridge rule whose event source is unknown to the team.
CTO Sasaki-san wants to know which AWS service's events the rule is monitoring
by reading the EventPattern source field.
The learner runs `describe-rule` and extracts the source value.

## What gets deployed

- SNS topic `{NamePrefix}-codecommit-notify` (EventBridge target)
- EventBridge rule `{NamePrefix}-codecommit-events` (EventPattern source: `aws.codecommit`)
- SNS topic policy (allows EventBridge to publish)
- SSM Parameter `/{NamePrefix}/briefing` (task description)

Cost: $0.

## Solution

The flag is `TC{aws-codecommit}`.

**CLI verification:**

```bash
aws events describe-rule --name <NamePrefix>-codecommit-events \
  --query 'EventPattern'
# EventPattern contains: {"source": ["aws.codecommit"], ...}
# Replace dots with hyphens: aws.codecommit → aws-codecommit
# Submit: TC{aws-codecommit}
```

## Scoring

- Correct: +200 pt
- Wrong: -20 pt per attempt (brute-force deterrent)

## Learning goals

1. Read an EventBridge rule's EventPattern (source / detail-type / detail)
2. Understand the AWS service event source naming convention (`aws.<service>`)
3. Learn to verify rule metadata with `aws events describe-rule` / `list-rules`
