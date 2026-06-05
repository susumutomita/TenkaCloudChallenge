# scs-waf-rate-based

**Certification:** Security Specialty (SCS-C02) · **Kind:** `flag` · **Difficulty:** 3 · **Cost:** $0

## Story

Five months at TenkaCloud Inc. CTO Sasaki-san needs to stop a flood of requests from a single IP hitting Kato-san's web app. Which AWS WAF rule type automatically blocks source IPs exceeding a request rate threshold?

## What gets deployed

One SSM Parameter `/${NamePrefix}/briefing` with the scenario description.

No WAF WebACL, no ALB, no EC2. Pure scenario analysis.

## Solution (operator notes)

AWS WAF rate-based rules track per-source-IP request counts over a 5-minute evaluation window. When the count exceeds the configured threshold (e.g., 1000 req/5min), the IP is automatically blocked. The rule type name is `rate-based rule`.

```bash
aws ssm get-parameter \
  --name /<NamePrefix>/briefing \
  --query Parameter.Value \
  --output text
```

**Flag:** `TC{rate-based-rule}` (mirrored in CFn Output `AnswerFlag`, which the participant role cannot read).

## Scoring

- Correct: **+200 pt**.
- Wrong answer: **−15 pt** each; score clamps at 0.
- Two progressive hints (−20 / −40).

## Learning goals

- Understand how AWS WAF rate-based rules track per-IP request rate and auto-block on threshold.
- Distinguish managed rule groups, custom rules, and rate-based rules in AWS WAF.
- Organize DDoS/brute-force mitigation WAF patterns from the SCS exam perspective.
