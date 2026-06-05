# dea-s3-lifecycle-transition-day — DEA · flag · difficulty 2 · $0

## Story

Kato-san set up an S3 lifecycle rule but left no documentation. CTO Sasaki-san needs the GLACIER transition day for cost projections. The player must run `GetBucketLifecycleConfiguration` and read the `Transitions[].Days` value.

## What gets deployed

- 1 S3 bucket (`{NamePrefix}-data`) — empty, no object uploads
  - Lifecycle rule: GLACIER transition at day 90, expiration at day 365
- 1 SSM Parameter (`/{NamePrefix}/briefing`) with the task description

$0 cost.

## Solution

**Flag:** `TC{90}`

**CLI one-liner to verify:**

```bash
aws s3api get-bucket-lifecycle-configuration --bucket <NamePrefix>-data \
  --query 'Rules[0].Transitions[?StorageClass==`GLACIER`].TransitionInDays' \
  --output text
# Returns: 90  → TC{90}
```

## Scoring

- Correct: +150 pt
- Wrong: -15 pt/attempt (anti-brute-force)
- Hint 1: -15 pt (nudge toward Transitions array)
- Hint 2: -35 pt (reveals answer)

## Learning goals

- Read `Transitions.Days` from an S3 lifecycle rule to identify GLACIER transition timing
- Use `GetBucketLifecycleConfiguration` to inspect lifecycle settings
- Understand the S3 storage class hierarchy and lifecycle cost optimization
