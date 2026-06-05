# scs-secrets-manager-rotation

**Certification:** Security Specialty (SCS-C02) · **Kind:** `flag` · **Difficulty:** 3 · **Cost:** $0

## Story

Two and a half months at TenkaCloud Inc. CTO Sasaki-san needs automatic 30-day rotation of RDS credentials. Kato-san stored the password in SSM Parameter Store — which can't auto-rotate for RDS natively. Which AWS service handles this?

## What gets deployed

One SSM Parameter `/${NamePrefix}/briefing` with the scenario description.

No RDS, no Secrets Manager resources. Pure scenario analysis.

## Solution (operator notes)

AWS Secrets Manager provides built-in rotation Lambda functions for RDS, Redshift, and DocumentDB. SSM Parameter Store has no native auto-rotation — you would need to write your own Lambda. The answer is Secrets Manager.

```bash
aws ssm get-parameter \
  --name /<NamePrefix>/briefing \
  --query Parameter.Value \
  --output text
```

**Flag:** `TC{secrets-manager}` (mirrored in CFn Output `AnswerFlag`, which the participant role cannot read).

## Scoring

- Correct: **+200 pt**.
- Wrong answer: **−15 pt** each; score clamps at 0.
- Two progressive hints (−20 / −40).

## Learning goals

- Understand the key difference between AWS Secrets Manager and SSM Parameter Store: native auto-rotation support.
- Explain why Secrets Manager is the right choice for automatic RDS credential rotation.
- Organize credential management best practices from the SCS exam perspective.
