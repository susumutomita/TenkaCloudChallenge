# clf-global-vs-regional-service

**Certification:** Cloud Practitioner (CLF-C02) · **Kind:** `flag` · **Difficulty:** 1 · **Cost:** $0

## Story

Two weeks in at TenkaCloud Inc. CTO Sasaki-san is building onboarding training materials and asks the player to classify four AWS services from Kato-san's notes: IAM, CloudFront, Route 53, and DynamoDB. Three are global; one is regional.

## What gets deployed

One SSM String parameter (`/{NamePrefix}/briefing`) listing four AWS services with descriptions, plus the ParticipantViewerRole. No EC2, NAT Gateway, or EIP — free tier only.

## Solution (operator notes)

| Service | Scope |
|---------|-------|
| IAM | Global — shared across all regions |
| CloudFront | Global — worldwide edge locations |
| Route 53 | Global — global DNS service |
| DynamoDB | **Regional** — tables scoped to a specific region |

```bash
aws ssm get-parameter \
  --name "/{NamePrefix}/briefing" \
  --query Parameter.Value --output text
```

**Flag:** `TC{dynamodb}` (mirrored in CFn Output `AnswerFlag`, which the participant role cannot read).

## Scoring

- Correct: **+150 pt** (once per deploy).
- Wrong answer: **−15 pt** each (anti-brute-force); score clamps at 0.
- Two progressive hints (−20 / −40).

## Learning goals

- Understand the difference between AWS global services (IAM, CloudFront, Route 53) and regional services (DynamoDB, EC2, Lambda).
- Confirm that DynamoDB tables are region-scoped resources.
- Distinguish "no region picker needed" (global) from "must choose a region" (regional).
