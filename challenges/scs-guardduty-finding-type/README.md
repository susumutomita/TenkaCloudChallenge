# scs-guardduty-finding-type

**Certification:** Security Specialty (SCS-C02) · **Kind:** `flag` · **Difficulty:** 3 · **Cost:** $0

## Story

Two months at TenkaCloud Inc. A GuardDuty alert fires at midnight. An EC2 instance (left by Kato-san) is querying a known cryptocurrency-mining domain. What GuardDuty finding category covers this?

## What gets deployed

One SSM Parameter `/${NamePrefix}/briefing` with the scenario description.

No EC2, no real GuardDuty resources. Pure scenario analysis.

## Solution (operator notes)

GuardDuty finding type for an EC2 instance querying a crypto-mining domain: `CryptoCurrency:EC2/BitcoinTool.B!DNS`. The **category** (prefix before the colon) is `CryptoCurrency`.

```bash
aws ssm get-parameter \
  --name /<NamePrefix>/briefing \
  --query Parameter.Value \
  --output text
```

**Flag:** `TC{cryptocurrency}` (mirrored in CFn Output `AnswerFlag`, which the participant role cannot read).

## Scoring

- Correct: **+200 pt**.
- Wrong answer: **−15 pt** each; score clamps at 0.
- Two progressive hints (−20 / −40).

## Learning goals

- Understand the GuardDuty finding type category taxonomy.
- Know that cryptocurrency-mining communications map to the `CryptoCurrency` category.
- Navigate the GuardDuty finding types documentation.
