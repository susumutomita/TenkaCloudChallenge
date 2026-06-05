# scs-macie-pii

**Certification:** Security Specialty (SCS-C02) · **Kind:** `flag` · **Difficulty:** 2 · **Cost:** $0

## Story

Four and a half months at TenkaCloud Inc. CTO Sasaki-san discovers that Kato-san may have uploaded files with PII to S3. Which AWS service automatically discovers and classifies sensitive data in S3?

## What gets deployed

One SSM Parameter `/${NamePrefix}/briefing` with the scenario description.

No Macie, no S3 objects. Pure scenario analysis.

## Solution (operator notes)

Amazon Macie uses machine learning to automatically scan S3 buckets for PII and sensitive data (credit card numbers, social security numbers, etc.) and generates findings. Decoys: GuardDuty (threat detection), Inspector (vulnerability scanning), Security Hub (findings aggregator).

```bash
aws ssm get-parameter \
  --name /<NamePrefix>/briefing \
  --query Parameter.Value \
  --output text
```

**Flag:** `TC{macie}` (mirrored in CFn Output `AnswerFlag`, which the participant role cannot read).

## Scoring

- Correct: **+200 pt**.
- Wrong answer: **−15 pt** each; score clamps at 0.
- Two progressive hints (−15 / −35).

## Learning goals

- Understand that Amazon Macie automatically discovers and classifies PII and sensitive data in S3.
- Distinguish Macie (data classification) from GuardDuty (threat detection).
- Organize S3 data security patterns from the SCS exam perspective.
