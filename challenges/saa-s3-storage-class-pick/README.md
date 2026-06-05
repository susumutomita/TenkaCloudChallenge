# saa-s3-storage-class-pick

**Certification:** Solutions Architect Associate (SAA-C03) · **Kind:** `flag` · **Difficulty:** 2 · **Cost:** $0

## Story

Week two at TenkaCloud Inc. CTO Sasaki-san flags a cost anomaly: Kato-san stored all quarterly financial reports in S3 Standard, racking up unnecessary charges. The data is touched only four times a year, but immediate retrieval is non-negotiable. The learner reads an SSM parameter describing the access pattern and selects the correct S3 storage class.

## What gets deployed

One SSM Parameter (`/{NamePrefix}/access-pattern`) describing a data profile: ~50 GB of quarterly reports accessed approximately once every 90 days, immediate retrieval required, minimum retention 90 days. A second SSM Parameter holds the briefing. No S3 bucket or object is created.

All resources are free: no S3 storage, no EC2, no RDS.

## Solution (operator notes)

Three requirements to satisfy simultaneously: infrequent access (quarterly), immediate retrieval, retention >30 days.

- **STANDARD** -- designed for frequent access, costs more than necessary -- wrong
- **GLACIER** -- low cost but retrieval takes minutes to hours -- fails immediate requirement -- wrong
- **STANDARD_IA** -- low-frequency access, millisecond retrieval, 30-day minimum storage -- **correct**

```bash
aws ssm get-parameter --name /{NamePrefix}/access-pattern --query 'Parameter.Value' --output text
```

**Flag:** `TC{standard-ia}` (stored in CFn Output `AnswerFlag`, which the participant role cannot read).

## Scoring

- Correct: **+200 pt** (once per deploy).
- Wrong answer: **-15 pt** each (anti-brute-force); score clamps at 0.
- Two progressive hints (-20 / -40).

## Learning goals

- S3 Standard-IA satisfies: infrequent access + immediate retrieval + 30+ day retention.
- Glacier-class storage is disqualified by retrieval latency for any real-time access requirement.
- SAA-C03 storage-class decision framework: access frequency → retrieval speed → retention period.
